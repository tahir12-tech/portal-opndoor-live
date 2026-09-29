-- THE REST OF ROUND FIVE'S LOWS, in SQL.
--
-- Five of the twelve live in the database. The other seven are edge functions
-- and client code, or were already closed and asserted
-- (referrer_league no longer ranks a leaver:
-- what_the_fifth_reviewer_found.test.sql).
--
-- 1. TEN FUNCTIONS WERE STILL PUBLIC-EXECUTABLE. None is SECURITY DEFINER, so
--    none of them is an escalation -- they run as the caller under the
--    caller's RLS -- which is why this is a low and not an H. It is still ten
--    entry points nobody decided to open. Bucketed by how each is actually
--    reached, measured rather than assumed:
--
--      five TRIGGER functions   EXECUTE is not checked when a trigger fires
--                               them, so they need no grant at all
--      level_rank_of_level      named in a policy expression, and a policy
--                               expression is permission-checked against the
--                               QUERYING role, so authenticated must keep it
--      four pure helpers        called from inside other functions; keep
--                               authenticated, revoke public and anon
--
-- 2. FOUR applications POLICIES WERE `TO public`. RLS still applies the USING
--    clause, and for anon the predicates do not come out true, so nothing was
--    readable. Naming the role is the cheap half of defence in depth, and it
--    makes the four agree with applications_delete and applications_live_only,
--    which already say authenticated.
--
-- 3. TWO FUNCTIONS LACKED THE AAL2 STEP-UP that their neighbours have.
--    staff_payment_page_token mints a 90-day bearer token to a payment page
--    and agency_branches_for_match is an opndoor-staff read; both were
--    reachable from a password-only session.
--
-- 4. users_mgmt_insert HAD NO CONTAINMENT. Its WITH CHECK is
--    `app_role() = 'management' and partner_id = app_partner()` plus the level
--    ladder, and on the house route partner_id is every agency we carry, so
--    the only thing binding the new row to the caller was their level. The
--    home branch is the one locating column a users row has, so that is what
--    is bound. Rows created through create_invited_user are unaffected: it is
--    SECURITY DEFINER and owned by the table owner.
--
-- 5. fire_expiry_reminders SENT TO A DEACTIVATED REFERRER on the supplier rail.

-- ---- 1. the ten that were PUBLIC-executable -------------------------------
-- Trigger functions: fired by the trigger machinery, which does not check
-- EXECUTE, so nobody needs to hold it.
revoke all on function public.applications_livemode_immutable() from public, anon, authenticated;
revoke all on function public.flag_sequence_anomaly() from public, anon, authenticated;
revoke all on function public.users_commission_capability_is_admin_only() from public, anon, authenticated;
revoke all on function public.users_home_branch_guard() from public, anon, authenticated;
revoke all on function public.users_level_ladder_guard() from public, anon, authenticated;

-- Named in a policy expression, so the querying role must be able to execute it
-- or the policy itself fails. This is the trap 20261006330000 documents.
revoke all on function public.level_rank_of_level(text) from public, anon;
grant execute on function public.level_rank_of_level(text) to authenticated, service_role;

-- Pure helpers, called from inside other functions. No data access of their own.
revoke all on function public.eligibility_criteria_version() from public, anon;
grant execute on function public.eligibility_criteria_version() to authenticated, service_role;
revoke all on function public.months_elapsed(date, date) from public, anon;
grant execute on function public.months_elapsed(date, date) to authenticated, service_role;
revoke all on function public.normalise_org_name(text) from public, anon;
grant execute on function public.normalise_org_name(text) to authenticated, service_role;
revoke all on function public.partner_status(text) from public, anon;
grant execute on function public.partner_status(text) to authenticated, service_role;

-- ---- 2. the four applications policies that did not name their role -------
alter policy applications_insert on public.applications to authenticated;
alter policy applications_opndoor_read on public.applications to authenticated;
alter policy applications_select on public.applications to authenticated;
alter policy applications_update on public.applications to authenticated;

-- ---- 4. containment on users_mgmt_insert ----------------------------------
-- The level ladder and the partner pin stay exactly as they were; this adds the
-- reach test that was missing. A row with no home branch is still allowed: a
-- Director or Manager is located by their POSITION, which set_user_scope grants
-- separately under its own ladder, and requiring a branch here would refuse
-- every management invite.
alter policy users_mgmt_insert on public.users
  with check (
    public.app_role() = 'management'
    and partner_id = public.app_partner()
    and role = any (array['management','referrer','developer'])
    and coalesce(public.level_rank_of_level(
          case when role = 'referrer' then 'Negotiator'
               when sees_commission then 'Director'
               else 'Manager' end), 99) >= coalesce(public.level_rank_of(auth.uid()), 99)
    and (home_branch_id is null or public.app_may_reach_branch(home_branch_id))
  );

-- ---- 3 and 5. the three bodies --------------------------------------------
-- agency_branches_for_match(uuid)
CREATE OR REPLACE FUNCTION public.agency_branches_for_match(p_agency uuid)
 RETURNS TABLE(branch_id uuid, name text, area text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_opndoor_staff(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
  return query
    select b.id, b.name, b.area
      from public.branches b
     where b.agency_id = p_agency
       and not b.is_placeholder
       and b.livemode
     order by b.name;
end $function$;

-- fire_expiry_reminders(date)
CREATE OR REPLACE FUNCTION public.fire_expiry_reminders(p_today date)
 RETURNS TABLE(application_id uuid, guarantee_ref text, days integer, expiry_date date, agency text, branch text, referrer_id uuid, referrer_email text, referrer_name text, partner_id text, prop text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r record; k text; d int;
begin
  for r in
    select a.id, a.guarantee_ref, a.expiry_date, a.referrer_id, a.partner_id,
           a.prop_addr1, a.prop_postcode,
           ag.name as agency_name, br.name as branch_name,
           -- A DEACTIVATED REFERRER IS NOT A RECIPIENT. On the agency rail the
           -- recipients come from agency_notification_recipients, which already
           -- filters; on the supplier rail this column IS the recipient, so a
           -- leaver kept getting the reminder. Nulling the address rather than
           -- dropping the row: the reminder is still due, it just falls to the
           -- same fallback as an agency referral with nobody in scope.
           case when u.status = 'active' then u.email end as ref_email,
           u.full_name as ref_name
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

-- staff_payment_page_token(text)
CREATE OR REPLACE FUNCTION public.staff_payment_page_token(p_ref text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_app public.applications; v_token uuid;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into v_app from public.applications where guarantee_ref = p_ref;
  if not found then return null; end if;

  if not coalesce((public.is_admin()
       or (public.app_role() = 'management' and v_app.partner_id = public.app_partner()
           and public.app_may_reach_branch(v_app.branch_id))
       or (public.app_role() = 'referrer'   and v_app.referrer_id = auth.uid())), false) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  insert into public.payment_page_tokens(application_id, guarantee_ref, expires_at)
  values (v_app.id, v_app.guarantee_ref, now() + interval '90 days')
  on conflict (application_id) do update set expires_at = excluded.expires_at
  returning token into v_token;
  return v_token;
end $function$;

