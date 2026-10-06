/* THE ESTATE DECIDES WHO MAY ADD AN AGENCY, NOT WHO OWNS THE STOCK.
   Migration: 20261008040000.

   Matt, 2026-10-04: Kestrel Management's New application form offered no way
   to add an agency and said "A new agency is set up by opndoor, not here",
   though the feature was built and deployed.

   NONE OF THE THREE CAUSES HE OFFERED. my_org_shape computed
   `may_add_agency := not refers_own_stock`, and that column's own comment
   says "Ownership only. Never a permission." Kestrel owns stock it refers
   AND holds an estate of agencies it does not own, so the one boolean
   answered the ownership question and the form read it as the permission
   one. */
begin;
select plan(6);

/* A SUPPLIER THAT ALSO OWNS STOCK, which is Kestrel's shape and the only
   shape that shows the fault. */
insert into public.partners (id, slug, name, referencing_mode, is_house_route,
                             status, partner_kind, refers_own_stock)
values ('e3300000-0000-0000-0000-00000000f001','zzz-own-sup','ZZZ Own-Stock Supplier',
        'pre_referenced_open', false, 'active', 'supplier', true),
/* AND ONE THAT DOES NOT, so the assertion below distinguishes the estate
   from the ownership rather than passing on either. */
       ('e3300000-0000-0000-0000-00000000f002','zzz-plain-sup','ZZZ Plain Supplier',
        'pre_referenced_open', false, 'active', 'supplier', false);

insert into public.agencies (id, partner_id, name) values
  ('e3300000-0000-0000-0000-00000000a001','e3300000-0000-0000-0000-00000000f001','ZZZ Owned Agency'),
  ('e3300000-0000-0000-0000-00000000a002','e3300000-0000-0000-0000-00000000f002','ZZZ Plain Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('e3300000-0000-0000-0000-00000000b001','e3300000-0000-0000-0000-00000000a001',
   'e3300000-0000-0000-0000-00000000f001','ZZZ Owned Office'),
  ('e3300000-0000-0000-0000-00000000b002','e3300000-0000-0000-0000-00000000a002',
   'e3300000-0000-0000-0000-00000000f002','ZZZ Plain Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('e3300000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.ownsup@opndoor.test','',now(),now(),now()),
       ('e3300000-0000-0000-0000-00000000c002','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.ownref@opndoor.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('e3300000-0000-0000-0000-00000000c001','ZZZ Own Mgmt','zzz.ownsup@opndoor.test','management',
   'e3300000-0000-0000-0000-00000000f001','active',true),
  ('e3300000-0000-0000-0000-00000000c002','ZZZ Own Referrer','zzz.ownref@opndoor.test','referrer',
   'e3300000-0000-0000-0000-00000000f001','active',false);

set local role authenticated;

-- ===========================================================================
-- THE REPORTED CASE: a supplier that owns stock may still add an agency.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"e3300000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
select is((select may_add_agency from public.my_org_shape(null)), true,
  'supplier Management may add an agency even though the partner owns stock');

/* AND THE OWNERSHIP FLAG IS UNTOUCHED, which is the point of the fix: the
   two facts are now separate rather than one standing in for the other. */
select is((select refers_own_stock from public.my_org_shape(null)), true,
  'and the ownership flag still says what it says');

/* A REFERRER TOO. Matt's proof asks for both levels, and the add route on
   the referral form is not a management-only act. */
select set_config('request.jwt.claims',
  '{"sub":"e3300000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
select is((select may_add_agency from public.my_org_shape(null)), true,
  'and so may a supplier Referrer');

-- ===========================================================================
-- THE SET IS THE ESTATE, NOT THE OWNERSHIP.
-- ===========================================================================
reset role;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('e3300000-0000-0000-0000-00000000c003','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.plain@opndoor.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('e3300000-0000-0000-0000-00000000c003','ZZZ Plain Mgmt','zzz.plain@opndoor.test','management',
   'e3300000-0000-0000-0000-00000000f002','active',true);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"e3300000-0000-0000-0000-00000000c003","role":"authenticated","aal":"aal2"}', true);
select is((select may_add_agency from public.my_org_shape(null)), true,
  'a supplier that owns nothing may add, as before');

reset role;
/* OUR OWN ESTATE STILL MAY NOT, which is the regression that matters: the
   plain-select form exists because agencies_insert refuses these people in
   SQL, and a form offering what the database refuses is worse than one that
   explains why not. */
select is(
  (select public.is_supplier_estate(id) from public.partners where slug='opndoor-agents'),
  false,
  'our own estate is not a supplier estate, so its people still may not add');

/* AND A HOUSE ROUTE MAY NOT EITHER, which this fix TIGHTENED: it read
   `not refers_own_stock` and so answered true for opndoor-direct, where a
   signup is one tenant applying for themselves and there is no staff
   referrer to add anything. */
select is(
  (select public.is_supplier_estate(id) from public.partners where slug='opndoor-direct'),
  false,
  'and neither may the direct rail, which used to answer true');

select * from finish();
rollback;
