# Partner API and webhooks

Partners POST an application from their own system instead of typing it into the
portal, and receive webhooks as its status changes. Rightmove first, others
after.

Every claim about **existing** behaviour below carries a file and line
reference. Everything else is proposed and open to challenge.

## Build status

Part of this is built and running on the dev project. The rest is specification.
Each section says which it is, and this table is the summary.

| Area | Status |
| ---- | ------ |
| Authentication, keys, scopes (§4) | **Built** |
| `GET /orgs` (§7.5) | **Built** |
| `POST /applications` (§6) | **Built** for `pre_referenced_open` |
| `GET /applications/{id}` and list (§5) | **Built** |
| Idempotency (§11) | **Built** |
| Rate limiting (§12) | **Built**, two tiers |
| Error contract (§14) | **Built** |
| Outbound webhooks (§13) | **Built**: registry, queue, dispatcher, HMAC signing, endpoint CRUD |
| `referencing_mode` (§3) | Column **built**. Only `pre_referenced_open` is implemented; the other two return `501` |
| Acceptance criteria (§3.3) | Not specified. The rules do not exist yet, see open question 2 |
| Provider masking (§15) | Specified, not built. Needed only by `opndoor_referenced` |

Everything built is deployed to the dev project and exercised end to end. Test
expectations are in `REGRESSION.md` section B.

**Not built, and worth knowing before a partner integrates:** the dispatcher has
no schedule (deliberately, see §13.6), key issuance is manual (§4.8), and there
is no API version segment (open question 11).

Where the implementation taught us something the specification had wrong, the
specification has been corrected and the correction is called out rather than
quietly applied.

---

## 1. The governing requirement

An application created through this API must appear in the portal **exactly** as
a manually entered one does. Same table, same lifecycle, same activity feed,
same exports, same league table, same deed path.

This is achievable today because there is no column recording how an application
was created. The complete column set of `public.applications` contains no
`source`, `channel`, `created_via` or equivalent
([core_schema.sql:107-139](supabase/migrations/20260702134239_core_schema.sql#L107)).
Provenance is therefore recorded **off the application row**, in the API request
log described in section 11, so nothing downstream can accidentally branch on it.

---

## 2. What already exists, and what that forces

The portal is already multi-tenant on `partner_id`. This is the single most
important existing fact for this design.

`public.partners` exists
([core_schema.sql:37](supabase/migrations/20260702134239_core_schema.sql#L37))
with `id`, `slug`, `name`, `status`, `live_from`, `partner_rate`, `agent_rate`,
`is_primary`. Every relevant table carries `partner_id`: `users`
([:54](supabase/migrations/20260702134239_core_schema.sql#L54)), `agencies`
([:66](supabase/migrations/20260702134239_core_schema.sql#L66)), `branches`
([:78](supabase/migrations/20260702134239_core_schema.sql#L78)),
`agent_contacts` ([:91](supabase/migrations/20260702134239_core_schema.sql#L91))
and `applications`
([:110](supabase/migrations/20260702134239_core_schema.sql#L110)).

Better still, `partner_id` is already **derived rather than supplied**. Triggers
`sync_branch_partner`, `sync_contact_partner` and `sync_application_partner`
overwrite it from the parent record on insert
([core_schema.sql:146-171](supabase/migrations/20260702134239_core_schema.sql#L146)).
The rule "every write derives partner_id from the key, never from the payload"
is therefore consistent with how the database already behaves, not a new idea
imposed on it.

### 2.1 The create path cannot be reused as-is

`create_referral` is the RPC the portal form calls. Its current definition
([20260705140347_snapshot_referrer_name.sql:16-79](supabase/migrations/20260705140347_snapshot_referrer_name.sql#L16))
blocks machine callers in two independent ways:

| Line | Code | Why it blocks an API key |
| ---- | ---- | ------------------------ |
| [:21](supabase/migrations/20260705140347_snapshot_referrer_name.sql#L21) | `if not public.is_aal2() then raise exception 'MFA required'` | An API key request has no session and no MFA assurance level. |
| [:70](supabase/migrations/20260705140347_snapshot_referrer_name.sql#L70) | `referrer_id` is `auth.uid()` | There is no `auth.uid()` on an API key request. |
| [:71](supabase/migrations/20260705140347_snapshot_referrer_name.sql#L71) | `referrer_name` is `(select full_name from public.users where id = auth.uid())` | Same. |
| [:60](supabase/migrations/20260705140347_snapshot_referrer_name.sql#L60) | `pid = public.app_partner()` | `app_partner()` reads the JWT claim. |

**Consequence, now built.** `create_referral_api(p_partner, p_referrer, ...)`
takes the partner and referrer explicitly and omits the AAL2 gate, because the
API key is the authentication. Same for `create_referral_target_api`, which the
on-the-fly org path needs for the same three reasons.

Validation is **shared, not copied**, which was the point. The rules live in
`public.referral_field_errors` and both entry points are built on it:
`assert_referral_valid` reconstructs `create_referral`'s exact legacy prose from
them, and the API reads the structured codes. Two copies of fifteen rules would
have drifted, and the portal would have started accepting what the API rejects.

Verified rather than assumed: every legacy message and SQLSTATE is byte-identical
to the pre-refactor definition.

### 2.2 What does not exist at all

Confirmed absent, each by exhaustive search:

- **No API key, token or partner-credential table.** No `api_keys`, no
  `integrations`, no bearer-token path into any function.
- **No idempotency on the create path.** `applications` has no unique constraint
  beyond `guarantee_ref`
  ([core_schema.sql:109](supabase/migrations/20260702134239_core_schema.sql#L109)).
  A repeated submit creates a second application, a second Stripe Checkout
  Session and a second tenant email. The only guard today is a client-side
  advisory duplicate scan the user can override.
- **No outbound webhook infrastructure of any kind.** No endpoint registry, no
  delivery queue, no retry, no signing.
- **No constant-time comparison anywhere.** Every secret and signature check in
  the repo is JavaScript `===`, including the PandaDoc HMAC
  ([_shared/pandadoc.ts:392](supabase/functions/_shared/pandadoc.ts#L392)) and
  the ops secret checks
  ([hubspot-sync/index.ts:94](supabase/functions/hubspot-sync/index.ts#L94)).
  The timing-safe comparison in `_shared/partnerAuth.ts` is now the first such
  helper in this codebase. The others are worth revisiting separately.
- **No schema validation library.** No zod, yup, joi or ajv. All validation is
  hand-written regex plus plpgsql, so there is no machine-readable schema to
  generate an API contract from.
- **No agency or branch identifier accepted anywhere.** The form submits agent
  and branch as free-text names
  ([create-referral/index.ts:66-90](supabase/functions/create-referral/index.ts#L66)),
  and an unmatched name **silently creates new org records** rather than
  erroring. This is the single largest source of duplicate orgs and is why
  section 7 requires IDs.

### 2.3 Two reusable precedents

**Rate limiting exists and is reusable.** `public.rate_limit` plus
`bump_rate_limit(p_key text, p_limit int, p_window_secs int)`
([20260703150645_public_rate_limit.sql:16-33](supabase/migrations/20260703150645_public_rate_limit.sql#L16)),
already used on two tiers by `payment-confirmation`
([:66](supabase/functions/payment-confirmation/index.ts#L66),
[:74](supabase/functions/payment-confirmation/index.ts#L74)). Section 12 reuses
it rather than inventing a second mechanism.

**An idempotency-ledger house pattern exists**, in `stripe_events`,
`pandadoc_events` and `hubspot_sync_events`. Section 11 follows its shape.

### 2.4 The anti-pattern to avoid, precisely

`hubspot-sync` is a cursor-driven feed. It reads a single watermark row
([hubspot-sync/index.ts:138](supabase/functions/hubspot-sync/index.ts#L138)),
processes events in order, advances the cursor **only on success**
([:345](supabase/functions/hubspot-sync/index.ts#L345)), and on the first error:

```
break; // stop; cursor holds at last success; the batch retries next run
```

([:354](supabase/functions/hubspot-sync/index.ts#L354))

One permanently failing event therefore blocks **every** later event for **every**
partner, for ever, silently. The outbound webhook design in section 13 is
per-delivery precisely so that this cannot happen: one endpoint's failure must
never delay another's, and one poisoned payload must never delay the ones behind
it.

---

## 3. Referencing modes

`referencing_mode` is a column on `public.partners`, constrained to a **named
set**, not a boolean. Three values are defined now and more are expected.

```
alter table public.partners
  add column referencing_mode text not null default 'pre_referenced_screened'
  check (referencing_mode in
    ('pre_referenced_open','pre_referenced_screened','opndoor_referenced'));
```

The default is deliberately the **screened** value. A partner added without
anyone thinking about the mode gets criteria applied rather than waived. Waiving
criteria should require an explicit decision, because it is a commercial
concession.

### 3.1 The three modes

| Mode | Who references | Do Opndoor criteria apply | Who it is |
| ---- | -------------- | ------------------------- | --------- |
| `pre_referenced_open` | Partner, before the POST | **No.** The partner decides who goes through | Rightmove. A deliberate commercial position, not the general case |
| `pre_referenced_screened` | Partner, before the POST | **Yes.** An applicant can be declined | The expected shape for other referencing providers |
| `opndoor_referenced` | Opndoor, after the POST | Yes, on the reference outcome | CRM partners. Not being built now |

### 3.2 What differs between them

Only three things differ. Everything else, including authentication, payload
shape, org identity, idempotency, rate limiting and the error contract, is
identical across modes.

**POST response**

| Mode | Terminal state of the POST | Response |
| ---- | -------------------------- | -------- |
| `pre_referenced_open` | Application created at `sent`, payment link issued | `201` with `application`, `status: "sent"`, `payment_url` |
| `pre_referenced_screened` | Criteria evaluated synchronously | `201` with `status: "sent"` and `payment_url` when accepted; `201` with `status: "declined"`, `decision.reason_codes` and **no** `payment_url` when declined |
| `opndoor_referenced` | Nothing is created yet | `202 Accepted` with `status: "awaiting_tenant"` and a `reference_id`. No application row exists yet. No `payment_url` |

Note that a decline in `pre_referenced_screened` is **not** an error. It is a
successful request with a negative decision, so it is `201` and not `4xx`.
Errors mean the partner sent something wrong. A decline means Opndoor said no.
Conflating them makes partners retry declines.

**Validation**

All three run the full field validation in section 9. On top of that:

- `pre_referenced_open`: nothing further.
- `pre_referenced_screened`: the criteria evaluation, which may require fields
  that the open mode does not, for example income or adverse credit flags. These
  extra fields are `required` for this mode and `ignored` for the others.
- `opndoor_referenced`: **fewer** fields are required at POST, because the tenant
  supplies the rest. Only enough to identify and contact the tenant and to
  identify the property and the org. Rent and tenancy start may be omitted and
  collected from the tenant.

**Where the deed decision comes from**

- `pre_referenced_open`: payment. Deed issues once paid, as today.
- `pre_referenced_screened`: criteria decision, then payment. A declined
  application never reaches payment.
- `opndoor_referenced`: the reference outcome, then payment.

### 3.3 Criteria do not exist yet, and are not being built now

There is **no acceptance criteria engine in this codebase**. No rules table, no
scoring, no decline path, no `declined` status.

**The criteria themselves have not been written down anywhere.** That is an
Opndoor business gap, not a codebase one, and it is the reason
`pre_referenced_screened` is specified here in shape only.

**Rightmove are `pre_referenced_open` and need no criteria at all**, so nothing
in this section blocks the first partner. `pre_referenced_screened` is being
specified now so the shape is settled, and built later.

The status set is a moving target and has already been widened twice, so a
`declined` value would follow an established pattern rather than break new
ground:

| Migration | Constrained set |
| --------- | --------------- |
| [core_schema.sql:127](supabase/migrations/20260702134239_core_schema.sql#L127) | `sent, paid, deed` |
| [20260705095120:12](supabase/migrations/20260705095120_application_withdrawal_schema.sql#L12) | adds `withdrawn` |
| [20260705115059:11](supabase/migrations/20260705115059_application_expiry_and_reinstate.sql#L11) | adds `expired`. **Current** |

The current constraint is:

```sql
check (status = any (array['sent','paid','deed','withdrawn','expired']))
```

There is a companion constraint, `applications_status_dates`
([20260705115059:13-18](supabase/migrations/20260705115059_application_expiry_and_reinstate.sql#L13)),
which ties each status to its timestamps and requires `paid_at is null` for both
`withdrawn` and `expired`. Any new status must be added to **both** or inserts
fail on the second one.

To make `pre_referenced_screened` real, four things are needed:

1. **The criteria themselves**, per partner, versioned. Versioned because a
   decline must be explainable months later against the rules in force at the
   time. This is the blocking item and it is a business decision, not a
   technical one. See open question 2.
2. An evaluator taking the payload and returning accept or decline plus Opndoor
   reason codes.
3. A `declined` status added to both constraints above, plus a decision record
   storing the criteria version, the outcome and the reason codes.
4. The `application.declined` webhook event.

Until those exist, a `pre_referenced_screened` partner would behave identically
to `pre_referenced_open`. **The API should refuse to onboard one rather than
silently accept everyone**, because silently accepting everyone is
indistinguishable from working and would be discovered only commercially.

### 3.4 Adding a fourth mode

The shape is deliberately additive. To add one:

1. Widen the CHECK constraint in a **new** migration.
2. Add a branch to the mode dispatcher, which is a single switch on
   `partner.referencing_mode` at the entry point, not scattered conditionals.
3. Declare its required-field delta against the base payload.
4. Declare its POST response shape.
5. Declare which webhook events it can emit.
6. Map any provider vocabulary to Opndoor reason codes inside its adapter
   (section 15).

No existing mode's behaviour changes, and no partner-facing contract changes for
partners already on other modes. That is the test of whether the extension point
is real.

### 3.5 Scopes are independent of mode

**Mode and scopes are orthogonal and must never be conflated.** Mode says how an
application is referenced. Scopes say what a key may do. Any mode may be
combined with any scope set.

The implementation rule: **no code path may infer a permission from
`referencing_mode`, and no code path may infer a mode from a scope.** A future
mode that needs a new capability gets a new scope, not a special case in the
mode dispatcher.

---

## 4. Authentication

### 4.1 The key table

```
partner_api_keys
  id            uuid primary key
  partner_id    uuid not null references partners(id) on delete cascade
  name          text not null          -- human label, "Rightmove production"
  key_prefix    text not null unique   -- first 18 chars, for identification
  key_hash      text not null          -- SHA-256 of the full key, lowercase hex
  scopes        text[] not null default '{}'
  created_at    timestamptz not null default now()
  created_by    uuid references users(id)
  expires_at    timestamptz            -- null means no expiry
  revoked_at    timestamptz            -- null means live
  last_used_at  timestamptz
```

The key is shown **once**, at creation, and never retrievable. Only the hash is
stored.

**Multiple live keys per partner are explicitly allowed.** There is no unique
constraint on `partner_id`. Rotation is then: issue the new key, partner deploys
it, confirm traffic has moved via `last_used_at`, revoke the old one. No
coordinated cutover, no downtime window.

### 4.2 Key format and hashing

```
opnd_live_<32 random base62 chars>
```

The prefix is the first **18** characters, `opnd_live_` plus 8 random, stored in
clear as the lookup handle. It is not a secret. `opnd_test_` distinguishes
non-production keys.

**The partner slug is deliberately not in the key.** An earlier draft included
it. Two reasons it came out: the prefix has to be unique, and slug-derived
prefixes collide between any two partners whose slugs share a first letter; and
a key fragment appearing in a log or a screenshot would otherwise name the
partner.

**Hashing is SHA-256, not Argon2id or scrypt.** Also a change from an earlier
draft, and worth the explanation because it looks wrong at a glance.

The key is 32 random base62 characters from a CSPRNG, roughly 190 bits. It is
not a user-chosen password, so there is no dictionary, no reuse across sites and
nothing to brute force. A deliberately slow KDF exists to make guessing
expensive, and there is nothing here to guess.

Against that it would cost two real things. It runs on **every** request,
including unauthenticated ones, so a slow hash turns the auth path into a CPU
exhaustion vector: an attacker sends garbage keys and each one costs the server
far more than it costs them. And it would make the identical-cost miss path in
4.3 expensive to honour, because the miss path has to do the same work as the
hit path by construction.

This is the same reasoning Stripe and GitHub apply to API keys. It would be the
wrong choice for anything a human chooses.

### 4.3 The verification path, and why its shape matters

The requirement is that **a bad prefix must cost the same as a bad secret**. The
obvious implementation fails this:

```
-- WRONG: returns early when the prefix misses
select * from partner_api_keys where key_prefix = $1;
if not found then return 401;
```

That leaks whether a prefix exists, by timing and by nothing else being needed.
An attacker enumerates valid prefixes cheaply and learns which partners exist.

Required shape:

1. Extract the prefix. If the key is malformed, **still** perform a dummy hash
   comparison against a fixed decoy before returning.
2. Look the prefix up. On a miss, compare the presented secret against a
   **constant decoy hash** of the same algorithm and cost, discard the result,
   and return the standard failure.
3. On a hit, compare with the same function. Use a timing-safe comparison, not
   `===`.
4. Check `revoked_at is null` and `expires_at` after the comparison, never
   before, so a revoked key costs the same as a live one.
5. Update `last_used_at` asynchronously. It must not be in the request's
   critical path, and it must not be the reason a request is slower.

This is the first timing-safe comparison in the codebase (section 2.2), so it
belongs in `_shared/` as one helper both this and any future verifier use.

### 4.4 Identical failures

Every authentication failure, whatever the cause, returns byte-identical output:

```
HTTP 401
{"error":{"code":"unauthorized","message":"Invalid credentials."}}
```

Malformed key, unknown prefix, wrong secret, revoked, expired: all the same. No
`WWW-Authenticate` detail, no distinct codes, no hints. The response must not
vary in body, status or headers.

Only the internal request log records the real reason. Partners debugging a
genuine problem get told out of band, which is a support cost accepted
deliberately in exchange for an unprobeable surface.

### 4.5 Scopes

| Scope | Grants |
| ----- | ------ |
| `applications:write` | POST an application |
| `applications:read` | Read own applications |
| `orgs:read` | List agencies and branches |
| `orgs:write` | Create agencies and branches implicitly on POST |
| `webhooks:manage` | Register and modify own endpoints |

A key without `orgs:write` that sends names instead of IDs is rejected rather
than quietly creating an org. This lets Opndoor issue a key that can only
reference existing orgs, which is the sane end state for a mature partner.

### 4.6 Partner status is a gate

`partners.status` is already `('active','onboarding','paused')`
([core_schema.sql:41](supabase/migrations/20260702134239_core_schema.sql#L41)),
and no RLS policy anywhere references it today. The API must gate on it: only
`active` accepts writes. `paused` returns `403 partner_inactive`, which is a
distinct and safe disclosure because the partner already knows who they are once
authenticated.

### 4.7 RLS does not apply on this path

Every table carries a **restrictive** AAL2 policy
([20260702134358_access_rls_rpc.sql:50-55](supabase/migrations/20260702134358_access_rls_rpc.sql#L50))
requiring `is_aal2()` for `authenticated`. An API key request can never satisfy
it. The API therefore runs as service role inside an Edge Function, exactly as
the other functions do, which means **RLS provides no protection on this path and
partner scoping is entirely the application's responsibility**.

This is the highest-risk property of the whole design and should be stated in
review. Every query must filter on the `partner_id` derived from the key. A
missing filter is a cross-partner data leak that no database policy will catch.

Mitigation worth considering: a single accessor module that takes `partner_id`
as a required first argument and is the only thing permitted to touch these
tables, so that the filter cannot be forgotten one query at a time.

### 4.8 Issuing a key is manual, deliberately

There is no key-minting endpoint. Hashing cannot happen in Postgres: SHA-256
needs pgcrypto's `digest()`, and this schema enables only pg_cron and pg_net.
Adding an extension solely to mint credentials is a poor trade.

The key and its hash are generated outside the database and only the hash is
inserted. The exact procedure is in `HANDOVER.md` section 9.4. An admin endpoint
is later work, and should arrive before the number of partners makes the manual
step a bottleneck rather than after.

---

## 5. Endpoints

| Method | Path | Scope | Purpose | Status |
| ------ | ---- | ----- | ------- | ------ |
| `POST` | `/applications` | `applications:write` | Create an application | **Built** |
| `GET` | `/applications/{id}` | `applications:read` | Read one, **with `payment_url`** | **Built** |
| `GET` | `/applications` | `applications:read` | List own, keyset paginated | **Built** |
| `GET` | `/orgs` | `orgs:read` | Agencies and branches with `has_agent_contact` | **Built** |
| `POST` | `/webhook-endpoints` | `webhooks:manage` | Register an endpoint | **Built** |
| `GET` | `/webhook-endpoints` | `webhooks:manage` | List own | **Built** |
| `DELETE` | `/webhook-endpoints/{id}` | `webhooks:manage` | Remove one | **Built** |

### Reading applications

`GET /applications` is keyset paginated on `(created_at, id)`, newest first.
`?limit=` is clamped to 100 and `?status=` takes the partner vocabulary. The
response carries `next_cursor`, which is **null on the last page**: a client
loops until it is null rather than counting pages.

Keyset rather than offset deliberately. Offset silently skips rows when new
applications are created during a walk, which for a partner reconciling their
book means quietly missing records.

**`payment_url` is returned by the single fetch and not by the list.** The
payment token is a bearer credential for the tenant payment page, including the
self-decline action, so returning a page of them to satisfy a reconciliation
walk is more exposure than the job needs. A partner acting on one application
fetches it individually.

### The partner-facing status vocabulary

Stored statuses are internal. Two read badly outside, so the API maps them, and
the same mapping is used by REST responses and webhook payloads alike.

| Stored | Partner-facing | Why |
| ------ | -------------- | --- |
| `sent` | `sent` | |
| `paid` | `paid` | |
| `deed` | `deed_issued` | `deed` names a column, not an outcome |
| `withdrawn` | `withdrawn` | |
| `expired` | `lapsed` | `expired` collides with the guarantee's own expiry |

That last one matters. `status = 'expired'` means an **unpaid application lapsed
after 14 days**. `expiry_date` is the **guarantee expiring 12 months after
tenancy start**. They are months apart and mean opposite things commercially, so
the partner-facing word for the first is `lapsed` and `expiry_date` keeps its
name.

The `?status=` filter takes the partner vocabulary too, so a caller filters with
the same words the responses use.

### The real URL, and the versioning gap

**As built, the base is `/functions/v1/partner-api/`**, so the live path is
`/functions/v1/partner-api/orgs`. The `/v1/orgs` form above assumes a gateway
rewrite that does not exist.

Note what that `v1` is: it is Supabase's Edge Function API version, not ours.
Nothing in the built surface carries an Opndoor API version, so **there is
currently no way to ship a breaking change to a partner without breaking them.**

Fixing it later is materially harder than starting with it, and it should be
settled before a partner integrates rather than after. The cheapest form is a
path segment, `/functions/v1/partner-api/v1/orgs`, which needs one line in the
router. A custom domain rewriting to the function is the tidier form and can come
later without changing the contract, provided the version segment is there from
the start.

Raised as open question 11.

---

## 6. POST /v1/applications

### 6.1 Payload

Mirrors the New Application form. Field names are the API's own, in snake_case,
mapped to columns internally.

```jsonc
{
  "idempotency_key": "partner-side-unique-string",   // see section 11

  "tenant": {
    "title":      "Mr",           // required, one of Mr Mrs Miss Ms Mx Dr
    "first_name": "...",          // required
    "last_name":  "...",          // required
    "date_of_birth": "1990-04-12",// required, ISO 8601, must be in the past
    "email":      "...",          // required
    "phone":      "..."           // required, must contain a digit
  },

  "property": {
    "address_line_1": "...",      // required
    "address_line_2": "...",      // optional
    "city":           "...",      // required
    "county":         "...",      // optional
    "postcode":       "SW1A 1AA"  // required, UK format
  },

  "tenancy": {
    "monthly_rent":  1250.00,     // required, > 0
    "start_date":    "2026-09-01" // required
  },

  "org": {                        // exactly one of the two forms, section 7
    "agency_id": "uuid",
    "branch_id": "uuid"
  },

  "referrer": {
    "email": "agent@example.com"  // required, section 8
  }
}
```

### 6.2 Field mapping to existing columns

| API field | Column | Required by DB |
| --------- | ------ | -------------- |
| `tenant.title` | `tenant_title` | nullable, but `create_referral` requires it |
| `tenant.first_name` | `tenant_first_name` | `not null` |
| `tenant.last_name` | `tenant_last_name` | `not null` |
| `tenant.date_of_birth` | `tenant_dob` | nullable, but required by validation and by the age CHECKs |
| `tenant.email` | `tenant_email` | nullable, required by validation |
| `tenant.phone` | `tenant_phone` | nullable, required by validation |
| `property.address_line_1` | `prop_addr1` | `not null` |
| `property.address_line_2` | `prop_addr2` | nullable, empty string stored as null |
| `property.city` | `prop_city` | nullable, required by validation |
| `property.county` | `prop_county` | nullable |
| `property.postcode` | `prop_postcode` | nullable, uppercased on write |
| `tenancy.monthly_rent` | `monthly_rent` | `not null`, `>= 0` |
| `tenancy.start_date` | `tenancy_start` | `not null` |

Column definitions at
[core_schema.sql:107-139](supabase/migrations/20260702134239_core_schema.sql#L107).
`expiry_date` is generated, not accepted:
`expiry_date date generated always as (public.guarantee_expiry(tenancy_start)) stored`
([:132](supabase/migrations/20260702134239_core_schema.sql#L132)).

`guarantee_ref` is assigned server-side from a sequence,
`'GR-' || nextval('public.guarantee_ref_seq')`
([20260705140347:70](supabase/migrations/20260705140347_snapshot_referrer_name.sql#L70)),
and is returned to the partner. It is the reference a partner should quote to
support.

---

## 7. Org identity

The problem being solved: today the form sends **names**, resolved by string
matching, and an unmatched name silently creates a new agency or branch
([create-referral/index.ts:66-90](supabase/functions/create-referral/index.ts#L66)).
Across a partner sending thousands of applications this produces duplicate orgs
at scale, and the matching is inconsistent between layers, case-sensitive in the
Edge Function's PostgREST query and case-insensitive inside
`create_referral_target`. An API must not inherit that.

### 7.1 Two accepted forms

**By ID, strongly preferred:**

```json
"org": { "agency_id": "uuid", "branch_id": "uuid" }
```

Both must belong to the key's partner. A mismatch returns `org.agency_id` /
`org.branch_id` field errors and **never** reveals whether the ID exists under a
different partner.

**By name, for first contact only:**

```json
"org": {
  "agency_name": "Foo Lettings",
  "branch_name": "Clapham",
  "agent_contact_email": "clapham@foolettings.co.uk",
  "agent_contact_name": "Jane Smith"
}
```

Requires the `orgs:write` scope. `agent_contact_email` is **mandatory** in this
form.

### 7.2 IDs are always returned

Both forms return the resolved IDs:

```json
"org": { "agency_id": "uuid", "branch_id": "uuid", "created": true }
```

The partner is expected to store these and send IDs thereafter. `created` tells
them whether they just made a new org, which is the signal to reconcile.

### 7.3 Why the contact email is mandatory

Not policy. A hard dependency.

Deed generation resolves the agent email through
`effective_primary_contact(p_branch)`
([_shared/pandadoc.ts:412](supabase/functions/_shared/pandadoc.ts#L412)) and
dead-ends without it
([:414-418](supabase/functions/_shared/pandadoc.ts#L414)):

```ts
const agentEmail = c?.email ?? null;
if (!agentEmail) {
  await service.from("applications").update({ deed_state: "error" }).eq("id", appId);
  ...
  return { ok: false, error: "No agent contact for this branch. Add one, then retry." };
}
```

An org created without a contact therefore produces applications that take
payment and then **fail at the deed**, which is the worst possible failure
point: the tenant has paid and cannot be issued the thing they paid for.

`effective_primary_contact` is
`select * from public.effective_contacts(p_branch) where is_primary limit 1`
([20260702134358:38-42](supabase/migrations/20260702134358_access_rls_rpc.sql#L38)),
and `effective_contacts` falls back from branch to agency **only when the branch
has no contacts at all**
([:31-35](supabase/migrations/20260702134358_access_rls_rpc.sql#L31)). So a
branch holding a contact that is not primary resolves to nothing, and does
**not** inherit the agency's.

How reachable that state is was checked rather than assumed, and it is narrower
than it first appears. Two triggers defend the invariant: on INSERT the first
contact for an owner is forced primary
([core_schema.sql:196](supabase/migrations/20260702134239_core_schema.sql#L196)),
and on DELETE of a primary the next contact is promoted
([:213-228](supabase/migrations/20260702134239_core_schema.sql#L213)). So it
cannot be reached by adding or removing contacts.

**It is reachable by UPDATE.** The maintaining trigger only acts
`if new.is_primary`
([:199](supabase/migrations/20260702134239_core_schema.sql#L199)), so clearing
the flag on the only primary leaves the branch with a contact and no primary,
and nothing puts it back. Confirmed empirically against a live schema: after
such an update, `effective_primary_contact` returns nothing and the deed path
would dead-end.

That is why `has_agent_contact` is computed through the same function the deed
path calls, rather than as "does a contact row exist". The two disagree exactly
in this case, and it is the case that costs a tenant who has already paid.

### 7.4 Validating supplied IDs

When IDs are supplied, the API must call `effective_primary_contact(branch_id)`
and reject with a field-level error if it resolves to nothing. Otherwise the
partner passes validation, gets a payment link, and discovers at deed time.

This means an org created before this API existed, without a primary contact,
will be rejected. That is correct and surfaces pre-existing bad data, but it
will generate onboarding friction and should be expected.

### 7.5 GET /v1/orgs

Exists so partners backfill IDs instead of creating duplicates.

```json
{
  "agencies": [{
    "id": "uuid",
    "name": "Foo Lettings",
    "has_agent_contact": true,
    "branches": [
      { "id": "uuid", "name": "Clapham", "has_agent_contact": true },
      { "id": "uuid", "name": "Balham",  "has_agent_contact": false }
    ]
  }]
}
```

`has_agent_contact` is computed from `effective_primary_contact` resolving, not
from a row existing, so it means "a deed can be issued for this branch". A
partner can use it to fix data before sending traffic.

Scoped to the key's partner. `partner_id` is never echoed.

---

## 8. Referrer resolution

The referrer is identified by email, and matched **within the key's partner
only**:

```sql
select id from users where lower(email) = lower($1) and partner_id = $partner
```

Never globally. Three outcomes:

| Outcome | Behaviour |
| ------- | --------- |
| Match within partner | Use that `users.id` as `referrer_id` |
| No match anywhere | Auto-provision a pending user under this partner |
| Match under a **different** partner | `422`, field error on `referrer.email`. Never linked, never merged |

The third case must not disclose which partner. The message says the address is
not available for this partner, nothing more.

### 8.1 Auto-provisioning

`users.id` is a foreign key to `auth.users(id) on delete cascade`
([core_schema.sql:50](supabase/migrations/20260702134239_core_schema.sql#L50)),
so a `public.users` row **cannot exist without an auth user**. Provisioning must
create the auth user first. A `pending` status already exists
([:56](supabase/migrations/20260702134239_core_schema.sql#L56)) and
`users_partner_by_role` requires a non-superadmin to have a `partner_id`
([:59-62](supabase/migrations/20260702134239_core_schema.sql#L59)), so the row is
`role = 'referrer'`, `status = 'pending'`, `partner_id` from the key.

No email is sent. Provisioning uses `generateLink({type:'invite'})` because that
is what creates the `auth.users` row and returns its id; the link it produces is
discarded. The partner has not asked for anyone to be contacted.

**Known and accepted: a failed request can leave a provisioned user behind.**
The referrer is resolved before validation, so a payload that then fails
validation has already created the user. It is a real user, scoped to the
caller's own partner, and it will be reused by the next request from the same
address, so the effect is untidy rather than unsafe. Making it atomic would mean
wrapping an Admin API call and several statements in one transaction, which is
not worth the complexity at this stage. Revisit if failed requests start
accumulating users at volume.

### 8.2 Names, and why they cannot be backfilled

Partners are **not** required to send a referrer name. Opndoor or the partner can
name the user afterwards through the portal.

But there is a trap. `applications.referrer_name` is a **snapshot**, added and
backfilled once by
[20260705140347_snapshot_referrer_name.sql:6-11](supabase/migrations/20260705140347_snapshot_referrer_name.sql#L6),
and stamped at insert from the creating user
([:71](supabase/migrations/20260705140347_snapshot_referrer_name.sql#L71)).
Display prefers the snapshot over the live join
([hydrate.ts:237](src/lib/hydrate.ts#L237)):

```ts
referrer: a.referrer_name ?? emb(a.referrer)?.full_name ?? null,
```

So **naming a user later affects only applications created after that point.**
Applications already created keep whatever name was snapshotted, and there is no
backfill. If the first hundred applications are stamped with a placeholder, those
hundred show the placeholder in the portal, the league table and every export,
permanently, unless someone writes a one-off update.

**Recommendation: pre-create known partner users with proper names before
go-live**, so the very first application already carries a correct name. For a
partner like Rightmove with a known set of referring staff this is a short list
and a few minutes of work, against a permanent cosmetic defect otherwise.

Where a user must be auto-provisioned anyway, the snapshot should be the
referrer's email rather than a generic placeholder. An email is at least
identifying, and reads acceptably in a league table, whereas "Partner user"
repeated two hundred times does not.

**Open question 4** asks whether a backfill is wanted regardless.

---

## 9. Validation and rejection

An invalid payload is rejected outright. Nothing partial lands in the portal.
There is no draft or incomplete state to land in: every value in the current
status set is a live application
([20260705115059:11](supabase/migrations/20260705115059_application_expiry_and_reinstate.sql#L11)),
and the companion `applications_status_dates` constraint ties each one to its
timestamps, so there is nowhere for a half-formed record to sit.

### 9.1 Rules, from the existing implementation

Reproduced from
[20260705140347_snapshot_referrer_name.sql:23-52](supabase/migrations/20260705140347_snapshot_referrer_name.sql#L23):

| Field | Rule |
| ----- | ---- |
| title | one of `Mr Mrs Miss Ms Mx Dr` |
| first name | non-blank after trim |
| last name | non-blank after trim |
| date of birth | present, strictly in the past |
| email | `^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$` |
| phone | non-blank and contains at least one digit |
| address line 1 | non-blank |
| city | non-blank |
| postcode | `^[a-z]{1,2}[0-9][a-z0-9]? ?[0-9][a-z]{2}$`, case-insensitive |
| monthly rent | present and `> 0` |
| tenancy start | present |
| branch | present |

Plus two combined rules
([:54-58](supabase/migrations/20260705140347_snapshot_referrer_name.sql#L54))
and matching table CHECKs
([20260702190747:21-23](supabase/migrations/20260702190747_refund_amount_and_age_rules.sql#L21)):

- 18 by the tenancy start date
- not over 100 at the tenancy start date

### 9.2 Gaps the API should close

These are absent everywhere today and an API is far more exposed to them than a
form:

- **No phone normalisation.** Any string with a digit passes. `"0"` is valid.
  The API should require a plausible UK or E.164 number and normalise before
  storage. This is stricter than the form, which is a deliberate and reviewable
  divergence.
- **No maximum rent.** Only `> 0`; `numeric(10,2)` is the sole ceiling. A typo
  of `125000` produces a Stripe Checkout for that amount. A sanity ceiling
  belongs here.
- **No length limits on any text field.** Names, address lines and city are
  unbounded.
- **No postcode space normalisation.** The server only uppercases and trims, so
  `SW1A1AA` and `SW1A 1AA` both store as written and will not compare equal.

Each is a divergence from the form and must be listed in the handover, or the
two doors drift.

### 9.3 Rejection response

```json
{
  "error": {
    "code": "validation_failed",
    "message": "The application was not created.",
    "fields": [
      { "field": "tenant.date_of_birth", "code": "must_be_18_by_tenancy_start",
        "message": "Tenant must be 18 by the tenancy start date." },
      { "field": "property.postcode", "code": "invalid_format",
        "message": "Enter a valid UK postcode." }
    ]
  }
}
```

**All** failures are returned at once, not the first. Verified: a payload with
five bad fields returns all five.

### 9.4 The field codes, as built

`public.referral_field_errors` is the single source of truth. `create_referral`
and the API are both built on it, so the portal and the API cannot start
disagreeing about what a valid application is.

| `field` | `code` |
| ------- | ------ |
| `tenant.title` | `invalid_value` |
| `tenant.first_name`, `tenant.last_name` | `required` |
| `tenant.date_of_birth` | `required`, `must_be_in_past`, `must_be_18_by_tenancy_start`, `implausible_age` |
| `tenant.email` | `invalid_format` |
| `tenant.phone` | `invalid_format` |
| `property.address_line_1`, `property.city` | `required` |
| `property.postcode` | `invalid_format` |
| `tenancy.monthly_rent` | `must_be_positive` |
| `tenancy.start_date` | `required`, `too_far_in_past`, `too_far_ahead` |
| `org.agency_id`, `org.branch_id` | `required`, `not_found`, `no_agent_contact` |
| `org.agency_name` | `insufficient_scope`, `could_not_create` |
| `org.agent_contact_email` | `required` |
| `referrer.email` | `required`, `not_available`, `could_not_provision` |

Two of these are worth understanding rather than just handling.

**`org.branch_id: no_agent_contact`** means the branch cannot resolve a primary
agent contact, so a deed could not be issued for it. Rejecting at POST is the
whole point: the alternative is accepting the application, taking the tenant's
money, and failing at deed generation. `GET /orgs` exposes the same condition as
`has_agent_contact` so a partner can fix their data before sending traffic.

**`referrer.email: not_available`** means the address exists under a different
partner. The message deliberately does not say which, or confirm that one exists.

Postgres error text is never passed through. `create_referral`'s free-text
messages stay on the portal path.

---

## 10. What may be returned to a partner

Default deny. A field is returned only if listed here.

### 10.1 Safe

| Field | Source |
| ----- | ------ |
| `id`, `guarantee_ref` | `applications` |
| `status` | mapped to the partner vocabulary, section 15 |
| `created_at`, `sent_at`, `paid_at`, `deed_issued_at`, `expiry_date` | timestamps only |
| `tenant.*` | the partner sent these |
| `property.*` | the partner sent these |
| `tenancy.monthly_rent`, `tenancy.start_date` | the partner sent these |
| `org.agency_id`, `org.branch_id`, names | the partner's own orgs |
| `referrer.email` | the partner sent it |
| `payment_url` | the tokenised link, only until paid |
| `decision.outcome`, `decision.reason_codes` | Opndoor codes only, section 15 |

### 10.2 Never returned

| Field | Where it lives | Why |
| ----- | -------------- | --- |
| `partners.partner_rate`, `partners.agent_rate` | [core_schema.sql:43-44](supabase/migrations/20260702134239_core_schema.sql#L43) | Commercial terms. Rates are also snapshotted onto applications by a later migration, so **both** the live and snapshot copies must be excluded |
| Amounts paid or refunded | payment tables | Commercial and reconciliation data |
| Any Stripe identifier | session id, payment intent, event id, refund id | Enables direct Stripe correlation |
| Any PandaDoc identifier | document id, template id | Same |
| `executed_pdf_path` | storage object key | A storage path, never a partner-facing URL |
| `activity_log` rows with `visibility = 'internal'` | [20260703095652:7](supabase/migrations/20260703095652_activity_log_visibility.sql#L7) | Raw technical failures. `deed_error` and `payment_email_failed` were backfilled to internal ([:11](supabase/migrations/20260703095652_activity_log_visibility.sql#L11)) |
| `partner_id`, `referrer_id`, any other partner's data | everywhere | Cross-tenant |
| Any provider name or vocabulary | section 15 | Masking |

**A warning on `visibility`.** It is enforced **nowhere in the database**. There
is no policy, view or trigger restricting `'internal'`; filtering is ad hoc in
three TypeScript places. Any partner-facing query must filter explicitly, and
the two existing views (`activity_feed`, `upcoming_expiries`) are `security_invoker`
and project `partner_id` and `referrer_id`, so **neither is safe to expose
directly**.

The right shape is a dedicated partner-facing serializer that names its output
fields explicitly. Never `select *`, never pass a row object through.

---

## 11. Idempotency

Nothing exists today. A repeated POST currently creates a second application, a
second Stripe Checkout Session and a second tenant email. For an API where
retries are normal, this is the highest-value safeguard in the spec.

`Idempotency-Key` header, or `idempotency_key` in the body. **Required** on POST.

```
partner_api_requests
  id              uuid primary key
  partner_id      uuid not null references partners(id)
  api_key_id      uuid references partner_api_keys(id)
  idempotency_key text not null
  endpoint        text not null
  request_hash    text not null     -- hash of the canonicalised body
  status_code     int
  response_body   jsonb
  application_id  uuid references applications(id)
  created_at      timestamptz not null default now()

  unique (partner_id, endpoint, idempotency_key)
```

Semantics, following the existing ledger pattern:

| Case | Behaviour |
| ---- | --------- |
| Key unseen | Process. Record request, response and `application_id` |
| Key seen, same `request_hash` | Replay the stored response verbatim. Do not re-process |
| Key seen, **different** `request_hash` | `409 idempotency_key_reused` |
| Key seen, still in flight | `409 request_in_progress` |

The third case matters: it catches a partner reusing a key for a genuinely
different application, which would otherwise silently return the wrong
application's details.

This table also carries provenance (section 1), keeping it off the application
row so nothing downstream branches on it.

Retention needs a decision, since it accumulates a row per request and holds
full response bodies containing tenant PII. See open question 6.

---

## 12. Rate limiting

Reuse `bump_rate_limit(p_key, p_limit, p_window_secs)`
([20260703150645:16](supabase/migrations/20260703150645_public_rate_limit.sql#L16)),
following the two-tier pattern already used by `payment-confirmation`
([:66](supabase/functions/payment-confirmation/index.ts#L66),
[:74](supabase/functions/payment-confirmation/index.ts#L74)).

| Tier | Key | Suggested |
| ---- | --- | --------- |
| Per key, sustained | `papi:key:<api_key_id>` | 600 / 60s |
| Per key, writes | `papi:write:<api_key_id>` | 120 / 60s |
| Per partner, aggregate | `papi:partner:<partner_id>` | 1200 / 60s |
| Unauthenticated, per IP | `papi:anon:<ip>` | 60 / 60s |

The fourth is the important one. **It must be applied before key verification**,
or the auth path itself is the attack surface: each attempt costs a hash
computation, and a deliberately expensive hash makes that worse. Rate limit
first, verify second.

Exceeding returns `429` with `Retry-After`.

Note the existing implementation is a fixed window, not a sliding one, so a
client can burst at a boundary. Acceptable at these volumes, worth knowing.

---

## 13. Outbound webhooks

Nothing exists. This is the largest new component.

### 13.1 Endpoint registry

```
partner_webhook_endpoints
  id           uuid primary key
  partner_id   uuid not null references partners(id) on delete cascade
  url          text not null                  -- https only
  secret       text not null                  -- per endpoint, not per partner
  events       text[] not null                -- subscribed event types
  active       boolean not null default true
  created_at   timestamptz not null default now()
  last_success_at  timestamptz
  last_failure_at  timestamptz
  consecutive_failures int not null default 0
```

Multiple endpoints per partner, so a partner can fan out to staging and
production, or migrate endpoints without a cutover. The secret is **per
endpoint**, so rotating one does not disturb another.

### 13.2 Per-delivery queue

The design requirement, restating section 2.4: **one delivery must never block
another.**

```
partner_webhook_deliveries
  id              uuid primary key
  endpoint_id     uuid not null references partner_webhook_endpoints(id) on delete cascade
  event_id        uuid not null              -- stable, for partner dedupe
  event_type      text not null
  payload         jsonb not null             -- rendered at enqueue, immutable
  attempts        int not null default 0
  next_attempt_at timestamptz not null default now()
  last_status     int
  last_error      text
  delivered_at    timestamptz
  dead_at         timestamptz
  created_at      timestamptz not null default now()

  index (next_attempt_at) where delivered_at is null and dead_at is null
```

**One row per endpoint per event.** Two endpoints subscribed to the same event
get two independent rows that succeed or fail independently.

The dispatcher selects due rows with `for update skip locked` and processes them
concurrently. `skip locked` is what makes a slow delivery not block the row
behind it, which is precisely what `hubspot-sync`'s `break` fails to do.

**The payload is rendered at enqueue and never re-rendered.** A retry three hours
later must deliver what was true when the event happened, not the current state.
Re-rendering would make retries deliver out-of-order snapshots.

### 13.3 Backoff and dead lettering

Exponential with jitter, 8 attempts:

```
1m, 5m, 25m, 2h, 6h, 12h, 24h, 24h   (each +/- 20% jitter)
```

Jitter matters: without it, a partner outage produces a synchronised retry storm
at recovery.

After the final attempt, set `dead_at`. Dead rows are retained for inspection and
manual replay, never silently dropped. Twenty consecutive failures on an endpoint
sets `active = false` and raises an internal ops alert, so a partner who
decommissions an endpoint without telling anyone stops generating load.

A `2xx` is success. Everything else is a retry. A `410 Gone` should dead-letter
immediately rather than retry for a day.

### 13.4 Signing

Per-endpoint secret, HMAC-SHA256:

```
X-Opndoor-Signature: t=<unix>,v1=<hex hmac of "<t>.<raw body>">
X-Opndoor-Event-Id: <uuid>
X-Opndoor-Event-Type: application.paid
```

Signing the timestamp with the body, rather than the body alone, is what makes
replay detectable. Partners should reject a timestamp outside a tolerance of
around five minutes.

The existing PandaDoc inbound verification is the closest precedent
([_shared/pandadoc.ts:392](supabase/functions/_shared/pandadoc.ts#L392)) but it
compares with `===` and has **no timestamp, nonce or tolerance**, so it is
replayable. Do not copy it. Use the timing-safe helper from section 4.3, and
document the tolerance so partners implement verification correctly.

### 13.5 Events

| Event | Fires when | Backed by a real status today |
| ----- | ---------- | ----------------------------- |
| `application.created` | Created and accepted | `sent` |
| `application.paid` | Payment settles | `paid` |
| `application.deed_issued` | Deed executed | `deed` |
| `application.lapsed` | Unpaid application auto-expires 14 days after `sent_at` | `expired` |
| `application.withdrawn` | Withdrawn by staff or tenant | `withdrawn` |
| `application.reinstated` | A lapsed or tenant-declined application is paid late | `paid`, arrived from `expired` or `withdrawn` |
| `application.declined` | Criteria decline | **No.** Needs the `declined` status |
| `reference.completed` | Reference concludes | **No.** Needs the referencing integration |

**`application.reinstated` is emitted instead of `application.paid`**, not in
addition. Deliveries are unique per endpoint, application and event type, which
gives at-most-once. Saying nothing would leave a partner who heard
`application.lapsed` with a permanently wrong record; resending
`application.paid` would be double counted by anyone treating it as a
first-payment signal, and would be suppressed by the index anyway. A distinct
event solves both.

Both routes into it, a lapsed application paid late and a **tenant-declined**
withdrawal paid late, are the same branch of `apply_stripe_payment`
([20260705115059:66](supabase/migrations/20260705115059_application_expiry_and_reinstate.sql#L66)),
so they behave identically.

A **staff**-withdrawn application paid late emits **nothing at all**, because
that branch never changes status. The partner is never told the money arrived.
That is `DEFECTS.md` defect 8 and should be fixed there rather than papered over
with an event, since the application was not reinstated and real money is sitting
on a withdrawn row awaiting a refund.

Statuses use the partner vocabulary of section 15, never internal values.

**Naming note.** The event for the `expired` status is deliberately called
`application.lapsed`, not `application.expired`, because the codebase uses
"expiry" for two unrelated things and a partner-facing name must not inherit the
ambiguity:

- `status = 'expired'` means an **unpaid application** lapsed 14 days after
  `sent_at` ([20260705115059:1-2](supabase/migrations/20260705115059_application_expiry_and_reinstate.sql#L1)).
- `expiry_date` is the **guarantee's** expiry, a generated column equal to
  tenancy start plus 12 months minus a day
  ([core_schema.sql:132](supabase/migrations/20260702134239_core_schema.sql#L132)).

These are months apart and mean opposite things commercially. If a guarantee
expiry event is ever wanted, it is a separate event and must not reuse this name.

### 13.6 Status is not monotonic

An application can move **backwards** out of a terminal-looking state. A later
payment reinstates both an expired application and a tenant-declined withdrawal
to `paid`, described in the migration header as "late money wins"
([20260705115059:3-5](supabase/migrations/20260705115059_application_expiry_and_reinstate.sql#L3)).
A staff withdrawal does not reinstate.

So `application.lapsed` followed by `application.paid` for the same application
is **normal and correct**, not an error or a duplicate.

Partners must be told this explicitly, because the natural implementation is to
treat a lapse as terminal and stop listening. The webhook documentation should
state that consumers must:

- Handle any event arriving after a lapse or withdrawal.
- Treat `status` in the payload as authoritative, not the event name.
- Order by the event timestamp, not arrival order, since retries mean a later
  event can arrive before an earlier one.

### 13.7 The dispatcher has no schedule, deliberately

Nothing in the migrations calls `cron.schedule` for it, and that is on purpose.
`20260705153000` schedules `hubspot-sync` with a hardcoded project URL, which is
why applying this repo to any new project immediately points it at a foreign
project every two minutes (defect 2). **A migration cannot know which project it
is being applied to**, so any URL it hardcodes is wrong somewhere.

Scheduling is a deployment step instead, with the ref substituted for the project
actually being deployed to. The statement is in the header of
`20260810170000_partner_webhook_claim.sql`.

Until it is scheduled, **deliveries queue and are never sent**. That is the
correct failure mode, since the queue is the source of truth and nothing is lost,
but it will look like the webhooks are broken.

Minute granularity puts up to 60 seconds on the first attempt. If that matters,
the enqueue path can additionally poke the dispatcher; the queue remains
authoritative, so the poke is an optimisation and never a requirement.

---

## 14. Error contract

| Status | Code | Meaning |
| ------ | ---- | ------- |
| 400 | `malformed_request` | Not valid JSON, or missing idempotency key |
| 401 | `unauthorized` | Any auth failure, always identical (section 4.4) |
| 403 | `insufficient_scope` | Key lacks the scope |
| 403 | `partner_inactive` | Partner not `active` |
| 404 | `not_found` | Unknown, or belongs to another partner. Indistinguishable by design |
| 409 | `idempotency_key_reused` | Same key, different body |
| 409 | `request_in_progress` | Same key, still processing |
| 422 | `validation_failed` | Field errors (section 9.3) |
| 429 | `rate_limited` | With `Retry-After` |
| 500 | `internal_error` | With an opaque `request_id`, no internals |
| 501 | `not_implemented` | The partner's `referencing_mode` is not built. See below |
| 503 | `service_unavailable` | Dependency down, retryable |

Every response carries `X-Request-Id`, logged alongside the real reason, so
support can diagnose without the API disclosing anything.

`404` for another partner's resource, rather than `403`, is deliberate: `403`
confirms the resource exists.

**`501` is how an unbuilt mode fails, and it is deliberate.** A partner on
`pre_referenced_screened` or `opndoor_referenced` gets a flat refusal rather than
being quietly treated as `pre_referenced_open`. Accepting them would mean
approving every applicant with no criteria applied, which looks exactly like
working software and would surface as a commercial problem long after the fact.
The message does not name the mode, since that is internal vocabulary.

---

## 15. Provider masking

Applies to `opndoor_referenced`. **The provider must never be visible to a
partner.** Referencing is performed by Lettings in a Box and presented as
Opndoor's own outcome.

### 15.1 The rule

No provider name, status string, error code, field name, identifier, URL or
message may appear in anything partner-facing. That means:

- API responses, including error bodies
- Webhook payloads and headers
- Status and reason code values
- Field names in validation errors
- Support-facing text a partner might be shown

The outward vocabulary is Opndoor's own, defined by Opndoor, and stable
independently of the provider.

### 15.2 Adapter boundary

One module is the only thing that knows the provider exists.

```
partner-facing  <->  Opndoor vocabulary  <->  [adapter]  <->  provider vocabulary
```

Inside the adapter: provider request and response shapes, their status strings,
their error codes, their identifiers. Outside it: Opndoor terms only. Nothing
provider-shaped crosses the boundary in either direction.

Concretely, the adapter must **map**, never pass through:

| Provider concept | Becomes |
| ---------------- | ------- |
| Their status string | An Opndoor status |
| Their decline reason | An Opndoor reason code |
| Their error code | An Opndoor error code, or a generic internal error |
| Their reference id | An Opndoor `reference_id`, ours, different value |

A reason code with no Opndoor equivalent maps to a generic code. It is never
passed through because it is unmapped, which is the failure mode that leaks a
vocabulary one value at a time.

### 15.3 Storage

The raw provider payload **is stored**, for audit, dispute resolution and
debugging:

```
reference_provider_events
  id            uuid primary key
  reference_id  uuid not null
  raw_payload   jsonb not null      -- exactly as received, never exposed
  received_at   timestamptz not null default now()
```

Never exposed through any partner-facing endpoint or webhook. Not in an
expandable field, not behind a scope, not on request. There is no partner-facing
route to this table.

The mapped Opndoor-vocabulary result is stored separately and is what every
partner-facing surface reads. Anything partner-facing that reads `raw_payload`
is a defect, and that is a cheap review rule: grep for the column name.

### 15.4 Reason codes

Opndoor's own, stable, documented for partners:

```
affordability_below_threshold
adverse_credit
insufficient_history
identity_unverified
employment_unverified
tenant_did_not_complete
tenant_withdrew
ineligible_property
declined_other
```

Deliberately coarser than any provider's internal set. Coarseness is a feature:
it decouples the public contract from provider changes and avoids leaking a
provider's taxonomy through its shape. If a provider adds a reason, the mapping
absorbs it without the partner contract changing.

### 15.5 The flow

1. Partner POSTs tenant details. `202`, `status: "awaiting_tenant"`, plus an
   Opndoor `reference_id`.
2. Opndoor emails the tenant a link. No application row exists yet.
3. Tenant joins the portal and completes the application. The application row is
   created at this point, so the tenant supplies what the partner did not.
4. The adapter submits to the provider.
5. The provider returns an outcome. Raw payload stored, outcome mapped.
6. `reference.completed` webhook fires with the Opndoor outcome and reason codes.
7. On acceptance, the flow rejoins the standard path: payment, then deed.

Steps 2, 3 and 4 are all new. Step 3 in particular needs a tenant-facing
completion journey that does not exist, closest in spirit to the existing
tokenised `payment-page` pattern.

---

## 16. New database objects

All additive. No existing table is altered except `partners`, which gains one
column.

| Object | Purpose |
| ------ | ------- |
| `partner_api_keys` | Section 4.1 |
| `partner_api_requests` | Section 11 |
| `partner_webhook_endpoints` | Section 13.1 |
| `partner_webhook_deliveries` | Section 13.2 |
| `reference_provider_events` | Section 15.3 |
| `partners.referencing_mode` | Section 3 |
| `create_referral_api(...)` | Section 2.1 |

Deferred until the modes they serve are built: the criteria store, the decision
record, and widening `applications.status` to include `declined`.

---

## 17. Open questions

These need answering before this could be built. They are ordered by how much
they change the design.

**1. Does a `pre_referenced_open` decline exist at all?** The spec assumes
Rightmove applications are never declined by Opndoor. If Opndoor retains a veto
for fraud or an unservable property, that is a decline path in a mode defined as
having none, and it needs its own vocabulary.

**2. What are the acceptance criteria, and who owns them?** They have not been
written down anywhere, in the codebase or outside it. This is an Opndoor
business gap and it is the blocking item for `pre_referenced_screened`. We need
the actual rules, whether they vary per partner, whether they are versioned, and
who can change them.

It blocks nothing today. Rightmove are `pre_referenced_open` and need no
criteria, and `pre_referenced_screened` is not being built now. It becomes
urgent at the first partner who is not Rightmove.

**3. Should a declined application be visible in the portal?** It has no
`applications` row today because `status` has no `declined` value. Options are a
row with a new status, a separate table, or nothing at all. This determines
whether declines appear in exports and the league table, which has commercial
implications.

**4. Should `referrer_name` be backfillable?** Section 8.2 explains why naming a
user does not fix existing applications. Pre-creating users avoids it, but a
one-off backfill utility may be wanted anyway. It is a small piece of work with a
disproportionate effect on how the portal reads.

**5. What is the payment link's lifetime and reissue policy over an API?** The
portal has a reissue path today. A partner receiving a `payment_url` will
eventually ask for a fresh one, and whether that is an endpoint, a webhook, or a
support request is undecided.

**6. How long are `partner_api_requests` retained?** It holds full response
bodies containing tenant PII, and grows by one row per request. Retention has
both a storage and a data protection dimension.

**7. Can a partner update or cancel an application after POST?** The spec is
create-only. Tenancy start dates change and tenants withdraw. There is an
existing amendment path in the portal, and whether partners reach it is
undecided.

**8. What happens to in-flight applications if a partner's mode changes?**
Changing `referencing_mode` on a partner with live applications is
underspecified. The safest answer is that mode is captured per application at
creation and never re-read, but that is a design decision, not a given.

**9. Does Rightmove need to send anything not in the New Application form?**
The payload mirrors the form. If Rightmove holds a reference id, a tenancy end
date or a property reference they expect to round-trip, there is nowhere to put
it today and no `metadata` field is specified.

**10. Who operates the webhook dispatcher?** Section 13.2 needs something to run
it. The repo's only scheduling mechanism is pg_cron calling Edge Functions, which
is minute-granularity and would make delivery latency up to a minute. Whether
that is acceptable, or whether dispatch should be triggered on enqueue, is
undecided.

**11. How is this API versioned?** Noticed while documenting what was built, and
it needs answering before a partner integrates rather than after. The live base
is `/functions/v1/partner-api/`, where `v1` is Supabase's Edge Function API
version, not ours. Nothing in the surface carries an Opndoor version, so there is
currently no way to ship a breaking change without breaking every partner at
once. The cheapest fix is a path segment added now, one line in the router. A
custom domain is tidier and can follow later, provided the segment exists from
the start. Cheap today, expensive after the first integration.
