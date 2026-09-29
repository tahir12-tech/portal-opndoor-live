-- R1. A CONTACT BELONGS TO A COMPANY THAT ACTUALLY HOLDS THE BRANCH.
--
-- The final review round's worst finding, and the only one that was measured
-- end to end rather than argued. A Manager at one company could attach a deed
-- contact to ANOTHER company's branch, and that company's next executed Deed
-- of Guarantee was delivered to the address they wrote. Walked on dev:
--
--     EXECUTED DEED IS DELIVERED TO  attacker@evil.test via branch_contact
--
-- WHERE IT CAME FROM. `sync_contact_partner` used to derive partner_id from
-- the owning agency or branch, unconditionally -- that is still what the LIVE
-- system does, which is why live is not vulnerable. 20260812120000, the
-- migration that let an agency be shared across partners, rewrote it to:
--
--     -- 1. Stated by the caller. Every existing writer states it.
--     if new.partner_id is null then ...
--
-- The premise in that comment is false. `org_add_contact` does NOT state it,
-- and a direct PostgREST insert states whatever it likes. So the row's
-- partner_id became attacker-controlled, and `app_may_reach_contact`'s last
-- arm -- `p_partner = public.app_partner()` -- compares that attacker-supplied
-- value against the attacker's own partner and is satisfied by construction.
--
-- WHAT THE FIX MUST NOT DO. The sharing feature 20260812120000 added is real:
-- an agency introduced by a supplier transacts on that supplier's route, and
-- that route needs its own contact on the same branch. So "partner_id must
-- equal the branch's own partner" would be wrong -- it would delete the
-- feature. The rule is that a stated partner must be one the branch
-- LEGITIMATELY sits under: its owner, or a partner holding a relationship
-- with its agency. Assertions 6 and 7 are the ones that fail if the fix is
-- written as the blunt version.
--
-- THE SECOND HALF. Even with every row legitimate, `deed_delivery_target`
-- falls back to `effective_primary_contact(branch)`, which keys on the branch
-- alone with no partner filter and runs inside a definer caller, so it sees
-- every row whatever RLS says. Two suppliers legitimately sharing one agency
-- is then enough to send one route's deed to the other's contact, with nobody
-- having done anything wrong. That is assertion 9, and it is why fixing the
-- write alone is not enough.

begin;
select plan(10);

-- ===========================================================================
-- THE WORLD. Two suppliers and one agency each, plus one shared agency.
-- ===========================================================================
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled)
values
  ('c8000000-0000-0000-0000-0000000000d1','zzz-r1-victim','ZZZ R1 Victim Supplier',
   'pre_referenced_open', 0.30, 0.10, false, false, true, true),
  ('c8000000-0000-0000-0000-0000000000d2','zzz-r1-other','ZZZ R1 Other Supplier',
   'pre_referenced_open', 0.25, 0.10, false, false, true, true);

-- The victim: a supplier's own agency and branch, with NO contact of its own,
-- which is the state the supplier page already calls "No agent contact".
insert into public.agencies (id, partner_id, name) values
  ('c8000000-0000-0000-0000-0000000000a1','c8000000-0000-0000-0000-0000000000d1','ZZZ R1 Victim Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('c8000000-0000-0000-0000-0000000000b1','c8000000-0000-0000-0000-0000000000a1',
   'c8000000-0000-0000-0000-0000000000d1','ZZZ R1 Victim Office');

-- The attacker: an ordinary agency on the house rail, with a Manager.
insert into public.agencies (id, partner_id, name) values
  ('c8000000-0000-0000-0000-0000000000a2',
   (select id from public.partners where slug='opndoor-agents'),'ZZZ R1 Attacker Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('c8000000-0000-0000-0000-0000000000b2','c8000000-0000-0000-0000-0000000000a2',
   (select id from public.partners where slug='opndoor-agents'),'ZZZ R1 Attacker Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       x.email,'',now(),now(),now()
from (values
  ('c8000000-0000-0000-0000-00000000c001'::uuid,'zzz.r1.attacker@r.test'),
  ('c8000000-0000-0000-0000-00000000c002'::uuid,'zzz.r1.victim@r.test'),
  ('c8000000-0000-0000-0000-00000000c003'::uuid,'zzz.r1.other@r.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('c8000000-0000-0000-0000-00000000c001','ZZZ R1 Attacker','zzz.r1.attacker@r.test','management',
   (select id from public.partners where slug='opndoor-agents'),'active',false),
  ('c8000000-0000-0000-0000-00000000c002','ZZZ R1 Victim Mgr','zzz.r1.victim@r.test','management',
   'c8000000-0000-0000-0000-0000000000d1','active',false),
  ('c8000000-0000-0000-0000-00000000c003','ZZZ R1 Other Mgr','zzz.r1.other@r.test','management',
   'c8000000-0000-0000-0000-0000000000d2','active',false);
insert into public.user_scopes (user_id, kind, agency_id) values
  ('c8000000-0000-0000-0000-00000000c001','agency','c8000000-0000-0000-0000-0000000000a2');

-- THE RELATIONSHIP that makes the OTHER supplier a legitimate route for the
-- victim's agency. This row, and only this row, is what separates assertion 6
-- (must still work) from assertion 2 (must be refused).
insert into public.partner_agency_relationships (partner_id, agency_id, introduced)
values ('c8000000-0000-0000-0000-0000000000d2','c8000000-0000-0000-0000-0000000000a1', true);

-- ===========================================================================
-- 1-3. THE WRITE IS REFUSED, three ways: the predicate, the trigger, and RLS.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"c8000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is(
  public.app_may_reach_contact(null,'c8000000-0000-0000-0000-0000000000b1', public.app_partner()),
  false,
  'the predicate refuses a branch the caller''s partner has no claim on');

select throws_ok(
  $$insert into public.agent_contacts (agency_id, branch_id, partner_id, name, email, is_primary)
    values (null,'c8000000-0000-0000-0000-0000000000b1',
            (select id from public.partners where slug='opndoor-agents'),
            'ZZZ R1 Planted','attacker@evil.test', true)$$,
  'a contact must belong to a company that holds the branch',
  'and the write itself is refused, by name rather than by a bare RLS denial');

-- The same forgery attempted with the row labelled as the VICTIM's partner,
-- which is what an attacker tries next: it fails the caller test instead.
select isnt_empty(
  $$select 1 where not coalesce(
      public.app_may_reach_contact(null,'c8000000-0000-0000-0000-0000000000b1',
                                   'c8000000-0000-0000-0000-0000000000d1'), false)$$,
  'and labelling the row with the victim''s own partner does not help either');

-- ===========================================================================
-- 4-5. WHAT MUST STILL WORK. The victim's own manager, and an opndoor admin.
--
-- The forged row is swept first, as the owner. Before the fix it lands, and
-- `agent_contacts_primary_per_branch` then means every later insert on this
-- branch collides with it -- so without this sweep, assertions 4 to 7 fail as
-- FALLOUT from the exploit rather than on their own merits, and would stop
-- being the regression guards they are meant to be.
-- ===========================================================================
reset role;
delete from public.agent_contacts where branch_id = 'c8000000-0000-0000-0000-0000000000b1';

select set_config('request.jwt.claims',
  '{"sub":"c8000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$insert into public.agent_contacts (id, agency_id, branch_id, partner_id, name, email, is_primary)
    values ('c8000000-0000-0000-0000-0000000000e1', null,'c8000000-0000-0000-0000-0000000000b1',
            'c8000000-0000-0000-0000-0000000000d1','ZZZ R1 Rightful','rightful@victim.test', true)$$,
  'the branch''s OWN supplier may still write its contact');

reset role;
select is(
  (select partner_id from public.agent_contacts where id='c8000000-0000-0000-0000-0000000000e1'),
  'c8000000-0000-0000-0000-0000000000d1'::uuid,
  'and it is stored against that supplier, not against whoever happened to write it');

-- ===========================================================================
-- 6-7. THE SHARING FEATURE MUST SURVIVE. A supplier that introduced the
-- agency holds a real relationship, so its own route contact on that agency's
-- estate is legitimate. A fix that pins partner_id to the branch's owner
-- passes 1-5 and fails here.
--
-- ON A SECOND BRANCH, DELIBERATELY. Writing it to the SAME branch as the
-- rightful contact fails today for a reason that has nothing to do with R1:
-- `contacts_maintain_primary` is SECURITY INVOKER and counts the existing
-- contacts THROUGH RLS, so a caller who cannot see the branch's current
-- primary counts zero, has their own row force-promoted to primary, and
-- collides with `agent_contacts_primary_per_branch`. That is a real defect and
-- it is recorded as B22, but it is not this one, and pinning R1's test to it
-- would make this file fail for the wrong reason.
-- ===========================================================================
insert into public.branches (id, agency_id, partner_id, name) values
  ('c8000000-0000-0000-0000-0000000000b3','c8000000-0000-0000-0000-0000000000a1',
   'c8000000-0000-0000-0000-0000000000d1','ZZZ R1 Victim Second Office');

select set_config('request.jwt.claims',
  '{"sub":"c8000000-0000-0000-0000-00000000c003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$insert into public.agent_contacts (id, agency_id, branch_id, partner_id, name, email, is_primary)
    values ('c8000000-0000-0000-0000-0000000000e2', null,'c8000000-0000-0000-0000-0000000000b3',
            'c8000000-0000-0000-0000-0000000000d2','ZZZ R1 Route','route@other.test', true)$$,
  'a supplier that INTRODUCED the agency may still write its own route contact');

reset role;
select is(
  (select partner_id from public.agent_contacts where id='c8000000-0000-0000-0000-0000000000e2'),
  'c8000000-0000-0000-0000-0000000000d2'::uuid,
  'and the stated route partner is kept, because the relationship justifies it');

-- ===========================================================================
-- 8-9. THE DEED. Even with every row legitimate, the partner-blind fallback
-- can hand one route's executed deed to the other route's contact.
-- ===========================================================================
insert into public.applications (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
       tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
       prop_addr1, prop_city, prop_postcode,
       monthly_rent, tenancy_start, partner_rate, agent_rate, referencing_mode)
values ('c8000000-0000-0000-0000-0000000000f1','GR-ZZR101',
        'c8000000-0000-0000-0000-0000000000d1','c8000000-0000-0000-0000-0000000000a1',
        'c8000000-0000-0000-0000-0000000000b1','c8000000-0000-0000-0000-00000000c002',
        'Mx','Vic','Tim','1990-01-01','zzz.r1.tenant@r.test','07700900950',
        '1 Victim Street','London','VC1 1AA',
        1500, current_date + 30, 0.30, 0.10, 'pre_referenced_open');

select is(
  (select email from public.deed_delivery_target('c8000000-0000-0000-0000-0000000000f1')),
  'rightful@victim.test',
  'the deed goes to the contact of the route the application is actually on');

-- THE SECOND HALF, and the one no write-side fix reaches. The other supplier
-- legitimately holds a contact on this branch too -- placed here as the owner,
-- because B22 stops its own manager placing it, and because what matters for
-- the deed is only that the row is legitimate and present. Remove the
-- rightful contact and `contacts_promote_on_delete` makes the other
-- supplier's the branch's primary. `effective_primary_contact(branch)` keys on
-- the branch alone, so the fallback now offers one route's contact for the
-- other route's deed, with nobody having done anything wrong.
insert into public.agent_contacts (id, agency_id, branch_id, partner_id, name, email, is_primary)
values ('c8000000-0000-0000-0000-0000000000e3', null,'c8000000-0000-0000-0000-0000000000b1',
        'c8000000-0000-0000-0000-0000000000d2','ZZZ R1 Other Route','other-route@other.test', false);

delete from public.agent_contacts where id = 'c8000000-0000-0000-0000-0000000000e1';

select is(
  (select email from public.deed_delivery_target('c8000000-0000-0000-0000-0000000000f1')),
  null,
  'and with no contact on its own route it reaches nobody, never the other supplier''s');

-- ===========================================================================
-- 10. AND RE-LABELLING AN EXISTING ROW IS THE SAME HOLE BY ANOTHER DOOR.
-- The trigger fired `before insert or update OF agency_id, branch_id`, so an
-- UPDATE touching only partner_id did not fire it at all: write a legitimate
-- contact, then re-label whose it is.
-- ===========================================================================
insert into public.agent_contacts (id, agency_id, branch_id, partner_id, name, email, is_primary)
values ('c8000000-0000-0000-0000-0000000000e4', null,'c8000000-0000-0000-0000-0000000000b2',
        (select id from public.partners where slug='opndoor-agents'),
        'ZZZ R1 Own','own@attacker.test', true);

select set_config('request.jwt.claims',
  '{"sub":"c8000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select throws_ok(
  $$update public.agent_contacts set partner_id = 'c8000000-0000-0000-0000-0000000000d1'
     where id = 'c8000000-0000-0000-0000-0000000000e4'$$,
  'a contact must belong to a company that holds the branch',
  'and an existing contact cannot be re-labelled as another company''s');

reset role;
select * from finish();
rollback;
