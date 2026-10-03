-- A CUSTOMER'S HISTORY SAYS "opndoor", NOT WHICH OF US.
--
-- Matt, 2026-10-03: "in Recent changes and any other customer-facing history,
-- show changes made by Opndoor staff as 'opndoor', not the staff member's
-- name."
--
-- WHY IT MATTERS MORE THAN IT LOOKS. Recent changes is read by an agency's own
-- Director and by a supplier's Management, and every row an Opndoor admin made
-- named a person at Opndoor: "Nicholas Dwyer set the agent rate to 10%". That
-- is our internal staffing, published to a customer, on a page they open every
-- week.
--
-- THE READER DECIDES, WHICH IS THE HALF A SINGLE ASSERTION WOULD MISS. An
-- Opndoor admin reading the same history still needs the name, because for
-- them "who" is the whole point of an audit trail. So this file asserts the
-- same rows twice, once as each kind of reader.

begin;
select plan(8);

insert into public.partners (id, slug, name, referencing_mode, is_house_route, partner_kind)
values ('f1000000-0000-0000-0000-0000000000a1','zzz-hist','ZZZ History Agencies',
        'opndoor_referenced', false, 'agency');

insert into public.agencies (id, partner_id, name, review_state, livemode)
values ('f1000000-0000-0000-0000-0000000000b1','f1000000-0000-0000-0000-0000000000a1',
        'ZZZ History Agency','confirmed', true);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select id, '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       email, '', now(), now(), now()
from (values
  ('f1000000-0000-0000-0000-0000000000d1'::uuid,'zzz.hist.admin@o.test'),
  ('f1000000-0000-0000-0000-0000000000d2'::uuid,'zzz.hist.dir@a.test'),
  ('f1000000-0000-0000-0000-0000000000d3'::uuid,'zzz.hist.opsmgr@o.test')
) as v(id, email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('f1000000-0000-0000-0000-0000000000d1','ZZZ Opndoor Admin','zzz.hist.admin@o.test',
        'superadmin', null, 'active', true),
       ('f1000000-0000-0000-0000-0000000000d2','ZZZ Agency Director','zzz.hist.dir@a.test',
        'management','f1000000-0000-0000-0000-0000000000a1','active', true),
       ('f1000000-0000-0000-0000-0000000000d3','ZZZ Opndoor Manager','zzz.hist.opsmgr@o.test',
        'opndoor_manager', null, 'active', true);

-- The Director has to reach the agency to read its history at all.
insert into public.user_scopes (user_id, kind, agency_id)
values ('f1000000-0000-0000-0000-0000000000d2','agency','f1000000-0000-0000-0000-0000000000b1');

-- THREE ROWS, THREE KINDS OF ACTOR: an opndoor admin, an opndoor manager, and
-- the customer's own Director. Only the first two should ever be masked.
insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id, at)
values ('agency','f1000000-0000-0000-0000-0000000000b1','updated','name',
        'ZZZ Opndoor Admin','f1000000-0000-0000-0000-0000000000d1', now() - interval '3 min'),
       ('agency','f1000000-0000-0000-0000-0000000000b1','updated','group',
        'ZZZ Opndoor Manager','f1000000-0000-0000-0000-0000000000d3', now() - interval '2 min'),
       ('agency','f1000000-0000-0000-0000-0000000000b1','updated','contact',
        'ZZZ Agency Director','f1000000-0000-0000-0000-0000000000d2', now() - interval '1 min');

/* AND ONE WITH NO actor_id, which an older row and a system write both look
   like. It must fall through unchanged: if we cannot show it was Opndoor
   staff, we must not claim it was. */
insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id, at)
values ('agency','f1000000-0000-0000-0000-0000000000b1','created','ZZZ History Agency',
        'A system job', null, now() - interval '4 min');

-- ===========================================================================
-- AS THE CUSTOMER'S OWN DIRECTOR
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"f1000000-0000-0000-0000-0000000000d2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select ok(
  exists (select 1 from public.agency_changes('f1000000-0000-0000-0000-0000000000b1', 50)
           where actor = 'opndoor'),
  'a customer sees "opndoor" where one of our staff made the change');

select is(
  (select count(*)::int from public.agency_changes('f1000000-0000-0000-0000-0000000000b1', 50)
    where actor = 'opndoor'),
  2, 'both an admin and an opndoor manager are masked, not just the admin');

select ok(
  not exists (select 1 from public.agency_changes('f1000000-0000-0000-0000-0000000000b1', 50)
               where actor in ('ZZZ Opndoor Admin', 'ZZZ Opndoor Manager')),
  'and neither of their names reaches the page');

/* THE CUSTOMER'S OWN PEOPLE KEEP THEIR NAMES, which is the point of the
   history for them: a Director reading it needs to know which of their team
   changed something. */
select ok(
  exists (select 1 from public.agency_changes('f1000000-0000-0000-0000-0000000000b1', 50)
           where actor = 'ZZZ Agency Director'),
  'their own people keep their names');

select ok(
  exists (select 1 from public.agency_changes('f1000000-0000-0000-0000-0000000000b1', 50)
           where actor = 'A system job'),
  'and a row with no actor_id is not relabelled, because we cannot tell');

reset role;

-- ===========================================================================
-- AS OPNDOOR, WHERE "WHO" IS THE WHOLE POINT
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"f1000000-0000-0000-0000-0000000000d1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select ok(
  exists (select 1 from public.agency_changes('f1000000-0000-0000-0000-0000000000b1', 50)
           where actor = 'ZZZ Opndoor Admin'),
  'an opndoor admin still sees which of us did it');

select ok(
  exists (select 1 from public.agency_changes('f1000000-0000-0000-0000-0000000000b1', 50)
           where actor = 'ZZZ Opndoor Manager'),
  'including an opndoor manager');

select ok(
  not exists (select 1 from public.agency_changes('f1000000-0000-0000-0000-0000000000b1', 50)
               where actor = 'opndoor'),
  'and never the masked word, which would hide the audit trail from the auditor');

select finish();
rollback;
