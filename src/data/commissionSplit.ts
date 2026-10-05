/* =====================================================================
   THE ONE PLACE that turns an application into commission lines.

   Agent-rail applications created since the additive model carry a frozen split:
   one line per payee (group, agency and/or branch), snapshotted at creation.
   Everything older carries only the scalar applications.agent_rate.

   THE FALLBACK IS A RULE, NOT A DETAIL. A historic row has no lines, and the
   money it earned was always the referring AGENCY's. So it resolves to a single
   agency line at the scalar rate. Settlement, League, Dashboard and exports all
   call linesFor() and none of them implements this itself — the previous shape of
   this code, where four surfaces each multiplied fees by a rate they looked up
   their own way, is exactly how they drifted apart.

   Supplier-rail applications are NOT part of this: their commission is
   partner_rate, paid to the partner, and it is read directly as before.
   ===================================================================== */
import type { CommissionLine, CommissionSource } from './types';
import type { FullApp } from './applicationsService';
import { isDirectRail } from './channel';
import { partyIsOurEstate, partyIsSupplier } from './capabilities';
import { getPartner } from './partnersService';
import { plural } from '@/lib/plural';

/**
 * Is this application on the AGENT RAIL — one of our agencies, who earn the
 * commission themselves — or the supplier rail, where the partner does?
 *
 * The ESTATE, read off the route partner, exactly as is_agent_estate does in
 * SQL. Never a referencing_mode -- not the application's, and since 2026-10-02
 * not the partner's either. Regent are one of ours and reference their own
 * tenants, and keying this on the journey would pay their commission to a
 * partner that does not exist; keying it on the PARTNER's journey had the
 * mirror fault, moving a supplier onto the agent rail the moment an admin
 * changed its mode, which stopped the settlement listing it.
 *
 * This is why the dashboard shows an agency no partner commission. On the agent
 * rail there is no supplier to pass a cut to; applications.partner_rate is still
 * populated (resolve_rates fills it on every row) and multiplying by it invents
 * a payable that nobody owes and nobody will ever be invoiced for.
 */
export function agentRailApp(app: FullApp): boolean {
  return partyIsOurEstate(app.partner);
}

/** How a source reads on screen. One map, so the agency page, the dashboard and
    the commission statement cannot disagree about what 'agreement' is called. */
export const SOURCE_LABEL: Record<CommissionSource, string> = {
  standard: 'Opndoor standard',
  agreement: 'Agreement',
  rate: 'Set rate',
};

/** The distinct sources across a set of lines, in a stable order, with unknown
    (a historic line) dropped rather than counted as 'standard'. */
export function sourcesOf(lines: CommissionLine[]): CommissionSource[] {
  const order: CommissionSource[] = ['agreement', 'rate', 'standard'];
  const seen = new Set(lines.map((l) => l.source).filter(Boolean) as CommissionSource[]);
  return order.filter((s) => seen.has(s));
}

/**
 * The amount commission is a share OF.
 *
 * Historically this was the rent, because the guarantee fee WAS one month's rent
 * and no fee was stored. M1 made the fee a real snapshotted value, so this is the
 * fee — identical to the rent on every application created before deal-shape
 * pricing, and the single line that makes a 3- or 5-week fee flow through every
 * surface at once. Callers must not reach for `rent` themselves.
 */
export function feeBaseFor(app: FullApp): number {
  return app.fee ?? app.rent ?? 0;
}

/* THE THREE ORG LEVELS, named so the compiler knows what `linesFor` has
   already guaranteed: it filters 'supplier' out, so nothing downstream of
   it can carry one. Without this every payee, settlement row and
   statement line widens to admit a level they can never hold, and the
   first `switch` over them grows a branch nobody can reach. */
export type AgencyLevel = 'group' | 'agency' | 'branch';

/** A payee with money attached, for a specific application. */
export interface PayeeAmount {
  key: string;
  level: AgencyLevel;
  orgId: string | null;
  orgName: string;
  rate: number;
  amount: number;
  /** Where the rate came from, or null on a historic line that never recorded it. */
  source: CommissionSource | null;
}

/** Stable identity for a payee. Prefers the org id; a historic row has only a
    name, so the name is the fallback key and is namespaced by level so a branch
    and an agency of the same name never merge. */
export function payeeKey(level: AgencyLevel, orgId: string | null, orgName: string): string {
  return `${level}:${orgId ?? `name/${orgName.trim().toLowerCase()}`}`;
}

/* =====================================================================
   READ THE AMOUNT. DO NOT RECOMPUTE IT.

   Matt, 2026-10-02: "GR-20846 shows agent commission £265.39 here and
   £265.38 on Regent's commission statement. Every export, statement and
   screen must take commission from the same stored amount, never
   recalculate and round differently."

   GR-20846 ON DEV, exactly: fee £1,061.54, agency rate 0.25, and a
   frozen line whose stored amount is £265.38. 1061.54 x 0.25 is
   265.385, which rounds UP to 265.39 the moment anything multiplies it
   out. The statement reads the stored line; the export multiplied. One
   penny, on every half-penny, on a document a payee reconciles against.

   THE STORED AMOUNT IS NOT fee x rate ROUNDED, which is why no rounding
   rule here could have fixed it. A tenancy is priced once and the
   commission apportioned across its tenants with the last line taking
   the remainder, so GR-20845 and GR-20846 sum to the tenancy's £576.92
   and not to the £576.93 two independently-rounded lines produce. The
   server did that arithmetic and wrote the answer down; the only way to
   agree with it is to read it.

   `payeesFor` has preferred the frozen amount since that apportionment
   landed. These two are the readers for the callers that were still
   multiplying a rate -- the aggregate, the rankings, the trend and the
   application export -- so there is one answer to "what did this earn"
   and not five.

   THE SUPPLIER CUT IS NOT IN HERE, and cannot be: application_commission
   _lines carries agency, group and branch levels only. A supplier's
   share has no stored line to read, so it stays fee x partner_rate at
   every caller, which is what it has always been. Worth stating, because
   "take commission from the stored amount" reads as universal and is
   not.
   ===================================================================== */

/** What the agency side earns on this application, read from the frozen
    lines. The fee base is the application's own, so no caller can pass a
    different one and get a different answer. */
export function agentAmountOf(app: FullApp): number {
  return payeesFor(app, feeBaseFor(app)).reduce((s, p) => s + p.amount, 0);
}

/**
 * WHAT THE AGENCY EARNED, WHICH IS NOT WHAT OPNDOOR PAYS.
 *
 * `agentAmountOf` sums `payeesFor`, and payeesFor deliberately returns
 * NOTHING on a carved referral: opndoor pays the supplier once and the
 * supplier passes the agency's share on, so the agency is not a payee of
 * ours. That is right, and it made every "what did this agency earn"
 * reader answer zero on exactly the referrals Matt was asking about.
 *
 * Matt (dd): "the 'Your agencies' share, included above for you to pass
 * on GBP 378.90' line is missing for October (GR-26262/3 are frozen
 * 'supplier pays its own agents')". And (kk): "'What they earned' must
 * list GR-26262/3 (GBP 378.90 for October), not 'No commission accrued'."
 *
 * THE FROZEN AGENCY LINE EXISTS IN BOTH ARRANGEMENTS -- payeesFor's own
 * comment says so: "the frozen agency line still EXISTS and is still
 * right ... but it is not a thing Opndoor pays". So the earnings are
 * there to be read; nothing was asking for them.
 *
 * THIS IS THE INPUT TO whoPaysTheAgency, NOT A SECOND ANSWER TO IT. The
 * split decides where the money is reported; this decides how much there
 * is. Feeding the fold `agentAmountOf` fed it a zero on every carved
 * referral, so the carved bucket could never fill and the line could
 * never draw.
 */
export function agentEarnedOf(app: FullApp): number {
  const base = feeBaseFor(app);
  return linesFor(app)
    .filter((l) => l.level !== 'supplier')
    .reduce((s, l) => s + (l.amount == null ? base * (l.rate || 0) : l.amount), 0);
}

/** The same question asked of ONE org's lines, for a ranking that
    attributes an application to the agency or office that earned it. */
export function orgAmountOf(
  app: FullApp,
  level: AgencyLevel,
  orgId?: string | null,
  orgName?: string,
): number {
  const base = feeBaseFor(app);
  return orgLines(app, level, orgId, orgName)
    .reduce((s, l) => s + (l.amount == null ? base * (l.rate || 0) : l.amount), 0);
}

/**
 * The commission lines an application actually pays.
 *
 * Returns the frozen split when there is one, else a single agency line
 * reconstructed from the scalar. Never returns an empty array for an
 * application that earned anything -- and the direct rail earns nobody
 * anything, which is the exception below and the reason that promise now
 * needs the qualifier.
 *
 * ROUND 6, M9. The fallback arm INVENTED A PAYEE out of a direct-rail
 * application. Direct signups never go through create_referral, so
 * `application_commission_lines` holds nothing for them and every direct
 * row took that arm: `app.agency` is whatever agency the matcher attached
 * so a person could service it (or "Unattached"), and `app.agentRate` is
 * opndoor-direct's own rate. The result was a commission payee named after
 * a real agency, for business that agency never referred -- the client
 * twin of round 6's M5, and the literal row quoted in 20261006580000's
 * header.
 *
 * EXCLUDED FOR THE WHOLE FUNCTION, not just the fallback arm, because that
 * is how the server does it: 20261006580000 excludes the rail at the
 * `paid` CTE, above both split arms. So a direct row that somehow acquired
 * a frozen line is still nobody's.
 */
export function linesFor(app: FullApp): CommissionLine[] {
  if (isDirectRail(app.partner)) return [];
  /* THE AGENCY SIDE ONLY. 20261007580000 added a 'supplier' level to the
     same table, and every caller of this function -- the rankings, the
     settlement, the statement, the aggregate, totalRate -- is asking
     about the agency side. Filtering here rather than at each of them is
     the same reasoning this file opens with: four surfaces each doing
     their own version of one rule is how they drifted apart. The
     supplier's line is read by `supplierLineOf` and nothing else. */
  const frozen = (app.commissionLines ?? []).filter((l) => l.level !== 'supplier');
  if (frozen.length) return frozen;
  return [{ level: 'agency', orgId: null, orgName: app.agency || '(unknown agency)', rate: app.agentRate ?? 0 }];
}

/* =====================================================================
   AND WHAT OPNDOOR OWES THE SUPPLIER, READ THE SAME WAY.

   Matt, 2026-10-02: "Store supplier commission per application the same
   way agency commission is stored, and read it everywhere (statements,
   exports, reporting, settlements) instead of recalculating."

   This is the other half of the penny. `agentAmountOf` above reads a
   stored amount because the agency side had one; the supplier side did
   not, so eight callers each multiplied `feeBaseFor(app) *
   partnerRate` and each rounded on its own -- the same shape as
   GR-20846, waiting for the first supplier fee that lands on a half
   penny.

   THE FALLBACK IS THE OLD ARITHMETIC, for an application created before
   the line existed and never backfilled. It is exactly what that row
   has always been worth, and the same fallback `payeesFor` uses on an
   agency line frozen before the amount column.

   ZERO ON EVERY OTHER RAIL, and not by arithmetic: a house route's cut
   is Opndoor's own margin and an agency of ours has no supplier above
   it, so there is nobody to owe. `agentRailApp` is the test the
   aggregate has always used; `isHousePartner` covers the rest.
   ===================================================================== */

/** The supplier's frozen line, if this application has one. */
export function supplierLineOf(app: FullApp): CommissionLine | null {
  return (app.commissionLines ?? []).find((l) => l.level === 'supplier') ?? null;
}

/** What Opndoor owes the supplier on this application. */
export function supplierAmountOf(app: FullApp): number {
  if (isDirectRail(app.partner) || agentRailApp(app)) return 0;
  const line = supplierLineOf(app);
  if (line && line.amount != null) return line.amount;
  return feeBaseFor(app) * (line?.rate ?? app.partnerRate ?? 0);
}

/** The total share of the fee this application pays out across every payee. */
export function totalRate(app: FullApp): number {
  return linesFor(app).reduce((s, l) => s + (l.rate || 0), 0);
}

/** Lines with money on them, for a fee base (the rent, as everywhere else).

    THE FROZEN AMOUNT WINS where the line has one, so this agrees line for line
    with commission_statement_lines. They must: the statement is what a payee is
    paid and this is what the portal shows them, and a joint tenancy makes the two
    arithmetics differ. Rounding each line on its own let GR-20845 and GR-20846
    sum to £576.93 against a tenancy commission of £576.92, so the frozen amount
    is the tenancy's commission apportioned, with the last line taking the
    rounding.

    The fallback is feeBase x rate for a line frozen before the column existed,
    which is exactly what those rows have always been worth, and is also what the
    reconstructed single agency line for a historic row with no split is worth. */
/* =====================================================================
   DID THE SUPPLIER SETTLE ITS OWN AGENTS, AS FROZEN?

   The client's mirror of `settles_its_own_agents_frozen` in SQL, and it
   must stay one with it: the screen and the statement are the same money
   read twice.

   Matt, 2026-10-03: "If a referral is frozen under 'the supplier pays its
   own agents', the agency's share comes out of the supplier's total and
   Opndoor pays only the supplier." Under the other arrangement the two
   are separate payees and Opndoor owes their sum, which is what the
   Commission tab's worked example says and what the frozen rows store.

   OFF A SUPPLIER ESTATE THERE IS NOTHING TO DECIDE. Our own agencies and
   the direct rail have no supplier to carve anything out of, so this is
   false there and every agency line stays Opndoor's to pay.

   THE SNAPSHOT, THEN THE LIVE FLAG. A row frozen before the column
   existed has no snapshot, and for those the live flag is the same answer
   the product gave yesterday, so nothing regresses. `!= null` and not a
   truthiness test: `false` is a real answer here and the common one. */
function settlesItsOwnAgentsFrozen(app: FullApp): boolean {
  if (!partyIsSupplier(app.partner)) return false;
  if (app.opndoorPaysAgentsAtFreeze != null) return !app.opndoorPaysAgentsAtFreeze;
  return getPartner(app.partner)?.opndoorPaysAgents === false;
}

export function payeesFor(app: FullApp, feeBase: number): PayeeAmount[] {
  /* WHO OPNDOOR PAYS, WHICH IS NOT WHO EARNED IT. Under "the supplier
     pays its own agents" the frozen agency line still EXISTS and is
     still right -- it is the supplier's own record of what it owes that
     agency, and the per-agency schedules are built from it -- but it is
     not a thing Opndoor pays, so it is not a payee here. Exactly the
     filter `commission_statement_lines` applies in SQL, asking the same
     frozen fact. */
  if (settlesItsOwnAgentsFrozen(app)) return [];
  return linesFor(app).map((l) => ({
    key: payeeKey(l.level as AgencyLevel, l.orgId, l.orgName),
    level: l.level as AgencyLevel,
    orgId: l.orgId,
    orgName: l.orgName,
    rate: l.rate,
    amount: l.amount == null ? feeBase * (l.rate || 0) : l.amount,
    source: l.source ?? null,
  }));
}

/**
 * The lines belonging to ONE org, matched the way orgRate matches: by id where
 * both sides have one, else by name, which is how a historic row (one
 * reconstructed agency line, no ids) still attributes to its agency.
 */
export function orgLines(
  app: FullApp,
  level: AgencyLevel,
  orgId?: string | null,
  orgName?: string,
): CommissionLine[] {
  const norm = (x?: string | null) => (x ?? '').trim().toLowerCase();
  return linesFor(app).filter((l) => l.level === level
    && (l.orgId && orgId ? l.orgId === orgId : norm(l.orgName) === norm(orgName)));
}

/**
 * The share THIS org earns on this application.
 *
 * League and the volume charts rank ORGS, so an agency row must show what the
 * agency itself earns, not the whole payout: under a group taking 2%, the agency
 * earns 12% of a 14% payout and attributing all 14% to it would double-count the
 * group's cut against the agency's name.
 *
 * Matched by id where both sides have one, else by name, which is how a historic
 * row (one reconstructed agency line, no ids) still attributes to its agency.
 */
export function orgRate(
  app: FullApp,
  level: AgencyLevel,
  orgId?: string | null,
  orgName?: string,
): number {
  return orgLines(app, level, orgId, orgName).reduce((s, l) => s + (l.rate || 0), 0);
}

/** What a set of fees was a basis of. `phrase` is a bare noun phrase, so a
    caller can write "20% of {phrase}" or "{phrase} each" as its sentence needs;
    `kind` is what lets it choose, without matching on the words. */
export interface FeeBasis {
  kind: 'none' | 'uniform' | 'mixed';
  phrase: string;
}

/**
 * How the fees in a set were priced.
 *
 * Exists because "one month's rent" is printed under fee figures on four
 * surfaces, and for Regent it is true of nothing: their single-tenant fee is
 * three weeks and their joint fee is five. A sentence that states a price nobody
 * was charged is worse than no sentence.
 *
 * Read off each row's own fee and rent rather than off fee_basis_weeks, because
 * the basis has to be recomputed per applicant anyway: a tenancy is priced once
 * and charged by share, so a joint applicant's fee is a fraction of the
 * tenancy's, and dividing it by the whole rent would report every joint row as
 * a discount.
 */
export function feeBasisOf(apps: FullApp[]): FeeBasis {
  const weeks = new Set<string>();
  for (const a of apps) {
    const fee = feeBaseFor(a);
    const share = a.sharePercent != null && a.sharePercent > 0 ? a.sharePercent / 100 : 1;
    const base = (a.rent || 0) * share;
    if (base <= 0 || fee <= 0) continue;
    weeks.add(((fee * 52) / (base * 12)).toFixed(2));
  }
  if (weeks.size === 0) return { kind: 'none', phrase: '' };
  if (weeks.size > 1) return { kind: 'mixed', phrase: 'their agreed fee basis' };
  const w = Number([...weeks][0]);
  // One month is 52/12 weeks. The tolerance absorbs the rounding a fee carries
  // to the penny, not a genuinely different basis.
  if (Math.abs(w - 52 / 12) < 0.02) return { kind: 'uniform', phrase: "one month's rent" };
  return { kind: 'uniform', phrase: `${Number(w.toFixed(2))} weeks of rent` };
}

/**
 * The fee basis of ONE application, as a spreadsheet cell.
 *
 * Matt, 2026-10-02, about the application export: "Fee basis: show
 * '1 month' for one month's rent, and weeks only where the deal is in
 * weeks (e.g. '5 weeks')."
 *
 * THE COLUMN HELD A NUMBER AND A UNIT IN ITS HEADING: "Fee basis (weeks
 * of rent)" over a cell reading 4.35. That is one month, written as the
 * number of weeks in one, and nobody reconciling a spreadsheet reads
 * 4.35 as a month. The two bases a deal is actually written in are weeks
 * and months, so the cell says which.
 *
 * SAME 52/12 TEST `feeBasisOf` USES, and the same tolerance, because the
 * fee is stored to the penny and the division never lands exactly. Two
 * answers to "is this a month" would be worse than the heading was.
 */
export function feeBasisCell(app: FullApp): string {
  const fee = feeBaseFor(app);
  const share = app.sharePercent != null && app.sharePercent > 0 ? app.sharePercent / 100 : 1;
  const base = (app.rent || 0) * share;
  if (base <= 0 || fee <= 0) return '';
  const w = (fee * 52) / (base * 12);
  if (Math.abs(w - 52 / 12) < 0.02) return '1 month';
  const n = Number(w.toFixed(2));
  return `${n} ${plural(n, 'week')}`;
}

/** Accumulator for "sum commission per payee across many applications". */
export class PayeeTotals {
  private readonly map = new Map<string, PayeeAmount>();

  add(app: FullApp, feeBase: number): void {
    for (const p of payeesFor(app, feeBase)) {
      const cur = this.map.get(p.key);
      if (cur) { cur.amount += p.amount; }
      else { this.map.set(p.key, { ...p }); }
    }
  }

  /** Largest payee first, which is how every settlement surface sorts. */
  list(): PayeeAmount[] {
    return [...this.map.values()].sort((a, b) => b.amount - a.amount);
  }

  total(): number {
    return [...this.map.values()].reduce((s, p) => s + p.amount, 0);
  }

  /** The agency rollup: an agency's OWN lines only, per the ruling. Group and
      branch payees are their own lines and are deliberately not folded in. */
  agencyRollup(): PayeeAmount[] {
    return this.list().filter((p) => p.level === 'agency');
  }
}
