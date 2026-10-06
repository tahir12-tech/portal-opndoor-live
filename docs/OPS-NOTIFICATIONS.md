# What the platform tells Opndoor

Read from the code on 2026-09-29 against `partner-api`. This is Q-04's first
half:

> First list every internal email and in-app notification the platform sends to
> Opndoor today (ops alerts by kind, awaiting decision, reconciliation items,
> deeds needing a staff send, new applications, payments, refunds, sync
> failures, security events and any others) and where each goes now, from the
> code.

---

## Where it all goes today: one address

Every internal alert takes the same path and lands in the same inbox.

```
  <anything>  ->  report_ops_incident(p_type, p_detail)
                    |  dedupes into public.ops_alerts on (type, hour bucket)
                    |  net.http_post to the ops-alert edge function
                    v
                  ops-alert/index.ts:34
                    OPS_ALERT_ADDRESS  ??  EMAIL_REVIEW_ADDRESS  ??  ""
                    |  and if neither is set: 500, and the alert is dropped
                    v
                  one email address
```

`ops-alert/index.ts:124` is the only send. There is no per-type routing, no
per-person routing, no group, and no floor: if the environment variable is
unset the alert is lost and the only trace is the `ops_alerts` row.

The hourly dedupe is in `report_ops_incident`: a second alert of the same kind
in the same hour inserts nothing and sends nothing. Worth knowing before
anything is built on top, because "did not arrive" and "was deduped" look the
same from the inbox.

---

## Every kind the platform raises

Twenty-four named kinds, plus five `cron_error:<function>` variants. Grouped
here as Q-04 asks; the grouping is my reading and is the thing most worth
correcting.

### Critical — a guarantee is at risk, or money or identity is wrong

| kind | raised at | what it means |
| --- | --- | --- |
| `deed_claim_failed` | `stripe-webhook` | payment taken, the deed could not be claimed for generation |
| `deed_void_failed` | `stripe-webhook` | a refund could not void the deed that was already issued |
| `deed_executed_after_refund` | `pandadoc-webhook` | a deed completed signing AFTER the fee was refunded |
| `deed_pdf_not_stored` | `pandadoc-webhook` | the executed PDF could not be archived |
| `deed_pdf_unavailable` | `pandadoc-webhook` | the executed PDF could not be fetched from the provider |
| `deed_sweep_all_failed` | `deed-sweep` | the whole sweep failed: nothing was reconciled |
| `stripe_livemode_mismatch` | `stripe-webhook` | a live event arrived against a sandbox row, or the reverse |
| `pandadoc_livemode_mismatch` | `pandadoc-webhook` | the same, on the deed provider |
| `stripe_refund_not_applied` | `stripe-webhook` | Stripe refunded and our row did not follow |
| `pandadoc_signature_rejected` | `pandadoc-webhook` | a webhook failed signature verification |

`pandadoc_signature_rejected` and the two livemode mismatches are the closest
thing the platform has to a SECURITY EVENT. Matt's list names security events
as a category; these three are what exists today.

### Operations — somebody has to do something

| kind | raised at | what it means |
| --- | --- | --- |
| `deed_awaiting_staff_send` | `pandadoc-webhook` | a deed is issued and needs a staff send |
| `deed_no_delivery_contact` | `_shared/pandadoc.ts` | the deed has nobody to go to |
| `deed_delivery_target_unreadable` | `pandadoc-webhook` | the recipient resolver errored |
| `expiry_reminder_unaddressed` | `expiry-reminders` | an expiry reminder reached nobody |
| `renewal_notice_unaddressed` | `renewal-notices` | a renewal notice reached nobody |
| `deed_sweep_failed` | `deed-sweep` | one application failed in the sweep |
| `deed_document_unattached` | `_shared/pandadoc.ts` | a generated document is not attached to its application |
| `deed_orphan_document` | `_shared/pandadoc.ts` | a provider document with no application |
| `deed_stamp_partial` | `_shared/pandadoc.ts` | the deed was stamped incompletely |
| `pandadoc_completed_unknown_document` | `pandadoc-webhook` | a completion for a document we do not know |
| `cron_error:<fn>` ×5 | `commission-statements`, `expiry-cohorts`, `expiry-reminders`, `payment-reminders`, `weekly-digest` | a scheduled job threw |
| `webhook_error` | `stripe-webhook`, `pandadoc-webhook` | an inbound webhook threw |

### Commercial

| kind | raised at | what it means |
| --- | --- | --- |
| `lapse` | `expiry-reminders` | a guarantee has lapsed |
| `renewal_notice` | `renewal-notices` | a renewal is due |

### Information

| kind | raised at | what it means |
| --- | --- | --- |
| `hubspot_map_drift` | `hubspot-sync` | the CRM mapping has drifted from the platform |

---

## What Matt's list names that DOES NOT EXIST as an internal notification

Stated plainly, because the settings page should not offer a switch for
something nothing sends:

| named in the instruction | status today |
| --- | --- |
| ops alerts by kind | exist, all 24 above, all to one address |
| deeds needing a staff send | exists: `deed_awaiting_staff_send` |
| sync failures | exists: `hubspot_map_drift`, and `cron_error:*` |
| refunds | partly: `stripe_refund_not_applied` fires only on FAILURE, not on every refund |
| security events | partly: signature rejection and the two livemode mismatches |
| **awaiting decision** | **nothing.** An application sitting at `referencing` raises no internal alert |
| **reconciliation items** | **nothing internal.** The reconciliation screen exists; it does not notify |
| **new applications** | **nothing.** No internal alert on a referral being created |
| **payments** | **nothing.** A successful payment raises no internal alert; only a failed refund does |

Four of those are a *build*, not a routing change, and they are a different
size of job from the settings page. The settings page is built for the types
that exist; the four missing ones are listed in QUEUE.md so the gap is a
decision rather than an omission.

---

## Other internal sends that are NOT ops alerts

| what | where | who |
| --- | --- | --- |
| Settlement summary | `commission-statements/index.ts:940` | Opndoor staff, resolved per reader |
| Weekly digest | `weekly-digest/index.ts:227` | per reader, includes Opndoor staff via `staff_notification_scopes` |
| Expiry cohort CSV | `expiry-cohorts/index.ts:231` | per reader |

These are already per-reader and scoped, so they are out of scope for a
routing table: routing them would mean overriding a scope that is already
correct. Named here so their absence from the settings page is deliberate.
