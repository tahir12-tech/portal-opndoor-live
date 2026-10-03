/* "NO DEAL SUPPLIER" WAS CREATED AT 16:41 AND HAD 25%/10% ON IT.
 *
 * Matt, 2026-10-03, verbatim: "Blocker: 'No Deal Supplier', created via Add
 * supplier at 16:41 today, still shows '25% of the fee, agencies 10%' on its
 * Overview, so new suppliers are still getting a default deal despite
 * 7b5b848. Find where the 25%/10% still comes from (database defaults, the
 * RPC, the form, or the screen showing a fallback when the rates are empty),
 * fix it, and prove it on dev by creating a supplier and showing its rates
 * are empty and every screen says 'No deal set'."
 *
 * HE LISTED FOUR CANDIDATES AND IT WAS THE LAST TWO, BOTH ON THE CLIENT.
 * Measured on dev before touching anything:
 *
 *   the columns     `partners.partner_rate` and `agent_rate` have no default
 *                   and are nullable. 7b5b848 really did remove them.
 *   the RPC         `create_partner`'s rate parameters default to NULL and
 *                   it inserts them straight through. Also clean.
 *   the row         no-deal-supplier holds 0.2500 / 0.1000. So the values
 *                   were SENT, not defaulted.
 *
 * WHICH LEAVES THE FORM AND THE SCREEN, and both were guilty:
 *
 *   1. PartnerManagement held `useState('25')` and `useState('10')` with
 *      nothing on the form bound to them -- commission moved to the
 *      Commission tab and the dialog's own toast says so -- and `save()`
 *      shipped them to addPartner on every creation. Dead form state that
 *      was still the deal.
 *   2. addPartner then did `input.partnerRate ?? DEFAULT_PARTNER_RATE`, so
 *      even a caller that sent nothing got 25% put back before the RPC saw
 *      a null.
 *   3. And `getRatesFor` substituted 25% for a null on the way OUT, so the
 *      supplier Overview's own `?? null` could never fire and
 *      SupplierDeals' "No commission deal set" was unreachable. That is the
 *      fallback Matt guessed at, and it would have kept the symptom alive
 *      after 1 and 2 were fixed.
 *
 * A FOURTH, ONE STEP LATER: the settings form passed `cur.partnerRate ?? 0.25`
 * back on every EDIT, so the first time anybody changed a dealless supplier's
 * name or status it would have silently acquired a deal.
 *
 * PROVED ON DEV: create_partner called with the arguments the fixed form now
 * sends produced zzz-proof-no-deal with partner_rate and agent_rate both
 * null, and it is the only dealless supplier on dev. No Deal Supplier's own
 * row is untouched, as Matt asked.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addPartner, getRatesFor, hydratePartners } from './partnersService';
import type { Partner } from './types';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

afterEach(() => hydratePartners([]));

describe('the form', () => {
  const FORM = code('src/pages/PartnerManagement/PartnerManagement.tsx');

  it('holds no rate state, because it has no rate field', () => {
    expect(FORM).not.toContain("useState('25')");
    expect(FORM).not.toContain("useState('10')");
    expect(FORM).not.toContain('readRate(');
  });

  it('and sends no rates when it creates a supplier', () => {
    expect(FORM).not.toContain('partnerRate: pr, agentRate: ar');
    expect(FORM).toContain('name: name.trim(), since: since || undefined, status,');
  });

  /* THE EDIT PATH PASSES WHAT IS STORED, AND NULL IS ONE OF THE THINGS
     THAT CAN BE STORED. `?? 0.25` here meant the first edit of any other
     setting wrote a deal onto a supplier that had none. */
  it('and passes a stored null straight back on an edit', () => {
    expect(FORM).toContain('partnerRate: cur.partnerRate ?? null, agentRate: cur.agentRate ?? null');
    expect(FORM).not.toContain('cur.partnerRate ?? 0.25');
  });
});

describe('addPartner', () => {
  it('sends null rather than putting the default back', () => {
    const SRC = code('src/data/partnersService.ts');
    expect(SRC).toContain('p_partner_rate: input.partnerRate ?? null');
    expect(SRC).toContain('p_agent_rate: input.agentRate ?? null');
    expect(SRC).not.toContain('DEFAULT_PARTNER_RATE');
    expect(SRC).not.toContain('DEFAULT_AGENT_RATE');
  });

  /* AND NULL READS BACK AS NULL. `Number(null)` is 0, which is Letly's
     deliberate deal and the one thing "no deal" must never be read as. */
  it('and reads a null rate back as null, not as 0', () => {
    expect(code('src/data/partnersService.ts'))
      .toContain('partnerRate: row.partner_rate == null ? null : Number(row.partner_rate)');
  });

  it('so a supplier created with no rates has none', async () => {
    hydratePartners([]);
    const made = await addPartner({ name: 'ZZZ Nothing Agreed' });
    expect(made.partnerRate).toBeNull();
    expect(made.agentRate).toBeNull();
  });

  it('while a supplier created WITH rates keeps them', async () => {
    hydratePartners([]);
    const made = await addPartner({ name: 'ZZZ Agreed', partnerRate: 0.3, agentRate: 0.12 });
    expect(made.partnerRate).toBe(0.3);
    expect(made.agentRate).toBe(0.12);
  });
});

describe('getRatesFor', () => {
  const PARTNERS = [
    { id: 'zzz-none', name: 'ZZZ None', partnerRate: null, agentRate: null },
    { id: 'zzz-zero', name: 'ZZZ Zero', partnerRate: 0, agentRate: 0 },
    { id: 'zzz-deal', name: 'ZZZ Deal', partnerRate: 0.25, agentRate: 0.1 },
  ].map((p) => ({ ...p, status: 'active', since: '2026-01', weight: 1, users: 0, apps: 0, kind: 'supplier' })) as unknown as Partner[];

  /* ZERO, NOT 25%, and zero is what SQL says: resolve_rates ends in a
     coalesce to 0 since 20261007680000 so a dealless supplier's referrals
     are recorded rather than refused. This is the client's mirror of it. */
  it('answers 0 for a partner with no deal, not the standard rate', () => {
    hydratePartners(PARTNERS);
    expect(getRatesFor('zzz-none')).toEqual({ partner: 0, agent: 0 });
  });

  it('and still answers a real deal, including a deliberate 0%', () => {
    hydratePartners(PARTNERS);
    expect(getRatesFor('zzz-deal')).toEqual({ partner: 0.25, agent: 0.1 });
    expect(getRatesFor('zzz-zero')).toEqual({ partner: 0, agent: 0 });
  });
});

describe('the supplier Overview', () => {
  /* IT READS THE PARTNER'S OWN RATES NOW. getRatesFor returns a number and
     "0%" and "no deal set" are different sentences, so a screen that shows
     a deal cannot ask it. */
  it('asks the row, not the rate resolver', () => {
    const HOME = code('src/pages/PartnerManagement/PartnerHome.tsx');
    expect(HOME).toContain('total={partner.partnerRate ?? null}');
    expect(HOME).toContain('agentShare={partner.agentRate ?? null}');
    expect(HOME).not.toContain('total={rates.partner ?? null}');
  });

  /* AND THE SENTENCE IT THEN REACHES, which existed all along and could
     not be got to. */
  it('and SupplierDeals says "No commission deal set" for a null', () => {
    expect(read('src/pages/PartnerManagement/SupplierDeals.tsx')).toContain("'No commission deal set.'");
  });
});

/* THE DEMO PATH SAYS THE SAME THING, so the two estates cannot drift on the
   one state this is about. */
describe('mock mode', () => {
  it('creates a supplier with no deal either', () => {
    expect(code('src/data/partnersService.ts')).toContain('partnerRate: input.partnerRate ?? null');
  });
});
