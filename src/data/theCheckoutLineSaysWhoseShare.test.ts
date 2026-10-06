/* THE LAST PLACE A JOINT TENANT WAS SHOWN THE WHOLE TENANCY'S BASIS.
 *
 * Matt, 2026-10-03, verbatim: "joint tenancies: describe it as 'Your share of
 * the guarantee fee (5 weeks of rent for the whole tenancy)'." His first
 * version, half an hour earlier, named the percentage ("Your 10% share"); the
 * later wording wins and the figure comes out. No loss: the amount Stripe is
 * charging is on the line beside this sentence, so the percentage was the one
 * number a tenant could not act on.
 *
 * emailTemplates' own comment on `isJoint` describes this defect and says why
 * it matters: "A tenant who reads 'the guarantee fee of £1,061.54, 5 weeks of
 * rent' can divide one by the other, get nothing like five weeks of anything
 * they recognise, and conclude we have made a mistake." The emails and the pay
 * page were fixed when that was written. The Stripe LINE ITEM was not -- and it
 * is the worst of the four to be wrong on, because it is the last thing
 * somebody reads with their card in their hand.
 *
 * MEASURED ON DEV: GR-25234 is a three-way tenancy on a £3,000 rent, share 10%,
 * fee £346.15 against a £300 share -- five weeks. So Matt's example sentence is
 * literally that row's, which is the one to assert.
 *
 * THE WORDING LIVES IN _shared/emailTemplates.ts because that file already
 * holds the ruling: "The phrase is the SAME on every surface by ruling: the
 * Stripe line item a tenant reads at the card screen, this email, the pay page
 * and the agency screens. One basis, one wording." The line item was the one
 * surface composing its own.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { feeLineDescriptionFor } from '../../supabase/functions/_shared/emailTemplates.ts';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/* GR-25234's own numbers: £346.15 of a £300 share is five weeks. */
const FIVE_WEEKS = 5;

describe('a joint tenant at the card screen', () => {
  it('reads Matt’s sentence: a share, and what the whole tenancy is measured against', () => {
    expect(feeLineDescriptionFor(FIVE_WEEKS, 3))
      .toBe('Your share of the guarantee fee (5 weeks of rent for the whole tenancy), for the opndoor Deed of Guarantee.');
  });

  /* THE SAME FOR EVERY TENANT ON THE TENANCY. GR-25234's three are 10%, 20%
     and 70% of one £3,000 let, and the line no longer distinguishes them:
     each reads their own AMOUNT, which Stripe puts beside this sentence. */
  it('and says the same thing whatever their share of it is', () => {
    expect(feeLineDescriptionFor(FIVE_WEEKS, 2)).toBe(feeLineDescriptionFor(FIVE_WEEKS, 3));
  });

  /* NO PERCENTAGE ANYWHERE IN IT, which is the correction. */
  it('and names no percentage', () => {
    expect(feeLineDescriptionFor(FIVE_WEEKS, 3)).not.toMatch(/%/);
  });

  it('and one with no basis says only what it knows', () => {
    expect(feeLineDescriptionFor(null, 2))
      .toBe('Your share of the guarantee fee, for the opndoor Deed of Guarantee.');
  });
});

describe('a tenancy of one', () => {
  /* BYTE FOR BYTE WHAT SHIPPED. One tenant has no share to name, and this is
     every referral on standard terms. */
  it('reads exactly what it read before', () => {
    expect(feeLineDescriptionFor(FIVE_WEEKS, 1))
      .toBe('5 weeks of rent, for the opndoor Deed of Guarantee.');
    expect(feeLineDescriptionFor(52 / 12, 1))
      .toBe("One month's rent, for the opndoor Deed of Guarantee.");
  });

  it('and an unknown basis still claims nothing', () => {
    expect(feeLineDescriptionFor(null, 1))
      .toBe('The agreed guarantee fee for this tenancy, for the opndoor Deed of Guarantee.');
    expect(feeLineDescriptionFor(null, null))
      .toBe('The agreed guarantee fee for this tenancy, for the opndoor Deed of Guarantee.');
  });
});

/* AND THE TENANT'S OWN ADDRESS REACHES STRIPE.
 *
 * Matt, 2026-10-03: "prefill the tenant's own email from the application (it
 * currently shows email@example.com for GR-25236)."
 *
 * Nothing was passed, so Stripe showed its own placeholder and the tenant had
 * to retype an address we already hold -- and whatever they typed is where
 * Stripe's receipt went, which is how a receipt ends up somewhere the
 * application has never heard of. GR-25236 holds kelly@test.com.
 */
describe('the tenant’s email', () => {
  const FN = read('supabase/functions/payment-page/index.ts');

  it('is selected, which it was not', () => {
    expect(FN).toContain('tenant_last_name, tenant_email,');
  });

  /* BOTH SESSIONS: the hosted checkout and the inline card form are the same
     purchase, and the one that was missed is always the one somebody uses. */
  it('and prefills both the hosted and the embedded session', () => {
    expect(FN.match(/customer_email: tenantEmail/g) ?? []).toHaveLength(2);
  });

  /* EDITABLE, NOT LOCKED. `customer_email` prefills and lets a tenant paying
     from a shared mailbox correct it; `customer` would fix it. */
  it('as a prefill rather than a locked customer', () => {
    expect(FN).not.toContain('customer: tenantEmail');
  });

  /* AND A MALFORMED ADDRESS DOES NOT BREAK THE PAYMENT. Stripe rejects the
     whole session on a bad customer_email, so a referral with a typo in it
     must still be payable. */
  it('and a referral with a typo in it is still payable', () => {
    expect(FN).toContain('const tenantEmail = /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(rawEmail) ? rawEmail : null;');
  });
});

describe('the checkout function', () => {
  const FN = read('supabase/functions/payment-page/index.ts');

  it('composes nothing itself any more', () => {
    expect(FN).toContain('const feeLineDescription = feeLineDescriptionFor(');
    expect(FN).toContain('feeLineDescriptionFor } from "../_shared/emailTemplates.ts"');
  });

  /* ONE DESCRIPTION, BOTH LINE ITEMS. The function builds a checkout session
     on two paths and both read this variable, so the two cannot disagree. */
  it('and both line items read the one description', () => {
    expect(FN.match(/description: feeLineDescription,/g) ?? []).toHaveLength(2);
  });
});
