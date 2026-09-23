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
import type { CommissionLine } from './types';
import type { FullApp } from './applicationsService';

/** A payee with money attached, for a specific application. */
export interface PayeeAmount {
  key: string;
  level: CommissionLine['level'];
  orgId: string | null;
  orgName: string;
  rate: number;
  amount: number;
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
  }));
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
  const norm = (x?: string | null) => (x ?? '').trim().toLowerCase();
  return linesFor(app)
    .filter((l) => l.level === level
      && (l.orgId && orgId ? l.orgId === orgId : norm(l.orgName) === norm(orgName)))
    .reduce((s, l) => s + (l.rate || 0), 0);
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
