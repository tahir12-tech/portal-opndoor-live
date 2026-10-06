-- A TENANT WHOSE STRIPE SESSION FAILED STILL GETS CHASED.
--
-- fire_payment_reminders selected only applications with `payment_url is not
-- null`. payment_url is the URL of the EAGER Stripe Checkout session that
-- create-referral opens at referral time, and that call can fail: create-referral
-- catches it, records the send as failed, and creates the referral anyway,
-- precisely so somebody can resend. Such a row is status 'sent', fee unpaid,
-- payment_url null.
--
-- So the applications whose tenant never received a working link were the exact
-- applications excluded from every reminder. Nobody was chased, nothing appeared
-- in payment_reminders, and the referral sat at 'sent' until it expired. Silently,
-- because a reminder that is never attempted logs nothing.
--
-- AND THE COLUMN IS NOT USED. payment-reminders/index.ts declares payment_url in
-- its row type and never reads it: the link it emails is minted fresh from
-- mint_payment_page_token on every run, because the tenant must get the durable
-- /pay?token= page and never a Stripe URL (a Stripe session expires in 24 hours,
-- which is the "pay links die after a day" fault). The gate was therefore
-- filtering on an artefact nothing downstream wanted.
--
-- This is the same mistake as the one just removed from resend-payment-email,
-- which refused to resend unless payment_url existed: the recovery path gated on
-- the thing that had failed. Two surfaces, one wrong idea.
--
-- The column stays IN THE RETURN TYPE. Removing it would change the function's
-- signature and force a drop-and-recreate plus a redeploy of the edge function in
-- the same step, which is the deploy-order trap this week has been full of. It is
-- returned and ignored, exactly as before.
--
-- Everything else is lifted verbatim from 20261005130000: the same joins, the same
-- threshold logic, the same idempotent claim into payment_reminders (which is what
-- makes the duplicated 07:00 and 08:00 crons harmless), the same activity_log row.
-- Only the one `and` is gone.

create or replace function public.fire_payment_reminders(p_today date)
  returns table (
    application_id uuid, guarantee_ref text, days int,
    tenant_title text, tenant_last_name text, tenant_email text,
    prop_addr1 text, prop_postcode text, monthly_rent numeric, fee_amount numeric, payment_url text,
    agency text, branch text, referrer_email text, partner_id uuid
  )
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare r record; k text; d int;
begin
  for r in
    select a.id, a.guarantee_ref, (p_today - a.sent_at::date) as age,
           a.tenant_title, a.tenant_last_name, a.tenant_email, a.prop_addr1, a.prop_postcode,
           a.monthly_rent, a.fee_amount, a.payment_url, a.partner_id,
           ag.name as agency_name, br.name as branch_name, u.email as ref_email
    from public.applications a
    left join public.branches br on br.id = a.branch_id
    left join public.agencies ag on ag.id = a.agency_id
    left join public.users u on u.id = a.referrer_id
    where a.livemode
      and a.status = 'sent'
      and coalesce(a.payment_state, '') <> 'refunded'
      -- `and a.payment_url is not null` was here. See the header.
      and a.sent_at is not null
      and (p_today - a.sent_at::date) >= 2
  loop
    d := r.age;
    -- Only the highest reached threshold fires (so a long-stuck app first seen at
    -- day 21 gets one reminder, not a backlog of all three).
    k := case when d >= 9 then '9' when d >= 5 then '5' else '2' end;
    insert into public.payment_reminders (application_id, threshold, days_at_send)
      values (r.id, k, d) on conflict do nothing;
    if not found then continue; end if; -- already sent this threshold: skip
    insert into public.activity_log (application_id, kind, message, actor, visibility)
      values (r.id, 'payment_reminder',
        'Payment reminder sent to the tenant: guarantor fee still unpaid ' || d || ' days after the application was sent.',
        'System', 'business');
    application_id := r.id; guarantee_ref := r.guarantee_ref; days := d;
    tenant_title := r.tenant_title; tenant_last_name := r.tenant_last_name; tenant_email := r.tenant_email;
    prop_addr1 := r.prop_addr1; prop_postcode := r.prop_postcode; monthly_rent := r.monthly_rent;
    fee_amount := r.fee_amount; payment_url := r.payment_url;
    agency := r.agency_name; branch := r.branch_name; referrer_email := r.ref_email; partner_id := r.partner_id;
    return next;
  end loop;
end $function$;

comment on function public.fire_payment_reminders(date) is
  'Claims the payment reminders due today, one per application per threshold, and returns what the email needs. Does NOT require payment_url: the link is minted fresh by the caller, and an application whose eager Stripe session failed is the one that most needs chasing.';

revoke all on function public.fire_payment_reminders(date) from public, anon, authenticated;
grant execute on function public.fire_payment_reminders(date) to service_role;
