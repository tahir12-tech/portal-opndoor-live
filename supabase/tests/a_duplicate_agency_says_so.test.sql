-- A DUPLICATE AGENCY SAYS SO, RATHER THAN "SOMETHING WENT WRONG".
--
-- Matt, 2026-10-03: "adding an agency whose name already exists in that
-- supplier's estate (e.g. 'Frost Partnership' under Kestrel) fails with the
-- generic 'Something went wrong saving that change.' Show the real reason
-- inside the form, next to the name."
--
-- THE GENERIC MESSAGE WAS NOT THE BUG. `cleanRpcError` replaces anything that
-- reads like a database internal -- tuple, constraint, duplicate key -- with a
-- safe sentence, and that is right: #67 exists because a Postgres error once
-- reached a user. The bug was that this RPC left a reason it knew perfectly
-- well to be discovered by a unique index, so there was nothing for the client
-- to show but the fallback.
--
-- BOTH HALVES ARE ASSERTED. A pre-check for the readable case and the
-- case-insensitive near-duplicate the index does not catch, and an
-- `exception when unique_violation` for the race the pre-check cannot see --
-- the shape `create_agency_group` has had since it was written.

begin;
select plan(6);

-- NAMED ARGUMENTS THROUGHOUT. This function takes ten positional parameters
-- with two numerics in the middle, and the first draft of this file passed
-- the branch address where p_partner_rate goes: "invalid input syntax for
-- type numeric: '2 ZZZ Street'". Named arguments cannot be put in the wrong
-- order, and a test that fails for the wrong reason proves nothing.

insert into public.partners (id, slug, name, referencing_mode, is_house_route, partner_kind,
                             partner_rate, agent_rate)
values ('9e000000-0000-0000-0000-0000000000a1','zzz-dup-sup','ZZZ Dup Supplier',
        'pre_referenced_open', false, 'supplier', 0.25, 0.10);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('9e000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.dup.admin@o.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('9e000000-0000-0000-0000-0000000000a2','ZZZ Dup Admin','zzz.dup.admin@o.test',
        'superadmin', null, 'active', true);

select set_config('request.jwt.claims',
  '{"sub":"9e000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ===========================================================================
-- 1. THE FIRST ONE IS CREATED
-- ===========================================================================
select lives_ok(
  $$select public.admin_create_agency_and_branch(
      p_partner_slug  => 'zzz-dup-sup',
      p_agency_name   => 'Frost Partnership',
      p_branch_name   => 'Frost Mayfair',
      p_branch_area   => '1 ZZZ Street',
      p_agency_email  => 'frost@zzz.test',
      p_partner_rate  => 0.25,
      p_agent_rate    => 0.10,
      p_group_id      => null)$$,
  'the first agency of that name is created');

select is(
  (select count(*)::int from public.agencies a
     where a.partner_id = '9e000000-0000-0000-0000-0000000000a1'
       and a.name = 'Frost Partnership'),
  1, 'and there is exactly one of it');

-- ===========================================================================
-- 2. THE SECOND ONE SAYS WHY, NAMING BOTH THE SUPPLIER AND THE AGENCY
-- ===========================================================================
select throws_ok(
  $$select public.admin_create_agency_and_branch(
      p_partner_slug  => 'zzz-dup-sup',
      p_agency_name   => 'Frost Partnership',
      p_branch_name   => 'Frost Soho',
      p_branch_area   => '2 ZZZ Street',
      p_agency_email  => 'frost2@zzz.test',
      p_partner_rate  => 0.25,
      p_agent_rate    => 0.10,
      p_group_id      => null)$$,
  '23505', 'ZZZ Dup Supplier already has an agency called Frost Partnership.',
  'a duplicate names the supplier and the agency, rather than "something went wrong"');

/* THE WORDS MATTER AS MUCH AS THE REFUSAL. The client renders this sentence
   beside the name field and appends "Open it instead?" as a link, so a
   message that said only "duplicate" would leave the form with nothing to
   show. */
select throws_ok(
  $$select public.admin_create_agency_and_branch(
      p_partner_slug  => 'zzz-dup-sup',
      p_agency_name   => 'Frost Partnership',
      p_branch_name   => 'Frost Soho',
      p_branch_area   => '2 ZZZ Street',
      p_agency_email  => 'frost2@zzz.test',
      p_partner_rate  => 0.25,
      p_agent_rate    => 0.10,
      p_group_id      => null)$$,
  '23505', 'ZZZ Dup Supplier already has an agency called Frost Partnership.',
  'and says it the same way every time, because the form reads it');

-- ===========================================================================
-- 3. CASE-INSENSITIVE, WHICH THE INDEX IS NOT
--
-- unique (partner_id, name) would admit "frost partnership" beside "Frost
-- Partnership". An estate holding both is the mistake this message exists to
-- prevent, so the pre-check is deliberately stricter than the constraint.
-- ===========================================================================
select throws_ok(
  $$select public.admin_create_agency_and_branch(
      p_partner_slug  => 'zzz-dup-sup',
      p_agency_name   => 'frost partnership',
      p_branch_name   => 'Frost Soho',
      p_branch_area   => '2 ZZZ Street',
      p_agency_email  => 'frost2@zzz.test',
      p_partner_rate  => 0.25,
      p_agent_rate    => 0.10,
      p_group_id      => null)$$,
  '23505', 'ZZZ Dup Supplier already has an agency called frost partnership.',
  'a name differing only in case is refused too, which the unique index would allow');

-- ===========================================================================
-- 4. AND ANOTHER SUPPLIER MAY STILL USE THE NAME
--
-- The whole point of separate estates: two Frost Partnerships exist on dev,
-- one per estate, and this must not have made the second impossible.
-- ===========================================================================
reset role;
insert into public.partners (id, slug, name, referencing_mode, is_house_route, partner_kind,
                             partner_rate, agent_rate)
values ('9e000000-0000-0000-0000-0000000000a3','zzz-dup-sup-2','ZZZ Dup Supplier Two',
        'pre_referenced_open', false, 'supplier', 0.25, 0.10);
select set_config('request.jwt.claims',
  '{"sub":"9e000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.admin_create_agency_and_branch(
      p_partner_slug  => 'zzz-dup-sup-2',
      p_agency_name   => 'Frost Partnership',
      p_branch_name   => 'Frost Mayfair',
      p_branch_area   => '3 ZZZ Street',
      p_agency_email  => 'frost3@zzz.test',
      p_partner_rate  => 0.25,
      p_agent_rate    => 0.10,
      p_group_id      => null)$$,
  'and a DIFFERENT supplier may have an agency of the same name, which is the estates rule');

select * from finish();
rollback;
