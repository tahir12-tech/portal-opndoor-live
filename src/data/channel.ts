/* =====================================================================
   How an application arrived, for the portal.

   MIRRORS public.application_channel (20260813080000). Two implementations of
   one rule is two rules, so this exists only because the client needs the
   answer without a round trip per row, and it is written to be diffed against
   the SQL rather than to be clever.

   If you change one, change the other, and there is a test asserting the four
   values match the SQL's.
   ===================================================================== */
export type Channel = 'Direct' | 'Agent referral' | 'Partner referral' | 'Provider hand-over';

export const CHANNELS: Channel[] = ['Direct', 'Agent referral', 'Partner referral', 'Provider hand-over'];

/** The label the UI shows for each channel. channelOf mirrors the SQL and keeps
    the SQL's wording ('Agent referral', 'Partner referral'); the product names
    the actors as agencies and suppliers, so the screen labels differ. Change the
    label here, never channelOf's return values (a test locks those to the SQL). */
export const ROUTE_LABEL: Record<Channel, string> = {
  'Direct': 'Direct',
  'Agent referral': 'Agency referral',
  'Partner referral': 'Supplier referral',
  'Provider hand-over': 'Provider hand-over',
};

/** The house-route slugs, which are stable and set by migration. */
const DIRECT = 'opndoor-direct';
const PROVIDER = 'referencing-partner';
/** The house partner that carries direct agency referrals. It is deliberately
    NOT is_house_route in the DB: application_channel maps is_house_route to
    'Direct', and this rail is 'Agent referral', so the flag would misclassify it.
    It is plumbing all the same and must never surface as a partner in a screen. */
const AGENTS = 'opndoor-agents';

/** Every Opndoor house / plumbing partner. These exist only so an application's
    NOT NULL partner FK resolves; they must never appear in a screen as a
    selectable or named partner. Stable slugs, set by migration (see above). */
export const HOUSE_PARTNER_SLUGS: readonly string[] = [DIRECT, PROVIDER, AGENTS];

/** True if a partner slug is one of Opndoor's own house/plumbing partners. */
export function isHousePartner(slug: string | null | undefined): boolean {
  return !!slug && HOUSE_PARTNER_SLUGS.includes(slug);
}

/**
 * IS THIS THE DIRECT RAIL? The client's mirror of application_channel's
 * first arm.
 *
 * NARROWER THAN `isHousePartner`, and the difference is load-bearing. All
 * three slugs above are plumbing, but only this one carries business that
 * belongs to nobody: `opndoor-agents` carries every real agency referral
 * Opndoor onboards, so excluding it would empty the agency estate, and
 * `referencing-partner` is a genuine hand-over.
 *
 * WHAT IT IS FOR. `resolve_agency_match` and the email matcher rewrite a
 * direct application's `agency_id` and `branch_id` to a REAL agency so a
 * person can service it, while pinning `partner_id` to `opndoor-direct`.
 * So the row looks like that agency's business by every field except the
 * one that decides. Anything grouping by agency or branch has to ask this
 * first, which is Matt's ruling of round 6: "direct-rail applications
 * never count as the matched agency's business."
 *
 * ONE RAIL OUT, NOT ONE RAIL IN. Callers must exclude on this rather than
 * include on `channelOf(...) === 'Agent referral'`. An inclusion test also
 * drops the supplier rail and the provider hand-over, which is precisely
 * the bug 20261006590000 was written to undo after `agreement_volume`
 * zeroed every supplier agency's negotiated volume.
 *
 * SLUG-ONLY, DELIBERATELY. It takes no partner record and consults no
 * service, because `hydrate.ts` needs it while building the org indexes --
 * before `hydratePartners()` has run, when `partnersService` is empty or
 * stale. A version that resolved a partner would answer wrong there.
 */
export function isDirectRail(slug: string | null | undefined): boolean {
  return slug === DIRECT;
}

/** The route label shown in place of a house partner's name, so a row still
    reads truthfully (its route) without ever naming the plumbing partner. */
export function houseRouteLabel(slug: string | null | undefined): string {
  if (slug === DIRECT) return 'Direct';
  if (slug === PROVIDER) return 'Provider hand-over';
  if (slug === AGENTS) return 'Agency referral';
  return '';
}

/**
 * Was THIS application's tenant referenced by their own agency, so that they
 * went straight to payment and never filled in an eligibility form?
 *
 * THE OTHER QUESTION. channelOf below answers how a referral ARRIVED, which is
 * a fact about the relationship and is read off the PARTNER. This answers who
 * CHECKED THE TENANT, which is a fact about the journey and is read off the
 * application's own frozen referencing_mode. Regent gives them opposite
 * answers — an agency referral, pre-referenced — and that is the whole point of
 * the seam; the two live side by side here so nobody reaches for the wrong one.
 *
 * WRITTEN POSITIVELY, deliberately. The negative form (`!== 'opndoor_referenced'`)
 * also catches every row where the mode is simply absent — 37 of 39 mock rows,
 * and any pre-M1 record — and would hide a document card that should be there.
 * Unknown is not pre-referenced; it is unknown, and the caller keeps its default.
 */
export function preReferencedJourney(mode: string | null | undefined): boolean {
  return mode === 'pre_referenced_open' || mode === 'pre_referenced_screened';
}

export function channelOf(input: {
  partnerSlug: string | null | undefined;
  /** The PARTNER's referencing mode, not the application's.
      How a referral ARRIVED is a fact about the relationship: one of our
      agencies typed it into the portal, or a supplier pushed it through the
      API. Who checked the tenant is a different question, and keying on it
      labelled Regent — our agency, referencing their own tenants — as a
      supplier referral on every row. */
  partnerMode: string | null | undefined;
}): Channel {
  if (input.partnerSlug === DIRECT) return 'Direct';
  if (input.partnerSlug === PROVIDER) return 'Provider hand-over';
  if (input.partnerMode === 'opndoor_referenced') return 'Agent referral';
  return 'Partner referral';
}
