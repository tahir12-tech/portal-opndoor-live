# Handover

Written for the developer taking this over. Assumes no knowledge of the session
that produced it.

**Status:** in progress. This document is updated as work lands. See
[Open items](#open-items-for-you) for what needs you.

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

**Deciding what to do here is yours.** It is a behavioural change to existing
files, so nothing has been touched.

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

## 5. Open items for you

Ordered by urgency, not by effort.

| # | Item | Why it needs you |
| - | ---- | ---------------- |
| 1 | **Rotate the `REMINDERS_CRON_SECRET`** and remove the literal from [supabase/EXPIRY-REMINDERS.md:62](supabase/EXPIRY-REMINDERS.md#L62) | Section 4a. A real secret is committed and pushed to `origin/main`. This is an exposure in the live repo and is independent of anything done in this working copy. Rotating is the fix; deleting the line alone is not. |
| 2 | Decide what to do about the `sk_live_` gates | Section 4b. Until this is resolved the payment path cannot be tested on the dev project at all, because a test key is rejected outright. |
| 3 | Decide whether the removed email redirect is intended | Section 4c. Thirteen modules now email real people. Safe only while no `RESEND_API_KEY` is set on the dev project, so **do not set one** until this is settled. |
| 4 | Decide how to repoint the foreign project ref in migrations | Section 4d. Needs a **new** migration, not an edit. Applying the current set to dev installs a cron job that hits a foreign project every two minutes. |
| 5 | Confirm edge function secrets on the dev project | Stripe secret key, Stripe webhook secret, PandaDoc API key and template id, Resend key. These live as Edge Function secrets, never in this repo. The dev project needs its own set pointed at **test/sandbox** credentials, subject to items 2 and 3. |
| 6 | Register a Stripe **test-mode** webhook against the dev project | The live webhook points at the live functions URL. Payment flows will not settle in dev without a test-mode endpoint and its own signing secret. |
| 7 | Decide whether `origin/main` history needs a rewrite | Section 4e. The live project ref is in a pushed commit. A ref is a public identifier rather than a credential, so this may be acceptable; it is a judgement call, not a clear-cut fix. |
| 8 | Rebuild `dist/` before using `npm run preview` | The committed-on-disk bundle is a stale build still pointing at a foreign project. |

### Deliberately not done

- **`VITE_ADDRESS_LOOKUP_KEY` is not set.** The New Application form falls back
  to manual address entry. This is an accepted limitation in dev, not a bug.
- **`VITE_PANDADOC_SANDBOX` is not set.** The deed UI will not show the
  "Sandbox" badge. The flag is cosmetic; it does not control which PandaDoc
  environment is used. That is determined by the server-side API key.
- **Nothing under `supabase/migrations/` has been touched.**
- **Git history has not been rewritten.** See section 3.

---

## 6. Environment reference

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
