# Defects in the live system

These were found while disconnecting a working copy of the portal from
production. **They all exist in the live codebase.** None of them was introduced
by that work, and none has been fixed here, because fixing them belongs on the
live system rather than in a disposable dev tree.

Written for someone with no context on the disconnect work. Each entry is what
it is, what it costs the business, how to confirm it, and a suggested fix.

Defects 8, 9 and 10 were **adversarially verified** before being written down:
each was handed to a reviewer whose job was to prove it wrong. That process
killed a fourth claim outright and corrected the severity of two of these, so
what remains has survived a deliberate attempt at refutation. Where something
partially mitigates a defect, the entry says so.

`REGRESSION.md` tags the test steps that assert this behaviour, so the suite
passes as it stands and a change to a tagged step reads as a deliberate fix.

Worst first. Severity is stated per defect so it can be re-prioritised.

| # | Defect | Severity |
| - | ------ | -------- |
| 1 | Cron shared secret committed to the repo | Critical |
| 2 | A foreign Supabase project is hardcoded in three migrations | High |
| 3 | Stripe guards demand `sk_live_` while their headers claim test-only | High |
| 4 | Test email redirect removed from all thirteen sending modules | Critical |
| 5 | The repo cannot rebuild the live schema. Disaster recovery fails | High |
| 6 | A branch can lose its primary contact, stranding a paid tenant | Medium |
| 7 | The activity log states emails were redirected for testing when they were not | Medium |
| 8 | A payment on a staff-withdrawn application is taken, and both the tenant and staff are told the opposite of the truth | High |
| 9 | A failed deed void during a refund leaves a signable deed on a refunded application | High |
| 10 | Reinstated applications keep their expired and withdrawn markers | Low |
| 11 | `npm ci` fails, so there is no clean-room build and no CI | Medium |
| 12 | The Stripe mode guard on the payment page only covers checkout, so decline runs on a deployment already judged unsafe | Medium |
| 13 | Every caught error in the portal renders as a green success toast | High |

If only two get attention, make them **1 and 4**. Defect 1 is an exposed
credential and defect 4 is the one that reaches real tenants and agents.

Defect 13 is the cheapest to fix and the one most likely to be hiding the
others: while every failure looks like a success, no user report is reliable.

Defect 5 is different in kind from the others. It costs nothing while everything
is working, and everything if it is not.

---

## Defect 1: the cron shared secret is committed to the repo

**Severity: critical. Exposed on `origin/main`.**

### What it is

[supabase/EXPIRY-REMINDERS.md:62](supabase/EXPIRY-REMINDERS.md#L62) contains a
real 32-character secret as a literal, inside a runnable statement:

```sql
select vault.create_secret('<the actual secret is on this line>', 'reminders_cron_secret', 'expiry-reminders cron');
```

It is not a placeholder and not elided. It is the `REMINDERS_CRON_SECRET`: the
value the pg_cron jobs send as an `x-reminders-secret` header, and that the ops
migrations forward as `x-ops-secret`.

The file is tracked, it is at `HEAD`, and it is on `origin/main`. Anyone with
read access to the repository, now or historically, has the secret. So does
anyone holding a clone.

### Business impact

The secret is the only thing authenticating the cron-driven Edge Functions.
Holding it means being able to invoke them directly, on demand, without a portal
account. That includes the call documented three lines further down the same
file at
[supabase/EXPIRY-REMINDERS.md:105](supabase/EXPIRY-REMINDERS.md#L105):

```
{"test":true,"reset":true}
```

which clears the windowed reminder ledger. Clearing it means the reminder
schedule loses its record of what has already been sent. The visible outcome is
tenants and agents receiving duplicate or wrongly-timed expiry and payment
reminders, from the live system, with no obvious cause.

### Confirm it

```sh
git grep -n "vault.create_secret" -- supabase/EXPIRY-REMINDERS.md
git log --all -S "$(sed -n '62p' supabase/EXPIRY-REMINDERS.md | cut -d"'" -f2)" --oneline
```

### Suggested fix

**Rotate the secret. Do not just delete the line.** Deleting text from a file
does not retract a blob that has already been pushed; the value stays reachable
in history, and in every existing clone, forever. Rotation is what actually ends
the exposure. In order:

1. Generate a new value.
2. Update it in Vault and in the `REMINDERS_CRON_SECRET` Edge Function secret,
   and reseed the `public.ops_secrets` row named `reminders_cron`.
3. Only then replace the literal in the doc with a placeholder.

The correct pattern is already used by the sibling runbook at
[supabase/EXPIRY-COHORTS.md:31](supabase/EXPIRY-COHORTS.md#L31), which writes
`'<REMINDERS_CRON_SECRET>'`. Copy that.

Worth noting that the codebase already states this rule for itself.
[20260705091511_ops_secrets_cron_auth.sql:8-13](supabase/migrations/20260705091511_ops_secrets_cron_auth.sql#L8)
says the row "is seeded out-of-band (from the Vault secret, via SQL) so the
secret value is never committed", and the migration honours it. This is a single
slip in one runbook rather than a systemic habit, which is worth knowing before
anyone audits the rest of the docs in a panic.

Whether the pushed history also warrants a rewrite is a separate judgement.
Rotation is required either way and does not depend on it.

---

## Defect 2: a foreign Supabase project is hardcoded in three migrations

**Severity: high.**

### What it is

The project ref `pwftaqtrrqtilxlvwxjd` is written as a literal URL inside
executable SQL, in three tracked migrations. It is not the live production
project and not the dev project. It is a third project in the same organisation.

| Location | What it does |
| -------- | ------------ |
| [20260705153000_hubspot_sync_cron_and_trigger.sql:21](supabase/migrations/20260705153000_hubspot_sync_cron_and_trigger.sql#L21) | `cron.schedule('hubspot-sync', '*/2 * * * *', ...)` posting to that project |
| [20260705153000_hubspot_sync_cron_and_trigger.sql:37](supabase/migrations/20260705153000_hubspot_sync_cron_and_trigger.sql#L37) | `trigger_hubspot_sync()`, the admin "Sync HubSpot" button |
| [20260705110300_ops_alert_trigger_defensive_guard.sql:9](supabase/migrations/20260705110300_ops_alert_trigger_defensive_guard.sql#L9) | `alert_ops_on_failure()`, fires after every insert on `activity_log` |
| [20260705110300_ops_alert_trigger_defensive_guard.sql:39](supabase/migrations/20260705110300_ops_alert_trigger_defensive_guard.sql#L39) | `report_ops_incident()`, called from Edge Function catch blocks |
| [20260705102238_ops_failure_alerting.sql:25](supabase/migrations/20260705102238_ops_failure_alerting.sql#L25) and [:62](supabase/migrations/20260705102238_ops_failure_alerting.sql#L62) | Earlier definitions of the same two functions, superseded by `110300` |

The cron one is the most active. It is a top-level statement, so it executes at
migration time and installs a recurring job. It begins firing every two minutes
the moment the migration is applied, rather than waiting to be called.

### Business impact

Three separate costs.

**Ops alerting may be going to the wrong place.** If the live project is running
these function definitions, then failure alerts raised by `report_ops_incident`
are being posted to a different project's `ops-alert` endpoint. The team would
believe alerting is in place while incidents go unseen. Worth checking against
the live database, because that is the difference between having monitoring and
thinking you have monitoring.

**Failures are invisible.** The side-effect block in both ops functions is
wrapped in `exception when others then null`. A cross-project call that fails
does so silently, with nothing in the logs. There is no signal that anything is
wrong.

**It contaminates any new environment.** Applying this migration set to a fresh
project immediately schedules that project to call a foreign one every two
minutes. Anyone standing up a staging or dev environment inherits the problem
without knowing.

There is one mitigating fact. All of these attach the `ops_secrets.reminders_cron`
value as an `x-ops-secret` header. On a project where that row has not been
seeded the header is null and the receiving function rejects the call. So on a
brand new project this is inert. It activates the moment someone seeds the ops
secret, which is a normal setup step.

### Confirm it

```sh
git grep -n "pwftaqtrrqtilxlvwxjd" -- supabase/migrations/
```

Then, against the live database, check where the job actually points:

```sql
select jobname, schedule, command from cron.job where jobname = 'hubspot-sync';
```

### Suggested fix

**Add a new migration. Do not edit the existing ones.** Migrations that have
already been applied cannot be changed retroactively without the applied state
and the source diverging, which is worse than the defect.

The new migration should stop the URL being a literal at all. Two options:

- Store the target base URL in the existing `ops_secrets` table, or a small
  `ops_config` table, and have the functions read it. This keeps configuration
  in the database where it can differ per environment.
- Or derive it. `current_setting('app.settings.supabase_url', true)` is
  available in some configurations and avoids a second source of truth.

Either way the new migration should `create or replace` the two ops functions
and re-`cron.schedule` the `hubspot-sync` job, so the final state is corrected
without rewriting history.

Also seeded, in the same area and worth deciding on at the same time:
[20260705150500_hubspot_sync_seed.sql:26](supabase/migrations/20260705150500_hubspot_sync_seed.sql#L26)
sets `app_base_url` to `https://app.opndoor.co` on the active row. It is read as
`Deno.env.get("APP_URL") ?? env.app_base_url`, so on any environment where
`APP_URL` is unset, deed deep links pushed into HubSpot point at the production
portal.

---

## Defect 3: the Stripe guards demand `sk_live_` while their headers say test-only

**Severity: high.**

### What it is

Three Edge Functions refuse to run unless `STRIPE_SECRET_KEY` starts with
`sk_live_`:

| Location | Effect when the key is `sk_test_` |
| -------- | --------------------------------- |
| [payment-page/index.ts:134](supabase/functions/payment-page/index.ts#L134) | Tenant checkout returns 400 |
| [stripe-webhook/index.ts:29](supabase/functions/stripe-webhook/index.ts#L29) | 400 before signature verification, so Sent to Paid never settles |
| [create-referral/index.ts:35](supabase/functions/create-referral/index.ts#L35) | The whole staff send path returns 400 |

The documentation immediately above two of them states the exact opposite, and
is now false:

- [stripe-webhook/index.ts:17](supabase/functions/stripe-webhook/index.ts#L17):
  `// TEST MODE ONLY: refuses to run unless STRIPE_SECRET_KEY is an sk_test_ key.`
- [create-referral/index.ts:12](supabase/functions/create-referral/index.ts#L12):
  the same line.

[create-referral/index.ts:6](supabase/functions/create-referral/index.ts#L6)
also still describes opening "a Stripe test-mode Checkout Session".

### Business impact

**The payment path cannot be tested anywhere except production.** A test key is
rejected outright, so no dev or staging environment can exercise referral
creation, checkout, or payment settlement. The only environment where the flow
runs is the one handling real money. Changes to the payment path therefore ship
either untested or tested against live cards.

**The failure is silent about its cause.** The webhook returns a bare 400 before
signature verification. In Stripe's dashboard this looks like a failing endpoint,
not a configuration mismatch, which is a slow thing to diagnose under pressure.

**The comments actively mislead.** A developer reading the header of
`stripe-webhook/index.ts` will conclude the function is incapable of touching
real money. It is currently incapable of anything else. That is the kind of
wrong comment that causes an incident rather than merely wasting time.

Related, and cheap to fix at the same time: the client-side mode badge is
inverted. [src/data/paymentService.ts:16](src/data/paymentService.ts#L16) has
`stripeTestMode()` returning true only for a `pk_live_` key, and the badge it
drives at
[ApplicationDetail.tsx:740](src/pages/ApplicationDetail/ApplicationDetail.tsx#L740)
is labelled `Live Mode`. With a test publishable key the predicate is false and
**no badge renders at all**, so staff get no visual signal of which mode they are
in, in either direction.

### Confirm it

```sh
git grep -n 'startsWith("sk_live_")' -- supabase/functions/
git grep -n "TEST MODE ONLY" -- supabase/functions/
```

### Suggested fix

Make the required key mode a function of the environment rather than a constant,
so production keeps demanding `sk_live_` and non-production accepts `sk_test_`.

**A working implementation of this already exists** in the dev tree this
document came from, as `supabase/functions/_shared/stripeMode.ts` plus a
one-line guard swap in each of the three functions. It derives the required mode
from the project ref in `SUPABASE_URL`, fails closed on an unrecognised project,
and requires no configuration change on production. See section 5 of
`HANDOVER.md` in that tree. It is offered as a starting point, not as something
already validated against live.

Whatever shape it takes, two things should land with it:

1. Correct the three stale header comments, so the file documentation matches
   what the code does.
2. Fix `stripeTestMode()` so the badge reflects reality. It is a one-line
   predicate change plus a label that matches it.

---

## Defect 4: the test email redirect has been removed from all thirteen sending modules

**Severity: critical.**

### What it is

Thirteen modules previously routed every outbound recipient to a single
`EMAIL_REVIEW_ADDRESS` inbox, so no real person was contacted from a non-production
build. All thirteen now send to the real address.

In most of them the previous code is left commented out directly above the
replacement, and the file header still promises the redirect is in force. For
example
[_shared/executedDeedEmail.ts:5](supabase/functions/_shared/executedDeedEmail.ts#L5)
still reads "ALWAYS redirected to EMAIL_REVIEW_ADDRESS in this test build", while
[line 43](supabase/functions/_shared/executedDeedEmail.ts#L43) sends to the
tenant.

Affected, with the line that now sends to the real recipient:

| Module | Line | Note |
| ------ | ---- | ---- |
| `_shared/pandadoc.ts` | 321 | The PandaDoc signing link itself, on the legal path |
| `_shared/deedEmail.ts` | 42 | |
| `_shared/executedDeedEmail.ts` | 43 | |
| `_shared/paymentReceiptEmail.ts` | 21 | Redirect stripped entirely, no commented version left |
| `_shared/refundEmail.ts` | 20 | |
| `create-referral/email.ts` | 69 | Tenant payment link |
| `expiry-reminders/email.ts` | 61 | Fans out over a comma-separated recipient list |
| `payment-reminders/email.ts` | 68 | Cron driven, fires unattended |
| `resend-payment-email/email.ts` | 70 | |
| `send-password-reset/email.ts` | 65 | |
| `invite-user/email.ts` | 87 | |
| `expiry-cohorts/index.ts` | 172 | Attaches a base64 CSV of tenant data |
| `weekly-digest/index.ts` | 208 | Passes `redirected: false` as a literal, so its test-mode banner is permanently dead |

### Business impact

This is the defect with real people on the other end of it.

**Real tenants and agents get contacted from non-production environments.** Any
environment with a Resend key configured will email actual customers. Two of the
thirteen are cron driven, `payment-reminders` and `expiry-cohorts`, so they fire
unattended rather than waiting for someone to click something. Nobody has to make
a mistake for this to happen.

**One of them sends a legally operative document.** `_shared/pandadoc.ts:321`
sends the Deed of Guarantee signing link. A tenant receiving and signing a deed
generated from a test environment is a legal problem, not a support ticket.

**One of them attaches tenant data.** `expiry-cohorts/index.ts` builds a base64
CSV of tenant records and attaches it. Sent to an unintended recipient, that is a
data protection incident with a reporting obligation.

**The safety property is still documented as true.** Several runbooks tell the
reader that emails are redirected and therefore safe:
[supabase/DEEDS-TESTING.md:5](supabase/DEEDS-TESTING.md#L5),
[supabase/PAYMENTS-TESTING.md:29](supabase/PAYMENTS-TESTING.md#L29),
[VERIFICATION-SCRIPT.md:134](VERIFICATION-SCRIPT.md#L134). Someone following
those documents will believe they are working in a safe environment while
emailing customers. This is the mechanism by which the defect actually causes
harm.

The one thing currently holding it back: every module returns early unless
`RESEND_API_KEY` is set. An environment with no Resend key emails nobody. That
is the entire safety margin, and it is a single unset variable.

### Confirm it

```sh
git grep -n "EMAIL_REVIEW_ADDRESS" -- supabase/functions/
```

Every hit will be in a comment or a header. None is in live code.

### Suggested fix

Decide first whether the removal was deliberate. If the live system is meant to
email real customers, then the defect is only the stale comments and runbooks,
and the fix is to correct them. That is a real possibility given the recent
commits are titled things like "Live mode enable", so this should be confirmed
rather than assumed.

If it was not deliberate, or if any non-production environment will ever hold a
Resend key, then restore the redirect as an explicit environment-driven switch
rather than a commented-out block:

- Reinstate the redirect behind a check on `EMAIL_REVIEW_ADDRESS` being set:
  when it is set, all recipients go there, and when it is unset, mail goes to the
  real recipient. That makes the safe behaviour the one you get by configuring
  it, and production simply leaves it unset.
- Put the logic in one shared helper that all thirteen modules call, rather than
  reproducing it thirteen times. It was duplicated before, which is why removing
  it took thirteen separate edits and why the headers drifted out of sync.
- Delete the commented-out blocks once the helper exists. Commented-out code that
  contradicts the live code below it is what made this hard to read.

Whichever way it goes, the three runbooks above need correcting, because they
currently assert a safety property that does not hold.

---

## Defect 5: the repo cannot rebuild the live schema

**Severity: high. Costs nothing until the day it costs everything.**

### What it is

Applying this repository's migrations to an empty Postgres database **fails**.
Not once, but twice, for two unrelated reasons. The migration set is therefore
not a reproducible description of the running schema, and has not been for some
time.

This was found by doing it: a disposable project was reset and rebuilt from these
migrations, which is the only way this class of defect surfaces. Both failures
are now fixed in the tree that produced this document, but the fixes are not in
live.

**Cause 1: no migration enables any extension.**

There is no `create extension` statement anywhere in the migration set. A clean
apply dies at `20260703153600_rate_limit_cleanup.sql:10`, which calls
`cron.schedule()`:

```
ERROR: schema "cron" does not exist
```

pg_cron is required from that migration onward, and pg_net from
`20260705102238_ops_failure_alerting.sql`. The running projects work only because
somebody enabled both by hand in the Supabase dashboard. That action left no
trace in the repository, so it is invisible to anyone rebuilding from source.

**Cause 2: a function's return type is changed by `create or replace`.**

`public.reconciliation_queue()` is created with nine OUT columns at
[20260704130732_org_review_state_and_reconciliation.sql:92](supabase/migrations/20260704130732_org_review_state_and_reconciliation.sql#L92).
[20260705171000_reconciliation_fold_head_office.sql:8](supabase/migrations/20260705171000_reconciliation_fold_head_office.sql#L8)
then issues a `create or replace` with **ten**, adding `folded_head_office boolean`.

PostgreSQL does not permit this:

```
ERROR: cannot change return type of existing function (SQLSTATE 42P13)
Row type defined by OUT parameters is different.
```

Changing the OUT column list of a `RETURNS TABLE` function is a return type
change, and `create or replace` cannot do it. A `drop function` must come first.
Nothing in the tree ever drops it.

That live has a working ten-column `reconciliation_queue()` means the drop
happened **outside the migration set**, by hand. As with the extensions, that is
invisible to a rebuild.

### Business impact

**Disaster recovery does not work.** If the production project were lost,
corrupted, or needed rebuilding from source, the migration set would not
reconstruct it. Recovery would fall back to a physical backup, and if that were
unavailable or stale, to reconstructing a schema by hand under exactly the
pressure that makes mistakes likely.

**No environment can be created from source.** Staging, a second dev project, a
per-developer database, or a throwaway environment for testing a risky migration
are all blocked by the same wall. This is a standing tax on every piece of work
that would benefit from a clean environment, and it is probably part of why
testing has been happening against live (defect 3).

**The schema has undocumented manual steps.** Two are known now. The mechanism
that allowed them, a manual action in the dashboard that no migration records,
is still in place, so there may be others that have not surfaced because nothing
has forced a clean rebuild. The count is unknown, which is itself the problem.

**It undermines the migration set as a source of truth.** Reading the migrations
no longer tells you what the database looks like. Anyone reasoning about schema
from the repository is reasoning from something known to be incomplete.

### Confirm it

The only reliable test is to do it. Against a **disposable** project:

```sh
npx -y supabase@2.111.0 db reset --linked --yes
```

Statically, the two specific causes:

```sh
grep -rn "create extension" supabase/migrations/          # expect: no results
grep -rn "function public.reconciliation_queue" supabase/migrations/
grep -rn "drop function.*reconciliation_queue" supabase/migrations/  # expect: no results
```

### Suggested fix

Two migrations, both additive, both already written in the tree that produced
this document and available to lift:

1. **`20260703153500_enable_pg_cron_pg_net.sql`**, dated before its first
   consumer because a fresh project applies migrations in version order. Both
   statements use `if not exists`, so it is a **no-op on live**, where the
   extensions are already enabled. It records in the repo what is currently only
   true in the dashboard.

2. **`20260705170500_drop_reconciliation_queue_for_signature_change.sql`**,
   ordered immediately before `20260705171000`, dropping the function so the
   existing `create or replace` succeeds. Guarded with `if exists`, and
   `20260705171000` recreates the function and re-applies both grants on the next
   statement, so there is no window where it is missing. **Also a no-op in
   practice on live**, where the ten-column version already exists.

Neither changes live's behaviour. Both make live's state reproducible.

**The broader fix is a habit, not a migration.** These two were found only
because something forced a clean rebuild. Periodically rebuilding a disposable
project from the migration set is what stops the gap reopening, and it is cheap
now that the two known blockers are gone. Doing it as part of a release would
catch the next one at the point it is introduced rather than years later.

Worth noting for the future: `create or replace function` silently accepts many
changes but refuses a return type change. Any migration that alters a function's
OUT columns, argument types or return type needs an explicit `drop function`
first, and that is the pattern that produced cause 2.

---

## Defect 6: a branch can be left with no primary contact, and nothing repairs it

**Severity: medium. Narrow to reach, expensive when reached.**

### What it is

`public.agent_contacts` is supposed to hold exactly one primary contact per owner
(agency or branch). Deed generation depends on it: the agent email is resolved
through `effective_primary_contact`, and a branch with no primary resolves to
nothing.

The invariant is maintained in **five** places, and broken in a sixth.

Maintained:

| Where | What it does |
| ----- | ------------ |
| [core_schema.sql:196](supabase/migrations/20260702134239_core_schema.sql#L196) | INSERT trigger: the first contact for an owner is forced primary |
| [core_schema.sql:213-228](supabase/migrations/20260702134239_core_schema.sql#L213) | DELETE trigger: removing a primary promotes the next |
| [20260704145218:226](supabase/migrations/20260704145218_entity_consistency_org_rpcs.sql#L226) | `org_add_contact` forces primary when it is the first |
| [20260704145218:275-285](supabase/migrations/20260704145218_entity_consistency_org_rpcs.sql#L275) | `org_update_contact` re-checks after the edit and promotes the oldest if none is primary |
| `org_remove_contact` | Promotes on removal |

Broken:

| Where | What is missing |
| ----- | --------------- |
| [core_schema.sql:199](supabase/migrations/20260702134239_core_schema.sql#L199) | The UPDATE trigger only acts `if new.is_primary`. Clearing the flag on the only primary is not repaired |

So the invariant is enforced by **application code**, not by the schema. Any
write that does not go through the RPCs escapes it.

One such route exists today. [20260702134358:108](supabase/migrations/20260702134358_access_rls_rpc.sql#L108)
grants direct UPDATE on `agent_contacts` to any admin, or any `management` user
within their own partner:

```sql
create policy contacts_update on public.agent_contacts for update to authenticated
  using  (public.is_admin() or (public.app_role() = 'management' and partner_id = public.app_partner()))
```

A PostgREST call such as `PATCH /rest/v1/agent_contacts?id=eq.<uuid>` with
`{"is_primary": false}` therefore succeeds, bypasses `org_update_contact`, and
leaves the branch holding a contact with no primary. Nothing puts it back.

**The portal UI is not the route.** It calls `org_update_contact`, which repairs
correctly. This needs a direct API call, an integration, a script, or a manual
fix-up in the dashboard.

### Business impact

The failure is silent at the point it is caused and expensive at the point it
surfaces, and those are far apart.

Nothing breaks when the flag is cleared. The branch keeps working. Applications
can still be created against it, the tenant still receives a payment link, and
the tenant still pays.

**It fails at deed generation, after the money has been taken.**
[_shared/pandadoc.ts:414-418](supabase/functions/_shared/pandadoc.ts#L414):

```ts
const agentEmail = c?.email ?? null;
if (!agentEmail) {
  await service.from("applications").update({ deed_state: "error" }).eq("id", appId);
  ...
}
```

The application lands in `deed_state = 'error'` and the activity row explaining
why is written with `visibility: 'internal'`, so the referrer sees a stalled
application without the reason. The tenant has paid for a Deed of Guarantee that
cannot be issued until somebody notices and re-flags a contact as primary.

At partner-API volumes this matters more than it does today, because a partner
sending applications in bulk against one branch would generate a batch of paid
applications that all fail the same way.

There is a related reporting gap: nothing surfaces "branches that cannot issue a
deed" anywhere in the portal. The condition is only visible once an application
has already failed.

### Confirm it

Against a **disposable** project, on a branch whose only contact is primary:

```sql
update public.agent_contacts set is_primary = false where id = '<the only primary>';
select (public.effective_primary_contact('<branch uuid>')).email;  -- expect: null
```

The second statement returning null is the deed path's exact test.

### Suggested fix

**Move the invariant into the schema, where the other four guards already are.**
Extend the existing UPDATE trigger at
[core_schema.sql:199](supabase/migrations/20260702134239_core_schema.sql#L199)
so that clearing the last primary promotes another contact, mirroring what the
DELETE trigger already does at
[:213-228](supabase/migrations/20260702134239_core_schema.sql#L213) and what
`org_update_contact` already does at
[20260704145218:275-285](supabase/migrations/20260704145218_entity_consistency_org_rpcs.sql#L275).
The logic is already written twice; this is a third call site, not new
behaviour.

As a new migration, `create or replace function public.contacts_maintain_primary()`,
since the trigger itself does not need redefining.

Two things worth doing alongside it:

1. **Consider whether direct UPDATE on `agent_contacts` should be granted at
   all.** Every legitimate edit path goes through `org_update_contact`, which is
   `security definer` and enforces more than RLS does. The table-level grant is
   what allows the RPC to be bypassed. Narrowing it would close this and any
   similar gap in one move, but needs checking against whatever else writes to
   the table.
2. **Surface the condition.** A branch that cannot issue a deed is worth showing
   in the portal before an application fails against it, not after. The partner
   API's `GET /orgs` already computes exactly this as `has_agent_contact`, using
   `effective_primary_contact` so it matches the deed path; the same check would
   work in the org management screen.

---

## Defect 7: the activity log claims emails were redirected for testing when they were not

**Severity: medium. A false statement in an audit trail is worse than no statement.**

### What it is

`create-referral` writes a second activity row after every successfully sent
tenant payment email
([create-referral/index.ts:155-162](supabase/functions/create-referral/index.ts#L155)):

```ts
if (emailRes.ok && emailRes.to) {
  await service.from("activity_log").insert({
    application_id: appId,
    kind: "payment_email_sent",
    message: `Redirected to ${emailRes.to} (test mode).`,
    actor: "System",
    visibility: "internal",
  });
```

That row was correct when every email was redirected to a review inbox. Defect 4
removed the redirect, so `emailRes.to` is now the **real tenant's address**.

The result is an audit entry that states an email was redirected for testing, and
names as the redirect target the very person who actually received it. Every
application created since the redirect was removed has one.

The same mistake exists in `refundEmail.ts` but is **harmless there**: its guard
is `res.to !== p.tenantEmail`, which can no longer be true, so the row never
writes ([_shared/refundEmail.ts:87](supabase/functions/_shared/refundEmail.ts#L87)).
`create-referral` has no such guard. That contrast is the clearest evidence this
is an oversight rather than a decision.

### Business impact

**It tells the reader the opposite of the truth about a live safety property.**
Anyone auditing whether real tenants were contacted, from the activity log,
concludes they were not. The log says redirected. They were not redirected.

**It is the most likely place someone would check.** If a tenant reports an
unexpected email, the activity feed is the first thing anyone opens. It will
appear to exonerate the system.

**It is internal-visibility, which narrows but does not remove the harm.** Only
Opndoor admins see it, so partners are not misled. But Opndoor admins are exactly
the people who would be establishing what happened during an incident.

**It compounds defect 4.** Defect 4 is that the redirect is gone while file
headers and runbooks still claim it. This is the same false claim reaching the
per-application audit trail, which is the most authoritative-looking place it
could appear.

### Confirm it

```sh
git grep -n "test mode" -- supabase/functions/
```

Then, on any project where an application has been created with a Resend key
configured:

```sql
select message from public.activity_log
where kind = 'payment_email_sent' and message like 'Redirected to%';
```

Any row returned names a real recipient.

### Suggested fix

Decide first what the row is for, because deleting it loses something real. It is
the only place the **actual** delivery address is recorded; the sibling row says
only "Payment email sent to the tenant."

Two options:

1. **Correct the wording, keep the record.** Change the message to
   `Sent to <address>.` and keep it internal. The operational value survives and
   the false claim goes. Smallest change, and it fixes the only real loss.
2. **Restore the redirect and the row together.** If the redirect is reinstated
   as an environment-driven switch (see defect 4), gate this insert on the
   redirect having actually happened, mirroring the guard `refundEmail.ts`
   already has: only write it when the recipient differs from the tenant.

Option 2 is correct if defect 4 is being fixed anyway. Option 1 is correct if the
system is meant to email real tenants from now on. Either way the current text
should not survive, because it is the one thing in the audit trail that is
actively untrue.

---

## Defect 8: a payment on a staff-withdrawn application is taken, and both the tenant and staff are told the opposite of the truth

**Severity: high. Real money, and two people each shown the wrong answer.**

### What it is

`apply_stripe_payment` has three outcomes. A payment landing on an application a
member of staff withdrew (`withdrawn_by_tenant = false`) hits the third
([20260705115059:77-85](supabase/migrations/20260705115059_application_expiry_and_reinstate.sql#L77)):

```sql
elsif a.status = 'withdrawn' then
  -- Staff withdrawal: record the intent but do NOT flip to paid; flag for refund.
  update public.applications set
    stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent),
    stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session_id)
  where id = p_application_id;
```

The money has been taken by Stripe. The row keeps `status = 'withdrawn'` and
`payment_state = 'awaiting'`, and `paid_at` and `paid_amount` are never written.
Refusing to flip to `paid` is deliberate and correct. What follows is not.

**The tenant is told they paid.** `payment-confirmation` computes
([payment-confirmation/index.ts:84](supabase/functions/payment-confirmation/index.ts#L84)):

```ts
const paid = app.payment_state === "paid" || (!!app.status && app.status !== "sent");
```

`'withdrawn'` is not `'sent'`, so `paid` is **true**. The next line falls back to
`monthly_rent` when `paid_amount` is null, so `/pay/confirmed` renders "Payment
received", the full fee as the amount paid, and a promise that the Deed of
Guarantee is on its way for signature.

No deed is generated. No email is sent. The tenant has paid, been told it worked,
been quoted the right amount, and been promised a document that will never
arrive.

**Staff are told the opposite.** The Payment card on that same application reads
that it was withdrawn before payment so no guarantor fee was collected.

One `payment_anomaly` activity row is written, and one ops alert fires, deduped
to one per application per clock hour and only delivered if `OPS_ALERT_ADDRESS`
or `EMAIL_REVIEW_ADDRESS` is set.

### How a real tenant gets there

Narrow, but not preventable by the tenant-facing gates, which is what makes it
worth fixing rather than accepting.

Every link path already refuses a staff-withdrawn application: `payment-page`
computes `payable` as `sent` or `expired` and returns 409 otherwise,
`fire_payment_reminders` requires `status = 'sent'`, and `resend-payment-email`
returns 400 unless `status = 'sent'`. No new payable link can be issued.

**The hole is a Checkout Session that already exists.** Neither `create-referral`
nor `payment-page` sets `expires_at` on the session, so Stripe's 24 hour default
applies and the hosted URL stays payable for that window no matter what the row
does afterwards. `mark_withdrawn` checks only that the status is `sent`; it has
no awareness of a live session and gives staff no warning.

The most plausible sequence is the duplicate-referral one, and "duplicate
referral" is one of the withdrawal reasons the picker offers:

1. The tenant opens the payment page and clicks Pay. A session is minted; they
   leave the tab open.
2. Within 24 hours staff withdraw the application, as a duplicate or because the
   tenancy fell through. Both surface on exactly that timescale.
3. The tenant returns to the open tab and completes the payment.

There is a wider variant: a tenant who cancels checkout lands on `/pay/retry`,
which returns `payment_url`, the raw Stripe session URL. That URL is then in
their history, outside the token gate, for the rest of the session's life.

### Business impact

**Money is taken for a service that will not be delivered, and nobody is told
clearly.** The tenant believes they have a guarantee. They do not. They will find
out when a letting agent asks for a deed that does not exist, which is the worst
possible moment.

**Both humans who could catch it are shown the wrong answer.** The tenant sees
"Payment received". Staff see "no guarantor fee was collected". Neither has any
reason to escalate, so the only signal is an internal ops alert that may not be
configured to reach anyone.

**A refund is not automatic.** There is no refund-initiation code anywhere in the
repo, so somebody has to notice and act in the Stripe dashboard.

### What makes it less bad

Worth stating, so this is not overstated:

- **The refund itself works fine.** `stripe_payment_intent_id` is written on this
  branch, which is what a dashboard refund needs, and `apply_stripe_refund`
  takes its amount from the Stripe event rather than from `paid_amount`. A refund
  will land correctly on this row.
- The deliberate refusal to flip to `paid` is right. It prevents a deed being
  issued for a withdrawn application, which would be worse.
- The `payment_anomaly` row and the ops alert mean the system knows. The problem
  is who it tells.

### Confirm it

On a disposable project, with an application at `sent`:

```sql
select public.mark_withdrawn('GR-TEST1', 'duplicate', null);
select public.apply_stripe_payment(
         (select id from public.applications where guarantee_ref = 'GR-TEST1'),
         'pi_test', 1500, 'cs_test');

select status, payment_state, paid_at, paid_amount, stripe_payment_intent_id
  from public.applications where guarantee_ref = 'GR-TEST1';
-- expect: withdrawn / awaiting / null / null / pi_test
```

Then call `payment-confirmation` for that session id and observe that it reports
the tenant as paid.

### Suggested fix

Three changes, in order of value.

1. **Fix the tenant-facing lie first.** It is one line
   ([payment-confirmation/index.ts:84](supabase/functions/payment-confirmation/index.ts#L84)).
   `paid` should be `payment_state === 'paid'`, or should exclude `withdrawn` and
   `expired` explicitly. The current `status !== 'sent'` test also reports an
   expired application as paid, so this fix is worth making on its own.
2. **Close the window.** Set `expires_at` on the Checkout Session at creation,
   short enough to bound the exposure. Alternatively, have `mark_withdrawn` warn
   or refuse when `payment_state = 'awaiting'` and a session was minted
   recently, so staff know a payment may be in flight.
3. **Make the anomaly visible where a person will see it.** The `payment_anomaly`
   row exists; surfacing it on the application as a banner would mean staff see
   the contradiction rather than the reassuring Payment card.

---

## Defect 9: a failed deed void during a refund leaves a signable deed on a refunded application

**Severity: high. A legally operative document issued on a refunded application.**

### What it is

When a refund arrives and a deed is still out for signature, the webhook tries to
void it. The void and the clearing of the document id both happen **only if the
PandaDoc call succeeded** ([stripe-webhook/index.ts:116-127](supabase/functions/stripe-webhook/index.ts#L116)):

```ts
if (appRow.pandadoc_document_id && appRow.deed_state === "awaiting_tenant") {
  const voidResult = await voidDocument(appRow.pandadoc_document_id);
  if (voidResult.ok) {
    await service.from("applications").update({ deed_state: "voided", pandadoc_document_id: null })...
```

There is no `else`. If PandaDoc is down, rate limits, or times out, the failure
is discarded silently: `deed_state` stays `awaiting_tenant`, `pandadoc_document_id`
stays set, and **the signing link the tenant already has stays live**.

`apply_stripe_refund` never touches `status`, so the application is still `paid`.
When the tenant signs, `apply_deed_executed` matches on `pandadoc_document_id`,
finds a `paid` application, and takes its normal path: `status` becomes `deed`,
`deed_state` becomes `executed`, the deed is delivered to the agent, the executed
copy goes to the tenant, and HubSpot is pushed to the deed-issued stage.

A full Deed of Guarantee is issued, and sent to the agent as valid, on an
application whose fee has been refunded.

### Why this is the version worth writing down

An earlier reading of this suspected the `else` branch of `apply_deed_executed`
([20260703101635:22-27](supabase/migrations/20260703101635_deed_executed_leave_issue_date.sql#L22)),
which writes `deed_state = 'executed'` without transitioning status. That branch
is real and permissive, but it is **unreachable**: no withdrawn or expired
application can hold a PandaDoc document, so it never executes. It is
defence-in-depth that happens to be written loosely.

This defect is the reachable one, and it does not depend on that branch at all.
It goes through the ordinary `paid` path, because the application really is still
`paid`.

### Business impact

**Opndoor guarantees a tenancy it has not been paid for.** The deed is a legal
instrument. It is delivered to the letting agent, who has every reason to rely on
it, and there is nothing on its face to indicate the fee was refunded.

**Nobody is alerted.** The void failure is discarded without a log line, without
an activity row and without an ops incident. The only trace is the absence of the
`deed_voided` row that would normally appear, which nobody is watching for.

**HubSpot records it as a completed deal**, so the CRM shows a refunded
application at the deed-issued stage.

**The trigger is an external service having a bad minute.** It needs no user
error and no unusual sequence, just a PandaDoc timeout during a refund. It will
happen eventually.

### Confirm it

Simulate the void failure rather than waiting for one: point
`PANDADOC_API_KEY` at an invalid value on a disposable project, or block the
PandaDoc host, then refund an application whose deed is out for signature.

```sql
select deed_state, pandadoc_document_id, status, payment_state
  from public.applications where guarantee_ref = 'GR-TEST1';
-- after the refund, expect: awaiting_tenant / <still set> / paid / refunded
```

The signing link in the tenant's inbox still works. Completing it issues the deed.

### Suggested fix

**Handle the failure.** The minimum is an `else` that records it:

- Write an activity row, `deed_void_failed`, at internal visibility, and make it
  an ops-alert kind so somebody is told. The alerting mechanism already exists.
- Clear `pandadoc_document_id` and set `deed_state` to `error` even when the
  remote void fails, so the application cannot silently execute. The document is
  still live at PandaDoc, but the portal will no longer accept its completion,
  which is the half of the problem this codebase controls.
- Better still, retry. A void that fails because PandaDoc was briefly unavailable
  should be retried rather than abandoned on the first attempt.

Consider also whether `apply_deed_executed` should refuse when
`payment_state = 'refunded'`. It is a cheap guard, and it would make the
outcome safe even if the void never happens.

---

## Defect 10: reinstated applications keep their expired and withdrawn markers

**Severity: low. Certain to happen and permanent, but nothing reads these columns today.**

### What it is

`apply_stripe_payment` deliberately reinstates a closed application when a
payment arrives late, from `expired` or from a tenant-declined `withdrawn`
([20260705115059:66](supabase/migrations/20260705115059_application_expiry_and_reinstate.sql#L66)).
The UPDATE that follows sets `status`, `paid_at`, the Stripe ids, `paid_amount`
and `payment_state`, and nothing else.

`expired_at`, `withdrawn_at`, `withdrawn_reason` and `withdrawn_by_tenant` are
never cleared, by that branch or anywhere else in the tree. So a fully paid
application permanently carries the markers of the state it was rescued from.

The table constraint does not catch it: the `paid` arm of
`applications_status_dates` asks only for `paid_at`
([20260705115059:17](supabase/migrations/20260705115059_application_expiry_and_reinstate.sql#L17)).

Precisely which columns survive, since this is narrower than it first looks: the
expired route leaves only `expired_at`. The tenant-decline route leaves only
`withdrawn_at`, `withdrawn_reason` and `withdrawn_by_tenant`. `withdrawn_by` is
explicitly nulled by the tenant decline and `withdrawn_note` is never set by it,
so neither ever survives. A staff withdrawal never reinstates at all.

### Business impact

**Nothing is misreported today**, and this should not be presented as though it
were. Every current consumer keys on `status`: the client derives its flags from
it, the CSV export filters on those derived booleans, and the League, the weekly
digest and the climbers RPC all filter on `status not in ('withdrawn','expired')`.
Neither stale column appears in the partner webhook payload. That claim is
checkable in one grep, and it holds.

What it costs is future-tense and it is a trap rather than a bug:

- **Every late payment leaves a self-contradictory row.** Anyone reading the
  table directly sees a paid application carrying an expiry timestamp and has to
  reconcile it against `activity_log`.
- **The obvious ad hoc query is wrong.** "How many lapsed last quarter?" written
  as `where expired_at is not null` over-counts by every late payment. Because
  reinstatement is the designed outcome of the expiry flow rather than a rarity,
  the error is systematic and one-directional: it inflates churn and deflates
  conversion.
- **It becomes a real defect the first time a report keys on these columns**,
  and worse if that report is partner-facing or drives commission.

### Confirm it

```sql
update public.applications set sent_at = now() - interval '20 days'
 where guarantee_ref = 'GR-TEST1';
select public.expire_stale_applications(current_date);
select public.apply_stripe_payment(
         (select id from public.applications where guarantee_ref = 'GR-TEST1'),
         'pi_test', 1500, 'cs_test');

select status, paid_at, expired_at from public.applications where guarantee_ref = 'GR-TEST1';
-- expect: paid / set / expired_at STILL SET
```

To size the exposure on live before changing anything:

```sql
select count(*) from public.applications
 where status in ('paid','deed') and (expired_at is not null or withdrawn_at is not null);
```

That count is exactly how many reinstatements have already happened.

### Suggested fix

**Clear the columns in the reinstate branch.** Nothing is lost: the history is
already in `activity_log` as the `expired` or `withdrawn` row plus the
`payment_reinstated` row, and the partner is told separately via
`application.reinstated`. If the prior state genuinely must live on the row, move
it to `prior_expired_at` and `prior_withdrawn_at` so no filter on the live column
can pick it up. Note `withdrawn_by_tenant` resets to `false`, not null.

**Then make it unable to recur** by extending the `paid` and `deed` arms of
`applications_status_dates` with `and expired_at is null and withdrawn_at is null`.
Backfill first or the constraint will fail validation on existing rows.

Do not fix this with a partial index or a tidy view. Both hide the contradiction
rather than remove it, and the next person to write SQL against the base table
falls into the same trap, which is the actual cost here.

---

## Defect 11: `npm ci` fails, so there is no clean-room build

**Severity: medium. The same class as defect 5: the repo cannot rebuild itself.**

### What it is

`package.json` and `package-lock.json` are out of sync, so `npm ci` refuses to
run at all:

```
npm error code EUSAGE
npm error `npm ci` can only install packages when your package.json and
npm error package-lock.json or npm-shrinkwrap.json are in sync.
npm error Missing: @emnapi/core@1.11.3 from lock file
npm error Missing: @emnapi/runtime@1.11.3 from lock file
```

`npm install` still works, because it resolves and rewrites the lockfile as it
goes. `npm ci` deliberately will not: it installs strictly from the lock, which is
the whole point of it.

### Business impact

**`npm ci` is the command a clean build uses.** Continuous integration, a
container build, a fresh machine and a from-source rebuild all use it rather than
`npm install`, precisely because it is reproducible and will not silently drift.
None of those can run against this repo today.

**Builds are not reproducible.** Two developers running `npm install` a month
apart can resolve different transitive versions, because the lockfile is not
being honoured as the source of truth. A bug that appears on one machine and not
another has nowhere to be diagnosed from.

**It blocks the fix for other defects.** There is no CI in this repository, which
is part of why the `verify_jwt` drift and the migration failures in defect 5 went
unnoticed. Adding CI is the obvious remedy for that class of problem, and CI
begins with `npm ci`.

**This is the same shape as defect 5.** That one is that the migrations cannot
rebuild the database. This one is that the dependencies cannot rebuild the app.
Together they mean the repository, on its own, cannot reconstruct a working
system, which is worth seeing as one problem rather than two.

### Confirm it

```sh
npm ci
# expect: npm error code EUSAGE, listing packages missing from the lock file
```

### Suggested fix

Run `npm install` once on a machine with a clean checkout, and **commit the
updated `package-lock.json`**. That is the whole fix. It is deliberately not done
here because it edits a tracked file, and the working rule for this tree is to
add rather than edit.

Two things worth doing at the same time:

1. **Check the diff before committing it.** If `npm install` moves more than the
   missing `@emnapi` entries, the lockfile has drifted further than this error
   suggests and the rest of the change deserves reading rather than accepting.
2. **Add `npm ci` to a CI job**, even a trivial one that only installs and type
   checks. It is what stops the lockfile drifting again, and it would have caught
   this the day it happened.

### One related environment note, not a defect

`node_modules` as shipped in this working copy was installed on **Windows**: the
only native builds present were `@esbuild/win32-x64` and
`@rollup/rollup-win32-x64-*`. On macOS nothing could run until the platform
binaries were fetched. The Unix shims in `node_modules/.bin` also arrived without
their execute bit, while the Windows `.cmd` files kept theirs.

That is a property of how this copy was handed over rather than of the repository,
so it is not a defect against live. It is recorded because it costs an hour to
diagnose from scratch, and because the same zip-from-Windows route is what
produced the partial CRLF conversion noted in `HANDOVER.md` section 5.

---

## Defect 12: the payment page's Stripe mode guard only covers checkout, so a decline is accepted on a deployment already judged unsafe

**Severity: medium. A state-changing tenant action runs on a deployment the code has already decided must not take money, and the misconfiguration is not discovered until a tenant is standing in front of it.**

### What it is

`payment-page` is the tokenised public function a tenant lands on. It handles
three actions: `view`, `decline` and `checkout`. It reads the Stripe secret once
at the top of the handler, but the mode guard is not there. It sits inside the
checkout branch alone
([payment-page/index.ts:138](supabase/functions/payment-page/index.ts#L138) before this
work):

```ts
const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") ?? "";   // top of handler
...
if (action === "checkout") {
  ...
  const modeError = stripeKeyModeError(STRIPE_SECRET);           // only here
  if (modeError) return json({ ok: false, error: modeError }, 400);
```

Compare `create-referral` and `stripe-webhook`, which both call the same guard as
the first thing they do, before any body parsing. The placement here is the
outlier.

`stripeKeyModeError` exists to stop a deployment operating when its Stripe key
does not match its project: an `sk_live_` key on a dev project, or an `sk_test_`
key on production. It is a statement that this deployment must not be trusted
with money.

Guarding only checkout means the other two actions ignore that statement.
`decline` is the one that matters, because it is not a read. It resolves the
token, marks the application declined, and writes an activity entry. So on a
deployment the guard has already judged unsafe, a tenant can still permanently
decline a real guarantee.

This function is `verify_jwt = false`. The tokenised link is the entire
authorisation, so there is no second gate behind this one.

### Business impact

Two costs, and the second is the larger.

**A real state change on a deployment that must not be trusted.** The most likely
way this bites is a dev or staging copy pointed at production data with a live
key installed. Checkout refuses, which is the guard working. Decline does not,
and a declined application is not a draft: the tenant is told their guarantee is
off, the referrer sees it closed, and reinstating it is a manual job.

**Detection is deferred to the worst possible moment.** With the guard on the
whole handler, a misconfigured deployment fails on the first page load and
somebody notices in testing. With it on checkout alone, the page renders, the
tenant reads it, decides to pay, clicks, and only then gets a flat 400. The
person who discovers the misconfiguration is a tenant part-way through paying,
and what they see is a dead end with no route forward.

It does not charge a card in the wrong mode: that path is guarded. This is about
where the failure surfaces and what is allowed to happen before it does.

### Confirm it

On any non-production project, set an `sk_live_` key:

```
supabase secrets set STRIPE_SECRET_KEY=sk_live_... --project-ref <non-prod-ref>
```

Then, against a valid payment token:

```bash
# view: expect 200 and the full application payload, no mode error
curl -s -X POST "$URL/functions/v1/payment-page" \
  -H "Content-Type: application/json" \
  -d '{"token":"<token>","action":"view"}'

# decline: expect 200 and the application actually declined in the DB
curl -s -X POST "$URL/functions/v1/payment-page" \
  -H "Content-Type: application/json" \
  -d '{"token":"<token>","action":"decline"}'

# checkout: expect 400 "This is a non-production project and requires an sk_test_ key."
curl -s -X POST "$URL/functions/v1/payment-page" \
  -H "Content-Type: application/json" \
  -d '{"token":"<token>","action":"checkout"}'
```

The first two succeeding while the third refuses is the defect.

### Suggested fix

Move the guard to the top of the handler, beside the other two functions that
already do it:

```ts
const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const modeError = stripeKeyModeError(STRIPE_SECRET);
if (modeError) return json({ ok: false, error: modeError }, 400);
```

One caveat worth stating rather than discovering: this makes a misconfigured
deployment return 400 for `view` as well, so the tenant sees an error page
instead of their application. That is the intended behaviour, and it is better
than the alternative, but it means the misconfiguration becomes loudly visible to
tenants rather than quietly visible to staff. Fix the key, not the guard.

### Note on this working copy

This one is **already fixed here**, unlike the other eleven, because sandbox mode
had to move the key resolution below the application fetch anyway: the key is now
chosen by the application's `livemode` rather than by the project, so it has to be
resolved after the row is known. Moving it also closed this gap as a side effect.
It is recorded here because it predates that work and is present in live, and
because the fix in this tree is entangled with sandbox and is not a clean
cherry-pick. See HANDOVER.md section 11.4.

---

## Defect 13: every caught error in the portal renders as a green success toast

**Severity: high. Not because of what it breaks, but because of what it hides. While a failure is indistinguishable from a success, no user report about anything else can be trusted.**

### What it is

`useToast()` returns a function taking one argument, a message. The renderer has
no notion of failure and hardcodes a tick
([Toast.tsx](src/components/ui/Toast.tsx), before this work):

```tsx
const ToastContext = createContext<(message: string) => void>(() => {});
...
<div className={`toast${t.shown ? ' is-in' : ''}`}>
  <Icon name="check" strokeWidth={2.4} />
  <span>{t.message}</span>
</div>
```

So the near-universal error-handling pattern in this codebase:

```tsx
catch (e) {
  toast(e instanceof Error ? e.message : 'Could not withdraw the application.');
}
```

renders "Could not withdraw the application." in the dark confirmation pill with
a **green tick** beside it, in exactly the same position, colour and duration as
"Application withdrawn."

There are **34 error-carrying toast calls outside the Dev Centre**, across
Reconciliation, UserManagement, ApplicationDetail, OrgManagement, PartnerManagement
and others. Every one of them is affected. The toast auto-dismisses after 3.2
seconds, which is short for reading an error you were not expecting to be one.

### Business impact

The direct cost is that a user believes an action succeeded when it did not, and
does not retry. Withdrawing an application, resending a payment email, confirming
a reconciliation record, sending a deed to an agent: each has a failure path that
reports itself with a tick.

The larger cost is diagnostic. Two Dev Centre bugs found while testing this week
both presented as "the button does nothing" rather than "the operation failed",
because the error toast looked like a confirmation and was read as one. Both had
clear server-side error messages that were displayed to the user and dismissed as
success. **While this defect exists, "it did nothing" and "it failed loudly" are
the same observation**, and every bug report from staff is degraded accordingly.

It also affects screen reader users more sharply: the toast has no `role="alert"`,
so an error is announced politely, queued behind whatever is being read, or not at
all.

### Confirm it

Any error path will do. The quickest with no setup:

1. Sign in as management and open an application.
2. Withdraw it, then withdraw it again from a second tab so the second call finds
   it already withdrawn.

The second attempt fails server side and shows the failure message with a green
tick. Alternatively, open devtools, block requests to `/rest/v1/`, and press
almost any action button.

### Suggested fix

Already done in this tree, and it is small: the tone is an optional second
argument defaulting to success, so no existing call site had to change to keep
working.

```tsx
export type ToastTone = 'ok' | 'error';
const toast = useCallback((message: string, tone: ToastTone = 'ok') => { ... });
...
<div className={`toast toast--${t.tone}...`}
     role={t.tone === 'error' ? 'alert' : 'status'}
     aria-live={t.tone === 'error' ? 'assertive' : 'polite'}>
  <Icon name={t.tone === 'error' ? 'alert' : 'check'} strokeWidth={2.4} />
```

Errors also get a red background and a 6 second dismiss rather than 3.2.

### What is and is not fixed here, precisely

**The mechanism is fixed. Most of the call sites are not.**

- `Toast.tsx` and `Toast.css` carry the fix, and it is backward compatible.
- Every call site **in the Dev Centre** passes `'error'` on failure paths.
- The **34 error-carrying calls elsewhere in the portal still pass no tone, so
  they still render green.** They are unchanged on purpose: they are live code
  that predates this work, and the standing rule here was not to edit live files
  beyond what the task required.

So this is a two-part fix and only the first part is done. Carrying the
`Toast.tsx` change across gets you the capability; the defect is not closed until
the call sites pass the tone. Finding them is mechanical:

```sh
grep -rn "toast(" src --include=*.tsx | grep -iE "err|fail|could not|cannot"
```

Do not reapply the component change from scratch. Take it, then sweep the call
sites.
