/* A SANDBOX APPLICATION DOES NOT EMAIL A REAL PERSON.
 *
 * Round 5, M7. `_shared/referrerNotify.ts` sends the agent "submitted",
 * "approved", "declined" and "paid" for an application, and had no livemode
 * test of any kind. A partner working through their sandbox token therefore
 * put "your tenant has been approved" in the inbox of a real negotiator,
 * about a tenant who does not exist.
 *
 * It was the only one. Every other per-application sender already filters,
 * and this file asserts the whole set rather than the one that was broken,
 * because the next one added is the next M7:
 *
 *   fire_payment_reminders    where a.livemode          (in SQL)
 *   expiry-reminders          .eq("livemode", true)
 *   pandadoc                  livemode picks the account and the credentials
 *
 * THE EXCEPTIONS ARE NAMED, NOT INFERRED. Three of them: ops-alert emails our
 * own ops inbox; deedEmail is reached only through the PandaDoc path, which
 * _shared/pandadoc.ts already routes by livemode; and payment-reminders IS
 * gated, but in SQL, because its worklist is fire_payment_reminders. Each is
 * listed below with that reason, at an exact count, so the list cannot grow by
 * accident, and the third is made to prove itself against the schema rather
 * than be taken on trust. Pretending to full coverage by loosening the check
 * would be worse than having none.
 *
 * It reads source because these are Deno edge functions: `npm test` cannot
 * collect them (vitest.config.ts), and referrerNotify cannot even be imported,
 * because it pulls in mailer.ts which reads Deno.env at module scope.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error - plain .mjs helper, shared with scripts/schema-drift.mjs
import { finalState } from '../../scripts/schema-final-state.mjs';

const state = finalState();

const DIR = join(process.cwd(), 'supabase', 'functions');

const FILES = readdirSync(DIR)
  .filter((d) => statSync(join(DIR, d)).isDirectory())
  .flatMap((d) => readdirSync(join(DIR, d))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => `${d}/${f}`));

const read = (rel: string) => readFileSync(join(DIR, rel), 'utf8');

/** Reads an application AND sends email about it. */
const senders = FILES.filter((f) => {
  const s = read(f);
  return /from\("applications"\)/.test(s) && /\bsendMessage\s*\(/.test(s);
});

/* Named, with the reason each is not gated. */
const EXEMPT: Record<string, string> = {
  'ops-alert/index.ts': 'emails our own ops inbox, not a customer',
  '_shared/deedEmail.ts': 'reached only through the PandaDoc path, which _shared/pandadoc.ts already routes by livemode',
  // Gated, but in SQL rather than here: its whole worklist comes from
  // fire_payment_reminders, whose body carries `where a.livemode`. The grep
  // cannot see through an RPC, so this is named rather than special-cased.
  'payment-reminders/index.ts': 'its worklist is fire_payment_reminders, which filters `where a.livemode`',
};

describe('per-application email', () => {
  it('found the senders, so a broken glob cannot pass silently', () => {
    expect(senders.length).toBeGreaterThan(5);
    // And referrerNotify, the one this is about, is in the set.
    expect(senders).toContain('_shared/referrerNotify.ts');
  });

  it('is gated on livemode everywhere it reaches a customer', () => {
    const ungated = senders.filter((f) => !EXEMPT[f] && !/livemode/.test(read(f)));
    expect(ungated).toEqual([]);
  });

  /* THE GATE, not merely the word. referrerNotify mentioning livemode in a
     comment would satisfy the check above and send anyway. */
  it('refuses to notify a referrer about a sandbox application', () => {
    const s = read('_shared/referrerNotify.ts');
    expect(s).toMatch(/\.select\([^)]*\blivemode\b/);
    expect(s).toMatch(/if\s*\(\s*app\.livemode\s*!==\s*true\s*\)\s*return;/);
  });

  it('has exactly the exemptions that were reasoned about', () => {
    expect(senders.filter((f) => EXEMPT[f]).sort()).toEqual(Object.keys(EXEMPT).sort());
  });

  /* AND THE ONE EXEMPTION THAT CLAIMS A GATE ELSEWHERE PROVES IT. An
     exemption whose reason nothing checks is how a list like this rots:
     fire_payment_reminders could lose its filter tomorrow and both the RPC
     and this file would still say it was safe. */
  it('proves payment-reminders really is gated in SQL', () => {
    const body = [...(state.funcBodies as Map<string, string>)]
      .find(([sig]) => sig.startsWith('fire_payment_reminders('))?.[1];
    expect(body).toBeTruthy();
    expect(body).toMatch(/livemode/);
  });
});
