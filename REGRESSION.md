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

| # | Action, actor | status | payment_state | activity_log | Email | HubSpot | Tags |
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

| # | Action | status | payment_state | activity_log | HubSpot | Tags |
| - | ------ | ------ | ------------- | ------------ | ------- | ---- |
| A8.1 | `expire_stale_applications`, service role, invoked only from `payment-reminders` | `sent` → `expired` | **unchanged** `awaiting` | `expired` / business / "Application expired: guarantor fee unpaid 14 days after referral." | **nothing. `expired` is not mapped, so the CRM still shows Referred** | `[AUTO]` `[D-new]` |
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

Base path: `/functions/v1/partner-api/v1/`.

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
| B4.2 | Valid payload, org by name with contact email, `orgs:write` | `201`, `org.created: true`, org lands `pending_review` and appears in Reconciliation with `org_audit` rows |
| B4.3 | Org by name, no contact email | `422`, `org.agent_contact_email: required`, **and no partial agency created** |
| B4.4 | Org by name without `orgs:write` | `422`, `org.agency_name: insufficient_scope` |
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
| Email capture | Every email assertion needs a real inbox today | A catch-all inbox, or a Resend test key. **Do not** rely on the removed `EMAIL_REVIEW_ADDRESS` redirect; it is gone |
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
