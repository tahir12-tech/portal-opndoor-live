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

/** The route label shown in place of a house partner's name, so a row still
    reads truthfully (its route) without ever naming the plumbing partner. */
export function houseRouteLabel(slug: string | null | undefined): string {
  if (slug === DIRECT) return 'Direct';
  if (slug === PROVIDER) return 'Provider hand-over';
  if (slug === AGENTS) return 'Agency referral';
  return '';
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
