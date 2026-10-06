-- TURN OFF ALL THE ONES THAT CAN BE.
--
-- Matt (ap) item 2: "each person can switch any of it off, including their
-- copy of the signed deed, plus a 'Turn off all' switch. Two things can
-- never be switched off: account emails (invites, password resets,
-- two-factor), and delivery of the signed deed to the agency it's for."
--
-- "ALL" CANNOT MEAN ALL, and the function has to say which. A control
-- labelled "Turn off all" that silently left two on would be lying about
-- what it did, so this returns a COUNT and the dialog reports it.
--
-- THE LOCKED CELL IS SKIPPED, NOT ATTEMPTED AND CAUGHT. set_notification_for
-- raises on it, and swallowing that would mean this function could not tell
-- "locked, as designed" from "refused, something is wrong".

begin;
select plan(7);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled, partner_kind)
values ('d8000000-0000-0000-0000-0000000000d1','zzz-ta-supplier','ZZZ TA Supplier',
        'pre_referenced_open', 0.30, 0.10, false, false, true, true, 'supplier');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('d8000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.ta.me@r.test','',now(),now(),now()),
       ('d8000000-0000-0000-0000-00000000c009','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.ta.other@r.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('d8000000-0000-0000-0000-00000000c001','Ta Referrer','zzz.ta.me@r.test','referrer',
   'd8000000-0000-0000-0000-0000000000d1','active',false),
  ('d8000000-0000-0000-0000-00000000c009','Ta Stranger','zzz.ta.other@r.test','referrer',
   'd8000000-0000-0000-0000-0000000000d1','active',false);

select set_config('request.jwt.claims',
  '{"sub":"d8000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ===========================================================================
-- 1-2. IT TURNS OFF WHAT IT CAN, AND SAYS HOW MANY.
-- ===========================================================================
select ok(public.turn_off_all_notifications('d8000000-0000-0000-0000-00000000c001') > 0,
  'turning everything off switches off a positive number of notifications');

reset role;
select is(
  (select count(*) from public.user_notification_settings
    where user_id = 'd8000000-0000-0000-0000-00000000c001' and enabled),
  0::bigint,
  'and leaves none of the switchable ones on');

-- ===========================================================================
-- 3-4. THE LOCKED ONE IS ON THE AGENCY RAIL, and finding that out is worth
--      recording. notification_locked locks `deed_issued` to the
--      'referrer' recipient on the AGENCY rail and to 'agent_contact' on
--      the supplier rail -- so for a SUPPLIER's own person nothing is
--      locked at all: the thing that cannot be switched off there is
--      delivery to the agency's mailbox, which is not a user row.
--
--      WHICH MEANS "Turn off all" REALLY DOES TURN OFF EVERYTHING of a
--      supplier person's own email, and the count is still the honest way
--      to say so. The locked case needs an agency-rail reader to exist at
--      all, so it is tested on one.
-- ===========================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('d8000000-0000-0000-0000-00000000c002','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.ta.ag@r.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
select 'd8000000-0000-0000-0000-00000000c002','Ta Agency Neg','zzz.ta.ag@r.test','referrer',
       p.id,'active',false from public.partners p where p.slug = 'opndoor-agents';

select set_config('request.jwt.claims',
  '{"sub":"d8000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select ok(public.turn_off_all_notifications('d8000000-0000-0000-0000-00000000c002') > 0,
  'an agency-rail person can turn their own off too');
reset role;

-- user_notification_enabled takes (person, KIND, TYPE). Getting those the
-- wrong way round is silent: every argument is text, so the call returns
-- the default for a kind that does not exist rather than failing.
select ok(
  public.user_notification_enabled(
    'd8000000-0000-0000-0000-00000000c002', 'agency', 'deed_issued'),
  'but their copy of the signed deed is STILL ON: it cannot be switched off');

-- ===========================================================================
-- 5-6. A SECOND RUN CHANGES NOTHING AND SAYS SO -- the half 20261008220000
--      corrected. The count is of what CHANGED, so the dialog's "there was
--      nothing left to switch off" is reachable, and a second press cannot
--      claim to have switched off nine things again.
--
--      IT STILL WRITES THEM. An unset cell reads as its class default, so
--      leaving the already-off ones unset would hand them back the day a
--      default flips. Every unlocked type has the person's own row.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"d8000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(public.turn_off_all_notifications('d8000000-0000-0000-0000-00000000c001'),
  0, 'running it again switches off nothing, and reports nothing');
reset role;

select is(
  (select count(*) from public.user_notification_settings
    where user_id = 'd8000000-0000-0000-0000-00000000c001'),
  (select count(*) from public.notification_types() t
    where not public.notification_locked('supplier', t.notification_type, 'referrer')),
  'and every unlocked type is written down, not left to the default');

-- ===========================================================================
-- 7. AND NOT FOR SOMEBODY ELSE. The permission is set_notification_for's,
--    applied by calling it rather than copied -- so a Referrer cannot turn
--    off a colleague's.
--
--    AS authenticated, not as postgres: a 42501 raised inside a definer is
--    only evidence of the rule if the caller is the role the rule is
--    written for. Assertion 6 above had to reset_role to count the rows,
--    so the role is set again here.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"d8000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select public.turn_off_all_notifications('d8000000-0000-0000-0000-00000000c009')$$,
  '42501',
  null,
  'a Referrer may not switch off a colleague''s notifications');

reset role;
select * from finish();
rollback;
