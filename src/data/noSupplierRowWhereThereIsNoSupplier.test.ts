/* A SETTLEMENT STATEMENT NAMES A SUPPLIER ONLY WHERE THERE IS ONE.
 *
 * Matt, 2026-10-03: "Settlement statements for Opndoor's own agencies:
 * remove the 'Supplier: Agency referral' row and '(Agency referral)' from the
 * heading; show the Supplier row only when the agency came through a
 * supplier."
 *
 * IT WAS KEYED ON THE READER, WHICH IS A DIFFERENT QUESTION. The row was
 * `forAgency ? [] : [Supplier]`, and `forAgency` is `isAgencyUser` -- "is an
 * agency reading this". So an ADMIN reading one of Opndoor's own agencies'
 * statements got a Supplier row, and the value was `partnerName` of
 * `opndoor-agents`, which prints as "Agency referral". House plumbing on a
 * customer-facing document, naming a supplier that does not exist, on a
 * statement for an agency that never came through one.
 *
 * The reader question still decides the commission wording, which genuinely
 * does differ by who is reading. This one is about the PARTY, so it asks
 * `partyIsSupplier` -- the same predicate the Suppliers list, the route table
 * and the via-labels ask, and the one that stopped reading referencing mode
 * yesterday.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hydratePartners } from './partnersService';
import { partyIsSupplier } from './capabilities';
import type { Partner } from './types';

const PARTNERS = [
  { id: 'opndoor-agents', name: 'Opndoor Agents', kind: 'agency', isHouse: true },
  { id: 'kestrel-lettings', name: 'Kestrel Lettings', kind: 'supplier' },
].map((p) => ({ ...p, status: 'active', since: '2026-01-01', weight: 1, users: 0, apps: 0,
  partnerRate: 0.25, agentRate: 0.1, primary: false })) as unknown as Partner[];

afterEach(() => { hydratePartners([]); });

const SRC = readFileSync(join(process.cwd(), 'src/data/exportsService.ts'), 'utf8');

describe('the predicate the statement now asks', () => {
  it('says no for the house agency rail, which is what our own agencies sit on', () => {
    hydratePartners(PARTNERS);
    expect(partyIsSupplier('opndoor-agents')).toBe(false);
  });

  it('and yes for a real supplier, so its agencies keep the row', () => {
    hydratePartners(PARTNERS);
    expect(partyIsSupplier('kestrel-lettings')).toBe(true);
  });
});

/* THE WIRING, on the source. The arithmetic of this document is covered by
   theExportAndTheStatementAgree; what is asserted here is which question the
   two lines ask, because the defect was asking the right question of the
   wrong subject and both versions type-check. */
describe('buildAgentStatementDoc', () => {
  it('shows the Supplier row on the party, not on the reader', () => {
    expect(SRC).toContain("...(partyIsSupplier(partner) ? [{ label: 'Supplier', value: partnerLabel }] : []),");
    expect(SRC).not.toContain("...(forAgency ? [] : [{ label: 'Supplier', value: partnerLabel }]),");
  });

  it('and puts the supplier in the heading on the same test', () => {
    expect(SRC).toContain('const payeeBit = partyIsSupplier(partner) ? `${payee} (${partnerLabel})` : payee;');
    expect(SRC).not.toContain('const payeeBit = forAgency ? payee : `${payee} (${partnerLabel})`;');
  });

  /* THE HALF THAT MUST NOT MOVE. "Commission earned" vs "Agent commission"
     is genuinely the reader's question: the agency is told what it earned,
     Opndoor is told what it owes an agent. A sweep that replaced every
     `forAgency` with the party predicate would change that wording too. */
  it('while the commission wording still follows the reader', () => {
    expect(SRC).toContain("{ label: 'Commission type', value: forAgency ? 'Commission earned' : 'Agent commission' },");
  });
});
