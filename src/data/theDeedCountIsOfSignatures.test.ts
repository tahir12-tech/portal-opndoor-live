/* "DEED 2 OF 2" ON A TENANCY WITH ONE SIGNATURE.
 *
 * Matt, 2026-10-01, verbatim: "Bug on joint tenancy GR-23853/GR-23854:
 * Joint Two signed first, and the agent's signed-deed email said 'deed 2
 * of 2' and 'This is the last of this tenancy's deeds: every tenant has
 * now signed their own', while Joint One has not paid or signed. The
 * count must be of deeds actually signed ('1 of 2 signed'), and 'every
 * tenant has now signed' only appears when it's true. Check the same
 * logic everywhere it appears (emails, application detail, Applications
 * list)."
 *
 * AN ORDINAL READ AS A COUNT. The email was given `tenancy_position`, the
 * order the agent typed the tenants in, so the second tenant's deed was
 * "2 of 2" whoever had signed -- and the closing sentence, which is the
 * one an agent acts on, followed the same number. An agent who filed that
 * email believed a tenancy was fully guaranteed when half of it was.
 *
 * THE SCREENS WERE ALREADY RIGHT, and are asserted here too, because the
 * instruction says to check all three and because the email now has to
 * agree with them: `tenancyDeedProgress` counts executed deeds, which is
 * the same question the email is finally asking.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { executedDeedAgentEmail, referrerPaidEmail } from '../../supabase/functions/_shared/emailTemplates.ts';
import { renderText } from '../../supabase/functions/_shared/emailLayout.ts';
import { tenancyDeedProgress } from './tenancyGroups';

const base = {
  guaranteeRef: 'GR-23854', tenantName: 'Joint Two',
  propertyAddr: '1 Example Road, N1 1AA', tenancyStartLabel: '29 Dec 2026',
};

const text = (joint: { signed: number; count: number; paid?: number; coTenants: string } | null) =>
  renderText(executedDeedAgentEmail({ ...base, joint }));

describe('the agent’s signed-deed email', () => {
  /* THE REPORTED CASE, exactly: the second tenant signs first. */
  it('counts the signatures, not the tenant’s place in the list', () => {
    const t = text({ signed: 1, count: 2, coTenants: 'Joint One' });
    expect(t).toContain('1 of 2 deeds signed');
    expect(t).not.toContain('2 of 2');
  });

  it('and does not claim everybody has signed while somebody has not', () => {
    const t = text({ signed: 1, count: 2, coTenants: 'Joint One' });
    expect(t).not.toContain('every tenant has now signed');
    expect(t).toContain('one more deed follows');
  });

  it('and says it only when it is true', () => {
    const t = text({ signed: 2, count: 2, coTenants: 'Joint One' });
    expect(t).toContain('2 of 2 deeds signed');
    expect(t).toContain('every tenant has now signed their own');
  });

  /* THE SUBJECT LINE CARRIED THE SAME NUMBER, and is what an agent sees
     first in a list of mail. */
  it('and the subject counts signatures too', () => {
    expect(executedDeedAgentEmail({ ...base, joint: { signed: 1, count: 2, coTenants: 'Joint One' } }).subject)
      .toBe('Signed Deed of Guarantee for GR-23854 (1 of 2 signed)');
  });

  it('while a tenancy of one is untouched', () => {
    const t = text(null);
    expect(t).not.toContain('of 1');
    expect(t).not.toContain('joint tenancy');
  });

  /* THREE OF THREE, where the old wording said "one more deed follows"
     off a subtraction that used the position. */
  it('and a three-way tenancy counts the two still out', () => {
    expect(text({ signed: 1, count: 3, coTenants: 'B, C' })).toContain('2 more deeds follow');
  });
});

describe('the screens, which were already counting signatures', () => {
  const group = (deedsExecuted: number, members: number) =>
    ({ deedsExecuted, members: Array.from({ length: members }, (_, i) => ({ ref: `r${i}` })) } as never);

  it('say the same thing as the email now does', () => {
    expect(tenancyDeedProgress(group(1, 2))).toBe('1 of 2 deeds executed');
    expect(tenancyDeedProgress(group(2, 2))).toBe('2 of 2 deeds executed');
  });
});

/* AND THE SAME QUESTION ONE STEP EARLIER.
 *
 * Matt, 2026-10-01: 'Agent "fee paid" email for a joint tenancy: add how
 * many have paid, e.g. "1 of 2 tenants have paid."'
 *
 * Each tenant pays their own share, so an agent gets one of these per
 * tenant, days apart, each naming a different person and none of them
 * saying where the tenancy had got to.
 */
describe('the agent’s fee-paid email', () => {
  const paidBase = {
    guaranteeRef: 'GR-23853', tenantName: 'Joint One',
    propertyAddr: '1 Example Road, N1 1AA',
  };

  it('says how many of the tenants have paid', () => {
    const t = renderText(referrerPaidEmail({ ...paidBase, joint: { paid: 1, count: 2 } }));
    expect(t).toContain('1 of 2 tenants has paid');
  });

  it('and reads as English when they all have', () => {
    const t = renderText(referrerPaidEmail({ ...paidBase, joint: { paid: 2, count: 2 } }));
    expect(t).toContain('2 of 2 tenants have paid');
  });

  /* "1 OF 1 TENANTS HAVE PAID" IS NOISE, and most of the book is one. */
  it('and says nothing of the sort on a tenancy of one', () => {
    expect(renderText(referrerPaidEmail(paidBase))).not.toMatch(/of \d+ tenants/);
    expect(renderText(referrerPaidEmail({ ...paidBase, joint: { paid: 1, count: 1 } })))
      .not.toMatch(/of \d+ tenants/);
  });
});

/* AND WHAT THE OTHERS STILL HAVE TO DO.
 *
 * Matt, 2026-10-03, verbatim: "the agent's joint-tenancy line says 'one more
 * deed follows once the other tenant has paid and signed' even when the other
 * tenant has already paid; say 'once the other tenant has signed' in that
 * case."
 *
 * The sentence asserted a payment outstanding without ever asking, so an agent
 * chasing the money chased a tenant who had already paid, and the one thing
 * actually outstanding -- a signature -- was buried in a list of two.
 *
 * ASKED OF THE UNPAID COUNT, not of a boolean, because of the three-way case
 * below: one of two outstanding tenants having paid still leaves somebody to
 * pay, and there "paid and signed" is the truthful wording for the set.
 */
describe('what the outstanding tenants still have to do', () => {
  it('is signing alone, once they have paid', () => {
    const t = text({ signed: 1, count: 2, paid: 2, coTenants: 'Joint One' });
    expect(t).toContain('one more deed follows once the other tenant has signed');
    expect(t).not.toContain('paid and signed');
  });

  it('and is paying and signing while they have not', () => {
    const t = text({ signed: 1, count: 2, paid: 1, coTenants: 'Joint One' });
    expect(t).toContain('one more deed follows once the other tenant has paid and signed');
  });

  /* THREE WAYS, ONE PAYMENT SHORT. Both tenants are still to sign and one of
     them is still to pay, so the payment half stays: it is true of the set. */
  it('and stays both on a three-way let where one of the two has paid', () => {
    const t = text({ signed: 1, count: 3, paid: 2, coTenants: 'B, C' });
    expect(t).toContain('2 more deeds follow once the other tenants have paid and signed');
  });

  it('while all three paid leaves only the signatures', () => {
    const t = text({ signed: 1, count: 3, paid: 3, coTenants: 'B, C' });
    expect(t).toContain('2 more deeds follow once the other tenants have signed');
  });

  /* A CALLER THAT CANNOT SAY KEEPS THE OLD SENTENCE. Unknown reads as "there
     may be a payment outstanding", which is the safe half to be wrong about:
     it asks the agent to check rather than telling them not to. */
  it('and a caller that does not say keeps "paid and signed"', () => {
    expect(text({ signed: 1, count: 2, coTenants: 'Joint One' })).toContain('paid and signed');
  });
});

/* AND THE COUNT COMES OFF paid_at, in the one place that gathers it. */
describe('where the paid count comes from', () => {
  const SRC = readFileSync('supabase/functions/_shared/deedEmail.ts', 'utf8');

  it('is the tenancy’s rows, tested on paid_at', () => {
    expect(SRC).toContain('deed_state, paid_at');
    expect(SRC).toContain('m.id === target.appId || !!m.paid_at');
  });

  /* THE SIGNING ROW COUNTS ITSELF, on both tallies and for the same reason:
     a tenant whose deed has just been executed paid to get it, and the order
     the webhook writes the two stamps in is not something the sentence may
     depend on. */
  it('and counts this row whatever its own stamp says, as the signed tally does', () => {
    expect(SRC).toContain('m.id === target.appId || m.deed_state === "executed"');
  });
});
