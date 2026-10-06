/* THE LANDLORD GETS ONE EMAIL, WITH EVERY SIGNED DEED ON THE TENANCY.
 *
 * Matt, 2026-10-01, verbatim: '"Send deed to landlord" on a joint
 * tenancy: send all the tenancy's signed deeds in one email, listing each
 * tenant, and say if any are still unsigned ("Joint Two has not signed
 * yet; we'll send theirs when they do" only if you can, otherwise just
 * list what's attached). Landlord email: remove the duplicate "attached"
 * sentence, and remove "We will email you a month before the guarantee
 * ends" unless the landlord really does get that reminder.'
 *
 * A LANDLORD DOES NOT HOLD A TENANCY IN TWO HALVES. One deed described as
 * "the signed Deed of Guarantee" tells them the tenancy is covered when
 * half of it is: the agent's "deed 2 of 2" fault from the other end.
 *
 * AND THE REMINDER WAS A PROMISE NOBODY KEEPS. expiry-reminders addresses
 * notification_recipients(..., 'lapse'), which resolves portal users and
 * the branch's agent contact. A private landlord emailed once by their
 * agent is on no list at all, so the sentence described a letter that was
 * never going to arrive. Asserted here against the function itself.
 */
import { describe, expect, it } from 'vitest';
import { executedDeedAgentEmail, executedDeedLandlordEmail } from '../../supabase/functions/_shared/emailTemplates.ts';
import { renderText } from '../../supabase/functions/_shared/emailLayout.ts';

const base = {
  guaranteeRef: 'GR-23853', tenantName: 'Joint One',
  propertyAddr: '1 Example Road, N1 1AA', tenancyStartLabel: '29 Dec 2026',
};

describe('a joint tenancy', () => {
  it('names every tenant who has signed', () => {
    const t = renderText(executedDeedLandlordEmail({ ...base,
      joint: { signedNames: ['Joint One', 'Joint Two'], unsignedNames: [] } }));
    expect(t).toContain('Joint One, Joint Two');
    expect(t).toContain('2 signed Deeds of Guarantee for this tenancy are attached');
  });

  it('and says who has not, and that theirs follows', () => {
    const t = renderText(executedDeedLandlordEmail({ ...base,
      joint: { signedNames: ['Joint One'], unsignedNames: ['Joint Two'] } }));
    expect(t).toContain('Not yet signed');
    expect(t).toContain('Joint Two has not signed yet; we will send theirs when they do');
  });

  it('and says nothing of the sort when everybody has signed', () => {
    const t = renderText(executedDeedLandlordEmail({ ...base,
      joint: { signedNames: ['Joint One', 'Joint Two'], unsignedNames: [] } }));
    expect(t).not.toMatch(/not signed yet/);
  });

  /* THE SUBJECT CARRIED ONE REFERENCE for an email about two deeds. */
  it('and the subject is about the tenancy, not one of its deeds', () => {
    expect(executedDeedLandlordEmail({ ...base,
      joint: { signedNames: ['A', 'B'], unsignedNames: [] } }).subject)
      .toBe('Signed Deeds of Guarantee for 1 Example Road, N1 1AA');
  });
});

describe('a tenancy of one', () => {
  it('is unchanged: one deed, one tenant, one sentence', () => {
    const m = executedDeedLandlordEmail(base);
    const t = renderText(m);
    expect(m.subject).toBe('Signed Deed of Guarantee for GR-23853');
    expect(t).toContain('The signed Deed of Guarantee is attached.');
    expect(t).toContain('Joint One');
    expect(t).not.toMatch(/Not yet signed/);
  });
});

describe('what the email no longer says', () => {
  it('does not promise a reminder the landlord is on no list for', () => {
    const t = renderText(executedDeedLandlordEmail(base));
    expect(t).not.toMatch(/month before the guarantee ends/);
  });

  /* AND THE PROMISE IS STILL MADE WHERE IT IS KEPT: the agent is on the
     lapse list, so their copy keeps the sentence. */
  it('while the agent’s copy keeps it, because the agent does get one', () => {
    /* The agent IS on the lapse list: notification_recipients resolves the
       referrer, the ticked users and the branch contact. */
    const t = renderText(executedDeedAgentEmail({
      guaranteeRef: base.guaranteeRef, tenantName: base.tenantName,
      propertyAddr: base.propertyAddr, tenancyStartLabel: base.tenancyStartLabel,
    }));
    expect(t).toContain('We will email you a month before the guarantee ends.');
  });

  it('and says "attached" once', () => {
    const t = renderText(executedDeedLandlordEmail({ ...base, note: 'Hi, please find the deed attached.' }));
    expect((t.match(/attached/gi) ?? []).length).toBe(2); // the agent's own line, and ours
  });
});
