/* THE SIGNED-DEED EMAIL STOPS OFFERING A PORTAL TO PEOPLE WHO HAVE NONE.
 *
 * Matt (bf): 'Signed-deed email to an agency without portal access (any
 * agency in a supplier's estate, e.g. Test Lettings asda for Kestrel):
 * remove "You can also view it any time in the portal" and the "Wrong
 * tenancy start date? Change it here" link. Instead: "Wrong tenancy start
 * date? Contact [supplier name], who referred this tenant." Keep the portal
 * lines for recipients who have a login.'
 *
 * TWO DEAD INVITATIONS IN ONE EMAIL, to the person holding the guarantee.
 * The supplier refers; an agency in its estate is a record in the supplier's
 * book and has no account at all.
 *
 * THE SECOND IS WORSE THAN A DEAD LINK, and it is the reason the replacement
 * has to name somebody rather than just disappear. The correction link is a
 * TOKEN and would have worked -- but on this rail the amendment is not the
 * agency's to make, and somebody who spots a wrong start date and is given
 * nothing to do about it does nothing. The date is what the cover runs from.
 *
 * THE TOKEN IS NOT MINTED AT ALL, rather than minted and hidden. An unused
 * seven-day correction token is a live way to amend a tenancy sitting in a
 * table, and the point of (bf) is that this agency is not the one who should
 * be amending it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEED = readFileSync(resolve(process.cwd(), 'supabase/functions/_shared/deedEmail.ts'), 'utf8');

describe('an agency in a supplier estate', () => {
  it('is identified from the application\'s own partner, not from the recipient', () => {
    expect(DEED).toContain('partner_kind === "supplier"');
    expect(DEED).toContain('const inSupplierEstate');
  });

  it('gets no portal line', () => {
    expect(DEED).toContain('if (appBase && !inSupplierEstate) {');
  });

  /* NOT MINTED, not merely unprinted. */
  it('and no correction token is created for them at all', () => {
    const block = DEED.slice(DEED.indexOf('let correctionUrl = ""'));
    expect(block.slice(0, 700)).toContain('if (appBase && !inSupplierEstate) {');
  });

  it('but is told who can change the date, by name', () => {
    expect(DEED).toContain('Wrong tenancy start date? Contact ${supplierName}, who referred this tenant.');
  });
});

describe('and everybody else is unchanged', () => {
  /* THE PORTAL LINE SURVIVES for a reader who has a login, which is the half
     Matt named explicitly ("Keep the portal lines for recipients who have a
     login"). A private landlord was already excluded by managedByFor, and
     that exclusion is still the one doing that job. */
  it('the portal line is still built for an agency-rail recipient', () => {
    expect(DEED).toContain('portalUrl = `${appBase}/applications/${encodeURIComponent(target.ref)}`');
    expect(DEED).toContain('kind !== "private_landlord"');
  });

  it('and the correction link is still offered where it is theirs to use', () => {
    expect(DEED).toContain('Wrong tenancy start date? <a href="${correctionUrl}">Change it here</a>.');
  });

  /* THE TWO ARE EXCLUSIVE, so no reader ever gets both sentences about the
     start date. An `else if` rather than two independent blocks. */
  it('and no email can carry both start-date lines', () => {
    const i = DEED.indexOf('Change it here</a>.');
    const after = DEED.slice(i, i + 400);
    expect(after).toContain('} else if (supplierName) {');
  });
});
