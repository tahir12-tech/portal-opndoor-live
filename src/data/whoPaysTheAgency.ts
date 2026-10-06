/* =====================================================================
   WHO PAYS THE AGENCY: ONE RULE, SIX READERS.

   Matt, 2026-10-05, setting the order of work: "one shared rule for
   'supplier passes it on vs Opndoor pays the agency directly', used by
   all six surfaces (statement 'Payable to you', 'Owed to you'
   headline, breakdowns, League, exports, supplier-agency Commission
   and Reporting tabs)".

   He named the design as well as the job: ONE RULE the six call, not
   six folds that agree today. This file is that rule and the words
   that go with it.

   =====================================================================
   WHAT THE RULE IS
   =====================================================================

   On the supplier rail an agency inside a supplier's estate earns a
   share of the guarantee fee, and there are two arrangements for how
   it reaches them:

     SIBLINGS   opndoor pays the agency directly. The supplier's own
                commission and the agency's share are two separate
                payments, so the total is the SUM of them.

     CARVED     the supplier is paid once and passes the agency's share
                on. The agency's share is INSIDE the supplier's figure,
                so adding the two invents money.

   `opndoor_pays_agents_at_freeze` records which, PER REFERRAL, at the
   moment the referral was created. It is frozen because a statement
   describes money that has already moved: reading the partner's
   current setting would re-word last month's statement every time
   somebody changed a switch.

   NULL FALLS TO CARVED, which is the arrangement that existed before
   the flag did and so is what an unfrozen row actually was. Guessing
   the other way would tell a supplier opndoor had paid an agency
   directly when nobody had.

   =====================================================================
   WHY IT HAD TO BECOME ONE FUNCTION
   =====================================================================

   It was implemented once, privately, inside liveAnalytics, and the
   other five surfaces each did their own thing or nothing. Matt
   reported the consequence four separate times in one afternoon, with
   the same two figures each time -- £947.25 and £378.90 -- from the
   Performance export, the Application export, the League and Kestrel's
   Reporting tab. The Performance export's breakdown showed "Supplier
   £947.25 and Agent £378.90" as two payable amounts when the £378.90
   is inside the £947.25.

   A PERIOD CAN HOLD BOTH ARRANGEMENTS, which is why this splits rather
   than branching. The flag is frozen per application, so an
   arrangement changed mid-month leaves referrals on either side of it
   and the honest answer names both.
   ===================================================================== */

/** Which of the two arrangements a referral was frozen on. */
export type AgencyPayer = 'opndoor' | 'supplier';

/**
 * Read the frozen flag. The ONLY place `opndoor_pays_agents_at_freeze`
 * is interpreted, so "null means carved" is decided once.
 */
export function agencyPayer(opndoorPaysAgentsAtFreeze: boolean | null | undefined): AgencyPayer {
  return opndoorPaysAgentsAtFreeze === true ? 'opndoor' : 'supplier';
}

/** The agency's share, split by who actually pays it. */
export interface AgencyShareSplit {
  /** opndoor pays the agency directly. Adds to the supplier's figure. */
  paidDirectByOpndoor: number;
  /** The supplier is paid it and passes it on. Already inside theirs. */
  passedOnBySupplier: number;
}

export const EMPTY_SPLIT: AgencyShareSplit = { paidDirectByOpndoor: 0, passedOnBySupplier: 0 };

/** Add one referral's agency share to a running split. */
export function addAgencyShare(
  into: AgencyShareSplit, amount: number, opndoorPaysAgentsAtFreeze: boolean | null | undefined,
): void {
  if (!amount) return;
  if (agencyPayer(opndoorPaysAgentsAtFreeze) === 'opndoor') into.paidDirectByOpndoor += amount;
  else into.passedOnBySupplier += amount;
}

/** Fold a list in one call, for readers that have the rows to hand. */
export function splitAgencyShare<T>(
  rows: readonly T[],
  amountOf: (row: T) => number,
  frozenOf: (row: T) => boolean | null | undefined,
): AgencyShareSplit {
  const out: AgencyShareSplit = { ...EMPTY_SPLIT };
  for (const r of rows) addAgencyShare(out, amountOf(r), frozenOf(r));
  return out;
}

/**
 * WHAT OPNDOOR OWES THE SUPPLIER ITSELF.
 *
 * Matt (q): "the 'Commission payable' headline still shows GBP 840; it
 * must show what Opndoor owes the supplier itself (GBP 600)." The
 * supplier's own commission is already net of whatever it passes on,
 * so this is simply that figure -- named, so no caller is tempted to
 * add the agency side back on to make it look bigger.
 */
export function owedToSupplier(supplierCommission: number): number {
  return supplierCommission;
}

/**
 * THE TOTAL, WHICH IS NOT THE SAME ADDITION ON BOTH ARRANGEMENTS.
 *
 * Only the directly-paid share adds: the passed-on share is already
 * inside the supplier's figure, and this is the sum that was being got
 * wrong everywhere.
 */
export function totalCommissionOnReferrals(supplierCommission: number, split: AgencyShareSplit): number {
  return supplierCommission + split.paidDirectByOpndoor;
}

/* =====================================================================
   THE WORDS.

   Matt has given each of these exactly, across (q), (bp), (ce) and
   (cf). They are constants rather than strings at six call sites for
   the same reason the fold is one function: six surfaces describing
   one arrangement in five wordings is how a reader stops believing any
   of them.
   ===================================================================== */

/** The supplier's headline. (ce): not "Commission payable". */
export const OWED_TO_YOU = 'Owed to you';

/** The statement's version of the same figure. (cf). */
export const PAYABLE_TO_YOU = 'Payable to you';

/** Siblings: two payments, and this one is opndoor's to the agency. */
export const PAID_DIRECT_BY_OPNDOOR = 'Paid by opndoor directly to your agencies';

/** Carved: inside the figure above it. (q), (cf). */
export const PASSED_ON_BY_SUPPLIER = 'Your agencies’ share, included above for you to pass on';

/** Named as a total, so it is never mistaken for what is payable. (q). */
export const TOTAL_ON_YOUR_REFERRALS = 'Total commission on your referrals';

/**
 * WHAT A BREAKDOWN'S AGENT COLUMN SAYS INSTEAD OF A SECOND FIGURE.
 *
 * Matt (bp): "show a carved-out share as 'Included in supplier
 * commission: GBP 378.90' or similar, never as a second payable
 * amount." (bq) asks for the same on the Application export, "consistently
 * with the Performance export fix", so the sentence is built here.
 *
 * `money` is passed in rather than formatted here: the exports format
 * money as text and the screens format it as a number, and a helper
 * that picked one would be wrong on the other.
 */
export function includedInSupplierCommission(money: string): string {
  return `Included in supplier commission: ${money}`;
}

/** The bare label, where a column header or a cell has no room for the figure. */
export const INCLUDED_IN_SUPPLIER_COMMISSION = 'Included in supplier commission';

/**
 * WHO PAYS THIS AGENCY, in the words a deal page uses.
 *
 * (kk): "who pays it per the supplier's current setting ('Kestrel
 * Lettings pays this agency' or 'Opndoor pays this agency directly')".
 *
 * THIS ONE READS THE CURRENT SETTING, NOT THE FROZEN FLAG, and the
 * difference is deliberate -- Matt called it out himself. On a
 * statement the wording follows what was frozen, because that is what
 * was paid. On a deal page there is no referral to freeze: the page
 * describes the arrangement as it stands.
 */
export function whoPaysThisAgency(supplierName: string, opndoorPaysAgentsNow: boolean): string {
  return opndoorPaysAgentsNow
    ? 'Opndoor pays this agency directly'
    : `${supplierName} pays this agency`;
}
