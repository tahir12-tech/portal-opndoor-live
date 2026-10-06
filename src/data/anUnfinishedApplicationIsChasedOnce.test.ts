/* THE EMAIL THAT TELLS A TENANT THEIR APPLICATION IS ABOUT TO CLOSE, AND
   THE ROW THAT STOPPED SAYING THEIR RENT WAS ZERO.
 *
 * Matt, 2026-10-02, verbatim:
 *
 *   "3. At 25 days with no activity, email the tenant: their application
 *       will close in 5 days, with a link to carry on.
 *    4. In the Applications list, an unfinished application with no rent
 *       yet shows "Not given yet" instead of "£0 per month"."
 *
 * The thirty-day close itself is SQL and is proved in
 * supabase/tests/an_unfinished_application_waits_thirty_days.test.sql,
 * which runs the sweep, the warning and the reopen against real rows. This
 * file is the two halves that live in the client and in the shared
 * templates: emailTemplates.ts has no Deno-only imports, so vitest -- the
 * suite that actually runs on this machine -- can exercise it directly.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { draftClosingEmail } from '../../supabase/functions/_shared/emailTemplates';

const base = {
  guaranteeRef: 'GR-20625',
  closesOnLabel: '7 October 2026',
  applyUrl: 'https://portal.test/apply?utm_source=closing_notice',
};
const text = (m: ReturnType<typeof draftClosingEmail>) =>
  [m.subject, m.heading, ...m.blocks.map((b: Record<string, unknown>) =>
    typeof b.p === 'string' ? b.p : typeof b.small === 'string' ? b.small : '')].join(' | ');

describe('the closing notice', () => {
  it('says how many days are left and when it closes', () => {
    const m = draftClosingEmail({ ...base, daysLeft: 5, propertyAddr: '14 Chalcot Square, NW1 8YA' });
    expect(m.subject).toBe('Your opndoor application closes in 5 days');
    expect(text(m)).toContain('in 5 days');
    expect(JSON.stringify(m.blocks)).toContain('7 October 2026');
  });

  /* NOT ALWAYS FIVE. Five is the gap between the two thresholds, and it is
     right on the day the warning first becomes due. The unfinished
     applications already sitting on dev when this shipped were 28 and 29
     days quiet, so their real answer was two days and one. An email that
     says five while the thing closes tomorrow is worse than none. */
  it('and says "tomorrow" rather than a wrong number when that is the truth', () => {
    const m = draftClosingEmail({ ...base, daysLeft: 1, propertyAddr: null });
    expect(m.subject).toBe('Your opndoor application closes tomorrow');
    expect(text(m)).toContain('closes tomorrow');
    expect(text(m)).not.toContain('in 1 days');
  });

  /* THE PROPERTY IS OPTIONAL, because the address is a later step and a
     draft may be nothing but an email address. Two of dev's were. */
  it('names the property when there is one, and reads as English when there is not', () => {
    expect(text(draftClosingEmail({ ...base, daysLeft: 5, propertyAddr: '14 Chalcot Square, NW1 8YA' })))
      .toContain('an application for 14 Chalcot Square');
    const bare = text(draftClosingEmail({ ...base, daysLeft: 5, propertyAddr: null }));
    expect(bare).toContain('You started an application and have not finished it');
    expect(bare).not.toContain('for  ');
  });

  /* IT SAYS WHAT CLOSING COSTS, which is nothing. That is Matt's own rule
     for the expiry -- "Expiry loses nothing: if the tenant signs in again,
     it reopens where they left off" -- and an email that threatened a loss
     that is not a loss would be the product lying to make a deadline bite. */
  it('and tells them closing loses nothing, because it does not', () => {
    const m = draftClosingEmail({ ...base, daysLeft: 5, propertyAddr: null });
    expect(text(m)).toContain('Closing it loses nothing');
    expect(text(m)).toContain('picks up where you left off');
    expect(text(m)).toContain('same reference');
  });

  it('and carries the link to carry on', () => {
    const m = draftClosingEmail({ ...base, daysLeft: 5, propertyAddr: null });
    expect(m.action?.href).toBe(base.applyUrl);
    expect(m.action?.label).toBe('Carry on with your application');
  });

  it('and goes to the tenant, not the portal', () => {
    expect(draftClosingEmail({ ...base, daysLeft: 5 }).audience).toBe('tenant');
  });

  /* NO EM DASHES IN PRODUCT COPY. */
  it('and has no em dashes in it', () => {
    expect(JSON.stringify(draftClosingEmail({ ...base, daysLeft: 5, propertyAddr: 'X' }))).not.toContain('—');
  });
});

/* =====================================================================
   AND THE ROW THAT SAID £0.
   ===================================================================== */
describe('a rent nobody has typed yet', () => {
  const src = readFileSync('src/pages/Applications/Applications.tsx', 'utf8');

  it('reads "Not given yet" instead of a figure', () => {
    expect(src).toContain('Not given yet');
  });

  /* THE SUB-LINE GOES WITH IT. "per month" under "Not given yet" would be
     the same sentence the fix is removing, one line down. Both live in one
     cell now, on the two sides of a test on the rent itself. */
  it('and takes the "per month" line with it', () => {
    expect(src).toContain('{r.rent');
    // lastIndexOf: the comment above the cell quotes Matt's sentence, which
    // contains the phrase too. The JSX is the last one.
    expect(src.indexOf("'per month'")).toBeLessThan(src.lastIndexOf('Not given yet'));
  });
});

/* =====================================================================
   AND THE DAILY JOB DOES THE TWO IN THE RIGHT ORDER.

   Closing first and warning second is not a preference: a draft quiet for
   40 days is past both thresholds, and warning first would email "this
   closes in 5 days" about something the same run is closing. The SQL side
   asserts the consequence; this asserts the caller, because the order is
   the caller's to get wrong.
   ===================================================================== */
describe('the daily job', () => {
  const src = readFileSync('supabase/functions/payment-reminders/index.ts', 'utf8');

  it('closes stale drafts before it warns anybody', () => {
    const close = src.indexOf('expire_stale_drafts');
    const warn = src.indexOf('fire_draft_closing_notices');
    expect(close).toBeGreaterThan(-1);
    expect(warn).toBeGreaterThan(close);
  });

  /* A BROKEN WARNING MUST NOT LOSE THE PAYMENT REMINDERS that have already
     been sent above it, which is why it logs rather than throws. */
  it('and a failure there does not fail the run', () => {
    expect(src).toContain('draft_closing_notices_failed');
  });
});

/* =====================================================================
   AND SIGNING IN REOPENS WHAT CLOSED.
   ===================================================================== */
describe('the tenant portal', () => {
  const src = readFileSync('supabase/functions/tenant-portal/index.ts', 'utf8');

  it('reopens a closed draft on every authenticated request', () => {
    expect(src).toContain('reopen_expired_draft');
  });

  /* BEFORE start_application, whose "one live application" lookup
     deliberately excludes terminal states so somebody whose application
     closed can begin again. Reopen after it and they would get a fresh
     empty application with a new reference, which is the one outcome
     "same reference" rules out. */
  it('and does it before start_application could hand them a new reference', () => {
    expect(src.indexOf('reopen_expired_draft')).toBeLessThan(src.indexOf('"start_application"'));
  });
});
