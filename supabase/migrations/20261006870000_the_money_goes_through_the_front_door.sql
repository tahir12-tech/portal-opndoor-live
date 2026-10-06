-- R6. A COMMISSION RATE CHANGES THROUGH THE FRONT DOOR OR NOT AT ALL.
--
-- Commission rates and negotiated bands were writable straight from the
-- browser: `partners.partner_rate`, `partners.agent_rate`,
-- `pricing_agreement_bands.agent_rate` and `commission_tiers.agent_rate` all
-- carried UPDATE for `authenticated`, and RLS admits an opndoor admin. A
-- PATCH moved a commission rate with nothing recording that it happened.
--
-- The governed path already exists and is good -- `update_partner_settings`
-- is SECURITY DEFINER and writes `partner_audit`. It was simply OPTIONAL, and
-- an optional audit trail is not one.
--
-- Test: supabase/tests/the_money_goes_through_the_front_door.test.sql
-- Failed first on 5 of 8, with 3 regression guards passing.
--
-- =========================================================================
-- THE BANDS ARE WORSE THAN THE RATES
-- =========================================================================
--
-- This is the part the finding did not say, and it is why INSERT and DELETE
-- are revoked here rather than only UPDATE.
--
-- The 50% cap is enforced by `assert_agreement_within_cap`, which is CALLED
-- by the RPC that saves an agreement. It is not a trigger and nothing else
-- invokes it. So a direct INSERT of a band never meets the cap at all --
-- measured, a 90% band written straight from the browser was accepted
-- without complaint. Revoking UPDATE alone would have left that open.
--
-- =========================================================================
-- WHY COLUMN GRANTS ON partners, AND WHY THE ORDER MATTERS
-- =========================================================================
--
-- Nothing in the client PATCHes `partners` today, but it carries a dozen
-- non-commercial columns and a blanket revoke would be a wider change than
-- the finding. So the two commercial columns are named and taken, and every
-- other column is handed straight back.
--
-- A column-level REVOKE cannot subtract from a table-level GRANT. The table
-- revoke must come FIRST and the columns be granted back after -- done the
-- other way round the rates stay writable and the test passes vacuously.
-- That is the lesson from the live hotfix and it is why these two statements
-- are in this order.
--
-- The bands and tiers tables get no re-grant at all: there is no
-- non-commercial column on either worth writing from a browser, and both
-- exist only to be edited through the agreement RPC that runs the cap.
--
-- The SECURITY DEFINER RPCs are unaffected throughout: they run as the owner,
-- so none of this touches them. That is the whole design -- the front door
-- stays open and the side door closes.

-- -------------------------------------------------------------------------
-- 1. partners. Table revoke first, then everything but the two rates back.
-- -------------------------------------------------------------------------
revoke update on table public.partners from anon, authenticated;

grant update (
  id, slug, name, status, live_from, is_primary, created_at,
  referrer_leaderboard_mode, referencing_mode, portal_referrals_enabled,
  api_access_enabled, is_house_route, refers_own_stock
) on table public.partners to authenticated;

-- -------------------------------------------------------------------------
-- 2. The negotiated bands and the volume tiers. No browser write at all:
--    every legitimate change runs through the agreement RPC, which is the
--    only thing that applies the 50% cap.
-- -------------------------------------------------------------------------
revoke insert, update, delete on table public.pricing_agreement_bands from anon, authenticated;
revoke insert, update, delete on table public.commission_tiers          from anon, authenticated;

-- The agreement header itself carries the scope and the dates a band hangs
-- off. Leaving it writable would let an admin re-point a whole agreement at
-- another agency from the browser, which is the same hole one table up.
revoke insert, update, delete on table public.pricing_agreements from anon, authenticated;

comment on table public.pricing_agreement_bands is
  'Negotiated rate bands. NOT writable from the browser: every change goes through the agreement RPC, which is the only caller of assert_agreement_within_cap and therefore the only thing that applies the 50% cap. A direct INSERT here would bypass the cap entirely.';
