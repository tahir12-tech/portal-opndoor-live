/* THE PAYMENT REMINDER SAYS THE ADDRESS ONCE, AND ASKS FOR THE FEE.
 *
 * Matt, 2026-10-01, verbatim: "Tenant payment reminder email: don't
 * repeat the property address. Reword the opening to '[agency name] has
 * arranged an opndoor guarantee for your tenancy at [property address].
 * To put it in place, pay the guarantee fee of [fee] ([fee basis, e.g. 3
 * weeks of rent or one month's rent]).' Every bracketed part comes from
 * that application; nothing is hardcoded. Where there's no agency (a
 * direct signup), leave out the '[agency name] has arranged' part. Check
 * the other tenant emails for the same repetition."
 *
 * =====================================================================
 * WHAT WAS ACTUALLY REPEATED
 * =====================================================================
 *
 * Nudge 2 opened "Your tenancy at 12 Bridge Street is waiting on the
 * guarantee fee." and the sentence straight after it said "...for your
 * tenancy at 12 Bridge Street" again: the address twice in two lines,
 * and "your tenancy" twice with it. Nudge 3 named the fee and then the
 * ask named it again. So the lead is now only the escalation and every
 * fact lives in one sentence.
 *
 * AND THE DIRECT RAIL GAINED THE ASK. Until now a direct tenant's
 * reminder named no fee in its prose at all: the figure was in the table
 * and the sentence stopped after the address, so the one thing the email
 * exists to ask for was the one thing it did not say.
 *
 * NOTHING HARDCODED is asserted by deriving every expectation from the
 * fixture through the product's own feeBasisPhrase, so changing the
 * fixture cannot leave an assertion passing about a figure or a basis no
 * tenant was ever sent.
 */
import { describe, expect, it } from 'vitest';
import {
  directApprovalEmail, feeBasisPhrase, paymentReminderEmail, submissionReceivedEmail,
} from '../../supabase/functions/_shared/emailTemplates';

const ADDR = '12 Bridge Street, Leeds, LS1 4DX';
const BASE = {
  propertyAddr: ADDR,
  guaranteeRef: 'GR-40155',
  amount: '£1,450',
  payUrl: 'https://portal.example/pay?token=s',
  openUntilLabel: '14 October 2026',
};
const AGENCY = {
  rail: 'agency' as const,
  referencingMode: 'pre_referenced_open' as const,
  agencyName: "Regent's Lettings",
};
const NUDGES = [1, 2, 3] as const;
const opening = (m: { blocks: unknown[] }) => (m.blocks[0] as { p: string }).p;

describe('the address appears once, on every nudge and both rails', () => {
  it.each(NUDGES)('nudge %i, agency referral', (nudge) => {
    const body = opening(paymentReminderEmail({ ...BASE, nudge, copy: AGENCY, feeBasisWeeks: 3 }));
    expect(body.split(ADDR).length - 1, `address repeated on nudge ${nudge}`).toBe(1);
  });

  it.each(NUDGES)('nudge %i, direct signup', (nudge) => {
    const body = opening(paymentReminderEmail({ ...BASE, nudge, feeBasisWeeks: 3 }));
    expect(body.split(ADDR).length - 1, `address repeated on nudge ${nudge}`).toBe(1);
  });

  /* THE LEAD CARRIES NO FACTS AT ALL, which is what keeps the rule true
     as the nudges are reworded. If a future lead mentions the property,
     the fee or the tenancy, the sentence under it says the same thing
     again and this is the test that notices. */
  it.each(NUDGES)('and the lead on nudge %i adds no fact of its own', (nudge) => {
    const body = opening(paymentReminderEmail({ ...BASE, nudge, copy: AGENCY, feeBasisWeeks: 3 }));
    const lead = body.slice(0, body.indexOf("Regent's Lettings"));
    expect(lead).not.toContain(ADDR);
    expect(lead).not.toContain('£');
  });
});

describe("Matt's sentence, with every bracket filled from the application", () => {
  it('names the agency, the address, the fee and the basis, in that order', () => {
    const body = opening(paymentReminderEmail({ ...BASE, nudge: 1, copy: AGENCY, feeBasisWeeks: 3 }));
    expect(body).toContain(
      `${AGENCY.agencyName} has arranged an opndoor guarantee for your tenancy at ${ADDR}. `
      + `To put it in place, pay the guarantee fee of ${BASE.amount} (${feeBasisPhrase(3)}).`);
  });

  /* THE BASIS IS READ, NOT ASSUMED. Three weeks and a month are both real
     shapes on this book, and the old small print said only "payable once".
     Derived through feeBasisPhrase so the two cannot drift. */
  it('and a month-basis fee says a month, not three weeks', () => {
    const body = opening(paymentReminderEmail({ ...BASE, nudge: 1, copy: AGENCY, feeBasisWeeks: 4.33 }));
    expect(feeBasisPhrase(4.33)).toBe("one month's rent");
    expect(body).toContain(`pay the guarantee fee of ${BASE.amount} (${feeBasisPhrase(4.33)}).`);
  });

  /* AND AN UNKNOWN BASIS NAMES NO BASIS, rather than guessing a month.
     A reminder that priced a three-week fee as a month would misstate the
     price to somebody deciding whether to pay it. */
  it('and an unknown basis says nothing about one', () => {
    const body = opening(paymentReminderEmail({ ...BASE, nudge: 1, copy: AGENCY }));
    expect(body).toContain(`pay the guarantee fee of ${BASE.amount}.`);
    expect(body).not.toMatch(/weeks of rent|month's rent/);
  });

  /* A JOINT TENANCY IS PRICED ONCE AND CHARGED BY SHARE, so the ask names
     the share as a share and the basis as the tenancy's. Unchanged by this
     rewording, and asserted here because the new sentence runs through the
     same `ask`. */
  it('and a joint tenant is asked for a share, named as one', () => {
    const body = opening(paymentReminderEmail({
      ...BASE, nudge: 1, copy: AGENCY, feeBasisWeeks: 5, tenantCount: 2,
    }));
    expect(body).toContain(
      `To put it in place, pay your share of the guarantee fee, ${BASE.amount} `
      + `(the fee is ${feeBasisPhrase(5)}, split between 2 tenants).`);
  });
});

describe('a direct signup, where there is no agency to name', () => {
  it('leaves the agency clause out and still reads as a sentence', () => {
    const body = opening(paymentReminderEmail({ ...BASE, nudge: 1, feeBasisWeeks: 3 }));
    expect(body).toContain(`opndoor is acting as guarantor for your tenancy at ${ADDR}.`);
    expect(body).not.toMatch(/has arranged/);
  });

  /* THE HALF THAT WAS MISSING. A direct reminder used to stop after the
     address: no fee, no basis, no ask, in the email whose whole job is to
     ask. The figure was in the table and nowhere in the words. */
  it('and asks for the fee, which it did not used to do at all', () => {
    const body = opening(paymentReminderEmail({ ...BASE, nudge: 1, feeBasisWeeks: 3 }));
    expect(body).toContain(`To put it in place, pay the guarantee fee of ${BASE.amount} (${feeBasisPhrase(3)}).`);
  });

  /* AN AGENCY ON OPNDOOR-REFERENCED TERMS IS NOT "ARRANGED BY" THEM: we
     made the decision, so the sentence must not credit the agency with it.
     The existing rail rule, re-asserted because the new sentence sits on
     top of it. */
  it('and so does an agency referral we referenced ourselves', () => {
    const body = opening(paymentReminderEmail({
      ...BASE, nudge: 1, feeBasisWeeks: 3,
      copy: { rail: 'agency', referencingMode: 'opndoor_referenced', agencyName: "Regent's Lettings" },
    }));
    expect(body).not.toMatch(/has arranged/);
    expect(body).toContain('opndoor is acting as guarantor');
  });
});

/* =====================================================================
   THE SWEEP: "Check the other tenant emails for the same repetition."
   ===================================================================== */
describe('the other tenant emails', () => {
  const rowsOf = (m: { blocks: unknown[] }) =>
    (m.blocks.find((b) => (b as { rows?: unknown }).rows) as { rows: [string, string][] }).rows;

  it('the submission acknowledgement names the property once, in the sentence', () => {
    const m = submissionReceivedEmail({ propertyAddr: ADDR, guaranteeRef: 'GR-1', feeBasisWeeks: 4.33 });
    expect(opening(m)).toContain(ADDR);
    expect(rowsOf(m).map((r) => r[0])).not.toContain('Property');
  });

  it('and so does the direct approval', () => {
    const m = directApprovalEmail({
      propertyAddr: ADDR, guaranteeRef: 'GR-1', amount: '£1,450', portalUrl: 'x', feeBasisWeeks: 4.33,
    });
    expect(opening(m)).toContain(ADDR);
    expect(rowsOf(m).map((r) => r[0])).not.toContain('Property');
  });

  /* THE THREE THAT LOOK LIKE THE SAME FAULT AND ARE NOT. The invite, the
     deed to sign and the executed deed say "the property below" and "the
     tenancy below" and defer to the table, so the address appears exactly
     once and the ROW is the one place it lives. Removing it there would
     delete the address from the email rather than de-duplicate it, which
     is why the sweep has to read the prose and not count identifiers.
     Asserted so a later tidy-up does not "finish the job". */
  it('and the ones that defer to the table keep their Property row', async () => {
    const { deedToSignEmail, executedDeedTenantEmail, tenantInviteEmail } =
      await import('../../supabase/functions/_shared/emailTemplates');
    for (const m of [
      deedToSignEmail({ guaranteeRef: 'GR-1', tenantName: 'Ada', propertyAddr: ADDR, signUrl: 'x' }),
      executedDeedTenantEmail({ guaranteeRef: 'GR-1', propertyAddr: ADDR }),
      tenantInviteEmail({ referrerName: 'Priya', propertyAddr: ADDR, inviteUrl: 'x' }),
    ]) {
      expect(rowsOf(m).map((r) => r[0])).toContain('Property');
      expect(opening(m)).not.toContain(ADDR);
    }
  });
});
