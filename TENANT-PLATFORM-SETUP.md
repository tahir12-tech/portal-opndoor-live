# Standing the tenant platform up

**Balal: this is the runbook.** Ordered by dependency, with the exact command
and a check that proves each step worked. Nothing here needs a decision from
you; where a decision is needed the step says who owns it and stops.

`TENANT-PLATFORM.md` is why it is shaped this way. This is only how to run it.

**Time, honestly.** Stages 1 and 2 are about an hour and get most of it working.
Stage 3 is not yours to unblock and is waiting on other people.

---

## What each stage gets you

| After | A tenant can |
| ----- | ------------ |
| Stage 1 | Nothing yet. The schema and code are there |
| Stage 2 | **Register, verify by email, fill the whole form, upload documents, save and resume, and be refused at submission until the fee clears.** Most of the product |
| Stage 3 | Pay the fee by card, be approved or declined, pay the guarantee fee, receive a deed |

Stage 2 is the honest stopping point for a first look. Everything in Stage 3
depends on somebody outside this repo.

---

## Stage 1 — Apply and deploy (20 minutes)

### 1.1 Apply the migrations

```sh
npx supabase@2.111.0 db push --dry-run     # read the list first
npx supabase@2.111.0 db push
```

24 migrations in the `20260812` series. They are additive except two, both
deliberate and both documented in their own headers: `20260812050000` widens the
application status set, and `20260812030000` partitions the CRM cursor.

**Check it worked.** Every one of these should return true:

```sql
select
  (select count(*) from public.partners where is_house_route) = 2      as house_routes,
  to_regclass('public.applicants')                is not null          as applicants,
  to_regclass('public.application_profiles')      is not null          as profiles,
  to_regclass('public.tenant_email_codes')        is not null          as codes,
  to_regclass('public.tenant_invites')            is not null          as invites,
  (select count(*) from storage.buckets
     where id in ('applicant-docs','reference-reports')) = 2           as buckets;
```

### 1.2 Deploy the Edge Functions

All four are `verify_jwt = false` and **must** be deployed with the flag, or the
platform rejects every request before the code runs and every response is a 401
identical to a bad credential.

```sh
for f in tenant-auth tenant-portal referencing-inbound referencing-callback; do
  npx supabase@2.111.0 functions deploy "$f" --no-verify-jwt
done
```

Three existing functions also changed and need redeploying:

```sh
for f in create-referral stripe-webhook hubspot-sync; do
  npx supabase@2.111.0 functions deploy "$f" --no-verify-jwt
done
```

> **`hubspot-sync` is not optional and is time-sensitive.** Migration
> `20260812030000` drops the old `hubspot_pending_events` signature, so the
> deployed function fails on every run from the moment 1.1 lands until this
> deploy. Nothing is lost and the cron retries, but it raises incidents until
> you do it. Do 1.1 and 1.2 in the same sitting.

**Check it worked.** Both should be `401`, which proves the function booted and
reached its own auth check:

```sh
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "https://<ref>.supabase.co/functions/v1/referencing-inbound" \
  -H 'Content-Type: application/json' -d '{"table_id":1}'
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "https://<ref>.supabase.co/functions/v1/referencing-callback" \
  -H 'Content-Type: application/json' -d '{}'
```

---

## Stage 2 — Configuration (30 minutes)

### 2.1 `APP_URL` — do this one first

```sh
npx supabase@2.111.0 secrets set APP_URL=https://<the portal's real origin>
```

**Why it is first.** Password-reset and verification links are built from it,
and `tenant-auth` **refuses to send at all** when it is unset and the caller is
not localhost. Unset in production means no tenant reset mail is sent, silently.

That refusal is deliberate. It previously built links from the caller's own
`origin`, which meant one unauthenticated request could have opndoor's sender
deliver a live recovery token to a host an attacker named. Fixed, and the
strictness is the fix.

**Check.** `request_reset` for a known tenant address should produce an email.
If none arrives and 2.2 is done, `APP_URL` is wrong.

### 2.2 Email delivery

Tenant registration issues a six-digit code and sends it through the same
provider as everything else. **If no key is set, codes are issued and never
delivered**, and registration looks broken to the person doing it.

This is the same switch as `HANDOVER.md` item 3, so settle that first: the same
key turns on tenant mail and thirteen other senders at once.

**Check.** Register a throwaway address on the real site and see if the code
arrives.

### 2.3 Address lookup (optional, two minutes)

```sh
# .env.local, alongside the other VITE_ vars
VITE_ADDRESS_LOOKUP_KEY=<ideal-postcodes key>
```

The tenant form and the staff New Application form use the same service, so one
key turns on both. Without it both fall back to manual entry and no "Find
address" button renders, which is correct rather than broken.

### 2.4 Schedule the callback (only once Stage 3.1 is done)

`referencing-callback` tells the provider a policy document exists. It refuses
as a whole while unconfigured, so scheduling it early is harmless.

```sql
select cron.schedule('referencing-callback', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/referencing-callback',
    headers := jsonb_build_object('x-ops-secret', (select secret from public.ops_secrets where name = 'reminders_cron'))
  );
$$);
```

---

## Stage 3 — Waiting on other people

**The asks are written up as a single list in `docs/ASK-THE-DEVELOPER.md`**,
ordered by what unblocks the most, with what we build the moment each lands.
Send that rather than describing the items below individually.


Each of these blocks a specific thing and none of them is yours to decide.

### 3.1 The eligibility provider's credentials and token

```sh
npx supabase@2.111.0 secrets set \
  REFERENCING_API_URL=... REFERENCING_API_EMAIL=... \
  REFERENCING_API_PASSWORD=... REFERENCING_API_TOKEN=...
```

And one inbound token row, stored **hashed**, never in the clear:

```sql
insert into public.referencing_inbound_tokens (name, token_hash, agency_number, partner_id, livemode)
values ('provider inbound',
        encode(digest('<the shared secret they give you>', 'sha256'), 'hex'),
        null,                                   -- see HANDOVER item 25
        (select id from public.partners where slug = 'referencing-partner'),
        true);
```

`agency_number` null means the token authenticates the provider as a whole and
the agency comes from the payload. If they can issue one token per agency, use
that instead: it is the stronger form. Every inbound event records
`agency_from_token`, so you can read which is actually in use off production.

**Blocks:** rail 4 entirely, and the outbound callback.

### 3.2 The decision inbound — **the big one**

> **How does the pass or fail decision reach us on the rails where WE arrange
> the check?** The integration documents show the sync going out and only ids
> coming back. There is no documented inbound for the verdict.

`draft → referencing` works. `referencing → approved` **has no trigger and
cannot be built without this.** Everything after submission on rails 1 and 2 is
blocked on one answer from the provider.

**Blocks:** the entire second half of the tenant journey.

### 3.3 Stripe: a test webhook, and the livemode question

Two separate things, and the second is not obvious:

1. No Stripe webhook is registered against the dev project. `stripe_events` is
   empty; nothing has ever arrived.
2. **Even with one, a dev payment would be refused.** Applications are created
   `livemode = true`, dev holds a **test** key, and `refuseOnModeMismatch`
   (`stripe-webhook/index.ts:69`) is a hard equality with no non-production
   exemption. A test event against a live-mode application is refused with a 500
   and an ops alert.

That is correct behaviour, and it means **the dev project cannot complete a card
payment for any non-sandbox application**. To test payments for real, either
create the application through a sandbox API key so it is `livemode = false`, or
test on an environment with a live key. Worth settling before go-live.

To get past the fee meanwhile, do what the webhook would do:

```sql
select public.record_eligibility_payment(
  '<application id>', 20, 'sim-' || gen_random_uuid()::text, null, true);
```

**Blocks:** paying the £20 by card, and the guarantee fee.

### 3.4 Yoti and Kreditz

Read `TENANT-PLATFORM.md` section 6.1 before starting either. The commercial
position decides the architecture: **we call them under the provider's
credentials, so the results are the provider's and must never enter our
outbound sync.** The manual upload path already works and is the documented
fallback, so nothing is broken while you wait.

**Blocks:** the guided ID check and the bank connection. Not the journey.

---

## If something is wrong

`REGRESSION.md` sections F to H cover this work. Run **H14 first**: it mounts
the tenant journey and is the cheapest way to find out whether the front end is
alive. Then **F** for anything that looks like the referral path has moved,
because F is the section written to prove it has not.
