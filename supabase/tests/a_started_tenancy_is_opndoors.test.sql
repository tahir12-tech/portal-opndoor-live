-- A STARTED TENANCY IS OPNDOOR'S TO AMEND.
--
-- Matt, 2026-10-04: "agency and supplier users can change a start date only
-- before the tenancy starts (signed or not); after the start date, only
-- Opndoor staff can."
--
-- WHY IT IS A RULE AT ALL, which the old code never asked. `expiry_date` is
-- GENERATED from `tenancy_start`. A guarantee six months into its term could
-- have its start date moved by any Manager, which moved the expiry with it:
-- the period of cover on a signed deed, already reported to the underwriter
-- on the bordereau, changed without the underwriter or the tenant being part
-- of it. A correction before the let begins is a correction. The same edit
-- after it begins is a variation of a live contract.
--
-- THE CUT IS ONE FACT, and that is the point. Not the deed state, not the
-- status, not who signed: has the tenancy started. Every reader of the rule
-- -- RPC, dialog, FAQ -- can hold one question in their head.
--
-- WHICH MEANS IT WIDENS AS WELL AS NARROWS, and both halves are tested here:
--   2, 3  before the start, an owning Negotiator and a Manager may amend a
--         SIGNED deed, which used to be refused outright
--   5, 6  after the start, neither may, which used to be allowed
--   7, 8  after the start, an opndoor ADMIN still may, because somebody has to
--   9     and so may an opndoor MANAGER, which is Matt's 2026-10-04 ruling:
--         "any Opndoor staff (admins and opndoor managers) can change a
--         start date at any time". That assertion used to say the opposite,
--         and it is the reason this one exists: the reach guard was
--         is_admin(), so an opndoor manager was refused before the
--         predicate was consulted. Guard and predicate now agree, and this
--         is where that is proved rather than assumed.
--
-- DATES ARE RELATIVE TO current_date throughout. A fixture with a hardcoded
-- 2026-08-01 in it tests "started" today and "not started" if anyone ever
-- reruns the suite against a clock before that date. The rule is about the
-- relationship between two dates, so the fixture states the relationship.

begin;
select plan(11);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled, partner_kind)
values ('ce000000-0000-0000-0000-0000000000d1','zzz-st-supplier','ZZZ ST Supplier',
        'pre_referenced_open', 0.30, 0.10, false, false, true, true, 'supplier');
insert into public.agencies (id, partner_id, name) values
  ('ce000000-0000-0000-0000-0000000000a1','ce000000-0000-0000-0000-0000000000d1','ZZZ ST Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('ce000000-0000-0000-0000-0000000000b1','ce000000-0000-0000-0000-0000000000a1',
   'ce000000-0000-0000-0000-0000000000d1','ZZZ ST Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       x.email,'',now(),now(),now()
from (values
  ('ce000000-0000-0000-0000-00000000c001'::uuid,'zzz.st.mgr@r.test'),
  ('ce000000-0000-0000-0000-00000000c002'::uuid,'zzz.st.neg@r.test'),
  ('ce000000-0000-0000-0000-00000000c003'::uuid,'zzz.st.opn@r.test'),
  ('ce000000-0000-0000-0000-00000000c004'::uuid,'zzz.st.adm@r.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('ce000000-0000-0000-0000-00000000c001','ZZZ ST Manager','zzz.st.mgr@r.test','management',
   'ce000000-0000-0000-0000-0000000000d1','active',true),
  ('ce000000-0000-0000-0000-00000000c002','ZZZ ST Negotiator','zzz.st.neg@r.test','referrer',
   'ce000000-0000-0000-0000-0000000000d1','active',false);

-- OPNDOOR STAFF SIT ON NO ESTATE AT ALL, which `users_partner_by_role`
-- enforces: superadmin and opndoor_manager must have a NULL partner_id, and
-- everybody else must have one. That is the shape of the rule being tested.
-- They are allowed here because of WHO THEY ARE, not where they sit, and the
-- constraint says they sit nowhere.
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('ce000000-0000-0000-0000-00000000c003','ZZZ ST Opndoor Mgr','zzz.st.opn@r.test','opndoor_manager',
        null,'active',true),
       ('ce000000-0000-0000-0000-00000000c004','ZZZ ST Opndoor Admin','zzz.st.adm@r.test','superadmin',
        null,'active',true);

-- TWO APPLICATIONS, IDENTICAL BUT FOR THE DATE. Both deeds executed, so the
-- only thing that can explain a difference in the verdicts below is whether
-- the tenancy has begun.
insert into public.applications (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
       tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
       prop_addr1, prop_city, prop_postcode,
       monthly_rent, tenancy_start, partner_rate, agent_rate, referencing_mode,
       status, paid_at, deed_issued_at, deed_state)
values
  ('ce000000-0000-0000-0000-0000000000f1','GR-ZZST01',
   'ce000000-0000-0000-0000-0000000000d1','ce000000-0000-0000-0000-0000000000a1',
   'ce000000-0000-0000-0000-0000000000b1','ce000000-0000-0000-0000-00000000c002',
   'Mx','Faye','Future','1990-01-01','zzz.st.f@r.test','07700900990',
   '1 Future Street','London','FU1 1AA',
   1200, current_date + 30, 0.30, 0.10, 'pre_referenced_open',
   'deed', now(), now(), 'executed'),
  ('ce000000-0000-0000-0000-0000000000f2','GR-ZZST02',
   'ce000000-0000-0000-0000-0000000000d1','ce000000-0000-0000-0000-0000000000a1',
   'ce000000-0000-0000-0000-0000000000b1','ce000000-0000-0000-0000-00000000c002',
   'Mx','Pat','Past','1990-01-01','zzz.st.p@r.test','07700900991',
   '2 Past Street','London','PA1 1AA',
   1200, current_date - 30, 0.30, 0.10, 'pre_referenced_open',
   'deed', now(), now(), 'executed');

-- ===========================================================================
-- 1. THE PREDICATE ITSELF, pure, before any caller is involved. Nine rows of
--    truth table in one assertion so a change to the rule shows as a change
--    to the rule rather than as four unrelated failures.
-- ===========================================================================
select is(
  (select string_agg(
            r || '/' || case when st then 'started' else 'before' end || '=' ||
            coalesce(public.can_amend_tenancy_start(r, 'deed', true, 'executed', st)::text, 'null'),
            ' ' order by r, st)
     from (values ('referrer'),('management'),('opndoor_manager'),('superadmin')) as a(r)
     cross join (values (false),(true)) as b(st)),
  'management/before=true management/started=false '
  || 'opndoor_manager/before=true opndoor_manager/started=true '
  || 'referrer/before=true referrer/started=false '
  || 'superadmin/before=true superadmin/started=true',
  'the rule in full: before the start everyone in role may, after it opndoor staff alone');

-- ===========================================================================
-- 2-3. BEFORE THE START, A SIGNED DEED IS AMENDABLE BY THE AGENCY. This is
--      the half that WIDENS, and it is the half most likely to be "fixed"
--      back by somebody reading the old deed-state rule and assuming a bug.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"ce000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$select public.amend_tenancy_start('ce000000-0000-0000-0000-0000000000f1', current_date + 45)$$,
  'an owning Negotiator may correct a SIGNED deed that has not started yet');
reset role;

select set_config('request.jwt.claims',
  '{"sub":"ce000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$select public.amend_tenancy_start('ce000000-0000-0000-0000-0000000000f1', current_date + 60)$$,
  'and so may their Manager');
reset role;

select is(
  (select tenancy_start from public.applications where id='ce000000-0000-0000-0000-0000000000f1'),
  current_date + 60,
  'and the date really moved, so these are not passing on a no-op');

-- ===========================================================================
-- 5-6. AFTER THE START, NEITHER MAY. The half that NARROWS. The error message
--      is asserted, not just the refusal: it is the sentence the dialog
--      shows, and a 42501 saying "not permitted" would be the generic reach
--      refusal from the line above, which would mean this guard never ran.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"ce000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select public.amend_tenancy_start('ce000000-0000-0000-0000-0000000000f2', current_date + 5)$$,
  '42501',
  'The tenancy has started. Contact opndoor to change the date.',
  'the owning Negotiator is refused once the tenancy has started, and told why');
reset role;

select set_config('request.jwt.claims',
  '{"sub":"ce000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select public.amend_tenancy_start('ce000000-0000-0000-0000-0000000000f2', current_date + 5)$$,
  '42501',
  'The tenancy has started. Contact opndoor to change the date.',
  'and so is their Manager, who could do this yesterday');
reset role;

-- ===========================================================================
-- 7-8. AN OPNDOOR ADMIN STILL MAY, because otherwise a genuine error in a
--      live tenancy has no route at all and the rule would be a dead end
--      rather than a referral. This is what "contact opndoor" resolves to.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"ce000000-0000-0000-0000-00000000c004","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$select public.amend_tenancy_start('ce000000-0000-0000-0000-0000000000f2', current_date - 20)$$,
  'an opndoor admin may still correct a tenancy that has started');
reset role;

select is(
  (select tenancy_start from public.applications where id='ce000000-0000-0000-0000-0000000000f2'),
  current_date - 20,
  'and it moved');

-- ===========================================================================
-- 9. AN OPNDOOR MANAGER IS OPNDOOR STAFF, which is the whole of Matt's
--    2026-10-04 ruling and the thing this file previously asserted the
--    opposite of.
--
--    IT IS A GUARD TEST, NOT A PREDICATE TEST, and that is why it goes
--    through the RPC rather than calling can_amend_tenancy_start directly
--    like assertion 1. The predicate said "no" for a reason that lived
--    somewhere else: amend_tenancy_start's reach guard was is_admin(). A
--    test that only exercised the predicate would have gone green on the
--    widening while an opndoor manager was still refused in the portal.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"ce000000-0000-0000-0000-00000000c003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$select public.amend_tenancy_start('ce000000-0000-0000-0000-0000000000f2', current_date - 10)$$,
  'an opndoor MANAGER may amend a started tenancy, reach guard and predicate agreeing');
reset role;

select is(
  (select tenancy_start from public.applications where id='ce000000-0000-0000-0000-0000000000f2'),
  current_date - 10,
  'and it moved, so the reach guard really did widen');

-- ===========================================================================
-- 11. THE BOUNDARY IS TODAY ITSELF, not tomorrow. A tenancy starting today has
--    started: the tenant is in the property and the cover is running. Off by
--    one here is a day in which an agency can still move a live guarantee.
-- ===========================================================================
update public.applications set tenancy_start = current_date
 where id = 'ce000000-0000-0000-0000-0000000000f1';
select set_config('request.jwt.claims',
  '{"sub":"ce000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select public.amend_tenancy_start('ce000000-0000-0000-0000-0000000000f1', current_date + 7)$$,
  '42501',
  'The tenancy has started. Contact opndoor to change the date.',
  'a tenancy starting TODAY has started, so the agency is already out');
reset role;

select * from finish();
rollback;
