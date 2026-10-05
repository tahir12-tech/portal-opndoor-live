/* =====================================================================
   A RENAME MUST NOT LOSE THE REFERRALS.

   Matt (ct), verbatim: "After renaming an agency (Test Lettings asda
   -> Test Lettings asdah, as Kestrel Management), its Referrals tab
   says 'No referrals for Test Lettings asda yet' though the header
   shows 2 referrals; the old name also lingers in the breadcrumb on
   that tab. Referrals (and anything else) must be found by the
   agency's/office's id, never by name. Check every screen, statement,
   export and the commission schedules for name-based matching, fix
   them, and test a rename end to end."

   =====================================================================
   WHAT IT ACTUALLY WAS, AND WHY THE HEADER DISAGREED WITH THE TAB
   =====================================================================

   Two different reads, one live and one stale.

   `referrals` is rebuilt from the live agency tree, so after a rename
   both sides move together and the HEADER count stayed right. `sel` is
   seeded once when the page opens and is never re-resolved, so
   `sel.name` was still the OLD name -- the filter matched nothing, and
   the empty state then printed that stale name back at the reader.
   Hence a message naming an agency that no longer exists, under a
   header saying there are two.

   THE ID WAS ALREADY ON BOTH SIDES. `sel.id` is the agency's own and
   `r.agencyId` is on every summary row -- added on 2026-10-04 with the
   comment "the list rows are what every FILTER reads". Nothing had to
   be fetched; the filter simply was not using it.

   =====================================================================
   WHAT THIS FILE DOES NOT CLAIM
   =====================================================================

   It is a unit test of the two predicates, not a render. The render
   path needs a live hydrate to carry ids at all -- under vitest
   `agencyId` is absent on seed rows, which is exactly why both
   predicates keep a name fallback. So this asserts the RULE, including
   that the fallback still works where there is no id, and the fallback
   is the half a careless "match by id" change would have broken: it
   would have emptied the demo.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE = readFileSync(join(process.cwd(), 'src/pages/Agencies/AgencyHome.tsx'), 'utf8');

type Row = { agency: string; branch: string; agencyId?: string; branchId?: string };
type Sel = { id?: string; name: string };

/** The Referrals tab's agency filter, as the page applies it. */
const byAgency = (r: Row, sel: Sel, selName: string) =>
  (r.agencyId && sel.id ? r.agencyId === sel.id : r.agency === selName);
const byBranch = (r: Row, sel: Sel, selName: string) =>
  (r.branchId && sel.id ? r.branchId === sel.id : r.branch === selName);

describe('after an agency is renamed', () => {
  /* THE EXACT CASE. The row carries the new name because it is joined
     live; `sel` still carries the old one because it was seeded when
     the page opened. */
  const sel: Sel = { id: 'ag-1', name: 'Test Lettings asda' };
  const row: Row = { agency: 'Test Lettings asdah', branch: 'Head office', agencyId: 'ag-1' };

  it('its referrals are still found', () => {
    expect(byAgency(row, sel, 'Test Lettings asdah')).toBe(true);
  });

  /* AND THE OLD BEHAVIOUR IS NAMED, so the regression is recognisable
     rather than just absent. */
  it('where matching on the stale name found none', () => {
    expect(row.agency === sel.name).toBe(false);
  });

  it('and an office rename does not lose them either', () => {
    const bsel: Sel = { id: 'br-1', name: 'Battersea' };
    const brow: Row = { agency: 'A', branch: 'Battersea South', branchId: 'br-1' };
    expect(byBranch(brow, bsel, 'Battersea South')).toBe(true);
  });
});

describe('and where there is no id at all', () => {
  /* THE FALLBACK IS NOT OPTIONAL. Mock rows and older fixtures carry
     no agencyId, and a filter that REQUIRED one would empty the demo
     and every render test with it. ApplicationSummary's own comment
     strikes this bargain for the same two fields. */
  it('the name still matches, so the demo is not emptied', () => {
    const sel: Sel = { name: 'Cityscape Lettings' };
    const row: Row = { agency: 'Cityscape Lettings', branch: 'Battersea' };
    expect(byAgency(row, sel, 'Cityscape Lettings')).toBe(true);
  });

  it('and a row with no id falls back even when the selection has one', () => {
    const sel: Sel = { id: 'ag-9', name: 'Cityscape Lettings' };
    const row: Row = { agency: 'Cityscape Lettings', branch: 'Battersea' };
    expect(byAgency(row, sel, 'Cityscape Lettings')).toBe(true);
  });
});

describe('the page', () => {
  it('filters the Referrals tab by id, with a name fallback', () => {
    expect(PAGE).toContain('r.agencyId && sel.id ? r.agencyId === sel.id : r.agency === selName');
    expect(PAGE).toContain('r.branchId && sel.id ? r.branchId === sel.id : r.branch === selName');
  });

  /* THE EMPTY STATE NAMES WHAT IT IS CALLED NOW. Printing the stale
     name was the visible half of the bug: it told Matt there were no
     referrals for an agency that no longer exists. */
  it('and re-resolves the label, so no screen prints the old name', () => {
    expect(PAGE).toContain('No referrals{sel ? ` for ${selName}` : \'\'} yet.');
    expect(PAGE).not.toContain('No referrals{sel ? ` for ${sel.name}` : \'\'} yet.');
    expect(PAGE).toContain('No referrals from {focusName} yet.');
  });

  it('and the drill-down panel matches by id too', () => {
    expect(PAGE).toContain('branch?.id && r.branchId ? r.branchId === branch.id');
    expect(PAGE).toContain('agency.id && r.agencyId ? r.agencyId === agency.id');
  });

  /* THE SET THE TAB IS BUILT FROM. Both sides were live so a rename
     moved them together -- which is precisely why the header count
     stayed right while the tab emptied, and worth pinning so the two
     cannot drift apart again. */
  it('and the referral set itself is keyed on ids', () => {
    expect(PAGE).toContain('const ids = new Set(agencies.map((a) => a.id).filter(Boolean) as string[]);');
    expect(PAGE).toContain('r.agencyId && ids.size ? ids.has(r.agencyId) : names.has(r.agency)');
  });
});
