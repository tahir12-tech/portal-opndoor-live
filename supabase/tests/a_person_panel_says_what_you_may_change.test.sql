-- THE PANEL IS ASSEMBLED BY THE SERVER, INCLUDING WHAT YOU MAY CHANGE.
--
-- The client half of walk fixes 9, 10 and 12. One round trip returns a
-- person's whole panel: every event with its current value and whether it is
-- locked, the two Director-only toggles, and -- the part that matters -- a
-- flag per section saying whether THIS caller may change it.
--
-- WHY THE SERVER DECIDES WHAT IS EDITABLE. The three settings now have three
-- different rules (self / Director at-or-above / admin, and two that are
-- Director-only and NOT self). A client that re-derives those rules will
-- eventually disagree with the server, and the way that failure presents is
-- the worst kind: a control that looks live, accepts a click, and throws.
-- Asking the server means the screen can only ever offer what will work.
--
-- THE ASSERTIONS ARE THE DISAGREEMENTS. Each role gets a different panel for
-- the same person, and the interesting rows are the ones where two roles
-- differ -- a Negotiator may change their own events but not their own
-- statements, which no single boolean can express.

begin;
select plan(14);

insert into public.agencies (id, partner_id, name) values
  ('e3000000-0000-0000-0000-0000000000a1',
   (select id from public.partners where slug='opndoor-agents'),'ZZZ PL Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('e3000000-0000-0000-0000-0000000000b1','e3000000-0000-0000-0000-0000000000a1',
   (select id from public.partners where slug='opndoor-agents'),'ZZZ PL Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       x.email,'',now(),now(),now()
from (values
  ('e3000000-0000-0000-0000-00000000c001'::uuid,'zzz.pl.dir@r.test'),
  ('e3000000-0000-0000-0000-00000000c002'::uuid,'zzz.pl.neg@r.test')
) as x(id,email);
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('e3000000-0000-0000-0000-00000000c001','PL Director','zzz.pl.dir@r.test','management',
   (select id from public.partners where slug='opndoor-agents'),'active',true),
  ('e3000000-0000-0000-0000-00000000c002','PL Negotiator','zzz.pl.neg@r.test','referrer',
   (select id from public.partners where slug='opndoor-agents'),'active',false);
insert into public.user_scopes (user_id, kind, agency_id) values
  ('e3000000-0000-0000-0000-00000000c001','agency','e3000000-0000-0000-0000-0000000000a1');
insert into public.user_scopes (user_id, kind, branch_id) values
  ('e3000000-0000-0000-0000-00000000c002','branch','e3000000-0000-0000-0000-0000000000b1');

select public.migrate_notification_settings_to_people();

-- ===========================================================================
-- 1-4. THE NEGOTIATOR, LOOKING AT THEIR OWN PANEL.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"e3000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is(
  (public.person_notification_panel('e3000000-0000-0000-0000-00000000c002') ->> 'may_edit_events')::boolean,
  true,
  'a Negotiator may change their own event choices');

select is(
  (public.person_notification_panel('e3000000-0000-0000-0000-00000000c002') ->> 'may_edit_copied')::boolean,
  false,
  'but NOT whether they are copied on colleagues'' referrals');

select is(
  (public.person_notification_panel('e3000000-0000-0000-0000-00000000c002') ->> 'may_edit_statements')::boolean,
  false,
  'nor whether they get monthly statements');

/* THE POINT OF THE WHOLE SHAPE. No single "can this person edit" boolean
   could carry those three different answers about one panel. */
select isnt(
  (public.person_notification_panel('e3000000-0000-0000-0000-00000000c002') ->> 'may_edit_events'),
  (public.person_notification_panel('e3000000-0000-0000-0000-00000000c002') ->> 'may_edit_copied'),
  'so the panel carries a flag per section, not one for the whole thing');

-- ===========================================================================
-- 5. AND A NEGOTIATOR IS NOT OFFERED STATEMENTS AT ALL, because their level
-- cannot receive one. Matt: "if their level allows it."
-- ===========================================================================
select is(
  (public.person_notification_panel('e3000000-0000-0000-0000-00000000c002') ->> 'statements_apply')::boolean,
  false,
  'and statements are not even shown, because a Negotiator may not see commission');

-- ===========================================================================
-- 6-9. THE DIRECTOR, LOOKING AT THE NEGOTIATOR'S PANEL.
-- ===========================================================================
reset role;
select set_config('request.jwt.claims',
  '{"sub":"e3000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is(
  (public.person_notification_panel('e3000000-0000-0000-0000-00000000c002') ->> 'may_edit_events')::boolean,
  true,
  'a Director may change their Negotiator''s event choices');

select is(
  (public.person_notification_panel('e3000000-0000-0000-0000-00000000c002') ->> 'may_edit_copied')::boolean,
  true,
  'and whether they are copied on colleagues'' referrals');

select is(
  (public.person_notification_panel('e3000000-0000-0000-0000-00000000c001') ->> 'statements_apply')::boolean,
  true,
  'and on their OWN panel statements do apply, because a Director may see commission');

-- ===========================================================================
-- 9-10. THE EVENTS THEMSELVES, and the locked one carries its reason.
-- ===========================================================================
select cmp_ok(
  jsonb_array_length(public.person_notification_panel('e3000000-0000-0000-0000-00000000c002') -> 'events'),
  '>', 0,
  'the panel lists the events, so the screen does not have to know them');

select isnt_empty(
  $$select 1
      from jsonb_array_elements(
        public.person_notification_panel('e3000000-0000-0000-0000-00000000c002') -> 'events') e
     where (e ->> 'locked')::boolean
       and coalesce(e ->> 'lock_reason', '') <> ''$$,
  'and a locked event carries the SENTENCE to print, never a bare flag');

-- ===========================================================================
-- 11. A PERSON AT ANOTHER AGENCY IS NOT READABLE AT ALL. The panel is a
-- read of somebody's settings, so it is bounded by the same ladder.
-- ===========================================================================
-- As the owner: fixtures are set up, not exercised, and RLS on `agencies`
-- correctly refuses an agency user creating one.
reset role;
insert into public.agencies (id, partner_id, name) values
  ('e3000000-0000-0000-0000-0000000000a2',
   (select id from public.partners where slug='opndoor-agents'),'ZZZ PL Other');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('e3000000-0000-0000-0000-00000000c003','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.pl.other@r.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('e3000000-0000-0000-0000-00000000c003','PL Other','zzz.pl.other@r.test','referrer',
   (select id from public.partners where slug='opndoor-agents'),'active',false);
insert into public.user_scopes (user_id, kind, agency_id) values
  ('e3000000-0000-0000-0000-00000000c003','agency','e3000000-0000-0000-0000-0000000000a2');

select set_config('request.jwt.claims',
  '{"sub":"e3000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select throws_ok(
  $$select public.person_notification_panel('e3000000-0000-0000-0000-00000000c003')$$,
  '42501',
  'You can only see this for yourself, or for people at or below you in your own agency.',
  'and a Director cannot read a panel at another agency on the same house partner');

-- ===========================================================================
-- 12-14. AN OPNDOOR MANAGER READS AND CHANGES NOTHING.
--
-- This is round 6's M11, moved to where it belongs. The defect then was that
-- the agency People tab drew the notifications tickbox for an opndoor_manager
-- with no isAdmin gate, so every click raised 42501 with a sentence that was
-- not even true of them. The client guarded it with a source test on that
-- column, and the column is gone.
--
-- The guard is the SERVER's now, and stronger for it: nav gives an
-- opndoor_manager the Agencies section, and they answer "why did this person
-- not get it?", so the panel must OPEN and must offer no control at all.
-- ===========================================================================
reset role;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('e3000000-0000-0000-0000-00000000c004','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.pl.opsmgr@opndoor.test','',now(),now(),now());
-- partner_id NULL: users_partner_by_role requires it of opndoor staff, who
-- are on no rail at all.
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('e3000000-0000-0000-0000-00000000c004','PL Ops Manager','zzz.pl.opsmgr@opndoor.test','opndoor_manager',
   null,'active',false);

select set_config('request.jwt.claims',
  '{"sub":"e3000000-0000-0000-0000-00000000c004","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.person_notification_panel('e3000000-0000-0000-0000-00000000c002')$$,
  'an opndoor manager may OPEN anybody''s panel, because they answer "why did this person not get it?"');

select is(
  (public.person_notification_panel('e3000000-0000-0000-0000-00000000c002') ->> 'may_edit_events')::boolean,
  false,
  'and may change none of their event choices');

/* BOTH DIRECTOR-ONLY SETTINGS TOO. The old defect was one control gated and
   the one beside it not, so the pair is asserted rather than either alone. */
select is(
  ((public.person_notification_panel('e3000000-0000-0000-0000-00000000c002') ->> 'may_edit_copied')::boolean
   or (public.person_notification_panel('e3000000-0000-0000-0000-00000000c002') ->> 'may_edit_statements')::boolean),
  false,
  'nor either of the two Director-only settings');

reset role;
select * from finish();
rollback;
