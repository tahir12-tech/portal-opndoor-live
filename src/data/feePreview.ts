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

export interface FeePreview {
  /** The whole tenancy's fee. */
  feeAmount: number;
  /** The basis it was computed on, in weeks of rent. 4.35 is standard terms. */
  feeBasisWeeks: number;
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
    isStandard: r.is_standard !== false,
    shares: (r.shares ?? []).map(Number),
  };
}

/** "One month's rent" or "5 weeks of rent", for the line under the figure. */
export function feeBasisLabel(p: FeePreview): string {
  if (p.isStandard) return "one month's rent";
  const w = p.feeBasisWeeks;
  return `${Number.isInteger(w) ? w : w.toFixed(2)} weeks of rent`;
}
