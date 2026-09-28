-- TWO CRON-AND-BUTTON FAULTS, BOTH SILENT.
--
-- 1. THE MANUAL RE-SEND DID NOT FOLLOW THE AUTOMATIC ONE.
--
--    send_deed_to_agent resolved its own recipient from
--    deed_people_target(branch) -- the branch ladder -- while the webhook
--    resolved deed_delivery_target(application). Two answers to one question,
--    and on dev they gave the same wrong one: GR-20846 was referred by Tom
--    Reeve, delivered automatically to Rosa, and then Tom pressed Resend and it
--    went to Rosa again. The product made the person who sent the referral
--    hand his own document to somebody else, twice.
--
--    It now asks deed_delivery_target, which is the same function the webhook
--    asks, so the button and the automatic send cannot diverge again.
--
-- 2. EXPIRY REMINDERS HAVE NOT BEEN FIRING.
--
--    fire_expiry_reminders reads and writes `expiry_reminders.bucket`:
--
--      if exists (select 1 from public.expiry_reminders x
--                  where x.application_id = r.id and x.bucket = k)
--      insert into public.expiry_reminders (application_id, bucket) values (r.id, k)
--
--    The table is (application_id, threshold, days_at_send, sent_at), primary
--    key (application_id, threshold). There is no `bucket` column and no
--    migration ever adds one.
--
--    IT HAS NEVER THROWN, which is why nobody noticed. plpgsql does not plan a
--    statement until it executes it, and the bad statements are inside the
--    loop body: with no guarantee expiring in the next 30 days the loop never
--    runs. Confirmed on dev, where zero rows are currently due. It throws
--    42703 the first time one is, which for production is a countdown rather
--    than a fault.
--
--    The same rewrite (20261005110000) also dropped two things every earlier
--    version wrote and that the rest of the product still expects: the
--    'expiry_reminder' business row, which is what the bell and the Activity
--    feed show, and the applications.expiry_reminders_sent bump, which is what
--    the reminder counter reads. Both are restored.

-- ---------------------------------------------------------------------------
-- THE BUTTON ASKS THE SAME QUESTION THE WEBHOOK ASKS.
-- ---------------------------------------------------------------------------
create or replace function public.send_deed_to_agent(p_app uuid, p_recipient_email text default null::text, p_save_contact boolean default false)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare a public.applications; r text; owned boolean; recipient text;
        v_resolved_email text; v_resolved_name text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where id = p_app;
  if not found then raise exception 'application not found'; end if;
  r := public.app_role();
  owned := a.referrer_id = auth.uid();
  /* THE SAME ORG BOUNDARY the applications policies now use. This carried the
     old `not app_has_scope() or branch_id in (...)` shape, whose first arm
     hands an unpositioned manager every agency on the house partner. */
  if not (public.is_admin()
          or (r = 'management' and a.partner_id = public.app_partner()
              and public.app_may_reach_application_org(a.partner_id, a.agency_id, a.branch_id))
          or (r = 'referrer'   and owned)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if not public.can_send_deed(r, owned) then
    raise exception 'send not permitted for this role' using errcode = '42501';
  end if;
  if a.status <> 'deed' then raise exception 'deed not yet issued'; end if;
  if r = 'referrer' and (p_recipient_email is not null or p_save_contact) then
    raise exception 'referrers may only send to the resolved contact and cannot save contacts' using errcode = '42501';
  end if;
  if p_recipient_email is not null and p_recipient_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Invalid recipient email' using errcode = '22023';
  end if;

  /* ONE RESOLVER. Was: the mailbox chain, plus deed_people_target on the agent
     rail, assembled here -- a second implementation of the delivery rule that
     drifted from the webhook's. deed_delivery_target IS that rule. */
  select t.email, t.display_name into v_resolved_email, v_resolved_name
    from public.deed_delivery_target(p_app) t;

  recipient := coalesce(p_recipient_email, v_resolved_email);

  return jsonb_build_object('sent_to', recipient, 'resolved_contact', v_resolved_email, 'resolved_name', v_resolved_name);
end $function$;

comment on function public.send_deed_to_agent(uuid, text, boolean) is
  'Resolve and authorise a manual re-send of an executed deed. Asks deed_delivery_target, the same function the pandadoc webhook asks, so the button and the automatic send cannot answer differently: on the agency rail both now reach the person who sent the referral.';

-- ---------------------------------------------------------------------------
-- THE REMINDER THAT COULD NOT FIRE.
-- ---------------------------------------------------------------------------
create or replace function public.fire_expiry_reminders(p_today date)
returns table(application_id uuid, guarantee_ref text, days integer, expiry_date date, agency text, branch text, referrer_id uuid, referrer_email text, referrer_name text, partner_id text, prop text)
language plpgsql security definer set search_path to ''
as $function$
declare r record; k text; d int;
begin
  for r in
    select a.id, a.guarantee_ref, a.expiry_date, a.referrer_id, a.partner_id,
           a.prop_addr1, a.prop_postcode,
           ag.name as agency_name, br.name as branch_name,
           u.email as ref_email, u.full_name as ref_name
    from public.applications a
    left join public.agencies ag on ag.id = a.agency_id
    left join public.branches br on br.id = a.branch_id
    left join public.users u on u.id = a.referrer_id
    where a.livemode
      and a.status = 'deed'
      and coalesce(a.payment_state, '') <> 'refunded'
      and a.expiry_date is not null
      and a.expiry_date >= p_today
      and a.expiry_date <= p_today + 30
      -- ONE REMINDER PER DEED. No tenancy filter: each tenant holds their own
      -- guarantee over their own share, and each is told when it ends.
    order by a.expiry_date, a.guarantee_ref
  loop
    d := r.expiry_date - p_today;
    k := case when d <= 7 then '7' when d <= 14 then '14' else '30' end;

    /* THE COLUMN IS `threshold`, NOT `bucket`. The table has been
       (application_id, threshold, days_at_send, sent_at) since
       20260703122741 and never had a bucket. The loop body is the only place
       this appeared, which is why it never threw: plpgsql plans a statement
       when it runs it, and the body does not run in a month with nothing
       expiring. days_at_send is NOT NULL, so it has to be written too. */
    /* BY CONSTRAINT NAME, not by column list. This function's OUT parameter is
       itself called application_id, and plpgsql substitutes its variables
       before Postgres resolves the conflict target, so `on conflict
       (application_id, threshold)` raises 42702 "column reference is
       ambiguous". Naming the primary key sidesteps the collision without
       changing the signature, which the edge function depends on. */
    insert into public.expiry_reminders (application_id, threshold, days_at_send)
    values (r.id, k, d)
    on conflict on constraint expiry_reminders_pkey do nothing;
    -- Nothing inserted means this threshold was already sent for this
    -- application. FOUND after INSERT ... ON CONFLICT is false in that case,
    -- which is exactly the idempotency this needs.
    if not found then continue; end if;

    -- RESTORED. The business row is what the notification bell and the
    -- Activity feed read; without it the reminder existed only as an email.
    insert into public.activity_log (application_id, kind, message, actor, visibility)
    values (r.id, 'expiry_reminder',
            'Guarantee expires in ' || d || ' day' || case when d = 1 then '' else 's' end || '.',
            'System', 'business');

    -- RESTORED. The counter the expiry surfaces read to say how many reminders
    -- have gone out.
    update public.applications
       set expiry_reminders_sent = coalesce(expiry_reminders_sent, 0) + 1
     where id = r.id;

    application_id := r.id; guarantee_ref := r.guarantee_ref; days := d;
    expiry_date := r.expiry_date; agency := r.agency_name; branch := r.branch_name;
    referrer_id := r.referrer_id; referrer_email := r.ref_email; referrer_name := r.ref_name;
    partner_id := r.partner_id::text;
    prop := coalesce(r.prop_addr1, '') || case when r.prop_postcode is null then '' else ', ' || r.prop_postcode end;
    return next;
  end loop;
end $function$;

comment on function public.fire_expiry_reminders(date) is
  'One reminder per guarantee per 30/14/7 threshold, ledgered in expiry_reminders. Fixed in 20261006180000: it wrote a column (bucket) that has never existed, and only ever inside the loop body, so it threw 42703 the first time anything was actually due and was silent every other day.';
