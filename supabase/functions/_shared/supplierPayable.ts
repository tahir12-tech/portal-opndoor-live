/* =====================================================================
   WHAT OPNDOOR ACTUALLY OWES A SUPPLIER, WHICH IS NOT ALWAYS THE TOTAL.

   Matt, 2026-10-03, verbatim: "the invoice instruction must ask for what
   Opndoor owes the supplier itself (600 here, not 840), otherwise agency
   commission Opndoor pays directly gets paid twice."

   THE AMOUNTS CANNOT BE READ BACK TO THE ARRANGEMENT. Under both shapes
   `supplier_amount = total_amount - agent_amount`, so the three numbers sit
   in the same relationship either way; what differs is whether the agents'
   share was added ON TOP of the supplier's total or carved OUT of it:

     siblings  total 840 = supplier 600 + agents 240 on top.
               Opndoor pays Frost the 240 directly. Kestrel is owed 600.
     carved    total 600, agents 240 carved out, supplier 360.
               Kestrel is owed the whole 600 and passes 240 to Frost.

   The same debt, £600, reached from a different column. Invoicing the total
   is right in one case and £240 paid twice in the other, and nothing in the
   figures says which. `settles_own` is returned by `supplier_statement_lines`
   since 20261007820000 for exactly this.

   PER LINE, NOT PER STATEMENT. A supplier's arrangement can change and every
   referral keeps the one it was frozen under, so a month that straddles a
   change holds both kinds and the answer is the sum of the right answers.

   ITS OWN FILE, AND NOT IN THE EDGE FUNCTION, for two reasons. The portal's
   Reporting download and the monthly run both go through buildSupplierBundle
   and must agree to the penny. And the function imports the Supabase client
   through an npm: specifier, which vitest cannot resolve -- so arithmetic
   that decides what somebody is paid would have been reachable only by
   reading the source.
   ===================================================================== */

/** The shape this file needs: one row of `supplier_statement_lines`. */
export interface PayableLine {
  agency_name: string;
  total_amount: number | string;
  agent_amount: number | string;
  supplier_amount: number | string;
  /** True where the supplier settles its own agents and is owed the total;
      false where Opndoor pays the agency directly. Absent on a caller that
      predates 20261007820000, and absent reads as false -- the safer way
      round, because it under-invoices rather than double-paying. */
  settles_own?: boolean;
}

const num = (v: number | string | null | undefined): number => (v == null ? 0 : Number(v));

/** The portal's money format, to the penny. Matches the statement on screen. */
export function gbpAmount(n: number): string {
  return `£${(n ?? 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** What the supplier invoices: their own share where Opndoor pays the agency
    directly, the whole total where they pass it on themselves. */
export function supplierPayableOf(lines: readonly PayableLine[]): number {
  return lines.reduce(
    (sum, l) => sum + (l.settles_own ? num(l.total_amount) : num(l.supplier_amount)),
    0,
  );
}

/** What Opndoor pays the agencies directly, which is the part the supplier
    must NOT invoice. Zero on a wholly carved statement. */
export function paidDirectToAgents(lines: readonly PayableLine[]): number {
  return lines.reduce((sum, l) => sum + (l.settles_own ? 0 : num(l.agent_amount)), 0);
}

/**
 * "Agency commission of £240.00 paid by opndoor directly to Frost
 * Partnership." -- Matt's own wording, one sentence per agency.
 *
 * ONE PER AGENCY, NOT PER REFERRAL: a supplier with eleven Frost referrals
 * needs one sentence about Frost, not eleven. Sorted by name so two runs of
 * the same month produce the same bytes.
 */
export function directToAgentNotes(lines: readonly PayableLine[]): string[] {
  const byAgency = new Map<string, number>();
  for (const l of lines) {
    if (l.settles_own) continue;
    const amount = num(l.agent_amount);
    if (!(amount > 0)) continue;
    byAgency.set(l.agency_name, (byAgency.get(l.agency_name) ?? 0) + amount);
  }
  return [...byAgency.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([agency, amount]) => `Agency commission of ${gbpAmount(amount)} paid by opndoor directly to ${agency}.`);
}

/** The line a draft carries where a posted statement carries the invoice
    instruction. Matt: "For a draft, leave out the invoice instruction
    entirely ('Don't invoice yet: this statement hasn't been posted')." */
export const DRAFT_NO_INVOICE = "Don't invoice yet: this statement hasn't been posted.";

/** What a draft prints where a posted statement prints its reference. The
    line read "Reference Reference assigned when the statement is poste..."
    -- the label, then a value starting with the same word, then truncated. */
export const DRAFT_REFERENCE = "Draft: not yet posted";
