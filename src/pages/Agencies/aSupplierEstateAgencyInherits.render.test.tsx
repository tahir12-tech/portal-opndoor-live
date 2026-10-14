/* =====================================================================
   (ci) A SUPPLIER-ESTATE AGENCY IS TOLD WHOSE SETTING IT FOLLOWS.

   Matt, 2026-10-04: "Supplier-estate agency Overview (e.g. Test Lettings
   asda under Kestrel, as admin): 1) remove the 'How are [agency]'s
   tenants checked?' choice. It follows the supplier's setting; show
   'Checked as Kestrel Lettings sets it: they check tenants, Opndoor
   accepts them as sent' with a link to Kestrel's Settings. Make the
   server refuse setting a referencing mode on any supplier-estate agency
   or office, so the inheritance fix can't be undone by a click. 2) remove
   'Invite agency manager' and 'Add another agency (creates a group)' for
   supplier-estate agencies; they have no logins and sit under the
   supplier."

   BOTH HALVES WERE OUTSTANDING, not just the server one the handover
   named: the radios were gated on `open && isAdmin && a.id` and nothing
   else, so an admin on Kestrel's Test Lettings was offered the choice and
   the server took it.

   WHY THE SERVER HALF IS THE ONE THAT MATTERS, and it is tested in
   a_supplier_estate_agency_inherits_its_setting.test.sql:
   resolve_referencing_mode is a coalesce, agency first and partner
   second, so a value stored here would not sit beside the supplier's
   setting, it would override it for every referral through that agency.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkingChoice, REFERENCING_MODES } from '@/data/types';

const PAGE = readFileSync(join(process.cwd(), 'src/pages/Agencies/AgencyHome.tsx'), 'utf8');

describe('the choice', () => {
  it('is not offered on an agency in a supplier estate', () => {
    expect(PAGE).toContain('{open && isAdmin && !inSupplierEstate && a.id && (');
    // The old gate, which offered it to an admin on anybody's agency.
    expect(PAGE).not.toContain('{open && isAdmin && a.id && (\n                      /* TWO OPTIONS');
  });

  it('and the sentence that replaces it names the supplier and links to them', () => {
    expect(PAGE).toContain('{open && inSupplierEstate && a.id && (');
    expect(PAGE).toContain("Checked as {getPartner(partner)?.name ?? 'the supplier'} sets it:");
    expect(PAGE).toContain("`/partners/${encodeURIComponent(String(partner))}?tab=settings`");
  });

  /* THE WORDS COME FROM THE SHARED LIST, so the three settings cannot be
     described one way here and another on the supplier's own page. */
  it('in the product’s own words for that setting', () => {
    expect(PAGE).toContain('{checkingChoice(getPartner(partner)?.referencingMode)}');
  });
});

describe('the clause itself', () => {
  /* MATT'S EXAMPLE, END TO END: Kestrel is pre_referenced_open, and his
     sentence reads "...sets it: they check tenants, Opndoor accepts them
     as sent". */
  it('reads as the second half of his sentence', () => {
    expect(checkingChoice('pre_referenced_open')).toBe('they check tenants, and Opndoor accepts them as sent');
  });

  it('and answers for all three settings', () => {
    for (const m of REFERENCING_MODES) {
      expect(checkingChoice(m.id)).toBe(m.choice.charAt(0).toLowerCase() + m.choice.slice(1));
    }
  });

  /* A SENTENCE THAT STOPS AFTER THE COLON READS AS A FAULT, so an unset
     supplier answers the product's default rather than nothing. */
  it.each([[null], [undefined]])('never trails off when the supplier has no setting: %s', (m) => {
    expect(checkingChoice(m as never)).toBe(checkingChoice('pre_referenced_screened'));
    expect(checkingChoice(m as never).length).toBeGreaterThan(10);
  });
});

describe('(ci)(2) the two controls that assume logins and a group', () => {
  it('drops Invite agency manager where there is nobody to invite', () => {
    expect(PAGE).toContain('{isAdmin && hasLogins && <button className="ah-linkbtn ah-invite-inline"');
  });

  it('and Add another agency, which would create a group above it', () => {
    expect(PAGE).toContain("{org.kind === 'agency' && !inSupplierEstate && (");
  });
});
