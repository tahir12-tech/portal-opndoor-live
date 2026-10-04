/* A SUPPLIER IS CALLED A SUPPLIER, AND A ROUTE IS STILL CALLED A PARTNER.
 *
 * Q-05, fold 11: "Partners renamed to Suppliers throughout". Taken literally
 * that is wrong, and the wrongness is the interesting part, so it is written
 * down here rather than in a commit message nobody will find.
 *
 * `partner` means two different things in this product:
 *
 *   THE COMPANY   Rightmove, RMT -- the businesses that push referrals to us
 *                 through the API. These are what Matt means by Suppliers,
 *                 and they are what the Suppliers screens are about.
 *   THE ROUTE     `partner_id` on an application: which of the three rails it
 *                 came down. On the agency rail that value is the house
 *                 partner `opndoor-agents`, shared by every agency we
 *                 onboard, so it is emphatically NOT a company there.
 *
 * Renaming the second sense would be a lie on screen. The Dashboard's
 * "Commission by partner" table lists routes, including the house partner and
 * direct, and its "Partner comm" column is one half of the two-sided split
 * (partner-side against agent-side). Calling either of those Supplier would
 * make an admin read the house route as a supplier company, which is the
 * exact confusion CLAUDE.md opens by warning about.
 *
 * So the rule this asserts is narrower and truer than the instruction's
 * wording: ON THE SCREENS THAT ARE ABOUT SUPPLIER COMPANIES, the word is
 * Supplier. Everywhere else the word is left alone deliberately.
 *
 * Source-level because the alternative is rendering three pages to read their
 * headings, and the property is about the words in the file.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/* Comments explain the distinction and quote the old wording, so an unstripped
   scan flags every explanation as the defect. Same trap migrationPatterns and
   credentialsAreNotAcceptedFromCallers both document. */
const code = (p: string) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/** Text a user actually reads: JSX text nodes, and the attributes that render. */
function userFacing(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/>([^<>{}\n]{2,})</g)) out.push(m[1].trim());
  for (const m of src.matchAll(/\b(?:label|placeholder|title|aria-label)=["']([^"']+)["']/g)) out.push(m[1]);
  return out.filter(Boolean);
}

/** The screens whose subject IS the supplier company. */
const SUPPLIER_SCREENS = [
  'src/pages/PartnerManagement/PartnerManagement.tsx',
  'src/pages/PartnerManagement/PartnerHome.tsx',
];

describe('the screens about supplier companies', () => {
  it('call them Suppliers, not Partners', () => {
    const offences: string[] = [];
    for (const f of SUPPLIER_SCREENS) {
      for (const t of userFacing(code(f))) {
        if (/\bPartners?\b/.test(t)) offences.push(`${f}: ${t}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('and the scan can see text at all, so an empty pass is not a broken regex', () => {
    const seen = SUPPLIER_SCREENS.flatMap((f) => userFacing(code(f)));
    expect(seen.length).toBeGreaterThan(20);
    expect(seen.join(' ')).toMatch(/Supplier/);
  });
});

describe("a supplier's own staff", () => {
  it('are told they are in the Supplier portal, not the Partner portal', () => {
    const s = code('src/components/layout/Sidebar.tsx');
    expect(s).toMatch(/Supplier<br \/>portal/);
    expect(s).not.toMatch(/Partner<br \/>portal/);
  });
});

describe('the picker that chooses which company an agency belongs to', () => {
  /* "AGENCY", NOT "AGENT", SINCE 2026-10-04. Matt: "use 'Agency' and 'Office'
     instead of 'Agent' and 'Branch' on this form, matching the supplier and
     agency forms." The option read "this agent belongs to", which is the old
     word for the thing being created.

     AND THE SENTENCE IN THIS TEST'S OWN NAME WAS WRONG IN A SECOND WAY:
     `getPartners()` strips the house route and returns "only companies", which
     was true and not enough. It returns AGENCY-kind companies too, and Harbour
     Lets turned up in this very dropdown. The list is filtered on
     `partyIsSupplier` now; see the assertion below. */
  it('calls it a Supplier, and offers only suppliers', () => {
    const s = code('src/components/AgentBranchPicker.tsx');
    expect(s).toMatch(/>Supplier <span className="req"/);
    expect(s).toMatch(/Select the supplier this agency belongs to/);
    /* THE BUG MATT REPORTED. Without the filter the dropdown offered Harbour
       Lets, an agency, as a company an agency could belong to. */
    expect(s).toMatch(/getPartners\(\)\.filter\(\(p\) => partyIsSupplier\(p\.id\)\)/);
    expect(s).not.toMatch(/Select the partner this agent belongs to/);
  });
});

/* THE OTHER HALF OF THE RULE, AND MATT HAS GIVEN IT A BETTER WORD.

   This used to assert that the Dashboard keeps saying "partner", so that
   a well-meaning sweep could not "finish the job" and call a ROUTE a
   supplier -- which would be a lie, because the rows include the house
   partner every agency shares.

   The reasoning was right and the word was a compromise. Matt,
   2026-09-30: "Rename 'Commission by partner' to 'Commission by route'
   and replace 'Partner' wording in it with 'Supplier' or 'Route' as
   appropriate." A route is what they are, so the table says route and the
   money column says supplier, which is whose commission it is.

   SO THE RULE IS UNCHANGED AND THE ASSERTION IS SHARPER: the table must
   not call these things partners OR imply every row is a supplier
   company. The first check is the new name; the second is that the old
   one is gone, so this cannot pass on a half-done rename. */
describe('a route is called a route, and never a supplier company', () => {
  it('on the Dashboard, which lists every route including the house one', () => {
    const s = code('src/pages/Dashboard/Dashboard.tsx');
    expect(s).toMatch(/Commission by route/);
    expect(s).not.toMatch(/Commission by partner/);
    // The money in that table is a supplier's cut, and says so.
    expect(s).toMatch(/Supplier comm/);
  });
});
