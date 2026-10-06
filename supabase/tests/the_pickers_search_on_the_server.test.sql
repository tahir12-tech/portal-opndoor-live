-- THE PICKERS SEARCH ON THE SERVER, AND SEE ONLY WHAT THEY MAY.
--
-- Matt (dg): "with a large supplier (Rightmove could have thousands of
-- agencies), don't list everything on click. Show 'Start typing an
-- agency name' with the 10 most recently used agencies for that
-- person, then search as they type (name, office or postcode),
-- returning the best 20 matches with 'Keep typing to narrow it down'
-- if there are more ... Make sure search is done on the server, not by
-- loading every agency into the page."
--
-- THE AUTHORISATION ORDER IS THE PART WORTH TESTING. It would be
-- faster to take the first 21 text matches and drop the unreachable
-- ones afterwards, and it would be wrong: if twenty of those belong to
-- another estate the reader is shown one result and told that is all
-- there is. So the limit is applied to rows they may SEE, and the test
-- below plants an unreachable match to prove it.
--
-- AND partner_id IS NOT THE AUTHORISATION TEST: every agency opndoor
-- onboards shares one house partner, so the partner argument scopes
-- the picker to a ROUTE and says nothing about who may see what.

begin;
select plan(14);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled,
                             api_access_enabled, partner_kind)
values ('d4000000-0000-0000-0000-00000000ff01','zzz-pk-supplier','ZZZ PK Supplier',
        'pre_referenced_open', 0.30, 0.10, false, false, true, true, 'supplier'),
       ('d4000000-0000-0000-0000-00000000ff02','zzz-pk-other','ZZZ PK Other',
        'pre_referenced_open', 0.30, 0.10, false, false, true, true, 'supplier');

insert into public.agencies (id, partner_id, name, address, review_state) values
  ('d4000000-0000-0000-0000-00000000aa01','d4000000-0000-0000-0000-00000000ff01','Zedbury Lettings','1 Zed Street, London ZZ1 1AA','confirmed'),
  ('d4000000-0000-0000-0000-00000000aa02','d4000000-0000-0000-0000-00000000ff01','North Zedbury','9 Far Road, Leeds ZZ9 9ZZ','confirmed'),
  ('d4000000-0000-0000-0000-00000000aa03','d4000000-0000-0000-0000-00000000ff01','Quayside Homes','4 Dock Lane, Bristol ZZ4 4QQ','confirmed'),
  -- ANOTHER SUPPLIER'S, matching the same word.
  ('d4000000-0000-0000-0000-00000000aa09','d4000000-0000-0000-0000-00000000ff02','Zedbury Elsewhere','7 Other Way, York ZZ7 7YY','confirmed');

insert into public.branches (id, agency_id, partner_id, name, address, review_state) values
  ('d4000000-0000-0000-0000-00000000bb01','d4000000-0000-0000-0000-00000000aa03','d4000000-0000-0000-0000-00000000ff01','Harbourmouth','12 Pier Road, Bristol ZZ4 4QQ','confirmed'),
  ('d4000000-0000-0000-0000-00000000bb02','d4000000-0000-0000-0000-00000000aa03','d4000000-0000-0000-0000-00000000ff01','Clifton','3 Hill Street, Bristol ZZ5 5CC','confirmed'),
  ('d4000000-0000-0000-0000-00000000bb03','d4000000-0000-0000-0000-00000000aa01','d4000000-0000-0000-0000-00000000ff01','Zedbury Central','1 Zed Street, London ZZ1 1AA','confirmed');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('d4000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.pk.admin@o.test','',now(),now(),now());
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('d4000000-0000-0000-0000-00000000c002','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.pk.supplier@o.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('d4000000-0000-0000-0000-00000000c001','ZZZ PK Admin','zzz.pk.admin@o.test','superadmin',null,'active',true),
       ('d4000000-0000-0000-0000-00000000c002','ZZZ PK Supplier User','zzz.pk.supplier@o.test','referrer','d4000000-0000-0000-0000-00000000ff01','active',false);

select set_config('request.jwt.claims',
  '{"sub":"d4000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ===========================================================================
-- 1-3. NAME, OFFICE AND POSTCODE -- Matt's three, each proved separately.
-- ===========================================================================
select is(
  (select array_agg(name order by name) from public.search_agencies_for_referral(
     'd4000000-0000-0000-0000-00000000ff01','zedbury', 20)),
  array['North Zedbury','Zedbury Lettings'],
  'a name match finds both, and only this route''s');

/* THE OFFICE ROUTE. "Harbourmouth" is a BRANCH of Quayside Homes and
   appears in no agency name, so finding Quayside by it is the whole
   point -- an agent types the office they know. */
select is(
  (select array_agg(name) from public.search_agencies_for_referral(
     'd4000000-0000-0000-0000-00000000ff01','harbourmouth', 20)),
  array['Quayside Homes'],
  'an office name finds the agency that holds it');

select is(
  (select array_agg(name) from public.search_agencies_for_referral(
     'd4000000-0000-0000-0000-00000000ff01','ZZ5 5CC', 20)),
  array['Quayside Homes'],
  'and a postcode does too, which lives inside the address');

-- ===========================================================================
-- 4. WHY IT MATCHED, because a postcode search returning bare agency
--    names is a list the reader cannot check.
-- ===========================================================================
select is(
  (select matched_on from public.search_agencies_for_referral(
     'd4000000-0000-0000-0000-00000000ff01','harbourmouth', 20)),
  'office',
  'and the row says the match was on an office');

-- ===========================================================================
-- 5. THE PREFIX RANKS ABOVE THE CONTAINMENT. "Zedbury Lettings" starts
--    with it; "North Zedbury" merely contains it.
-- ===========================================================================
select is(
  (select name from public.search_agencies_for_referral(
     'd4000000-0000-0000-0000-00000000ff01','zedbury', 20) limit 1),
  'Zedbury Lettings',
  'the agency whose name STARTS with it comes first');

-- ===========================================================================
-- 6. ANOTHER SUPPLIER'S AGENCY NEVER APPEARS, even matching the word.
-- ===========================================================================
select ok(
  not exists (select 1 from public.search_agencies_for_referral(
    'd4000000-0000-0000-0000-00000000ff01','zedbury', 20) where name = 'Zedbury Elsewhere'),
  'and another route''s agency is not in this route''s picker');

select is(
  (select partner_slug from public.search_agencies_for_referral(
     null,'zedbury', 20) where name = 'Zedbury Elsewhere'),
  'zzz-pk-other',
  'all-route search returns an agency only with its owning route');

select is(
  (select partner_slug from public.search_agencies_for_referral(
     null,'zedbury', 20) where name = 'Zedbury Lettings'),
  'zzz-pk-supplier',
  'same-name search results retain their distinct estate');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"d4000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select ok(
  not exists (select 1 from public.search_agencies_for_referral(
    null,'zedbury', 20) where partner_slug = 'zzz-pk-other'),
  'all-route search still limits a supplier user to their own reachable estate');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"d4000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ===========================================================================
-- 7. ONE CHARACTER ASKS NOTHING. A single letter matches most of the
--    book and is a scan dressed up as a search.
-- ===========================================================================
select is(
  (select count(*) from public.search_agencies_for_referral(
     'd4000000-0000-0000-0000-00000000ff01','z', 20)),
  0::bigint,
  'one character returns nothing rather than most of the estate');

-- ===========================================================================
-- 8. ONE MORE THAN ASKED FOR, which is how the screen knows to say
--    "Keep typing to narrow it down" without counting the set twice.
-- ===========================================================================
select is(
  (select count(*) from public.search_agencies_for_referral(
     'd4000000-0000-0000-0000-00000000ff01','zedbury', 1)),
  2::bigint,
  'a limit of one returns two, so the caller can tell there are more');

-- ===========================================================================
-- 9. OFFICES WITHIN ONE AGENCY, where an empty query IS allowed: that
--    list is bounded by the agency, where the agency list is bounded by
--    the supplier and is the thing that can be thousands.
-- ===========================================================================
select is(
  (select array_agg(name order by name) from public.search_branches_for_referral(
     'd4000000-0000-0000-0000-00000000aa03','', 20)),
  array['Clifton','Harbourmouth'],
  'an office list opens without a query, because it is bounded already');

-- ===========================================================================
-- 10-11. THE EMPTY STATE: the ten this PERSON last referred for.
--
--        Matt: "the 10 most recently used agencies for that person".
--        Not the estate's busiest and not the ones they can reach --
--        the ones they have actually used, newest first, which is the
--        only list that is useful before a key is pressed.
-- ===========================================================================
reset role;
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id, status,
   tenant_title, tenant_first_name, tenant_last_name, tenant_email, tenant_phone,
   tenant_dob, prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start,
   partner_rate, agent_rate, referencing_mode, created_at)
select v.id, v.ref,'d4000000-0000-0000-0000-00000000ff01', v.ag, v.br,
       'd4000000-0000-0000-0000-00000000c001','sent',
       'Mr','ZZZ','Tenant', v.ref || '@t.test','07700 900000',
       '1990-01-01','1 ZZZ Street','London','SW1A 1AA', 1000, '2026-11-01',
       0.25, 0.10, 'pre_referenced_open', v.at
from (values
  ('d4000000-0000-0000-0000-00000000dd01'::uuid,'GR-ZZZ-PK1','d4000000-0000-0000-0000-00000000aa01'::uuid,'d4000000-0000-0000-0000-00000000bb03'::uuid, now() - interval '9 days'),
  ('d4000000-0000-0000-0000-00000000dd02'::uuid,'GR-ZZZ-PK2','d4000000-0000-0000-0000-00000000aa03'::uuid,'d4000000-0000-0000-0000-00000000bb01'::uuid, now() - interval '1 day')
) as v(id, ref, ag, br, at);

select set_config('request.jwt.claims',
  '{"sub":"d4000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is(
  (select array_agg(name) from public.recent_agencies_for_referral(
     'd4000000-0000-0000-0000-00000000ff01', 10)),
  array['Quayside Homes','Zedbury Lettings'],
  'the agencies this person referred for, most recent first');

/* AND NOT THE ONE THEY HAVE NEVER USED. North Zedbury is reachable,
   is on this route and matches a search -- and has no referral behind
   it, so it is not RECENT. A list of "everything you could pick"
   would be the whole-book load this item exists to stop. */
select ok(
  not exists (select 1 from public.recent_agencies_for_referral(
    'd4000000-0000-0000-0000-00000000ff01', 10) where name = 'North Zedbury'),
  'and not one they have never referred for');

reset role;
select * from finish();
rollback;
