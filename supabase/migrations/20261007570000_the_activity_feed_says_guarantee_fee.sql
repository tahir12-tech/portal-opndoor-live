-- ===========================================================================
-- "GUARANTEE FEE" ON THE ACTIVITY FEED TOO.
--
-- Matt, 2026-10-02, verbatim: "Use 'guarantee fee' on every screen, not
-- 'guarantor fee' (e.g. 'Guarantee fee paid', 'Guarantee fees collected'),
-- matching the emails. API field names and CSV column headings stay as
-- they are."
--
-- The screens were swept in the client. The ACTIVITY FEED is a screen too,
-- and its words are not written by the client at all: they are stored in
-- activity_log by whichever function did the thing. Three still wrote the
-- old name, in four places, and every new row carried it onto the page.
--
-- OLD ROWS KEEP THE OLD WORDS, which I said when this was raised and is
-- still true: dev holds 20 of them (8 expiries, 7 Stripe payments, 5
-- reminders) and rewriting history in an audit feed would be worse than
-- the inconsistency. stripe-webhook was corrected on the edge-function
-- side in 45e8797 and already says "Guarantee fee paid".
--
-- EACH FUNCTION IS COPIED VERBATIM from pg_get_functiondef and only the
-- four strings are changed, for the reason 20261005180000 records in full:
-- a draft of that file rebuilt a visibility rule from memory and widened
-- it twice. In particular the fifteen-day arithmetic in
-- expire_stale_applications is untouched -- its own comment explains why
-- it lands on the sixteenth calendar day, and changing the day a referred
-- tenant's application lapses as a side effect of a wording sweep is
-- exactly the kind of edit that gets found later by the person it
-- surprised. The precedent is 20260811250000, which changed this same
-- message and nothing else.
--
-- `create or replace` keeps the existing grants on all three.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.apply_stripe_payment(p_application_id uuid, p_payment_intent text, p_amount numeric, p_session_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications;
begin
  select * into a from public.applications where id = p_application_id;
  if not coalesce(found, false) then raise exception 'application not found'; end if;
  if a.status = 'sent' then
    update public.applications set
      status = 'paid', paid_at = coalesce(paid_at, now()),
      stripe_payment_intent_id   = coalesce(p_payment_intent, stripe_payment_intent_id),
      stripe_checkout_session_id = coalesce(p_session_id, stripe_checkout_session_id),
      paid_amount   = coalesce(p_amount, paid_amount), payment_state = 'paid'
    where id = p_application_id;
  elsif a.status = 'expired' or (a.status = 'withdrawn' and a.withdrawn_by_tenant) then
    -- Late money wins: reinstate the closed application to Paid.
    update public.applications set
      status = 'paid', paid_at = coalesce(paid_at, now()),
      stripe_payment_intent_id   = coalesce(p_payment_intent, stripe_payment_intent_id),
      stripe_checkout_session_id = coalesce(p_session_id, stripe_checkout_session_id),
      paid_amount   = coalesce(p_amount, paid_amount), payment_state = 'paid',
      -- THE FIX. The row now describes what it is rather than what it was.
      --
      -- withdrawn_by_tenant resets to FALSE, not null: it is not nullable, and
      -- false is the correct reading of "this application was not withdrawn by
      -- the tenant" once it is no longer withdrawn at all.
      expired_at          = null,
      withdrawn_at        = null,
      withdrawn_reason    = null,
      withdrawn_note      = null,
      withdrawn_by        = null,
      withdrawn_by_tenant = false
    where id = p_application_id;
    insert into public.activity_log(application_id, kind, message, actor, visibility)
    values (p_application_id, 'payment_reinstated',
      'Guarantee fee paid after ' || a.status || '; application reinstated to Paid.', 'System', 'business');
  elsif a.status = 'withdrawn' then
    -- Staff withdrawal: record the intent but do NOT flip to paid; flag for refund.
    update public.applications set
      stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent),
      stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session_id)
    where id = p_application_id;
    insert into public.activity_log(application_id, kind, message, actor, visibility)
    values (p_application_id, 'payment_anomaly',
      'Guarantee fee paid on a WITHDRAWN application. Review and refund required.', 'System', 'business');
  else
    update public.applications set
      stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent),
      paid_amount   = coalesce(paid_amount, p_amount),
      payment_state = coalesce(payment_state, 'paid')
    where id = p_application_id;
  end if;
end $function$;


CREATE OR REPLACE FUNCTION public.expire_stale_applications(p_today date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n integer;
begin
  with expired as (
    update public.applications
      set status = 'expired', expired_at = now()
      where status = 'sent'
        and sent_at is not null
        -- Fifteen days, not fourteen: the comparison is against MIDNIGHT of
        -- p_today, so the fourteen-day interval lands on the sixteenth calendar
        -- day. Left exactly as it was; only the message below changed.
        and sent_at < (p_today::timestamptz - interval '14 days')
      returning id
  ),
  logged as (
    insert into public.activity_log(application_id, kind, message, actor, visibility)
    select id, 'expired', 'Application expired: guarantee fee unpaid 15 days after referral.', 'System', 'business'
    from expired
    returning 1
  )
  select count(*) into n from logged;
  return coalesce(n, 0);
end $function$;


CREATE OR REPLACE FUNCTION public.fire_payment_reminders(p_today date)
 RETURNS TABLE(application_id uuid, guarantee_ref text, days integer, tenant_title text, tenant_last_name text, tenant_email text, prop_addr1 text, prop_postcode text, monthly_rent numeric, fee_amount numeric, payment_url text, agency text, branch text, referrer_email text, partner_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        'Payment reminder sent to the tenant: guarantee fee still unpaid ' || d || ' days after the application was sent.',
        'System', 'business');
    application_id := r.id; guarantee_ref := r.guarantee_ref; days := d;
    tenant_title := r.tenant_title; tenant_last_name := r.tenant_last_name; tenant_email := r.tenant_email;
    prop_addr1 := r.prop_addr1; prop_postcode := r.prop_postcode; monthly_rent := r.monthly_rent;
    fee_amount := r.fee_amount; payment_url := r.payment_url;
    agency := r.agency_name; branch := r.branch_name; referrer_email := r.ref_email; partner_id := r.partner_id;
    return next;
  end loop;
end $function$;
