-- ===========================================================================
-- applications.referrer_id becomes nullable, because a direct signup has no
-- referrer and inventing one is worse than admitting it.
--
-- WHY THIS IS THE RIGHT ANSWER RATHER THAN THE EASY ONE
-- The two alternatives were both considered and both are worse:
--
--   A house "Direct Signup" row in public.users
--       invents a staff identity. It can be granted a role, it appears in the
--       user list and the league, it needs a partner_id to satisfy
--       users_partner_by_role, and it is a login that exists forever and nobody
--       owns. A fake person in the staff table is a standing invitation.
--
--   Reusing the applicant's id as the referrer
--       is exactly the both-identities escalation that the mutual-exclusion
--       triggers in 20260812080000 exist to prevent: app_role() would return a
--       staff role for a tenant session.
--
-- A direct application genuinely has no referrer. The column should say so.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES TO THE REFERRAL PATH
-- ---------------------------------------------------------------------------
-- It is a RELAXATION, which is the safest class of schema change available:
--   - no existing row can violate it, because every existing row has a referrer
--   - no existing query changes, because every existing query that filters or
--     joins on referrer_id behaves identically when no row is null
--   - it cannot fail on apply, because dropping NOT NULL never rejects data
--
-- What it does change is that every READER must now tolerate null. The audit of
-- those readers is the actual work, and it is short because referrer_name is
-- snapshotted onto the row separately (20260705140347), so display never
-- depended on the join in the first place:
--
--   hydrate.ts          joins users!referrer_id as a LEFT join; null yields null
--                       and referrer_name carries the display text
--   partner_api_*       expose referrer_name, never referrer_id
--   the referrer league groups by referrer and MUST NOT show these rows; that
--                       is handled where the existing role-based exclusion
--                       already lives, not here
--   weekly digest       counts by partner and status, does not group by referrer
--
-- REGRESSION F4 covers attribution; the league exclusion is asserted alongside
-- the existing referrer-exclusion test.
-- ===========================================================================

alter table public.applications alter column referrer_id drop not null;

comment on column public.applications.referrer_id is
  'The staff user who created this referral, NULL on rails where nobody did (direct signup). referrer_name is snapshotted separately and is what every display surface reads, so a null here never renders as a blank name. Readers must tolerate null; the referrer league excludes these rows explicitly.';

-- ---------------------------------------------------------------------------
-- The invariant that replaces NOT NULL.
--
-- Dropping NOT NULL without saying anything would allow a referral-path
-- application with no referrer, which is a real defect rather than a new rail:
-- it would mean a portal or API create silently lost its attribution. So the
-- column is optional ONLY on the rail that has no referrer by design.
-- ---------------------------------------------------------------------------
alter table public.applications drop constraint if exists applications_referrer_required;
alter table public.applications add constraint applications_referrer_required
  check (referrer_id is not null or applicant_id is not null);

comment on constraint applications_referrer_required on public.applications is
  'Every application has a referrer OR an applicant account. NOT NULL was dropped for direct signups, and this stops that becoming "attribution may be missing": a referral or API row with neither is rejected exactly as it was before.';

-- Prove the referral path's rows still satisfy it, before anything relies on it.
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from public.applications
  where referrer_id is null and applicant_id is null;

  if v_bad > 0 then
    raise exception
      'Cannot make referrer_id optional: % existing application(s) would have neither a referrer nor an applicant', v_bad;
  end if;
end $$;
