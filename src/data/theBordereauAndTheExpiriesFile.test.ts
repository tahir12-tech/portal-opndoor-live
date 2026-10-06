/* TWO DOCUMENTS THAT LEAK OUR OWN PLUMBING, AND THREE COLUMNS THAT DO
   NOT SAY WHAT THEY HOLD.
 *
 * Matt, 2026-10-02, verbatim:
 *
 *   "Underwriter bordereau: 'Landlord Name' shows 'Unattached' for a
 *    direct signup. Never show the placeholder: show the landlord's name
 *    where we hold it, otherwise leave it blank. Check every column of
 *    the bordereau for 'Unattached' or any other internal placeholder."
 *
 *   "Expiries export: label 'Annualised rent' as 'Annualised rent (this
 *    tenant's share)'; say 'Guarantee fee (whole tenancy)' not
 *    'Guarantor fee'; replace the Tenancy ID code with 'Joint with'
 *    listing the other tenants' guarantee references (blank for single
 *    tenancies)."
 *
 * "Unattached" IS AN AGENCY ROW WE CREATED. Each house rail carries one,
 * with a branch under it, so an application's NOT NULL agency_id
 * resolves. Nobody outside this codebase has heard of it, and it had
 * reached two documents that leave the building: the application export
 * (fixed in c7581ee) and this one, which goes to an underwriter.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { hydratePartners, hydrateOrg } from '@/data';
import { orgCell, orgLabel } from '@/data/agencyOffices';
import type { Agency, Partner } from '@/data/types';

const SRC = readFileSync('src/data/exportsService.ts', 'utf8');

describe('a placeholder org', () => {
  hydratePartners([
    { id: 'opndoor-direct', name: 'Opndoor Direct', status: 'active', referencingMode: 'opndoor_referenced', isHouse: true, kind: 'house' },
  ] as unknown as Partner[]);
  hydrateOrg([
    {
      name: 'Unattached', partner: 'opndoor-direct', isPlaceholder: true,
      branches: [{ name: 'Unattached', isPlaceholder: true }],
    },
    { name: "Regent's Lettings", partner: 'opndoor-direct', branches: [{ name: "Regent's Park" }] },
  ] as unknown as Agency[], []);

  /* TWO ANSWERS ON PURPOSE. On a screen a hyphen is right -- an empty
     cell in a table of records reads as a missing record. In a
     spreadsheet the reader is reconciling or loading a file, and a
     hyphen in an Agency column is a VALUE: it sorts, it groups, it
     matches nothing. */
  it('is a hyphen on a screen and nothing in a document', () => {
    expect(orgLabel('Unattached')).toBe('-');
    expect(orgCell('Unattached')).toBe('');
  });

  it('and a real agency is itself in both', () => {
    expect(orgLabel("Regent's Lettings")).toBe("Regent's Lettings");
    expect(orgCell("Regent's Lettings")).toBe("Regent's Lettings");
  });
});

describe('the bordereau', () => {
  /* IT WAS THE AGENCY NAME, as the comment on that line said outright.
     Right only if "landlord" means "whoever we deal with", and on a
     direct signup there is no agency at all. */
  it('puts the landlord in the Landlord Name column, or nothing', () => {
    expect(SRC).toContain("rec?.landlordName ?? ''");
    expect(SRC).not.toContain('a.agency, // Landlord Name');
  });

  /* THE SWEEP MATT ASKED FOR: "Check every column of the bordereau for
     'Unattached' or any other internal placeholder." The column list is
     the check. Of the eighteen, the only one that ever named an org was
     Landlord Name; the rest are the tenant, the property, the dates and
     the money. */
  it('and names no org in any other column', () => {
    const cols = SRC.slice(SRC.indexOf('export const BORDEREAU_COLS'), SRC.indexOf('export interface BordereauData'));
    for (const word of ['Agency', 'Branch', 'Office', 'Partner', 'Supplier']) {
      expect(cols, `the bordereau has a ${word} column, which needs the same rule`).not.toContain(`'${word}`);
    }
  });

  /* AND THE DEMO FILE AGREES WITH THE LIVE ONE, which is the whole
     reason the synthetic builder exists in the same shape. */
  it('and the synthetic version does not stand an agency in for a landlord', () => {
    expect(SRC).not.toContain('Landlord Name (demo agency stand-in)');
  });
});

describe('the expiries export', () => {
  it('says whose share the annualised rent is', () => {
    expect(SRC).toContain("\"Annualised rent (this tenant's share)\"");
  });

  it('and calls the fee a guarantee fee', () => {
    expect(SRC).toContain("'Guarantee fee (whole tenancy)'");
    expect(SRC).not.toContain("'Guarantor fee (whole tenancy)'");
  });

  /* THE ID WAS A JOIN KEY. It was printed because it was the only thing
     that said "this row has siblings", and an operator chasing the right
     people wants the siblings, not the key. */
  it('and lists the other guarantees instead of a tenancy id', () => {
    expect(SRC).toContain("'Joint with'");
    expect(SRC).not.toContain("'Tenancy ID', 'Property address'");
  });

  /* BLANK FOR A SINGLE TENANCY, and never the row's own reference: a
     sole tenant has nobody to be joint with, and printing their own
     reference back at them reads as a second guarantee. */
  it('and leaves it blank for a sole tenant rather than naming them to themselves', () => {
    expect(SRC).toContain(".filter((r) => r !== a.ref)");
  });

  /* THE SIBLINGS COME FROM THE WHOLE BOOK, not the filtered set: a
     joint tenant whose guarantee expires in a different month is not in
     this file and is still their joint tenant. */
  it('and finds siblings that are not themselves in this month', () => {
    expect(SRC).toContain('tenancyRefs');
    expect(SRC).toContain('its other tenants are not Deed');
  });

  it('and never prints the placeholder agency or branch either', () => {
    expect(SRC).toContain('orgCell(a.agency), orgCell(a.branch)');
  });
});
