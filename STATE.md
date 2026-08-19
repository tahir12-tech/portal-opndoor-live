# Where we are

**One file. Read this to know the state of everything; follow the links for why.**
Kept current as work happens, not written up afterwards.

Last updated **2026-08-19**.

---

## The shape, in one paragraph

Opndoor guarantees rent for tenants who fail referencing. Applications arrive
four ways: a tenant direct, an agent referring in the portal, a partner pushing
through the API, and a referencing provider handing over. Rails 1 and 2 we check
eligibility ourselves; rails 3 and 4 arrive already checked. There are two fee
points: a **£20 application fee** on rails 1 and 2, and the **guarantee fee**
(one month's rent) on all four. Only the tenant signs.

---

## Works, and verified against a real database

| | Verified |
| - | -------- |
| **The referral path** (rail 3, Rightmove): sent → paid → deed, payment link, chasers, 15-day lapse, deed issue, executed-deed delivery | REGRESSION A, and F proves the new work has not moved it |
| **Partner API v1**: key auth, scopes, idempotency, rate limits, error contract, outbound webhooks with retries and dead-lettering | REGRESSION B |
| **Sandbox as a mode**: `opnd_test_` vs `opnd_live_`, per-mode credentials, sandbox invisible outside the Dev Centre | REGRESSION B, F |
| **Dev Centre**: monitoring, redacted logs, webhook replay, test events, docs, OpenAPI 3.1 | REGRESSION E |
| **Route attribution**: `partner_id` means the route an application arrived by, not who owns the agency | F4, verified live |
| **Org sharing**: one agency reachable by several partners; **sharing an agency never shares a contact book** | G, 11 checks live |
| **Tenant identity**: applicants are not staff, and a tenant JWT reads nothing from PostgREST | H5, verified live |
| **Tenant journey**: register, six-digit code, the whole form, autosave and resume, uploads, the submission gate | H5–H10, verified live |
| **Email codes**: 10-minute life, 5 attempts, single use, 5 issues an hour, all four proven under concurrency | H10, verified live |
| **Eligibility criteria** in SQL, one implementation for the prequalification and the screened rail | Verified live, 9 rules |
| **Groups and positions**: a group above the agency, rate resolution, scope expansion | Verified live, 9 checks |

## Half built

| What | State | Where |
| ---- | ----- | ----- |
| **Rail 4 (provider hand-over)** | Receiver and callback built and deployed; **no token seeded and no credentials**, so nothing can arrive | `TENANT-PLATFORM.md` 6.2 |
| **Joint tenancies** | Schema, group test and one-deed-per-tenancy built. The group test cannot be trusted until we know whether the provider assesses against the share or the full rent | HANDOVER 26 |
| **Positions** | Model, helpers and all three policies done. **No UI to set one**, so nobody holds a position yet | This file, below |
| **Agent referral form** | Postcode lookup, validation and the tenant handoff exist. **Middle name and share are in the schema, not yet on the form** | Next |
| **Tenant journey's later tabs** | Documents fully live. ID check and Financials have a working manual upload; the vendor path needs credentials | `TENANT-PLATFORM.md` 6.1 |
| **HubSpot** | Syncs applicants and companies, cursor now per partner. **One pipeline, `channel` hardcoded to "Partner Referral"** | HANDOVER, HubSpot items |

## Specified, not built

| What | Where it is specified |
| ---- | --------------------- |
| The eligibility **decision inbound** on rails 1 and 2 | Nowhere. **This is the gap** |
| Provider masking, `reference_provider_events`, the adapter boundary | `PARTNER-API.md` §15 |
| `pre_referenced_screened` acceptance at the API | Criteria now exist in SQL; the 501 branch is still there |
| Supplier sign-in | Tab exists and says it is not open. No role, no table |
| Agent referrals in the admin view and their own HubSpot pipeline | Agreed, not built |

## Waiting on whom

| On | What | Blocks |
| -- | ---- | ------ |
| **The developer** | **How the pass/fail decision reaches us on rails 1 and 2** | The entire second half of the tenant journey |
| The developer | LIB base URL, credentials, sandbox, `agency_secret_token` shape | Rail 4 |
| The provider | Affordability against the share or the full rent | Joint tenancies |
| The provider | Yoti and Kreditz credentials and check ids | Guided ID check, bank connection |
| **Matt** | Whether a group's brands can be on different commercial terms | **Answered: yes, rate sits at the agency** |
| Matt | What a "supplier" is in our model | The third sign-in tab |
| Ops | `APP_URL`, a mail provider, a Stripe test webhook, an address-lookup key | Reset links, tenant codes, card payments, address lookup |

Chase email drafted; asks are in `docs/ASK-THE-DEVELOPER.md`.

---

## Known traps

Things that have cost time once and will again.

- **Nothing is pushed.** The branch is 130-odd commits ahead of `origin/main`,
  which has 65 migrations ending 5 July and no partner API at all.
- **`npm test` does not exist.** It is `npm run smoke`. 167 tests.
- **`tsc -p tsconfig.json` checks nothing** (`"files": []`). Use `tsconfig.app.json`.
- **A new column on `applications` needs its own `grant select`** or it is
  silently invisible to the client.
- **A hook below an early return is a white page.** There is no ESLint here, so
  `react-hooks/rules-of-hooks` is not watching. REGRESSION H14 catches it.
- **The dev project cannot complete a card payment.** Applications are
  `livemode = true`, dev holds a test key, and the mismatch guard has no
  non-production exemption.
- **Deploy `hubspot-sync` with the migrations**, not after: `20260812030000`
  drops the signature the deployed one calls.

## The documents

| File | What it is |
| ---- | ---------- |
| `START-HERE.md` | The entry point for somebody new |
| `STATE.md` | This file: where we are |
| `BUILD-LOG.md` | What was built, in order, and what was retracted |
| `HANDOVER.md` | The estate and its open items |
| `TENANT-PLATFORM.md` | The tenant journey's design record |
| `TENANT-PLATFORM-SETUP.md` | The runbook for standing it up |
| `PARTNER-API.md` / `PARTNER-DOCS.md` | Internal design record / what partners are given |
| `REGRESSION.md` | The test plan, sections A to H |
| `DEFECTS.md` | 19 defects, 15 fixed here |
| `docs/ASK-THE-DEVELOPER.md` | The outstanding questions |
