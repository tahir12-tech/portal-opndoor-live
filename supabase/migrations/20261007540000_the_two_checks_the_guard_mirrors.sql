-- ===========================================================================
-- AND THE TWO CHECKS assert_application_complete MIRRORS.
--
-- 20261007510000 taught the completeness TRIGGER that an application being
-- closed is not an application being submitted. It said so about the
-- trigger only, and the trigger's own comment names what else is out
-- there: "These mirror the two draft-exempt CHECKs so submission gives a
-- readable line, not the raw constraint violation."
--
-- The CHECKs were not changed, so the rule was half applied. The pgTAP
-- fixture for the thirty-day close is what found it, with a tenant who had
-- typed nothing but an email address:
--
--   ERROR: new row for relation "applications" violates check constraint
--          "applications_phone_present"
--
-- Dev's own data hid it. Six of the eight unfinished applications there
-- were closed by the sweep without complaint, because every one of them
-- happened to carry a phone number; the one that does not, GR-20625, is 29
-- days quiet and was not due. It would have failed tomorrow, silently,
-- inside a cron.
--
-- SAME RULE, SAME LIST, AND NOT A WIDER ONE. A phone number and a real
-- postcode are still required to reach sent, paid, deed or referencing.
-- What is no longer required is having them in order to STOP. The
-- constraints are dropped and re-added rather than altered because
-- Postgres has no "alter check"; both new forms are strictly weaker than
-- the old ones, so every existing row satisfies them and the revalidation
-- cannot fail.
-- ===========================================================================
alter table public.applications drop constraint if exists applications_phone_present;
alter table public.applications add constraint applications_phone_present
  check (
    status in ('draft', 'expired', 'withdrawn', 'declined')
    or (btrim(coalesce(tenant_phone, '')) <> '' and tenant_phone ~ '[0-9]')
  );

alter table public.applications drop constraint if exists applications_postcode_valid;
alter table public.applications add constraint applications_postcode_valid
  check (
    status in ('draft', 'expired', 'withdrawn', 'declined')
    or prop_postcode ~* '^[a-z]{1,2}[0-9][a-z0-9]? ?[0-9][a-z]{2}$'
  );
