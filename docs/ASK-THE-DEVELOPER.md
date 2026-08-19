# What we need from the developer

**One list, in the order that unblocks the most.** Each item says what we cannot
build without it and what we will build the moment we have it, so it can be
prioritised rather than answered all at once.

Grounded in the two integration documents already supplied
(`UserIntegrationProcess.docx`, `IntegrationDoc.docx`), so these are gaps in
those documents rather than questions they already answer. Where we have
inferred something, it is stated as an inference so it can be corrected cheaply.

---

## 1. How does the eligibility decision reach us? — **blocks the most**

**The gap.** The documents show `CRMApi/save_all_tenant_data` going out on
tenant signature, and the response returning ids only:

```json
{ "UserID": "21957", "PropertyID": "1133", "LandlordID": "402",
  "TenantID": "1280", "IncomeIDs": { "136": "1333" }, "status": "SUCCESS" }
```

Nothing in either document says how the **pass or fail** comes back afterwards.

**What we cannot build.** Everything after the tenant presses send. We can move
an application to "eligibility check in progress" and no further: there is
nothing to move it to approved or declined.

**What we need, in order of preference:**

1. **A callback to us** — the URL shape you expect us to expose, the auth
   (the rail 4 inbound uses `Authorization: Basic base64(agency_secret_token)`,
   is this the same?), and a sample payload.
2. **Or an endpoint we poll** — the URL, the auth, and how often is acceptable.
3. **Or, if neither exists yet**, tell us and we will propose a contract for
   Lettings in a Box to implement.

**Also needed whichever it is:**

- **Which id correlates the decision to the application.** Our inference is
  `TenantID` from the sync response, since that is the only per-applicant handle
  we are given. Confirm, and tell us if we should be storing `UserID` or
  `PropertyID` too. We currently persist none of them and will add columns for
  whichever you name.
- **The full set of `overall_status` values.** We only know `"Pass with
  guarantor"` from the rail 4 payload. What are the others, exactly, including
  capitalisation?
- **Whether the per-category verdicts come back on this rail too.** The rail 4
  payload carries `applicant`, `identification`, `employment`, `residency`,
  `affordability`, `credit_check` and `review_credit_check`, each with a
  `_condition` and a `_note`. Do we get those, and what are the possible values
  of a `_condition`? A "pass with conditions" is a different product decision
  from a pass and we would rather know now.

---

## 2. Credentials and a sandbox

**What we cannot build.** Any of the outbound calls, and rail 4 inbound.

- `API_URL`, `API_EMAIL`, `API_PASSWORD`, `API_TOKEN` for Lettings in a Box.
- **Is there a sandbox or test tenancy?** Ours is a disposable project and we
  would rather not create test tenants in a live lettings system. If there is
  not, say so and we will agree a convention for test data instead.
- The `agency_secret_token` for the inbound.

**One question that changes the shape of the code:** is
`agency_secret_token` **per agency or one global secret?** Both are already
implemented on our side, so the answer costs you nothing and us nothing: a token
row with an agency number attached means the token identifies the agency, which
is the stronger form; without one, the agency comes from the payload. We just
need to know which to seed.

---

## 3. Does the provider assess affordability against the share or the full rent?

**Why it matters.** Joint tenancies. Opndoor guarantees 100% of the tenancy and
applicants hold varying percentages, so the group has to cover the whole rent
between them. Our test judges each applicant against their **own share**, which
is what lets one applicant carry another.

The `save_all_tenant_data` payload already carries `share_percentage` and
`share_amount`, which suggests they use it, but it is not stated anywhere.

**If they assess every applicant against the FULL rent instead**, a zero-share
applicant fails on their side and a joint tenancy can never form. That is a
product problem, not a code problem, and we would need to know before building
the rest of it.

**Related:** do they return an **affordability figure** (a maximum supportable
rent) or only a verdict? If only a verdict, we cannot compute a shortfall from
their answer at all.

---

## 4. Yoti and Kreditz

Our understanding, from the specification: **we call both directly, but
authenticated with credentials Lettings in a Box supply, so the structured
results land in their accounts and not ours.** Confirm that is right, because it
decides the architecture: it means we store only that a session completed and
must never put those results into the outbound sync.

**For Yoti:** credentials, the check id, and what we receive back to know a
session finished.

**For Kreditz:** credentials, the check id, and any required parameters. Plus
**the rule for which product applies** — VeriBank, VeriPay, or falling back to a
manual upload. The specification says the decision rule exists; it does not say
what it is.

**Not blocking.** The manual upload path is built and working, and is the
fallback the process document already describes. This upgrades it rather than
unblocking it.

---

## 5. Stripe

- **Which Stripe account and keys** should a non-production environment use?
- **Can a test-mode webhook endpoint be registered** against our disposable
  project? Nothing has ever reached it, so no card payment has ever been tested
  end to end.

**One thing that is ours, not yours, but you should know:** our applications are
created `livemode = true` and refuse a test-mode Stripe event by design. So even
with a webhook, a dev card payment is refused. We will settle that, but if you
have a convention for testing payments on the existing platform we would rather
copy it than invent one.

---

## 6. The existing platform's code

You have it and we have not seen it. Most useful, in order:

1. **The decision handler** on rails 1 and 2 — whatever receives or polls the
   result. This is item 1 and is worth more than everything else here combined.
2. **The `save_all_tenant_data` caller**, so we can compare our payload against
   one known to work rather than against a document.
3. **The `GuarantorApi/save_guarantor_user_data` receiver**, to check our
   inbound against yours on the details a sample payload does not show:
   retries, duplicates, and what you do with a status you do not recognise.

---

## 7. Two smaller ones

- **Does the provider retry the rail 4 inbound, and do they deduplicate?** We
  key idempotency on `table_id` and treat a repeat as a retry rather than a
  second tenant. If they send the same `table_id` for a genuinely different
  hand-over, that assumption is wrong.
- **What happens on their side if we never call back** with the policy document?
  Does the letting record sit as "guarantor required" indefinitely, and is there
  a timeout we should know about?

---

## What we do with each answer

| Answer | What gets built |
| ------ | --------------- |
| 1. Decision inbound | The second half of the tenant journey: approved, declined, guarantee fee, deed |
| 2. Credentials + sandbox | Rail 4 goes live; the outbound sync can be tested |
| 3. Share vs full rent | Joint tenancies, or a conversation about why they cannot work |
| 4. Yoti / Kreditz | The guided ID check and bank connection replace the manual uploads |
| 5. Stripe | Card payments testable end to end before go-live |
| 6. Their code | Confirms our payloads against something known to work |
| 7. Retries and timeouts | Hardens rail 4 against the failure modes a sample payload cannot show |
