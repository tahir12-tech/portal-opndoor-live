/* (cs) EVERY NAME, ADDRESS AND EMAIL CHANGE, WITH WHO MADE IT.
   Migration: 20261009050000.

   Matt: "Record every name, address and email change with who made it,
   e.g. 'Email changed from test@lettings.com to test2@lettings.com, by
   Matthew Dwyer'."

   MOST OF IT WAS ALREADY THERE after (dn), and his own edit proves it:
   org_audit on dev holds the rename and an email line, both actored
   "Matthew Dwyer". Two gaps were left and both are in his sentence: the
   email line did not say what it replaced, and the address was not
   recorded at all.

   AND IT IS A SUPPLIER'S MANAGEMENT DOING IT, not an admin, because that
   is who he was: the function's own reach test admits them for an agency
   in their estate, and Recent changes is where they read it back. */
begin;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('cf100000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.cs.mgmt@supplier.test','',now(),now(),now());

insert into public.partners (id, slug, name, status, partner_kind, referencing_mode, partner_rate, agent_rate)
values ('cf100000-0000-0000-0000-00000000f001'::uuid, 'zzz-cs-supplier', 'ZZZ CS Supplier',
        'active', 'supplier', 'pre_referenced_open', 0.2, 0.1);
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('cf100000-0000-0000-0000-00000000c001','ZZZ CS Manager','zzz.cs.mgmt@supplier.test',
        'management', 'cf100000-0000-0000-0000-00000000f001'::uuid,'active',true);

insert into public.agencies (id, name, partner_id, review_state, livemode, address) values
  ('cf100000-0000-0000-0000-00000000f0a1'::uuid, 'ZZZ CS Lettings',
   'cf100000-0000-0000-0000-00000000f001'::uuid, 'confirmed', true, '1 Old Street');
insert into public.agent_contacts (agency_id, partner_id, name, email, is_primary) values
  ('cf100000-0000-0000-0000-00000000f0a1'::uuid, 'cf100000-0000-0000-0000-00000000f001'::uuid,
   'Office', 'before@lettings.test', true);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cf100000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);

-- ===========================================================================
-- 1. ALL THREE AT ONCE, BY A SUPPLIER'S MANAGEMENT.
-- ===========================================================================
select lives_ok(
  $$select public.set_agency_details('cf100000-0000-0000-0000-00000000f0a1',
      'ZZZ CS Lettings Group', '2 New Street', 'after@lettings.test')$$,
  'a supplier''s management may correct an agency in their own estate');

reset role;

select is(
  (select count(*)::int from public.org_audit
    where entity_id = 'cf100000-0000-0000-0000-00000000f0a1' and action = 'renamed'),
  1, 'the rename is recorded');

/* HIS EXAMPLE, TO THE WORD. "from X to Y" is the half that tells a
   correction from a mistake, and the old value was already in hand. */
select is(
  (select detail from public.org_audit
    where entity_id = 'cf100000-0000-0000-0000-00000000f0a1' and action = 'email_changed'),
  'Agency email changed from before@lettings.test to after@lettings.test, so signed deeds now go there',
  'the email line says what it changed FROM');

select is(
  (select detail from public.org_audit
    where entity_id = 'cf100000-0000-0000-0000-00000000f0a1' and action = 'address_changed'),
  'Address changed from 1 Old Street to 2 New Street',
  'and the address is recorded at all, which it was not');

select is(
  (select actor from public.org_audit
    where entity_id = 'cf100000-0000-0000-0000-00000000f0a1' and action = 'address_changed'),
  'ZZZ CS Manager',
  'with who made it');

-- ===========================================================================
-- 2. AND THE READER SEES IT WHERE HE LOOKED: Recent changes.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cf100000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);

select is(
  (select count(*)::int from public.agency_changes('cf100000-0000-0000-0000-00000000f0a1', 50)
    where action in ('renamed', 'email_changed', 'address_changed')),
  3,
  'all three reach Recent changes, read by the person who made them');

-- ===========================================================================
-- 3. A FIRST VALUE IS NOT A CHANGE FROM SOMETHING.
-- ===========================================================================
/* THE TRAP IN "from X to Y": where there was nothing, saying "from " and
   stopping is worse than the old wording. */
insert into public.agencies (id, name, partner_id, review_state, livemode) values
  ('cf100000-0000-0000-0000-00000000f0a2'::uuid, 'ZZZ CS Second',
   'cf100000-0000-0000-0000-00000000f001'::uuid, 'confirmed', true);

select lives_ok(
  $$select public.set_agency_details('cf100000-0000-0000-0000-00000000f0a2',
      'ZZZ CS Second', '9 First Street', 'first@lettings.test')$$,
  'an agency with nothing set can be given both');

reset role;

select is(
  (select detail from public.org_audit
    where entity_id = 'cf100000-0000-0000-0000-00000000f0a2' and action = 'email_changed'),
  'Agency email set to first@lettings.test, so signed deeds now go there',
  'a first email says "set to", not "changed from" nothing');

select is(
  (select detail from public.org_audit
    where entity_id = 'cf100000-0000-0000-0000-00000000f0a2' and action = 'address_changed'),
  'Address set to 9 First Street',
  'and a first address says the same');

select * from finish();
rollback;
