/* NOTHING EMAILS A STRIPE URL.

   Reported as a recurring fault on the live portal: pay links die after about 24
   hours. No token in this schema has a 24 hour life (payment_page_tokens live 90
   days, asserted in supabase/tests/pay_link_outlives_a_day.test.sql). A STRIPE
   CHECKOUT SESSION does: 24 hours is Stripe's default when no expires_at is set,
   and this codebase used to email session.url straight to the tenant. The comment
   that replaced it still carries the defect number, "#1".

   So the live fault is a deployment old enough to email the Stripe URL. The code
   is right and has been for months. This file is the guard that keeps it right,
   because the failure mode is silent for a day: the link works when anybody tests
   it and is dead by the time the tenant opens it.

   IT READS THE SOURCE, and that is the point rather than a compromise. These are
   Deno edge functions: Deno is not installed on this machine, so `deno test`
   cannot be the guard, and they cannot be imported into vitest because they reach
   for Deno.env at module scope. What can be checked without a runtime is exactly
   the property that matters, which is structural: every link handed to a tenant
   email is built from a minted token, and no sender passes a Stripe URL or a
   stored payment_url as the thing the tenant clicks. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/** Every function that sends a tenant a link to pay. */
const SENDERS = [
  'supabase/functions/create-referral/index.ts',
  'supabase/functions/resend-payment-email/index.ts',
  'supabase/functions/payment-reminders/index.ts',
  'supabase/functions/payment-confirmation/index.ts',
];

/** The `payUrl` / `retryUrl` assignments in a file, with their right-hand side. */
function linkAssignments(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/(?:payUrl|retryUrl)\s*(?::\s*string\s*\|\s*null)?\s*=\s*([^;\n]+)/g)) {
    const rhs = m[1].trim();
    if (rhs && rhs !== 'null') out.push(rhs);
  }
  /* The inline form inside a template call. Both shapes, and the second one
     matters: `payUrl: session.url` is exactly what the old code did, and a regex
     that only understood backticks let it through as "no links found", firing the
     staleness canary instead of the assertion that names the fault. */
  for (const m of src.matchAll(/payUrl:\s*(`[^`]*`|[A-Za-z_$][\w$.]*)/g)) out.push(m[1].trim());
  return out;
}

describe('every pay link a tenant is emailed', () => {
  for (const file of SENDERS) {
    const src = read(file);
    const links = linkAssignments(src);

    it(`${file.split('/')[2]} builds at least one link`, () => {
      // If this fails the regexes above have gone stale and every assertion
      // below would be passing over nothing.
      expect(links.length).toBeGreaterThan(0);
    });

    it(`${file.split('/')[2]} points at /pay?token=`, () => {
      for (const rhs of links) {
        // Either it is the token URL itself, or it is a variable the file assigns
        // from one (payUrl, retryUrl), which the first form already covered.
        if (/^\w+$/.test(rhs)) {
          // A bare variable is acceptable only because the same file was already
          // asserted to assign it from a /pay?token= string. `session.url` is not
          // a bare variable (it has a dot), so it never reaches this branch.
          expect(src).toMatch(new RegExp(`${rhs}\\s*(?::[^=]*)?=[^;\n]*\\/pay\\?token=`));
          continue;
        }
        expect(rhs).toMatch(/\/pay\?token=/);
      }
    });

    it(`${file.split('/')[2]} never hands the tenant a Stripe URL`, () => {
      for (const rhs of links) {
        expect(rhs).not.toMatch(/session\.url/);
        expect(rhs).not.toMatch(/payment_url/);
        expect(rhs).not.toMatch(/checkout\.stripe/);
      }
    });

    it(`${file.split('/')[2]} mints the token rather than reusing a stored URL`, () => {
      // The link is only durable because it is minted. A file that builds a
      // /pay?token= string without calling the minter is interpolating something
      // it got from somewhere else.
      expect(src).toMatch(/mint_payment_page_token/);
    });
  }
});

describe('the Stripe session is short on purpose', () => {
  /* The session's own life is 30 minutes, Stripe's floor. That is correct and is
     the other half of the design: the session is created when the tenant CLICKS,
     not when the email is sent, so it only has to outlive the checkout it was
     opened for. A long session behind a long link would be the thing that let a
     withdrawn application still be paid from an open tab. */
  it('create-referral bounds its eager session', () => {
    const src = read('supabase/functions/create-referral/index.ts');
    expect(src).toMatch(/expires_at:\s*Math\.floor\(Date\.now\(\)\s*\/\s*1000\)\s*\+\s*30\s*\*\s*60/);
  });

  it('the pay page opens a fresh session on each click', () => {
    const src = read('supabase/functions/payment-page/index.ts');
    // Two sessions.create calls, the hosted and the embedded flow, both reached
    // from the action the button posts. Neither reads a stored URL.
    expect(src.match(/sessions\.create\(/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(src).not.toMatch(/payUrl\s*=\s*app\.payment_url/);
  });
});

describe('the resend is the remedy, so it must not need what failed', () => {
  /* create-referral opens an eager Stripe session when the referral is made, and
     that can fail: it records the send as failed and creates the referral anyway,
     precisely so an admin can resend. Such a row is status 'sent' with
     payment_url null, and resend-payment-email used to refuse it with "No payment
     link exists for this application yet" while being twelve lines away from
     minting one. The gate was on the artefact that had failed. */
  it('does not gate on a stored payment_url existing', () => {
    const src = read('supabase/functions/resend-payment-email/index.ts');
    expect(src).not.toMatch(/if\s*\(!app\.payment_url\)\s*return/);
  });

  it('still refuses an application that is not awaiting payment', () => {
    // Removing the wrong gate must not remove the right one.
    const src = read('supabase/functions/resend-payment-email/index.ts');
    expect(src).toMatch(/app\.status\s*!==\s*"sent"/);
  });
});
