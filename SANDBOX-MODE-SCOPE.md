# SCOPE REPORT: `live` / `sandbox` mode, one Supabase project

> ## ⚠️ SUPERSEDED. This is a record of a decision point, not a description of the system.
>
> Written **before** sandbox mode was built, to scope it. The decision it was
> written to inform has since been made and the work is done, so several
> statements below are now false by design:
>
> - "There is **no** `mode`, `livemode`, `environment` or `env` column on
>   `public.applications` anywhere in the tree today" — there is now:
>   `applications.livemode`.
> - "This tree is currently built around **two Supabase projects**" — it is not.
>   One project, with `livemode` deciding the mode per row and per API key.
> - The 79 surfaces and 51 file edits are the estimate for a shape that was not
>   the one built. The delivered shape was narrower: nobody sees sandbox through
>   PostgREST at all, so the portal client needed no changes.
>
> **What is still worth reading here:** the reasoning about why RLS alone cannot
> carry the guarantee, why the failure direction inverts between reads and
> writes, and the trade between one project and two. Those held up and shaped
> what was built.
>
> **For how the system actually works, read HANDOVER.md section 11.** Kept
> unedited below rather than corrected, because a scoping document rewritten
> after the fact stops being evidence of what was known at the time.

Read-only pass over 86 migrations, 23 Edge Functions and the full client. Every line number below was re-derived with `grep -n` / direct read in this session. There is **no** `mode`, `livemode`, `environment` or `env` column on `public.applications` anywhere in the tree today: this is greenfield, and nothing currently breaks. Every "would leak" verdict describes what happens once sandbox rows exist.

---

## 1. The headline

**79 surfaces must change.** Counting rule: one surface = one distinct place a change lands. Downstream consumers that inherit a fix are not counted.

| If missed | Count | What actually happens |
|---|---|---|
| **Leaks sandbox into a real number or record** | **41** | A test row is in a commission figure, a bordereau, a partner's weekly email, a HubSpot record, a partner API response, or an admin's needs-attention count |
| **Runs a sandbox action against a live third party or a real person** | **17** | A real card charged on live Stripe, a real tenant emailed a payment link, a real agent emailed a deed, a live PandaDoc document created, a signed webhook delivered to the partner's production receiver |
| **Hides sandbox** | **13** | Safe direction, but the feature does not work: the developer sees zero rows, or the screen says "Live Mode" over a sandbox record |
| **Blocks: schema and type additions** | **8** | Nothing works until they exist |

**58 of the 79 fail toward sandbox reaching something real.** That is the number that decides whether this goes ahead.

Three structural facts that drive everything:

- There is no `force row level security` anywhere in the 86 migrations. `SECURITY DEFINER` functions and `service_role` bypass RLS completely.
- **26 SECURITY DEFINER functions** read or write `public.applications`. **10 of them are granted to `authenticated`**, so any signed-in browser can call them directly with `fetch`. Four return `public.applications`, i.e. the entire row.
- **16 of the client's reporting reads** go through `allFull()` at [src/data/applicationsService.ts:90](src/data/applicationsService.ts#L90); 13 of those pass through `scopeFull()` at [src/data/paymentMetrics.ts:35](src/data/paymentMetrics.ts#L35). Two lines cover most of the client. One read bypasses both, and it is the bordereau.

---

## 2. The one decision that determines everything: the column default

```sql
-- the table, today, with no mode column
create table public.applications (
```
[supabase/migrations/20260702134239_core_schema.sql:107](supabase/migrations/20260702134239_core_schema.sql#L107)

There are exactly **two** insert paths: `create_referral` at [supabase/migrations/20260810210000_developer_role_and_fail_open_guards.sql:82](supabase/migrations/20260810210000_developer_role_and_fail_open_guards.sql#L82) and `create_referral_api` at [supabase/migrations/20260810130000_create_referral_api.sql:79](supabase/migrations/20260810130000_create_referral_api.sql#L79). Whatever the column default is, that is what every unchanged writer produces.

**The failure direction inverts between reads and writes, and the proposal only states the read rule.** Requirement 3 ("anything nobody updates must hide sandbox rows") is a rule about *reads*. Applying the same instinct to the *write* default gives the opposite of what is wanted:

- `default 'sandbox'`: an unchanged `create_referral` silently mints sandbox rows. Real referrals vanish from management's list, from the bordereau, from commission, from settlement, from HubSpot. Silent, total, and it destroys real revenue. Requirement 3 asks us to tolerate a developer seeing nothing, not a partner going unpaid.
- `default 'live'`: sandbox rows exist only where new code deliberately created one. Nothing unchanged can manufacture one. The read-side fail-safe is then carried entirely by the RLS restrictive policy and by explicit predicates in the definer and service-role paths, not by the default.
- `not null, no default`: every unchanged insert dies with a not-null violation. Most honest, most disruptive, blast radius of exactly two functions.

**Recommendation: `mode text not null default 'live' check (mode in ('live','sandbox'))`, plus a mandatory no-default `p_mode` argument on `create_referral_api`, plus a `before update` trigger making the column immutable.** The three pieces are not interchangeable:

- The **default** stops unchanged writers producing invisible rows.
- The **mandatory argument** stops the API path silently producing live rows from a sandbox key. A defaulted `p_mode` would create an overload, Postgres would resolve the old 16-argument call to the old signature, and a sandbox key would keep minting live applications with nothing complaining.
- The **trigger** is required because RLS cannot express column immutability: a `using` clause sees only OLD, a `with check` clause sees only NEW, and no policy expression references both. Without it, `applications_update` at [supabase/migrations/20260702134358_access_rls_rpc.sql:124](supabase/migrations/20260702134358_access_rls_rpc.sql#L124) lets a management user flip a real fee-bearing application to `sandbox` and delete it from the bordereau.

**Name it something other than `mode`.** The word is already taken four times: `partners.referencing_mode` at [supabase/migrations/20260810100000_partner_referencing_mode.sql:43](supabase/migrations/20260810100000_partner_referencing_mode.sql#L43) (whose own comment at [:50](supabase/migrations/20260810100000_partner_referencing_mode.sql#L50) says "mode is not a permission"); a `mode: string` parameter on `deliverDeedToAgent` meaning automatic/manual at [supabase/functions/_shared/deedEmail.ts:153](supabase/functions/_shared/deedEmail.ts#L153); `hubspot_sync_env`'s sandbox/production meaning *which HubSpot portal* at [supabase/functions/hubspot-sync/index.ts:9](supabase/functions/hubspot-sync/index.ts#L9); and the router already passes `partner.referencing_mode` positionally into a parameter literally named `mode` at [supabase/functions/partner-api/index.ts:232](supabase/functions/partner-api/index.ts#L232) into [supabase/functions/_shared/partnerApplications.ts:282](supabase/functions/_shared/partnerApplications.ts#L282). Both are bare strings. `environment` or Stripe's `livemode` costs nothing now.

---

## 3. Where RLS cannot save us

The proposal says "enforced in RLS so it holds regardless of what any screen does". **That sentence is true only for paths RLS governs, and the majority of application reads in this system are not.**

### 3.1 The RLS half is genuinely clean and genuinely additive

`applications_select` at [supabase/migrations/20260702134358_access_rls_rpc.sql:115](supabase/migrations/20260702134358_access_rls_rpc.sql#L115) has three positive arms: `is_admin()`, management-by-partner, referrer-by-owner. There is no `developer` arm anywhere in that file, so **a developer sees zero applications today**. The proposal is not loosening a grant, it is creating one.

Because Postgres ANDs restrictive policies with every permissive policy including the `is_admin()` arm, a **new** restrictive policy subtracts sandbox from superadmin, management and referrer without touching a line of existing SQL. The tree already uses that idiom six times on adjacent tables, including [supabase/migrations/20260702134358_access_rls_rpc.sql:60](supabase/migrations/20260702134358_access_rls_rpc.sql#L60). Write it positively (`mode = 'live' or is_developer()`), never `mode <> 'sandbox'`: a NULL or a future third value must deny, not admit. Declare it `for all`, not `for select`, or the insert policy at [supabase/migrations/20260702134358_access_rls_rpc.sql:120](supabase/migrations/20260702134358_access_rls_rpc.sql#L120) still lets a management user POST `{"mode":"sandbox"}` straight at PostgREST, which is mode-from-payload arriving through the table.

`is_developer()` already exists at [supabase/migrations/20260810210000_developer_role_and_fail_open_guards.sql:43](supabase/migrations/20260810210000_developer_role_and_fail_open_guards.sql#L43).

### 3.2 An `is_admin()` disjunct defeats inheritance

Two policies on two tables read the same data and behave oppositely. `activity_log_select` at [supabase/migrations/20260702174141_activity_log.sql:13](supabase/migrations/20260702174141_activity_log.sql#L13) and `app_notes_select` at [supabase/migrations/20260705124804_application_notes.sql:19](supabase/migrations/20260705124804_application_notes.sql#L19) both scope through `application_id in (select id from public.applications)`, so the inner select runs under the caller's RLS and they inherit the sandbox restriction for free.

`tct_read` at [supabase/migrations/20260704205648_tenancy_correction_schema.sql:30](supabase/migrations/20260704205648_tenancy_correction_schema.sql#L30) does not. Its left operand is a bare `public.is_admin()` that never references `applications`, so it returns every correction token to a superadmin regardless of mode. Same file, same policy, two arms, two opposite behaviours. It needs its own restrictive policy.

### 3.3 SECURITY DEFINER: 26 functions, 10 reachable from a browser

`revoke execute on all functions in schema public from public` at [supabase/migrations/20260702134957_harden_functions.sql:19](supabase/migrations/20260702134957_harden_functions.sql#L19) is followed by a grant list ending `to authenticated, service_role;` at [supabase/migrations/20260702134957_harden_functions.sql:35](supabase/migrations/20260702134957_harden_functions.sql#L35).

**Granted to `authenticated`, so callable straight from a signed-in browser, RLS entirely bypassed:**

| Function | Site | Addressed by | Returns |
|---|---|---|---|
| `amend_tenancy_start` | [20260703103841:36](supabase/migrations/20260703103841_amend_deed_state_aware.sql#L36) | `id` | **whole row** ([:24](supabase/migrations/20260703103841_amend_deed_state_aware.sql#L24)) |
| `set_application_status` | [20260703143224:17](supabase/migrations/20260703143224_tighten_set_application_status_admin_only.sql#L17) | `id` | **whole row** ([:8](supabase/migrations/20260703143224_tighten_set_application_status_admin_only.sql#L8)) |
| `mark_withdrawn` | [20260705095955:13](supabase/migrations/20260705095955_mark_withdrawn_by_ref.sql#L13) | `guarantee_ref` | **whole row** ([:7](supabase/migrations/20260705095955_mark_withdrawn_by_ref.sql#L7)) |
| `send_deed_to_agent` | [20260702171551:40](supabase/migrations/20260702171551_tighten_related_writes.sql#L40) | `id` | jsonb, emails a real agent |
| `add_application_note` | [20260705124804:36](supabase/migrations/20260705124804_application_notes.sql#L36) | `guarantee_ref` | jsonb |
| `referrer_league` | [20260810210000:143](supabase/migrations/20260810210000_developer_role_and_fail_open_guards.sql#L143) | partner | league rows |
| `reconciliation_queue` | [20260705171000:30](supabase/migrations/20260705171000_reconciliation_fold_head_office.sql#L30) | all | referral counts |
| `cron_health` | [20260705125214:138](supabase/migrations/20260705125214_cron_health_rpc.sql#L138) | all | ops counts |
| `count_pending_tenancy_corrections` | [20260704205648:52](supabase/migrations/20260704205648_tenancy_correction_schema.sql#L52) | join | badge count |
| `create_referral` | [20260810210000:82](supabase/migrations/20260810210000_developer_role_and_fail_open_guards.sql#L82) | insert | whole row |

The concrete failure: a superadmin is barred from sandbox by RLS, then handed the complete sandbox row, every column including `partner_rate` and `agent_rate`, by `set_application_status`, whose only permission check is "are you a superadmin". `mark_withdrawn` and `add_application_note` are addressed by `guarantee_ref`, which is a contiguous sequence starting at 20601 ([supabase/migrations/20260702134239_core_schema.sql:34](supabase/migrations/20260702134239_core_schema.sql#L34)) shared by both insert paths, so refs are enumerable and "exists but is not visible" is itself a signal about sandbox volume.

Each of these needs its own guard, in its own replacement, raising the same `application not found` message so the RPC cannot be used to probe. There is no central place to fix them and no RLS backstop if one is missed.

### 3.4 Service-role: 27 direct table touches across 17 Edge Functions

`service_role` carries BYPASSRLS. There are **27** direct `.from("applications")` calls in `supabase/functions/`. Most are anchored on a specific id, ref or Stripe session, so they route to the right row by construction and need mode only for third-party key selection. **One is an unanchored collection read and it is a true reporting leak:**

```ts
const { data: apps, error: appErr } = await service.from("applications")
```
[supabase/functions/expiry-cohorts/index.ts:120](supabase/functions/expiry-cohorts/index.ts#L120), filtered only on `status = 'deed'` and an expiry range, then emailed as a CSV to every partner's Management at [supabase/functions/expiry-cohorts/index.ts:126](supabase/functions/expiry-cohorts/index.ts#L126). No policy will ever touch this. (The second unanchored read, [supabase/functions/expiry-reminders/index.ts:95](supabase/functions/expiry-reminders/index.ts#L95), is behind a `test && reset` flag and is not on the cron path.)

### 3.5 The most dangerous single consequence

`apply_stripe_payment` at [supabase/migrations/20260705115059_application_expiry_and_reinstate.sql:57](supabase/migrations/20260705115059_application_expiry_and_reinstate.sql#L57) takes its target from Stripe session metadata read at [supabase/functions/stripe-webhook/index.ts:58](supabase/functions/stripe-webhook/index.ts#L58) and passed unvalidated at [supabase/functions/stripe-webhook/index.ts:67](supabase/functions/stripe-webhook/index.ts#L67), then writes `status`, `paid_at`, `paid_amount` and `payment_state`. Today the metadata is set server-side from the token at [supabase/functions/payment-page/index.ts:152](supabase/functions/payment-page/index.ts#L152) and there is one Stripe account, so the hole is latent. **The moment a second Stripe account shares this endpoint, anyone who can create a test-mode session in it can name a live application id and mark it paid**, which then generates a deed at [supabase/functions/stripe-webhook/index.ts:84](supabase/functions/stripe-webhook/index.ts#L84) and emails a real tenant a receipt at [supabase/functions/stripe-webhook/index.ts:88](supabase/functions/stripe-webhook/index.ts#L88). Mode must be checked in the database, not only in the Edge Function.

---

## 4. Would leak sandbox into a real number (41)

Ordered by how visible the number is.

| # | Surface | What it reads/writes | If left alone | Fix | Add or edit |
|---|---|---|---|---|---|
| 1 | `buildLiveBordereau` [src/data/exportsService.ts:997](src/data/exportsService.ts#L997) | `allFull()` with **no scoping call at all**, the only reporting read that skips `scopeFull` | Sandbox row becomes a premium owed on a guarantee that does not exist, in the underwriter's declaration, with real tenant name, DOB and address ([:1006](src/data/exportsService.ts#L1006)) | explicit `a.mode === 'live'` in the predicate, on top of the `allFull()` fix | edit |
| 2 | `hubspot_pending_events` [20260705150000:141](supabase/migrations/20260705150000_hubspot_sync_schema.sql#L141) | joins `activity_log` to `applications`, hands `to_jsonb(a.*)` to the sync | Sandbox applications become real HubSpot Applicant records in a real pipeline, within two minutes of creation, no human in the loop. Not rollback-able | `and a.mode = 'live'` | **additive** (`create or replace`, same signature) |
| 3 | `enqueue_partner_webhook` [20260810160000:106](supabase/migrations/20260810160000_partner_webhook_enqueue.sql#L106) | endpoint fan-out filtered on `e.partner_id` only | Every sandbox event delivered to the partner's **production** receiver, HMAC-signed with the production secret, indistinguishable from real | read `mode` alongside `partner_id` at [:95](supabase/migrations/20260810160000_partner_webhook_enqueue.sql#L95), add `and e.mode = v_mode` | **additive** |
| 4 | `partner_api_applications` [20260810200000:114](supabase/migrations/20260810200000_partner_api_applications.sql#L114) | partner REST read model, scoped on partner only | Both directions: a live key lists sandbox rows; a **sandbox key lists live tenant PII and a working payment token** | mandatory `p_mode` | new migration, **drop-then-create** |
| 5 | `apply_stripe_payment` [20260705115059:57](supabase/migrations/20260705115059_application_expiry_and_reinstate.sql#L57) | flips status and writes money columns by id from webhook metadata | Cross-mode settlement: sandbox row reaches `paid` with a `paid_amount` that every bordereau and settlement then reads | `p_mode` compared against `a.mode` | drop-then-create + caller edit |
| 6 | `getCommissionSettlement` [src/data/liveAnalytics.ts:355](src/data/liveAnalytics.ts#L355) | `scopeFull(allFull())`, commission at [:360](src/data/liveAnalytics.ts#L360) | Overpayment on the 15th | covered by #13/#14 | none if #13/#14 done |
| 7 | `getAgentCommissionSettlement` [src/data/liveAnalytics.ts:440](src/data/liveAnalytics.ts#L440) | per-agency agent commission | Overpayment | covered | none |
| 8 | `partner_weekly_digest` [20260705110146:18](supabase/migrations/20260705110146_partner_weekly_digest_cohort_conversion.sql#L18) | unfiltered `base` CTE feeding eight aggregates | Monday email to every partner's Management carries inflated fees | one `where a.mode = 'live'` on `base` at [:15](supabase/migrations/20260705110146_partner_weekly_digest_cohort_conversion.sql#L15) fixes all eight | **additive** |
| 9 | `partner_weekly_climbers` [20260705130959:16](supabase/migrations/20260705130959_partner_weekly_climbers_deterministic.sql#L16) and [:23](supabase/migrations/20260705130959_partner_weekly_climbers_deterministic.sql#L23) | two independent scans | Fabricated Climber of the Week. Filtering one window and not the other reproduces the exact bug this migration was written to fix | both CTEs or neither | **additive** |
| 10 | `expiry-cohorts` [supabase/functions/expiry-cohorts/index.ts:120](supabase/functions/expiry-cohorts/index.ts#L120) | service-role select, no RLS in the path | Sandbox line items in a partner's renewal spreadsheet, with tenant names and addresses | `.eq("mode","live")` | **edit, unavoidable** |
| 11 | `fire_payment_reminders` [20260705090637:39](supabase/migrations/20260705090637_payment_reminder_schema.sql#L39) | returns `tenant_email` and `payment_url` for a cron mail run | **A real person who is not a customer is chased for money** | `and a.mode = 'live'` | **additive** |
| 12 | `fire_expiry_reminders` [20260703122741:37](supabase/migrations/20260703122741_expiry_reminder_schema.sql#L37) | returns referrer addresses | Real referrer emailed about a fake guarantee | `and a.mode = 'live'` | **additive** |
| 13 | `scopeFull` [src/data/paymentMetrics.ts:35](src/data/paymentMetrics.ts#L35) | role + partner isolation for **13 of 16** reporting reads | Every dashboard KPI, league row, trend point, settlement and export | unconditional `set = set.filter(a => a.mode === 'live')` as the first statement. **No `includeSandbox` parameter**: requirement 4 means reporting must have no way to ask | edit |
| 14 | `allFull()` [src/data/applicationsService.ts:90](src/data/applicationsService.ts#L90) | the raw working set, 16 call sites | Same, plus the bordereau bypass | return live-only; add a separately named accessor for the developer's operational screen | edit |
| 15 | `liveAggregate` [src/data/liveAnalytics.ts:86](src/data/liveAnalytics.ts#L86) | funnel, fees, refunds, both commissions | Dashboard headline and Performance export | covered by #13 | none |
| 16 | `referrer_league` [20260810210000:143](supabase/migrations/20260810210000_developer_role_and_fail_open_guards.sql#L143) | **five** independent reads of `applications`: [:129](supabase/migrations/20260810210000_developer_role_and_fail_open_guards.sql#L129), [:131](supabase/migrations/20260810210000_developer_role_and_fail_open_guards.sql#L131), [:143](supabase/migrations/20260810210000_developer_role_and_fail_open_guards.sql#L143), [:156](supabase/migrations/20260810210000_developer_role_and_fail_open_guards.sql#L156), [:158](supabase/migrations/20260810210000_developer_role_and_fail_open_guards.sql#L158) | Rank and fees disagree if any one is missed | all five | **additive** |
| 17 | `feesNet` in hydrate [src/lib/hydrate.ts:201](src/lib/hydrate.ts#L201) | agency and branch fees net of refunds | Money on OrgManagement, and the mock-league fee base. **A second route into a league figure that fixing `allFull()` does not close** | filter before the bucketing at [:187](src/lib/hydrate.ts#L187), not inside `feesNet`, or counts and money desync | edit |
| 18 | branch/agency buckets [src/lib/hydrate.ts:187](src/lib/hydrate.ts#L187) | referrals, guaranteed, fees per org | Inflated org metrics | same filter | edit |
| 19 | per-partner count [src/lib/hydrate.ts:165](src/lib/hydrate.ts#L165) | `Partner.apps` and the analytics weight | Superadmin-only Partners screen shows sandbox volume | count live only | edit |
| 20 | `reconciliation_queue` [20260705171000:30](supabase/migrations/20260705171000_reconciliation_fold_head_office.sql#L30) | `referral_count` per pending org | Inflates the evidence an admin presses Confirm on. **Note: the subquery WHERE is an OR of two disjuncts; appending `and ap.mode='live'` binds to the second only. Parenthesise the OR** | predicate, parenthesised | **additive** |
| 21 | `cron_health` [20260705125214:138](supabase/migrations/20260705125214_cron_health_rpc.sql#L138) | `stuck_sent`, `awaiting_signature`, plus `pending_tenancy_corrections` at [:144](supabase/migrations/20260705125214_cron_health_rpc.sql#L144) which has no join to `applications` at all | Sandbox rows sit at `sent` by design, so the ops page is permanently and increasingly wrong | two predicates plus one new join | **additive** |
| 22 | `count_pending_tenancy_corrections` [20260704205648:52](supabase/migrations/20260704205648_tenancy_correction_schema.sql#L52) | dashboard badge, admin arm does join applications | Wrong badge | one predicate closes both roles | **additive** |
| 23 | `alert_ops_on_failure` [20260705110300:11](supabase/migrations/20260705110300_ops_alert_trigger_defensive_guard.sql#L11) | reads `new.kind`, never joins applications | Pages ops for deliberate sandbox breakage, training everyone to ignore the alerts that catch real failures | look up mode, route sandbox elsewhere | **additive** |
| 24 | `expire_stale_applications` [20260705115059:29](supabase/migrations/20260705115059_application_expiry_and_reinstate.sql#L29) | 14-day sweep, returns one mixed count | Mixed operational figure, **and** every touched row fires the webhook trigger at [20260810190000:74](supabase/migrations/20260810190000_partner_webhook_reinstated_event.sql#L74), so sandbox lapses reach live endpoints from a function nobody would look at | decide whether sandbox lapses; split or filter | **additive** |
| 25 | `apply_stripe_refund` [20260702192702:14](supabase/migrations/20260702192702_refund_policy_anomaly.sql#L14) | bare UPDATE by payment intent, no unique constraint on that column | Cross-account intent id updates rows in both modes | mode predicate | **additive** |
| 26 | `apply_deed_executed` [20260703101635:12](supabase/migrations/20260703101635_deed_executed_leave_issue_date.sql#L12) | by `pandadoc_document_id`, `if not found then return` silently | Two PandaDoc accounts, two id namespaces, no disambiguation | mode predicate | **additive** |
| 27 | `set_deed_state` [20260703075024:48](supabase/migrations/20260703075024_pandadoc_deed_schema.sql#L48) | bare UPDATE by document id | Same | mode predicate | **additive** |
| 28 | `create_referral_api` [20260810130000:79](supabase/migrations/20260810130000_create_referral_api.sql#L79) | 16-column insert, no mode | **A sandbox key creates a live, fee-bearing, HubSpot-synced, tenant-emailed application.** This is the single biggest write hole | mandatory `p_mode` | drop-then-create + caller edit |
| 29 | `partnerApplications` RPC call [supabase/functions/_shared/partnerApplications.ts:395](supabase/functions/_shared/partnerApplications.ts#L395) | 16 named args | Where "mode from the key, never the payload" is enforced or lost | pass `auth.mode`; reject a `mode` field in the body rather than ignoring it (unknown top-level fields are silently dropped today) | edit |
| 30 | `partnerAuth` key lookup [supabase/functions/_shared/partnerAuth.ts:134](supabase/functions/_shared/partnerAuth.ts#L134) and return [:160](supabase/functions/_shared/partnerAuth.ts#L160) | selects `id, partner_id, key_hash, scopes, revoked_at, expires_at` | Mode cannot reach any handler | add `mode` to select, type and return. Coerce anything not exactly `'sandbox'` to `'live'`, and record that this is a deliberate choice | **edit, unavoidable** |
| 31 | key prefix regex [supabase/functions/_shared/partnerAuth.ts:129](supabase/functions/_shared/partnerAuth.ts#L129) | already parses `opnd_(live\|test)` and discards it | **An `opnd_test_` key is fully live today.** The naming already promises a separation that does not exist | do **not** derive mode from the prefix, it is attacker-supplied header text; read the stored column and assert the two agree | edit |
| 32 | `partner_api_requests_idem_idx` [20260810110000:50](supabase/migrations/20260810110000_partner_api_requests.sql#L50) | unique on `(partner_id, endpoint, idempotency_key)` | A key first used in sandbox replays the **sandbox response, with the sandbox application id**, to a live request at [supabase/functions/partner-api/index.ts:441](supabase/functions/partner-api/index.ts#L441). No live application created; the partner believes one was. Surfaces on go-live day | add `mode` to the table, index and the lookup at [:412](supabase/functions/partner-api/index.ts#L412) | new migration + edit |
| 33 | `create_referral_target_api` [20260810140000:68](supabase/migrations/20260810140000_create_referral_target_api.sql#L68) | inserts agencies, branches, contacts, `org_audit` at `pending_review` | Sandbox testing generates **real human review work** in an opndoor admin's Reconciliation queue, and a confirmed agency is pushed to HubSpot seconds later ([src/pages/Reconciliation/Reconciliation.tsx:66](src/pages/Reconciliation/Reconciliation.tsx#L66)) | forbid org creation from a sandbox key; require existing ids | edit |
| 34 | `applications_select` [20260702134358:115](supabase/migrations/20260702134358_access_rls_rpc.sql#L115) | the root read | Sandbox rows to superadmin, management, referrer | new restrictive policy + new permissive developer policy | **additive** |
| 35 | `applications_update` [20260702134358:124](supabase/migrations/20260702134358_access_rls_rpc.sql#L124) | no mode component | Real revenue can be hidden by flipping a row to sandbox | restrictive with-check + immutability trigger | **additive** |
| 36 | `tct_read` [20260704205648:30](supabase/migrations/20260704205648_tenancy_correction_schema.sql#L30) | `is_admin()` short-circuit | Superadmin sees sandbox correction reports | separate restrictive policy on that table | **additive** |
| 37 | `amend_tenancy_start` [20260703103841:36](supabase/migrations/20260703103841_amend_deed_state_aware.sql#L36) | definer, by id, returns whole row | Full sandbox row disclosure and mutation to any partner-scoped user | mode gate reusing the not-found message | **additive** |
| 38 | `set_application_status` [20260703143224:17](supabase/migrations/20260703143224_tighten_set_application_status_admin_only.sql#L17) | definer, admin-only, returns whole row, **no caller anywhere in the repo** | Superadmin mutates a row RLS hid from them | revoke it; it is a dead RPC that moves applications through the money states | **additive** |
| 39 | `mark_withdrawn` [20260705095955:13](supabase/migrations/20260705095955_mark_withdrawn_by_ref.sql#L13) / `add_application_note` [20260705124804:36](supabase/migrations/20260705124804_application_notes.sql#L36) / `send_deed_to_agent` [20260702171551:40](supabase/migrations/20260702171551_tighten_related_writes.sql#L40) | definer, by ref/id | Enumerable disclosure and mutation; a deed emailed to a real agent | mode gates | **additive** |
| 40 | `scopedSet` [src/data/applicationsService.ts:133](src/data/applicationsService.ts#L133) | Applications list, chip counts, dropdowns, duplicate check | The fail-open twin of `scopeFull`: it has no role allowlist, so a developer admitted to `/applications` sees the entire partner book | positive allowlist + mode gate | edit |
| 41 | `findRecord` [src/data/applicationsService.ts:326](src/data/applicationsService.ts#L326), `allSummaries` [:37](src/data/applicationsService.ts#L37) via GlobalSearch [src/components/layout/GlobalSearch.tsx:27](src/components/layout/GlobalSearch.tsx#L27), `inScope` [src/data/activityService.ts:53](src/data/activityService.ts#L53), the two direct activity_log joins [:208](src/data/activityService.ts#L208) and [:263](src/data/activityService.ts#L263) | unscoped by role, partner or mode | GlobalSearch renders on **every** authenticated screen including `/dev-centre`, with no scoping and memo deps of `[q, partnerScope]` ([:45](src/components/layout/GlobalSearch.tsx#L45)). If one client read is missed in this whole exercise, it is this one | route through scoped accessors | edit |

**Third parties running against live accounts (17)** are in section 6; they are leaks in the same sense but a different kind of damage.

---

## 5. Would hide sandbox (13): safe but broken

| Surface | If left alone | Note |
|---|---|---|
| Route guard [src/App.tsx:78](src/App.tsx#L78) | `RequireRole roles={['superadmin','management','referrer']}` redirects a developer to `/dev-centre`. **A developer cannot reach `/applications` at all** | Hard blocker for requirement 2. Either edit this, or build the sandbox view inside `/dev-centre` as a new file |
| Nav model [src/constants/nav.ts:30](src/constants/nav.ts#L30) | No nav item lists `developer` except Dev Centre | Untouched if the Dev Centre route is taken |
| `applications_select` developer arm | Developer sees zero rows even with the restrictive policy in place | The restrictive policy alone is not enough; a new permissive policy is required |
| `scopeFull` role allowlist [src/data/paymentMetrics.ts:42](src/data/paymentMetrics.ts#L42) | `role !== 'superadmin' && role !== 'management'` sends `developer` to `set = []`. A developer calling any reporting builder gets honest zeros | **Do not widen this to admit developer.** It is currently the accidental enforcement of requirement 4 |
| `activity_feed` [20260702134358:252](supabase/migrations/20260702134358_access_rls_rpc.sql#L252) and `upcoming_expiries` [:277](supabase/migrations/20260702134358_access_rls_rpc.sql#L277) | `security_invoker`, so they inherit and fail safe. **Neither has any consumer in the repo** | Dead surface, granted to `authenticated`. State it rather than implying it is live |
| `dev_api_keys` [20260810250000:51](supabase/migrations/20260810250000_dev_centre_stable_ordering.sql#L51), `dev_webhook_endpoints` [:30](supabase/migrations/20260810250000_dev_centre_stable_ordering.sql#L30), `dev_webhook_deliveries` [20260810220000:167](supabase/migrations/20260810220000_dev_centre_rpcs.sql#L167) | Partner-scoped, not mode-scoped, so the switch would change nothing | `dev_webhook_deliveries` also returns the full frozen payload at [:162](supabase/migrations/20260810220000_dev_centre_rpcs.sql#L162), which carries tenant PII |
| The five monitoring RPCs `dev_api_stats` [20260810230000:59](supabase/migrations/20260810230000_partner_api_request_log.sql#L59), `dev_api_timeseries`, `dev_api_errors_by_method`, `dev_webhook_stats`, `dev_api_logs` [:164](supabase/migrations/20260810230000_partner_api_request_log.sql#L164) | A developer who sends fifty sandbox requests and sees zero concludes the API is broken | **Requirement 4 needs an explicit carve-out here**: these are diagnostics, not reporting, and should follow the switch. Say so, or "every export" sweeps `dev_api_logs` in |
| Key minting [supabase/functions/dev-centre/index.ts:107](supabase/functions/dev-centre/index.ts#L107) | `PORTAL_ENV` decides the prefix. On the live project every key is `opnd_live_` and **a sandbox key cannot be minted at all** | Directly blocks the proposal, and reverses a documented decision |
| `portalEnvironment()` [src/data/devCentreService.ts:289](src/data/devCentreService.ts#L289) | Derives live/sandbox from the project ref. Under one project it returns one constant answer forever | Not a data leak; it means the banner says "Live" while a developer views sandbox rows |
| Dev Centre banner [src/pages/DevCentre/DevCentre.tsx:182](src/pages/DevCentre/DevCentre.tsx#L182) | "Sandbox and live are separate projects with separate databases, so neither can show the other's..." becomes **false** | Worse than stale: it tells the next reader cross-mode leakage is structurally impossible, so they stop looking |
| Payment badge [src/pages/ApplicationDetail/ApplicationDetail.tsx:740](src/pages/ApplicationDetail/ApplicationDetail.tsx#L740) | Build-time key check. `stripeTestMode()` at [src/data/paymentService.ts:16](src/data/paymentService.ts#L16) returns true for `pk_live_`, and the badge then reads "Live Mode". **Name, doc comment and body disagree three ways** | Would say "Live Mode" on every sandbox application |
| Deed badge [src/pages/ApplicationDetail/ApplicationDetail.tsx:818](src/pages/ApplicationDetail/ApplicationDetail.tsx#L818) | Build-time `VITE_PANDADOC_SANDBOX` | Never fires on the live project |
| Applications memo deps [src/pages/Applications/Applications.tsx:114](src/pages/Applications/Applications.tsx#L114) | Deps exclude `dataVersion` and mode; the eslint-disable on the line above suppresses the warning | After a flip, the previous mode's rows stay on screen under the new banner. Stale in both directions |
| Session hydration cache [src/session/SessionContext.tsx:211](src/session/SessionContext.tsx#L211) | Keyed on `userId` alone | A mode flip is treated as "already hydrated" and skipped entirely. `refresh()` at [:280](src/session/SessionContext.tsx#L280) closes over a stale `role` with an empty dep array, a pre-existing defect a mode switch would inherit |

The cheapest client-side enforcement of requirement 2 is one line next to [src/session/SessionContext.tsx:287](src/session/SessionContext.tsx#L287): `const mode = role === 'developer' ? selectedMode : 'live'`, which makes sandbox structurally unreachable for every other role, including any role added later.

---

## 6. Third parties

### Stripe

```ts
return NON_PRODUCTION_REFS.has(projectRef()) ? "sk_test_" : "sk_live_";
```
[supabase/functions/_shared/stripeMode.ts:44](supabase/functions/_shared/stripeMode.ts#L44)

**This file exists to forbid exactly what the proposal requires.** One project, one `STRIPE_SECRET_KEY`. On the production ref this returns `sk_live_` unconditionally and `stripeKeyModeError` rejects an `sk_test_` key, so a sandbox application either cannot take payment or **takes it on live Stripe and charges a real card**. Nothing crashes. Its three callers ([supabase/functions/create-referral/index.ts:35](supabase/functions/create-referral/index.ts#L35), [supabase/functions/payment-page/index.ts:50](supabase/functions/payment-page/index.ts#L50), [supabase/functions/stripe-webhook/index.ts:31](supabase/functions/stripe-webhook/index.ts#L31)) pass only the secret, so there is no additive route: mode must become a parameter, which gives up the property the file was built for, that the answer comes from an unforgeable platform value rather than an operator's choice.

The webhook is harder. `WEBHOOK_SECRET` is read at [supabase/functions/stripe-webhook/index.ts:30](supabase/functions/stripe-webhook/index.ts#L30) and signature verification happens at [supabase/functions/stripe-webhook/index.ts:41](supabase/functions/stripe-webhook/index.ts#L41), **before any application is loaded**. A sandbox-signed event fails `constructEventAsync`, returns 400, and Stripe retries forever. **Mode is not available at the point it is needed and must be derived from which signing secret verified.** The guard at [:31](supabase/functions/stripe-webhook/index.ts#L31) is the first executable statement in the handler and cannot be made per-mode additively.

`stripe_events` dedupes on the event id alone at [supabase/functions/stripe-webhook/index.ts:49](supabase/functions/stripe-webhook/index.ts#L49) and returns 200 on conflict. **I could not confirm whether Stripe guarantees `evt_` ids are unique across accounts.** If they are not, a collision silently swallows a real payment. Low likelihood, severe if true, worth one email to Stripe.

### PandaDoc

`KEY`, `TEMPLATE_ID` and `WEBHOOK_KEY` are module-level constants captured at import: [supabase/functions/_shared/pandadoc.ts:18](supabase/functions/_shared/pandadoc.ts#L18), [:19](supabase/functions/_shared/pandadoc.ts#L19), [:20](supabase/functions/_shared/pandadoc.ts#L20). Eight PandaDoc fetches close over them. A template uuid is account-scoped, so key and template must move together. Five Edge Functions import this module. **There is no additive route**: either every exported function gains a mode parameter, or a parallel module is written and the five importers repointed.

**The one genuinely cheap fix in the module**: `generateDeed` re-reads the application at [supabase/functions/_shared/pandadoc.ts:407](supabase/functions/_shared/pandadoc.ts#L407), and all five call sites pass only `(service, appId)`. Adding `mode` to that select list covers every deed generation path with one edited string and **zero call-site changes**.

Two things that will bite:

- `voidDocument` maps 400/404/409 to `{ ok: true, alreadyGone: true }` at [supabase/functions/_shared/pandadoc.ts:368](supabase/functions/_shared/pandadoc.ts#L368). A sandbox document id sent to the live account 404s and **reports success**. All three callers then mark the deed voided in the database while the real document stays live and signable. Silent wrong state, not a crash.
- `createAndSend` sends to `a.tenant_email` directly at [supabase/functions/_shared/pandadoc.ts:104](supabase/functions/_shared/pandadoc.ts#L104), under a comment at [:103](supabase/functions/_shared/pandadoc.ts#L103) that still claims sandbox routes to a review address: "Sandbox: route the tenant recipient to the review address. i have chnaged it redirct to tenat". **A safety was removed deliberately and the comment was left asserting it exists.**

**I could not determine whether a PandaDoc sandbox account suppresses outbound mail.** The send body is `{ silent: false, ... }`. Requirement 5 forbids emailing a real tenant, so this must be verified, not assumed.

`payment-confirmation` duplicates the whole PandaDoc client at [supabase/functions/payment-confirmation/index.ts:27](supabase/functions/payment-confirmation/index.ts#L27) so the public function bundles as a single file. **Fixing `_shared/pandadoc.ts` does not fix this.** Any audit that greps only the shared module misses it.

### Resend: 14 active sends, not 13

Fourteen live, non-commented POSTs to `api.resend.com`. The one people miss lives inside `pandadoc.ts`, not in any `*Email.ts` module: [supabase/functions/_shared/pandadoc.ts:339](supabase/functions/_shared/pandadoc.ts#L339), the signing-link fallback.

**Call sites that have the application id but not the mode.** This is the useful split:

| Contained (deliver fn takes `appId`, so gate inside the module, zero call-site changes) | Not contained (mode must be threaded) |
|---|---|
| `deliverDeedToAgent` [_shared/deedEmail.ts:44](supabase/functions/_shared/deedEmail.ts#L44), covers both [pandadoc-webhook/index.ts:81](supabase/functions/pandadoc-webhook/index.ts#L81) and `send-deed-to-agent` | `sendEmail` [create-referral/email.ts:71](supabase/functions/create-referral/email.ts#L71), takes `{subject, html, to}` only |
| `deliverExecutedDeedToTenant` [_shared/executedDeedEmail.ts:45](supabase/functions/_shared/executedDeedEmail.ts#L45) | `resend-payment-email/email.ts:72`, caller must add mode to its select |
| `deliverPaymentReceipt` [_shared/paymentReceiptEmail.ts:23](supabase/functions/_shared/paymentReceiptEmail.ts#L23) | `remindSignature`, signature is `(documentId, ctx)` with no application at all |
| `deliverRefund` [_shared/refundEmail.ts:22](supabase/functions/_shared/refundEmail.ts#L22) | `verifyWebhook` on both webhooks: mode not available at the point of need |
| `payment-reminders/email.ts:70` and `expiry-reminders/email.ts:63`: fix **upstream in SQL**, the cohort never forms | `voidDocument`, `downloadExecutedPdf`, the signing-session mint: document id only |

`ops-alert` [supabase/functions/ops-alert/index.ts:154](supabase/functions/ops-alert/index.ts#L154) goes to an internal address: label the subject with the mode, do **not** suppress. `invite-user` and `send-password-reset` are user-scoped and need nothing.

### HubSpot

The cheapest fix in the entire proposal. One predicate on [supabase/migrations/20260705150000_hubspot_sync_schema.sql:141](supabase/migrations/20260705150000_hubspot_sync_schema.sql#L141), in a new migration, `create or replace`, same signature, **no Edge Function edit at all**. It makes the whole sync sandbox-blind. Requirement 5 says no sync, not sync-to-a-sandbox, so **HubSpot is the one third party needing no sandbox credential**. Easiest to satisfy, easiest to over-engineer.

Two details:
- `to_jsonb(a.*)` at [:138](supabase/migrations/20260705150000_hubspot_sync_schema.sql#L138) is the only remaining select-star over `applications` in the tree. A new mode column lands in the HubSpot payload automatically, unlike `partner_webhook_payload` and `partner_api_applications`, which name every column.
- Filter in SQL, not in the loop. The cursor advances per event at [supabase/functions/hubspot-sync/index.ts:345](supabase/functions/hubspot-sync/index.ts#L345) and an error breaks at [:354](supabase/functions/hubspot-sync/index.ts#L354). A sandbox event that errors would stall the **live** feed behind it. The wedge concern about `limit` is unfounded: the limit applies after the WHERE, so a filtered page still returns a full page of live rows.

**Asymmetry worth naming**: a superadmin cannot see sandbox rows under requirement 2, but can still press Sync on the Reconciliation screen and push them. Invisibility in the UI is not exclusion from a job.

### Storage

Executed PDFs from both modes land in the same `deeds` bucket at [supabase/functions/pandadoc-webhook/index.ts:54](supabase/functions/pandadoc-webhook/index.ts#L54). Path is `${app.id}/${ref}.pdf` so no collision, but sandbox artefacts accumulate in the production bucket and `deed-download` signs URLs from it with no mode awareness.

---

## 7. What has to be EDITED

**The SQL half of this work is 100 percent additive by file. The TypeScript half is not, and cannot be made so.**

**At least 51 existing files must be edited, plus 8 test fixture files.** Grouped by why the rule cannot hold:

**A. A column list inside an existing query string (7 files).** A new file cannot intercept an existing `.select()`. [src/lib/hydrate.ts:104](src/lib/hydrate.ts#L104), [supabase/functions/_shared/partnerAuth.ts:134](supabase/functions/_shared/partnerAuth.ts#L134), [supabase/functions/_shared/pandadoc.ts:407](supabase/functions/_shared/pandadoc.ts#L407), [supabase/functions/expiry-cohorts/index.ts:120](supabase/functions/expiry-cohorts/index.ts#L120), [supabase/functions/stripe-webhook/index.ts:74](supabase/functions/stripe-webhook/index.ts#L74), [supabase/functions/payment-page/index.ts:67](supabase/functions/payment-page/index.ts#L67), [supabase/functions/payment-confirmation/index.ts:79](supabase/functions/payment-confirmation/index.ts#L79).

**B. A type that every consumer already imports (4 files).** [src/data/applicationsService.ts:41](src/data/applicationsService.ts#L41) `FullApp`, [src/data/types.ts:149](src/data/types.ts#L149) `ApplicationSummary`, [supabase/functions/_shared/partnerAuth.ts:54](supabase/functions/_shared/partnerAuth.ts#L54) `PartnerAuth`, [src/session/SessionContext.tsx:34](src/session/SessionContext.tsx#L34) `SessionValue`. Module augmentation from a new file is technically possible for the first two and would hide the field from anyone reading the interface. Not worth it.

**C. A choke point that must become live-only (4 files).** [src/data/applicationsService.ts:90](src/data/applicationsService.ts#L90), [src/data/paymentMetrics.ts:35](src/data/paymentMetrics.ts#L35), [src/data/exportsService.ts:997](src/data/exportsService.ts#L997), [src/lib/hydrate.ts:187](src/lib/hydrate.ts#L187). **These four are where add-never-edit breaks most usefully**: four edits make the failure direction correct by construction for the whole reporting surface.

**D. Module-level constants captured at import (2 files).** [supabase/functions/_shared/stripeMode.ts:44](supabase/functions/_shared/stripeMode.ts#L44) and [supabase/functions/_shared/pandadoc.ts:18](supabase/functions/_shared/pandadoc.ts#L18). No parameter can reach a value read at import time.

**E. A guard that is the first statement in a handler (2 files).** [supabase/functions/stripe-webhook/index.ts:31](supabase/functions/stripe-webhook/index.ts#L31) and [supabase/functions/pandadoc-webhook/index.ts:22](supabase/functions/pandadoc-webhook/index.ts#L22). Both run before any application is loaded.

**F. A documented decision being reversed (3 files).** [supabase/functions/dev-centre/index.ts:107](supabase/functions/dev-centre/index.ts#L107) with its comment "A key minted in sandbox must never be a live key"; [src/pages/DevCentre/DevCentre.tsx:182](src/pages/DevCentre/DevCentre.tsx#L182); [PARTNER-API.md:353](PARTNER-API.md#L353) plus the generated `partnerDocs.generated.ts` and the allowlist at [scripts/generate-partner-docs.mjs:25](scripts/generate-partner-docs.mjs#L25), where a new sandbox section will **never appear in the Dev Centre until someone adds its heading by hand**. These need explicit sign-off, not a quiet patch. There is no additive way to amend a comment or a spec.

**G. Everything else**: Edge Function call sites, Dev Centre wrappers and pages, badges, memo dependency arrays, the localStorage key registry at [src/data/storage.ts:13](src/data/storage.ts#L13), one line in the barrel at [src/data/index.ts:13](src/data/index.ts#L13).

**Where the rule holds but costs something anyway.** Six SQL functions change signature and therefore need `drop function` before `create` in the same new migration, because PostgREST refuses to disambiguate two satisfiable candidates: `create_referral_api`, `partner_api_applications`, `apply_stripe_payment`, `log_partner_api_request`, and any `dev_*` function gaining `p_mode`. The precedent exists at [supabase/migrations/20260705170500_drop_reconciliation_queue_for_signature_change.sql:36](supabase/migrations/20260705170500_drop_reconciliation_queue_for_signature_change.sql#L36). **The file is new but the statement is destructive**: there is a window during deploy where the partner API create path is down, and each drop forces a matching Edge Function edit.

**One deliberate contradiction to record.** [supabase/migrations/20260810110000_partner_api_requests.sql:18](supabase/migrations/20260810110000_partner_api_requests.sql#L18) and the header of `create_referral_api` at [supabase/migrations/20260810130000_create_referral_api.sql:21](supabase/migrations/20260810130000_create_referral_api.sql#L21) both say an API-created application must be "indistinguishable" from a typed one so nothing downstream can branch on how it arrived. Mode breaks that on purpose. The distinction is real and should be written down: **provenance is how a row arrived and must not change behaviour; mode is whether a row is real and must change behaviour everywhere.** Same column shape, opposite intent. A reviewer who knows those files will otherwise read this proposal as contradicting a documented decision.

**Positive precedent to copy, not extend.** `sync_application_partner` at [supabase/migrations/20260702134239_core_schema.sql:172](supabase/migrations/20260702134239_core_schema.sql#L172) overwrites `partner_id` from the parent row rather than trusting the caller. That is the house pattern for "never from the payload". A trigger cannot see an API key, so mode must be a mandatory RPC argument instead, but the principle is identical and already established here.

---

## 8. What I would cut from v1

Ranked by scope saved per unit of capability lost.

**1. Do not put sandbox applications on `/applications`. Build a sandbox list inside `/dev-centre` as a new page.**
Saves: the route guard edit at [src/App.tsx:78](src/App.tsx#L78), the nav edit at [src/constants/nav.ts:30](src/constants/nav.ts#L30), the Topbar switch edit, `scopedSet` at [src/data/applicationsService.ts:133](src/data/applicationsService.ts#L133), `inScope`, GlobalSearch, `findRecord`, the memo-dependency work, and the whole session-mode plumbing at [src/session/SessionContext.tsx:34](src/session/SessionContext.tsx#L34).
**It also resolves a contradiction the proposal does not currently have an answer to.** There is one hydrated dataset ([src/lib/hydrate.ts:354](src/lib/hydrate.ts#L354)) and every derived service reads it. Requirement 4 says reporting excludes sandbox even for a developer in sandbox mode. One dataset cannot simultaneously be the developer's sandbox view and a sandbox-free reporting base. Keeping the sandbox view on a separate page with its own fetch avoids needing two datasets or a mode filter inside every derived service.
Trade: a developer's sandbox list is a Dev Centre panel, not the real Applications screen, so the sandbox is a slightly different UI from production.

**2. Forbid org creation from a sandbox key.** Sandbox keys must reference existing `branch_id`s.
Saves: mode columns on `agencies`, `branches`, `agent_contacts`, `org_audit`; their RLS; `partner_api_orgs`; the org half of `reconciliation_queue`; the OrgManagement and hydrate org story.
Trade: a partner cannot bootstrap a sandbox from nothing, and must be handed real branch ids to test with. Cheap, and it removes the only path by which sandbox traffic creates human review work.

**3. Cut PandaDoc sandbox from v1.** Sandbox applications stop at `paid`; no deed is generated.
Saves: the entire `_shared/pandadoc.ts` restructure (8 fetch sites, three module constants, five importers), the duplicated client at [supabase/functions/payment-confirmation/index.ts:27](supabase/functions/payment-confirmation/index.ts#L27), dual-key webhook verification, the `voidDocument` 404 ambiguity, the storage-bucket question, and two of the fourteen Resend gates.
Trade: real. The deed is the product and a sandbox that cannot issue one is half a sandbox. **But note `can_send_deed` at [supabase/migrations/20260702134239_core_schema.sql:28](supabase/migrations/20260702134239_core_schema.sql#L28) is a positive allowlist of superadmin and management that already excludes `developer`, so a developer cannot exercise the deed path today anyway.** The capability being deferred does not currently exist for the role that would use it.

**4. Cut mode-scoping from the five Dev Centre monitoring RPCs.** Keep it on keys, endpoints and deliveries only.
Saves: five drop-and-creates plus five client wrappers plus the `partner_api_request_log.mode` column and the `log_partner_api_request` signature change and its caller edit.
Trade: a developer's request charts mix sandbox and live traffic. Annoying, not dangerous.

**5. Cut sandbox cleanup.** Accept that sandbox rows accumulate forever.
Note the consequence explicitly: once the restrictive policy is in place, `applications_delete` at [supabase/migrations/20260702134358_access_rls_rpc.sql:135](supabase/migrations/20260702134358_access_rls_rpc.sql#L135) is ANDed with it, so **not even a superadmin can delete a sandbox row**. Stripe lets you clear test data; nothing here would.

### The irreducible core, if everything above is cut

Eleven things, and I would not ship without any of them:

1. `applications.mode` with `default 'live'` and an immutability trigger.
2. `partner_api_keys.mode` and the `partnerAuth` chain to `create_referral_api`'s mandatory `p_mode`.
3. The restrictive RLS policy on `applications` plus the one on `tenancy_correction_tokens`.
4. Mode gates on the ten browser-reachable definer functions.
5. `hubspot_pending_events`.
6. `enqueue_partner_webhook` plus `partner_webhook_endpoints.mode`.
7. `fire_payment_reminders` and `fire_expiry_reminders`.
8. `partner_api_applications`.
9. `partner_api_requests` idempotency scoping.
10. `apply_stripe_payment` mode check, plus Stripe key selection by application mode.
11. `allFull()`, `scopeFull()`, `buildLiveBordereau`, and the hydrate org aggregation.

### The comparison nobody has made

This tree is currently built around **two Supabase projects**: [supabase/functions/_shared/stripeMode.ts:44](supabase/functions/_shared/stripeMode.ts#L44), [supabase/functions/dev-centre/index.ts:107](supabase/functions/dev-centre/index.ts#L107), [src/data/devCentreService.ts:289](src/data/devCentreService.ts#L289) and [src/pages/DevCentre/DevCentre.tsx:182](src/pages/DevCentre/DevCentre.tsx#L182) each independently encode that assumption, and three of them fail safe **because** of it. Under two projects, sandbox and live cannot leak into each other by construction, and 58 of the 79 surfaces above simply do not exist as problems. The honest statement of the trade is: one project buys a Stripe-style single-URL developer experience and a shared org book, and pays for it with 51 file edits and a permanent obligation that every future report, export and cron carries a mode predicate. That is a real product decision and it should be made deliberately rather than inherited from the shape of this report.

---

## What I am not sure about

- **Whether the PandaDoc sandbox account suppresses outbound mail.** Cannot be answered from this repo. Requirement 5 depends on it.
- **Whether Stripe `evt_` ids are unique across accounts.** [supabase/functions/stripe-webhook/index.ts:49](supabase/functions/stripe-webhook/index.ts#L49) dedupes on id alone and returns 200 on conflict. Low probability, and a swallowed real payment if wrong.
- **Whether `application_id in (select id from public.applications)` reliably inherits the restrictive policy under every plan.** It is standard PostgreSQL behaviour and it is load-bearing for `activity_log` and `app_notes`. Test it in staging rather than trusting the comment.
- **Whether a superadmin may mint a sandbox key they can never observe.** [supabase/functions/dev-centre/index.ts:82](supabase/functions/dev-centre/index.ts#L82) admits both roles today. Requirement 2 does not cover minting. If sandbox keys are hidden from management by requirement 2, then a **leaked sandbox key is revocable by nobody except the developer who may have left**, since `dev_api_keys` at [supabase/migrations/20260810250000_dev_centre_stable_ordering.sql:51](supabase/migrations/20260810250000_dev_centre_stable_ordering.sql#L51) admits management on purpose so a leaked key can be killed by whoever notices. That is a product decision, not an implementation detail.
- **What mode a portal-created referral gets.** [src/data/applicationsService.ts:501](src/data/applicationsService.ts#L501) invokes `create-referral` with no key and no mode. "Mode comes from the key" has no answer for a path with no key. The column default answers it by accident; it should answer it on purpose.
- **The shared `guarantee_ref_seq`.** Not a leak, but sandbox and live draw the same sequence, so live ref numbers develop gaps proportional to sandbox volume and a sandbox ref is visually indistinguishable from a real one. Stripe's answer is a visibly different identifier.
- I did not open `scripts/generate-environment.mjs`, which regenerates [src/config/environment.generated.ts:8](src/config/environment.generated.ts#L8) from `stripeMode.ts`. Restructuring `stripeMode.ts` may break it, and the failure would appear as a stale banner rather than a build error.