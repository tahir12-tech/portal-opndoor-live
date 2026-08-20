# Regression test plan

A walk-through of the whole platform, including areas this work never touched.

Every expected value here was read out of the code, not remembered. Each row
carries a citation. Where the citation and your intuition disagree, the citation
is what the software does today.

## How to use this

**The suite is written to pass on day one.** Several rows assert behaviour that
is wrong. Those are tagged with the defect they belong to, and the expected value
is what the code currently does, not what it should do. That is deliberate: a
suite that fails on arrival gets ignored within a week.

So a change to a tagged row reads as **a deliberate fix**, and a change to an
untagged row reads as **a regression**. That distinction is the whole point of
the tagging.

| Tag | Meaning |
| --- | ------- |
| `[D1]` … `[D10]` | Expected value is a known defect. See `DEFECTS.md` |
| `[AUTO]` | Automatable today |
| `[SEMI]` | Automatable except for one external step |
| `[HUMAN]` | Needs a person |

### Reporting a test run

**Never report a test total on its own.** Report what changed in the suite:
added, removed, renamed. A total is a summary of a summary and it hides the
thing you need to see.

**Call out anything generated in a loop.** Several files build tests with

```js
for (const tab of ['agent', 'supplier']) { it(`${tab} ...`, ...) }
```

so dropping one value from that array removes a test per loop with no `it()`
line in the diff to show for it. Removing the Tenant tab took nine named tests
and five more this way, and the totals either side, 232 and 221, looked like
ordinary churn.

**A flat total across real change is a red flag, not a pass.** If the code moved
and the number did not, find out why before believing it.

### Before you start

1. A **disposable** project. Several steps write real rows and send real email.
2. `deno check` over `supabase/functions/**` first. There is no CI, so this is
   the only type check that happens.
3. Know which of `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `PANDADOC_API_KEY` and
   `PANDADOC_WEBHOOK_SHARED_KEY` are set. Most "nothing happened" results trace
   back to one of them being absent, and the code fails soft rather than loudly.
4. **`RESEND_API_KEY` unset means no email is sent by any module**
   ([_shared/deedEmail.ts:40](supabase/functions/_shared/deedEmail.ts#L40)). Every
   email row below assumes it is set. If it is not, assert the absence instead.

### The three state columns

Both exist. Neither is what `status` is, and nothing keeps the three consistent.

| Column | Values | Default |
| ------ | ------ | ------- |
| `status` | `sent`, `paid`, `deed`, `withdrawn`, `expired` ([20260705115059:11](supabase/migrations/20260705115059_application_expiry_and_reinstate.sql#L11)) | `'sent'` |
| `payment_state` | `awaiting`, `paid`, `refunded`, or NULL ([20260702173941:9](supabase/migrations/20260702173941_stripe_payment_schema.sql#L9)) | none |
| `deed_state` | `awaiting_tenant`, `executed`, `declined`, `voided`, `error`, or NULL ([20260703075024:3](supabase/migrations/20260703075024_pandadoc_deed_schema.sql#L3)) | none |

**There is no `refunded` status.** A refund lives in `payment_state` only, and
`status` stays `paid` or `deed`. Any test asserting a refunded application is
"closed" by status will be wrong.

`applications_status_dates` ([20260705115059:13](supabase/migrations/20260705115059_application_expiry_and_reinstate.sql#L13))
constrains only `paid_at` and `deed_issued_at`. So `status='paid'` with
`payment_state=NULL`, or `status='deed'` with `deed_state=NULL`, are both legal.
Assert the columns you care about individually rather than assuming they agree.

`activity_log.visibility` defaults to `business`
([20260703095652:2](supabase/migrations/20260703095652_activity_log_visibility.sql#L2)),
so **any insert that omits the field is partner-visible**. Rows below say
`business (default)` where the writer omits it, because that is the most common
wrong assumption in this codebase.

---

# Section A: the referral lifecycle

## A0. Section A and mode: read this first

**Section A is the portal walkthrough, and the portal cannot create a sandbox
application.** `create_referral` writes `livemode` true unconditionally, and the
restrictive policy means no portal screen shows a sandbox row to anybody. So
**A1 is live-only by construction**: there is no sandbox variant of it to run.

**A2 onward is different.** A sandbox application created through the API
(section B4) then travels the same machinery: the same Stripe webhook, the same
deed generation, the same cron. Those steps ARE reachable in sandbox, and a
tester watches them from the Dev Centre's Sandbox tab rather than from
Applications.

Each step below carries a **Sandbox** block saying what differs. Where a step is
unreachable in sandbox it says so and why, which is as useful as knowing what
changes.

**The general rule, if you remember one thing:** sandbox exercises Stripe and
PandaDoc against their sandbox credentials, and opndoor sends no email of its
own. Every difference below is an instance of that.

---

## A1. Create

| # | Action, actor | status | payment_state | deed_state | activity_log | Email, actual recipient | HubSpot | Tags |
| - | ------------- | ------ | ------------- | ---------- | ------------ | ----------------------- | ------- | ---- |
| A1.1 | Submit New Application. Referrer, management or superadmin, AAL2 | `sent` | **NULL** | NULL | none from the RPC | none | none | `[SEMI]` |
| A1.2 | Same request, after Stripe session creation | `sent` | `awaiting` | NULL | none | none | none | `[SEMI]` |
| A1.3 | Same request, audit row | `sent` | `awaiting` | NULL | `referral_created` / **business (default)** / "Referral created and sent to the tenant." | none | this row drives the `referral` event | `[AUTO]` |
| A1.4 | Same request, tenant payment email | `sent` | `awaiting` | NULL | `payment_email_sent` / business / "Payment email sent to the tenant." **plus a second row** `payment_email_sent` / internal / "Redirected to `<tenant email>` (test mode)." | `create-referral/email.ts`, `paymentEmailTemplate`. **The real tenant** | none | `[SEMI]` `[D7]` |

**A1.4 is the one to read twice.** The second activity row states that the email
was redirected for testing and names the address. The redirect no longer exists,
so the address named is the real tenant who really received it. The audit trail
asserts a safety property that is not in force. See defect 7.

> ### Sandbox
> **Not reachable.** `create_referral` sets `livemode` true unconditionally, so
> the portal cannot produce a sandbox application. The equivalent is **B4**,
> `POST /v1/applications` with an `opnd_test_` key, which goes through
> `create_referral_api` instead. A sandbox row takes `GR-TEST-n` from its own
> sequence, so the `^GR-\d+$` assertion below is the live case only.

Assert: `guarantee_ref` matches `^GR-\d+$`, `referrer_name` equals the creating
user's `full_name` at that instant, `expiry_date` equals tenancy start plus 12
months minus a day, and exactly one `payment_page_tokens` row exists with
`expires_at` 90 days out.

**Rejection cases** `[AUTO]`, all via `create_referral`, all SQLSTATE 22023:

| Payload | Message |
| ------- | ------- |
| Several bad fields | `Missing or invalid: title, phone, ...` accumulated in field order |
| Under 18 at tenancy start | `Tenant must be 18 by the tenancy start date.` |
| Over 100 at tenancy start | `Check the date of birth: the tenant would be over 100 at the tenancy start.` |
| Start more than 7 days back | `Tenancy start date cannot be more than 7 days in the past.` |
| Start more than 2 years ahead | `Tenancy start date cannot be more than 2 years ahead.` |

## A2. Tenant pays

> ### Sandbox
> **Reachable, and this is the main thing to rehearse.** The tenant pays with a
> Stripe **test card** against `STRIPE_SECRET_KEY_TEST`; no money moves and no
> settlement is created. The inbound webhook is verified by
> `STRIPE_WEBHOOK_SECRET_TEST`, and **which secret verifies is what tells us the
> mode** — nothing is read from the event body. `apply_stripe_payment` then runs
> identically, so every state transition below is the same.
>
> **Different:** no payment receipt email is sent. `deliverPaymentReceipt` is
> skipped, so the `payment_receipt_sent` activity row does not appear.
>
> **If the receipt DOES arrive, stop.** A real address is being emailed about a
> rehearsal.
>
> **If you get a 500 and an ops alert** reading `stripe_livemode_mismatch`, a
> live event reached a sandbox application or the reverse. That is refused rather
> than reconciled, deliberately.

| # | Action, actor | status | payment_state | deed_state | activity_log | Email | HubSpot | Tags |
| - | ------------- | ------ | ------------- | ---------- | ------------ | ----- | ------- | ---- |
| A2.1 | Open `/pay?token=`. No login; the token is the only authorisation | `sent` | unchanged | unchanged | first view only: `tenant_viewed_payment_page` / business / "Tenant viewed the payment page." | none | none | `[AUTO]` |
| A2.2 | Press Pay | unchanged | re-written to `awaiting` | unchanged | **none.** No row records that a tenant started paying | none | none | `[SEMI]` `[D-new]` |
| A2.3 | Stripe `checkout.session.completed` | **`paid`** | **`paid`** | unchanged | none from the RPC | none | none | `[SEMI]` |
| A2.4 | Webhook side effects, gated on no prior `payment_received` | `paid` | `paid` | see A3 | `payment_received` / **business (default)** / "Guarantor fee paid (£N) via Stripe." | none | `fee_paid`, stage `stage_fee_paid` | `[SEMI]` |
| A2.5 | Tenant receipt | `paid` | `paid` | see A3 | `payment_receipt_sent` / business, or `payment_receipt_failed` / internal | `_shared/paymentReceiptEmail.ts`. **The real tenant** | none | `[SEMI]` |
| A2.6 | Partner webhook | n/a | n/a | n/a | none | none | none | one `partner_webhook_deliveries` row, `application.paid` | `[AUTO]` |
| A2.7 | `payment_intent.payment_failed` or `checkout.session.expired` | **unchanged** `sent` | **unchanged** `awaiting` | unchanged | **none** | none | none | `[AUTO]` |
| A2.8 | Same Stripe event id twice | unchanged | unchanged | unchanged | none | none | none | `[AUTO]` |

Assert on A2.8: HTTP 200 with `{received:true, duplicate:true}`, and no second
`payment_received` row.

**A2.2 has no audit trail at all.** If a tenant says they paid and no money
arrived, nothing in the portal records that they reached Stripe. Worth raising
separately; not currently in `DEFECTS.md`.

## A3. Deed generates

> ### Sandbox
> **Reachable.** `generateDeed` reads `livemode` off the application row it
> already fetches, so its four callers are unchanged and none can pass the wrong
> one. It resolves `PANDADOC_API_KEY_TEST` and `PANDADOC_TEMPLATE_ID_TEST`, and
> the template is per mode too: a sandbox key cannot see a production template, so
> sharing one id fails at document creation with a 404 that reads like a broken
> integration rather than a missing secret.
>
> **THE ONE THING SANDBOX REALLY SENDS.** PandaDoc emails its signing link to
> whatever address was supplied as `tenant_email`, watermarked as a developer
> document. That is deliberate: rehearsing the tenant's signing journey is most of
> the point. **Use an address you own.** The Dev Centre surfaces the same link with
> this warning, and names the address, so a developer running several test
> payloads can see exactly who received it.
>
> **Different:** nothing else. There is no opndoor email at this step in either
> mode.

| # | Action, actor | status | deed_state | activity_log | Email, actual recipient | Tags |
| - | ------------- | ------ | ---------- | ------------ | ----------------------- | ---- |
| A3.1 | Automatic on payment, contact resolves | unchanged `paid` | → `awaiting_tenant` | `deed_sent` / **business (default)** / "Deed of Guarantee sent to the tenant for signature." | PandaDoc sends it. **The real tenant** | `[SEMI]` |
| A3.2 | No agent contact resolves for the branch | unchanged | → **`error`** | `deed_error` / **internal** / "Deed not generated: add an agent contact for this branch, then retry." | none. Ops alert fires | `[AUTO]` `[D6]` |
| A3.3 | PandaDoc rejects | unchanged | → `error` | `deed_error` / internal / "Deed generation failed: `<provider error>`" | none | `[SEMI]` |
| A3.4 | Manual "Resend signature request". Owning referrer, management or superadmin | `paid` | unchanged | `deed_reminded` / business (default) | PandaDoc reminder, or our own fallback to the tenant | `[HUMAN]` |
| A3.5 | Void and regenerate. **Management or superadmin only** | `paid` | → NULL → `awaiting_tenant` | `deed_voided`, then `deed_sent`, then `deed_regenerated`, all business | PandaDoc signing email | `[HUMAN]` |
| A3.6 | Amend tenancy start while awaiting signature | `paid` | `awaiting_tenant` → NULL → `awaiting_tenant` | `deed_voided` / **internal**, `deed_regenerated` / **internal**, `tenancy_amended` / **business** | PandaDoc reissue copy. **No `deed_sent` row** | `[HUMAN]` |

**A3.2 is the money-taken-no-deed case and the most important row in this
document.** The tenant has paid. Assert `deed_state='error'`, assert the activity
row is `internal` so the referrer sees a stalled application with no reason, and
assert the ops alert fires. Then assert the partner API would have refused this
application at POST: `GET /orgs` reports `has_agent_contact: false` for that
branch, and `POST /applications` returns `422 no_agent_contact`. That contrast is
the regression to protect.

`deed_state='error'` is **sticky**: the auto path is gated on `if (!appRow.deed_state)`
([stripe-webhook/index.ts:84](supabase/functions/stripe-webhook/index.ts#L84)), so a
second payment will not retry it. Recovery is manual only.

## A4. Deed signed

> ### Sandbox
> **Reachable.** The callback is verified against `PANDADOC_WEBHOOK_SHARED_KEY_TEST`,
> and again **the secret that verifies is what identifies the mode**. Both keys are
> tried; nothing is read from the body, because a webhook is unauthenticated until
> the signature checks out, so every field in it is a claim rather than a fact.
> `apply_deed_executed` then runs identically and A4.1 to A4.4 all behave the same.
>
> **Different:** neither Opndoor email at A5 is sent. See A5.
>
> **A mismatch is refused**, not reconciled: a sandbox callback naming a live
> application returns 500 with a `pandadoc_livemode_mismatch` ops alert, and the
> dedup row is deleted so a corrected redelivery is not swallowed.

| # | Action | status | deed_state | activity_log | Tags |
| - | ------ | ------ | ---------- | ------------ | ---- |
| A4.1 | Bad or absent HMAC signature | unchanged | unchanged | **none, not even a dedup row** | `[AUTO]` |
| A4.2 | `document.viewed` | `paid` | unchanged | `deed_viewed` / business / "Deed viewed by the tenant." Only while `deed_viewed_at` is NULL | `[SEMI]` |
| A4.3 | `document.completed` while `paid` | **`paid` → `deed`** | → **`executed`** | `deed_signed` / business, then the delivery rows | `[SEMI]` |
| A4.4 | `document.completed` while **not** `paid` | **unchanged** | → **`executed` anyway** | `deed_signed` and the delivery rows still fire | `[AUTO]` |
| A4.5 | `document.completed` for a superseded envelope | unchanged | unchanged | **none** | `[AUTO]` |
| A4.6 | `document.declined` | **unchanged** `paid` | → `declined` | `deed_declined` / business (default) | `[SEMI]` |
| A4.7 | `document.voided` | unchanged `paid` | → `voided` | `deed_voided` / business (default) | `[SEMI]` |

On A4.3 assert `deed_issued_at` and `deed_executed_at` are both set,
`executed_pdf_path` is `<appId>/<ref>.pdf`, and **`issue_date` is unchanged** from
generation time ([20260703101635:14-21](supabase/migrations/20260703101635_deed_executed_leave_issue_date.sql#L14)).

**A4.4 is defence-in-depth written loosely, not a live hole.** The `else` branch
of `apply_deed_executed` genuinely does write `deed_state='executed'` without
transitioning status, and the webhook's `if (app)` guard tests only that a row
matched the document id, never the status. But it is **unreachable**: no
withdrawn or expired application can hold a PandaDoc document. An earlier draft
of this plan claimed it could, and that was wrong.

Test it anyway, because it is cheap and it is the guard that would matter if
post-payment withdrawal were ever permitted. Assert the current behaviour so a
future change that makes it reachable shows up here.

**The reachable version of this is defect 9**, and it does not use this branch at
all. A refund whose PandaDoc void fails leaves a live signing link on an
application that is still `paid`, so the tenant signs and the deed issues through
the ordinary path. Test that separately: `A6.3` with the void forced to fail.

## A5. Deed delivered to the agent

> ### Sandbox
> **Does not happen at all.** Neither `deliverDeedToAgent` nor
> `deliverExecutedDeedToTenant` runs, so no `deed_delivered` or
> `tenant_deed_email_sent` row appears and no email leaves.
>
> This is the sharpest edge in the whole design and is why it is suppressed: the
> agent contact on a sandbox application is a **real letting agent's address** if
> the branch is a real branch, which it now always is, since organisations are
> resolved rather than created and sandbox applications reference the partner's
> real orgs. An executed Deed of Guarantee arriving at a real agent for a tenancy
> that does not exist is the worst outcome available here.
>
> **Assert the absence**, and assert it deliberately: an absence also happens when
> something is broken, so check the deed itself reached `executed` at A4 first.

| # | Action | activity_log | Email, actual recipient | HubSpot | Tags |
| - | ------ | ------------ | ----------------------- | ------- | ---- |
| A5.1 | Automatic on signature, contact resolves | `deed_delivered` / business / "Deed sent to `<email>` · automatic" | `_shared/deedEmail.ts`. **`effective_primary_contact(branch)`, recomputed at signing time** | `delivered` | `[SEMI]` |
| A5.2 | Automatic, no contact resolves | `deed_delivery_failed` / **business** / "Deed issued; no agent contact on file — delivery failed." | none. Ops alert fires | not mapped | `[AUTO]` `[D6]` |
| A5.3 | Tenant's own copy, 600ms later | `tenant_deed_email_sent` / business | `_shared/executedDeedEmail.ts`. **The real tenant** | none | `[SEMI]` |
| A5.4 | Manual "Send deed to agent" | `deed_delivered` / business / "… · sent by `<name>`", **actor is `System`, not the user** | same template | second `delivered`, `delivered_at` overwritten | `[HUMAN]` |
| A5.5 | Manual send to a one-off address, "save this contact" ticked | `deed_delivered` / business | the typed address | **`delivered_to` is recomputed as the branch primary, so HubSpot records the wrong address** | `[HUMAN]` `[D-new]` |
| A5.6 | Download the deed in the portal | **none. Downloads are not logged** | none | none | `[AUTO]` |

The A5.2 message is quoted **verbatim**, em dash included, from
[send-deed-to-agent/index.ts:56](supabase/functions/send-deed-to-agent/index.ts#L56)
and [pandadoc-webhook/index.ts:96](supabase/functions/pandadoc-webhook/index.ts#L96).
Do not tidy the punctuation here: it is an expected value, and the assertion has
to match the string the code actually writes. Worth knowing separately that
`deed_delivery_failed` has no partner-facing label mapping, so partners are shown
this raw internal wording.

**A5.5: ticking "save this contact to the branch" persists nothing.** The RPC
never inserts an `agent_contacts` row
([20260702171551:61](supabase/migrations/20260702171551_tighten_related_writes.sql#L61));
the client writes only to localStorage. Assert no new `agent_contacts` row.

**A5.1 recomputes the recipient at signing time**, not from the `agent_email`
merged onto the deed at generation. If the primary contact changed in between,
the printed deed and the delivery disagree. Assert both values.

## A6. Refund

> ### Sandbox
> **Reachable.** Refund the test charge in Stripe test mode. `apply_stripe_refund`
> runs identically, and `voidDocument` uses the sandbox PandaDoc account, so the
> watermarked document is voided there.
>
> **Different:** no refund email. The `refund_email_sent` row does not appear.
>
> **Defect 9 applies in both modes** and is worth exercising here rather than
> live: if the void fails, `deed_state` stays `awaiting_tenant`, the document id
> stays set, and the signing link the tenant already has stays live on a refunded
> application. Sandbox is the safe place to reproduce that.

**There is no in-portal refund action.** No code anywhere calls Stripe to create
one. An operator refunds in the Stripe dashboard. `[HUMAN]` to trigger, `[AUTO]`
to assert.

| # | Case | status | payment_state | activity_log | Email | HubSpot | Tags |
| - | ---- | ------ | ------------- | ------------ | ----- | ------- | ---- |
| A6.1 | Full refund before tenancy start | **unchanged** `paid` or `deed` | → `refunded` | `refunded` / **business (default)** / "Payment refunded in Stripe.", then `refund_email_sent` / business | `_shared/refundEmail.ts`. **The real tenant only.** No copy to agent, referrer or ops | `payment_status='Refunded'` only; **stage untouched** | `[SEMI]` |
| A6.2 | Refund on or after tenancy start | unchanged | `refunded` | A6.1's rows **plus** `refund_anomaly` / **business (default)** / "POLICY ANOMALY: refunded on or after the tenancy start date…" | tenant email plus an ops alert | `refund_anomaly` not mapped | `[SEMI]` `[D-new]` |
| A6.3 | Refund while the deed is out, void **succeeds** | unchanged `paid` | `refunded` | `deed_voided` / business / "Outstanding deed signing link expired because the payment was refunded." | tenant refund email only | none for the void | `[SEMI]` |
| A6.3b | Refund while the deed is out, void **fails** | unchanged `paid` | `refunded` | **no `deed_voided` row.** `deed_state` stays `awaiting_tenant`, `pandadoc_document_id` stays set, **the signing link stays live** | tenant refund email only | none | `[SEMI]` `[D9]` |
| A6.4 | **Partial** refund | unchanged | → `refunded` | identical rows to A6.1, **no amount in the message** | tenant email showing the partial amount | `payment_status='Refunded'` | `[AUTO]` `[D-new]` |
| A6.5 | Second distinct `charge.refunded` | unchanged | `refunded` | **a second `refunded` row and a second `refund_email_sent` row** | **a second tenant refund email** | idempotent in effect | `[AUTO]` `[D-new]` |
| A6.6 | Refund matching no application | no row touched | no row touched | **none. Invisible in the portal** | none, no ops alert | none | `[AUTO]` `[D-new]` |

Assert on A6.1: **exactly one** `refund_email_sent` row. `refundEmail.ts` contains
a second insert saying "Redirected to … (test mode)" guarded by
`res.to !== p.tenantEmail`, which can never be true, so it is unreachable dead
code ([_shared/refundEmail.ts:87](supabase/functions/_shared/refundEmail.ts#L87)).
It is the same mistake as A1.4 but harmless here. If it ever fires, the guard has
been changed.

A6.4: a £1 refund on a £2,200 fee marks the application fully Refunded
everywhere. Only `refunded_amount` versus `paid_amount` shows partiality.

## A7. Withdraw

> ### Sandbox
> **Staff withdrawal (A7.1, A7.2) is not reachable.** A sandbox application does
> not appear on any portal screen, so there is no button to press, and
> `applications_sandbox_write_guard` refuses the write anyway for any session
> carrying a portal identity other than a developer's. There is no withdraw
> endpoint on the partner API, so a partner cannot do it either.
>
> **Tenant self-decline (A7.3) IS reachable**, and is worth rehearsing: it runs on
> the tokenised payment page with no login and no role, through `service_role`,
> which the guard deliberately allows. It is also the route into A9.
>
> **Different:** nothing. No email is sent in either mode at this step, which is
> itself the point of A7.1's "the tenant is not told" note.
| - | ------------- | ------ | ------------- | ------------ | ----- | ------- | ---- |
| A7.1 | **Staff** withdrawal. Superadmin, management in-partner, or the owning referrer | `sent` → `withdrawn` | **unchanged** `awaiting` | one row: `withdrawn` / business / "Application withdrawn (`<label>`)…" | **none. The tenant is not told and their payment token stays live** | `stage_withdrawn` | `[AUTO]` |
| A7.2 | Staff withdrawal on `paid`, `deed`, `expired` or already withdrawn | unchanged | unchanged | **none** | none | none | `[AUTO]` |
| A7.3 | **Tenant** self-decline from `/pay`. Token only: no login, no role, no rate limit | `sent` → `withdrawn` | unchanged | one row: `withdrawn` / business / "Application withdrawn by the tenant (`<label>`). No payment was taken." actor `Tenant` | **none, to either side** | identical event to a staff withdrawal; **HubSpot cannot tell them apart** | `[AUTO]` |

Assert on A7.1: `withdrawn_by_tenant` stays **false**. On A7.3 it is **true**.
That single boolean is what decides whether a later payment reinstates (A9).

Assert on A7.3: a reason of `duplicate` is silently coerced to `other`, even
though the column permits `duplicate`.

**An expired application cannot be staff-withdrawn, but a tenant can still
decline it.** The tenant has a closure route the staff do not.

## A8. Expire

> ### Sandbox
> **Reachable, and deliberately so.** `expire_stale_applications` is one of the
> twelve definer functions exempted from the livemode audit **on purpose**: it
> expires sandbox applications too, so a developer can rehearse the lapse path and
> the `application.lapsed` webhook it emits. The exemption is recorded in
> `livemode_audit_exemptions` with that reason.
>
> **Different:** A8.3 and A8.4 do not happen. `fire_payment_reminders` carries a
> livemode predicate, so a sandbox application never appears in a reminder run, no
> `payment_reminder` row is written and no email is attempted. The expiry itself
> still fires.
>
> That split is the point: expiry is a **state transition** a partner needs to see;
> a reminder is an **email to a tenant**, which sandbox never sends.

| # | Action | status | payment_state | activity_log | HubSpot | Tags |
| - | ------ | ------ | ------------- | ------------ | ------- | ---- |
| A8.1 | `expire_stale_applications`, service role, invoked only from `payment-reminders` | `sent` → `expired` | **unchanged** `awaiting` | `expired` / business / "Application expired: guarantor fee unpaid 15 days after referral." | **nothing. `expired` is not mapped, so the CRM still shows Referred** | `[AUTO]` `[D-new]` |
| A8.2 | Sweep re-run | no further change | unchanged | **no second row.** `expired_at` not rewritten | none | `[AUTO]` |
| A8.3 | Payment reminders, same run | never changed | unchanged | `payment_reminder` / business, written **before** the send is attempted | none | `[AUTO]` |
| A8.4 | Reminder email fails | unchanged | unchanged | **two rows**: `payment_reminder` / business **and** `payment_reminder_email_failed` / internal. The ledger row is kept, so the threshold is burnt | none | `[AUTO]` |

**Assert day 15, not day 14.** The predicate is
`sent_at < (p_today::timestamptz - interval '14 days')`
([20260705115059:31](supabase/migrations/20260705115059_application_expiry_and_reinstate.sql#L31)),
which compares against midnight. An application sent at any time on day D is
still `sent` on day D+14 and expires on D+15. The activity message, the migration
header and the UI banner all say 14 days. The code says 15.

**Nothing schedules this sweep.** Only two `cron.schedule` calls exist in the
whole tree, and neither is this one. On a freshly migrated project the auto
expiry never runs. Test it by calling `payment-reminders` with `{test:true}` as a
superadmin.

## A9. Reinstate after late payment

The single most valuable section, because it is where the lifecycle stops being
monotonic and where most assumptions break.

> ### Sandbox
> **Reachable, and this is the one a partner most needs to rehearse**, because it
> is the case their integration is most likely to get wrong. A9.1 and A9.2 emit
> `application.reinstated` **instead of** `application.paid`, so a handler that
> counted `application.paid` as a first payment must not count this again, and a
> handler that stopped listening after `application.lapsed` needs this to correct
> its record.
>
> Getting here in sandbox: create with a test key, let it lapse (A8) or decline it
> as the tenant (A7.3), then pay with a test card.
>
> **Different:** the receipt email at A9.1/A9.2 is not sent. The
> `payment_reinstated` and `payment_received` rows still appear, and the deed still
> generates against the sandbox PandaDoc account.
>
> **A9.3 emits nothing in either mode**, which is the point of defect 8: real
> money sits on a withdrawn application and the partner is never told.

| # | Prior state | status | payment_state | activity_log | Tags |
| - | ----------- | ------ | ------------- | ------------ | ---- |
| A9.1 | `expired` | → **`paid`** | → `paid` | `payment_reinstated` / business / "Guarantor fee paid after expired; application reinstated to Paid.", then `payment_received`, then the deed and receipt rows | `[SEMI]` `[D10]` |
| A9.2 | `withdrawn` **and** `withdrawn_by_tenant = true` | → **`paid`** | → `paid` | as A9.1, message says "after withdrawn" | `[SEMI]` `[D10]` |
| A9.3 | `withdrawn` **and** `withdrawn_by_tenant = false` (staff) | **stays `withdrawn`** | **stays `awaiting`** | one row only: `payment_anomaly` / business / "Guarantor fee paid on a WITHDRAWN application. Review and refund required." | `[SEMI]` `[D8]` |

**A9.1 and A9.2: assert the stale columns are STILL SET.** `expired_at`,
`withdrawn_at`, `withdrawn_reason` and `withdrawn_by_tenant` are never cleared. A
reinstated, fully paid application still looks withdrawn or expired to any filter
of the form `withdrawn_at is not null`. This is the highest-value assertion in
the plan, because it is invisible in the UI and will silently corrupt any report
written later.

**A9.3: real money is taken while `payment_state` reads `awaiting` and
`paid_amount` is NULL.** The tenant gets **no email of any kind**. One ops alert
fires. There is no amount on the row for a refund to work from. Recovery is
entirely manual.

**A9.2 is unreachable from the tenant's own link.** The client maps any
`withdrawn` status to "This referral is closed" with no pay button
([src/pages/Pay/paymentPageApi.ts:38](src/pages/Pay/paymentPageApi.ts#L38)), so the
server's `canReinstate` branch cannot be exercised the normal way. Reaching it
needs the original Stripe URL still in `payment_url`. Worth testing precisely
because it is hard to reach by accident.

---

# Section B: the partner API

Everything here is `[AUTO]`: HTTP in, JSON out, assertable with `curl` and a
database query. This section should be automated first.

Base path: `/functions/v1/partner-api/v1/`. **This is the function path, used
here deliberately so these tests exercise the API independently of the
api.opndoor.co rewrite.** Partners are given `https://api.opndoor.co/v1`; see
HANDOVER.md section 12, which has its own checks for the rewrite itself.

## B, and the mode dimension

Everything in section B runs **twice**: once with an `opnd_live_` key and once
with an `opnd_test_` key. Most rows behave identically, which is the point of
sandbox and is itself the thing being tested. The table below is the complete
list of where they differ, so a tester seeing a difference can tell a feature
from a fault.

**Run live first.** A sandbox run that passes proves less than it looks: several
of the differences below are absences, and an absence also happens when something
is broken.

| Where | Live | Sandbox | If sandbox behaves like live |
| ----- | ---- | ------- | ---------------------------- |
| `guarantee_ref` | `GR-20604` | `GR-TEST-4`, from a separate sequence | The sandbox sequence is not being used. Real and test references become indistinguishable in support |
| Visible in Applications, League, exports, bordereau | Yes | **Never**, for any role including superadmin | The restrictive policy is not applying. This is the leak the whole design exists to prevent |
| Visible in the Dev Centre Sandbox tab | No | Yes | |
| Stripe | Live keys, real card, real settlement | `STRIPE_SECRET_KEY_TEST`, test card, no money moves | **Stop.** A real card is being charged for a rehearsal |
| Stripe webhook | Verified by the live signing secret | Verified by `STRIPE_WEBHOOK_SECRET_TEST` | |
| PandaDoc | Live account, real deed | Sandbox account and template, watermarked document | |
| PandaDoc signing email to the tenant | Sent | **Sent.** The one thing sandbox does send | If it is NOT sent, the sandbox PandaDoc key is missing or `silent` is set |
| opndoor email: payment link, receipt, reminders, deed to agent, refund | Sent | **None at all** | A real agent or tenant is being emailed about a test |
| HubSpot | Synced | **Never.** Filtered in SQL and refused again in the sync | A test contact and deal are in the production CRM |
| Commission, settlement, weekly digest, climbers | Included | **Excluded** | A rehearsal is in a partner's commission figure |
| Reconciliation queue | Counts the application | Not counted | |
| Webhook delivery | To endpoints registered live | To endpoints registered sandbox | A partner's production handler is receiving test events |
| `livemode` in the webhook payload | `true` | `false` | |
| Idempotency key | Its own namespace | Its own namespace | The same key across modes replays the wrong response |
| `GET /v1/orgs` | The partner's orgs | **The same orgs.** Orgs are not per mode | An empty list means the mode filter was reintroduced |
| Rate limits | 600/min per key | Identical | |

**Two rows are the ones to check first**, because they are the failures that look
like success: opndoor email being sent for sandbox, and a sandbox application
appearing anywhere in the portal. Both are silent from the API's point of view.

**Cleaning up.** The Dev Centre's Sandbox tab clears sandbox applications. It
cannot touch live data: the function filters on `not livemode` rather than taking
a list of ids. Note it does not withdraw PandaDoc documents already created, so
those remain in the sandbox account.

---

## B0. Versioning

The base path is `/functions/v1/partner-api/v1/`. Every case below uses it.

| # | Case | Expected |
| - | ---- | -------- |
| B0.1 | Any endpoint under `/v1/` | routes normally |
| B0.2 | Same endpoint with **no** version segment | `404 unsupported_version` |
| B0.3 | `/v2/orgs` | `404 unsupported_version`, naming the supported versions |
| B0.4 | Unknown endpoint under `/v1/` | `404 not_found`, a **different** code from B0.2 |
| B0.5 | Same idempotency key across versions, same body | replays; the ledger is not version-qualified |

B0.2 must not quietly succeed. If a future change defaults a missing version to
`v1`, the segment stops protecting anyone, because unversioned clients are
exactly the ones a v2 breaks.

## B1. Key authentication

| # | Case | Expected |
| - | ---- | -------- |
| B1.1 | Valid key, correct scope | `200` |
| B1.2 | No `Authorization` header | `401`, body exactly `{"error":{"code":"unauthorized","message":"Invalid credentials."}}` |
| B1.3 | Well-formed key, wrong secret | `401`, **byte-identical** to B1.2 |
| B1.4 | Unknown prefix | `401`, byte-identical |
| B1.5 | Garbage, not key-shaped | `401`, byte-identical |
| B1.6 | Revoked key, correct scope | `401`, byte-identical |
| B1.7 | Expired key | `401`, byte-identical |

**B1.2 to B1.7 must be byte-identical**, including headers. Diff the raw
responses rather than eyeballing them: the whole design intent is that nothing
can be probed. A test that only checks the status code would miss a regression
here entirely.

Assert also that `last_used_at` advances on B1.1 and **does not** on B1.6.

## B2. Scoping and isolation

| # | Case | Expected |
| - | ---- | -------- |
| B2.1 | Key without the required scope | `403 insufficient_scope` |
| B2.2 | Partner in a non-`active` status | `403 partner_inactive` |
| B2.3 | Partner A's key lists orgs | only Partner A's orgs |
| B2.4 | Partner A references Partner B's `branch_id` | `422`, `org.branch_id: not_found` |
| B2.5 | Partner A uses Partner B's referrer email | `422`, `referrer.email: not_available` |

**B2.4 and B2.5 must not disclose that the other partner's record exists.** Same
message as a genuinely unknown id. **RLS does not protect this path**: every
table's AAL2 policy is unsatisfiable by an API key, so the function runs as
service role and isolation is entirely application-side. A forgotten
`partner_id` filter is a cross-tenant leak no database policy will catch. Treat
every new endpoint as needing B2.3 repeated against it.

## B3. `GET /orgs`

| # | Case | Expected |
| - | ---- | -------- |
| B3.1 | Branch with its own primary contact | `has_agent_contact: true` |
| B3.2 | Branch with **no** contacts, agency has a primary | `true`, inherited |
| B3.3 | Branch with a contact but **none primary** | **`false`** |
| B3.4 | Neither branch nor agency has any contact | `false` |
| B3.5 | Response body | no `partner_id`, no `review_state`, no `created_by` |

## B3a. Reading applications

| # | Case | Expected |
| - | ---- | -------- |
| B3a.1 | `GET /applications` | newest first, `next_cursor` null on the last page |
| B3a.2 | Response body | **none of** `partner_rate`, `agent_rate`, `paid_amount`, `refunded_amount`, `stripe_*`, `pandadoc_*`, `executed_pdf_path`, `payment_state`, `deed_state`, `partner_id`, `referrer_id`, `referrer_name`, `withdrawn_*`, `expired_at` |
| B3a.3 | `payment_url` in the **list** | **absent** |
| B3a.4 | `payment_url` in the **single fetch** | present while payable, null once paid or closed |
| B3a.5 | Status of a lapsed application | **`lapsed`**, not `expired` |
| B3a.6 | Status of an issued deed | **`deed_issued`**, not `deed` |
| B3a.7 | `?status=lapsed` | filters correctly |
| B3a.8 | `?status=expired` | `422`, listing the valid values |
| B3a.9 | `?limit=9999` | clamped to 100 |
| B3a.10 | Invalid cursor, and valid base64 of the wrong shape | both `400 malformed_request` |
| B3a.11 | Another partner's application by id | `404`, same as unknown |
| B3a.12 | Malformed id | `404`, not a 500 |
| B3a.13 | Key without `applications:read` | `403 insufficient_scope` |

**B3a.2 is the assertion that matters.** Assert against the raw response body
rather than parsed fields, so a nested leak is caught too. The field list is
enforced twice, in the SQL read model and in the serializer, and this test is
what keeps both honest.

**B3.3 is the subtle one.** `effective_contacts` falls back to the agency only
when the branch has **no contacts at all**, so a branch holding a non-primary
contact resolves to nothing and cannot produce a deed. Reaching that state needs
an UPDATE clearing the only primary; inserts and deletes are trigger-protected.
See defect 6. `[D6]`

## B4. `POST /applications`

| # | Case | Expected |
| - | ---- | -------- |
| B4.1 | Valid payload, org by id | `201`, `status: sent`, a `payment_url` |
| B4.2 | Valid payload, org **by name**, names match exactly | `201`. `org.agency_id` and `org.branch_id` returned so the partner can store them |
| B4.3 | Org by name with formatting drift: `"  FOO LETTINGS LTD "` against a stored `Foo Lettings` | `201`. Case, surrounding whitespace and a trailing `Ltd`/`Limited` are normalised away before matching |
| B4.4 | Org by name that matches nothing | `422`, `org.agency_name: not_found`. **Nothing is created and nothing is queued for reconciliation.** Check `agencies` gained no row |
| B4.4a | Branch name matches nothing under a matched agency | `422`, `org.branch_name: not_found`, and the message lists the branches we do hold |
| B4.4b | `branch_name` omitted, agency has exactly one branch | `201`, using that branch |
| B4.4c | `branch_name` omitted, agency has several | `422`, `org.branch_name: required`, message lists them |
| B4.4d | Two branches in one agency normalising to the same name | `422`, `org.branch_name: ambiguous`. **Not a guess and not the first match** |
| B4.4e | A key that still carries the retired `orgs:write` scope | Behaves exactly as one without it. The scope grants nothing and is not checked |
| B4.5 | Unmatched referrer email | `201`, user auto-provisioned `pending` with `full_name` = the email |
| B4.6 | Branch with no primary contact | `422`, `org.branch_id: no_agent_contact` |
| B4.7 | Five bad fields | `422`, **all five reported at once**, each with `field` and `code` |
| B4.8 | Partner in `pre_referenced_screened` | `501 not_implemented` |
| B4.9 | Partner in `opndoor_referenced` | `501 not_implemented` |

**B4.6 is the counterpart to A3.2.** The same condition that strands a paying
tenant in the portal is a rejection before payment here. If B4.6 ever returns
`201`, the guarantee is gone.

**B4.8 must not become `201`.** Treating a screened partner as open approves
every applicant with no criteria applied, which looks exactly like working
software. If this row changes, it should be because a criteria engine exists.

Assert on B4.1 that the created row is **indistinguishable** from a portal one:
same table, `status='sent'`, a `referrer_name` snapshot, `partner_rate` and
`agent_rate` snapshots, and **no column recording that it came from the API**.
Provenance lives in `partner_api_requests` only.

## B5. Idempotency

| # | Case | Expected |
| - | ---- | -------- |
| B5.1 | Same key, same body, twice | second returns the **identical** body with `Idempotent-Replay: true` |
| B5.2 | Row count after three such POSTs | **exactly one** application |
| B5.3 | Same key, different body | `409 idempotency_key_reused` |
| B5.4 | No idempotency key | `400 malformed_request` |
| B5.5 | Retry of a request that failed validation | replays the **same `422`**, does not re-run |
| B5.6 | Key order changed in the JSON body | treated as the **same** request; the hash is over canonical JSON |

B5.2 is the assertion that matters. Without it a retry after a timeout bills a
tenant twice.

## B6. Rate limiting and errors

| # | Case | Expected |
| - | ---- | -------- |
| B6.1 | Exceed the per-IP tier **while unauthenticated** | `429` with `Retry-After`, **before** any key verification |
| B6.2 | Exceed the per-key tier | `429` with `Retry-After` |
| B6.3 | Unknown endpoint | `404 not_found` |
| B6.4 | Wrong method | `405` with `Allow` |
| B6.5 | Any response | carries `X-Request-Id` |

B6.1 is a security property, not a capacity one: without it, each unauthenticated
attempt costs a hash and a database lookup, so the auth path is itself the attack
surface.

## B7. Outbound webhooks

Built and exercised on dev. The dispatcher needs the ops secret seeded and a
schedule, neither of which a fresh project has: see `HANDOVER.md` 9.9.

| # | Case | Expected |
| - | ---- | -------- |
| B7.1 | Register an endpoint | `201`, secret returned **once** |
| B7.2 | List endpoints | secret **never** returned |
| B7.3 | Register a non-https url | `422 must_be_https` |
| B7.4 | Application reaches `paid` | one delivery row per subscribed endpoint, `application.paid` |
| B7.5 | Two endpoints, one failing | the healthy one delivers; **the failure does not delay it** |
| B7.6 | Endpoint returns 500 repeatedly | `attempts` climbs, `next_attempt_at` backs off, `dead_at` set after the eighth |
| B7.7 | Endpoint returns `410 Gone` | dead-lettered **immediately** |
| B7.8 | Signature | `X-Opndoor-Signature: t=…,v1=…` verifies as HMAC-SHA256 over `"<t>.<body>"` |
| B7.9 | Application `expired` | event is **`application.lapsed`**, not `application.expired` |
| B7.11 | `expired` then paid late | event is **`application.reinstated`**, not a second `application.paid` |
| B7.12 | Tenant-declined `withdrawn` then paid late | also `application.reinstated`. Same branch, same shape |
| B7.13 | **Staff**-withdrawn then paid late | **no event at all.** Status does not change, so the trigger never fires. See defect 8 |
| B7.10 | Same event type twice for one application | **only one delivery**, by unique index |

**B7.5 is the whole design.** It is the property `hubspot-sync` does not have,
where one failing event blocks the entire feed for every partner. If B7.5 ever
fails, the queue has regressed into a cursor.

**B7.10 is a deliberate at-most-once guarantee.** The cost it used to carry, a
partner hearing `application.lapsed` and then nothing, is now covered by
`application.reinstated` being a distinct event rather than a repeat of
`application.paid`. That keeps at-most-once intact while ensuring a partner is
never left with a permanently wrong record, and stops anyone treating
`application.paid` as a first-payment signal from double counting.

**B7.13 is the gap that remains.** A staff-withdrawn application paid late
produces no webhook of any kind, because `apply_stripe_payment` does not change
its status. The partner is never told money arrived. That is defect 8, not a
webhook bug, and it should be fixed there.

---

# Section C: what to automate

## The built-artefact grep: automate this one first

**Source change, 2026-08-11.** The partner documentation is now generated from
`PARTNER-DOCS.md`, a partner-facing document, rather than by filtering
`PARTNER-API.md`, the internal design record. The allowlist of "partner-facing
sections" is gone: every section of the new source ships. The generator's refusal
rules stay as a backstop and now report which rule tripped and on what, and it
exits non-zero rather than stripping the line and shipping the rest.

**Two categories, and only one of them must be zero.**

The grep exists to catch **the internal specification reaching the documentation
panel**. It cannot distinguish that from **ordinary admin UI strings**, which are
in the bundle because any single-page app ships all of its own screens. Judge a
hit by where it comes from:

```sh
# always the first question: is it in the generated docs, or elsewhere?
grep -c "<the match>" src/pages/DevCentre/partnerDocs.generated.ts
```

Non-zero there is a real leak. Zero there, and it is admin UI.

**Two expected hits today, both admin UI, both tracked:**

| Match | Source | Why it is not a docs leak |
| ----- | ------ | ------------------------- |
| `14 days after` | `ApplicationDetail.tsx` | The portal's own staff-facing copy. Defect 15. |
| `pre_referenced_*` | `REFERENCING_MODES` in `src/data/types.ts` | The Partner Management screen, superadmin only. |

**The second one carries a residual exposure worth stating rather than waving
through.** Those labels include "Not yet available: applications are refused",
which is roadmap information, and the bundle is readable by anyone with a portal
login including a partner's developer. It is mild, it is not credentials, and
removing it would mean moving the mode list server side behind an RPC, which is
a lot of machinery for one dropdown. Recorded here so the decision is visible
rather than accidental. **If a fourth mode or a dated roadmap ever goes in that
list, revisit it.**

Every other category below must return zero.

**`[AUTO]`. It has caught two leaks that neither `tsc` nor `npm run build` would
ever flag, because a leaked string is perfectly valid TypeScript.**

Build, then grep the emitted bundle. Not the source: the source was correct both
times, and the leak was in what the bundler inlined.

```sh
npm run build
python3 - <<'EOF'
import glob
blob = "".join(open(f, encoding='utf-8', errors='ignore').read()
               for f in glob.glob('dist/assets/*.js') + glob.glob('dist/assets/*.css'))
BANNED = [
  # internal documents
  'DEFECTS.md', 'REGRESSION.md', 'HANDOVER.md', 'PARTNER-API.md', 'HANDOVER-MACHINE.md',
  # repo structure
  'supabase/migrations', 'supabase/functions', 'node_modules',
  # any project ref that is not this one
  'xogpsaoyprgmxdkmcype', 'pwftaqtrrqtilxlvwxjd', 'updniardvylhsiavtncw',
  # credentials of every shape
  'sk_live_', 'sk_test_', 'service_role', 'SUPABASE_SERVICE_ROLE_KEY',
  # server internals
  'security definer', 'app_partner()', 'is_aal2()', 'key_hash',
  # ops
  'reminders_cron', 'x-ops-secret', 'ops_secrets',
  # real or potential partner names, which must never appear in a placeholder,
  # example, empty state or tooltip. A partner's developer reading "Rightmove
  # production" in the mint-a-key form learns who our other customers are.
  # Invented names only. Add any new partner here as they sign.
  'Rightmove', 'Zoopla', 'PrimeLocation', 'OnTheMarket',
  # suppliers a partner has no business knowing. Same rule as partner names, and
  # for the same reason: the bundle is readable by anyone with a portal login,
  # so route-gating the admin screens that used to say "Sync HubSpot" gated the
  # screen and not the string. Stripe and PandaDoc are deliberately NOT here: a
  # partner's developer meets both in the payment and signing flows, so naming
  # them describes their own integration rather than our purchasing.
  'HubSpot', 'hubapi.com', 'HUBSPOT_', 'resend.com', 'RESEND_API_KEY',
]
hits = [b for b in BANNED if b in blob]
print('LEAKED:', hits or 'none')
raise SystemExit(1 if hits else 0)
EOF
```

Also assert **zero JWT-shaped strings**: `eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`.

**Two expected hits that are not leaks**, so the check does not cry wolf:

| Hit | Why it is fine |
| --- | -------------- |
| `opnd_live_`, `opnd_test_` | The documented key **format**, and examples. Assert no string matching the full key shape `opnd_(live\|test)_[A-Za-z0-9]{32}`. The documentation placeholder is deliberately written `opnd_live_<32 characters>` rather than 32 literal characters, so it does not trip its own check |
| `partner_rate`, `agent_rate` | Column **names** in select strings and a label map, never values. Assert no numeric rate literal |
| `whsec_` | **Moved out of the banned list.** The Dev Centre masks an unrevealed signing secret as `whsec_******`, so the prefix is a UI placeholder rather than a secret. Banning it made the check fail on a clean tree, which is how a check gets ignored |
| `pre_referenced_*` | Admin UI strings from the partner settings screen. See the note above the table |
| `Resend`, `resend` | **Deliberately not banned.** It is an ordinary English verb and the bundle has it 21 times: "Resend invite", "Resend payment email", "Resend signature request", plus `resend()` inside `supabase-js` and the `resend-payment-email` function name. Banning the word would fail on a clean tree and be ignored within a week, so the check bans `resend.com` and `RESEND_API_KEY`, which cannot be anything else |
| `hubspot` **lowercase** | One hit, `trigger_hubspot_sync`, the RPC name. See the residual below |
| `Vercel` | Two hits, both inside a vendored library's "Edge runtime detected" warning. Not us naming our host, and not removable without patching a dependency |

**One residual, stated rather than waved through.** The brand spelling `HubSpot`
is now zero in the bundle, but the RPC name `trigger_hubspot_sync` still is not,
so a determined reader of the JavaScript can still infer the CRM. Closing it
means renaming the function, which is a migration plus a client change plus a
window where an old bundle calls a name that no longer exists. It was judged not
worth that on the eve of a handover. **If the RPC is ever renamed for another
reason, take the chance.** The ban is on the brand spelling and case-sensitive
for exactly this reason: a case-insensitive ban would fail on a clean tree today,
and a check that fails on a clean tree gets ignored.

### What it caught

1. **The whole of `PARTNER-API.md` shipped in the bundle.** The docs panel imported it with `?raw` and filtered at render time, which filters what is *rendered*, not what is *shipped*. Defect references, migration citations and open questions were readable in devtools by any partner developer.
2. **A second commission leak.** After narrowing the `partners` select, the grep showed **two** select strings carrying the rate columns: `applications` carries its own snapshot, and only one had been narrowed.

Neither is visible in a code review of the diff, which is the argument for the check.

## Automate first, highest value per hour

**All of Section B.** HTTP in, JSON out, no external services. A shell script
with `curl` and `supabase db query` covers it, which is exactly how it was
verified during the build. This is the cheapest suite in the document and it
protects the newest code.

**Section A database assertions.** Every `activity_log`, `status`,
`payment_state` and `deed_state` expectation can be asserted with SQL once the
triggering event has happened.

## Needs a harness

| Need | Why | Rough shape |
| ---- | --- | ----------- |
| Stripe event injection | `checkout.session.completed`, `charge.refunded` and the failure events drive most of the lifecycle | `stripe trigger`, or POST a signed fixture to `stripe-webhook`. The signature is real, so fixtures must be signed with the project's `STRIPE_WEBHOOK_SECRET` |
| PandaDoc event injection | `document.completed`, `viewed`, `declined`, `voided` | POST to `pandadoc-webhook` with a `?signature=` HMAC over the raw body using `PANDADOC_WEBHOOK_SHARED_KEY` |
| Email capture | Every email assertion needs a real inbox today | A catch-all inbox, or a test key from the email provider. `EMAIL_REVIEW_ADDRESS` is **restored** as of defect 4's fix: set it and every recipient is replaced by it, which is the cheapest capture there is. Section D4 asserts this |
| Clock control | Expiry is day 15 and reminders are day 2, 5, 9 | Both take `p_today`, so pass a date rather than moving the clock |
| A seeded fixture set | Every test needs a partner, agency, branch, contact and user | One SQL script. The build already has one covering the four `has_agent_contact` cases |

## Needs a person

- **Anything through the real Stripe Checkout page.** A3.4, A3.5 and the manual
  deed actions are UI flows.
- **Deed signing in PandaDoc.** The end-to-end signature; the webhook can be
  injected, but the real signing ceremony cannot.
- **Refunds.** There is no in-portal refund action at all, so every refund test
  starts in the Stripe dashboard.
- **Anything asserting how something reads.** Whether a partner understands
  "POLICY ANOMALY: …" in their feed is a judgement, not an assertion.

## Not testable at all today

- **`deno check`** cannot run without Deno installed.
- **Local `supabase start`** needs Docker.
- **`verify_jwt`** is a dashboard setting with no `config.toml`, so it cannot be
  asserted from the repo. Test it by calling `partner-api` with a known-good key
  and asserting `200`; a `401` means it was re-enabled by a plain deploy.

---

# Defect index

Rows tagged `[D1]`–`[D7]` expect behaviour recorded in `DEFECTS.md`. Rows tagged
`[D-new]` are behaviours this exercise surfaced that are **not** yet in
`DEFECTS.md`, listed here so they are not mistaken for regressions:

| Where | Behaviour |
| ----- | --------- |
| A2.2 | Starting checkout is not logged anywhere |
| A5.5 | "Save this contact" persists nothing; HubSpot records the wrong recipient |
| A6.2 | `refund_anomaly` is partner-visible with raw internal wording |
| A6.4 | A partial refund marks the application fully Refunded everywhere |
| A6.5 | A second refund event sends the tenant a second refund email |
| A6.6 | A refund matching no application is silently invisible |
| A8.1 | `expired` produces no HubSpot event, so the CRM shows Referred for ever |

Four of the behaviours first listed here have since been promoted into
`DEFECTS.md` as full entries, and are tagged in the tables above rather than
listed as unrecorded:

| Defect | Where | Note |
| ------ | ----- | ---- |
| 7 | A1.4 | The false "Redirected to … (test mode)" audit row |
| 8 | A9.3 | Payment on a staff-withdrawn application. **Worse than first thought**: `/pay/confirmed` tells the tenant they paid, while staff are told no fee was collected |
| 9 | A6.3 | A refund whose deed void fails leaves a signable deed on a refunded application |
| 10 | A9.1, A9.2 | Stale `expired_at` and `withdrawn_*` columns survive reinstatement. Confirmed **low**: nothing reads these columns today |

One claim in an earlier draft of this plan was **withdrawn** after checking: that
A4.4 lets a deed execute on a withdrawn application. The branch is real but
unreachable. Defect 9 is the reachable version and arrives by a different route.

---

# Section D: the defect fixes

Every row here asserts a **fix**, so unlike section A these are not tagged with a
defect number as "expected wrong". A failure in this section is a regression
against work that was done deliberately.

Run section D after A and B. Several rows need a disposable project and one needs
a deliberately broken PandaDoc key.

## D4/D7. Email redirect and the audit row

| # | Setup | Expected |
| - | ----- | -------- |
| D4.1 | `EMAIL_REVIEW_ADDRESS` **unset**, create a referral | The tenant receives the payment email. One `payment_email_sent` row, business. **No** "Redirected to" row |
| D4.2 | `EMAIL_REVIEW_ADDRESS` **set**, create a referral | The review inbox receives it and the tenant does **not**. Two rows: the business one, plus an internal one naming the review address AND the intended recipient |
| D4.3 | Set, then generate a deed | PandaDoc's signing email arrives at the review address. **The tenant does not receive a deed to sign.** This is the one that matters |
| D4.4 | Set, then run `expiry-cohorts` | The CSV attachment goes to the review inbox only |
| D4.5 | Set, then run `weekly-digest` | The email carries the review banner naming the intended recipients. It was previously dead code |
| D4.6 | Grep for the old shape | `grep -rn "EMAIL_REVIEW_ADDRESS" supabase/functions/` returns hits only in `_shared/emailRecipients.ts` and comments. No module reads it directly |

**D4.2 is the assertion that proves the fix**, because the pre-fix code sent to
the review address *and* the real recipient. Check the tenant's inbox is empty,
not just that the review inbox is full.

## D8. Payment on a withdrawn application

| # | Setup | Expected |
| - | ----- | -------- |
| D8.1 | Withdraw a `sent` application as staff, then apply a payment | `status` stays `withdrawn`, `payment_state` stays `awaiting`, the payment intent is recorded |
| D8.2 | Call `payment-confirmation` for that session | **`paid` is false.** Previously true, and the tenant was shown "Payment received" and the full fee |
| D8.3 | Same, for an **expired** application | `paid` false. The old `status !== 'sent'` test reported this as paid too |
| D8.4 | Open the application in the portal | The Payment card leads with a red banner naming the payment intent and saying it needs refunding. The old "no guarantor fee was collected" note does **not** show |
| D8.5 | Create a referral, inspect the Stripe session | `expires_at` is 30 minutes out, not Stripe's 24 hour default |

## D9. Failed deed void during a refund

| # | Setup | Expected |
| - | ----- | -------- |
| D9.1 | Break `PANDADOC_API_KEY`, then refund an application whose deed is `awaiting_tenant` | `deed_state` becomes **`error`** and `pandadoc_document_id` is **cleared**, even though the remote void failed |
| D9.2 | Same | An internal `deed_void_failed` activity row naming the provider error, and an `ops_alerts` row |
| D9.3 | Then complete the PandaDoc document anyway | `apply_deed_executed` **refuses**. No status change, and a `deed_execution_refused` internal row |
| D9.4 | Refund an application, then complete its deed with the id still set | Also refused, by the `payment_state = 'refunded'` guard |

## D2. Ops base URL

| # | Setup | Expected |
| - | ----- | -------- |
| D2.1 | `ops_secrets.functions_base_url` **unset**, trigger an alerting kind | The `ops_alerts` row is still written. No HTTP call, no error |
| D2.2 | Unset, press "Sync HubSpot" | A clear error naming the missing configuration, not a silent success |
| D2.3 | Set it, repeat both | The call goes to **this** project |
| D2.4 | `select command from cron.job where jobname = 'hubspot-sync'` | Contains `ops_functions_base_url()`, not a literal project ref |

## D6. Contact primary invariant

| # | Setup | Expected |
| - | ----- | -------- |
| D6.1 | A branch with two contacts, one primary. `PATCH` the primary to `is_primary: false` | The other is promoted. `effective_primary_contact` still resolves |
| D6.2 | A branch with **one** contact. Same PATCH | **Refused**, SQLSTATE 23514, with a message telling you to add another or delete this one |
| D6.3 | Delete the only contact | **Allowed.** An owner with no contacts is honest; a contact that is primary for nobody is not |
| D6.4 | Open Agencies and branches with such a branch | A red banner at the top counts and names the branches that cannot issue a deed |

## D13. Toast tone

| # | Setup | Expected |
| - | ----- | -------- |
| D13.1 | Withdraw an already-withdrawn application from a second tab | A **red** toast with an alert icon, 6 seconds |
| D13.2 | Any successful action | Unchanged: dark pill, green tick, 3.2 seconds |
| D13.3 | `grep -rn "toast(" src --include=*.tsx \| grep -iE "could not\|cannot\|failed" \| grep -v "'error'"` | No hits |

## D10. Reinstated markers

| # | Setup | Expected |
| - | ----- | -------- |
| D10.1 | Expire an application, then pay it | `status` paid and **`expired_at` null** |
| D10.2 | Tenant-decline, then pay | `withdrawn_at`, `withdrawn_reason` and `withdrawn_by` null, `withdrawn_by_tenant` **false** |
| D10.3 | Try to set `expired_at` on a paid application directly | Refused by `applications_no_stale_closure_markers` |

## D3, D14, D15, D16

| # | Setup | Expected |
| - | ----- | -------- |
| D3.1 | `VITE_STRIPE_PUBLISHABLE_KEY` = `pk_test_…` | An amber **Test mode** badge on the Payment card. Previously no badge at all |
| D3.2 | `pk_live_…` | A quiet **Live mode** badge |
| D3.3 | Unset | **No badge.** Three states, not two |
| D14.1 | Send a PandaDoc callback with a signature differing in the first character, and one differing in the last | Both refused, in indistinguishable time |
| D15.1 | Let an application lapse, read the activity row | "unpaid **15** days after referral" |
| D15.2 | Dashboard and Activity | "within 14 days" unchanged: that is guarantee expiry, a different window |
| D16.1 | `npm run smoke` | 127 passed, 15 files |

---

# Section E: the developer role sees its own screen

**Why this section exists, and why it is not only a boundary test.**

The developer role was reviewed twice for what it must **not** reach: commission,
settlement, exports, the bordereau, and any write. Both reviews passed. Neither
noticed that the role had lost the Dev Centre entirely, because nothing asserted
the positive.

The cause was a capability gate on the sidebar item, keyed on the partner's
`api_access_enabled`. That column defaults false and is deliberately never
backfilled, so "hide the Dev Centre from a developer whose partner has no API
access" evaluated to "hide it from every developer at every partner". The role
kept every restriction it was designed with and lost the only screen it exists
for, and every negative test still passed.

**So E1 comes first, before the boundary rows.** A role is defined by what it can
do as much as by what it cannot, and a plan that only tests the second half
reports a healthy role that is useless.

E2 and E3 are the boundary. Run all three: E1 passing while E2 fails is a leak,
E2 passing while E1 fails is the bug this section was written for.

## E1. What a developer must SEE

Sign in as a developer at a partner with **`api_access_enabled = false`**. That is
the default for every partner, so it is also the ordinary case, not an edge one.

| # | Setup | Expected |
| - | ----- | -------- |
| E1.1 | Read the sidebar | **Dev Centre is present.** This is the regression. It is listed first because it is the row that was missing |
| E1.2 | Read the rest of the sidebar | Dashboard, Applications and League as well. Four items, and no others |
| E1.3 | Open Dev Centre | It renders, with an amber notice naming the partner and saying API access is off. Not a blank screen and not an error |
| E1.4 | With the notice showing, open the documentation and the webhook catalogue | Both readable. Waiting for API access to be switched on is exactly when a developer reads them |
| E1.5 | Set `api_access_enabled = true` on that partner, reload | Same nav item, **notice gone**. Minting is now offered |
| E1.6 | Type `/dev-centre` directly with the capability off | Renders. The route guard is role-based, so a nav that hid this item would be hiding a door it does not lock |
| E1.7 | `grep -n "requiresCapability" src/constants/nav.ts src/components/layout/Sidebar.tsx` | **No hits.** The gate is gone rather than defaulted to true, so it cannot be switched back on by a config change |

E1.6 is the row that makes the case. A nav filter and a route guard disagreeing
is not a security control, it is two answers to one question, and the visible one
was the wrong one.

## E2. What a developer must NOT see: commission

Enforced by column privilege, not by the UI, so assert it in SQL as well as on
screen. Run the SQL as the developer's own role.

| # | Setup | Expected |
| - | ----- | -------- |
| E2.1 | `select has_column_privilege('applications', 'partner_rate', 'select')` | **false** |
| E2.2 | Same for `agent_rate`, and for both columns on `partners` | **false** in all four |
| E2.3 | `select partner_rate from applications limit 1` | Refused. Not an empty column: a permission error |
| E2.4 | Open an application as a developer | No commission figures anywhere on the detail page |
| E2.5 | `select * from application_commission_rates(null)` | Zero rows. The function scopes itself rather than trusting the caller not to ask |

E2.3 is the one worth doing by hand. A column-level `REVOKE` cannot subtract from
a table-level `GRANT`; the table grant had to be revoked and re-granted column by
column. A partial job leaves the column readable while the UI hides it, which
looks identical on screen.

## E3. What a developer must NOT do

| # | Setup | Expected |
| - | ----- | -------- |
| E3.1 | Sidebar | **No New referral**, no Org, no Users, no Partners, no Reconciliation, no Health |
| E3.2 | Type `/new` directly | Redirected. The guard, not the missing nav item, is what stops this |
| E3.3 | Attempt any export or the bordereau by URL | Refused |
| E3.4 | `insert into applications …` as the developer role | Refused by RLS. The role is read-only plus the Dev Centre |
| E3.5 | Read another partner's application by id | Zero rows, not an error. Partner scoping is a row filter |

## E4. What the Dev Centre tells a partner's developer

The banner is read once, before minting a key, so it carries one fact. Everything
it used to carry alongside that fact is now in the getting-started guide.

| # | Setup | Expected |
| - | ----- | -------- |
| E4.1 | Open the Dev Centre on **production** | Banner is **one line**: the prefix decides the mode, and going live is swapping the key. Nothing about disposable projects |
| E4.2 | Open it on a **non-production** project | The same line, plus **one** more saying this project reaches nothing real. Two lines, not three |
| E4.3 | Read the banner on either | **No supplier is named.** Not the CRM, not the email provider |
| E4.4 | Open the getting-started guide | The detail cut from the banner is there in full: test cards, watermarked deeds, no opndoor email to anyone, and sandbox applications visible only on the Sandbox tab |
| E4.5 | Mint-a-key modal, Sandbox option | Describes what sandbox does without naming an internal system |
| E4.6 | The built-artefact grep in section C | `HubSpot` returns zero. It was in two Dev Centre strings and four admin ones |

E4.6 is the row that generalises. The admin strings were reachable only by an
opndoor admin **by route**, and shipped to every logged-in browser **by bundle**.
Route-gating a screen does not gate the strings on it.

---

# Section F: shared ground with the referral path

**Why this section exists.** The four-rail work adds states, columns, payments
and a tenant principal to a database the Rightmove referral path already stands
on. Sections A to E assert what the referral path *does*. This section asserts
that the new work has not moved the ground under it.

Every row here is written to pass **before** any four-rail code exists. That is
deliberate: run F first, on a tree with none of the new work, and record the
result. A row that passes today and fails later is the whole point of the
section. A row that fails today is a bug in the row.

**Section F was first run on 2026-08-12**, against the dev project, immediately
after the ten migrations `20260811260000` to `20260812090000` were applied.
Thirty-one checks executed and passed:

| Group | Executed | How |
| ----- | -------- | --- |
| F1.1 to F1.5, plus the new `referencing` arm | **7 PASS** | Against a real application. Each attempt runs inside a `BEGIN … EXCEPTION` block, so the failed update rolls its subtransaction back; the final row was verified unchanged |
| Eligibility rules and the group test | **9 PASS** | Pure functions, no data written. Includes the carry case: one applicant covering the whole rent, another covering nothing |
| Structural: route resolver, house routes, trigger conditionality, applicant tables and triggers, column grants, restrictive policies, partitioned cursor | **15 PASS** | Catalogue reads |

**Not yet executed, and each needs something a read-only check cannot do:**
F2.2 to F2.5 need the CRM feed deliberately poisoned; F3.1 to F3.4 need a live
AAL1 and a live tenant session; F4.1 to F4.7 and F6.1 to F6.11 need applications
created on each rail. Those are the rows that need the fixture and a person.

**Section F needs the second-partner fixture**, `supabase/fixtures/second-partner.sql`.
Nothing else in this plan uses more than one partner, which is exactly why the
cross-partner properties below have never been executed.

## F1. The state machine cannot be widened by accident

`applications_status_dates` is a positive OR-chain over named statuses, so it
rejects an unknown status outright. That is the strongest single protection the
referral path has, and widening the constraint means rewriting it, which is when
an arm gets dropped by hand.

| # | Setup | Expected |
| - | ----- | -------- |
| F1.1 | `update applications set status = 'nonsense' where guarantee_ref = '<any>'` | Refused, SQLSTATE **23514**. Not 23503, not success |
| F1.2 | Set `status='paid'` with `paid_at` NULL | Refused, 23514 |
| F1.3 | Set `status='deed'` with `deed_issued_at` NULL | Refused, 23514 |
| F1.4 | Set `status='withdrawn'` with `paid_at` non-NULL | Refused, 23514 |
| F1.5 | Set `status='expired'` with `paid_at` non-NULL | Refused, 23514 |
| F1.6 | After ANY migration that widens the status set, re-run F1.1 to F1.5 | All five still refused. **This is the row that catches an arm dropped while rewriting the constraint** |

F1.6 is the one that matters. The other five are its fixtures.

## F2. One rail cannot stall another's CRM feed

`hubspot_pending_events` is a single FIFO with no partner predicate, and the sync
loop breaks on the first error and holds a singleton cursor. One poisoned event
from any rail stops every partner's CRM updates, silently, after one incident.

| # | Setup | Expected |
| - | ----- | -------- |
| F2.1 | Load the fixture. Create an application under `fixture-alpha` and one under `fixture-beta` | Both present |
| F2.2 | Poison alpha's event (delete alpha's HubSpot company mapping so its upsert throws), then run `hubspot-sync` | **Beta's events still reach HubSpot.** Before the cursor is partitioned this FAILS: beta is blocked behind alpha |
| F2.3 | Read `hubspot_sync_cursor` | Alpha's cursor held at last success; **beta's advanced**. One row per partner, not one row |
| F2.4 | Leave alpha poisoned for longer than the staleness threshold | A staleness alert fires. Not silence after a single incident |
| F2.5 | Repair alpha, run again | Alpha catches up from its own cursor with no gap and no replay of beta |

## F3. A non-staff session reads nothing

Tenant accounts introduce an authenticated principal that is not staff. Every
application policy is written in terms of `app_role()` and `app_partner()`, and
`require_aal2` is restrictive so it ANDs with all of them.

| # | Setup | Expected |
| - | ----- | -------- |
| F3.1 | Authenticated session at **AAL1** (no TOTP), `select * from applications` | **Zero rows.** Not an error, zero rows |
| F3.2 | Same session, `insert into applications` | Refused |
| F3.3 | A session whose `users` row has a NULL `partner_id` and a non-admin role | Zero rows. Confirms null-partner fails closed rather than matching |
| F3.4 | After tenant accounts ship, repeat F3.1 with a tenant principal | Still zero rows. A tenant reaches their own data through a service-role function, never through PostgREST |
| F3.5 | `select polname, polpermissive from pg_policy where polrelid = 'public.applications'::regclass and not polpermissive` | `require_aal2` and the livemode restrictive policy both still present |

F3.5 is the cheap one to automate. A restrictive policy quietly becoming
permissive is invisible in every functional test.

## F4. Route attribution keeps a direct application away from Rightmove

`applications.partner_id` is the route, and it drives commission **and**
visibility. The same agency reached by two routes must give two answers.

| # | Setup | Expected |
| - | ----- | -------- |
| F4.1 | Create an application via `create_referral` as an alpha referrer against an alpha branch | `partner_id` = alpha. Unchanged from before route attribution |
| F4.2 | Create one via `create_referral_api` with a beta key against a beta branch | `partner_id` = beta |
| F4.3 | Create one against an **alpha** branch with an explicit route of the house direct partner | `partner_id` = **direct**, `agency_id` = alpha's agency. One agency, two routes |
| F4.4 | Sign in as alpha management and list applications | F4.3's row is **absent**. This is the row that proves Rightmove cannot see a direct application at one of their agencies |
| F4.5 | Read `partner_rate` / `agent_rate` on F4.3's row | The **direct** partner's rates, which are zero. Not alpha's |
| F4.6 | Read the partner webhook queue for alpha | No delivery enqueued for F4.3 |
| F4.7 | As an opndoor admin (NULL `partner_id`), create against an alpha branch with no explicit route | `partner_id` = alpha. The admin fallback, and the pre-migration behaviour |

F4.7 is not a nicety. `app_partner()` is NULL for a superadmin by constraint, so
a creator-only rule would raise NOT NULL here on a path `is_admin()` explicitly
permits.

## F5. New columns arrive invisible, not broken

The table grant on `applications` was revoked and re-granted per column, so a new
column has **no** grant until one is written.

| # | Setup | Expected |
| - | ----- | -------- |
| F5.1 | After any migration adding a column to `applications`, run `select has_column_privilege('authenticated','public.applications','<col>','SELECT')` | Matches intent. **False by accident is the default**, so this is an assertion of intent, not of correctness |
| F5.2 | `select partner_rate from applications` as an authenticated non-admin | Refused. The revocation still holds |
| F5.3 | Add a NOT NULL column with no default, then POST `/v1/applications` | Refused at insert. **A NOT NULL column with no default breaks `create_referral_api`'s explicit insert list and takes Rightmove's create path down on the next request.** Add nullable, backfill, then set NOT NULL, in one migration, as `referencing_mode` did |

## F6. Tenant identity is not staff identity

A tenant is an applicant with no `public.users` row. The whole security case for
tenant accounts is that this makes them invisible to every existing policy
without any policy changing.

| # | Setup | Expected |
| - | ----- | -------- |
| F6.1 | Create an applicant, then try to insert a `public.users` row with the same id | Refused by `users_not_applicant`, SQLSTATE 23505 |
| F6.2 | The reverse: staff user first, then applicant with the same id | Refused by `applicants_not_staff` |
| F6.3 | Sign in as a tenant, call PostgREST directly: `select * from applications` | **Zero rows.** Four independent reasons; any one is sufficient |
| F6.4 | Same session, `select * from applicants` | Zero rows. The table has **no policies at all**, deliberately |
| F6.5 | `POST /functions/v1/tenant-portal` with a tenant JWT, action `list_applications` | Only that tenant's own applications |
| F6.6 | Same call with **another** tenant's id in the body | Ignored. The identity comes from the token; the body has no id field to honour |
| F6.7 | Same call with a **staff** JWT | 403, and the same 403 an unknown identity gets |
| F6.8 | Inspect the payload of F6.5 | No `partner_rate`, no `agent_rate`, no referrer, no internal notes |
| F6.9 | `select referrer_id from applications where applicant_id is not null` | NULL. A direct signup has no referrer |
| F6.10 | Try to insert an application with neither `referrer_id` nor `applicant_id` | Refused by `applications_referrer_required` |
| F6.11 | Referrer league, with a direct application present | The direct row is **absent** from referrer rankings and **present** in the agency total |

F6.11 is the one that would otherwise go unnoticed: without it a direct signup
ranks as a referrer called "(unknown)" whose volume grows with every use.

---

# Section G: org sharing

An agency is branched once and reached by several partners. The rule that makes
this safe is narrow and absolute: **sharing an agency never shares a contact
book.** Most of this section exists to assert that one sentence.

Verified on 2026-08-12 after `20260812100000` to `20260812140000`: eleven checks,
all passing, including that visibility was **unchanged** by the migration
(every relationship introduced-only, one per agency) and that no contact
changed hands.

## G1. Reachability, and what it does not carry

| # | Setup | Expected |
| - | ----- | -------- |
| G1.1 | Partner A introduced agency X. Partner B has neither a user there nor an application | B cannot see X. Reachability is not public |
| G1.2 | Attach a B user to X, reload as B | B sees X **and its branches**. This is the bootstrap the whole design exists for |
| G1.3 | As B, read X's contacts | **Only B's own.** A's contacts are invisible. The single most important row in this section |
| G1.4 | As B, read applications at X | Only B's own route. `applications_select` is route-scoped and was not touched |
| G1.5 | As B, read `partner_agency_relationships` | Only B's rows. Reading all of them would reveal which partners work with X, which is a client list |
| G1.6 | As B, agency and branch league figures for X | B's own volume only, and it is correct **by construction**: the aggregate is built from applications B can already read |
| G1.7 | Detach B's last user from X, B having never transacted | B loses X. The relationship row is deleted, not left with no reason |
| G1.8 | Same, but B has transacted | B keeps X. `transacted` holds it up after the bootstrap goes |

G1.3 is the row to run first and the one to run again after any policy change.

## G2. Contact resolution on a shared agency

| # | Setup | Expected |
| - | ----- | -------- |
| G2.1 | A and B both keep a primary contact at X. Issue a deed on an A-route application | Delivered to **A's** contact. `source` reports `route_contact` |
| G2.2 | Same on a B-route application | B's contact |
| G2.3 | A route partner with no contact book at X | Falls back to the unscoped primary, `source` reports `branch_contact`. Delivery still happens, and the difference is visible rather than silent |
| G2.4 | A direct signup with a tenant-named agent | `source` reports `delivery_contact` and `verified` is false |

## G3. Duplicates and merging

| # | Setup | Expected |
| - | ----- | -------- |
| G3.1 | `select * from duplicate_agency_groups()` on a clean tree | **Zero rows.** The two house placeholders share a name and must not appear |
| G3.2 | Create "Smith & Co" under A and "smith and co ltd" under B | One group, `cross_partner` true. Detected, not refused |
| G3.3 | `merge_agencies(keep, merge)` as a non-admin | Refused |
| G3.4 | Merge with a placeholder as either argument | Refused. A house row must never absorb a real agency |
| G3.5 | Merge where both agencies have a branch of the same name | Both survive; the incoming one is suffixed and reported in `branches_renamed`. Nothing is lost to a unique constraint |
| G3.6 | After a merge, relationships | Unioned, reasons OR-ed. A partner who reached either row reaches the survivor |
| G3.7 | After a merge, contacts | Moved, and **`partner_id` unchanged on every one**. A merge is not a loophole in G1.3 |
| G3.8 | After a merge, applications | `agency_id` repointed, **`partner_id` untouched**. Merging org records does not change how anything arrived |

---

# Section H: the new rails

Verified live on 2026-08-12 where marked. The rest needs a seeded token, a
tenant session, or a provider that answers.

## H1. The inbound hand-over (rail 4)

| # | Setup | Expected |
| - | ----- | -------- |
| H1.1 [AUTO] | POST with no `Authorization` | 401, `{"status":"error"}` in **their** envelope, not ours. **Verified live** |
| H1.2 [AUTO] | POST with a wrong secret | 401 `Not authorised.` Indistinguishable from a revoked token. **Verified live** |
| H1.3 [AUTO] | Either of the above, then read `referencing_inbound_events` | **Zero rows.** A rejected call writes nothing. **Verified live** |
| H1.4 [SEMI] | Valid token, `overall_status` anything but `Pass with guarantor` | 422, recorded with the status, no application |
| H1.5 [SEMI] | Valid hand-over | 200, one application at **`sent`**, one `application_provider_links` row, reports in `reference-reports` |
| H1.6 [SEMI] | Send the identical payload again | 200 `already sent`, and **still one** application |
| H1.7 [SEMI] | Send a second payload with the same `table_id` but different tenant | Still one application. `table_id` is the provider's handle, not a nonce |
| H1.8 [SEMI] | A report whose base64 is corrupt | The hand-over still succeeds. The failure is logged and `raw_payload` retains the base64 |
| H1.9 [SEMI] | Read `agency_from_token` on the events | Tells you which seam answer is actually in force in production |

## H2. The callback

| # | Setup | Expected |
| - | ----- | -------- |
| H2.1 [AUTO] | Call with no ops secret | 401. **Verified live** |
| H2.2 [AUTO] | Call with `REFERENCING_API_*` unset | **503 listing exactly which are missing**, and **nothing marked notified** |
| H2.3 [AUTO] | A due row whose deed is not executed | Not selected. `provider_callbacks_due` requires an executed deed |
| H2.4 [AUTO] | Provider returns HTTP 200 carrying `{"response":"FAIL"}` | Counted as a failure. The body is trusted over the status |
| H2.5 [SEMI] | After a success | `notified_at` set, `notify_error` cleared |

## H3. Two payments never become one

| # | Setup | Expected |
| - | ----- | -------- |
| H3.1 [SEMI] | Checkout session with **no** `purpose` metadata | Treated as the guarantee fee. Exactly today's behaviour, which is what every in-flight session depends on |
| H3.2 [SEMI] | `purpose: "eligibility"` | Eligibility recorded, `draft` moves to `referencing`, **no `paid_at`, no deed, no receipt** |
| H3.3 [SEMI] | `purpose: "nonsense"` | Refused, not guessed. Guessing here means guessing whether to issue a deed |
| H3.4 [SEMI] | An eligibility payment on a pre-referenced application | Refused: that rail takes no eligibility fee |
| H3.5 [AUTO] | `update applications set status='referencing', paid_at=now()` | Refused, 23514. **Verified live** |

## H4. Joint tenancies

| # | Setup | Expected |
| - | ----- | -------- |
| H4.1 [AUTO] | Two applications on one tenancy, shares 60 and 40 | Accepted |
| H4.2 [AUTO] | Shares 60 and 30 | Refused at **commit**, not at insert. The trigger is deferred because applicants arrive one at a time |
| H4.3 [AUTO] | Shares 100 and 0 | Accepted. A zero share is the case the group rule exists for |
| H4.4 [AUTO] | `tenancy_group_prequalification` on H4.3 | `not_ruled_out`, provided the 100% holder clears their own share |
| H4.5 [AUTO] | A referral-path application | `tenancy_id` null, existing per-application deed columns untouched |

## H5. The tenant journey

Verified live on 2026-08-12 against the dev project with a real tenant session.

| # | Setup | Expected |
| - | ----- | -------- |
| H5.1 [AUTO] | Sign in as a tenant, then `GET /rest/v1/applications` **directly** | **`[]`.** Not an error, an empty array. The tenant is invisible to every existing policy. **Verified live** |
| H5.2 [AUTO] | `tenant-portal` `list_applications` with that session | Their own application. **Verified live** |
| H5.3 [AUTO] | `get_application` with **another** id | `Not found.` Same message an unknown id gets. **Verified live** |
| H5.4 [AUTO] | `save_profile`, `save_row` for an address, `save_row` for an income | All accepted, patches only. **Verified live** |
| H5.5 [AUTO] | `get_application` again | Everything read back: profile, 1 address, 1 income. **This is resume. Verified live** |
| H5.6 [AUTO] | `prequalify` | `not_ruled_out`, with the income, the monthly figure needed and the history months. **Verified live** |
| H5.7 [AUTO] | `submit` with under three years of history | 422 naming the shortfall, nothing marked complete |
| H5.8 [AUTO] | `save_property` with `partner_rate` in the patch | Ignored. The allowlist drops it; an unfiltered patch from a browser would otherwise reach commission and route columns |
| H5.9 [AUTO] | Any write after submission and payment | 409. Answers cannot drift once a reference is in flight |
| H5.10 [AUTO] | Type into a field, then close the tab before the debounce fires | The value is saved. `visibilitychange` and `pagehide` both flush |
| H5.11 [AUTO] | Answer "yes" to adverse credit, fill the CCJ detail, switch to "no", switch back | The detail is still there. Hidden fields are not cleared |
| H5.12 [AUTO] | Reload mid-form | Same tab, same step, every answer present |

## H6. The front door

Verified live on 2026-08-12 against the dev project.

| # | Setup | Expected |
| - | ----- | -------- |
| H6.1 [AUTO] | Prequalify, rent 1450, income 18000, not a student | `ruled_out`, `affordability_below_threshold`, needs 2175/month. **Verified live** |
| H6.2 [AUTO] | Same rent, income 40000, adverse credit **yes** | `not_ruled_out`. **Adverse credit rules nobody out**, because there is no credit file to see. **Verified live** |
| H6.3 [AUTO] | Student, income 0 | `not_ruled_out`. **Verified live** |
| H6.4 [AUTO] | Rent 2400 with a share of 800 | Basis is **800**, needs 1200/month. The share, not the whole rent. **Verified live** |
| H6.5 [HUMAN] | Read any success copy | Never "you qualify". "Nothing here rules you out", or plainly that it is unlikely |
| H6.6 [AUTO] | Register a new address | `{ok, sent}`, applicant row created, `email_confirmed_at` null. **Verified live** |
| H6.7 [AUTO] | Register the **same** address again | Byte-identical response. No enumeration. **Verified live** |
| H6.8 [AUTO] | Register a **staff** address | Same response again, and no applicant row is created |
| H6.9 [AUTO] | `request_reset` for an unknown address | Same response as a known one |
| H6.10 [AUTO] | Sign in with a wrong password, and with an unknown address | The same message for both |

## H7. The agent handoff

| # | Setup | Expected |
| - | ----- | -------- |
| H7.1 [SEMI] | Agent refers on a `pre_referenced_open` partner | **Unchanged.** Stripe session, payment email, reminders, 15-day lapse. The referral path does not enter the fork |
| H7.2 [SEMI] | Agent refers on an `opndoor_referenced` partner | **No Stripe session at all.** Status `draft`, an invite minted, the invite email sent |
| H7.3 [AUTO] | The invited application at day 15 | **Not lapsed.** `expire_stale_applications` selects on `sent` and this is `draft` |
| H7.4 [AUTO] | Open the invite link, signed out | The property, rent and start date. **No tenant name, no reference, no income.** Verified in SQL |
| H7.5 [AUTO] | Claim it from a **different** account | Refused: the link was sent to a different address. **Verified live** |
| H7.6 [AUTO] | Claim it from the invited account | Attached. **Verified live** |
| H7.7 [AUTO] | Claim it again from a second device | Resumes, does not fail. **Verified live** |
| H7.8 [AUTO] | Another account tries after the claim | Still refused. **Verified live** |
| H7.9 [AUTO] | Re-send the invite | The old token stops working. One live invite per application |

## H8. A draft may be incomplete

| # | Setup | Expected |
| - | ----- | -------- |
| H8.1 [AUTO] | Register with only a name, email and password, then start an application | Draft created. No title and no date of birth required yet. **This was broken before `20260812210000` and failed with a NOT NULL violation** |
| H8.2 [AUTO] | Null the date of birth while in draft | Allowed. **Verified live** |
| H8.3 [AUTO] | Move that application out of draft | Refused, naming what is missing. **Verified live** |
| H8.4 [AUTO] | A referral or API create missing any of the three | Refused exactly as before. The referral path never enters draft |

## H9. The fee sits between the basics and the rest

The order is register, basic details, fee, the rest of the form, then sent. The
fee is not the same event as going to the referencing partner, and conflating
them was the bug `20260812220000` fixes.

| # | Setup | Expected |
| - | ----- | -------- |
| H9.1 [AUTO] | New account, open the journey | Lands on **Property**. There is no prequalification screen |
| H9.2 [AUTO] | Try to open Address history before paying | Sent to the **Application fee** step. Locked steps redirect rather than doing nothing |
| H9.3 [AUTO] | Try to pay with Property or About you unfinished | Refused, naming which. We do not take money for an application that is missing something |
| H9.4 [AUTO] | `submit` with the fee unpaid, **called directly against the API** | `The application fee has not been paid.` **Verified live.** The lock that matters is in SQL, not the browser |
| H9.5 [SEMI] | Pay the fee | Application stays **`draft`**. Paying unlocks the form; it sends nothing |
| H9.6 [SEMI] | Read the status after paying | Still `draft`, never `referencing`. `referencing` means with the provider |
| H9.7 [AUTO] | Submit with the fee paid but under three years of history | Refused, naming the months given |
| H9.8 [AUTO] | Submit with the fee paid and no main income | Refused |
| H9.9 [AUTO] | Submit complete | `draft` to `referencing`, `completed_at` set, activity row written |
| H9.10 [AUTO] | Return from Checkout to `/apply?fee=paid` | The URL is cleaned and the form re-reads shortly after, so a paid tenant never sees a locked form because the webhook was a moment behind |
| H9.11 [AUTO] | An agent referral on a `pre_referenced_open` partner | **Unchanged.** No fee, no lock, no draft. The referral path does not have an application fee |

## H10. Tenant email codes

Six digits is only a million values, so the code is not the control. Four things
together are, and each has a row because each was found broken once.

| # | Setup | Expected |
| - | ----- | -------- |
| H10.1 [AUTO] | Register, then submit a wrong code | Refused. The attempt is counted |
| H10.2 [AUTO] | A code for an address that never registered | **The same message.** Wrong, expired, exhausted and never-issued are indistinguishable. **Verified live** |
| H10.3 [SEMI] | Submit the correct code | A one-time token is returned, **not a session**. The browser redeems it. **Verified live** |
| H10.4 [SEMI] | Submit the same correct code again | Dead. Single use. **Verified live** |
| H10.5 [AUTO] | **Eight concurrent** wrong guesses against one live code | All refused, and the correct code is dead afterwards. **Verified live.** This failed before `20260812240000`: the cap was decided on a stale read and degraded to the attacker's concurrency |
| H10.6 [AUTO] | **Eight concurrent** issues for one address | Five allowed, three refused. **Verified live.** This failed before `20260812240000` for the same reason |
| H10.7 [AUTO] | Two live codes for one address | Impossible. Issuing consumes the previous, under an advisory lock so it cannot be raced |
| H10.8 [AUTO] | `request_reset` with `origin: "https://evil.example"` | Normal response, **and no email is sent**. The link is built from `APP_URL`, never from the request. **Verified live** |
| H10.9 [AUTO] | An email address containing `%` or `_` | Matches only itself. `ilike` treated them as wildcards and matched other people's rows |
| H10.10 [AUTO] | Hammer `verify_code`, `register`, `resend`, `request_reset` | Throttled per address and per caller, and a refusal looks identical to the normal response |

H10.8 is the one to run first after any change to this file. Client-supplied
origin on a link that carries a token is account takeover with a phishing page
attached, and `send-password-reset` had already solved it before I undid it.

## H11. What a tenant is told about their own application

The status card is the answer to "have they got back to me yet", which is the
only question somebody has after submitting and the one the form could not
answer. `applications.status` is our vocabulary and not theirs: `sent` means a
payment link is out, and `paid` means the guarantee fee rather than the
application fee, so both are translated before a tenant sees them.

| # | Setup | Expected |
| - | ----- | -------- |
| H11.1 [AUTO] | Draft, three of seven sections done | "In progress", **3 of 7**, and it names the fee as what unlocks the rest |
| H11.2 [AUTO] | Draft, fee paid | Stops mentioning the fee. It has been paid; saying it again reads as unpaid |
| H11.3 [AUTO] | Everything done, not yet sent | "Ready to send" |
| H11.4 [AUTO] | Submitted | "With our referencing partner", and it says **they do not need to do anything** |
| H11.5 [AUTO] | Approved | "Approved", and the guarantee fee is offered |
| H11.6 [AUTO] | Declined | Terminal on the timeline, **never a success tick**, and **no request for money** |
| H11.7 [AUTO] | Any state other than approved | No payment button anywhere. Asking a declined tenant to pay is the worst version of this screen |
| H11.8 [AUTO] | Guarantee issued | Timeline complete |
| H11.9 [AUTO] | Lapsed or withdrawn | Terminal and explained, not a blank screen |
| H11.10 [AUTO] | Progress in three places | The status card counts sections, the page head shows the bar, the sidebar ticks each step. All three agree |

## H12. Walking the whole journey

The states after submission are driven by the referencing partner, Stripe and
PandaDoc, none of which exist in mock mode. Demo controls jump to them so the
journey can be walked end to end.

| # | Setup | Expected |
| - | ----- | -------- |
| H12.1 [HUMAN] | Mock mode, `/apply` | A dashed amber "Demo controls" strip. Unmistakably not product |
| H12.2 [AUTO] | Supabase mode, `/apply` | **No demo strip at all**, and `demoSetStatus` throws if called |
| H12.3 [AUTO] | Jump to any state after draft | The fee shows as paid too, so the timeline cannot contradict the headline |
| H12.4 [HUMAN] | Walk draft → submitted → approved → paid → issued | Each step changes the headline, the tone and the timeline position |

## H13. Sections, wording, and folding away

| # | Setup | Expected |
| - | ----- | -------- |
| H13.1 [AUTO] | Read every tenant-facing string | **Never "referencing".** A tenant is told "eligibility check". `referencing_mode`, the `referencing` status and the partner API contract keep their names: those are internal and partner vocabulary. Asserted by a test over every status |
| H13.2 [AUTO] | Any step in the form | Ends with **Save and continue to \<next section\>**, naming where it goes. Autosave is invisible and a section with nothing to press reads as unfinished |
| H13.3 [AUTO] | A step with something outstanding | The footer says what, and still lets them continue. Only the fee gates, and that gate is in SQL |
| H13.4 [AUTO] | The last step | No "continue"; the Send button is the ending |
| H13.5 [AUTO] | Submit, then look at the sidebar | The seven form steps are **gone**. Status, Documents, Payment and Your guarantee remain. Seven steps in front of somebody who has finished implies there is still something to do |
| H13.6 [AUTO] | Same, page head | No section counter. There are no sections left to count |
| H13.7 [AUTO] | "What you told us" | Collapsed by default, expands read-only. Somebody waiting does sometimes want to check what they said, and editing would change the basis of a decision in flight |
| H13.8 [AUTO] | Documents tab | Lists what has been uploaded, allows adding and removing, and shows eligibility reports as **held on file, not downloadable** |
| H13.9 [AUTO] | ID check and Financials | Real steps with a working manual path, and each names the vendor path that is not switched on. Neither is a "coming soon" panel |
| H13.10 [AUTO] | Upload on Financials | Recorded as `bank_statement` and appears on Documents too. One index, two ways in |

## H13a. The approved tenant can actually pay

The status card offers "Pay the guarantee fee" when approved. It sent them to
`/pay` with no token, which renders the invalid-link state: a dead end at the
one moment somebody is trying to give us money.

| # | Setup | Expected |
| - | ----- | -------- |
| H13a.1 [AUTO] | `guarantee_payment_link` on a **draft** application | `There is nothing to pay yet.` **Verified live.** Asking before approval is the failure worth guarding |
| H13a.2 [AUTO] | Same on an **approved** (`sent`) application | A `/pay?token=…` URL. **Verified live** |
| H13a.3 [AUTO] | Same with another tenant's application id | `Not found.` **Verified live** |
| H13a.4 [AUTO] | Follow the URL | The real payment page, loaded, not the invalid-link state |
| H13a.5 [AUTO] | Call it twice | The same token. `mint_payment_page_token` is idempotent, so a reload does not orphan the first |

There is still exactly **one** implementation of the guarantee payment. A signed-in
tenant reaches the existing tokenised page rather than a second Checkout flow
that would drift on reissue, decline and session expiry.

## H14. The tenant journey mounts

**Why this section exists: it shipped a white page.** `tsc` was clean, the build
was clean and 158 tests passed, because every one of them tested a pure
function. A `useState` had been declared below an `if (!bundle) return`, so it
did not run on the first render and did on the second, and React threw
"rendered more hooks than during the previous render".

Nothing in the suite mounted a component, so nothing could have caught it.

| # | Setup | Expected |
| - | ----- | -------- |
| H14.1 [AUTO] | Mount `<Apply/>` with a draft and let effects settle | Renders past the loading state. **The bug was on the second render**, once the bundle arrived, so getting there is the assertion |
| H14.2 [AUTO] | Mount it for `referencing`, `sent`, `declined`, `paid`, `deed` | Each renders. These are the states the form folds away in, and the fold is where the hook count changed |
| H14.3 [AUTO] | Mount signed out | The sign-in prompt, not a throw |
| H14.4 [AUTO] | Move any hook below an early return in `Apply.tsx` | **H14.1 and H14.2 fail.** Verified by reintroducing the bug on purpose: two files failed and the suite dropped from 162 tests to 107 |

H14.4 is the row that matters. A rule nobody can check is a rule that comes
back; there is no ESLint in this repo, so `react-hooks/rules-of-hooks` is not
watching, and this section is what replaces it.

---

## H15. The three doors on /login

**Why this section exists: the tab strip had no test of any kind.** Not the
tabs, not the `?tab=` seeding, not either panel. `smoke.test.tsx` requests
`/login` with no query string, so `audience` defaults to `agent` and the tenant
and supplier panels were never mounted by anything in the suite.

Two defects were living in that gap. The tenant tab rendered a button that sent
the browser to `/apply/signin` to type an email and a password, which is a page
load that buys nothing. And the supplier tab was a dead end saying sign-in was
not open, written when nobody had settled what a supplier was.

A supplier is a partner who sends us referrals. That is a commercial
distinction and not an authentication one, so the tab renders the same staff
form as Agent, and the rows below assert both halves: that each audience gets
the thing its tab exists for, and that the tenant is still not shown a staff
flow.

| # | Setup | Expected |
| - | ----- | -------- |
| H15.1 [AUTO] | Render `/login` | Three tabs: Tenant, Agent, Supplier. Agent is selected, because that is who has been signing in here for a year |
| H15.2 [AUTO] | Render `/login?tab=supplier` | The Supplier tab is selected. `?tab=` is a link somebody can be sent, not internal state |
| H15.3 [AUTO] | Visit `/login?tab=tenant` | **Redirected to `/apply/signin`.** The tab is gone; the portal serves partner staff. Old links and bookmarks still exist, and an `?invite=` token travels with the redirect |
| H15.4 [AUTO] | Render `/login` with no query | Agent, the only remaining default |
| H15.5 [AUTO] | Render `/login?tab=supplier` | A working staff form. **No "not open yet"** |
| H15.6 [AUTO] | Render `/login?tab=supplier` | The Credentials and Verify steps are present. A supplier is staff, so two-factor stays |
| H15.7 [AUTO] | Compare the supplier and agent subtitles | They differ. The tab changes the copy and nothing else, because the difference is commercial |
| H15.8 [AUTO] | Revert the supplier branch to `audience === 'agent'` | **H15.5, H15.6 and H15.7 fail.** Verified by reintroducing it: 3 failed, 185 passed |
| H15.9 [AUTO] | Revert the tenant panel to a Continue button | **H15.3 fails.** Verified by reintroducing it: 1 failed, 187 passed |

H15.8 and H15.9 are the rows that matter. The rest would pass against a screen
that had quietly lost a door.

Sign-in isolation is what makes H15.3 safe: tenant auth is a separate Supabase
client keyed on `opndoor.tenant.auth` (`src/tenant/tenantAuth.ts`), so a tenant
signing in at `/login` cannot disturb a staff session in the same browser.
`/apply/signin` still exists and is still linked from seven places, so this was
additive rather than a move.

---

## H16. No supplier name reaches the browser

**Why this section exists: the check was written down and never run, and it was
already failing.** The rule is that a partner never learns which CRM or mail
provider we use. The Reconciliation button already said "Sync CRM" and the
minifier strips every comment, so the source read clean. But an `rpc()` argument
is a string literal and survives minification:

    sb().rpc('trigger_hubspot_sync')

A function NAME is a leak like any other string. Separately,
`opndoor-admin-guide.html` named the CRM six times, and although the link to it
is gated to superadmin, the file is served from `public/` and anyone who guesses
the URL can read it. Gating a link is not gating a file.

| # | Setup | Expected |
| - | ----- | -------- |
| H16.1 [AUTO] | `npm run build`, then grep `dist/` case-insensitively for the banned list | **No match.** Run it; do not read the source and assume |
| H16.2 [AUTO] | Include static assets under `dist/help-docs/` in that grep | No match. A file in `public/` ships whether or not the UI links to it |
| H16.3 [AUTO] | Fetch `/help-docs/opndoor-admin-guide.html` directly | It loads, and names no supplier. The superadmin gate hides the link, not the file |
| H16.4 [AUTO] | `select to_regprocedure('public.trigger_hubspot_sync()')` | **Not null.** The rename was additive; the old entry point stays for the cron |
| H16.5 [AUTO] | As a non-admin, call `trigger_crm_sync()` | `42501 not permitted`. The new name inherits the old guard rather than relaxing it |
| H16.6 [AUTO] | Add any new `rpc('...')` call | Re-run H16.1. Every RPC name is public copy |

The banned list is at the built-artefact grep near the top of this document.
H16.6 is the row that keeps this from rotting: the leak was not a name somebody
typed into the UI, it was one nobody thought of as text.

---

## H17. Agent or supplier, and how deep the form goes

**The distinction is ownership of the stock the tenant moves into.** An agent
refers into a property it lets itself, so naming the agency is asking somebody
to name themselves. A supplier refers on behalf of agencies it does not let for,
so the agency is a real question with a different answer each time.

It is NOT "one agency versus many". A national group owns several brands and is
still an agent. So one fact is recorded, `partners.refers_own_stock`, and the
DEPTH of the form is counted rather than configured: a partner that buys a
second brand grows the extra step by itself on the next page load.

**Default false means every partner alive today is a supplier by construction
rather than by care.** Rightmove included. That is what makes this additive.

| # | Setup | Expected |
| - | ----- | -------- |
| H17.1 [AUTO] | `select refers_own_stock from partners` for every pre-existing partner | **All false.** Nobody was reclassified. Migration 20260814010000 raises if one was |
| H17.2 [AUTO] | Sign in as a supplier and open New application | Today's form, unchanged: Agent typeahead, create on the fly, single-office radio, contact block |
| H17.3 [AUTO] | A **supplier with exactly one agency** | **Still asks.** `collapse_agency` false. Its agency set is open, so next month there are two, and collapsing would file the referral against whichever came first |
| H17.4 [AUTO] | An agent with one brand and one branch | Asks nothing. One line naming the office, and a "A different branch?" link that reveals the branch field |
| H17.5 [AUTO] | An agent with one brand and several branches | Asks the branch only. No agency step |
| H17.6 [AUTO] | An agent with several brands | Asks brand, then branch. The group case |
| H17.7 [AUTO] | Any agent | **No "create new agent" option, and Enter does not create one.** A new brand is an acquisition and belongs to an admin, not to a referral form |
| H17.8 [AUTO] | An agent with **no branches set up** | A blocking line saying so. **It must not fall through to the supplier picker**, which is how somebody invents a misspelled duplicate of their own employer with money attached |
| H17.9 [AUTO] | `my_org_shape` when the RPC fails or returns no row | `FULL_PICKER`: asks for an agency, allows a new one. The fallback is the shape that loses nothing |
| H17.10 [AUTO] | A branch manager at one office of a twelve-office agent | Their form collapses even though the partner's does not. `my_org_shape` reads `user_scopes` |
| H17.11 [AUTO] | Add a second branch to a collapsed agent, reload the form | The branch step appears. Nothing was configured |
| H17.12 [AUTO] | Wording, any agent path | Never says "agency". Says brand, branch or office |

### What protects the referral path

| Claim | Proof |
| ----- | ----- |
| `applications` is untouched | No column, no status, no table added. H17 adds nothing to it |
| Both create paths cannot see the new column | `create_referral` and `create_referral_api` select explicit partner columns. 20260814010000 asserts the explicit list is still there and raises if a create path ever moves to `select *` |
| No RLS policy reads it | `refers_own_stock` is read by `my_org_shape` and the picker. Neither is on the referral write path |
| Every existing partner keeps today's form | H17.1 and H17.2. `default false` is the supplier shape, which is what the schema has always been |

**A migration applying cleanly is not evidence the function runs.** The first
version of `my_org_shape` built its working set with `create temporary table`
inside a `stable` function. Postgres checks volatility at execution, so
`db push` reported success and it would have raised "INSERT is not allowed in a
non-volatile function" the first time anybody opened the form. Fixed in
20260814040000. Call the function, do not read it.

### H17.13 to H17.18. The API: an agent may stop repeating its own name

The key already identifies the agency. `partner_api_resolve_org` already did
exactly this one level down (omit `branch_name` and a single branch is used), so
this is the same kindness one level up, gated on ownership.

| # | Setup | Expected |
| - | ----- | -------- |
| H17.13 [AUTO] | Supplier, `org: { branch_name }` with no agency | `agency_required`. Unchanged. Its set is open, so one agency so far is a fact about the past |
| H17.14 [AUTO] | Agent, one brand, `org: { branch_name }` | Resolves. The agency comes from the key |
| H17.15 [AUTO] | Agent, one brand and one branch, `org: {}` | Resolves both |
| H17.16 [AUTO] | Agent, one brand, several branches, `org: {}` | `branch_required`, **with the branch names in the message** so it can be fixed without a ticket |
| H17.17 [AUTO] | Agent, several brands, no agency named | `agency_required`, with the brand names |
| H17.18 [AUTO] | Anyone sending `agency_name` as today | Byte-identical behaviour. This is additive to input that used to be a hard error |

**The shortcut is only reachable for `pre_referenced_open`.** `createApplication`
dispatches on `referencing_mode` as its first act and returns 501 for
`opndoor_referenced`, before the org is resolved at all. Both original agent
fixtures were `opndoor_referenced`, so this was unreachable code until
`kestrel-lettings` was added. Do not relax that mode gate to reach it: B4.8 and
B4.9 exist to hold it.

**`min(uuid)` does not exist.** `partner_api_resolve_org` resolved "the only
one" with `min(a.id)` and `min(b.id)` in four places, so **every by-name org
resolution has always raised `42883` and only the by-id form ever worked.**
Fixed in 20260814070000 with `(array_agg(id))[1]`. It survived because the
failure is at execution and nothing in the suite called it with a name.

---

## H18. agency_groups was readable by anyone

**It shipped with RLS off.** 20260813010000 created the table, never enabled row
level security and never wrote a policy, which under Supabase's default grants
leaves SELECT held by `authenticated` **and `anon`**. The anon key ships in the
browser bundle, so the table was open to anybody at all.

What was exposed: every partner's group names, which is a client list, and
`partner_rate` / `agent_rate` at group level, which are the commercial terms of
somebody else's deal. The sibling table built in the same week,
`partner_agency_relationships`, got RLS for this exact reason and said so.

| # | Setup | Expected |
| - | ----- | -------- |
| H18.1 [AUTO] | `select relrowsecurity from pg_class where oid = 'public.agency_groups'::regclass` | true |
| H18.2 [AUTO] | `has_table_privilege('anon', 'public.agency_groups', 'select')` | **false** |
| H18.3 [AUTO] | As partner A, `select * from agency_groups` | Only partner A's rows |
| H18.4 [AUTO] | As an opndoor admin | Every row |
| H18.5 [AUTO] | At AAL1 | Nothing. The restrictive `require_aal2` ANDs with the permissive policy |
| H18.6 [AUTO] | Any insert, update or delete policy on the table | **None exists.** Groups are created through the security definer RPC only |
| H18.7 [AUTO] | Every other table added since 20260812 | Repeat H18.1 and H18.2 for each. This was not caught by review, it was caught by an adversarial pass on unrelated work |

H18.7 is the row that matters. A table created without `enable row level
security` is open, silently, and nothing in the build or the suite says so.

---

## H19. The sign-in page: one control, three audiences

### H19.1 to H19.3. The tabs must not move

`.auth__form-wrap` centres its child, so a taller pane grew in both directions
and the tab strip moved with it. Measured across the three audiences it shifted
**43px**, which means you click Agent and the thing you clicked is somewhere
else. Fixed by pinning `.auth__card` to a `min-height` sized to the tallest
pane, so the box is constant and only the content below the tabs differs.

| # | Setup | Expected |
| - | ----- | -------- |
| H19.1 [AUTO] | Click Tenant, Agent, Supplier in turn and watch the tab strip | It does not move. Nothing above the fold shifts |
| H19.2 [AUTO] | Same at a viewport under 760px tall | The min-height releases and the card scrolls. A reachable control beats a stationary one |
| H19.3 [AUTO] | Add a line to any pane | Re-check H19.1. The pin is a fixed number and a taller pane silently overflows it |
| H19.3a [AUTO] | Watch where each pane ENDS, not just where it starts | The last line sits on the same bottom edge for all three. Aligning the tabs alone left the panes finishing 44px apart, which is the same complaint one level down |
| H19.3b [AUTO] | Every audience | Exactly one `.auth__pane`, ending in an `.auth__foot` either directly or as the last child of an `.auth__pane-body`. **That chain is what the pin needs**, and if it breaks the footer drifts and nothing else says so |
| H19.3c [AUTO] | Remove the pane wrapper or the tenant step strip | **H19.3a and H19.3b fail.** Verified by reintroducing both: 5 failed, 208 passed |
| H19.3d [AUTO] | Switch tabs rapidly and watch the FIELDS, not the tabs | Nothing but the text changes position |
| H19.3e [AUTO] | The right pane | **Centred vertically.** Safe only because every variable-height block on the card is a stack, so the three tabs render at exactly the same height and there is no difference left to split |
| H19.3f [AUTO] | Both variable-height blocks | The heading and paragraph, AND the helper line under the button. Each is a grid stack: all three variants in one cell, inactive ones `visibility: hidden` and `aria-hidden`. **The helper line was the one that survived the first fix**: one line on Tenant, two on the others, and with the card centred that difference moved the tab pill at the top |
| H19.3g [AUTO] | `display: none` on a hidden variant | Wrong. It collapses the row to the visible one, which is the defect itself. `visibility: hidden` keeps the box |
| H19.3h [AUTO] | Any reserved height, on the card or the footer | **There must be none.** The stacks make the heights equal; reserving a height as well only moves the slack |
| H19.3i [AUTO] | `@media (max-width: 900px)` in `auth.css` | It must sit **after** `.auth__brand`. It used to be at the top of the file, above that rule's own `display: flex`, so `display: none` never applied and the brand panel rendered on mobile. Its headline is a different length per tab, which moved the form |
| H19.3j [AUTO] | The left column's position | `grid-template-rows: 1fr auto 1fr`, so the headline's centre is the container's centre and matches the card's. `space-between` looked the same and was not: it centred the headline in the gap between the wordmark and the flow cards, a different point, measured 399 against the card's 500 |
| H19.3m [AUTO] | The left column's copy | **Stacked PER LINE.** The headline is two lines for a tenant and an agent and three for a supplier, so a centred block put the eyebrow at 624, 624 and 591 |
| H19.3n [AUTO] | Stacking the left block as a whole instead | Not enough. It lines up the eyebrow and the heading and leaves the paragraph at 499, 499 and 551, because the supplier's own three-line headline pushes its own paragraph down inside its own variant. Each of the three lines needs its own cell |
| H19.3o [AUTO] | The spacing between those lines | On the CELL (`.auth__stack--h1`, `.auth__stack--copy`), not on the item. A margin on a grid item applies once per hidden variant and grid items do not collapse margins, so the gap would come out three times too big |
| H19.3p [AUTO] | The eyebrow | `justify-self: start`. An inline-flex pill in a grid cell stretches to the column width and drags its background with it |

### H19.3k. The measured proof

jsdom does no layout, so the alignment claim is checked in a real browser. With
the dev server running, from a scratch directory (`npm i playwright-core`):

```js
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
for (const width of [1440, 420]) {
  const page = await b.newPage({ viewport: { width, height: 1000 } });
  for (const tab of ['tenant', 'agent', 'supplier']) {
    await page.goto(`http://localhost:5173/login?tab=${tab}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.aud');
    console.log(width, tab, await page.evaluate(() => {
      const t = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().top + scrollY) : null; };
      const c = document.querySelector('.auth__card').getBoundingClientRect();
      const m = document.querySelector('.auth__brand-mid')?.getBoundingClientRect();
      return { pill: t('.aud'), label: t('.auth__pane-body .field label'),
               button: t('.auth__pane-body button[type=submit]'),
               cardH: Math.round(c.height), cardMid: Math.round(c.top + scrollY + c.height / 2),
               brandMid: m ? Math.round(m.top + scrollY + m.height / 2) : null };
    }));
  }
  await page.close();
}
await b.close();
```

**Every column identical across the three tabs**, which is the whole assertion.
The absolute numbers move when copy changes, and that is fine: what must hold is
that the three rows at a given width agree. The 1440 numbers dropped by 11 when
the supplier subtitle went from three lines to two, exactly as the stack should
behave.

| Width | Tab | Tab pill | First label | Button | Card height | Card centre | Headline centre |
| ----- | --- | -------- | ----------- | ------ | ----------- | ----------- | --------------- |
| 1440 | Tenant | 211 | 459 | 659 | 579 | 500 | 500 |
| 1440 | Agent | 211 | 459 | 659 | 579 | 500 | 500 |
| 1440 | Supplier | 211 | 459 | 659 | 579 | 500 | 500 |
| 420 | Tenant | 179 | 491 | 691 | 643 | 500 | n/a |
| 420 | Agent | 179 | 491 | 691 | 643 | 500 | n/a |
| 420 | Supplier | 179 | 491 | 691 | 643 | 500 | n/a |

Card height is identical per width, which is what makes centring safe. Headline
centre is n/a below 900px because the brand column is hidden there.

The left column, measured the same way at 1440 and 2000 wide. The brand column
is hidden below 900px, so there is nothing to measure there:

| Tab | Eyebrow | First heading line | First paragraph line |
| --- | ------- | ------------------ | -------------------- |
| Tenant | 340 | 375 | 549 |
| Agent | 340 | 375 | 549 |
| Supplier | 340 | 375 | 549 |

Three stacks in the left column and two on the card, five in all. Each renders
every variant and hides all but one, so ten hidden nodes per render. A test
counts them: if a stack is dropped the count changes and nothing else would say
so.

playwright-core is **not** a dependency of this repo. It is installed in a
scratch directory for the check and thrown away.

### H19.3l. Nothing renders outside the right pane

Reported: a "Sign in" control, a password eye and a "Forgot password?" link
appearing over the purple panel. Checked and **not reproducible in the page**:

| # | Setup | Expected |
| - | ----- | -------- |
| H19.3l.1 | Enumerate every `button`, `input` and `a` and compare its left edge to the brand column's right edge | **Zero** have a left edge inside the brand column, on all three tabs |
| H19.3l.2 | `document.elementFromPoint(230, 849)` at 2000px wide on Tenant | The flow card title, nothing interactive |
| H19.3l.3 | `.pw-input` | `position: relative`, so the absolutely positioned eye toggle is contained by its own field and cannot escape |
| H19.3l.4 | Absolutely positioned rules in `auth.css` and `Login.css` | One, `.auth__brand::before`, a decorative pseudo-element with no content |

The likely cause is browser or extension UI drawn over the page: the reported
screenshots show a filled address and password with the password-manager key in
the address bar, while a clean render has empty fields and no strays. Confirm by
reloading in a private window with extensions disabled. If it still appears
there, it is a real defect and this row is wrong.

### H19.4 to H19.6. The left panel is not agent copy for everyone

It was. Two of its three promises were false for a tenant, who refers nobody and
earns no commission, and the third was wrong about how they sign in.

| # | Setup | Expected |
| - | ----- | -------- |
| H19.4 [AUTO] | The step strip, both tabs | Present, 1 Credentials then 2 Verify. **Written when there were three tabs, and it applied to the tenant one too**: a tenant has two factors as well, the second arriving by email rather than from an app. That tab has since moved to `/apply/signin`, where the same two steps run without the indicator, which is H20.12 |
| H19.5 [AUTO] | Agent tab | "Agent sign in", their own branches, commission, two-factor |
| H19.6 [AUTO] | Supplier tab | "Supplier sign in", referring **on behalf of** the agencies they work with |

### H19.7 to H19.12. A tenant gets two-factor as well

A six-digit code by email, not an authenticator app. Staff enrol TOTP because
they sign in daily; a tenant signs in a handful of times and a lost phone would
lock them out of their own application.

**The password is checked on the SERVER and the session it produces is thrown
away.** If the browser were handed a session and then asked for a code, the code
would be decoration, because the session would already work. The only thing that
crosses the wire at step one is `{ ok: true }`.

| # | Setup | Expected |
| - | ----- | -------- |
| H19.7 [SEMI] | Tenant, correct password | A code step. **Not signed in.** No session in local storage under `opndoor.tenant.auth` |
| H19.8 [SEMI] | Tenant, wrong password | The same one message as an unknown address. This adds no oracle the single-step version did not have |
| H19.9 [SEMI] | Enter the code | Signed in, and landed by `afterSignIn`: an invite is claimed, otherwise a draft opens |
| H19.10 [SEMI] | Spend a **registration** code at sign in, or the reverse | Refused. The purpose is verified, not assumed, so one kind cannot be spent as the other |
| H19.11 [SEMI] | A sign-in code for an address that was never confirmed | It does not confirm the address. Only a `verify_email` code does |
| H19.12 [SEMI] | Eleven sign-in attempts on one address in an hour | Rate limited, and the refusal reads as the normal response |
| H19.13 [AUTO] | Revert the tenant panel to signing in on the password alone | **H19.7 fails.** Verified by reintroducing it: 3 failed, 205 passed |

H19.13 is the row that matters. H19.7 to H19.9 would all pass against a screen
that signed somebody in and then showed them a code box for decoration.

---

## H20. The portal login is for staff; tenants sign in at /apply/signin

**Checked before removing anything: both paths send the same six-digit email
code.** `/apply/signin` (`FrontDoor.tsx`) and the old `/login` Tenant tab both
called `tenantAuth.signInStart`, which posts to `tenant-auth`'s `signin_start`,
where the password is verified server side and the session it produces is
discarded. Both then redeemed it with `verifyCode(..., 'sign_in')`. Same
function, same purpose, same server path. The only difference was the step
indicator, which `/login` drew and `/apply/signin` did not, which is why it
looked like there was no verify step. Nothing stronger was deleted.

| # | Setup | Expected |
| - | ----- | -------- |
| H20.1 [SEMI] | `/apply/signin`, correct password | A six-digit code step. **Not signed in** until it is entered |
| H20.2 [AUTO] | `/login` | Two tabs, Agent and Supplier. No Tenant |
| H20.3 [AUTO] | `/login?tab=tenant` | Redirected to `/apply/signin`, `?invite=` preserved |
| H20.4 [AUTO] | Any tenant email: invite, reset, verification | Points at `/apply/*`, never at `/login`. It always did |
| H20.5 [AUTO] | Tenant sign-out | `/apply/signin`. Staff sign-out goes to `/login` |
| H20.6 [SEMI] | An opndoor admin or superadmin | Signs in at `/login` on the Agent or Supplier tab, the same form as a partner referrer. **There is no separate admin route.** Role is read from their `users` row after AAL2. Removing the Tenant tab does not touch this path: the tenant panel was a sibling branch that never entered the staff state machine |

### H20.7 to H20.11. The /apply/signin form

| # | Setup | Expected |
| - | ----- | -------- |
| H20.7 [AUTO] | "No account yet? Create one." | Styled as a link. `.ap-foot a` had no rule at all, so the primary action for a first-time applicant read as body text |
| H20.8 [AUTO] | Email and password | Stacked, full card width. `.ap-grid` is two columns, which is right for an application and wrong for a sign-in |
| H20.9 [AUTO] | The submit | Full-width pill, with "Forgot password?" right-aligned above it, matching the portal |
| H20.10 [AUTO] | The heading | 20px clear of the first field label, not flush on it |
| H20.11 [AUTO] | The browser tab | "Sign in \| opndoor guarantor application", not "Guarantee Referral Portal" on a page branded guarantor application |

Measured at 1440: heading y 324, first label 386, fields 386 and 469 at the same
x and the full 420 wide, forgot link flush to the card's right edge, button 420
wide. Footer link renders `rgb(181, 77, 224)` at weight 700.

**A name collision worth knowing about.** The spacing wrapper was first called
`.ap-body`, which already exists as the two-column application layout, and it
silently squeezed the sign-in card into a 232px column. It is `.ap-shell-body`.
Grep before naming a class in `Apply.css`.

### H20.12. Coverage moved with the flow

Removing the Tenant tab deleted **nine** tests, and three of them were the only
coverage of the six-digit sign-in code anywhere in the suite:

```
offers all three tabs
seeds the tab from the URL, so ?tab= is a link somebody can be sent
gives a tenant the form itself, not a button to another page
shows a tenant the same two steps as staff
never mentions an authenticator app to a tenant
does not promise a tenant commission or an authenticator app
asks for a code after the password, not straight in        <- the code flow
will not accept fewer than six digits                      <- the code flow
strips anything that is not a digit                        <- the code flow
```

Removing the tab was right. Removing coverage of a flow that still exists was
not, and it left `/apply/signin` with nothing testing it at all:
`Apply.render.test.tsx` mounts `Apply`, not `FrontDoor`, and no test anywhere
referenced `signInStart` or `verifyCode`.

`FrontDoor.render.test.tsx` is those three ported to the page the flow lives on,
plus the form fixes.

| # | Setup | Expected |
| - | ----- | -------- |
| H20.12 [AUTO] | Submit a correct password at `/apply/signin` | The code step. **Not signed in** |
| H20.13 [AUTO] | Five digits, then six | Confirm disabled, then enabled |
| H20.14 [AUTO] | Type `12ab34cd56` | The box reads `123456` |
| H20.15 [AUTO] | "Use a different email address" | Back to the password step |
| H20.16 [AUTO] | Revert `/apply/signin` to signing in on the password alone | **H20.12 to H20.15 fail.** Verified by reintroducing it: 4 failed, 227 passed |
| H20.17 [AUTO] | The two field labels | Tied to their controls by `htmlFor` and `id`. They were not: a screen reader announced an unlabelled box and clicking a label did nothing |

The server half, that the password is verified inside `tenant-auth` and the
session it produces is discarded, cannot be asserted from jsdom. That is H19.7,
and it stays a manual row.
