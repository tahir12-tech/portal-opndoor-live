/* EVERY PATH THAT ISSUES A DEED TELLS THE TENANT ABOUT IT.
 *
 * Matt, 2026-10-04 (ai): "Stop PandaDoc emailing tenants: create and send
 * deeds silently so PandaDoc sends no email of its own, and make Opndoor's
 * 'Payment received' email the one with the 'Sign your Deed of Guarantee'
 * button ... 'Resend signature request' on the application must send
 * Opndoor's email with a fresh signing link ... Check the corrected-deed flow
 * (start-date changes) also uses Opndoor's email."
 *
 * =========================================================================
 * THE FAILURE THIS GUARDS IS SILENCE, WHICH NOTHING ELSE WOULD CATCH
 * =========================================================================
 *
 * Before `silent: true`, PandaDoc emailed the tenant from every path that
 * issued a deed, so no path had to remember. After it, a path that forgets
 * produces a deed nobody is asked to sign: no error, no failed send, no
 * incident, a green deployment and a tenancy that never completes. There are
 * SIX generateDeed call sites across five functions, written at different
 * times for different reasons, and the one somebody adds next week is the
 * one this test is really for.
 *
 * ESBUILD DOES NOT CATCH IT EITHER, which I found the hard way while making
 * this change: `esbuild --loader=ts` type-checks nothing and resolves no
 * imports, so two of these files called deliverSigningInvite without
 * importing it and the syntax check passed. Deno is not installed here, so
 * this file is the import check.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const FNS = resolve(process.cwd(), 'supabase/functions');
const read = (p: string) => readFileSync(p, 'utf8');

/** Every edge function's index.ts, by name. */
const functions = readdirSync(FNS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== '_shared')
  .map((d) => ({ name: d.name, src: (() => { try { return read(`${FNS}/${d.name}/index.ts`); } catch { return ''; } })() }))
  .filter((f) => f.src);

describe('PandaDoc no longer emails the tenant, in live', () => {
  /* SILENT IN LIVE, NOT IN SANDBOX, and the asymmetry is forced rather than
     chosen. maySendOpndoorEmail is `livemode` and absolute -- "Sandbox sends
     none. Not a different from address, not a redirect to a review mailbox:
     none" -- so silencing PandaDoc everywhere would leave a developer with
     no signing email from ANYBODY, deleting the rehearsal its own comment
     calls "most of the point" of sandbox. */
  it('the document is sent silently in live, and not in sandbox', () => {
    const pandadoc = read(`${FNS}/_shared/pandadoc.ts`);
    expect(pandadoc).toContain('silent: livemode');
    expect(pandadoc).not.toContain('silent: false');
  });

  /* THE TWO LINES THAT HAVE TO AGREE. If PandaDoc falls silent in sandbox
     while the invite still refuses to send there, nobody emails the tenant
     and the Dev Centre documents a journey that does not happen. */
  it('and the invite refuses sandbox for the same reason, from the same rule', () => {
    const invite = read(`${FNS}/_shared/signingInvite.ts`);
    expect(invite).toContain('maySendOpndoorEmail(app.livemode === true)');
  });

  /* THE DOCUMENT IS STILL SENT, which is the half not to get wrong. `silent`
     suppresses PandaDoc's notification, not the send; read as "do not send",
     the deed would sit in draft and nothing downstream would work. */
  it('but is still sent, so the deed leaves draft', () => {
    const pandadoc = read(`${FNS}/_shared/pandadoc.ts`);
    expect(pandadoc).toContain('/send');
  });

  /* ASKING PANDADOC TO REMIND A RECIPIENT IT NEVER EMAILED is a success that
     delivers nothing, which is worse than the two emails this replaced. */
  it('and nothing asks PandaDoc to send a reminder any more', () => {
    for (const f of functions) {
      expect(f.src, `${f.name} still calls remindSignature`).not.toContain('remindSignature(');
    }
  });
});

describe('every path that issues a deed emails the tenant', () => {
  const issuers = functions.filter((f) => f.src.includes('generateDeed('));

  it('there are issuers to check, so the filter has not quietly emptied', () => {
    expect(issuers.length).toBeGreaterThanOrEqual(5);
  });

  it('each one either sends the invite or sends the receipt that carries the button', () => {
    for (const f of issuers) {
      const tells = f.src.includes('deliverSigningInvite(') || f.src.includes('deliverPaymentReceipt(');
      expect(tells, `${f.name} issues a deed and tells nobody`).toBe(true);
    }
  });

  /* THE IMPORT CHECK esbuild cannot do. Two files failed this while the
     change was being written and their syntax check passed. */
  it('and imports what it calls', () => {
    for (const f of functions) {
      if (f.src.includes('deliverSigningInvite(')) {
        expect(f.src, `${f.name} calls deliverSigningInvite without importing it`)
          .toContain('import { deliverSigningInvite }');
      }
    }
  });
});

describe('the receipt is the email with the button', () => {
  const templates = read(`${FNS}/_shared/emailTemplates.ts`);
  const receipt = templates.slice(
    templates.indexOf('export function paymentReceiptEmail'),
    templates.indexOf('export function guaranteesCancelledEmail'),
  );

  it('offers Matt\'s button, in his words', () => {
    expect(receipt).toContain('Sign your Deed of Guarantee');
  });

  it('and his already-signed line, which a direct tenant needs seconds after paying', () => {
    expect(receipt).toContain("Already signed? Then you're all set and can ignore this.");
  });

  /* THE AGENCY NAME BEATS THE HEDGE. "The contact on your tenancy" was
     written for a tenant whose counterparty we did not know; it is still the
     fallback, and must stay one rather than becoming the only answer. */
  it('names the agency where we have one, and keeps the hedge where we do not', () => {
    expect(receipt).toContain('agencyName');
    expect(receipt).toContain('p.managedBy');
  });

  /* NO LINK IS NOT NO EMAIL. Their money moved and the confirmation of that
     is worth sending on its own. */
  it('still sends without a link, rather than not at all', () => {
    expect(receipt).toContain('p.signUrl ?');
  });
});

/* THE REFUND EMAILS, AND THE TWO THINGS MATT FOUND WRONG WITH THEM.
 *
 * (bb): 'a tenant refunded automatically by the cascade (e.g. GR-23854) gets
 * the plain "Your guarantee fee has been refunded" email with no
 * explanation ... Every refund email says the money goes back "to the way
 * you paid", not "the card you paid with" (Klarna and Revolut Pay exist).'
 *
 * (bc): 'the "These guarantees have been cancelled" email went twice each to
 * joe@joe.com and landlord@landlord.com (once per refunded tenant). Send it
 * exactly once per tenancy, after the last tenant's refund, and never again
 * on webhook redeliveries.'
 */
describe('refund emails', () => {
  const templates = read(`${FNS}/_shared/emailTemplates.ts`);
  const refund = templates.slice(
    templates.indexOf('export function refundEmail'),
    templates.indexOf('export function guaranteesCancelledEmail'),
  );

  /* A FACTUAL CORRECTION, not a style one: somebody who paid by Klarna and
     reads about a card refund goes looking for one that never comes. */
  it('say the money goes back the way it came, not to a card', () => {
    expect(refund).toContain('the way you paid');
    // Only the comment explaining the change may still carry the old phrase.
    const code = refund.split('\n').filter((l) => !l.trim().startsWith('/*') && !l.trim().startsWith('*')).join('\n');
    expect(code).not.toContain('the card you paid with');
  });

  it('and tell a cascaded tenant why their money came back', () => {
    expect(refund).toContain('is not going ahead');
    expect(refund).toContain("You don't need to do anything.");
  });

  /* THE THREE ARMS MUST STAY THREE. A tenant who asked for a refund must not
     be told the let is off, and a tenant whose deed was never issued must
     not be told it is cancelled. */
  it('without telling a tenant who asked for one that the let is off', () => {
    /* THREE ARMS, AND THEY MUST STAY THREE. My first version of this
       assertion matched the string "cascaded\n", which is a line ending
       rather than a rule: it would have passed on any file mentioning the
       word. What has to hold is that the branch exists and that the two
       wrong pairings cannot happen -- a self-requested refund told the let
       is off, or a cascaded one told to contact the agent. */
    expect(refund).toContain('const cascaded = p.cascaded === true;');
    // The branch exists in the blocks, not merely as a declared parameter.
    expect(refund).toContain('...(cascaded');
    // And the plain arm is still reachable: not every refund is a cascade.
    expect(refund).toContain(': cancelled');
    // And the agent-told line belongs to the non-cascaded cancellation only.
    const agentLine = 'Your letting agent has been told.';
    const idxAgent = refund.indexOf(agentLine);
    const idxCascade = refund.indexOf("You don't need to do anything.");
    expect(idxAgent).toBeGreaterThan(0);
    expect(idxCascade).toBeGreaterThan(0);
    expect(idxCascade, 'the cascaded arm comes first, before the plain cancelled one')
      .toBeLessThan(idxAgent);
  });
});

describe('the per-property notice goes once', () => {
  const webhook = read(`${FNS}/stripe-webhook/index.ts`);

  /* MY BUG. Each cascaded refund raises its own charge.refunded and runs the
     whole per-tenant path -- deliberately -- and the per-PROPERTY email was
     inside it. Two tenants, two notices. */
  it('is claimed before it is sent', () => {
    const i = webhook.indexOf('deliverCancellationNotice(');
    expect(i).toBeGreaterThan(0);
    const before = webhook.slice(Math.max(0, i - 600), i);
    expect(before, 'the notice is sent without claiming it first').toContain('claim_cancellation_notice');
    expect(before).toContain('mayNotify === true');
  });

  /* THE CLAIM IS A DATABASE INSERT, not a variable. A flag held in the
     function dies with it, and Stripe redelivers. */
  it('and the claim is durable, so a redelivery next week still finds it', () => {
    const mig = read(resolve(process.cwd(),
      'supabase/migrations/20261008150000_one_cancellation_notice_per_tenancy.sql'));
    expect(mig).toContain('create table if not exists public.cancellation_notices');
    expect(mig).toContain('on conflict (subject_id) do nothing');
  });
});
