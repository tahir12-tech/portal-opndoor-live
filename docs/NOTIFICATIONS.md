# Who is told what

Read from the code, not from any earlier document. Every `sendMessage` call in
`supabase/functions` was enumerated and its recipient expression resolved back
to the thing that produces it, on 2026-09-29 against the `partner-api` branch.

This is Q-02 in `docs/QUEUE.md`. Its instruction:

> On the supplier rail (Rightmove via the API, Lettings in a Box inbound,
> Kestrel on dev), list every email and in-app notification sent today and who
> receives each, from the code, not the documents. Intended rule: the referrer
> and the branch's agent contact both receive the executed deed and every
> per-application notification, subject to item 2's settings; the tenant's own
> emails are unchanged. Where the referrer is an API partner with no human user
> attached, the agent contact still receives what item 2 allows.

---

## The three rails, because every row below depends on which one

| Rail | Partner | What `partner_id` means | Who the "company" is |
| --- | --- | --- | --- |
| AGENCY | `opndoor-agents` (house) | a ROUTE. Every agency Opndoor carries shares it. | the agency, identified by POSITIONS in `user_scopes` |
| SUPPLIER | one partner per company (`pre_referenced_open`) | a real company boundary | the partner |
| DIRECT | `opndoor-direct` (house) | a route | nobody: the tenant came on their own |

---

## BEFORE: every send, as the code stands

### Per-application, agent-facing — the rows Q-02 is about

| # | Notification | Where | AGENCY rail today | SUPPLIER rail today | DIRECT rail today |
| --- | --- | --- | --- | --- | --- |
| 1 | **Executed deed** to the agent | `_shared/deedEmail.ts:133` via `deed_delivery_target` | the whole ladder: the referrer plus every user ticked "Receives notifications" whose position covers it, as ONE send with each a recipient | **the branch agent contact ALONE.** `coalesce(delivery contact, effective_primary_contact_route, effective_primary_contact)`. The referrer is not on it. | the tenant's own nominated contact only; never the agency its branch was matched to |
| 2 | Executed deed to the landlord | `_shared/deedEmail.ts:188` | one nominated recipient | one nominated recipient | one nominated recipient |
| 3 | **Submitted for referencing** | `_shared/referrerNotify.ts:44` | the referrer alone | **the referrer alone** | n/a (no referrer) |
| 4 | **Approved** | same | the referrer alone | **the referrer alone** | n/a |
| 5 | **Declined** | same | the referrer alone | **the referrer alone** | n/a |
| 6 | **Fee paid** | same | the referrer alone | **the referrer alone** | n/a |
| 7 | **Expiry reminder** (30/14/7) | `expiry-reminders/index.ts:223` | `agency_notification_recipients`, i.e. the ladder; parks with an ops alert if nobody is on it | **the referrer plus that partner's active management.** Not the agent contact. | as supplier |
| 8 | **Renewal notice** | `renewal-notices/index.ts:157` | tenant + the ladder | **tenant + `contact_email` + `referrer_email`**, one send each, not one send to all | tenant + contact |
| 9 | Tenancy start correction | `tenancy-correction` | ops + the ladder | ops + partner management | ops |

### Per-application, tenant-facing — unchanged by Q-02, listed so the list is complete

| Notification | Where | Recipient |
| --- | --- | --- |
| Tenant invite | `create-referral/index.ts:249` | the tenant |
| Payment link | `create-referral/index.ts:361`, `resend-payment-email:147` | the tenant |
| Payment reminder | `payment-reminders/index.ts:192` | the tenant |
| Payment receipt | `_shared/paymentReceiptEmail.ts:10` | the tenant |
| Refund | `_shared/refundEmail.ts:6` | the tenant |
| Executed deed | `_shared/executedDeedEmail.ts:21` | the tenant |
| Signing link | `_shared/pandadoc.ts:333` | the tenant |
| Submission received | `tenant-portal/index.ts:696` | the tenant |
| Direct approval | `approve-application/index.ts:119` | the tenant |
| Sign-in code, account exists, password reset | `tenant-auth` ×3 | the tenant |

### Not per-application — out of scope for the matrix, listed for completeness

| Notification | Where | Recipient |
| --- | --- | --- |
| Weekly digest | `weekly-digest/index.ts:227` | per reader, routed; each digest contains only what that reader may see |
| Expiry cohort CSV | `expiry-cohorts/index.ts:231` | per reader, routed |
| Commission statement | `commission-statements/index.ts:905` | `commission_statement_recipients`: Directors ticked for statements |
| Settlement summary | `commission-statements/index.ts:940` | Opndoor staff |
| Staff invite | `invite-user/index.ts:362` | the invitee |
| Password reset | `send-password-reset/index.ts:99` | the account holder |
| Ops alert | `ops-alert/index.ts:124` | Opndoor's ops address |

---

## What the BEFORE table shows

Three gaps against the intended rule, all on the supplier rail:

1. **The executed deed does not reach the referrer** (row 1). It goes to the
   branch agent contact and stops. On the agency rail this was fixed in
   `20261006450000`; the supplier rail was deliberately left singular at the
   time, and Q-02 now says it should be both.

2. **The four lifecycle notifications do not reach the agent contact**
   (rows 3-6). They go to the referrer and stop, so a supplier whose referrals
   are made by an API key with no human user attached is told nothing at all --
   which is exactly the case Q-02's last sentence names.

3. **The expiry reminder reaches the wrong second party** (row 7). It adds that
   partner's management rather than the branch's agent contact, so it is both
   wider than the rule in one direction (every manager on the partner) and
   narrower in another (not the contact the branch actually uses).

Row 8 has a fourth, smaller problem: the renewal notice loops and sends one
email per recipient rather than one send with each as a recipient, which is the
shape every other notification uses and the shape Matt specified for the deed.

---

## AFTER: the intended rule

Per-application, agent-facing, on every rail: **the referrer AND the branch's
agent contact**, as ONE send with each as a recipient, subject to the matrix in
Q-03. Tenant emails unchanged. Where the referrer is an API partner with no
human user attached, the agent contact still receives whatever the matrix
allows -- so the notification is not lost for want of a person.

| # | Notification | AGENCY rail after | SUPPLIER rail after | DIRECT rail after |
| --- | --- | --- | --- | --- |
| 1 | Executed deed | ladder (unchanged) | **referrer + agent contact** | unchanged: the tenant's nominated contact |
| 3-6 | Submitted / approved / declined / paid | ladder | **referrer + agent contact** | n/a |
| 7 | Expiry reminder | ladder (unchanged) | **referrer + agent contact** | unchanged |
| 8 | Renewal notice | ladder, as one send | **referrer + agent contact, as one send** | unchanged |

The defaults that make this concrete are Q-03's, and they are not "everything
to everybody": on a supplier, everything is on for the referrer and **only
deed-issued is on for the agent contact**. So row 1 changes for every supplier
immediately, and rows 3-8 change only where somebody turns them on. That is
the point of doing Q-02 and Q-03 as one design rather than two.

**Locked, not switchable** (shown in the UI with the reason): delivery of the
executed deed to its recipient, every email to the tenant, and ops alerts.

---

## Status

The BEFORE table is complete and is the deliverable for Q-02's first half. The
AFTER table is implemented together with Q-03's settings matrix, because
"subject to item 2's settings" means the two cannot be built separately: a
change to who receives what, with no matrix to govern it, would be a change
nobody could turn off.
