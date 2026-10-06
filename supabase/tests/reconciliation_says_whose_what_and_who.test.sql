-- RECONCILIATION SAYS WHOSE, WHAT, AND WHO.
--
-- Matt (am): "1) show which supplier each new agency or office belongs to
-- ('Kestrel Lettings · Test Test Test'); 2) an agency's automatic first
-- office (created with it) is confirmed together with the agency, not listed
-- separately; offices added later are listed on their own; 3) 'created by A
-- referrer' must name the person who created it."
--
-- ITEM 2 WAS ALREADY BUILT AND HAD NEVER ONCE FIRED, which is the finding.
-- The fold looked for an office named `<agency>, Head office`. That name is
-- produced by nothing: create_referral_target defaults an unnamed office to
-- plain 'Head office', and every pending row on dev is named after its
-- AGENCY, because the supplier's referral form puts the agency name in the
-- office box. Three spellings, matched none -- and a test asserting the
-- fold against a fixture named the fourth way would have passed while the
-- queue in front of Matt listed every office separately.
--
-- SO THE FIXTURE HERE USES THE NAMES DEV ACTUALLY HAS, not the one the old
-- rule expected. That is the whole point of it.

begin;
select plan(10);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled, partner_kind)
values ('d3000000-0000-0000-0000-0000000000d1','zzz-rc-supplier','ZZZ RC Supplier',
        'pre_referenced_open', 0.30, 0.10, false, false, true, true, 'supplier');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('d3000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.rc.neg@r.test','',now(),now(),now()),
       ('d3000000-0000-0000-0000-00000000c002','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.rc.ops@r.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('d3000000-0000-0000-0000-00000000c001','Bea Negotiator','zzz.rc.neg@r.test','referrer',
   'd3000000-0000-0000-0000-0000000000d1','active',false),
  ('d3000000-0000-0000-0000-00000000c002','ZZZ RC Ops','zzz.rc.ops@r.test','opndoor_manager',
   null,'active',true);

-- A: a brand new agency with its ONE automatic office, named after the
--    agency exactly as dev's are. Both pending.
insert into public.agencies (id, partner_id, name, review_state, livemode, created_by) values
  ('d3000000-0000-0000-0000-0000000000a1','d3000000-0000-0000-0000-0000000000d1',
   'ZZZ Fold Agency','pending_review',true,'d3000000-0000-0000-0000-00000000c001');
insert into public.branches (id, agency_id, partner_id, name, review_state, livemode, created_by) values
  ('d3000000-0000-0000-0000-0000000000b1','d3000000-0000-0000-0000-0000000000a1',
   'd3000000-0000-0000-0000-0000000000d1','ZZZ Fold Agency','pending_review',true,null);

-- B: an agency that already has a CONFIRMED office, plus a new pending one.
--    A second decision, and it must stay on the list.
insert into public.agencies (id, partner_id, name, review_state, livemode, created_by) values
  ('d3000000-0000-0000-0000-0000000000a2','d3000000-0000-0000-0000-0000000000d1',
   'ZZZ Second Agency','pending_review',true,'d3000000-0000-0000-0000-00000000c001');
insert into public.branches (id, agency_id, partner_id, name, review_state, livemode, created_by) values
  ('d3000000-0000-0000-0000-0000000000b2','d3000000-0000-0000-0000-0000000000a2',
   'd3000000-0000-0000-0000-0000000000d1','London','confirmed',true,'d3000000-0000-0000-0000-00000000c001'),
  ('d3000000-0000-0000-0000-0000000000b3','d3000000-0000-0000-0000-0000000000a2',
   'd3000000-0000-0000-0000-0000000000d1','Leeds','pending_review',true,'d3000000-0000-0000-0000-00000000c001');

select set_config('request.jwt.claims',
  '{"sub":"d3000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ===========================================================================
-- 1-3. WHOSE. Item 1, and the reason it matters is the name trap: dev holds
--      two agencies called Frost Partnership, so a row naming only the
--      agency cannot be acted on safely.
-- ===========================================================================
select is(
  (select supplier from public.reconciliation_queue() q where q.name = 'ZZZ Fold Agency' and q.entity_type='agency'),
  'ZZZ RC Supplier',
  'a new agency says whose estate it is');

select is(
  (select supplier from public.reconciliation_queue() q where q.name = 'Leeds'),
  'ZZZ RC Supplier',
  'and so does a new office');

select is(
  (select parent from public.reconciliation_queue() q where q.name = 'Leeds'),
  'ZZZ Second Agency',
  'which is as well as its agency, not instead of it');

-- ===========================================================================
-- 4-6. WHAT. Item 2, by shape rather than by name.
-- ===========================================================================
select is(
  (select count(*) from public.reconciliation_queue() q
    where q.entity_type = 'branch' and q.parent = 'ZZZ Fold Agency'),
  0::bigint,
  'the automatic first office is NOT listed separately, though it is named after its agency');

select is(
  (select folded_head_office from public.reconciliation_queue() q
    where q.name = 'ZZZ Fold Agency' and q.entity_type='agency'),
  true,
  'and the agency''s own card says it includes it');

select is(
  (select count(*) from public.reconciliation_queue() q where q.name = 'Leeds'),
  1::bigint,
  'while an office added to an agency that already had one IS listed: a second decision');

select is(
  (select folded_head_office from public.reconciliation_queue() q
    where q.name = 'ZZZ Second Agency' and q.entity_type='agency'),
  false,
  'and that agency''s card claims to include nothing');

-- ===========================================================================
-- 8-9. WHO. Item 3. The automatic office carries no created_by at all, which
--      is why the queue said "A referrer" -- it was not anonymising anybody,
--      it had nobody to name.
-- ===========================================================================
select is(
  (select created_by_name from public.reconciliation_queue() q
    where q.name = 'ZZZ Fold Agency' and q.entity_type='agency'),
  'Bea Negotiator',
  'the agency names the person who created it');

select is(
  (select created_by_name from public.reconciliation_queue() q where q.name = 'Leeds'),
  'Bea Negotiator',
  'and so does an office that has its own creator');

-- ===========================================================================
-- 10. THE LITERAL SURVIVES AS A LAST RESORT, for a creator since deleted.
--     Removing it would print "created by" and then nothing.
-- ===========================================================================
reset role;
update public.agencies set created_by = null where id = 'd3000000-0000-0000-0000-0000000000a2';
update public.branches set created_by = null where id = 'd3000000-0000-0000-0000-0000000000b3';
select set_config('request.jwt.claims',
  '{"sub":"d3000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(
  (select created_by_name from public.reconciliation_queue() q where q.name = 'Leeds'),
  'A referrer',
  'and a record whose creator is gone still says something rather than nothing');

reset role;
select * from finish();
rollback;
