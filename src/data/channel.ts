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

/** The house-route slugs, which are stable and set by migration. */
const DIRECT = 'opndoor-direct';
const PROVIDER = 'referencing-partner';

export function channelOf(input: {
  partnerSlug: string | null | undefined;
  referencingMode: string | null | undefined;
}): Channel {
  if (input.partnerSlug === DIRECT) return 'Direct';
  if (input.partnerSlug === PROVIDER) return 'Provider hand-over';
  // A partner rail where WE arrange the check is an agent typing it in the
  // portal; one where the check is already done arrived through the API.
  if (input.referencingMode === 'opndoor_referenced') return 'Agent referral';
  return 'Partner referral';
}
