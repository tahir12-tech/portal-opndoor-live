/* =====================================================================
   A WITHDRAWN REFERRAL IS NOT WAITING FOR A DEED.

   Matt, 2026-10-03: "Withdrawn application page: the timeline shows 'Deed
   Issued: Awaiting deed' and the guarantee card says 'Reserved · confirmed
   once the deed is issued' with 'Rent to be guaranteed £12,000'. For
   withdrawn (and expired) applications show 'Not issued: application
   withdrawn' instead, and no rent to be guaranteed."

   THREE CLAIMS ABOUT A FUTURE THAT IS NOT COMING. The timeline already drew
   the termination -- `timelineTerminated` caps the reached node at Sent -- so
   the strip was right and every caption on it was written for a referral still
   in flight.

   AND THE RENT ROW IS THE SHARPEST OF THEM: "Rent to be guaranteed £12,000"
   on a closed referral reads as cover somebody has. It is DROPPED rather than
   zeroed, because £0 is a different claim and an equally wrong one.

   AND THE WITHDRAW DIALOG, in the same file, which told the person pressing it
   that withdrawn referrals are "excluded from conversion figures and Leagues".
   They are not: `reachedPayment` answers true for `withdrawn` and its own test
   says why, "a withdrawn referral reached the tenant". So it counts as sent,
   in the denominator of every conversion figure, and never converted.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reachedPayment } from '@/data/applicationsService';

const PAGE = readFileSync(join(process.cwd(), 'src/pages/ApplicationDetail/ApplicationDetail.tsx'), 'utf8');

describe('what actually happens to a withdrawn referral', () => {
  /* THE MEASUREMENT BEHIND THE COPY. Checked before the words were changed,
     because "they now count as sent" is Matt's claim about the code and the
     copy has to match the code rather than the claim. */
  it('counts as a referral sent', () => {
    expect(reachedPayment({ status: 'withdrawn' } as never)).toBe(true);
  });

  it('and so does an expired one', () => {
    expect(reachedPayment({ status: 'expired' } as never)).toBe(true);
  });
});

describe('the timeline and the guarantee card', () => {
  it('say Not issued, naming which of the two it was', () => {
    expect(PAGE).toContain("deedDate = 'Not issued';");
    expect(PAGE).toContain("? 'Not issued: application expired'");
    expect(PAGE).toContain(": 'Not issued: application withdrawn';");
  });

  /* ON BOTH TERMINAL STATES, which is Matt's own parenthesis: "(and expired)".
     `timelineTerminated` is already the pair, so the condition is the one the
     strip itself uses rather than a second definition of closed. */
  it('through the condition the strip already uses', () => {
    expect(PAGE).toContain("const timelineTerminated = d.status === 'withdrawn' || d.status === 'expired';");
    expect(PAGE).toContain('if (timelineTerminated) {\n    deedDate =');
  });

  it('and the card no longer reserves a deed that is not coming', () => {
    expect(PAGE).toMatch(/const gsumNote = isDeed[\s\S]{0,400}timelineTerminated/);
  });

  /* DROPPED, NOT ZEROED. The assertion is on the guard, because a £0 row
     would satisfy "no rent to be guaranteed" read loosely and is a claim of
     its own.

     THE GUARD GAINED A SECOND CLAUSE on 2026-10-04 and this had pinned the
     first one's exact text. Matt (az): a cancelled guarantee shows no
     guaranteed rent either, for the same reason a withdrawn one does not --
     it is a figure about cover somebody has, and nobody has this. The
     assertion now names both conditions rather than the whole line, so the
     next clause added for the next terminal state does not break it while
     the rule it guards is still being kept. */
  it('and the rent row is gone rather than zero', () => {
    const guard = PAGE.slice(PAGE.indexOf('{!timelineTerminated'), PAGE.indexOf('Rent to be guaranteed'));
    expect(guard, 'the rent row is still behind a guard').toContain('!timelineTerminated');
    expect(guard, 'and a cancelled guarantee is behind it too').toContain('!refundEnded');
    expect(PAGE).not.toMatch(/Rent to be guaranteed[\s\S]{0,120}£0/);
  });
});

describe('the withdraw dialog', () => {
  /* IT PROMISES TWO THINGS ABOUT THE TENANT NOW, and both are built: the link
     closes through `getPayPageState`, and withdraw-notice emails them. A
     dialog that promised either without it being true would be worse than the
     sentence it replaced. */
  it('says it still counts as sent, and never that it is excluded', () => {
    const sub = /sub="Withdrawing closes this referral[^"]*"/.exec(PAGE)![0];
    expect(sub).toContain('It still counts as a referral sent');
    expect(sub).toContain('it never converted');
    expect(sub).not.toMatch(/excluded from conversion/);
  });

  it('and says the link stops and the tenant is told', () => {
    const sub = /sub="Withdrawing closes this referral[^"]*"/.exec(PAGE)![0];
    expect(sub).toContain("The tenant's payment link stops working");
    expect(sub).toContain('they are emailed to say the agency has withdrawn it');
  });

  /* AND THE EMAIL EXISTS, which is the half a copy assertion cannot check. */
  it('and that email is actually sent, with a sandbox gate on it', () => {
    const svc = readFileSync(join(process.cwd(), 'src/data/applicationsService.ts'), 'utf8');
    expect(svc).toContain("await sb().functions.invoke('withdraw-notice', { body: { ref } });");
    const fn = readFileSync(join(process.cwd(), 'supabase/functions/withdraw-notice/index.ts'), 'utf8');
    expect(fn).toContain('maySendOpndoorEmail(app.livemode === true)');
    // It refuses to tell a tenant about a withdrawal that has not happened.
    expect(fn).toContain('if (app.status !== "withdrawn")');
  });

  /* THE WITHDRAWAL STANDS IF THE EMAIL FAILS. Throwing there would tell the
     person who pressed the button that it had not worked when it had, and
     their second press meets "Only an application at Sent can be withdrawn". */
  it('and a failed email does not fail the withdrawal', () => {
    const svc = readFileSync(join(process.cwd(), 'src/data/applicationsService.ts'), 'utf8');
    const after = svc.slice(svc.indexOf("invoke('withdraw-notice'"));
    expect(after.slice(0, 220)).toMatch(/\} catch \{/);
  });
});

describe('the other two sentences that said the same wrong thing', () => {
  /* THE SWEEP. The dialog was one of three places claiming it; the banner on
     the record and the payment card said it too, and a reader who corrected
     their understanding from the dialog would have met it again twice. */
  it('are corrected too', () => {
    expect(PAGE).not.toMatch(/It is excluded from conversion figures and Leagues/);
    expect(PAGE).not.toMatch(/It is excluded from conversion figures and receives no payment reminders/);
    expect((PAGE.match(/still counts as a referral sent/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
