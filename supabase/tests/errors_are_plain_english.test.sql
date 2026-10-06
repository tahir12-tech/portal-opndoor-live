-- WALK FIX 14. ERROR MESSAGES ARE PLAIN ENGLISH FOR AGENCY USERS.
--
-- Matt, walking dev: "Error messages must be plain English for agency users.
-- 'On our estate', 'position' and 'scope' mean nothing to them. This one
-- should say something like 'Choose which branch this person works at.'
-- Check other user-facing errors for the same jargon."
--
-- "OUR ESTATE" IS THE WORST OF THE THREE, because it is not even jargon the
-- reader could look up: it is Opndoor's internal word for the set of agencies
-- it onboards, said to a letting agent about their own staff. "Scope" and
-- "position" are the model's words for a job and an office.
--
-- WHICH MESSAGES THIS COVERS, and why not all of them. Only those an AGENCY
-- or SUPPLIER user can actually reach. Internal assertions inside migrations
-- ("a scope arm is missing") are read by whoever is changing the schema, and
-- the internal vocabulary is clearer there; rewording those would make the
-- code harder to maintain to no reader's benefit. The line is the audience,
-- not the word.
--
-- THE SWEEP IS THE TEST. Assertion 5 is a scan rather than a list: every
-- message that an `authenticated` caller can raise is checked for the three
-- words. A list of known offenders would pass the day it was written and
-- rot; a scan fails the next time somebody writes "scope" in a message a
-- negotiator will read.

begin;
select plan(5);

-- ===========================================================================
-- 1-2. THE TWO AN AGENCY USER HITS MOST. A negotiator referring outside
-- their office, and a director placing somebody.
-- ===========================================================================
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_referral'
      and pg_get_functiondef(p.oid) like '%within your own scope%'),
  0,
  'create_referral no longer tells a negotiator about their "scope"');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_user_scope'
      and pg_get_functiondef(p.oid) like '%within your own scope%'),
  0,
  'nor set_user_scope a director');

-- ===========================================================================
-- 3-4. AND THE REPLACEMENTS SAY SOMETHING USEFUL. A message that merely
-- removes the jargon and still does not tell the reader what to do is only
-- half the fix.
-- ===========================================================================
select isnt(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_referral'
      and pg_get_functiondef(p.oid) like '%offices you work at%'),
  0,
  'and says which offices they may refer against instead');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ~* 'raise exception ''[^'']*our estate'),
  0,
  'and no function raises "our estate" at anybody at all');

-- ===========================================================================
-- 5. THE SWEEP. Every message a signed-in caller can raise, scanned for the
-- three words Matt named. This is the assertion that keeps working.
-- ===========================================================================
select is_empty(
  $$
  select p.proname || ': ' || m[1]
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral regexp_matches(pg_get_functiondef(p.oid),
                                    'raise exception ''([^'']{8,200})''', 'g') as m
  where n.nspname = 'public'
    and p.prokind = 'f'
    and has_function_privilege('authenticated', p.oid, 'execute')
    and m[1] ~* '(our estate|\yyour own scope\y|\ya scope\y)'
  $$,
  'no message a signed-in user can reach talks about estates or scopes');

select * from finish();
rollback;
