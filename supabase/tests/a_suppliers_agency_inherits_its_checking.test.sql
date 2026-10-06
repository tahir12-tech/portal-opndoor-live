/* AN AGENCY IN A SUPPLIER'S ESTATE INHERITS THE SUPPLIER'S CHECKING SETTING.
   Migration: 20261008050000.

   THE BLOCKER: a Kestrel referral sent its tenant opndoor's full application
   email, asking for three years of address history, income and documents,
   under an arrangement where opndoor checks nothing.

   resolve_referencing_mode is coalesce(agency's mode, partner's mode), and
   agencies.referencing_mode was NOT NULL DEFAULT 'opndoor_referenced'. Every
   agency had always "said", so the second arm of that coalesce was
   unreachable code and no supplier setting had ever been inherited. */
begin;
select plan(8);

insert into public.partners (id, slug, name, referencing_mode, is_house_route,
                             status, partner_kind)
values ('e4400000-0000-0000-0000-00000000f001','zzz-inherit-sup','ZZZ Inherit Supplier',
        'pre_referenced_open', false, 'active', 'supplier'),
       ('e4400000-0000-0000-0000-00000000f002','zzz-inherit-own','ZZZ Our Own',
        'opndoor_referenced', false, 'active', 'agency');

-- ===========================================================================
-- 1. A NEW AGENCY UNDER A SUPPLIER INHERITS, which is the creation path.
-- ===========================================================================
insert into public.agencies (id, partner_id, name) values
  ('e4400000-0000-0000-0000-00000000a001','e4400000-0000-0000-0000-00000000f001','ZZZ Inheriting Agency');

select is(
  (select referencing_mode from public.agencies where id='e4400000-0000-0000-0000-00000000a001'),
  null,
  'an agency created with no opinion has none, rather than being given one');

insert into public.branches (id, agency_id, partner_id, name) values
  ('e4400000-0000-0000-0000-00000000b001','e4400000-0000-0000-0000-00000000a001',
   'e4400000-0000-0000-0000-00000000f001','ZZZ Inheriting Office');

select is(
  public.resolve_referencing_mode('e4400000-0000-0000-0000-00000000b001',
                                  'e4400000-0000-0000-0000-00000000f001'),
  'pre_referenced_open',
  'and a referral through it follows the supplier, not opndoor''s default');

/* THE DEFAULT IS GONE, asserted directly: this is what made every creation
   path set a mode without any of them mentioning the column. */
select is(
  (select column_default from information_schema.columns
    where table_schema='public' and table_name='agencies' and column_name='referencing_mode'),
  null,
  'the column has no default, so no creation path can give one by accident');

-- ===========================================================================
-- 2. AN AGENCY THAT HAS DECIDED STILL OVERRIDES, which is the whole reason
--    the column exists and must not be lost in fixing the default.
-- ===========================================================================
update public.agencies set referencing_mode = 'opndoor_referenced'
 where id = 'e4400000-0000-0000-0000-00000000a001';
select is(
  public.resolve_referencing_mode('e4400000-0000-0000-0000-00000000b001',
                                  'e4400000-0000-0000-0000-00000000f001'),
  'opndoor_referenced',
  'an agency with its own setting still overrides its supplier');
update public.agencies set referencing_mode = null
 where id = 'e4400000-0000-0000-0000-00000000a001';

-- ===========================================================================
-- 3. OUR OWN ESTATE KEEPS ITS SETTINGS. Matt: "Your own agencies keep their
--    own settings." The data statement is scoped to supplier estates.
-- ===========================================================================
insert into public.agencies (id, partner_id, name, referencing_mode) values
  ('e4400000-0000-0000-0000-00000000a002','e4400000-0000-0000-0000-00000000f002',
   'ZZZ Our Own Agency','opndoor_referenced');
select is(
  (select referencing_mode from public.agencies where id='e4400000-0000-0000-0000-00000000a002'),
  'opndoor_referenced',
  'an agency on our own estate keeps the setting it was given');

-- ===========================================================================
-- 4. THE EXCEPTION RULE, which is the careful half of Matt's instruction:
--    a deliberate setting is spared and reported, never overwritten.
-- ===========================================================================
insert into public.agencies (id, partner_id, name, referencing_mode) values
  ('e4400000-0000-0000-0000-00000000a003','e4400000-0000-0000-0000-00000000f001',
   'ZZZ Deliberate Agency','opndoor_referenced');
insert into public.org_audit (entity_type, entity_id, action, detail, actor)
values ('agency','e4400000-0000-0000-0000-00000000a003','tenant_check_changed',
        'Agency has already referenced them -> Opndoor checks eligibility','A Human');

/* RE-RUN THE MIGRATION'S OWN STATEMENT. Re-running it is the test: it must
   be safe to apply twice and must spare the audited one both times. */
update public.agencies a
   set referencing_mode = null
 where exists (select 1 from public.partners p
                where p.id = a.partner_id and p.partner_kind = 'supplier')
   and a.referencing_mode is not null
   and not exists (select 1 from public.org_audit o
                    where o.entity_type = 'agency' and o.entity_id = a.id
                      and o.action = 'tenant_check_changed');

select is(
  (select referencing_mode from public.agencies where id='e4400000-0000-0000-0000-00000000a003'),
  'opndoor_referenced',
  'an agency whose setting was deliberately changed is spared');

select is(
  (select referencing_mode from public.agencies where id='e4400000-0000-0000-0000-00000000a001'),
  null,
  'and one that was never touched still inherits');

/* AND NOTHING ON OUR OWN ESTATE WAS CAUGHT BY IT, which the scope clause is
   for: an opndoor-agents agency has no supplier to inherit from, so nulling
   it would make resolve_referencing_mode fall through to the house route. */
select is(
  (select referencing_mode from public.agencies where id='e4400000-0000-0000-0000-00000000a002'),
  'opndoor_referenced',
  'and our own estate was outside the statement entirely');

select * from finish();
rollback;
