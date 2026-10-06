-- THE BRANCH MUST BE AT LEAST AS STRICT AS THE HOTFIX IT REPLACES.
--
-- RETIRED 2026-09-30. docs/HOTFIX-LIVE-FOR-BALAL.sql no longer exists: Matt's
-- decision is that everything in it ships with the cutover instead. This
-- migration is unchanged and still does its job; the `comment on function`
-- below still names the old path, and is LEFT THAT WAY deliberately, because
-- editing an applied migration's comment would make a clean apply disagree
-- with dev over a string. The history is in docs/QUEUE.md.
--
-- What it said when it was written:
--
-- docs/HOTFIX-LIVE-FOR-BALAL.sql is applied to PRODUCTION by hand, before
-- cutover. At cutover this branch's migrations are applied on top. Anything
-- the hotfix closes and this branch leaves open is therefore RE-OPENED by the
-- upgrade -- a security fix undone by shipping, which is the worst possible
-- shape for one.
--
-- Comparing the two found two gaps, both in the same direction.
--
-- 1. DELETE AND TRUNCATE ON applications.
--    Round 7's fix (20261006660000) wrote
--      revoke insert, update on public.applications from anon, authenticated;
--    because INSERT and UPDATE were what the finding was about. But the table
--    sits on Supabase's ALTER DEFAULT PRIVILEGES, which granted ALL, so naming
--    two of the four verbs left the other two in place. Measured on dev before
--    this migration: has_table_privilege('authenticated', 'public.applications',
--    'DELETE') was TRUE, and TRUNCATE likewise, and anon held DELETE too.
--
--    The practical exposure is narrow, which is why it was missed:
--    applications_delete admits only is_admin(), and PostgREST offers no
--    TRUNCATE verb. So it is a superadmin able to destroy a legal record
--    through a hand-made request, cascading the activity log and the notes
--    with it, with the Stripe charge and the PandaDoc document left pointing
--    at nothing. No screen deletes an application; nothing legitimate is lost.
--
-- 2. app_role() STILL ANSWERS "I DO NOT KNOW".
--    The hotfix replaces it so that a caller with no public.users row reads as
--    the empty string rather than NULL. This branch fixed the same class from
--    the other end -- 20261006470000 wrapped all 205 raising guards in
--    coalesce -- so the branch is not vulnerable either way. But if production
--    is hotfixed and this branch is not, the two databases end up holding
--    different definitions of the same function, and whichever is read second
--    is a surprise. Worse, `npm run drift` compares the FILES to dev and would
--    stay perfectly clean while production quietly disagreed with both.
--
--    So the same definition lands here. It is a no-op for behaviour on this
--    branch: every guard is already coalesce-wrapped, so a condition that was
--    NULL is now false and the guard raises either way. Checked before
--    writing this: nothing in the tree tests app_role() for NULL-ness, and the
--    single existing `coalesce(public.app_role(), '')` at 20261006470000:3647
--    already produces exactly what the new body returns. The three
--    `app_role() = 'x'` strings in 20260813030000 are substring assertions
--    about a POLICY's text, not comparisons of the value, and a function body
--    change does not touch them.
--
-- Extends the isolation suite:
-- supabase/tests/the_browser_does_not_write_an_application.test.sql.

-- ---------------------------------------------------------------------------
-- 1. The remaining two verbs.
--
-- Named explicitly rather than as `revoke all`, which would also take SELECT
-- and break every screen. That is not a hypothetical: this project's own rule
-- about re-applying migrations exists because a too-broad revoke broke every
-- user invite and sat green in the suite for a day.
-- ---------------------------------------------------------------------------
revoke delete, truncate on public.applications from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The same app_role() production will be carrying.
--
-- Empty string is not a role: public.users.role admits only superadmin,
-- management, referrer, opndoor_manager and developer. So every comparison
-- that returned NULL now returns false, which is strictly narrowing, and no
-- caller who has a users row is affected at all.
-- ---------------------------------------------------------------------------
create or replace function public.app_role() returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce((select role from public.users where id = auth.uid()), '')
$$;

comment on function public.app_role() is
  'The caller''s role, or the empty string when they have no public.users row. '
  'Never NULL: a guard written as `if not (... app_role() = ''x'' ...) then raise` '
  'does not fire on NULL, so an unknown caller walked through it. Matches the '
  'definition hand-applied to production on 2026-09-29 '
  '(docs/HOTFIX-LIVE-FOR-BALAL.sql).';
