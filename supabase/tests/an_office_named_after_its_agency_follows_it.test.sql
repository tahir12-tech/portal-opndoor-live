-- AN OFFICE NAMED AFTER ITS AGENCY FOLLOWS THE RENAME. A NAME A PERSON
-- TYPED NEVER DOES.
--
-- Matt (dn), then (dq): "an office whose name was derived from its
-- agency follows a rename; a name a person typed is never changed."
--
-- THE PROVENANCE WAS MEASURED BEFORE THIS WAS BUILT. Test Lettings
-- asda's office carries created_by NULL and a created_at identical to
-- its agency's to the microsecond: one write, no person, the name
-- taken from the agency. That is the case this is for.
--
-- TWO SHAPES COUNT AS DERIVED and no others: the office named exactly
-- after its agency, and the auto "<Agency>, Head office" the referral
-- form writes. The third test below is the one that matters most --
-- an office somebody named is left alone, because renaming it would
-- be this function editing a fact it was never given.

begin;
select plan(7);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled,
                             api_access_enabled, partner_kind)
values ('d3000000-0000-0000-0000-00000000ff01','zzz-rn-supplier','ZZZ RN Supplier',
        'pre_referenced_open', 0.30, 0.10, false, false, true, true, 'supplier');

insert into public.agencies (id, partner_id, name, review_state)
values ('d3000000-0000-0000-0000-00000000aa01','d3000000-0000-0000-0000-00000000ff01','Zedco Lettings','confirmed');

insert into public.agent_contacts (agency_id, partner_id, name, email, is_primary)
values ('d3000000-0000-0000-0000-00000000aa01','d3000000-0000-0000-0000-00000000ff01','Zedco','deeds@zedco.test',true);

insert into public.branches (id, agency_id, partner_id, name, review_state) values
  -- DERIVED: named exactly after the agency.
  ('d3000000-0000-0000-0000-00000000bb01','d3000000-0000-0000-0000-00000000aa01','d3000000-0000-0000-0000-00000000ff01','Zedco Lettings','confirmed'),
  -- DERIVED: the auto one the referral form writes.
  ('d3000000-0000-0000-0000-00000000bb02','d3000000-0000-0000-0000-00000000aa01','d3000000-0000-0000-0000-00000000ff01','Zedco Lettings, Head office','confirmed'),
  -- TYPED BY A PERSON. The one that must not move.
  ('d3000000-0000-0000-0000-00000000bb03','d3000000-0000-0000-0000-00000000aa01','d3000000-0000-0000-0000-00000000ff01','Battersea','confirmed');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('d3000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.rn.mgmt@s.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('d3000000-0000-0000-0000-00000000c001','ZZZ RN Manager','zzz.rn.mgmt@s.test','management',
        'd3000000-0000-0000-0000-00000000ff01','active',true);

select set_config('request.jwt.claims',
  '{"sub":"d3000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.set_agency_details('d3000000-0000-0000-0000-00000000aa01','Zedco Lettings Group',null,'deeds@zedco.test')$$,
  'a supplier''s management may rename its own agency');
reset role;

-- ===========================================================================
-- 2-3. THE DERIVED NAMES FOLLOW.
-- ===========================================================================
select is(
  (select name from public.branches where id = 'd3000000-0000-0000-0000-00000000bb01'),
  'Zedco Lettings Group',
  'an office named exactly after its agency follows the rename');

select is(
  (select name from public.branches where id = 'd3000000-0000-0000-0000-00000000bb02'),
  'Zedco Lettings Group, Head office',
  'and so does the auto "<Agency>, Head office" the referral form writes');

-- ===========================================================================
-- 4. AND THE ONE A PERSON TYPED DOES NOT. The whole boundary Matt drew.
-- ===========================================================================
select is(
  (select name from public.branches where id = 'd3000000-0000-0000-0000-00000000bb03'),
  'Battersea',
  'while an office somebody named is left exactly as they named it');

-- ===========================================================================
-- 5-6. EACH MOVE IS ITS OWN LINE IN Recent changes, because a reader
--      should see that their office name moved rather than infer it
--      from the agency's line.
-- ===========================================================================
select is(
  (select count(*) from public.org_audit
    where entity_type = 'branch' and action = 'renamed'
      and entity_id in ('d3000000-0000-0000-0000-00000000bb01','d3000000-0000-0000-0000-00000000bb02')),
  2::bigint,
  'both office renames are recorded separately');

select ok(
  exists (select 1 from public.org_audit
           where entity_id = 'd3000000-0000-0000-0000-00000000bb01'
             and detail like '%named after the agency%'),
  'and the line says WHY it moved, which is the only surprising part');

-- ===========================================================================
-- 7. A RENAME THAT CHANGES NOTHING MOVES NO OFFICE. Saving the form
--    without touching the name must not rewrite anything.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"d3000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select public.set_agency_details('d3000000-0000-0000-0000-00000000aa01','Zedco Lettings Group','1 Zed St','deeds@zedco.test');
reset role;
select is(
  (select count(*) from public.org_audit
    where entity_type = 'branch' and action = 'renamed'
      and entity_id in ('d3000000-0000-0000-0000-00000000bb01','d3000000-0000-0000-0000-00000000bb02')),
  2::bigint,
  'and saving the form without changing the name renames nothing again');

select * from finish();
rollback;
