/* =====================================================================
   The additive commission rule, mirrored for the screen.

   commission_split() in SQL is the authority: it is what create_referral freezes
   onto an application, and nothing here is ever written to the database. This
   mirror exists so the agency page can draw a branch's payout line and preview an
   edit without a round trip per branch, and it is unit-tested against the same
   four worked examples the migration states.

   THE RULE. The referring AGENCY earns its explicit rate, or the Opndoor standard
   when neither it nor the referring branch has one. Explicit branch and group
   rates are additive lines on top. So a branch rate replaces the agency's
   DEFAULT, never its explicit rate.
   ===================================================================== */
import type { CommissionLine } from './types';

export interface SplitInput {
  branchRate?: number | null;
  agencyRate?: number | null;
  groupRate?: number | null;
  /** The Opndoor standard for this partner. */
  standard: number;
  branchName: string;
  agencyName: string;
  groupName?: string | null;
  branchId?: string | null;
  agencyId?: string | null;
  groupId?: string | null;
}

/** Every line a referral against this branch pays, one per payee. */
export function splitLines(i: SplitInput): CommissionLine[] {
  const out: CommissionLine[] = [];
  const agencyShare = i.agencyRate ?? (i.branchRate == null ? i.standard : null);
  if (agencyShare != null) {
    out.push({ level: 'agency', orgId: i.agencyId ?? null, orgName: i.agencyName, rate: agencyShare });
  }
  if (i.branchRate != null) {
    out.push({ level: 'branch', orgId: i.branchId ?? null, orgName: i.branchName, rate: i.branchRate });
  }
  if (i.groupRate != null && i.groupName) {
    out.push({ level: 'group', orgId: i.groupId ?? null, orgName: i.groupName, rate: i.groupRate });
  }
  return out;
}

export function splitTotal(i: SplitInput): number {
  return splitLines(i).reduce((s, l) => s + l.rate, 0);
}

/** "12%" from 0.12, trimming a trailing .00 so the common case reads cleanly. */
export function pctLabel(frac: number): string {
  const n = +(frac * 100).toFixed(2);
  return `${n}%`;
}

/** The one plain line a branch shows: who is paid and how much, added up.
    "A referral here pays out: Northgate Lettings 12% = 12% of the fee" */
export function payoutSentence(i: SplitInput): string {
  const lines = splitLines(i);
  if (!lines.length) return 'A referral here pays out nothing.';
  const parts = lines.map((l) => `${l.orgName} ${pctLabel(l.rate)}`);
  const total = pctLabel(lines.reduce((s, l) => s + l.rate, 0));
  return `A referral here pays out: ${parts.join(' + ')} = ${total} of the fee`;
}
