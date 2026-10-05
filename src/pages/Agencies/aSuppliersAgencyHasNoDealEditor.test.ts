/* =====================================================================
   A SUPPLIER'S AGENCY HAS NO DEAL EDITOR, AND ITS DEAL IS STILL VISIBLE.

   Matt (gg), verbatim: "an agency or office inside a supplier's estate
   must not have its own commission editor; its deal is set only on the
   supplier's Commission tab under 'Agencies on different terms'. Remove
   the deal editor from supplier-estate agency pages (show 'Commission
   for this agency is set on [supplier]'s Commission tab', linking
   there). ... The Commission tab must also still show any agency- or
   group-scope deal that already exists, so nothing can be hidden."

   WHY BOTH HALVES ARE IN ONE FILE. They are one rule read in two
   directions: the deal for a supplier's agency is the supplier's
   business, so the agency's page may not write it and the supplier's
   page must show it. Split across two files, somebody removes the
   editor, the surfacing is never built, and the deal that is already
   written becomes invisible to every screen at once -- which is worse
   than the fault being fixed, because before (gg) the agency's page at
   least showed it.

   =====================================================================
   WHAT THE EDITOR ACTUALLY DID, WHICH IS WHY THE RULE IS NOT COSMETIC
   =====================================================================

   e4b75778 on dev: scope 'agency', kind 'commission', live since
   2026-10-01, written against Kestrel's own "Kestrel Lettings". Measured
   on dev with resolve_fee and resolve_rates at a GBP 1,000 rent:

     tenants   fee with the deal   fee without it   rates
     1         1000.00 (1 month)   1000.00          25% / 10%
     2         1153.85 (5 weeks)   1000.00          25% / 10%
     3         1384.62 (6 weeks)   1000.00          25% / 10%

   So its headline percentages -- 12, 20, 24 -- reach NOTHING.
   resolve_rates takes the commission rate only `where scope_level =
   'partner'`, and an agency-scope row is not that; the agents' share
   comes from the supplier's own share deal. What the deal really did was
   move the TENANT'S FEE on joint tenancies, by 15% at two tenants and
   38% at three, from a screen that showed percentages.

   A deal that does something other than what it appears to say, on a
   page that is not the one where deals are agreed, is the whole of (gg).

   SOURCE ASSERTIONS, DELIBERATELY. The alternative is rendering
   AgencyHome against a supplier-estate fixture, and the thing under test
   is the ABSENCE of two buttons -- a render test for an absence passes
   just as well when the page fails to mount, which is how a gate gets
   reported as working after it has been deleted. These pin the gate
   itself.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const PAGE = read('src/pages/Agencies/AgencyHome.tsx');
const CAPS = read('src/data/capabilities.ts');
const TAB = read('src/pages/PartnerManagement/SupplierDeals.tsx');

describe('the rule', () => {
  /* ASKED OF THE ESTATE, NOT OF THE READER -- the same shape as
     `hasLogins`, and for a sharper reason: the admin is exactly who
     created e4b75778. A gate keyed on the reader would hide the button
     from the supplier, who never had it, and leave it for the one person
     who used it. */
  it('is about the agency, not about who is reading', () => {
    expect(CAPS).toContain('export function dealIsSetBySupplier(scope: PartnerScope): boolean {');
    expect(CAPS).toContain('return partyIsSupplier(scope);');
    expect(PAGE).toContain('const dealSetBySupplier = dealIsSetBySupplier(partner);');
    expect(PAGE).not.toMatch(/dealSetBySupplier = [^\n]*role ===/);
  });
});

describe('the agency page', () => {
  it('has no "Set a deal" button on a supplier-estate agency', () => {
    expect(PAGE).toContain('const editBtn = isAdmin && target && !dealSetBySupplier');
  });

  /* BOTH ARMS. One opens the rate field, the other walks the reader to
     the tab that does -- so removing only the first leaves a working
     route to the editor, which is the kind of half-fix this suite
     exists to catch. */
  it('and neither arm of the rate editor, not even the one that only links', () => {
    expect(PAGE).toContain("{!dealSetBySupplier && isAdmin && rowKey && !editing && onCommissionTab && (");
    expect(PAGE).toContain("{!dealSetBySupplier && isAdmin && rowKey && !editing && !onCommissionTab && (");
  });

  it('and says where the deal is set instead, linking there', () => {
    expect(PAGE).toContain('Commission for this agency is set on');
    expect(PAGE).toContain('?tab=commission');
    expect(PAGE).toContain('{supplierName}&rsquo;s Commission tab');
  });

  /* THE SENTENCE IS NOT A SUBSTITUTE FOR THE DEAL. An agency that
     already holds one still shows it; (gg) removes the editor, not the
     record. */
  it('while a deal that already exists is still shown, read-only', () => {
    expect(PAGE).toContain('{dealSetElsewhere && <p className="ah-agr__std">{dealSetElsewhere}</p>}');
  });
});

describe('(de) the rest of the tab, which used to contradict it', () => {
  /* Fixing one card on a four-card tab left a reader looking at two
     answers with no way to tell which is current, which is worse than
     before. Both of the others read the 'commission' kind -- what
     opndoor pays the ROUTE, which on this rail is the supplier -- so
     they were answering the same wrong question the Agreement card
     used to. */
  it('drops "Rates set" and "What each branch pays out" for a supplier-estate agency', () => {
    expect(PAGE).toContain('{!dealSetBySupplier && (\n        <Card>\n          <CardHead\n            title="Rates set"');
    expect(PAGE).toContain('{!dealSetBySupplier && (\n        <Card>\n          <CardHead title="What each branch pays out"');
  });

  /* WHAT THEY EARNED STAYS, because it is a different question: the
     rate cards say what the deal is, this says what it produced, and
     an agency in a supplier's estate earns real money. It read "No
     commission accrued" only because agentAmountOf returns zero on a
     carved referral -- fixed separately, in agentEarnedOf. */
  it('but keeps "What they earned", which is a question it can answer', () => {
    const tail = PAGE.slice(PAGE.indexOf('title="What they earned"') - 400);
    expect(tail).toContain('title="What they earned"');
    expect(PAGE).not.toContain('{!dealSetBySupplier && (\n        <CommissionStatement');
  });
});

describe('the supplier Commission tab', () => {
  /* THE OTHER HALF. supplier_share_deals asks scope_level 'partner' and
     kind 'agent_share' -- every deal this tab can write, and so exactly
     the set that cannot contain the problem. */
  it('reads the deals it did not write', () => {
    expect(TAB).toContain('getSupplierOfftabDeals(slug)');
    expect(TAB).toContain('Deals set somewhere else');
  });

  it('and keeps them out of its own list, rather than claiming it set them', () => {
    expect(TAB).toMatch(/const \[offtab, setOfftab\] = useState<OfftabDeal\[\]>\(\[\]\);/);
    expect(TAB).not.toMatch(/setShares\(\[\.\.\.\w+, \.\.\.o\]\)/);
  });

  /* NO LINK BACK TO THE EDITOR. Offering one would reopen the door the
     card exists to report. */
  it('and offers no way back to the editor (gg) removed', () => {
    const card = TAB.slice(TAB.indexOf('Deals set somewhere else'));
    const end = card.indexOf('{editing ===');
    expect(card.slice(0, end > 0 ? end : undefined))
      .not.toMatch(/onClick=\{\(\) => setEditing/);
  });
});
