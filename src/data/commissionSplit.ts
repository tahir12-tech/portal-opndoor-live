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
import { getPartner } from './partnersService';

/**
 * Is this application on the AGENT RAIL — one of our agencies, who earn the
 * commission themselves — or the supplier rail, where the partner does?
 *
 * The ESTATE, read off the route partner, exactly as is_agent_estate does in
 * SQL. Never the application's own referencing_mode: Regent are one of ours and
 * reference their own tenants, and keying this on the journey would pay their
 * commission to a partner that does not exist.
 *
 * This is why the dashboard shows an agency no partner commission. On the agent
 * rail there is no supplier to pass a cut to; applications.partner_rate is still
 * populated (resolve_rates fills it on every row) and multiplying by it invents
 * a payable that nobody owes and nobody will ever be invoiced for.
 */
export function agentRailApp(app: FullApp): boolean {
  return getPartner(app.partner)?.referencingMode === 'opndoor_referenced';
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

/** A payee with money attached, for a specific application. */
export interface PayeeAmount {
  key: string;
  level: CommissionLine['level'];
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
export function payeeKey(level: CommissionLine['level'], orgId: string | null, orgName: string): string {
  return `${level}:${orgId ?? `name/${orgName.trim().toLowerCase()}`}`;
}

/**
 * The commission lines an application actually pays.
 *
 * Returns the frozen split when there is one, else a single agency line
 * reconstructed from the scalar. Never returns an empty array for an application
 * that earned anything, so no caller has to special-case "no lines".
 */
export function linesFor(app: FullApp): CommissionLine[] {
  const frozen = app.commissionLines;
  if (frozen && frozen.length) return frozen;
  return [{ level: 'agency', orgId: null, orgName: app.agency || '(unknown agency)', rate: app.agentRate ?? 0 }];
}

/** The total share of the fee this application pays out across every payee. */
export function totalRate(app: FullApp): number {
  return linesFor(app).reduce((s, l) => s + (l.rate || 0), 0);
}

/** Lines with money on them, for a fee base (the rent, as everywhere else). */
export function payeesFor(app: FullApp, feeBase: number): PayeeAmount[] {
  return linesFor(app).map((l) => ({
    key: payeeKey(l.level, l.orgId, l.orgName),
    level: l.level,
    orgId: l.orgId,
    orgName: l.orgName,
    rate: l.rate,
    amount: feeBase * (l.rate || 0),
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
  level: CommissionLine['level'],
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
  level: CommissionLine['level'],
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
