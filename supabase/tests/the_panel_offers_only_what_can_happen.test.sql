-- THE NOTIFICATIONS PANEL OFFERS ONLY WHAT CAN HAPPEN.
--
-- Matt, 2026-10-01: "Supplier people's notifications panel: when Opndoor
-- admin opens it, include the monthly commission statements switch (Management
-- only; supplier users can't change it themselves). Only list events that can
-- actually happen for that supplier: for a pre-referenced supplier, hide 'Sent
-- for referencing', 'Approved' and 'Declined'."
--
-- Migration: 20261007360000_the_panel_offers_only_what_can_happen.sql
--
-- =========================================================================
-- TWO FAULTS, AND THEY ARE THE SAME FAULT
-- =========================================================================
--
-- The panel was written for our own estate and then pointed at the supplier
-- rail without being asked what is different there. `sees_commission` is the
-- bit that separates a Director from a Manager on OUR estate and is not set
-- on the supplier rail, so the statements switch was hidden from exactly the
-- people who are sent the statement. And the three verdict notices describe a
-- referencing run that happens before a pre-referenced supplier's referral
-- ever reaches us.

begin;
select plan(10);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route, partner_kind)
values ('96000000-0000-0000-0000-0000000000f1', 'zzz-pre', 'ZZZ Pre-referenced', 'pre_referenced_open', 0.30, 0.10, false, 'supplier'),
       ('96000000-0000-0000-0000-0000000000f2', 'zzz-ours', 'ZZZ Our Estate', 'opndoor_referenced', 0.25, 0.10, false, 'agency');

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
values
  ('96000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@zzz-panel.test', now(), now(), '{}'::jsonb, '{}'::jsonb, '','','','','','','',''),
  ('96000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mgmt@zzz-pre.test',   now(), now(), '{}'::jsonb, '{}'::jsonb, '','','','','','','',''),
  ('96000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dir@zzz-ours.test',   now(), now(), '{}'::jsonb, '{}'::jsonb, '','','','','','','','');

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('96000000-0000-0000-0000-0000000000a1', 'ZZZ Panel Admin', 'admin@zzz-panel.test', 'superadmin', null, 'active', true),
  -- A supplier's Management user: no sees_commission, because that bit is
  -- our own estate's Director/Manager split and this rail has none.
  ('96000000-0000-0000-0000-0000000000a2', 'ZZZ Pre Mgmt', 'mgmt@zzz-pre.test', 'management', '96000000-0000-0000-0000-0000000000f1', 'active', false),
  ('96000000-0000-0000-0000-0000000000a3', 'ZZZ Ours Dir', 'dir@zzz-ours.test', 'management', '96000000-0000-0000-0000-0000000000f2', 'active', true);

select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);

-- ===========================================================================
-- 1. WHAT A PRE-REFERENCED SUPPLIER IS OFFERED
-- ===========================================================================
select is(
  (select count(*)::int from jsonb_array_elements(
     public.person_notification_panel('96000000-0000-0000-0000-0000000000a2') -> 'events') e
    where e->>'type' in ('sent', 'approved', 'decline')),
  0, 'a pre-referenced supplier is offered no referencing verdict notices');

select cmp_ok(
  (select count(*)::int from jsonb_array_elements(
     public.person_notification_panel('96000000-0000-0000-0000-0000000000a2') -> 'events')),
  '>', 0, 'and is still offered the ones that do happen');

select is(
  (select count(*)::int from jsonb_array_elements(
     public.person_notification_panel('96000000-0000-0000-0000-0000000000a2') -> 'events') e
    where e->>'type' in ('paid', 'deed_issued')),
  2, 'such as the fee being paid and the deed being issued');

/* AND OUR OWN ESTATE IS UNTOUCHED, which is the half that must not move:
   Opndoor does the referencing there, so all three verdicts are real. */
select is(
  (select count(*)::int from jsonb_array_elements(
     public.person_notification_panel('96000000-0000-0000-0000-0000000000a3') -> 'events') e
    where e->>'type' in ('sent', 'approved', 'decline')),
  3, 'while one of our own agencies keeps all three');

-- ===========================================================================
-- 2. THE MONTHLY STATEMENT SWITCH
-- ===========================================================================
select is(
  (public.person_notification_panel('96000000-0000-0000-0000-0000000000a2') ->> 'statements_apply')::boolean,
  true, 'a supplier''s Management user is offered the statements switch');

select is(
  (public.person_notification_panel('96000000-0000-0000-0000-0000000000a2') ->> 'may_edit_statements')::boolean,
  true, 'and Opndoor may set it');

select is(
  (public.person_notification_panel('96000000-0000-0000-0000-0000000000a3') ->> 'statements_apply')::boolean,
  true, 'and a Director on our own estate still is, as before');

-- ===========================================================================
-- 3. BUT THE SUPPLIER CANNOT SET IT FOR THEMSELVES
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);

select is(
  (public.person_notification_panel('96000000-0000-0000-0000-0000000000a2') ->> 'may_edit_statements')::boolean,
  false, 'a supplier''s own Management user cannot change it');

select is(
  (public.person_notification_panel('96000000-0000-0000-0000-0000000000a2') ->> 'statements_apply')::boolean,
  true, 'though they can see whether it is on, which is their own setting to read');

/* AND THE RULE IS THE DATABASE'S, not the panel's: the writer refuses
   them too, so a hand-made call gets the same answer the screen does. */
set local role authenticated;
select throws_ok(
  $$ select public.set_receives_commission_statements('96000000-0000-0000-0000-0000000000a2', true) $$,
  null, null,
  'and the writer refuses them as well, so the panel is not the only thing saying no');
reset role;

select * from finish();
rollback;
