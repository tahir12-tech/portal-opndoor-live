-- NOTIFICATIONS ARE GENUINELY PER PERSON.
--
-- Matt, 2026-09-30: "genuinely per person, for agency and supplier users as
-- well as Opndoor staff. Each person chooses which events they are told
-- about for the referrals they can see... The locked items stay locked for
-- everyone... Replace the agency-wide event switches with this; migrate
-- today's agency settings onto each existing person so nobody's emails
-- change on the day it ships."
--
-- THE ASSERTION THAT CARRIES THE RISK IS 1, AND IT IS NOT ABOUT ROWS.
-- Settings are stored today per (party, event, recipient CLASS). They become
-- per (person, event). That is a JOIN, not a copy, because which class a
-- person falls into depends on the person -- and in fact on the REFERRAL:
-- the same person is the `referrer` class on their own referral and the
-- `ticked_users` class on a colleague's.
--
-- So the migration cannot be checked by looking at the rows it wrote. It has
-- to be checked by asking, for each person, whether the set of events they
-- would be emailed about is the SAME before and after. Assertion 1 does
-- exactly that, against a party whose two classes DISAGREE -- which is the
-- only shape where a careless migration silently drops somebody.
--
-- WHY A DISAGREEING PARTY HAD TO BE CONSTRUCTED. There are no stored
-- settings on dev at all: every party is on defaults, so a migration that
-- simply wrote the defaults would pass on real data while being wrong. The
-- fixture below sets the two classes differently on purpose, so the test can
-- fail.
--
-- WHAT IS DELIBERATELY NOT PER PERSON: the supplier rail's `agent_contact`.
-- It is a contact record, not a user -- no login, no `public.users` row -- so
-- there is nobody to hold a preference. Assertion 7 pins that it survives as
-- a party setting, because losing it would silently stop the executed deed
-- reaching a supplier whose referral came in through an API key with no
-- human on it.

begin;
select plan(8);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled)
values ('e1000000-0000-0000-0000-0000000000d1','zzz-pp-supplier','ZZZ PP Supplier',
        'pre_referenced_open', 0.30, 0.10, false, false, true, true);

-- An AGENCY on the house estate, which is where both classes are users.
insert into public.agencies (id, partner_id, name) values
  ('e1000000-0000-0000-0000-0000000000a1',
   (select id from public.partners where slug='opndoor-agents'),'ZZZ PP Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('e1000000-0000-0000-0000-0000000000b1','e1000000-0000-0000-0000-0000000000a1',
   (select id from public.partners where slug='opndoor-agents'),'ZZZ PP Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       x.email,'',now(),now(),now()
from (values
  ('e1000000-0000-0000-0000-00000000c001'::uuid,'zzz.pp.dir@r.test'),
  ('e1000000-0000-0000-0000-00000000c002'::uuid,'zzz.pp.neg@r.test'),
  ('e1000000-0000-0000-0000-00000000c003'::uuid,'zzz.pp.sup@r.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('e1000000-0000-0000-0000-00000000c001','ZZZ PP Director','zzz.pp.dir@r.test','management',
   (select id from public.partners where slug='opndoor-agents'),'active',true),
  ('e1000000-0000-0000-0000-00000000c002','ZZZ PP Negotiator','zzz.pp.neg@r.test','referrer',
   (select id from public.partners where slug='opndoor-agents'),'active',false),
  ('e1000000-0000-0000-0000-00000000c003','ZZZ PP Supplier Mgr','zzz.pp.sup@r.test','management',
   'e1000000-0000-0000-0000-0000000000d1','active',true);
insert into public.user_scopes (user_id, kind, agency_id) values
  ('e1000000-0000-0000-0000-00000000c001','agency','e1000000-0000-0000-0000-0000000000a1'),
  ('e1000000-0000-0000-0000-00000000c002','agency','e1000000-0000-0000-0000-0000000000a1');

-- ===========================================================================
-- THE PARTY WHOSE TWO CLASSES DISAGREE. Without this the migration cannot be
-- tested at all: on defaults both classes are on for an agency, so a wrong
-- migration and a right one produce the same answer.
-- ===========================================================================
insert into public.notification_settings (agency_id, notification_type, recipient, enabled)
values
  ('e1000000-0000-0000-0000-0000000000a1','paid','referrer',      true),
  ('e1000000-0000-0000-0000-0000000000a1','paid','ticked_users',  false),
  ('e1000000-0000-0000-0000-0000000000a1','sent','referrer',      false),
  ('e1000000-0000-0000-0000-0000000000a1','sent','ticked_users',  true);

-- ===========================================================================
-- 1. NOBODY'S EMAILS CHANGE. For every user at that agency and every event,
-- what they would be sent before the migration equals what they would be
-- sent after it.
-- ===========================================================================
create temp table _before on commit drop as
select u.id as user_id, t.notification_type,
       (public.notification_enabled('agency', null, 'e1000000-0000-0000-0000-0000000000a1',
                                    t.notification_type, 'referrer')
        or public.notification_enabled('agency', null, 'e1000000-0000-0000-0000-0000000000a1',
                                    t.notification_type, 'ticked_users')) as would_be_sent
  from public.users u
  cross join public.notification_types() t
 where u.id in ('e1000000-0000-0000-0000-00000000c001','e1000000-0000-0000-0000-00000000c002');

select public.migrate_notification_settings_to_people();

select is_empty(
  $$
  select b.user_id::text || ' ' || b.notification_type
    from _before b
    where b.would_be_sent is distinct from
          public.user_notification_enabled(b.user_id, 'agency', b.notification_type)
  $$,
  'every person is emailed about exactly the same events after the migration as before');

-- ===========================================================================
-- 2-3. AND IT IS NOT VACUOUS. The disagreeing party really did produce
-- different answers per class, so assertion 1 had something to preserve.
-- ===========================================================================
select isnt(
  (select would_be_sent from _before
    where user_id='e1000000-0000-0000-0000-00000000c001' and notification_type='paid'),
  (select public.notification_enabled('agency', null, 'e1000000-0000-0000-0000-0000000000a1',
                                      'paid', 'ticked_users')),
  'the fixture really does have two classes that disagree, so assertion 1 could fail');

select is(
  (select count(*)::int from public.user_notification_settings
    where user_id in ('e1000000-0000-0000-0000-00000000c001','e1000000-0000-0000-0000-00000000c002')),
  (select (count(*) * 2)::int from public.notification_types()),
  'and a row was written for every person and every event, not just the ones that differed');

-- ===========================================================================
-- 4-5. EACH PERSON NOW CHOOSES, AND THEIR CHOICE IS THEIR OWN.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.set_my_notification('paid', true)$$,
  'a negotiator may choose for themselves');

reset role;
select is(
  (select enabled from public.user_notification_settings
    where user_id='e1000000-0000-0000-0000-00000000c002' and notification_type='paid'),
  true,
  'and it is recorded against them alone');

-- ===========================================================================
-- 6. THE LOCKED ITEM STAYS LOCKED FOR EVERYONE. Matt's words. A person may
-- not switch off the executed deed reaching its own recipient.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select throws_ok(
  $$select public.set_my_notification('deed_issued', false)$$,
  '42501',
  'The executed deed always reaches the person it is addressed to. That cannot be switched off.',
  'and cannot switch off the executed deed, however they try');

reset role;
select is(
  public.user_notification_enabled('e1000000-0000-0000-0000-00000000c002', 'agency', 'deed_issued'),
  true,
  'so the deed still reaches them whatever the table says');

-- ===========================================================================
-- 7. THE SUPPLIER'S AGENT CONTACT IS NOT A PERSON, so its routing survives
-- as a party setting. Losing it would silently stop the executed deed
-- reaching a supplier whose referral arrived through an API key.
-- ===========================================================================
select is(
  (select count(*)::int from public.notification_recipient_classes('supplier')
    where recipient = 'agent_contact'),
  1,
  'the supplier agent-contact class still exists, because there is no person to move it to');

select * from finish();
rollback;
