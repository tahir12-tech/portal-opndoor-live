-- "NO PORTAL IDENTITY" NOW HAS TWO SPELLINGS, AND THE GUARD ONLY KNEW ONE.
--
-- 20261006720000 made app_role() return the empty string instead of NULL for a
-- caller with no public.users row, matching the hotfix hand-applied to
-- production. I checked for anything depending on the NULL first, and checked
-- too narrowly: I grepped for `app_role() is null` and this reads
--
--     v_role := public.app_role();
--     ...
--     if v_role is null then return v_row; end if;
--
-- which is the same test one assignment later. The full pgTAP suite caught it
-- before the commit, which is the whole reason the rule says to run it.
--
-- WHY IT MATTERS RATHER THAN BEING COSMETIC. This is the ONE place in the
-- tree where a NULL role means ALLOW rather than refuse, and it is deliberate:
-- a sandbox row may be written by a cron job, by an Edge Function holding the
-- service key, or by the partner API, and none of those has a portal identity.
-- Turning NULL into '' made all three fall through to the raise, so a sandbox
-- token could no longer mint a sandbox application at all. Five assertions
-- across two files failed:
--   a_sandbox_token_mints_a_sandbox_application.test.sql  4
--   commission_statement_recipients.test.sql              errored outright
--
-- AND IT WOULD HAVE BEEN WORSE AT CUTOVER THAN IT WAS HERE. Production is
-- being hotfixed now and this branch ships later. Had the guard arrived on a
-- production whose app_role() was already total, the sandbox rehearsal paths
-- would have broken there, on the live system, with nothing on this branch
-- showing red -- because `npm run drift` compares the files to dev and never
-- looks at production.
--
-- THE FIX IS THE ONE THAT HOLDS EITHER WAY. `coalesce(v_role, '') = ''` is
-- true for NULL and true for the empty string, so the guard behaves
-- identically whichever definition of app_role() is in force. That matters
-- beyond today: it is the property that lets a hotfixed production and a
-- clean-apply dev agree.
--
-- Everything else this migration touches: nothing. The body below differs from
-- 20260810360000_dev_centre_fixes.sql's only in that one line. Verified first that no other
-- function tests the ROLE for NULL: 22 functions on dev pair app_role() with
-- an `is null`, and in 21 of them the thing tested is a PARTNER, which this
-- change does not touch.
--
-- Extends the isolation suite:
-- supabase/tests/a_sandbox_token_mints_a_sandbox_application.test.sql.

create or replace function public.applications_sandbox_write_guard()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
declare v_role text; v_livemode boolean; v_row public.applications;
begin
  -- NEW is unassigned on DELETE and OLD is unassigned on INSERT, and touching an
  -- unassigned record in plpgsql raises rather than returning null. So branch on
  -- TG_OP instead of coalescing across the two.
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;
  v_livemode := v_row.livemode;

  -- Live rows: nothing to say.
  if v_livemode is not false then
    return v_row;
  end if;

  -- The deliberate purge path, scoped to one transaction. Checked before the
  -- role, because the whole point is that it works for a role that is otherwise
  -- refused.
  if current_setting('app.purging_sandbox', true) = 'on' then
    return v_row;
  end if;

  v_role := public.app_role();

  -- No portal identity on the session: a cron job, an Edge Function using the
  -- service key, or the partner API. These are the sandbox rehearsal paths and
  -- must work.
  --
  -- BOTH SPELLINGS OF "no identity". app_role() answered NULL until
  -- 20261006720000 and answers '' after it, and production was hotfixed to the
  -- second spelling before this branch ships. Testing only one of them breaks
  -- the rehearsal paths on whichever database holds the other.
  if coalesce(v_role, '') = '' then
    return v_row;
  end if;

  -- A developer may act on sandbox through the Dev Centre.
  if v_role = 'developer' then
    return v_row;
  end if;

  raise exception 'This is a sandbox application and cannot be modified from the portal.'
    using errcode = '42501';
end $function$;
