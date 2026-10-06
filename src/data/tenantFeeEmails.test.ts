/* WHAT A TENANT IS TOLD THEY OWE, AND WHO DECIDED IT.

   Reported on a real Regent referral, GR-20837, rent £1,000: the payment email
   said the fee was £1,000 and that "The fee is one month of rent". The fee was
   £692.31, three weeks of rent under Regent's agreement. Both halves of that are
   a consumer-facing misstatement of price, on the one email whose entire job is to
   ask for money.

   WHY IT WAS NOT ALREADY FIXED, because it had been. The source was corrected on
   24 September: create-referral reads applications.fee_amount and the template
   takes the basis as a fact the caller passes. The DEPLOYED create-referral is
   from 09:16 UTC that morning and the fix landed at 09:17. It was committed and
   never deployed, so dev ran the old bundle: amountGBP computed from `rent`, and
   an emailTemplates that hardcoded "The fee is one month of rent and is payable
   once." Nothing about the repo was wrong. The deploy was.

   The one-month wording is now "one month's rent" on every surface, which is what
   the rest of the codebase already said and what the Stripe line item said last
   week. This file's history above deliberately quotes the old strings.

   That is why this file exists in src/ rather than under supabase/: vitest is the
   suite that actually runs here (Deno is not installed on this machine, so
   `deno test` cannot be the guard), and emailTemplates.ts has no Deno-only
   imports, so it can be exercised directly. A test that cannot be run is not a
   guard against anything.

   THE SECOND RULING. The opening line follows the route and the referencing mode,
   from one template with variables and never from per-agency copy. Regent is the
   interesting case: the AGENCY decided this tenant needed a guarantee, so the
   agency is the subject of the sentence. Where opndoor made the decision the
   approved wording stands, and the supplier rail does not move at all. */
import { describe, expect, it } from 'vitest';
import {
  executedDeedAgentEmail, feeBasisPhrase, feeBasisWeeksOf, paymentLinkEmail,
} from '../../supabase/functions/_shared/emailTemplates';

/** GR-20837 as it actually is on dev: rent £1,000, fee £692.31, sole tenant. */
const REGENT = {
  rent: 1000,
  fee: 692.31,
  feeGBP: '£692.31',
  addr: '4 Hanover Terrace, London, NW1 4RJ',
  ref: 'GR-20837',
  agency: "Regent's Lettings",
};

const weeks = (fee: number, rent: number) => feeBasisWeeksOf(fee, rent);
const textOf = (m: { blocks: unknown[] }) =>
  m.blocks.map((b) => {
    const o = b as Record<string, unknown>;
    if (typeof o.p === 'string') return o.p;
    if (typeof o.small === 'string') return o.small;
    if (Array.isArray(o.rows)) return (o.rows as [string, string][]).map(([k, v]) => `${k}: ${v}`).join('\n');
    if (Array.isArray(o.list)) return (o.list as string[]).join('\n');
    if (typeof o.h === 'string') return o.h;
    if (typeof o.callout === 'string') return o.callout;
    return '';
  }).join('\n');

describe('the basis of a fee, in the reader\'s words', () => {
  it('reads three weeks off the real Regent numbers', () => {
    // £692.31 on £1,000 is exactly 3 weeks: (692.31 * 52) / (1000 * 12).
    expect(weeks(REGENT.fee, REGENT.rent)).toBeCloseTo(3, 2);
    expect(feeBasisPhrase(weeks(REGENT.fee, REGENT.rent))).toBe('3 weeks of rent');
  });

  it('still calls a month a month, which is how a tenant thinks of it', () => {
    expect(feeBasisPhrase(weeks(2000, 2000))).toBe("one month's rent");
  });

  it('says nothing rather than guessing when it cannot tell', () => {
    // A fee with no rent to measure it against, which is the state at submission.
    expect(feeBasisPhrase(weeks(692.31, 0))).toBeNull();
    expect(feeBasisPhrase(null)).toBeNull();
  });

  /* A joint share divided by the whole tenancy rent would report every joint
     tenant as being on a discount. The share must be measured against the share. */
  it('measures a joint share against that tenant\'s share of the rent', () => {
    expect(feeBasisPhrase(weeks(346.15, 500))).toBe('3 weeks of rent');
  });
});

describe('the Regent payment email', () => {
  const email = paymentLinkEmail({
    propertyAddr: REGENT.addr,
    guaranteeRef: REGENT.ref,
    amount: REGENT.feeGBP,
    payUrl: 'https://portal.example/pay?token=t',
    feeBasisWeeks: weeks(REGENT.fee, REGENT.rent),
    copy: { rail: 'agency', referencingMode: 'pre_referenced_open', agencyName: REGENT.agency },
  });
  const body = textOf(email);

  it('never states the rent as the fee, which is the whole defect', () => {
    expect(body).not.toMatch(/£1,000/);
    expect(body).not.toMatch(/1000/);
    expect(body).toContain('£692.31');
  });

  it('never claims the fee is a month of rent, in either phrasing', () => {
    expect(body).not.toMatch(/month's rent/i);
    expect(body).not.toMatch(/month of rent/i);
  });

  it('names the agency that arranged it, and asks in the same sentence', () => {
    expect(body).toContain(
      "Regent's Lettings has arranged an opndoor guarantee for your tenancy at "
      + '4 Hanover Terrace, London, NW1 4RJ. To put it in place, pay the guarantee fee of £692.31 (3 weeks of rent).',
    );
  });

  it('does not imply opndoor decided anything about this tenant', () => {
    // Regent referenced them. opndoor took no view, and the old opening said it
    // was acting as guarantor as though it had.
    expect(body).not.toMatch(/opndoor is acting as guarantor/);
  });

  it('describes the basis in the small print too', () => {
    expect(body).toContain('The fee is 3 weeks of rent and is payable once.');
  });
});

describe('who made the decision decides the wording', () => {
  const base = {
    propertyAddr: REGENT.addr, guaranteeRef: REGENT.ref, amount: REGENT.feeGBP,
    payUrl: 'u', feeBasisWeeks: weeks(REGENT.fee, REGENT.rent),
  };

  it('an opndoor-referenced agency referral keeps the approved wording', () => {
    // opndoor referenced this tenant and decided, so opndoor is the subject.
    const m = paymentLinkEmail({
      ...base,
      copy: { rail: 'agency', referencingMode: 'opndoor_referenced', agencyName: REGENT.agency },
    });
    expect(textOf(m)).toContain('opndoor is acting as guarantor for your tenancy');
    expect(textOf(m)).not.toContain('has arranged an opndoor guarantee');
  });

  it('the direct rail keeps the approved wording', () => {
    const m = paymentLinkEmail({ ...base, copy: { rail: 'direct', referencingMode: 'opndoor_referenced' } });
    expect(textOf(m)).toContain('opndoor is acting as guarantor for your tenancy');
  });

  /* THE HOLE THAT WOULD HAVE SHIPPED: a pre-referenced agency referral whose
     agency name we could not resolve. A sentence with a gap where the name goes
     is worse than the approved wording, so the approved wording wins. */
  it('falls back to the approved wording when the agency has no name', () => {
    const m = paymentLinkEmail({
      ...base, copy: { rail: 'agency', referencingMode: 'pre_referenced_open', agencyName: '  ' },
    });
    expect(textOf(m)).toContain('opndoor is acting as guarantor for your tenancy');
  });
});

/* =====================================================================
   THE SUPPLIER RAIL DOES NOT MOVE.

   Rightmove's wording is approved and their volume is the reason this service
   exists. A snapshot rather than a set of assertions, because the requirement is
   not "says the right things", it is "is the same email": anything that changes
   any character of it should fail here and be looked at deliberately.

   Pinned on a STANDARD-TERMS referral, one month's rent, because that is what a
   supplier referral is. A supplier on a negotiated basis now has its basis named
   in the small print where it previously said only "payable once", which is the
   correctness half of the ruling and is asserted separately below.
   ===================================================================== */
describe('the supplier rail', () => {
  const supplier = paymentLinkEmail({
    propertyAddr: '12 Bridge Street, Leeds, LS1 4DX',
    guaranteeRef: 'GR-40155',
    amount: '£1,450',
    tenancyStartLabel: '1 October 2026',
    payUrl: 'https://portal.example/pay?token=s',
    feeBasisWeeks: weeks(1450, 1450),
    copy: { rail: 'supplier', referencingMode: 'pre_referenced_screened' },
  });

  it('is byte-identical to the approved email', () => {
    expect(supplier).toMatchInlineSnapshot(`
      {
        "action": {
          "href": "https://portal.example/pay?token=s",
          "label": "Pay the guarantee fee",
        },
        "audience": "tenant",
        "blocks": [
          {
            "p": "opndoor is acting as guarantor for your tenancy at 12 Bridge Street, Leeds, LS1 4DX. The last step is the guarantee fee.",
          },
          {
            "rows": [
              [
                "Reference",
                "GR-40155",
              ],
              [
                "Property",
                "12 Bridge Street, Leeds, LS1 4DX",
              ],
              [
                "Guarantee fee",
                "£1,450",
              ],
              [
                "Tenancy starts",
                "1 October 2026",
              ],
            ],
          },
          {
            "small": "The fee is one month's rent and is payable once. The Deed of Guarantee is issued as soon as it clears.",
          },
        ],
        "heading": "Your guarantee is approved",
        "subject": "Your opndoor guarantee is ready to pay",
      }
    `);
  });

  it('is identical with no copy passed at all, which is how every caller starts', () => {
    const { copy: _omit, ...noCopy } = {
      propertyAddr: '12 Bridge Street, Leeds, LS1 4DX',
      guaranteeRef: 'GR-40155',
      amount: '£1,450',
      tenancyStartLabel: '1 October 2026',
      payUrl: 'https://portal.example/pay?token=s',
      feeBasisWeeks: weeks(1450, 1450),
      copy: undefined,
    };
    expect(paymentLinkEmail(noCopy)).toEqual(supplier);
  });

  it('names a negotiated basis in the small print rather than saying only "payable once"', () => {
    const m = paymentLinkEmail({
      propertyAddr: 'X', guaranteeRef: 'GR-40156', amount: '£1,003.85', payUrl: 'u',
      feeBasisWeeks: weeks(1003.85, 1450),
      copy: { rail: 'supplier', referencingMode: 'pre_referenced_screened' },
    });
    expect(textOf(m)).toContain('The fee is 3 weeks of rent and is payable once.');
  });
});

/* =====================================================================
   A JOINT TENANCY IS PRICED ONCE AND CHARGED BY SHARE.

   GR-20846 as it is on dev: a £2,000 tenancy priced at five weeks, £2,307.69,
   split between two tenants, of which this one's 46% is £1,061.54. Every figure
   the tenant reads is a share and the basis beside it is a fact about the whole
   tenancy, so naming the share as though it were the fee invites them to divide
   one by the other, get nothing like five weeks, and conclude we miscounted.

   AND THE HEADING FOLLOWS THE BODY. "Your guarantee is approved" asserts a
   decision opndoor did not make on a pre-referenced referral. Fixing the opening
   sentence and leaving the heading saying "approved" left the contradiction in the
   largest type on the page.
   ===================================================================== */
const JOINT = {
  rent: 2000,          // the whole tenancy
  shareOfRent: 920,    // this tenant's 46%
  fee: 1061.54,        // this tenant's share of the £2,307.69 tenancy fee
  feeGBP: '£1,061.54',
  addr: '8 Marchmont Street, London, WC1N 1AP',
  ref: 'GR-20846',
  agency: "Regent's Lettings",
  tenants: 2,
};

describe('a joint tenant', () => {
  const email = paymentLinkEmail({
    propertyAddr: JOINT.addr, guaranteeRef: JOINT.ref, amount: JOINT.feeGBP,
    payUrl: 'u',
    feeBasisWeeks: weeks(JOINT.fee, JOINT.shareOfRent),
    tenantCount: JOINT.tenants,
    copy: { rail: 'agency', referencingMode: 'pre_referenced_open', agencyName: JOINT.agency },
  });
  const body = textOf(email);

  /* The share measured against the share gives the same answer as the whole
     against the whole, because both are the same proportion. That is why the basis
     is quotable as a fact about the tenancy from either. */
  it('reads five weeks off the share, the same as off the tenancy', () => {
    expect(weeks(JOINT.fee, JOINT.shareOfRent)).toBeCloseTo(5, 2);
    expect(weeks(2307.69, JOINT.rent)).toBeCloseTo(5, 2);
  });

  it('names the share as a share, with the tenancy basis and the split', () => {
    expect(body).toContain(
      'To put it in place, pay your share of the guarantee fee, £1,061.54 '
      + '(the fee is 5 weeks of rent, split between 2 tenants).',
    );
  });

  it('never calls the share "the guarantee fee of"', () => {
    expect(body).not.toContain('pay the guarantee fee of £1,061.54');
  });

  it('labels the money row as a share too', () => {
    expect(body).toContain('Your share of the guarantee fee: £1,061.54');
    expect(body).not.toContain('Guarantee fee: £1,061.54');
  });

  it('says the split in the small print as well', () => {
    expect(body).toContain('The fee is 5 weeks of rent, split between 2 tenants, and is payable once.');
  });

  it('does not say approved, because nobody approved anything', () => {
    expect(email.heading).toBe('Your guarantee is ready to put in place');
  });
});

describe('the heading follows the journey', () => {
  const base = {
    propertyAddr: JOINT.addr, guaranteeRef: JOINT.ref, amount: JOINT.feeGBP,
    payUrl: 'u', feeBasisWeeks: weeks(JOINT.fee, JOINT.shareOfRent),
  };

  it('says ready to put in place where the agency decided', () => {
    expect(paymentLinkEmail({ ...base,
      copy: { rail: 'agency', referencingMode: 'pre_referenced_open', agencyName: JOINT.agency },
    }).heading).toBe('Your guarantee is ready to put in place');
  });

  it('says approved where opndoor decided', () => {
    expect(paymentLinkEmail({ ...base,
      copy: { rail: 'agency', referencingMode: 'opndoor_referenced', agencyName: JOINT.agency },
    }).heading).toBe('Your guarantee is approved');
    expect(paymentLinkEmail({ ...base, copy: { rail: 'direct' } }).heading).toBe('Your guarantee is approved');
  });

  it('says approved on the supplier rail, unchanged', () => {
    expect(paymentLinkEmail({ ...base, copy: { rail: 'supplier' } }).heading)
      .toBe('Your guarantee is approved');
    expect(paymentLinkEmail(base).heading).toBe('Your guarantee is approved');
  });
});

describe('a sole tenant is untouched by any of it', () => {
  it('reads exactly as before when tenantCount is 1 or absent', () => {
    const absent = paymentLinkEmail({
      propertyAddr: REGENT.addr, guaranteeRef: REGENT.ref, amount: REGENT.feeGBP,
      payUrl: 'u', feeBasisWeeks: weeks(REGENT.fee, REGENT.rent),
      copy: { rail: 'agency', referencingMode: 'pre_referenced_open', agencyName: REGENT.agency },
    });
    const one = paymentLinkEmail({
      propertyAddr: REGENT.addr, guaranteeRef: REGENT.ref, amount: REGENT.feeGBP,
      payUrl: 'u', feeBasisWeeks: weeks(REGENT.fee, REGENT.rent), tenantCount: 1,
      copy: { rail: 'agency', referencingMode: 'pre_referenced_open', agencyName: REGENT.agency },
    });
    expect(one).toEqual(absent);
    expect(textOf(one)).toContain('pay the guarantee fee of £692.31 (3 weeks of rent).');
    expect(textOf(one)).toContain('Guarantee fee: £692.31');
    expect(textOf(one)).not.toContain('split between');
  });
});

/* THE AGENT IS TOLD ANOTHER DEED IS COMING.

   Each tenant of a joint tenancy signs their own deed for their own share,
   generated when THAT tenant pays, so the agent receives two executed-deed
   emails days apart for one tenancy. Both said the same thing. The first read as
   the whole tenancy and the second read as a duplicate, and an agent who files
   the first and ignores the second believes a tenancy is fully guaranteed when
   half of it is. */
describe('the executed-deed email on a joint tenancy', () => {
  const base = {
    guaranteeRef: 'GR-20846', tenantName: 'Ms Lena Brandt',
    propertyAddr: '14 Chalcot Road, NW1 8LH', tenancyStartLabel: '1 October 2026',
  };
  const flat = (m: { blocks: unknown[] }) => JSON.stringify(m.blocks);

  /* THE FIELD IS `signed`, NOT `position`, SINCE 2026-10-01. Matt, on
     GR-23853/GR-23854: "The count must be of deeds actually signed ('1 of
     2 signed'), and 'every tenant has now signed' only appears when it's
     true." These four said position, which is the order the agent typed
     the tenants in, so the second tenant's deed read "2 of 2" whoever had
     signed. theDeedCountIsOfSignatures.test.ts holds the bug itself. */
  it('says how many are signed, and names the other tenants', () => {
    const m = executedDeedAgentEmail({ ...base, joint: { signed: 1, count: 2, coTenants: 'Tomas Brandt' } });
    expect(flat(m)).toContain('Joint tenancy, 1 of 2 deeds signed');
    expect(flat(m)).toContain('Tomas Brandt');
  });

  it('says another one follows, so the second email is expected', () => {
    const m = executedDeedAgentEmail({ ...base, joint: { signed: 1, count: 2, coTenants: 'Tomas Brandt' } });
    expect(flat(m)).toMatch(/one more deed follows/);
  });

  /* The LAST deed closes the loop. Without this the final email would still
     promise another, which is the same error in the other direction. */
  it('says so when it is the last one', () => {
    const m = executedDeedAgentEmail({ ...base, joint: { signed: 2, count: 2, coTenants: 'Tomas Brandt' } });
    expect(flat(m)).toContain('last of this tenancy');
    expect(flat(m)).not.toMatch(/more deeds? follow/);
  });

  it('counts correctly on a three-tenant tenancy', () => {
    const m = executedDeedAgentEmail({ ...base, joint: { signed: 1, count: 3, coTenants: 'Tomas Brandt, Ana Ruiz' } });
    expect(flat(m)).toContain('1 of 3 deeds signed');
    expect(flat(m)).toMatch(/2 more deeds follow/);
  });

  it('puts the count in the subject, so two emails are distinguishable in a list', () => {
    expect(executedDeedAgentEmail({ ...base, joint: { signed: 2, count: 2, coTenants: 'T B' } }).subject)
      .toBe('Signed Deed of Guarantee for GR-20846 (2 of 2 signed)');
  });

  /* A TENANCY OF ONE IS UNCHANGED, which is most of the book. */
  it('says nothing about joint tenancies on a sole tenancy', () => {
    const m = executedDeedAgentEmail(base);
    expect(m.subject).toBe('Signed Deed of Guarantee for GR-20846');
    expect(flat(m)).not.toMatch(/joint|deed 1 of|more deed/i);
  });

  it('is also unchanged when a joint block arrives describing one tenant', () => {
    const m = executedDeedAgentEmail({ ...base, joint: { signed: 1, count: 1, coTenants: '' } });
    expect(flat(m)).not.toMatch(/joint/i);
  });
});
