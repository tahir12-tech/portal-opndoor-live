# Who is told what, on the agency rail

Every email and in-app notification that concerns a single referral, who
received it before, and who receives it now.

**The rule.** On an agency referral the person who sent it always receives the
executed deed and every per-application notification. Nobody else does by
default. Anyone ticked for notifications is copied on every referral within the
position they already hold: a branch-positioned user for their branch, an
agency-positioned user for every branch in the agency, a group-positioned user
for the whole group. The scope is the position, never a second setting.

**Who is not affected.** Tenant emails, landlord emails and Opndoor's own ops
alerts are unchanged. The supplier rail and the direct rail are unchanged. The
monthly commission statement is unchanged: it has its own recipient rule
(`commission_statement_recipients`) and its own tickbox, set by Opndoor.

**There is no in-app notification system.** No notifications table, no
per-recipient rows, no server-side read state. "In-app" means the topbar bell
and the Activity feed, both of which are plain reads over `activity_log`
filtered by RLS, plus per-browser unread state in `localStorage`. So a ticked
user's in-app view is decided by `applications_select`, not by the tick, and
tightening that policy (20261006170000) is what changes it.

---

## Per-application, to agency staff

| Notification | Before | After |
|---|---|---|
| Application sent for referencing | the referrer only (`notifyReferrer`, one address, no status filter) | the referrer, plus ticked users in scope. A deactivated referrer is no longer emailed. |
| Approved | the referrer only | same rule |
| Declined | the referrer only | same rule |
| Guarantee fee paid | the referrer only | same rule |
| **Executed deed, automatic** | **`deed_delivery_target` — the BRANCH ladder: nominated recipient, else branch, else agency, else group scope, `order by pri, email limit 1`. On dev this sent Tom Reeve's two referrals to Rosa Vance.** | **the referrer, plus ticked users in scope. Fallback when the referrer has gone: ticked users, then an active manager covering the branch, then park and raise an ops alert.** |
| **Executed deed, manual Resend** | **`deed_people_target` assembled separately in `send_deed_to_agent` — a second implementation that had drifted. Tom's own Resend went to Rosa.** | **asks `deed_delivery_target`, the same function the webhook asks, so the button and the automatic send cannot answer differently.** |
| Expiry reminder (30 / 14 / 7 days) | the referrer **plus every management user on the partner**, no status filter — on the house route, every other agency's Directors and Managers | the referrer, plus ticked users in scope. Also: **it had not been firing at all** (see below). |
| Renewal notice | tenant + the `agent_contacts` mailbox (or landlord email) + the referrer | unchanged in this batch. Flagged: its staff arm is the mailbox chain, not the new rule. |
| Tenancy start correction | no email of its own | unchanged |
| Application lapsed at 15 days | no email; an `activity_log` row only | unchanged |
| Withdrawal | no email; an `activity_log` row only | unchanged |

## Scheduled, to agency staff

| Notification | Before | After |
|---|---|---|
| **Weekly digest** | recipients `users where role='management'` bucketed by `partner_id` — no status, position or agency filter. Content from `partner_weekly_digest`, grouped by partner. On dev every reader was told **"24 sent, 15 paid, £23,038.46"**, which is four competing agencies added together. | one email per reader, recipients and content from the reader's own position via `staff_notification_scopes` + `agency_weekly_digest`. Rosa and Nadia now see Regent's own 7 / 5 / £6,738.46; Dara, group-positioned over Meridian, sees Northgate + Southbank. Active users only. |
| **Expiring-guarantees cohort CSV** | same recipient bucket, and a CSV whose columns are Tenant name, Property address, Agency, Branch, Tenancy start, Monthly rent, Referrer — one agency's tenants to its competitors, monthly | one CSV per reader, rows filtered to the agencies that reader covers. Active users only. |
| Climber of the week (inside the digest) | `partner_weekly_climbers` ranks referrers within a PARTNER, so Regent's negotiators were ranked against Northgate's and the winner named to both | **withdrawn from the email.** There is no agency-level twin yet, and naming a competitor's staff member is worse than naming nobody. |
| Monthly commission statement | `commission_statement_recipients` + the `receives_commission_statements` tick | unchanged |

## Unchanged, and deliberately so

**To the tenant:** invite to apply, payment link, payment resend, payment
reminder, submission received, approval, deed-to-sign (PandaDoc), payment
receipt, executed deed, refund, sign-in code, password reset.

**To the landlord:** the executed deed with the sender's covering note.

**To Opndoor:** ops alerts, the consolidated monthly settlement summary, and the
internal-only `activity_log` diagnostics.

**Supplier rail:** partner webhooks and the mailbox chain
(`effective_primary_contact_route`, then `effective_primary_contact`).
`agency_notification_recipients` answers for the agency rail only, by
`application_channel`, and returns nothing for any other rail.

**Direct rail:** the contact the tenant named
(`application_delivery_contacts`). This is a change in behaviour but not in
intent: `application_is_agent_estate` reads the route partner's
`referencing_mode`, and `opndoor-direct` is itself seeded
`'opndoor_referenced'`, so the people ladder used to run on direct applications
and beat the tenant's own contact. Measured on dev: a direct tenant whose
`branch_id` had been pointed at Regent's Park by the agency auto-match would
have had their executed deed sent to Rosa. It now reaches the tenant's contact.

---

## Two faults found while cataloguing this

**Expiry reminders have never fired.** `fire_expiry_reminders` reads and writes
`expiry_reminders.bucket`; the table is `(application_id, threshold,
days_at_send, sent_at)` and no migration ever adds a `bucket`. It did not throw
because the statements sit inside the loop body and plpgsql does not plan a
statement until it runs it, so a month with nothing expiring is silent. The same
rewrite also dropped the `expiry_reminder` activity row (which is what the bell
and the Activity feed read) and the `expiry_reminders_sent` bump. All three
restored in 20261006180000 and proved on dev.

**A deactivated referrer is still emailed today.** `notifyReferrer` reads the
referrer's address with no status filter, while the deed path filters
`status = 'active'` on every rung. The four referrer lifecycle emails had no
fallback at all. `agency_notification_recipients` filters on active and has the
fallback chain.
