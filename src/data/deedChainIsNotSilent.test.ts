/* DEEDS NOT GENERATING, AND WHY NOBODY KNEW.

   Reported as a recurring fault on the live portal. Reading the chain end to end
   (stripe-webhook -> _shared/pandadoc.ts -> pandadoc-webhook) the striking thing
   is not that it can fail. Every integration can. It is that it could fail in
   eight distinct places and every one of them ended in an INTERNAL activity row
   on a single application and nothing else: no ops incident, no queue, nothing
   a person would ever be shown unless they already suspected that one deed and
   went looking for it. "Deeds are not generating" was therefore a thing agents
   told us, days later, one at a time, and the portal's own answer was silence.

   Four of those eight were worse than quiet, they were WRONG:

     - a failed deed_target RPC read as "solo tenancy, already paid", so a joint
       tenancy silently generated a single-tenant deed naming no co-tenants and
       guaranteeing no share;
     - a failed claim_tenancy_deed read as "somebody else has it", so a paid
       application got no deed and no record that one was attempted;
     - a pandadoc_events insert that was not a duplicate read as a duplicate, so
       a signed deed was answered 200 and never redelivered;
     - a deed email the provider refused read as delivered, because nothing in
       the tree ever called record_delivery_attempt and delivery_failed_at is
       what the "Delivery failed" badge reads.

   IT READS THE SOURCE, for the reason payLinkIsDurable.test.ts gives: these are
   Deno edge functions, Deno is not installed here, and they cannot be imported
   into vitest because they reach Deno.env at module scope. What can be checked
   without a runtime is the property that actually matters, which is structural:
   no result that decides whether a deed exists is discarded, and no path that
   ends without a deed ends without telling somebody. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const PANDADOC = 'supabase/functions/_shared/pandadoc.ts';
const STRIPE_HOOK = 'supabase/functions/stripe-webhook/index.ts';
const DEED_HOOK = 'supabase/functions/pandadoc-webhook/index.ts';
const MANUAL_SEND = 'supabase/functions/send-deed-to-agent/index.ts';

/** The body of generateDeed, which is where every generation decision is made. */
function generateDeedBody(): string {
  const src = read(PANDADOC);
  const start = src.indexOf('export async function generateDeed');
  expect(start, 'generateDeed has been renamed and every assertion below is passing over nothing').toBeGreaterThan(-1);
  return src.slice(start);
}

describe('generateDeed does not mistake a broken read for an answer', () => {
  it('checks the deed_target error instead of discarding it', () => {
    /* THE ONE THAT PRODUCES A WRONG DOCUMENT RATHER THAN NO DOCUMENT.
       supabase-js returns the error rather than throwing, so `const { data: tgt }`
       left tgt undefined on a failure, and undefined answers every question
       below it the way a tenancy of one does: the paid gate is skipped, joint is
       false, and co_tenant_names / share_amount / tenancy_tenant_names all go
       null. On a joint tenancy that is a legally wrong deed, signed. */
    const body = generateDeedBody();
    expect(body).toMatch(/rpc\("deed_target"[\s\S]{0,40}?\)/);
    expect(body).toMatch(/const \{ data: tgt, error: tgtErr \} = await service\.rpc\("deed_target"/);
    expect(body).toMatch(/if \(tgtErr\)/);
  });

  it('checks the deed_delivery_target error too, so an unread ladder is not an empty one', () => {
    // The branch below this one is terminal (it sets deed_state error and stops
    // generating), so "the RPC failed" must not fall into "this agency has
    // nobody".
    const body = generateDeedBody();
    expect(body).toMatch(/const \{ data: target, error: targetErr \} = await service\.rpc\("deed_delivery_target"/);
    expect(body).toMatch(/if \(targetErr\)/);
  });

  it('parks a missing recipient in the queryable queue, not only in an activity row', () => {
    /* A missing recipient must park VISIBLY. awaiting_staff_send is the flag the
       needs-attention surface filters on and the only one deliveryStateOf reads
       for 'cannot_deliver'; this branch set deed_state error and wrote one
       internal activity line, so a paid tenant with no deed appeared in no queue
       anywhere. */
    const body = generateDeedBody();
    const noContact = body.slice(body.indexOf('if (!agentEmail)'));
    expect(noContact.indexOf('if (!agentEmail)')).toBe(0);
    const branch = noContact.slice(0, noContact.indexOf('return {'));
    expect(branch).toMatch(/awaiting_staff_send:\s*true/);
    expect(branch).toMatch(/report_ops_incident/);
  });

  it('leaves the queue again when a later generation works', () => {
    // Otherwise the row parked above never comes out of it, and staff are asked
    // for ever to act on something already fixed.
    const body = generateDeedBody();
    const stamp = body.slice(body.indexOf('deed_state: "awaiting_tenant"'));
    expect(stamp.slice(0, 400)).toMatch(/awaiting_staff_send:\s*false/);
  });

  it('checks that the application row was actually stamped with the document id', () => {
    /* The worst shape in the chain. The document exists at PandaDoc and the
       tenant has been emailed it, but the row does not carry its id, so
       apply_deed_executed (which matches on pandadoc_document_id and returns
       silently when it finds nothing) will do nothing for ever when they sign. */
    const body = generateDeedBody();
    expect(body).toMatch(/const \{ error: stampErr \} = await service\s*\n?\s*\.?from\("applications"\)|const \{ error: stampErr \} = await service\.from\("applications"\)/);
    expect(body).toMatch(/if \(stampErr\)/);
    expect(body).toMatch(/deed_document_unattached/);
  });

  it('raises an ops incident on every path that ends without a deed', () => {
    /* The whole point. On production the commonest cause of this fault is not
       per-application at all: one unset PANDADOC_API_KEY or PANDADOC_TEMPLATE_ID
       fails EVERY generation identically, and used to do it one silent internal
       row at a time. report_ops_incident is deduped hourly, so the blast radius
       of saying so is one alert an hour. */
    const body = generateDeedBody();
    const incidents = body.match(/report_ops_incident/g)?.length ?? 0;
    // failGeneration covers the shared paths; the no-contact park and the
    // unattached-document orphan each raise their own named type.
    expect(incidents).toBeGreaterThanOrEqual(2);
    expect(read(PANDADOC)).toMatch(/async function failGeneration[\s\S]{0,700}report_ops_incident/);
  });
});

describe('stripe-webhook does not drop the deed on a failed claim', () => {
  it('distinguishes a claim refusal from a claim error', () => {
    /* `.then(r => r.data === true)` read false for both "already claimed"
       (correct, do nothing) and "the RPC failed" (a paid application that gets
       no deed). The second was invisible: the one line that could report the
       commonest silent cause was the line that could not. */
    const src = read(STRIPE_HOOK);
    expect(src).not.toMatch(/rpc\("claim_tenancy_deed"[^)]*\}\)\.then\(/);
    expect(src).toMatch(/const claim = await service\.rpc\("claim_tenancy_deed"/);
    expect(src).toMatch(/if \(claim\.error\)/);
    expect(src).toMatch(/else if \(claim\.data === true\)/);
    expect(src).toMatch(/deed_claim_failed/);
  });

  it('still generates exactly once when the claim succeeds', () => {
    // Removing the wrong behaviour must not remove the right one: the claim is
    // what stops two deliveries of one payment minting two documents.
    const src = read(STRIPE_HOOK);
    expect(src.match(/generateDeed\(service, appId\)/g)?.length ?? 0).toBe(1);
    expect(src).toMatch(/release_tenancy_deed_claim/);
  });
});

describe('pandadoc-webhook notices when a deed does not come back', () => {
  it('only a duplicate skips the dedup insert', () => {
    /* Every insert failure was read as a duplicate: the event was skipped, the
       handler still answered 200, and PandaDoc marked delivery successful and
       never sent it again. A signed deed lost permanently on a blip. This is the
       same defect stripe-webhook already fixed on its own dedup line. */
    const src = read(DEED_HOOK);
    expect(src).not.toMatch(/if \(insErr\) continue;/);
    expect(src).toMatch(/if \(insErr\.code === "23505"\) continue;/);
  });

  it('says so when a callback fails its signature', () => {
    /* The quietest way a deed can die. An unset or rotated
       PANDADOC_WEBHOOK_SHARED_KEY 401s every completion in the estate, every
       deed stays at awaiting_tenant for ever, and the record of that was a
       status code handed back to PandaDoc and thrown away. */
    const src = read(DEED_HOOK);
    const rejection = src.slice(src.indexOf('if (!verified.ok)'), src.indexOf('const eventLivemode'));
    expect(rejection).toMatch(/report_ops_incident/);
    expect(rejection).toMatch(/PANDADOC_WEBHOOK_SHARED_KEY/);
    expect(rejection).toMatch(/status: 401/);
  });

  it('says so when a completion matches no application, and does not fetch its PDF', () => {
    /* apply_deed_executed is a silent no-op for an unknown document, which is
       deliberate (it is what makes a superseded document inert) and is exactly
       why this vanished. On dev, 27 of the 28 completions ever received match no
       application. Either they are superseded documents or this project's shared
       key is verifying another environment's callbacks, and the second means
       that environment's deeds are never executed. The download used to run
       before the check and have its result thrown away, which pulled someone
       else's executed deed into the function for nothing. */
    const src = read(DEED_HOOK);
    const guard = src.indexOf('status === "document.completed" && !app');
    expect(guard, 'the unknown-document guard has gone').toBeGreaterThan(-1);
    const download = src.indexOf('downloadPdf(docId');
    expect(download).toBeGreaterThan(guard);
    expect(src.slice(guard, download)).toMatch(/pandadoc_completed_unknown_document/);
  });

  it('writes down whether the automatic delivery actually worked', () => {
    /* record_delivery_attempt and the four columns behind it were added to
       separate "attempted and errored" from "nobody to send to", and then
       nothing ever called it: zero rows on dev carry delivery_attempted_to, so
       deliveryStateOf could return 'cannot_deliver' and 'delivered' but never
       'failed'. A refused agent email looked exactly like a delivered one. */
    const src = read(DEED_HOOK);
    expect(src).toMatch(/const sent = await deliverDeedToAgent\(/);
    expect(src).toMatch(/record_delivery_attempt[\s\S]{0,300}p_ok: sent\.ok/);
  });

  it('does not stamp a delivery failure when there was nobody to deliver to', () => {
    /* The distinction is the whole of 20261005100000, and the tempting fix is
       the one it refuses: stamping delivery_failed_at on a queued deed puts a
       Resend button in front of an agency for a send never attempted. The
       cannot-deliver branch queues and stays admin-facing. */
    const src = read(DEED_HOOK);
    const elseBranch = src.slice(src.indexOf('const heldForPeople'), src.indexOf('Resend allows 2 req/sec'));
    expect(elseBranch).not.toMatch(/record_delivery_attempt/);
    expect(elseBranch).toMatch(/awaiting_staff_send: true/);
    expect(elseBranch).toMatch(/visibility: "internal"/);
  });

  it('turns a thrown handler into a 500 with an incident, not a bare rejection', () => {
    // Two paths throw on purpose so PandaDoc retries. Without a catch they
    // escaped unrecorded, and nobody learned that a deed spent the afternoon
    // failing to execute.
    const src = read(DEED_HOOK);
    const catchAt = src.indexOf('} catch (e) {');
    expect(catchAt, 'the batch guard has gone').toBeGreaterThan(-1);
    const handler = src.slice(catchAt);
    expect(handler).toMatch(/report_ops_incident/);
    expect(handler).toMatch(/status: 500/);
  });
});

describe('the manual send records its outcome too', () => {
  it('send-deed-to-agent writes down both outcomes', () => {
    // It is the recovery path for everything above, so a recovery that failed
    // has to be visible as a failure rather than only as a return value read by
    // whoever happened to press the button.
    const src = read(MANUAL_SEND);
    expect(src).toMatch(/record_delivery_attempt[\s\S]{0,300}p_ok: out\.ok/);
    // record_delivery_attempt clears the queue itself on success, so the old
    // hand-rolled update must be gone rather than racing it.
    expect(src).not.toMatch(/awaiting_staff_send: false/);
  });

  it('and still parks an unresolvable contact without calling it a failure', () => {
    const src = read(MANUAL_SEND);
    const noContact = src.slice(src.indexOf('if (!sentTo)'), src.indexOf('Greet by the resolved'));
    expect(noContact).toMatch(/awaiting_staff_send: true/);
    expect(noContact).not.toMatch(/record_delivery_attempt/);
    expect(noContact).toMatch(/visibility: "internal"/);
  });
});
