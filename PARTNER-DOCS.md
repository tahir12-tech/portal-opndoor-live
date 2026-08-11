# Opndoor Partner API

Reference documentation, published to partner developers through the Dev Centre.

<!--
  MAINTAINER NOTE, stripped before publication.

  THIS FILE IS PARTNER-FACING. Everything in it is read by people outside
  Opndoor. PARTNER-API.md is the internal design record and is NOT the source of
  these docs any more: it cites migration filenames and line numbers, names
  internal functions and tables, records what earlier drafts did, and discusses
  weaknesses in our own verification. Generating partner docs by filtering that
  file meant every new paragraph was a leak waiting to be caught by a regex.

  So the two documents have different jobs. PARTNER-API.md says why. This says
  what, in the voice of reference documentation: rationale appears only where it
  changes what a partner writes.

  Rules for editing:
    - no file paths, migration names, line citations or internal identifiers
    - no hosting or infrastructure detail
    - no roadmap, no "not built yet", no drafting history
    - no internal status values, only the partner vocabulary
    - cross-reference by section NAME, never by number

  Run: node scripts/generate-partner-docs.mjs
  The generator refuses to write if any of the above survives.
-->

## Base URL and versioning

The base is `https://api.opndoor.co/v1`, so a request looks like:

```
GET https://api.opndoor.co/v1/orgs
```

The version segment is required. A request without it, or with a version that is
not supported, returns:

```
HTTP 404
{"error":{"code":"unsupported_version",
          "message":"Prefix the path with an API version. Supported: v1."}}
```

Idempotency keys are not version-qualified, so the same key sent to two API
versions with the same body replays rather than creating a second application.

## Authentication

Send your key as a bearer token on every request:

```
Authorization: Bearer opnd_live_<32 characters>
```

Keys are shown once, when they are created, and cannot be retrieved afterwards.
If a key is lost, revoke it and create another.

**The prefix tells you the mode.** `opnd_test_` keys create sandbox
applications; `opnd_live_` keys create real ones. Nothing else differs: the same
endpoints, the same payloads, the same responses. Going live means swapping the
key. The mode is never read from the request body, so there is no flag to set and
none to forget.

Sandbox applications charge test cards, produce watermarked documents, and send
no Opndoor email. See **Sandbox** below.

### Every authentication failure looks the same

A missing header, a malformed key, an unknown key, a wrong key, a revoked key and
an expired key all return exactly this:

```
HTTP 401
{"error":{"code":"unauthorized","message":"Invalid credentials."}}
```

Identical status, identical body, identical headers, and they take the same time
to answer. If you are debugging a 401, the cause is on your side and the Dev
Centre's Logs tab will show you the request we received.

### Scopes

A key carries the scopes it was created with. A request needing a scope the key
lacks returns `403 insufficient_scope`.

| Scope | Allows |
| ----- | ------ |
| `applications:write` | Create applications |
| `applications:read` | Read applications |
| `orgs:read` | List agencies and branches |
| `webhooks:manage` | Manage webhook endpoints |

Scopes are independent of everything else about your account. No scope is implied
by another.

## Statuses

An application reports one of these:

| Status | Meaning |
| ------ | ------- |
| `sent` | Created. Waiting for the tenant to pay. |
| `paid` | The guarantor fee has been paid. |
| `deed_issued` | The Deed of Guarantee has been signed and issued. |
| `lapsed` | Unpaid, and automatically closed. See **When an application lapses**. |
| `withdrawn` | Closed before payment, by the tenant or by staff. |

The `?status=` filter takes these same words.

### `lapsed` is not the guarantee expiring

`lapsed` means an unpaid application was closed. `expiry_date` on a live
application is a different thing entirely: the guarantee expires twelve months
after the tenancy start date. They are months apart and mean opposite things
commercially, so do not treat one as the other.

### When an application lapses

An unpaid application lapses **15 days after it was sent**.

The comparison is made against the start of the day, not the time of day, so an
application sent at any hour on a given day lapses on the same day as one sent a
minute before midnight. Practically: an application sent on the 1st lapses on the
16th.

### Status is not monotonic

An application can move backwards. A `lapsed` application, or one a tenant
declined, becomes `paid` if the tenant pays late.

**Write your handler so a status can go back.** If you treat `lapsed` as
terminal and stop listening, your record will be permanently wrong for a tenant
who paid a day late. This is not an edge case; it is the normal outcome of a
tenant who took longer than a fortnight.

## Organisations

Every application belongs to one of your branches. **Create your agencies and
branches in the opndoor portal first**, each with a contact email. The API
resolves what you name; it never creates an organisation for you.

### Naming them

The straightforward way is to send the names you already hold:

```jsonc
"org": {
  "agency_name": "Foo Lettings",
  "branch_name": "Camden"
}
```

Names are matched **ignoring case, surrounding whitespace, and a trailing `Ltd`
or `Limited`**, so `"  FOO LETTINGS LTD "` matches a stored `Foo Lettings`. You do
not need to normalise anything before sending.

If the agency has exactly one branch you may omit `branch_name` and we will use
it. If it has several, name the one you mean.

**If a name does not match, the application is rejected and nothing is created.**
Create the organisation in the portal, then send again. The error names the
branches we do hold under that agency, so a near miss is usually obvious:

```json
{ "field": "org.branch_name", "code": "not_found",
  "message": "No branch of that name exists under that agency. Create it in the
              opndoor portal first. Branches we hold: Camden, Islington." }
```

If a name matches more than one of your organisations, the application is
rejected as `ambiguous` rather than guessed at. That is a duplicate on our side:
send ids instead, or contact opndoor to have them merged.

### Using our ids instead

`GET /v1/orgs` returns every agency and branch on your account with our ids.

```
GET /v1/orgs
```

**You do not need this to get started.** It is worth doing once, storing our
`agency_id` and `branch_id` against your own records, and sending those from then
on:

```jsonc
"org": {
  "agency_id": "…",
  "branch_id": "…"
}
```

Ids are exact, so they cannot be affected by a rename or by two branches ending
up with similar names. Send both or neither: an id and a name together is not a
valid combination.

### `has_agent_contact`

Every branch in `GET /v1/orgs` carries `has_agent_contact`. **If it is `false`,
do not send applications against that branch.** No agent contact can be resolved
for it, so a Deed of Guarantee could not be issued: the tenant would pay and the
deed would then fail. Add a contact in the portal first.

An application naming such a branch is rejected at creation, with
`code: "no_agent_contact"`, rather than accepted and failed later.

## Creating an application

```
POST /v1/applications
Authorization: Bearer opnd_test_...
Idempotency-Key: your-unique-string
Content-Type: application/json
```

```jsonc
{
  "tenant": {
    "title":         "Mr",           // required: Mr, Mrs, Miss, Ms, Mx or Dr
    "first_name":    "Jo",           // required
    "last_name":     "Bloggs",       // required
    "date_of_birth": "1990-04-12",   // required, ISO 8601, must be in the past
    "email":         "jo@example.com", // required
    "phone":         "07700900000"   // required, must contain a digit
  },

  "property": {
    "address_line_1": "1 High Street", // required
    "address_line_2": null,            // optional
    "city":           "London",        // required
    "county":         null,            // optional
    "postcode":       "SW1A 1AA"       // required, UK format
  },

  "tenancy": {
    "monthly_rent": 1250.00,           // required, greater than zero
    "start_date":   "2026-09-01"       // required
  },

  "org": {                             // names, or our ids: see Organisations
    "agency_name": "Foo Lettings",
    "branch_name":  "Camden"
  },

  "referrer": {
    "email": "agent@youragency.co.uk"  // required
  }
}
```

The response carries the created application, including its `guarantee_ref` and,
while it is still payable, a payment link to give the tenant.

### Idempotency

`Idempotency-Key` is required on `POST /v1/applications`. Send the same key with
the same body and you get the original application back rather than a second one,
which is what makes retrying after a timeout safe.

- Same key, same body: the first response is replayed.
- Same key, **different** body: `409 idempotency_key_reused`. Almost always a
  key reused for a genuinely different application.
- Same key, still processing: `409 request_in_progress`. Retry shortly.

Use a value unique to the application on your side, not a timestamp or a random
value per attempt, or retries create duplicates.

## Validation errors

A rejected application returns `422` with one entry per problem:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Some fields need attention.",
    "fields": [
      { "field": "tenant.email", "code": "invalid_format",
        "message": "Enter a valid email address." }
    ]
  }
}
```

Match on `field` and `code`. The `message` is written for humans and may change.

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
| `org.agency_name` | `required`, `not_found`, `ambiguous` |
| `org.branch_name` | `required`, `not_found`, `ambiguous`, `no_agent_contact` |
| `org.agency_id`, `org.branch_id` | `required`, `not_found`, `no_agent_contact` |
| `referrer.email` | `required`, `not_available`, `could_not_provision` |

Two are worth understanding rather than just handling.

**`no_agent_contact`** means that branch cannot resolve an agent contact, so no
deed could be issued for it. It is rejected at creation rather than after the
tenant has paid. `GET /v1/orgs` reports the same condition as
`has_agent_contact`, so you can find these before sending traffic.

**`ambiguous`** means the name you sent matches more than one of your
organisations. That is a duplicate on our side rather than an error in your
request. Send ids, or contact opndoor to have them merged.

**`referrer.email: not_available`** means the address is already in use under a
different account. It deliberately does not say which.

## Reading applications

```
GET /v1/applications?status=paid&limit=50
GET /v1/applications/{id}
```

Paging is by cursor. Pass the `next_cursor` from the previous response:

```
GET /v1/applications?limit=50&cursor=<next_cursor>
```

**`next_cursor` is `null` on the last page.** That is the signal to stop; there
is no separate `has_more` field. Walking with a cursor is stable while new
applications are being created, which walking by page number is not.

## Webhooks

Register an endpoint in the Dev Centre. You are given a signing secret once, at
that moment, and it is not retrievable afterwards.

Sandbox and live are separate registries. Pointing both at the same URL is fine
and expected: each endpoint has its own secret, so you can tell them apart by
which secret verifies, or by the `livemode` field in the payload.

### Verifying the signature

Every delivery carries:

```
X-Opndoor-Signature: t=1735689600,v1=<hex>
X-Opndoor-Event-Id: <uuid>
X-Opndoor-Event-Type: application.paid
```

`v1` is HMAC-SHA256 over the string `"<t>.<raw body>"`, keyed with your endpoint
secret, hex encoded.

**Sign the raw body, before any parsing or re-serialising.** Re-encoding JSON
changes the bytes and the signature will not match.

Verify `t` is recent, and reject anything older than your tolerance, five minutes
being a reasonable default. Compare the hex with a constant-time comparison.

Use the Dev Centre's **Send test event** to confirm your verification works
before real traffic arrives. It signs through exactly the same code path a real
delivery uses.

### Delivery and retries

Deliveries are at-most-once per endpoint, application and event type. A failed
delivery is retried on a backoff schedule and then dead-lettered; you can replay
it from the Dev Centre once your endpoint is fixed.

Dedupe on `X-Opndoor-Event-Id`. A replay sends the same event id again, so an
idempotent handler needs no special case for it.

Respond `2xx` to accept. Anything else is treated as a failure and retried.

### Events

| Event | Fires when |
| ----- | ---------- |
| `application.created` | An application is created and accepted |
| `application.paid` | The guarantor fee is paid |
| `application.deed_issued` | The Deed of Guarantee is executed |
| `application.lapsed` | An unpaid application closes automatically |
| `application.withdrawn` | An application is withdrawn before payment |
| `application.reinstated` | A lapsed or declined application is paid late |

Statuses inside payloads use the vocabulary in **Statuses**.

### `application.reinstated` replaces `application.paid`

When a lapsed or tenant-declined application is paid late, you receive
`application.reinstated` **instead of** `application.paid`, not in addition.

This matters for how you write the handler. If you count `application.paid` as a
first payment, a reinstatement must not be counted again; and if you stopped
listening after `application.lapsed`, this is the event that corrects your
record. Handle it as "this application is now paid, whatever you previously
believed".

### Payload

```jsonc
{
  "event_type": "application.paid",
  "livemode": true,
  "application": {
    "id": "uuid",
    "guarantee_ref": "GR-20604",
    "status": "paid",
    "created_at": "...", "sent_at": "...", "paid_at": "...",
    "deed_issued_at": null, "expiry_date": null,
    "tenant":   { "title": "...", "first_name": "...", "last_name": "...",
                  "date_of_birth": "...", "email": "...", "phone": "..." },
    "property": { "address_line_1": "...", "address_line_2": null,
                  "city": "...", "county": null, "postcode": "..." },
    "tenancy":  { "monthly_rent": 1250.00, "start_date": "2026-09-01" },
    "org":      { "agency_id": "uuid", "agency_name": "...",
                  "branch_id": "uuid", "branch_name": "..." }
  }
}
```

Payloads are rendered when the event happens and never re-rendered, so a retry
delivers what was true at the time rather than what is true now.

## Sandbox

A sandbox key gives you the whole integration to rehearse against, in the same
account, at the same URL, with the same login.

- Payments use test cards. No money moves.
- Deeds are produced and are watermarked as developer documents.
- Opndoor sends no email at all: no payment link, no receipt, no reminders, and
  nothing to the agent.
- Sandbox references are prefixed `GR-TEST-` so they cannot be confused with real
  ones.
- Sandbox applications appear only in the Dev Centre.

**One thing does leave our system.** The document provider sends its own signing
email to whatever address you supply as `tenant.email`. Use an address you own.

Going live is swapping the key for an `opnd_live_` one. Nothing else changes.

## Rate limits

**600 requests per minute per key.** Every authenticated response tells you where
you stand:

```
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 597
X-RateLimit-Reset: 1735689660
```

`X-RateLimit-Reset` is a Unix timestamp in seconds, the moment the current window
ends and `Remaining` returns to `Limit`. Read these on successful calls and slow
down before you run out, rather than discovering the limit by hitting it.

Exceeding it returns:

```
HTTP 429
Retry-After: 43
{"error":{"code":"rate_limited","message":"Too many requests."}}
```

`Retry-After` is in seconds and is never zero. Wait for it: a retry inside the
window is refused again and consumes budget without succeeding.

**Failed** authentications are limited separately and more tightly, by origin
address, so repeated guessing is throttled. Successful calls never count against
it, so a valid key gets its full allowance no matter how many requests it makes
from one address. Those refusals carry `Retry-After` but **no** `X-RateLimit`
headers, deliberately: before a key is verified we will not report how much of an
allowance remains.

A retryable `503 service_unavailable` also carries `Retry-After`.

## Errors

| Status | Code | Meaning |
| ------ | ---- | ------- |
| 400 | `malformed_request` | Not valid JSON, or a missing idempotency key |
| 401 | `unauthorized` | Any authentication failure |
| 403 | `insufficient_scope` | The key lacks the required scope |
| 403 | `partner_inactive` | The account is not active |
| 404 | `not_found` | Unknown, or not yours |
| 404 | `unsupported_version` | No API version in the path, or one not supported |
| 409 | `idempotency_key_reused` | Same key, different body |
| 409 | `request_in_progress` | Same key, still processing |
| 422 | `validation_failed` | Field errors, listed in `fields` |
| 429 | `rate_limited` | Too many requests. `Retry-After` says when |
| 500 | `internal_error` | Something went wrong our end |
| 503 | `service_unavailable` | Temporarily unavailable, safe to retry |

Every response carries `X-Request-Id`. Quote it when contacting support: it lets
us find the exact request without you having to reproduce it.

A resource that is not yours returns `404`, not `403`, so the API cannot be used
to discover what exists.

<!--
  ===========================================================================
  MACHINE-READABLE DESCRIPTION. Stripped before publication.

  The OpenAPI document is generated from THIS block by the same script that
  renders the prose above, so the two cannot drift: one file, one run, two
  outputs. Editing the prose without editing this block is the drift risk, and
  the generator reports the endpoint and schema count on every run so a
  divergence shows up as a number that stopped changing.

  It is YAML-ish JSON on purpose: a literal JSON object, so the generator parses
  it rather than templating strings together, and a malformed edit fails the
  build instead of producing a spec that does not open.
  ===========================================================================
```openapi-source
{
  "servers": [{ "url": "https://api.opndoor.co/v1", "description": "Production" }],
  "rateLimit": { "perKey": 600, "windowSecs": 60 },
  "paths": {
    "/orgs": {
      "get": {
        "summary": "List your agencies and branches",
        "description": "Call once, store the ids against your own records, and send them from then on if you want precision. You can also send names on POST /applications instead.",
        "scope": "orgs:read",
        "responseSchema": "OrgList"
      }
    },
    "/applications": {
      "get": {
        "summary": "List applications",
        "description": "Keyset paginated, newest first. next_cursor is null on the last page; there is no has_more field.",
        "scope": "applications:read",
        "query": ["status", "limit", "cursor"],
        "responseSchema": "ApplicationList"
      },
      "post": {
        "summary": "Create an application",
        "description": "Idempotency-Key is required. The organisation must already exist: send names or ids, never both.",
        "scope": "applications:write",
        "idempotent": true,
        "requestSchema": "CreateApplication",
        "responseSchema": "CreateApplicationResponse",
        "created": true
      }
    },
    "/applications/{id}": {
      "get": {
        "summary": "Read one application",
        "scope": "applications:read",
        "pathParam": "id",
        "responseSchema": "Application"
      }
    }
  }
}
```
-->
