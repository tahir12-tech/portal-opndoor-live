-- ===========================================================================
-- ROUND 6, THE LOWS THAT WERE STILL OPEN. 20261007000000.
--
-- Three fixes, each asserted against the thing it was actually wrong about
-- rather than against the shape of the fix.
--
-- 1. THE SECOND FACTOR ON THREE TABLES 20261006780000 MISSED. That migration
--    was written for backlog B8, whose sentence names
--    partner_agency_relationships, and gave the policy to nine other tables
--    instead. The list here was DERIVED from a clean apply rather than taken
--    from the finding: of 69 tables with RLS on, most have no policy at all
--    (deny by default, correct, nothing to add), and exactly three had a
--    permissive policy and no second-factor requirement.
--
--    The last assertion is the one that matters most, and it is a LIST rather
--    than three names: any table that has a permissive policy and no
--    require_aal2 fails it. That is what stops a fourth appearing the way
--    these three did.
--
-- 2. detach_user_from_agency asked one fewer question than attach.
-- 3. set_branch_deed_recipient called the house partner "this organisation".
-- ===========================================================================

begin;
select plan(9);

-- ---------------------------------------------------------------------------
-- 1. THE SECOND FACTOR
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'partner_agency_relationships'
      and policyname = 'require_aal2' and permissive = 'RESTRICTIVE'),
  1, 'partner_agency_relationships now requires the second factor, which B8 asked for and did not get');

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'branch_deed_recipient'
      and policyname = 'require_aal2' and permissive = 'RESTRICTIVE'),
  1, 'and so does branch_deed_recipient, which says who receives an agency''s deeds');

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'view_as_audit'
      and policyname = 'require_aal2' and permissive = 'RESTRICTIVE'),
  1, 'and view_as_audit, where reading the record of who looked at whom needed no step-up');

-- RESTRICTIVE, NOT PERMISSIVE. A permissive policy of the same name would
-- WIDEN access rather than narrow it: it would grant every AAL2 session a
-- read the other policies were meant to decide.
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and policyname = 'require_aal2' and permissive <> 'RESTRICTIVE'),
  0, 'and every require_aal2 in the schema is restrictive, so none of them widens anything');

-- THE LIST, which is what stops a fourth. A table with a permissive policy
-- and no require_aal2 is readable by a password-only session.
select is_empty($$
  select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     and exists (select 1 from pg_policies p
                  where p.schemaname = 'public' and p.tablename = c.relname
                    and p.permissive = 'PERMISSIVE')
     and not exists (select 1 from pg_policies p
                      where p.schemaname = 'public' and p.tablename = c.relname
                        and p.policyname = 'require_aal2')
$$, 'no table anywhere has a permissive policy without a second-factor requirement');

-- ---------------------------------------------------------------------------
-- 2. DETACHING IS AS MUCH A STATEMENT ABOUT THE BRAND AS ATTACHING
--
-- Asserted on the SOURCE of the two functions rather than by calling them,
-- and the reason is worth stating: the defect is an ASYMMETRY between twins,
-- so the assertion that catches it is one that compares them. A behavioural
-- test of detach alone would have passed for as long as the asymmetry
-- existed, because detach did exactly what it was written to do.
--
-- COMMENTS ARE STRIPPED FIRST, via body() below, and that is not tidiness.
-- pg_get_functiondef returns the comments too, and the house style is to
-- write into a fix exactly what the old code said -- so the first version of
-- assertion 8 failed against a correct function because the comment
-- explaining the fix quoted the expression the fix removed. Any assertion
-- that greps a function body has to read the code, not the prose about it.
-- ---------------------------------------------------------------------------

-- The executable text of a function in public, with SQL comments removed.
create or replace function pg_temp.body(p_name text) returns text language sql stable as $fn$
  select regexp_replace(
           regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', ' ', 'gs'),
           '--[^\n]*', ' ', 'g')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = p_name;
$fn$;

select ok(
  pg_temp.body('detach_user_from_agency') like '%user_scopes%'
    and pg_temp.body('detach_user_from_agency') like '%group%',
  'detach_user_from_agency now asks for a group or agency position, as attach always did');

select ok(
  (pg_temp.body('attach_user_to_agency')   like '%kind in (''group'',''agency'')%')
  = (pg_temp.body('detach_user_from_agency') like '%kind in (''group'',''agency'')%'),
  'and the two twins now ask the same question, which is the defect rather than either one alone');

-- ---------------------------------------------------------------------------
-- 3. "THIS ORGANISATION" IS NOT "THIS PARTNER" ON THE AGENCY RAIL
-- ---------------------------------------------------------------------------

-- The partner comparison is gone. It read `v_user_partner <> v_partner`,
-- which on the agency rail compares every agency against the one house
-- partner they all share, so it admitted a user at any agency on the estate.
select ok(
  pg_temp.body('set_branch_deed_recipient') not like '%v_user_partner%',
  'set_branch_deed_recipient no longer treats the shared house partner as one organisation');

select ok(
  pg_temp.body('set_branch_deed_recipient') like '%app_may_reach_user(p_user)%',
  'and asks the rail-aware predicate every other act-on-a-person site asks');

select * from finish();
rollback;
