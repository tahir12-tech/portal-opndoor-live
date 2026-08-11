# Handover

Written for the developer taking this over. Assumes no knowledge of the session
that produced it.

**Status:** in progress. This document is updated as work lands. See
[Open items](#open-items-for-you) for what needs you.

**If you read one thing before deploying, read the first box below.** It is the
difference between the partner API working and it refusing every request while
appearing healthy.

### The documents, and which is which

| File | What it is | Audience |
| ---- | ---------- | -------- |
| `HANDOVER.md` | This. What changed, why, and what needs you. | You |
| `DEFECTS.md` | 15 defects in the **live** system, worst first. None introduced by this work. | You |
| `REGRESSION.md` | A walk-through of the platform, written to pass on day one. Defect-tagged rows read as deliberate fixes. | You |
| `PARTNER-API.md` | **Internal** design record for the partner API. Cites migrations, names internal functions, discusses our own weaknesses. | Us only |
| `PARTNER-DOCS.md` | **Partner-facing** reference. This is what the Dev Centre publishes. | Partner developers |
| `SANDBOX-MODE-SCOPE.md` | Superseded. A record of the decision point before sandbox was built. | Historical |

The last two names are similar and the difference matters: **`-DOCS` goes out,
`-API` does not.** The documentation panel generates from `PARTNER-DOCS.md` and
refuses to build if internal detail appears in it.

> ### 🚨 WATCH THE OUTPUT OF THE RIGHTMOVE MIGRATION ON PRODUCTION
>
> Migration `20260811090000_rightmove_referencing_mode.sql` is what **turns the
> partner API on**. Until it applies successfully to a real Rightmove partner row,
> `POST /v1/applications` returns `501 not_implemented` **for every partner**, and
> nothing else about the request fails: the key authenticates, the scopes pass,
> the payload validates, and then it refuses.
>
> **It matches on slug and name, because no migration has ever inserted a partner
> and this repo does not know Rightmove's id.** If the name in production is not
> what it expects, it matches nothing, and the push still succeeds. Everything
> will look fine. The API will be off.
>
> **When you run `db push` on production, read the output.** You are looking for
> either of these:
>
> ```
> NOTICE:  Rightmove partner "..." (slug ...): referencing_mode
>          pre_referenced_screened -> pre_referenced_open.
>          The partner API is now live for them.
> ```
>
> ```
> WARNING:  NO RIGHTMOVE PARTNER MATCHED.
> ```
>
> **If you see the warning, or see neither**, the API is still refusing every
> request. Fix it by hand:
>
> ```sql
> -- 1. find them
> select id, slug, name, referencing_mode from public.partners order by name;
>
> -- 2. set the one that is Rightmove
> update public.partners
>    set referencing_mode = 'pre_referenced_open'
>  where slug = '<their-slug>';
>
> -- 3. record it, so the change is on their audit history rather than invisible
> insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
> select id, 'referencing_mode', 'pre_referenced_screened', 'pre_referenced_open',
>        'set by hand after migration 20260811090000 matched nothing'
>   from public.partners where slug = '<their-slug>';
> ```
>
> **Then verify, rather than assuming:**
>
> ```sql
> select slug, name, referencing_mode from public.partners
>  where referencing_mode = 'pre_referenced_open';
> -- Rightmove must appear. If this returns no rows, the API is off.
> ```
>
> and end to end, with a real key:
>
> ```sh
> curl -s -o /dev/null -w '%{http_code}\n' -X POST \
>   -H "Authorization: Bearer <a good key>" \
>   -H "Idempotency-Key: watchpoint-$(date +%s)" \
>   -H "Content-Type: application/json" \
>   -d '{}' https://api.opndoor.co/v1/applications
> # 422  -> the API is ON. It got as far as validating an empty body.
> # 501  -> still refusing. referencing_mode is not set. Go back to step 1.
> ```
>
> A `422` is the good outcome here: it means the request reached validation,
> which is past the mode check. Do not read it as a failure.
>
> **Why the migration warns rather than fails.** A disposable dev project may
> genuinely have no Rightmove row, and raising there would block every later
> migration for no reason. That trade puts the burden on whoever runs the
> production push, which is why this is at the top of the document.
>
> `pre_referenced_screened` and `opndoor_referenced` are specified but not built,
> and every other partner stays on `pre_referenced_screened` and continues to get
> `501`. That is the correct refusal: accepting them would approve every applicant
> with no criteria applied, look exactly like working software, and surface as a
> commercial problem months later.

> ### ⚠️ Read this before deploying `partner-api`
>
> **The `partner-api` Edge Function must be deployed with `verify_jwt = false`.**
>
> ```sh
> npx -y supabase@2.111.0 functions deploy partner-api --no-verify-jwt
> ```
>
> It authenticates with a partner API key in the `Authorization` header, not a
> Supabase JWT. With JWT verification left on, the platform rejects every request
> before any of this code runs, so **every partner call fails with a 401 that
> looks exactly like a bad API key**. Nothing in the logs distinguishes the two,
> and the partner-facing error is deliberately identical for all auth failures,
> so this is close to undiagnosable from the outside.
>
> **It is not versioned.** There is no `config.toml` in this repo, so `verify_jwt`
> lives in the Supabase dashboard. A plain `functions deploy partner-api`, by
> anyone, at any point, silently re-enables it. `stripe-webhook` and
> `payment-page` carry the same exposure for the same reason.
>
> Verify after any deploy by calling the endpoint with a key you know is good and
> confirming a `200`. See section 9.

> ### ⚠️ `tsc -p tsconfig.json` checks nothing
>
> `tsconfig.json` has `"files": []` and only project references, so:
>
> ```sh
> npx tsc --noEmit -p tsconfig.json     # exit 0, ZERO files checked. Meaningless.
> npx tsc --noEmit -p tsconfig.app.json # 98 files. This is the real one.
> npx tsc -b                            # follows the references. Also real.
> ```
>
> Measured, not assumed: `--listFiles` reports **0** project files for the first
> and **98** for the second.
>
> This matters because the vacuous command **exits 0 and prints nothing**, which
> is exactly what a passing check looks like. It was used during this work and
> reported as clean; switching to the real one immediately surfaced two type
> errors it had waved through. If you add CI, use `tsc -b`.

> ### ⚠️ Grep the built bundle, not just the source
>
> **This belongs in CI the moment `npm ci` works** (defect 11). It found two
> leaks in a single day that neither `tsc` nor `npm run build` would ever flag,
> because a leaked string is perfectly valid TypeScript that compiles and bundles
> without complaint.
>
> 1. The entire `PARTNER-API.md` was inlined into the bundle by a `?raw` import.
>    The component filtered it at render time, which filters what is rendered and
>    not what ships, so the whole internal specification was readable in devtools.
> 2. After the `partners` select was narrowed to keep commission rates away from
>    developers, the grep showed a **second** select still carrying them:
>    `applications` holds its own rate snapshot.
>
> Neither was visible in a review of the diff. The full script and the two
> expected non-leak hits are in `REGRESSION.md`, section "The built-artefact
> grep".
>
> The general rule this is an instance of: **check the artefact you ship, not the
> source you wrote.** A bundler inlines, minifies and tree-shakes, and what
> survives is not always what you intended.

---

## 1. What this working copy is

This is a copy of the live Opndoor portal codebase, taken so that changes can be
designed against a disposable environment rather than production.

The portal runs the guarantor service: partner staff refer a tenant who has
failed referencing, the tenant pays one month's rent through a tokenised link,
and a Deed of Guarantee is issued through PandaDoc.

Because it is a copy of live, it arrived still wired to the live Supabase
project. The first piece of work was disconnecting it. That is what section 2
covers.

### The rule this tree is built under

Changes here are **additive wherever possible**: new files and new migrations,
not edits to existing ones. The reason is that this tree gets reconciled against
live later, and additive changes merge cleanly while edits to existing files
produce conflicts that have to be resolved by hand under time pressure.

Where an existing file *was* modified, it is called out explicitly below with
the reason. Treat every such case as something to check rather than assume.

### The documents in this tree

| File | What it is | Who it is for |
| ---- | ---------- | ------------- |
| `HANDOVER.md` | This file. What was changed here, why, and what needs you | You |
| `DEFECTS.md` | Defects found in the **live** system, not introduced here and not fixed here | You, raised separately |
| `PARTNER-API.md` | The partner API and webhooks. Specification **and** what is built, with a status table at the top | Whoever extends it |
| `REGRESSION.md` | Test plan for the whole platform, lifecycle and partner API. Written to pass on day one | You, and whoever tests |
| `scripts/generate-partner-docs.mjs` | Regenerates the Dev Centre docs from `PARTNER-API.md`. Re-run after editing the spec | Whoever edits the spec |

---

## 2. Disconnecting this copy from production

### Why

The tree was pointed at the live Supabase project `xogpsaoyprgmxdkmcype`
("portal.opndoor.Live") and carried a **live-mode Stripe publishable key**. Any
`supabase` CLI command run in it would have targeted production, and any local
run of the app would have talked to the live database and the live Stripe
account.

It is now pointed at `nfufwcpgrhfgwtphegca` ("opndoor-matt-dev"), a disposable
project.

### What changed

**Deleted `supabase/.temp/`.** Untracked CLI state directory. It held
`project-ref` and `linked-project.json` naming the live project, plus a
`pooler-url` with the live database host. Deleting it is safe: the Supabase CLI
regenerates this directory on the next `link`.

**Replaced `.env.local`.** It previously set `VITE_SUPABASE_URL` to the live
project and `VITE_STRIPE_PUBLISHABLE_KEY` to a `pk_live_` key. It now contains
only three lines pointing at the dev project with a Stripe **test** publishable
key.

This file is gitignored (`.env.*` in [.gitignore](.gitignore)), so none of the
live values were ever committed. Verified, not assumed.

**Removed a tracked CLI artefact that was leaking the live ref into git.**
See section 3, which is the part most worth your attention.

### A CLI version trap, if you script any of this

`npx supabase link --project-ref <ref>` **fails on CLI 2.112.0**, which is what
a bare `npx supabase` resolves to at the time of writing. It dies with:

```
LegacyLinkApiKeysNetworkError: failed to get api keys: SchemaError(
  Expected a string matching the RegExp ...T...Z$ at [2]["inserted_at"])
```

The API returns an `inserted_at` timestamp in a format the CLI's validator
rejects. This is a CLI bug, not a problem with the project or your credentials.

The trap is that **it half-succeeds**. It writes `linked-project.json` before it
crashes but never writes `project-ref`. So the directory looks linked while the
CLI still reports "Cannot find project ref. Have you run supabase link?".

**Pin to `supabase@2.111.0`**, which links cleanly:

```sh
npx -y supabase@2.111.0 link --project-ref nfufwcpgrhfgwtphegca
```

If you automate linking anywhere, pin the version rather than tracking latest.

### How to verify the disconnection yourself

```sh
cat supabase/.temp/project-ref          # expect: nfufwcpgrhfgwtphegca
cat supabase/.temp/linked-project.json  # expect: name "opndoor-matt-dev"
grep -r xogpsaoyprgmxdkmcype supabase/.temp/   # expect: no matches
git grep xogpsaoyprgmxdkmcype                  # expect: no matches
```

The last one is the important one. It asserts the live ref is not in any tracked
file.

---

## 3. The stray CLI artefact (worth reading)

`supabase/functions/supabase/.temp/linked-project.json` was **tracked by git**
and contained the live project ref. It had been committed and was present at
`HEAD`.

### Why .gitignore did not catch it

`.gitignore` contained:

```
supabase/.temp
```

A gitignore pattern containing a slash is **anchored to the repository root**.
So that rule covered `supabase/.temp` and nothing else. It never applied to the
nested `supabase/functions/supabase/.temp/`, which is where a CLI invocation run
from inside `supabase/functions/` had deposited its state.

### The fix

The file was deleted, and a bare pattern added:

```
.temp/
```

A pattern with no slash (other than a trailing one) matches **at any depth**, so
this catches the artefact wherever the CLI drops it. The original anchored rule
was left in place; it is harmless and removing it would be a needless edit.

Verify with:

```sh
git check-ignore -v supabase/functions/supabase/.temp/linked-project.json
```

### Deliberate departure from the rule

This modified two existing tracked files rather than adding new ones, which
departs from the additive-only rule in section 1. The reasoning: the deleted
file is generated CLI state, not application code, and leaving it in place would
mean the live project ref stays in git history going forward. The `.gitignore`
edit is additive within the file (lines added, nothing removed or reordered), so
it should merge without conflict.

Commit: `0bc7be2`.

### Still outstanding on this

Deleting the file removes it from the working tree and from future commits. It
**does not remove it from git history**. The live ref is still recoverable from
earlier commits in this repo and, more importantly, **in the live repository
this was copied from**, where the same file is presumably still tracked.

A Supabase project ref is not a credential. It is not secret in the way an API
key is, and RLS plus auth are what actually protect the project. But it should
not be in version control, and the same nested `.temp` directory in the live
repo will keep re-committing CLI state. Raising it with whoever owns that repo
is worthwhile.

---

## 4. Secret and reference audit

Read-only audit of the whole tree: Supabase project refs, Stripe credentials,
third-party API keys, JWTs and service-role keys, hardcoded production URLs, and
git history. Every candidate was re-opened and checked in context, to separate a
real credential from the same string appearing in documentation, in a test
fixture, or as a prefix literal in a guard clause.

**Nothing in this section has been changed.** It is a report. Several items are
decisions for you, and the migrations ones deliberately so.

### 4a. One real credential is committed. Rotate it.

[supabase/EXPIRY-REMINDERS.md:62](supabase/EXPIRY-REMINDERS.md#L62) contains a
32-character `REMINDERS_CRON_SECRET` as a literal inside a runnable
`select vault.create_secret(...)` statement. Not a placeholder, not elided.

It is tracked, it is at `HEAD`, and it is on `origin/main`. **It is therefore
exposed in the live repository and in every clone of it, independently of
anything done in this working copy.** That is why it is called out first.

It matters more than its length suggests. This is the shared secret the pg_cron
jobs send as `x-reminders-secret` and the ops migrations forward as
`x-ops-secret`. Anyone with repo read access can call the cron-authenticated
Edge Functions directly, including the documented
`{"test":true,"reset":true}` body at
[supabase/EXPIRY-REMINDERS.md:105](supabase/EXPIRY-REMINDERS.md#L105), which
clears the reminder ledger.

It also contradicts the contract the codebase sets for itself.
[20260705091511_ops_secrets_cron_auth.sql:8-13](supabase/migrations/20260705091511_ops_secrets_cron_auth.sql#L8)
states the value "is seeded out-of-band ... so the secret value is never
committed", and the migration honours that. The sibling runbook
[supabase/EXPIRY-COHORTS.md:31](supabase/EXPIRY-COHORTS.md#L31) uses the
placeholder `'<REMINDERS_CRON_SECRET>'` correctly. So this is a single slip, not
a habit, which is worth knowing before anyone goes looking for more.

Rotating the value in Vault and in the Edge Function env is a separate decision
from any git history work, and does not depend on it. A history rewrite alone
would not un-expose a value that has already been pushed.

**No other committed credential was found.** Scans for `sk_live_`, `sk_test_`,
`pk_live_`, `whsec_`, PandaDoc `API-Key`, HubSpot `pat-` and JWT structure
across tracked files return either nothing or documented placeholders. No `.env`
file has ever been tracked in any commit.

### 4b. Three Edge Functions now hard-require a live Stripe key

This is the thing most likely to waste your afternoon, because it fails closed
and the error message does not say why.

| Location | Effect |
| -------- | ------ |
| [payment-page/index.ts:134](supabase/functions/payment-page/index.ts#L134) | Tenant checkout 400s. |
| [stripe-webhook/index.ts:29](supabase/functions/stripe-webhook/index.ts#L29) | 400s before signature verification, so Sent to Paid never settles. |
| [create-referral/index.ts:35](supabase/functions/create-referral/index.ts#L35) | The whole staff send path 400s. |

Each is `if (!STRIPE_SECRET.startsWith("sk_live_")) return ...`. A `sk_test_`
key is rejected. **The payment flow cannot be exercised end to end on a dev
project without installing live Stripe credentials on it**, which would mean
real cards being charged on the live account from a disposable environment.

The file headers still assert the opposite and are now false:
[stripe-webhook/index.ts:17](supabase/functions/stripe-webhook/index.ts#L17) and
[create-referral/index.ts:12](supabase/functions/create-referral/index.ts#L12)
both read `// TEST MODE ONLY: refuses to run unless STRIPE_SECRET_KEY is an
sk_test_ key.`

Related: the client-side mode badge is inverted.
[src/data/paymentService.ts:16](src/data/paymentService.ts#L16) has
`stripeTestMode()` returning true only for a `pk_live_` key, and the badge it
drives at
[ApplicationDetail.tsx:740](src/pages/ApplicationDetail/ApplicationDetail.tsx#L740)
reads `Live Mode`. With the test key now in `.env.local` the predicate is false,
so **no badge renders at all** and the UI gives no mode signal either way.

**This has since been changed. See [section 5](#5-change-stripe-key-mode-now-follows-the-project).**
The stale header comments were corrected in the same change. The inverted badge
was deliberately left alone.

### 4c. The test email safety redirect has been removed everywhere

Thirteen sending modules previously routed every recipient to
`EMAIL_REVIEW_ADDRESS`. All thirteen now send to the real address. In most the
old code is left commented out directly above the replacement, and the file
headers still promise the redirect is in force. For example
[_shared/executedDeedEmail.ts:5](supabase/functions/_shared/executedDeedEmail.ts#L5)
still reads "ALWAYS redirected to EMAIL_REVIEW_ADDRESS in this test build" while
[line 43](supabase/functions/_shared/executedDeedEmail.ts#L43) sends to the
tenant.

Affected: `_shared/pandadoc.ts:321` (the PandaDoc signing link itself),
`_shared/deedEmail.ts:42`, `_shared/executedDeedEmail.ts:43`,
`_shared/paymentReceiptEmail.ts:21`, `_shared/refundEmail.ts:20`,
`create-referral/email.ts:69`, `expiry-reminders/email.ts:61`,
`payment-reminders/email.ts:68`, `resend-payment-email/email.ts:70`,
`send-password-reset/email.ts:65`, `invite-user/email.ts:87`,
`expiry-cohorts/index.ts:172` (attaches a base64 CSV of tenant data), and
`weekly-digest/index.ts:208`.

**One precondition holds this back:** every module returns early unless
`RESEND_API_KEY` is set. A dev project with no Resend key emails nobody. The
exposure becomes real the moment a Resend key is added, and
`payment-reminders` and `expiry-cohorts` are cron driven, so they would fire
unattended rather than waiting for someone to click something.

Several runbooks still document the redirect as a live safety property, which
will mislead anyone who reads them as current: [supabase/DEEDS-TESTING.md:5](supabase/DEEDS-TESTING.md#L5),
[supabase/PAYMENTS-TESTING.md:29](supabase/PAYMENTS-TESTING.md#L29),
[VERIFICATION-SCRIPT.md:134](VERIFICATION-SCRIPT.md#L134).

### 4d. In migrations: flagged, deliberately NOT changed

A **fourth** Supabase project, `pwftaqtrrqtilxlvwxjd` ("mdwyer@opndoor.co"), is
hardcoded in executable SQL in three migrations. Applying these to the dev
project points parts of it at that project.

| Location | What it does | Note |
| -------- | ------------ | ---- |
| [20260705153000_hubspot_sync_cron_and_trigger.sql:21](supabase/migrations/20260705153000_hubspot_sync_cron_and_trigger.sql#L21) | `cron.schedule('hubspot-sync','*/2 * * * *', ...)` POSTing to the foreign project | Executes at migration time and installs a **recurring job**, so it starts firing every two minutes on apply. The most active of the set. |
| [20260705153000_hubspot_sync_cron_and_trigger.sql:37](supabase/migrations/20260705153000_hubspot_sync_cron_and_trigger.sql#L37) | `trigger_hubspot_sync()`, behind the admin Sync HubSpot button | A separate code path. Repointing the cron does not fix this one. |
| [20260705110300_ops_alert_trigger_defensive_guard.sql:9](supabase/migrations/20260705110300_ops_alert_trigger_defensive_guard.sql#L9) | `alert_ops_on_failure()`, fires after insert on `activity_log` | The definitive version. Ordinary dev activity POSTs to the foreign project. |
| [20260705110300_ops_alert_trigger_defensive_guard.sql:39](supabase/migrations/20260705110300_ops_alert_trigger_defensive_guard.sql#L39) | `report_ops_incident()`, SECURITY DEFINER, called from Edge Function catch blocks | The definitive version. |
| [20260705102238_ops_failure_alerting.sql:25](supabase/migrations/20260705102238_ops_failure_alerting.sql#L25) and [:62](supabase/migrations/20260705102238_ops_failure_alerting.sql#L62) | Earlier definitions of the same two functions | Superseded by `110300` above, so they do not set final DB state. Still foreign refs in tracked SQL. |

Two things make this harder to notice than it should be. The `ops` side effects
are wrapped in `exception when others then null`, so cross-project calls fail
**silently with nothing in the logs**. And all of these forward the
`ops_secrets.reminders_cron` value in an `x-ops-secret` header, so once that
secret is seeded on the dev project it would be sent to the foreign project.
On a fresh dev project `ops_secrets` is empty, the header is null and the
foreign function 401s, so this is inert until someone copies the secret across.

Also seeded as data, not fixtures, in
[20260705150500_hubspot_sync_seed.sql](supabase/migrations/20260705150500_hubspot_sync_seed.sql):
real HubSpot account identifiers on both a `sandbox` row (line 23, `is_active =
true`) and a `production` row (line 27, `is_active = false`), plus
`https://app.opndoor.co` as `app_base_url` on
[line 26](supabase/migrations/20260705150500_hubspot_sync_seed.sql#L26). That
last one is read as `Deno.env.get("APP_URL") ?? env.app_base_url`, so with
`APP_URL` unset on the dev project, deed deep links pushed to HubSpot would
point at the production portal. All of it is inert while no HubSpot token
exists, and none is in the tree.

**Why these were left alone:** migrations already applied to live cannot be
edited retroactively without diverging the two projects. The fix is a new
migration that repoints these to the correct project, or makes the URL a
settable config value rather than a literal. That is your call on approach, so
it has not been pre-empted.

### 4e. Git history

- The live ref `xogpsaoyprgmxdkmcype` is at `9820824` in `origin/main`, so any
  fresh clone still gets it and a `supabase link` from that clone re-targets
  production. The local deletion (`0bc7be2`) is **unpushed**, and deleting a
  file does not retract the blob.
- A fifth ref, `updniardvylhsiavtncw` ("Opendoor-test", a different org), is at
  `153b314` and in the pre-existing `.env.local` as a commented-out line. Dead
  identifier, no runtime reach.
- The committed secret in 4a is not a history-only problem. It is in the current
  tree and on `origin/main`.

### 4f. Checked and cleared, so you do not re-tread it

- **Env var reads are fine.** `Deno.env.get("STRIPE_SECRET_KEY")` and friends
  commit no value. The many `sk_live_` / `pk_live_` grep hits in source are
  **prefix literals inside `startsWith()`**, not key material.
- **No Stripe object ids** (`price_`, `prod_`, `acct_`, `cus_`, `pi_`, `cs_`)
  are committed anywhere. Both checkout paths build inline `price_data` from the
  rent value. No PandaDoc template id is committed either; it comes from env.
- **Vendor API hosts** (`api.hubapi.com`, PandaDoc, Resend) carry no credential
  or tenant id, so there is nothing to repoint.
- **`.gitignore` coverage is otherwise sound** for `.env*`, `dist`, key material
  and `.mcp.json`. No `.vercel` rule exists, but no `.vercel` directory does
  either.
- **The stale `dist/` bundle** contains the foreign ref and a publishable key.
  Untracked and gitignored, so it cannot be pushed, but `npm run preview` would
  serve it and bind to the wrong project. Rebuild before trusting it.

### 4g. One unrelated issue, noted so it is not lost

[hubspot-sync/index.ts:102](supabase/functions/hubspot-sync/index.ts#L102)
accepts a HubSpot token from an `x-hubspot-token` request header when
`HUBSPOT_ACCESS_TOKEN` is unset. The caller must already hold the ops secret, so
it is not privilege escalation, but it would let applicant data be pushed into
an attacker-supplied Hub. Nothing to do with the disconnect, flagged in passing.

---

## 5. Change: Stripe key mode now follows the project

This is the first change in this tree that modifies existing files. Everything
before it was additive or a deleted stray artefact.

### The problem

Section 4b: `payment-page`, `stripe-webhook` and `create-referral` each
hardcoded `if (!STRIPE_SECRET.startsWith("sk_live_"))`. A test key was rejected
outright, so the payment path could not run on any non-production project. The
only way to make a dev project work was to install live Stripe credentials on
it, which risks real cards being charged from a disposable environment.

### What it does now

The required key mode is derived from the project the function is running on,
and the two must match:

| Environment | Required key |
| ----------- | ------------ |
| A project ref listed in `NON_PRODUCTION_REFS` | `sk_test_` |
| Anything else, including production and any unrecognised project | `sk_live_` |

Note this is symmetric rather than merely permissive. A non-production project
**requires** a test key, so it also blocks the opposite accident of live Stripe
credentials being installed on a disposable environment.

### Why the project ref and not a feature flag

A flag such as `ALLOW_TEST_STRIPE=true` would have been a smaller change, but it
puts production's safety behind a value that anyone with dashboard access can
set, and nothing in code review would catch it being set on production.

`SUPABASE_URL` is injected by the platform and contains the project ref, so the
guard reads its own identity rather than being told what to believe.

**This design depends on Supabase reserving the `SUPABASE_` prefix**, meaning
`SUPABASE_URL` cannot be set or overridden through `supabase secrets set` or the
dashboard. That is what makes the guard non-relaxable from outside the code.
**Please confirm that reservation still holds on your CLI and platform version
before relying on it.** If it has changed, the guard is still correct but is no
longer tamper-proof, and the design should be revisited.

The behaviour also fails closed. An unrecognised ref, a missing `SUPABASE_URL`
or a malformed one all fall through to requiring `sk_live_`. A new environment
has to be added to `NON_PRODUCTION_REFS` in a reviewed change before it can use
test keys, rather than defaulting to permissive.

### What it costs production

Nothing. No new secret, no config change, no dashboard step. Production's
behaviour is identical to the previous hardcoded guard, because an
unrecognised-or-production ref still demands `sk_live_`. The change cannot be
misapplied to production because it asks nothing of production.

### An apparent contradiction, stated so you do not have to reconcile it

This hardcodes a project ref in source, which is exactly what section 4d
criticises. The distinction is direction. Section 4d hardcodes a **destination**
that traffic is sent to, which is configuration and belongs in the database.
This is an **assertion about which environment we are**, which is policy, and is
safer in reviewed code than in a settable value.

### Files touched

New:

- `supabase/functions/_shared/stripeMode.ts`

Modified, one guard and one import each:

- [supabase/functions/payment-page/index.ts](supabase/functions/payment-page/index.ts)
- [supabase/functions/stripe-webhook/index.ts](supabase/functions/stripe-webhook/index.ts)
- [supabase/functions/create-referral/index.ts](supabase/functions/create-referral/index.ts)

The `// TEST MODE ONLY: refuses to run unless STRIPE_SECRET_KEY is an sk_test_
key.` headers in `stripe-webhook` and `create-referral` were false in both
directions and were corrected in the same change, along with a stale reference
to a "test-mode Checkout Session" in `create-referral`.

**Departure from the additive-only rule.** These are edits to existing tracked
files, which section 1 says to avoid. They were made because the alternative is
duplicating three functions, and they are deliberately small: an import line and
a guard swap in each, with the response shape and status code of each guard left
exactly as it was. They should merge cleanly unless live has since changed the
same lines.

**A note on line endings.** `payment-page/index.ts` and `stripe-webhook/index.ts`
arrived in this working copy with a partial CRLF conversion already applied and
uncommitted, which would have buried a 7-line change inside a 330-line
whitespace diff. Both files were normalised back to LF, matching `HEAD` and the
rest of the repo, so the commit shows only the real change. No other file was
normalised.

### How to verify it

There is no Deno toolchain in this working copy, so the helper has **not** been
type-checked. Please run `deno check supabase/functions/_shared/stripeMode.ts`
before deploying. The decision logic was tested separately against this truth
table, all of which passed:

| `SUPABASE_URL` | Key | Result |
| -------------- | --- | ------ |
| production | `sk_live_` | allow, unchanged from before |
| production | `sk_test_` | refuse |
| dev | `sk_test_` | allow, this is the point of the change |
| dev | `sk_live_` | refuse |
| unrecognised project | `sk_test_` | refuse, fails closed |
| unset or malformed | `sk_test_` | refuse, fails closed |
| production | empty | refuse |

---

## 6. Standing a clean project up

The dev project was reset and rebuilt from these migrations. **All 68 apply
cleanly to an empty database and the local and remote histories now match
exactly.** Getting there needed two new migrations, because the tree as it stood
could not build a database from scratch.

### 6.1 Two migrations were missing

**`20260703153500_enable_pg_cron_pg_net.sql`.** No migration in this tree ran
`create extension` for anything. A clean apply died at `20260703153600`, which
calls `cron.schedule()` against a schema that does not exist. pg_cron is needed
from that migration onward and pg_net from `20260705102238`. Nothing else is
required: `gen_random_uuid()` is built in on PostgreSQL 13+, and the only
`vault.` reference in the migrations is a comment.

It is dated before its first consumer because a fresh project applies migrations
in version order. Both statements are `if not exists`, so it is a no-op on a
project where the extensions are already on by hand.

**`20260705170500_drop_reconciliation_queue_for_signature_change.sql`.**
`reconciliation_queue()` is created with nine OUT columns at
[20260704130732:92](supabase/migrations/20260704130732_org_review_state_and_reconciliation.sql#L92)
and then `create or replace`d with ten at
[20260705171000:8](supabase/migrations/20260705171000_reconciliation_fold_head_office.sql#L8).
PostgreSQL cannot change a return type that way (`SQLSTATE 42P13`) and the
function is never dropped, so the chain failed on its final migration.

Fixed with a drop ordered immediately before `20260705171000`, rather than by
editing that migration, which is already applied to live.

**Both of these mean the repo could not previously rebuild live's schema.** That
is a disaster-recovery problem rather than a dev inconvenience, and it is
recorded separately in `DEFECTS.md`.

### 6.2 The dev project deliberately differs in one respect

**The `hubspot-sync` cron job has been unscheduled on the dev project, directly,
and no migration reflects that.**

`20260705153000` schedules it every two minutes against
`https://pwftaqtrrqtilxlvwxjd...`, a foreign project (section 4d). Rebuilding
the dev project switched it on, which is exactly the trigger described there.

Verified before removing it: the job targeted `pwftaqtrrqtilxlvwxjd`, and
`public.ops_secrets` had **zero rows**, so the `x-ops-secret` header was null and
the receiving function would have rejected the calls. It was inert, and it was
removed anyway rather than left running against another project.

```sql
select cron.unschedule('hubspot-sync');
```

This was done as a direct statement, **not** as a migration, because it is
dev-only housekeeping that should not travel to live. Live's own scheduling is a
separate decision covered by section 4d.

**Consequence for you:** the dev project's `cron.job` table does not match what
the migration set would produce. `rate-limit-cleanup` is still scheduled and is
harmless. If you reset the dev project again, `hubspot-sync` comes back and needs
unscheduling again.

---

## 7. Open items for you

Ordered by urgency, not by effort.

| # | Item | Why it needs you |
| - | ---- | ---------------- |
| 1 | **Rotate the `REMINDERS_CRON_SECRET`** and remove the literal from [supabase/EXPIRY-REMINDERS.md:62](supabase/EXPIRY-REMINDERS.md#L62) | Section 4a. A real secret is committed and pushed to `origin/main`. This is an exposure in the live repo and is independent of anything done in this working copy. Rotating is the fix; deleting the line alone is not. |
| 2 | Confirm the `SUPABASE_` prefix reservation actually holds | Section 5. `deno check` has since been run across all 23 Edge Functions and is clean, so the earlier "not type-checked" caveat is gone. What remains is the assumption underneath it: the guard's tamper-resistance rests on `SUPABASE_URL` being unsettable via `supabase secrets set`. Confirm that with Supabase rather than taking this document's word for it. |
| 3 | Decide whether the removed email redirect is intended | Section 4c. Thirteen modules now email real people. Safe only while no `RESEND_API_KEY` is set on the dev project, so **do not set one** until this is settled. |
| 4 | Decide how to repoint the foreign project ref in migrations | Section 4d. Needs a **new** migration, not an edit. Applying the current set to dev installs a cron job that hits a foreign project every two minutes. |
| 5 | Confirm edge function secrets on the dev project | Stripe secret key, Stripe webhook secret, PandaDoc API key and template id, Resend key. These live as Edge Function secrets, never in this repo. The dev project needs its own set pointed at **test/sandbox** credentials, subject to items 2 and 3. |
| 6 | Register a Stripe **test-mode** webhook against the dev project | The live webhook points at the live functions URL. Payment flows will not settle in dev without a test-mode endpoint and its own signing secret. |
| 7 | Decide whether `origin/main` history needs a rewrite | Section 4e. The live project ref is in a pushed commit. A ref is a public identifier rather than a credential, so this may be acceptable; it is a judgement call, not a clear-cut fix. |
| 8 | Rebuild `dist/` before using `npm run preview` | The committed-on-disk bundle is a stale build still pointing at a foreign project. |
| 9 | **Schedule the partner webhook dispatcher** | Deliberately not scheduled by a migration, because a migration cannot know which project it is applied to and hardcoding a URL is how defect 2 happened. Until it is scheduled, deliveries queue and are never sent. The statement to run, with the ref substituted, is in the header of `20260810170000_partner_webhook_claim.sql`. It also needs the `reminders_cron` row seeded in `ops_secrets`, or every run returns 401. |
| 10 | ~~Decide how partner API keys get issued~~ **Done.** | The Dev Centre mints them through the `dev-centre` Edge Function, with the mode chosen explicitly and the key shown once. No longer manual. Section 10. |
| 11 | 🚨 **Watch the Rightmove migration output on the production push** | See the box at the top of this document. If it matches nothing, the partner API stays off for everyone and nothing else looks wrong. This is the highest-risk item on the list because its failure mode is silence. |
| 12 | **Set the five sandbox secrets on production** | Section 11.3. `STRIPE_SECRET_KEY_TEST`, `STRIPE_WEBHOOK_SECRET_TEST`, `PANDADOC_API_KEY_TEST`, `PANDADOC_TEMPLATE_ID_TEST`, `PANDADOC_WEBHOOK_SHARED_KEY_TEST`. Sandbox does not work on production until these exist, and a missing one is a hard error rather than a fallback to the live credential, deliberately. |
| 13 | **Stand up `api.opndoor.co`** | Section 12. A DNS record and a rewrite mapping `/v1/*` to the function path. **No partner should be given a key until this exists**, because whatever they are given first is what gets hardcoded. Section 12.2 lists the three ways a proxy silently breaks this specific API. |
| 14 | **Finish Defect 13: sweep the toast call sites** | The `Toast.tsx` change carried here is a prerequisite that **changes nothing users see on its own**. 34 error paths still render green until each passes the tone. Defect 13 has the grep that finds them. |
| 15 | **Point the test-mode Stripe and sandbox PandaDoc webhooks at the same URLs as the live ones** | Section 11.3. Inbound mode is derived from which signing secret verifies, so both must arrive at the same endpoint. |

### Deliberately not done

- **`VITE_ADDRESS_LOOKUP_KEY` is not set.** The New Application form falls back
  to manual address entry. This is an accepted limitation in dev, not a bug.
- **`VITE_PANDADOC_SANDBOX` is not set.** The deed UI will not show the
  "Sandbox" badge. The flag is cosmetic; it does not control which PandaDoc
  environment is used. That is determined by the server-side API key.
- **Nothing under `supabase/migrations/` has been touched.**
- **Git history has not been rewritten.** See section 3.

---

## 8. Environment reference

| Project ref | Name | Role |
| ----------- | ---- | ---- |
| `nfufwcpgrhfgwtphegca` | opndoor-matt-dev | **This tree targets this.** Disposable. |
| `xogpsaoyprgmxdkmcype` | portal.opndoor.Live | Live production. Do not link or push here from this tree. |
| `pwftaqtrrqtilxlvwxjd` | mdwyer@opndoor.co | A separate project, hardcoded in three migrations and in several runbooks. See section 4d. |
| `updniardvylhsiavtncw` | Opendoor-test | Dead. Different org. History and one commented-out line only. |

Note that `vkuzanaekrpdgyusmpdw` appears alongside these and matches the same
20-character shape, but it is the **organisation id**, not a project. The live
and dev projects share it.

Only ever link or push this working copy at `nfufwcpgrhfgwtphegca`.

Several runbooks contain `--project-ref pwftaqtrrqtilxlvwxjd` in copy-and-paste
ready deploy commands ([EXPIRY-REMINDERS.md:138](supabase/EXPIRY-REMINDERS.md#L138),
[DEEDS-TESTING.md:243](supabase/DEEDS-TESTING.md#L243),
[PAYMENTS-TESTING.md:125](supabase/PAYMENTS-TESTING.md#L125)). `--project-ref`
overrides the local link, so running one of those deploys to the wrong project
regardless of what `supabase/.temp/project-ref` says. Worth knowing before you
follow any of those documents.

---

## 9. The partner API

Specification is in [PARTNER-API.md](PARTNER-API.md). This section covers what is
**built** and how to operate it. Design rationale lives in the spec, not here.

### 9.1 What exists

**Where a function was FIRST created, which is not always where it is now.**
Several of these were replaced later by the livemode and partner-capability work,
and a `create or replace` leaves no trace at the original site. The current
definition of any function is the LAST migration that names it:

```sh
grep -ln "function public.<name>" supabase/migrations/*.sql | tail -1
```

The ones that moved: `create_referral_api`, `create_referral_target_api`,
`partner_api_orgs`, `partner_api_applications`, `enqueue_partner_webhook` and
`partner_webhook_payload` all gained a mandatory `p_livemode` or a livemode
predicate in `20260810280000` / `20260810290000`, and `create_referral_api`
changed again in `20260811100000` to snapshot `referencing_mode`.

| Piece | First created in |
| ----- | ---------------- |
| `partner_api_keys` table | `20260807130000_partner_api_keys.sql` |
| Key verification, timing-safe | `supabase/functions/_shared/partnerAuth.ts` |
| `partner_api_orgs()` read model | `20260807140000_partner_api_orgs.sql` |
| `partners.referencing_mode` | `20260810100000_partner_referencing_mode.sql` |
| `partner_api_requests` idempotency ledger | `20260810110000_partner_api_requests.sql` |
| `referral_field_errors()` shared rules | `20260810120000_referral_field_errors.sql` |
| `create_referral_api()` | `20260810130000_create_referral_api.sql` |
| `create_referral_target_api()` | `20260810140000_create_referral_target_api.sql` |
| `partner_api_applications()` read model | `20260810200000_partner_api_applications.sql` |
| `partner_status()` vocabulary mapping | same migration |
| Webhook registry and delivery queue | `20260810150000_partner_webhook_schema.sql` |
| Payload builder and enqueue trigger | `20260810160000_partner_webhook_enqueue.sql` |
| Claim, settle, backoff, dead lettering | `20260810170000_partner_webhook_claim.sql` |
| `application.reinstated` | `20260810190000_partner_webhook_reinstated_event.sql` |
| All endpoints | `supabase/functions/partner-api/index.ts` |
| Create path | `supabase/functions/_shared/partnerApplications.ts` |
| Read serializer | `supabase/functions/_shared/partnerViews.ts` |
| HMAC signing | `supabase/functions/_shared/webhookSigning.ts` |
| Webhook dispatcher | `supabase/functions/partner-webhooks/index.ts` |

Deployed to the dev project and tested end to end. Not deployed anywhere else.

Endpoints: `POST /applications`, `GET /applications`, `GET /applications/{id}`,
`GET /orgs`, and `POST`/`GET`/`DELETE /webhook-endpoints`.

**`POST /applications` works only for a partner in `pre_referenced_open` mode.**
The other two modes return `501`, deliberately: with no acceptance criteria
engine, treating a `pre_referenced_screened` partner as open would approve every
applicant, which looks exactly like working software.

### 9.2 The two touches to existing code, and why

Everything else in this work is a new file. Two things were not:

**`create_referral` was re-created twice**, by `20260807120000` and
`20260810120000`. Both are refactors with no behaviour change: the first moved
its validation into `assert_referral_valid`, the second rebuilt that on
`referral_field_errors` so the API can read structured codes from the same rules.
This was done rather than copying the rules, because two copies of fifteen field
rules would drift and the portal would start accepting what the API rejects.

Both were verified by execution, not inspection: every legacy error message and
SQLSTATE is byte-identical to the original. If you change validation, change it
in `referral_field_errors` and both doors follow.

**`partner-api/index.ts` gained a route.** It is a new file from this work, so
this is only worth noting because it is now the shared entry point for both
endpoints.

### 9.3 Deploying it

**Always with `--no-verify-jwt`.** See the warning at the top of this document.

```sh
npx -y supabase@2.111.0 functions deploy partner-api --no-verify-jwt
```

Then confirm it actually works, because a wrong `verify_jwt` fails identically to
a bad key:

```sh
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer <a key you know is good>" \
  https://<ref>.supabase.co/functions/v1/partner-api/v1/orgs
# The project URL is used here deliberately: this checks the FUNCTION, before and
# independently of the rewrite. Partners get https://api.opndoor.co/v1/orgs.
# expect 200.
#   401 with a known-good key  -> verify_jwt is on. Redeploy with --no-verify-jwt.
#   404 unsupported_version    -> you dropped the /v1/ segment, not a deploy problem.
```

### 9.4 Issuing a key

Manual, deliberately. Hashing cannot happen in Postgres: SHA-256 needs
pgcrypto's `digest()`, and this schema does not enable pgcrypto. Adding an
extension solely to mint credentials is a poor trade, so an admin endpoint is
later work.

Generate the key and its hash outside the database, then insert only the hash:

```js
const crypto = require("crypto");
const ab = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const b = crypto.randomBytes(32);
let r = ""; for (let i = 0; i < 32; i++) r += ab[b[i] % ab.length];
const key = "opnd_live_" + r;                                   // give this to the partner, once
console.log(key, key.slice(0, 18), crypto.createHash("sha256").update(key).digest("hex"));
```

```sql
insert into public.partner_api_keys (partner_id, name, key_prefix, key_hash, scopes)
values ('<partner uuid>', 'Rightmove production', '<prefix>', '<hash>',
        array['applications:write','orgs:read']);
```

Use `opnd_test_` for non-production. **The plaintext is not recoverable**: only
the hash is stored, by design. If a partner loses their key, issue a new one and
revoke the old.

### 9.5 Rotating and revoking

Multiple live keys per partner are intentional and there is no unique constraint
preventing them. Rotation needs no coordinated cutover:

1. Issue a new key and give it to the partner.
2. Partner deploys it.
3. Watch `last_used_at` on the old key stop advancing.
4. `update public.partner_api_keys set revoked_at = now() where id = '<old>';`

Revocation takes effect on the next request. `last_used_at` is written
fire-and-forget and is not in the request's critical path, so it can lag by a
moment under load.

### 9.6 The property most likely to be broken by accident

**RLS does not protect this path.** Every table carries a restrictive AAL2 policy
that an API-key request cannot satisfy, so the function runs as service role.
Partner isolation is entirely the application's responsibility.

Every partner-facing query must filter on the `partner_id` derived from the
verified key, and never on anything from the request body. A single query that
forgets is a cross-partner data leak that **no database policy will catch**.

This is worth a specific look in any review of new endpoints. It is the one
mistake here that is both easy to make and serious.

### 9.7 What POST does, in the order it does it

The order is load bearing and worth knowing before changing anything:

1. **Idempotency claim**, before any work. The unique index on
   `(partner_id, endpoint, idempotency_key)` makes this a claim rather than a
   check-then-act, so two concurrent retries race and exactly one wins.
2. **Referrer**, resolved by email within the caller's partner only.
3. **Org**, by ID or by name.
4. **Field validation**, via `referral_field_errors`.
5. **Create**, via `create_referral_api`.
6. **Payment link**, via `mint_payment_page_token`. No Stripe call happens here,
   so this endpoint works on a project with no Stripe configuration. The Checkout
   Session is created when the tenant opens the page.
7. **Record the response**, so a retry replays it.

Steps 2 and 3 come before 4 so a payload with both a bad postcode and an unknown
branch reports both, rather than making the partner fix one per round trip.

Failures are recorded in the ledger too. A retry of a request that failed
validation replays that failure rather than re-running it, or the idempotency key
would mean nothing.

### 9.8 Two behaviours that will look like bugs and are not

**A failed request can leave a pending user behind.** The referrer is resolved
before validation, so a payload that then fails has already provisioned the user.
It is a real user scoped to the caller's own partner, and the next request from
the same address reuses it. Making it atomic would mean wrapping an Auth Admin
API call and several statements in one transaction, which is not worth the
complexity at this stage. Accepted deliberately.

**`GR-` reference numbers have gaps.** `guarantee_ref` comes from a sequence, and
a sequence does not roll back with a failed transaction. This is true of the
portal path too.

### 9.9 Two things that are not wired up, and will look broken

**The webhook dispatcher has no schedule.** Nothing in the migrations calls
`cron.schedule` for it, deliberately: a migration cannot know which project it is
being applied to, and `20260705153000` hardcoding a URL is exactly how this repo
came to point every new project at a foreign one. Until it is scheduled,
deliveries queue and are never sent. That is the safe failure mode, since the
queue is the source of truth and nothing is lost, but it will look like the
webhooks are broken. The statement to run is in the header of
`20260810170000_partner_webhook_claim.sql`, with the project ref substituted.

**The dispatcher needs the ops secret.** It authenticates on `x-ops-secret`
against the `reminders_cron` row in `ops_secrets`, matching the other cron-driven
functions. On a fresh project that table is empty and every dispatcher run
returns 401.

### 9.10 The API is versioned, and the version is required

**What partners are given is `https://api.opndoor.co/v1`.** It resolves to
`/functions/v1/partner-api/v1/` through a rewrite. See 9.11 for the DNS and
rewrite you have to set up; until they exist, no partner can be given a key.

The value is configured in `src/config/partnerApi.ts` and nowhere else. The
getting-started snippets and the generated API documentation both render it, so
changing the domain is one line plus a re-run of
`node scripts/generate-partner-docs.mjs`.

Do not hand anybody the `<ref>.supabase.co` URL or the `/functions/v1/` path.
Whatever a partner is given gets hardcoded and outlives several of our decisions,
so the host and the path both have to be ours to change. The function path also
contains a **second `v1`** which is Supabase's Edge Function API version rather
than ours, and two unrelated `v1`s in one URL is a support conversation waiting
to happen.

A request without a version segment, or with an unrecognised one, returns
`404 unsupported_version` naming the supported versions. It is deliberately not
defaulted to `v1`, because the clients that never send a version are exactly the
ones a future v2 would break, which is the problem the segment exists to solve.
Added before any partner integrated, so nothing had to be preserved.

Idempotency keys are **not** version-qualified: the ledger records
`POST /applications`, so the same key across a version migration replays rather
than creating a second application.

Adding v2 means extending `SUPPORTED_VERSIONS` in the router and branching per
endpoint.

### 9.11 Dev fixtures

The dev project holds test fixtures created directly, not by any migration: two
partners, three agencies, four branches and four API keys covering the valid,
wrong-scope, revoked and other-partner cases. They exist to exercise the
endpoint and are disposable. A reset removes them.

---

## 10. The Dev Centre and the developer role

### 10.1 What was added

A fourth role, `developer`, and a Dev Centre screen for partner integrators.

A developer belongs to a partner the way management does, sees the Dev Centre,
and sees nothing commercially sensitive: no commission, no league, no exports, no
bordereau, and no applications.

### 10.2 Why the migration is bigger than "add a role"

Adding the value to the CHECK constraint was one line. The other 200 were closing
gates that would have granted it something, and they shipped in the same
migration deliberately: separating them leaves a window where the role exists and
is over-privileged.

The cause is that this schema mixes two idioms. A **positive** allowlist
(`app_role() in ('management','referrer')`) excludes a new role automatically. A
**negative** test, or a test on partner membership with no role component, grants
it whatever the negation implies.

One constraint makes every partner-membership test fire:
`users_partner_by_role` requires a non-superadmin to have a `partner_id`, so a
developer always has one, and every check shaped `x = public.app_partner()`
admits them the moment the role is legal.

**If you add a fifth role, that is the thing to know.** Search for
`app_partner()` with no adjacent role test, and for `<>`, `!==` and `else true`
in anything role-shaped.

The worst single find: `referrer_league` was `security definer`, granted to
`authenticated`, and gated only by MFA and a non-null partner, with no role test
anywhere in its body. A developer would have received the whole partner league
including fees per referrer. Hiding the nav item would have done nothing.

### 10.3 Who reaches the Dev Centre

| Role | Sees |
| ---- | ---- |
| `developer` | Everything, own partner only |
| `superadmin` | Everything, any partner, with a partner picker |
| `management` | **The API keys panel only** |

Management is included deliberately, and it departs from the original "developer
and opndoor admin". A leaked key has to be killable by whoever notices, and a
developer who has left cannot revoke their own key. They get revoke and nothing
else.

The tab is not the boundary. Every RPC scopes itself and the Edge Function
re-checks the role with a caller-scoped client, so RLS and the AAL2 gate apply to
the read that decides.

### 10.4 Keys and secrets are shown once

A key and a webhook signing secret are returned exactly once, at creation, and
are not recoverable: only a hash is stored. No listing returns either.

Minting needs a CSPRNG and SHA-256, so it lives in the `dev-centre` Edge
Function. Postgres has no `digest()` without pgcrypto and this schema
deliberately does not enable it (`20260703153500` enables only pg_cron and
pg_net).

Unlike `partner-api`, `dev-centre` runs with **`verify_jwt = true`**. It is a
portal screen authenticated by the user's own session, not by an API key.

### 10.5 The documentation is generated, and why that is a build step

The Dev Centre's API documentation comes from `PARTNER-API.md`, so it cannot
drift from the specification.

It is generated by `node scripts/generate-partner-docs.mjs` into
`src/pages/DevCentre/partnerDocs.generated.ts`, **not** imported with `?raw`.

That distinction is load bearing. `?raw` inlines the whole file into the bundle,
so filtering it in the component filters what is *rendered* but not what *ships*:
the entire internal specification, with its defect references and open questions,
was readable in devtools by any partner developer. It was caught by grepping the
built bundle, not by review.

**Re-run the generator when the spec changes.** The output is committed, so a
stale generated file shows up in a diff. A leaked specification does not show up
at all, which is why the trade goes this way. The generator refuses to write if
an internal marker survives sanitising.

### 10.6 Still to do on the client

The server is closed and the routes are guarded, so these are defence in depth
rather than live holes. They remain because they are the same negative-test shape
and will grant the next role added:

- `exportsService.ts`, eleven `role !== 'referrer'` tests gating commission
  columns and both settlement sections
- `Dashboard.tsx`, the "Export summary" button has no `RoleOnly` where its three
  siblings do
- `hydrate.ts`, still requests `partner_rate, agent_rate`; now refused by the
  narrowed policy, but it should stop asking
- `applicationsService.ts`, `canAmendTenancyStart` and `canWithdraw` both end
  `: true`
- `paymentMetrics.ts`, `analyticsService.ts`, `leagueService.ts`, same shape

---

## 11. Sandbox mode (livemode)

Sandbox is a mode inside the live system, the way Stripe does it. One project,
one URL, one login. A partner developer rehearses the whole integration against a
sandbox key and then swaps the key for a live one with nothing else changing.

The guarantee is: no role except a developer ever sees a sandbox application, no
sandbox row reaches a commission figure, a bordereau, a settlement, a league, a
partner email or HubSpot, and no sandbox action touches a real third party.

### 11.1 What decides the mode

`applications.livemode`, a boolean, default true. It is copied from the API key
that created the row and is never read from a request payload. A trigger makes it
immutable after insert.

The default is **live** on purpose, and the reasoning is worth keeping because it
looks backwards at first. Reads must fail towards hiding sandbox: a developer
seeing nothing is a bug, a partner seeing a test row in their commission is an
incident. Writes must fail the other way: if the default were sandbox, any writer
not yet updated would silently mint invisible rows, real referrals would vanish
from the bordereau and partners would go unpaid with nothing raising a hand.

### 11.2 Why RLS is not the guarantee, and what is

A restrictive policy on `applications` subtracts sandbox from every existing
permissive policy, including the unconditional `is_admin()` arm, without editing
the original SQL. It has no developer arm: nobody sees sandbox through PostgREST,
which is why the portal client needed no changes at all.

That policy covers a minority of the reads in this system. No table sets FORCE
ROW LEVEL SECURITY, so all 27 SECURITY DEFINER functions that read
`applications` run with policies switched off, and 11 are callable straight from
a browser. What actually holds the line is:

- **one trigger** for writes, `applications_sandbox_write_guard`. A definer
  function runs as its owner but the session still carries the caller's JWT, so
  the trigger can tell a portal user from a machine caller and block only the
  first. This covers functions nobody has written yet.
- **explicit predicates** for reads, on nine reporting functions.
- **`public.livemode_audit()`**, which lists every definer function reading
  `applications` with no predicate and no exemption. Empty is the passing state.
  Migration `20260810280000` asserts it, so a future function without a predicate
  fails the deploy.

Exemptions live in `public.livemode_audit_exemptions` with a written reason.
**If the audit raises, do not add an exemption to silence it.** Read the function
and decide whether it can return a sandbox row to somebody who should not see
one. The reason column is where the argument goes.

### The audit's blind spot, which is the thing to remember

`livemode_audit()` checks functions that read `public.applications`. That is
exactly one table, and a green audit is not a clean bill of health.

**Six leaks were found outside it**, across the key-chain and credentials work,
and every one of them fell into one of two shapes:

- **service-role paths**, where RLS is off and the definer audit does not look:
  `partner_api_orgs`, `create_referral_target_api`, `expiry-cohorts`'s direct
  `from("applications")` read, `resend-payment-email` resolving its own row.
- **things scoped by partner rather than by application**, where the mode was
  simply not part of the key: the idempotency ledger's unique index, and the
  webhook endpoint registry.

So the rule to carry forward is not "run the audit". It is:

> Anything new that runs as service_role, or that is scoped by partner rather
> than by application, needs its own thought about livemode. The audit will pass
> and say nothing.

The two shapes are worth naming because they are not obscure corners. Every
Edge Function runs as service_role, and partner scoping is the default habit in
this codebase because it was the only tenancy boundary that existed before
sandbox. The audit covers the case that is easy to check, not the case that is
easy to get wrong.

### 11.3 Secrets you must set on production

Sandbox does not work on production until these exist. A missing one is a hard
error, never a fallback to the live credential: falling back would charge a real
card for a rehearsal.

```
STRIPE_SECRET_KEY_TEST              sk_test_... from the same Stripe account
STRIPE_WEBHOOK_SECRET_TEST          the signing secret of a SECOND Stripe webhook
                                    endpoint, pointed at the same URL, in test mode
PANDADOC_API_KEY_TEST               PandaDoc sandbox API key
PANDADOC_TEMPLATE_ID_TEST           the deed template as it exists in the sandbox
                                    account (a sandbox key cannot see a
                                    production template, so this is not optional)
PANDADOC_WEBHOOK_SHARED_KEY_TEST    shared key of the sandbox webhook
```

The dev project needs none of them: there is only one credential set there, all
of it test, and `livemodeCredentials.ts` falls back to the base name on
non-production projects only.

**Point the test-mode Stripe webhook and the sandbox PandaDoc webhook at the same
URLs as the live ones.** Inbound events do not say which mode they are in, or
rather they do and it cannot be trusted, so the mode is derived from *which
signing secret verifies the signature*. Both secrets are tried; the one that
matches identifies the mode. It is then cross-checked against the application's
own `livemode`, and a mismatch is refused with a 500 and an ops alert rather than
reconciled, because the only ways the two can disagree are a replay or a
misconfiguration.

### 11.4 Departures from the additive rule

The standing rule for this work was to add, never edit. Sandbox could not be
built additively: `livemode` has to be threaded from the key to the row, and a
parameter cannot reach a module constant captured at import. Every edited file
and why it was unavoidable:

| File | Why it could not be additive |
| --- | --- |
| `_shared/pandadoc.ts` | The API key, template id and webhook key were module constants read at import (lines 18-20). No parameter can reach a module constant, so one deployment could only ever talk to one PandaDoc account. They had to become a resolver. |
| `_shared/stripeMode.ts` | Its rule was per project, which was the whole story when a project was either live or test. A live project now legitimately holds an `sk_test_` key too, so `isNonProductionProject()` had to be exported for the credential resolver to compose with. The old function is kept and marked superseded; the environment-banner generator still reads `NON_PRODUCTION_REFS` from it. |
| `_shared/partnerAuth.ts` | `PartnerAuth` is where the key's mode enters the system. Nothing downstream can know it if this does not carry it. |
| `_shared/partnerApplications.ts` | The create path resolves orgs and calls `create_referral_api`; both now need the mode. |
| `partner-api/index.ts` | Threads the mode from the authenticated key into every handler. Nine signatures, so the compiler finds a missed call site rather than a partner finding it. |
| `stripe-webhook/index.ts` | Signature verification had to try both secrets to derive the mode, and the payment and refund paths needed the cross-check before the privileged RPC rather than after. |
| `pandadoc-webhook/index.ts` | Same, for the PandaDoc HMAC. |
| `payment-page/index.ts` | Chose the Stripe key from the project. It has to come from the application, so the key read moved below the row fetch. This also fixed a pre-existing gap: the mode guard sat inside the `checkout` branch, so `view` and `decline` ran with no check at all. |
| `create-referral/index.ts` | Same key-selection change. The portal only makes live applications, so it now asks for the live key explicitly. |
| `payment-confirmation/index.ts` | Has its own inline PandaDoc signing-link minter, deliberately, so the function bundles as a single file. The mode rule is duplicated there rather than breaking that property. |
| `pandadoc-resend/index.ts`, `pandadoc-void-regenerate/index.ts`, `amend-tenancy-start/index.ts` | Call `remindSignature` / `voidDocument`, which now need the mode. Each already loads the application, so it comes from the row. |
| `hubspot-sync/index.ts` | Sandbox is already excluded in SQL. This refuses any sandbox row that arrives anyway and reports it, because a test contact and a test deal in the production CRM is the most expensive leak here to undo by hand. |
| `resend-payment-email/index.ts` | Runs as service_role and resolves the application itself, so the restrictive policy is not what protects it. |
| `expiry-cohorts/index.ts`, `expiry-reminders/index.ts` | Two direct `from("applications")` reads under service_role, which RLS does not touch. The cohort list is emailed to partner management. |
| `src/config/environment.generated.ts` | Regenerated, not hand-edited. |

`create_referral`, `create_referral_api`, `partner_api_applications`,
`partner_api_orgs`, `create_referral_target_api`, `enqueue_partner_webhook` and
`partner_webhook_payload` were replaced in migrations rather than edited in
place, so the original files are untouched. Where a mandatory argument was added
the old signature is explicitly dropped: a defaulted argument would leave both
signatures callable, old callers would resolve to the old one, and a sandbox key
would silently mint live rows.

### 11.5 Sandbox references

Sandbox has its own sequence, `guarantee_ref_sandbox_seq`, formatted
`GR-TEST-1`. It does not share `guarantee_ref_seq`, so a sandbox reference is
unmistakable in a support conversation and the live sequence has no gaps
proportional to rehearsal volume.

### 11.6 Clearing sandbox data

`public.dev_purge_sandbox(p_partner uuid default null)`. Once the restrictive
policy is in place not even a superadmin can delete a sandbox row through
PostgREST, so without this they would accumulate for ever. Its where clause is
`not livemode` and never an id list, so a mistyped argument cannot delete real
money.

---

## 12. The api.opndoor.co hostname (you have to set this up)

The partner API contract says the base is `https://api.opndoor.co/v1`. That
hostname does not exist yet. Until it does, the API works only on the raw
function URL, and **no partner should be given a key**, because whatever they are
given first is what gets hardcoded.

### 12.1 What has to exist

**A DNS record for `api.opndoor.co`**, pointing at whatever fronts the rewrite.

**A rewrite mapping `/v1/*` to `/functions/v1/partner-api/v1/*`** on the Supabase
project. Note both `v1`s survive: the one the partner sends is ours, and the one
in the target is Supabase's Edge Function API version. It is not a typo.

```
https://api.opndoor.co/v1/orgs
  -> https://<ref>.supabase.co/functions/v1/partner-api/v1/orgs
```

Two ways to do it, and either is fine:

- **Vercel**, a project bound to the hostname with a rewrite in `vercel.json`.
  The portal already deploys there, so this needs no new vendor. Use a separate
  project rather than adding the hostname to the portal's, so a portal deploy
  cannot take the API down.
- **Cloudflare**, a transform or redirect rule, if DNS is already there. Fewer
  moving parts if the zone is already on Cloudflare.

### 12.2 The three things the rewrite must not do

These are the ways a proxy silently breaks this specific API:

1. **It must forward `Authorization` unchanged.** Some platforms strip or rewrite
   it by default as a security measure. If it is stripped, every request returns
   the same `401` with the same body as a wrong key, because the auth path is
   deliberately indistinguishable across every failure. You will not be able to
   tell a stripped header from a bad key by looking at the response.

2. **It must forward `Idempotency-Key` unchanged.** It is a custom header, and
   custom headers are exactly what an allowlist-style proxy drops. Dropping it
   turns `POST /applications` into a `400 idempotency_key_required` on every
   call. Less obviously, if it were dropped *after* validation, a retry after a
   timeout would create a second real application for the same tenant.

3. **It must not modify the body.** No re-encoding, no minifying, no charset
   rewriting. The idempotency ledger stores a hash of the body to detect the same
   key being reused with different content, so a proxy that normalises JSON makes
   a legitimate retry look like a key reused for a different application, which
   is a `422` rather than the replay the partner expects.

Also keep the response body untouched: the error contract is a JSON envelope
partners match on `error.code`.

### 12.3 Confirming it

```sh
# 1. the function itself, bypassing the rewrite
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer <good key>" \
  https://<ref>.supabase.co/functions/v1/partner-api/v1/orgs      # expect 200

# 2. the same thing through the hostname
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer <good key>" \
  https://api.opndoor.co/v1/orgs                                   # expect 200

# 3. the Authorization header really arrives (401 here but 200 above means stripped)
curl -s https://api.opndoor.co/v1/orgs                             # expect 401

# 4. Idempotency-Key really arrives: send the SAME key twice with the same body.
#    The second response must be identical to the first, including the id.
#    Two different ids means the header is being dropped.
```

Step 4 is the one worth doing properly. Steps 1 to 3 fail loudly; a dropped
idempotency key fails quietly and creates duplicate applications for real
tenants.

### 12.4 When it lands

Change `PARTNER_API_BASE_URL` in `src/config/partnerApi.ts`, or set
`VITE_PARTNER_API_BASE_URL` on the deployment, then re-run
`node scripts/generate-partner-docs.mjs` and commit the regenerated file. The
getting-started tab and the API documentation panel both follow it. There is no
other place the URL is written.

---

## 13. Two things to know before the partner work

### 13.1 The partner API is currently off for everyone

`partners.referencing_mode` defaults to `pre_referenced_screened`, and **no
migration anywhere sets any partner to `pre_referenced_open`**. The create path
dispatches on it:

```ts
// _shared/partnerApplications.ts
if (mode !== "pre_referenced_open") {
  ... { error: { code: "not_implemented",
                 message: "This partner's referencing mode is not yet available." } }
```

`pre_referenced_open` is the only mode implemented. The other two are specified
and return **501** by design until they are built. Put together: **every
`POST /v1/applications` returns 501 for every partner in the database today.**

This is not a defect, it is configuration that has never been done, and it is
easy to misread as a broken API because nothing else about the request fails. The
key authenticates, the scopes pass, the payload validates, and then it 501s.

So when the partner configuration work lands, **the Rightmove backfill is the
first step, not the tidying-up step.** Setting Rightmove to
`pre_referenced_open` is what turns the API on. Everything else in that work
(capability flags, the create screen, the audit trail) can follow.

`pre_referenced_open` means no Opndoor criteria are applied at all, which is a
commercial position granted to Rightmove specifically. It is deliberately not the
column default, so no partner inherits it by existing.

### 13.2 An application cannot be traced to the API key that created it

`partner_api_requests` (the idempotency ledger) carries `partner_id`,
`application_id`, `endpoint`, `idempotency_key`, `request_hash` and the response,
but **no `api_key_id`**. `partner_api_request_log` carries `api_key_id` but no
`application_id`. So the two halves of the question never meet: nothing joins a
created application to the key that created it.

Two consequences, one immediate and one to plan for.

**Immediate.** The Dev Centre's "delete this key" rule cannot ask "did this key
create any applications", so it asks **"did this key make any requests at all"**,
using `partner_api_request_log`. That is strictly stronger, and therefore safe: a
key that made no requests certainly created nothing. It is also more
conservative than intended, so a key that only ever made a failed `GET /orgs`
cannot be deleted. That trade is deliberate, and it is recorded here because the
rule reads oddly without knowing why.

**To plan for.** Once more than one partner is live, key-level attribution will be
wanted: which integration created this application, which key to revoke after an
incident, which of a partner's three keys is actually in use. Adding
`api_key_id uuid references public.partner_api_keys(id)` to
`partner_api_requests` is a small change and worth doing before there is a
backlog to leave un-attributed. Existing rows cannot be backfilled: the
information was never recorded, so they stay null and null honestly means
"created before we tracked this" rather than "created by no key".

Do it before the second partner integrates, not after.
