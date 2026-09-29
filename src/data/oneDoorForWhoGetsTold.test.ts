/* EVERY AGENT-FACING SEND ASKS THE SAME QUESTION OF THE SAME FUNCTION.
 *
 * Q-02 and Q-03. docs/NOTIFICATIONS.md read the six agent-facing send paths
 * out of the code and found they resolved recipients SIX different ways:
 * the deed asked deed_delivery_target, the expiry reminder asked
 * agency_notification_recipients on one rail and built a list of that
 * PARTNER's management on the others, the renewal notice built a third list
 * from the row's own columns, and referrerNotify read one column. A matrix
 * consulted in six places is a matrix that is missed in one of them.
 *
 * So there is one door: notification_recipients(application, type). It answers
 * for all three rails and applies that party's matrix. This asserts that the
 * senders actually go through it, which is the half a SQL test cannot see.
 *
 * WHAT IS DELIBERATELY NOT IN THE MATRIX, and so is not asserted here: every
 * email to the tenant, and ops alerts. Q-03 locks both out of it, so the
 * tenant is still addressed directly and that is correct, not an omission.
 *
 * Source tests: these are Deno edge functions, `npm test` cannot collect them,
 * and most reach Deno.env at module scope so they cannot be imported. The
 * BEHAVIOUR of the resolver is asserted properly in
 * supabase/tests/one_door_for_who_gets_told.test.sql.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fn = (p: string) => readFileSync(join(process.cwd(), 'supabase', 'functions', p), 'utf8');

/** Each agent-facing sender, and the notification type it must ask for. */
const SENDERS: Array<[string, string[]]> = [
  ['_shared/referrerNotify.ts', ['sent', 'approved', 'decline', 'paid']],
  ['expiry-reminders/index.ts', ['lapse']],
  ['renewal-notices/index.ts', ['renewal_notice']],
];

describe('the agent-facing send paths', () => {
  it.each(SENDERS)('%s resolves its recipients through the one door', (file) => {
    expect(fn(file)).toMatch(/notification_recipients/);
  });

  it.each(SENDERS)('%s asks for the right notification type', (file, types) => {
    const src = fn(file);
    for (const t of types) expect(src, `${file} never names "${t}"`).toMatch(new RegExp(`["']${t}["']`));
  });

  /* THE OLD RESOLVERS ARE GONE FROM THEM, not merely bypassed. A file that
     still built its own list would keep working and would keep being wrong
     the day somebody edited the wrong one. */
  it('no longer builds a list of a whole partner\'s management', () => {
    expect(fn('expiry-reminders/index.ts')).not.toMatch(/mgmtByPartner/);
  });

  it('no longer asks the agency ladder directly from a send path', () => {
    for (const [file] of SENDERS) {
      expect(fn(file), `${file} still calls agency_notification_recipients`)
        .not.toMatch(/rpc\(\s*\n?\s*["']agency_notification_recipients["']/);
    }
  });

  /* ONE SEND WITH EACH AS A RECIPIENT. renewal-notices was the only
     notification in the product that looped sendMessage per address, which
     also made its "emailed" count addresses where every other job counts
     notifications. */
  it('renewal-notices sends once with everybody on it, not once each', () => {
    const src = fn('renewal-notices/index.ts');
    expect(src).toMatch(/sendMessage\(\{ to: recipients, message \}\)/);
    expect(src).not.toMatch(/for \(const to of recipients\)/);
  });

  /* AND THE PARKING SURVIVED. An expiry or a renewal that reaches nobody has
     to be said out loud -- that is why these two have an ops incident and an
     activity row rather than a silent success -- and "nobody" now includes
     "somebody switched it off", which is worth a line rather than a silence. */
  it('still parks and alerts when a reminder reaches nobody', () => {
    expect(fn('expiry-reminders/index.ts')).toMatch(/expiry_reminder_unaddressed/);
    expect(fn('renewal-notices/index.ts')).toMatch(/renewal_notice_unaddressed/);
  });

  /* THE TENANT IS NOT IN THE MATRIX and must still be told. */
  it('still tells the tenant on a renewal, separately from the matrix', () => {
    expect(fn('renewal-notices/index.ts')).toMatch(/\[r\.tenant_email, \.\.\.agents\]/);
  });
});
