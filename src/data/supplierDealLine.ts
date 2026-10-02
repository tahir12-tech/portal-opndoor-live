/* =====================================================================
   WHAT A SUPPLIER'S DEAL IS, IN ONE LINE.

   Matt, 2026-10-02, about the Suppliers list: "Under each supplier's
   name, replace 'Total 25.0%, agents' share 10.0%' with the plain
   one-line summary of its current deal from its Commission tab, e.g.
   '25% of the fee, agencies 10%' or 'Tiered deal', so it never shows a
   rate that isn't in force."

   THE CLAUSE THAT DECIDES THE SHAPE is the last one. The old line read
   `partners.partner_rate` and `partners.agent_rate`, which are the
   STANDARD columns -- what a supplier would be charged with no deal of
   their own. A supplier on a negotiated agreement was shown a pair of
   percentages that appear in no agreement and match no statement line.
   The fix is not a better sentence about those columns; it is to stop
   printing them whenever something else is in force.

   SO THERE ARE THREE ANSWERS, not two:

     no deal          the standard columns, which ARE in force
     a flat deal      its one rate, which is a figure worth showing
     anything else    "Tiered deal", because a deal with bands or tiers
                      has no single rate, and inventing one by taking
                      the first band is how the old line went wrong in
                      the other direction

   "AGENCIES 10%" COMES FROM THE AGENTS' DEAL, not from `agent_rate`,
   for the same reason: a supplier whose agents are on a negotiated
   share would otherwise be described with the standard one. Where that
   deal is itself tiered the clause is dropped rather than guessed at --
   the supplier's own line is still true, and the agencies' half is on
   the Commission tab where it can be said properly.

   THE COMMISSION TAB IS THE AUTHORITY and this is a summary of it, so
   `dealWords` is deliberately not reused: that writes the full sentence
   a card leads with ("35% of the fee, on every referral", bands and all)
   and Matt asked for the short form. Two readers of one agreement, each
   saying as much as its surface has room for.
   ===================================================================== */
import type { AgreementView } from './orgService';

/** A rate as a percentage with no trailing zeros: 0.25 -> "25", 0.125 -> "12.5". */
function pct(rate: number): string {
  return String(Number((rate * 100).toFixed(2)));
}

/** Is this agreement one rate, or does it depend on something? */
export function isFlatDeal(deal: AgreementView): boolean {
  const tiers = deal.tiers ?? [];
  const bands = deal.bands ?? [];
  /* A SINGLE BAND WITH NO RATE IS NOT A RATE. Bands price the FEE (weeks
     of rent) and tiers price the COMMISSION; a deal can carry a band for
     the fee basis and still be flat on commission. So the question is
     only about what varies. */
  if (tiers.length > 1) return false;
  if (bands.filter((b) => b.rate != null).length > 1) return false;
  return true;
}

/** The one rate a flat deal charges, or null if it has none to show. */
export function flatRateOf(deal: AgreementView): number | null {
  const tier = (deal.tiers ?? [])[0];
  if (tier?.rate != null) return tier.rate;
  const band = (deal.bands ?? []).find((b) => b.rate != null);
  return band?.rate ?? null;
}

/**
 * The line under a supplier's name on the Suppliers list.
 *
 * `commission` and `agentShare` are that supplier's own negotiated
 * agreements, or null where they are on standard terms. `standardTotal`
 * and `standardShare` are the partner columns, used only when nothing
 * else is in force.
 */
export function supplierDealLine(input: {
  commission: AgreementView | null;
  agentShare: AgreementView | null;
  standardTotal: number | null;
  standardShare: number | null;
}): string {
  const { commission, agentShare, standardTotal, standardShare } = input;

  /* THE AGENCIES' HALF, worked out first because it is a clause on the
     end of whichever sentence the supplier's half produces. */
  let agencies: string | null = null;
  if (agentShare) {
    if (isFlatDeal(agentShare)) {
      const r = flatRateOf(agentShare);
      agencies = r == null ? null : `agencies ${pct(r)}%`;
    } else {
      // A tiered share has no one number; saying nothing is better than
      // naming a band the agency is probably not in.
      agencies = 'agencies on a tiered deal';
    }
  } else if (standardShare != null) {
    agencies = `agencies ${pct(standardShare)}%`;
  }

  const withAgencies = (head: string) => (agencies ? `${head}, ${agencies}` : head);

  if (commission) {
    if (!isFlatDeal(commission)) return withAgencies('Tiered deal');
    const r = flatRateOf(commission);
    if (r == null) return withAgencies('Negotiated deal');
    return withAgencies(`${pct(r)}% of the fee`);
  }

  if (standardTotal == null) return agencies ? withAgencies('No rate set') : 'No rate set';
  return withAgencies(`${pct(standardTotal)}% of the fee`);
}
