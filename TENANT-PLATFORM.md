# The tenant platform

**Audience: a developer picking this up.** It replaces the existing tenant
system at `tenant.opndoor.co`. Read this before the code; it is the only place
the shape of the whole thing is written down.

`HANDOVER.md` is the estate. `REGRESSION.md` is the test plan. `PARTNER-API.md`
is the partner API's design record. This is the tenant journey's.

---

## 1. What exists, in one page

A tenant applies for an opndoor guarantee, pays a **£20 application fee**, is
checked for **eligibility** by a third party, and if approved pays the
**guarantee fee** (one month's rent) and receives a **Deed of Guarantee**.

Four ways an application arrives, two rails after intake:

| Rail | Arrives from | Who checks eligibility | Fees |
| ---- | ------------ | ---------------------- | ---- |
| 1 Direct | Tenant, from the website | We arrange it | £20 then the guarantee fee |
| 2 Agent referral | Agent, in the portal | We arrange it | £20 then the guarantee fee |
| 3 Partner API | Rightmove and similar | Already done by them | Guarantee fee only |
| 4 Provider hand-over | The referencing provider | Already done by them | Guarantee fee only |

Rails 1 and 2 are this document. Rail 3 is `PARTNER-API.md`. Rail 4 is section 7.

**Vocabulary.** A tenant is always told "eligibility check". The words
`referencing`, `referencing_mode` and `pre_referenced_open` are ours and the
partner's, they are in the partner API contract, and they never appear on a
tenant-facing surface. There is a test asserting this.

---

## 2. The journey, and the order it happens in

```
register  →  basic details  →  £20 fee  →  the rest of the form  →  sent
                                                                     ↓
                                          eligibility check (a few working days)
                                                                     ↓
                                      approved  →  guarantee fee  →  deed
                                      declined  →  ends
```

**The fee sits between the basics and the bulk of the form.** After the basics
because that is when somebody has committed enough to be worth charging, before
the bulk because the sections after it are locked until it clears, and there
because the eligibility check is what costs us. **Nothing is sent to the
provider until it clears**, and that is enforced in SQL, not in the browser:
`submit_application_for_referencing` refuses without it.

**Paying the fee is not the same event as being sent.** Paying records a payment
and changes no status. Submission moves `draft → referencing`. Conflating them
was a real bug (`20260812220000`): an application sat in "with the provider"
while the tenant still had three years of address history to type.

### States a tenant sees, and what they are underneath

| Tenant sees | `applications.status` | Notes |
| ----------- | --------------------- | ----- |
| In progress | `draft` | Form being filled. May be incomplete: see section 4 |
| Eligibility check in progress | `referencing` | Sent. Nothing needed from them |
| Not approved | `declined` | Terminal. Never shows a success tick, never asks for money |
| Approved | `sent` | Guarantee fee due. `sent` means "a payment link is out", which is why it is translated |
| Guarantee fee paid | `paid` | Deed being prepared |
| Your guarantee is in place | `deed` | Done |

`draft`, `referencing` and `declined` were added by `20260812050000`. The other
three are the referral path's own states, reused deliberately: once approved, a
rail 1 application is in exactly the state a referral is in at creation, so it
inherits the payment link, the chasers, the 15-day lapse and deed generation
with nothing new written.

---

## 3. Identity: a tenant is not a member of staff

**A tenant has no `public.users` row.** They are a row in `public.applicants`,
sharing `auth.users` with staff and sharing nothing else. Triggers on both
tables make being both impossible.

This is not tidiness, it is the entire security model:

- `app_role()` returns null, so every `app_role() in (...)` policy arm is false
- `app_partner()` returns null, so every `partner_id = app_partner()` arm is false
- `is_admin()` is false
- `is_aal2()` is false, and `require_aal2` is a **restrictive** policy on
  applications, so it ANDs with every permissive one and refuses regardless

**A tenant JWT sent to PostgREST reads nothing, on every table, for four
independent reasons.** Nothing was relaxed to make room for them. Verified live:
a signed-in tenant calling `/rest/v1/applications` gets `[]`.

Tenant data therefore comes from `tenant-portal`, a service-role Edge Function
that verifies the caller first. If you add a tenant-facing read, add it there
with an explicit column list. Do not add a tenant arm to an RLS policy.

**Sessions.** The browser uses a **separate Supabase client** with its own
`storageKey` (`src/tenant/tenantAuth.ts`). Sharing the staff client would put
the staff app into a permanent "could not load your profile" whenever a tenant
was signed in on the same machine.

**Verification is a six-digit code**, not a magic link, because a tenant
applying on a laptop reads email on a phone. Six digits is a million values, so
the code is not the control: a ten-minute life, a five-attempt cap, single use
and five issues an hour per address are. See `REGRESSION.md` H10.

---

## 4. The data model

| Table | Holds |
| ----- | ----- |
| `applicants` | Tenant identity. No RLS policies at all, by design |
| `application_profiles` | The single-answer part of the form, **per application** |
| `application_addresses` | Address history, `seq` 0 = current |
| `application_incomes` | One row per income source, main and additional |
| `application_documents` | The index of files. Bytes live in Storage |
| `application_eligibility_payments` | The £20. **Not** the guarantee fee |
| `application_delivery_contacts` | The agent a direct tenant named |
| `tenant_email_codes` | Verification codes, hashed |
| `tenant_invites` | The agent handoff link |
| `tenancies` | Joint tenancies. `applications.tenancy_id` is nullable |

**Per application, not per person.** A tenant who applies twice a year apart has
one identity and two sets of income, and an eligibility check is assessed
against the set submitted with it.

**A draft may be incomplete.** `tenant_title`, `tenant_dob` and `tenant_phone`
were NOT NULL, which is right for a referral typed in one sitting and fatal for
a tenant who has just registered. The requirement moved from *at insert* to
*past draft* (`20260812210000`). The referral path never enters draft, so
nothing about it changed.

**Every new column on `applications` needs its own grant.** The table grant was
revoked and re-granted per column (`20260811180000`), so a new column is
silently invisible to the client until `grant select (col) ... to authenticated`
runs. This has caught people out; `REGRESSION.md` F5.1 exists because of it.

---

## 5. Storage

Two private buckets, no `storage.objects` policies at all, every read a signed
URL with an explicit lifetime. Same posture as the existing `deeds` bucket.

| Bucket | Holds | Written by |
| ------ | ----- | ---------- |
| `applicant-docs` | Bank statements, P60s, proof of address, ID | The tenant, via a signed upload URL |
| `reference-reports` | Provider reports, arriving base64 in a webhook | The provider, via `referencing-inbound` |

Two rather than one because they have different owners and different retention,
and one rule for two categories means the stricter one applies by accident.

**No retention policy is set on either.** They will accumulate bank statements
and credit reports indefinitely. `HANDOVER.md` item 31.

---

## 6. The integrations, and exactly what each needs

### 6.1 Yoti (identity) and Kreditz (VeriBank / VeriPay) — NOT BUILT

**Read this before starting either.** The commercial position decides the
architecture, and it is unusual:

> Opndoor calls Yoti and Kreditz **directly, but authenticated with credentials
> supplied by the referencing provider**. The structured results land in the
> provider's accounts, not ours. We hold no contract with either vendor.

Three consequences, and the third is the one people get wrong:

1. **We store that a session completed, never its result.** The result is the
   provider's from the moment it exists.
2. **Their credentials live in our Edge Function config**, so rotation happens
   on their timetable and the adapter boundary has to be real.
3. **The results must not be added to the outbound sync.** The documented
   payload has `bank_statement_file` and no Kreditz or Yoti fields, and that is
   deliberate, not an omission.

**What is built:** the manual alternative, which the process document already
describes as the fallback. `IdCheckPanel` and `FinancialsPanel`
(`src/pages/Apply/Sections.tsx`) each take an upload today and each name the
vendor path that is not switched on. Neither is a "coming soon" panel.

**What you need before you can build the vendor path:**

| From | What |
| ---- | ---- |
| The provider | Yoti credentials and the check id |
| The provider | Kreditz credentials, check id and required parameters |
| The provider | Which product applies when: VeriBank, VeriPay, or manual |
| Opndoor | Whether a failed vendor session blocks submission or is advisory |

**Where it hooks in:** replace the upload button in each panel with a session
start, and record completion against the application. The document index is
already there for the manual path and both can coexist, which is the point.

### 6.2 The eligibility provider — INBOUND BUILT, DECISION NOT

**Rail 4 inbound is built and deployed**: `referencing-inbound` receives a
hand-over, verifies a hashed shared secret, claims `table_id` in a ledger before
doing any work, and stores the reports. **The callback is built**:
`referencing-callback` sends the policy document and payment status back.

**What is NOT built, and blocks rails 1 and 2 entirely:**

> **How does the pass or fail decision reach us on the rails where WE arrange
> the check?** The integration documents show the sync going out and only ids
> coming back. There is no documented inbound for the verdict.

Until that is answered, `draft → referencing` works and `referencing → sent` has
no trigger. Ask the provider for the callback contract. `HANDOVER.md` item 27.

**Two other named seams**, both in `HANDOVER.md`:

- **Item 25**: is `agency_secret_token` per agency or global? Both are already
  implemented, so this closes by inserting token rows rather than changing code.
  Every inbound event records `agency_from_token` so the answer can be read off
  production.
- **Item 26**: does the provider assess affordability against the applicant's
  **share** or the **full rent**? This decides whether joint tenancies work at
  all on rails 1 and 2.

### 6.3 Stripe — BOTH PAYMENTS BUILT

Two payments, and keeping them apart is the whole design:

| | £20 application fee | Guarantee fee |
| - | ------------------- | ------------- |
| Created by | `tenant-portal` `start_eligibility_payment` | `create-referral` / the `/pay` page |
| Metadata | `purpose: "eligibility"` | none |
| Recorded in | `application_eligibility_payments` | `payment_state` / `paid_at` on `applications` |
| Side effects | Unlocks the form. No deed | Deed generation, receipt email |

**`purpose` is read before `apply_stripe_payment`, and its ABSENCE means
guarantee fee.** That default is the safety property: every session created
before this shipped carries no purpose and must keep behaving exactly as it
does. Without the discriminator, a £20 payment sets status `paid` and **issues a
Deed of Guarantee**.

### 6.4 PandaDoc — BUILT, ONE SIGNER

**Only the tenant signs.** The legacy system routed a final signature to the
landlord or agent to create the policy document; that is dropped and is a no-op
here, because this repo has always had a single recipient with `role: "Tenant"`.

---

## 7. How to walk it, end to end

Two ways, and they answer different questions. Do both.

### 7.1 Mock mode: the whole journey, no credentials

```sh
npx vite --mode mock --port 5174
```

Then `http://localhost:5174/apply/register`.

Everything persists to `localStorage`, so closing the tab and returning resumes.
Registration signs you straight in and **any six digits** are accepted as the
code, because there is no mail here and the screen says so.

Walk: register → Property → About you → **£20 fee** (no money moves; it marks
paid so the rest unlocks) → Address history → Income → Nationality →
Declaration → Send.

Then use the **Demo controls** strip to walk what follows: *Submitted, awaiting
decision → Approved → Guarantee fee paid → Guarantee issued*, and *Declined* for
the unhappy path. Those states are driven by the provider, Stripe and PandaDoc
in production, none of which can fire locally, so the controls jump to them.
They are mock-only by construction: `demoSetStatus` **throws** against a real
database.

**What this proves:** every screen, the fold after submission, the lock before
the fee, autosave and resume, and the copy in every state.
**What it does not:** that the server agrees with any of it.

### 7.2 Real mode: everything except the card

```sh
npm run dev        # http://localhost:5173
```

| Account | Password | State |
| ------- | -------- | ----- |
| `walkthrough@opndoor.test` | `WalkThrough!2026` | Fresh, no application |
| `demo.tenant@opndoor.test` | `DemoTenant!2026` | Part-filled, fee recorded |

Both were created through the real front door and then confirmed by hand,
because **no mail provider is configured on dev** (`HANDOVER.md` item 37), so
verification codes are issued and never delivered.

**What is genuinely real here:** account creation, the code being issued and
checked with all four of its controls, the form, autosave against Postgres,
resume across a reload, the document uploads into Storage, and the submission
gate. Verified live.

**What cannot complete on dev, and why:**

1. **No Stripe webhook is registered against this project.** `stripe_events` is
   empty; nothing has ever arrived. `HANDOVER.md` item 6.
2. **Even with one, the payment would be refused.** `create_direct_application`
   sets `livemode = true`, the dev project holds a **test** Stripe key, and
   `refuseOnModeMismatch` (`stripe-webhook/index.ts:69-83`) is a hard equality
   with no non-production exemption. A test-mode event against a live-mode
   application is refused with a 500 and an ops alert. That is correct
   behaviour and it makes the dev project unable to complete a card payment for
   any non-sandbox application.

**To get past the fee on dev**, do what the webhook would have done:

```sql
select public.record_eligibility_payment(
  (select id from public.applications where guarantee_ref = 'GR-20604'),
  20, 'sim-' || gen_random_uuid()::text, null, true
);
```

The rest of the form then unlocks and submission works. To advance past
submission you need the decision inbound from section 6.2, which does not exist.

**To make the card payment itself testable**, someone needs to register a
test-mode Stripe webhook against this project **and** create the application
through a sandbox API key so it is `livemode = false`. That is a real gap in the
test estate rather than a bug, and it is worth closing before go-live.

---

## 8. What is verified, and how

`REGRESSION.md` sections F to H cover this work. Rows marked **Verified live**
were executed against the dev project, not reasoned about.

| Section | Covers |
| ------- | ------ |
| F | Shared ground with the referral path: state machine, payments, RLS, the applications table |
| G | Org sharing, and the rule that sharing an agency never shares a contact book |
| H1–H2 | The provider hand-over and its callback |
| H3 | Two payments never becoming one |
| H4 | Joint tenancies |
| H5 | The tenant journey's API, including that a tenant reads nothing from PostgREST |
| H6–H8 | The front door, the agent handoff, and drafts being allowed to be incomplete |
| H9 | The fee sitting between the basics and the rest |
| H10 | Email codes and their four controls |
| H11–H13 | Status, walking the lifecycle, wording, and the fold |
| H14 | **The journey mounts.** It shipped a white page once; nothing in the suite mounted a component |

**The standing constraint through all of it:** the Rightmove referral path does
not change. It never enters `draft`, has no application fee, no invite, no
applicant and no tenancy, and every guard added for the new rails is gated on
something it does not have.
