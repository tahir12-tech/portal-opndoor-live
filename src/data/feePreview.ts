/* =====================================================================
   WHAT THIS REFERRAL WILL COST, before it is sent.

   The fee stopped being "one month's rent" the day agreements landed: it is
   whatever the agreement's tenant-count band says, and on a joint tenancy it is
   then split between the applicants. An agent typing a second tenant into the
   form changes the price, and finding that out from the tenant's Stripe page is
   too late.

   THE ARITHMETIC IS NOT HERE. referral_fee_preview calls resolve_fee and
   public.apportion — the same two functions create_joint_referral charges with —
   so the number on the form is the number that gets charged by construction
   rather than by two implementations happening to agree.
   ===================================================================== */
import { SUPABASE_ENABLED, sb } from '@/lib/supabase';
import { plural } from '@/lib/plural';

export interface FeePreview {
  /** The whole tenancy's fee. */
  feeAmount: number;
  /** The basis it was computed on, as a QUANTITY whose unit is the field
      below. 4.35 weeks is standard terms. The name is the column's. */
  feeBasisWeeks: number;
  /** 'weeks' or 'months'. A band written in months keeps its quantity in
      feeBasisWeeks, so 1 month arrives as 1 and only this says which. */
  feeBasisUnit: 'weeks' | 'months';
  /** True when this is standard terms (one month's rent exactly), not a deal. */
  isStandard: boolean;
  /** What each tenant pays, in the order they were entered, summing to feeAmount. */
  shares: number[];
}

/**
 * Ask the server what this costs. Returns null when it cannot say — an
 * unauthenticated or mock session, or a branch the caller cannot see — and the
 * form then shows nothing rather than a guess.
 */
export async function previewReferralFee(input: {
  agency: string; branch: string; partner?: string;
  rent: number; sharePercents: number[];
}): Promise<FeePreview | null> {
  if (!SUPABASE_ENABLED) return null;
  if (!input.agency || !input.branch || !(input.rent > 0)) return null;
  const shares = input.sharePercents.length ? input.sharePercents : [100];
  if (shares.some((p) => !Number.isFinite(p))) return null;

  const { data, error } = await sb().rpc('referral_fee_preview', {
    p_agency: input.agency,
    p_branch: input.branch,
    p_partner_slug: input.partner || null,
    p_rent: input.rent,
    p_shares: shares,
  });
  if (error) return null;
  const r = Array.isArray(data) ? data[0] : data;
  if (!r) return null;
  return {
    feeAmount: Number(r.fee_amount),
    feeBasisWeeks: Number(r.fee_basis_weeks),
    feeBasisUnit: r.fee_basis_unit === 'months' ? 'months' : 'weeks',
    isStandard: r.is_standard !== false,
    shares: (r.shares ?? []).map(Number),
  };
}

/**
 * "One month's rent" or "5 weeks of rent", for the line under the figure.
 *
 * THE UNIT, WHICH THIS READ FROM NOWHERE UNTIL 20261008000000. A band written
 * in MONTHS keeps its quantity in `feeBasisWeeks`, so a one-month band is 1,
 * and wording it as weeks said "1 weeks of rent" over a figure that was a
 * whole month of rent. The RPC did not return a unit and this could not have
 * known; both halves are fixed together.
 *
 * ONE MONTH IS SAID THE SAME WAY STANDARD TERMS ARE SAID, which is the
 * one-basis-one-wording ruling the emails, the Stripe line and the pay page
 * already keep: a month is "one month's rent" wherever it is named, whether
 * it got there by being standard or by being a band that says one month.
 */
export function feeBasisLabel(p: FeePreview): string {
  if (p.isStandard) return "one month's rent";
  const n = p.feeBasisWeeks;
  if (p.feeBasisUnit === 'months') {
    return n === 1 ? "one month's rent" : `${fmt(n)} ${plural(n, 'month')} of rent`;
  }
  return `${fmt(n)} ${plural(n, 'week')} of rent`;
}

/** A band is a whole number of weeks or months; a share of one is not. Two
    decimals rather than a round number, because "3.33 weeks" is honest about
    an apportioned share and "3 weeks" would name a band nobody agreed. */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
