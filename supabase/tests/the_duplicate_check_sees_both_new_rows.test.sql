/* (ck) THE DUPLICATE CHECK SEES THE OTHER NEW ROW.
   Migration: 20261009040000.

   Matt: "'Test Lettings' and 'Test Lettings asda' (both under Kestrel,
   same email test@lettings.com, created 2 minutes apart) both show
   'Nothing similar found'."

   THE CAUSE IS NOT THE THRESHOLD, which is what the queue note guessed.
   The match only ever looked at rows with review_state = 'confirmed', and
   both of his agencies are pending: two records created two minutes apart
   are invisible to each other by construction. The name arms were already
   right -- containment has been tested in both directions since the
   function was written.

   WHICH MAKES IT THE WORST CASE AND NOT AN EDGE ONE: two rows arriving
   minutes apart is what a duplicate IS. */
begin;
select plan(8);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('dd100000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.ck.admin@opndoor.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('dd100000-0000-0000-0000-00000000c001','ZZZ CK Admin','zzz.ck.admin@opndoor.test',
        'superadmin', null,'active',true);

insert into public.partners (id, slug, name, status, partner_kind, referencing_mode, partner_rate, agent_rate)
values ('dd100000-0000-0000-0000-00000000f001'::uuid, 'zzz-ck-supplier', 'ZZZ CK Supplier',
        'active', 'supplier', 'pre_referenced_open', 0.2, 0.1);

/* HIS PAIR, AS HE MADE IT: both pending, one name inside the other, under
   one supplier, minutes apart. */
insert into public.agencies (id, name, partner_id, review_state, livemode) values
  ('dd100000-0000-0000-0000-00000000f0a1'::uuid, 'ZZZ CK Lettings',
   'dd100000-0000-0000-0000-00000000f001'::uuid, 'pending_review', true),
  ('dd100000-0000-0000-0000-00000000f0a2'::uuid, 'ZZZ CK Lettings asdah',
   'dd100000-0000-0000-0000-00000000f001'::uuid, 'pending_review', true),
/* AND A THIRD THAT SHARES ONLY AN EMAIL, to prove the arm Matt named
   first works on its own: no name in common at all. */
  ('dd100000-0000-0000-0000-00000000f0a3'::uuid, 'ZZZ Quite Different Ltd',
   'dd100000-0000-0000-0000-00000000f001'::uuid, 'pending_review', true),
  ('dd100000-0000-0000-0000-00000000f0a4'::uuid, 'ZZZ Also Different Ltd',
   'dd100000-0000-0000-0000-00000000f001'::uuid, 'confirmed', true);

insert into public.agent_contacts (agency_id, name, email, is_primary) values
  ('dd100000-0000-0000-0000-00000000f0a3'::uuid, 'Shared Inbox', 'zzz.shared@lettings.test', true),
  ('dd100000-0000-0000-0000-00000000f0a4'::uuid, 'Shared Inbox', 'ZZZ.Shared@Lettings.TEST', true);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"dd100000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);

-- ===========================================================================
-- 1. THE PAIR MATT REPORTED, BOTH WAYS ROUND.
-- ===========================================================================
select is(
  (select match_name from public.reconciliation_queue() where entity_id = 'dd100000-0000-0000-0000-00000000f0a1'),
  'ZZZ CK Lettings asdah',
  'the shorter name finds the longer one');

select is(
  (select match_name from public.reconciliation_queue() where entity_id = 'dd100000-0000-0000-0000-00000000f0a2'),
  'ZZZ CK Lettings',
  'and the longer finds the shorter');

select is(
  (select match_reason from public.reconciliation_queue() where entity_id = 'dd100000-0000-0000-0000-00000000f0a1'),
  'one name contains the other',
  'and says what it matched on');

/* THE REVIEWER IS TOLD THE MATCH IS ALSO WAITING, because merging two new
   records is a different act from merging into the book. */
select is(
  (select match_pending from public.reconciliation_queue() where entity_id = 'dd100000-0000-0000-0000-00000000f0a1'),
  true,
  'and that the match is itself a new record');

/* THE ID, so the screen can offer a verb rather than only a warning. */
select is(
  (select match_id from public.reconciliation_queue() where entity_id = 'dd100000-0000-0000-0000-00000000f0a1'),
  'dd100000-0000-0000-0000-00000000f0a2'::uuid,
  'and which record it is');

-- ===========================================================================
-- 2. THE EMAIL ARM, ON TWO NAMES WITH NOTHING IN COMMON.
-- ===========================================================================
/* CASE IGNORED, because the two were typed by a person into two forms.
   Surrounding space cannot occur: agent_contacts_email_valid refuses it
   outright, which this test found by trying. */
select is(
  (select match_name from public.reconciliation_queue() where entity_id = 'dd100000-0000-0000-0000-00000000f0a3'),
  'ZZZ Also Different Ltd',
  'a shared contact email matches on its own');

select is(
  (select match_reason from public.reconciliation_queue() where entity_id = 'dd100000-0000-0000-0000-00000000f0a3'),
  'same contact email',
  'and says so, which a reader could not have seen for themselves');

-- ===========================================================================
-- 3. AND NO EMAIL IS NOT A SHARED EMAIL.
-- ===========================================================================
/* THE TRAP IN A RULE LIKE THIS, and the reason it is worth a test: most
   agencies on dev have no contact at all. agent_contacts.email is NOT NULL
   and constrained to a valid address -- this test found both by trying to
   insert a blank one -- so "no email" means no contact ROW, and the join
   has to find nothing rather than match two absences. */
insert into public.agencies (id, name, partner_id, review_state, livemode) values
  ('dd100000-0000-0000-0000-00000000f0b1'::uuid, 'Marchmont Residential',
   'dd100000-0000-0000-0000-00000000f001'::uuid, 'pending_review', true),
  ('dd100000-0000-0000-0000-00000000f0b2'::uuid, 'Pevensey Holdings',
   'dd100000-0000-0000-0000-00000000f001'::uuid, 'confirmed', true);

select is(
  (select match_name from public.reconciliation_queue() where entity_id = 'dd100000-0000-0000-0000-00000000f0b1'),
  null,
  'two organisations with no contact and no name in common do not match');

select * from finish();
rollback;
