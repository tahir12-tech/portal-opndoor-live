-- ===========================================================================
-- OPNDOOR PORTAL: HOTFIX FOR THE LIVE SYSTEM
-- 2026-09-29. Read docs/HOTFIX-LIVE-FOR-BALAL.md first.
--
-- Run this on the LIVE Supabase project, in the SQL editor, signed in as the
-- project owner. It is two statements. Run them together.
--
-- It does NOT create, drop or alter any table, column, policy or row. It
-- removes write permissions that were never used, and replaces one small
-- function. Nothing is deleted and no data changes.
--
-- Proved in supabase/tests/the_live_hotfix_holds.test.sql, which rebuilds this
-- exact schema, shows both holes open, applies these two statements, and shows
-- them shut with every working path still working. 19 assertions.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. THE BROWSER MAY NOT WRITE TO applications.
--
-- Supabase grants every new table in `public` to `anon` and `authenticated`
-- automatically. No migration ever narrowed it for this table, so today a
-- logged-in manager can send a single web request that marks any application
-- in their company paid, changes the rent every commission figure is
-- calculated from, or points the executed deed at a different document. No
-- screen does any of this; the permission is simply sitting there unused.
--
-- Nothing legitimate is lost. Every action in the product that changes an
-- application goes through a database function that runs with its own
-- authority, or through a background job holding the service key. Neither is
-- affected by this. SELECT is deliberately untouched, so every screen still
-- reads exactly what it reads today.
--
-- THE ORDER MATTERS AND THIS IS THE WHOLE STATEMENT. Do not "improve" this by
-- adding a narrower grant afterwards: a column-level grant cannot subtract
-- from a table-level one, so adding an allowlist without this revoke leaves
-- the hole completely open. That is asserted in the test file.
-- ---------------------------------------------------------------------------

revoke insert, update, delete, truncate
  on public.applications
  from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. A GUARD THAT CANNOT TELL WHO YOU ARE MUST REFUSE.
--
-- app_role() answers "what is this person's role". For a sign-in that has no
-- matching row in public.users it answers "I don't know" (NULL). Every
-- permission check in the system is written as "if this person is NOT allowed,
-- refuse" -- and in SQL, "not (I don't know)" is itself "I don't know", and an
-- `if` on "I don't know" does not run. So the refusal never happened and the
-- caller walked through.
--
-- Production had two such accounts, with MFA enrolled, until 2026-09-29.
--
-- The fix is to answer "nobody" instead of "I don't know". Empty string is not
-- a valid role -- the column only permits superadmin, management and referrer
-- -- so every check that could not decide now decides "no". It cannot widen
-- anything: every one of the 50 places this value is used compares it for
-- equality or membership, so a value that matched nothing before still matches
-- nothing, and a check that could not decide now refuses.
--
-- Nothing changes for anybody who has a normal account.
--
-- This one function fixes all four of mark_withdrawn, add_application_note,
-- amend_tenancy_start and send_deed_to_agent, and eight more besides,
-- including admin_update_user_role -- where today one of those profile-less
-- accounts could promote any negotiator, in any company, to management.
--
-- PASTE THIS WHOLE STATEMENT. The words `stable`, `security definer` and
-- `set search_path` are not decoration: drop them and the function stops being
-- able to read the table it needs, and every permission check in the product
-- starts failing. Replacing a function this way keeps its existing
-- permissions, so nothing else needs re-granting.
-- ---------------------------------------------------------------------------

create or replace function public.app_role() returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce((select role from public.users where id = auth.uid()), '')
$$;
