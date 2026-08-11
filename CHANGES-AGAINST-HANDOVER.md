# Changes against `main`

What is on the `partner-api` branch that is not on `main`, and what reviewing it
actually involves. Written so you do not have to run git to understand the shape.

Nothing here has been pushed.

---

## The headline numbers

```
git diff main..partner-api --stat
175 files changed, 27704 insertions(+), 3505 deletions(-)
90 commits
```

**That 27,704 overstates the review considerably**, and the first job of this
document is to say by how much.

| | Files | Lines |
| --- | ---: | ---: |
| New | 84 | 20,544 added |
| Edited | 91 | 7,160 added / 3,505 removed |
| Deleted | 0 | |

**Ignoring whitespace, it is 165 files, 25,150 insertions and 951 deletions.**
The gap is line endings, and it matters:

```
git diff main..partner-api -w --ignore-blank-lines --shortstat
165 files changed, 25150 insertions(+), 951 deletions(-)
```

### Ten files whose entire diff is line endings

**3,024 lines of pure noise.** These files have no content change at all. They
were rewritten CRLF to LF when this copy was zipped from Windows, which is the
same cause as the `node_modules` platform problem in defect 11.

| Lines | File |
| ---: | --- |
| 738 | `src/pages/League/League.tsx` |
| 610 | `src/pages/Applications/Applications.tsx` |
| 564 | `src/pages/Login/Login.tsx` |
| 484 | `src/pages/ForgotPassword/ForgotPassword.tsx` |
| 286 | `src/data/addressService.ts` |
| 118 | `src/components/ui/Select.tsx` |
| 104 | `src/data/exports.test.ts` |
| 84 | `src/pages/ForgotPassword/ForgotPassword.css` |
| 20 | `src/pages/ApplicationDetail/deedStatus.ts` |
| 16 | `vercel.json` |

**Review these with `-w` or skip them.** `git diff -w main..partner-api -- src/pages/League/League.tsx`
returns nothing, which is the fastest way to prove it to yourself.

Two more are mostly noise: `ApplicationDetail.css` shows 583+/568- but only
**15 real added lines**, and `OrgManagement.css` shows 474+/460- for **14**.

### Where the real work is

| Area | New files | New lines | Edited | Churn |
| --- | ---: | ---: | ---: | ---: |
| Migrations (SQL) | 49 | 7,072 | 0 | 0 |
| Documentation | 5 | 3,762 | 7 | 2,781 |
| Client (React/TS) | 15 | 3,431 | 45 | 6,035 |
| Edge Functions (Deno/TS) | 11 | 3,007 | 25 | 1,270 |
| Build + generated | 3 | 1,779 | 0 | 0 |
| Config | 1 | 1,493 | 4 | 377 |
| Tests | 0 | 0 | 10 | 202 |

Two of those rows are not review surface. **Build + generated** is
`public/openapi.json` and `partnerDocs.generated.ts`, both produced by
`scripts/generate-partner-docs.mjs` and committed so drift shows in a diff; read
the generator, not the output. **Config** is almost entirely `package-lock.json`,
whose change is analysed in defect 11.

**Documentation is 6,543 lines**, about a quarter of the whole diff. It is meant
to be read, but it is not code review.

---

## Edited files, and why

Grouped by why they changed. Files whose diff is only line endings are excluded.

### Defect fixes on live code

| File | What changed |
| --- | --- |
| `_shared/pandadoc.ts` | Credentials became per-application; the deed recipient now goes through the redirect helper; HMAC comparison is constant-time |
| `_shared/deedEmail.ts`, `executedDeedEmail.ts`, `paymentReceiptEmail.ts`, `refundEmail.ts` | Recipients resolved by the shared helper; dead commented-out implementations deleted; headers corrected |
| `create-referral/email.ts`, `expiry-reminders/email.ts`, `payment-reminders/email.ts`, `resend-payment-email/email.ts`, `send-password-reset/email.ts`, `invite-user/email.ts` | Same. Six modules, one rule |
| `create-referral/index.ts` | Stripe key per application; Checkout session expires in 30 minutes; the false "redirected" activity row is gated on a redirect having happened |
| `payment-confirmation/index.ts` | `paid` no longer means "any status but sent", so a withdrawn or expired application stops reporting as paid |
| `stripe-webhook/index.ts` | Mode derived from which signing secret verifies; the missing `else` on a failed deed void; per-mode credentials |
| `pandadoc-webhook/index.ts` | Same mode derivation for the PandaDoc HMAC, with a cross-check against the application |
| `payment-page/index.ts` | Key chosen by the application rather than the project, which also moved the mode guard out of the checkout branch; session expiry |
| `expiry-cohorts/index.ts` | Redirect helper on the CSV email; live-only filter on its direct `applications` read |
| `weekly-digest/index.ts` | Redirect helper; `redirected` is no longer a hardcoded `false`, so its banner can render |
| `hubspot-sync/index.ts` | Refuses sandbox rows; new `verify_map` action for defect 17 |
| `_shared/stripeMode.ts` | `isNonProductionProject()` exported so credential resolution can compose with it |
| `src/data/paymentService.ts` | `stripeTestMode()` was inverted; replaced by `stripeMode()` returning three states |
| `src/components/ui/Toast.tsx`, `Toast.css` | Optional tone, so an error can render as one |
| 10 client pages | 35 error-path `toast()` calls now pass `'error'` |
| `src/pages/ApplicationDetail/ApplicationDetail.tsx` | Payment-anomaly banner; the mode badge; lapse wording |
| `src/pages/OrgManagement/OrgManagement.tsx` | Counts and names branches that cannot issue a deed |
| `src/data/applications-filters.test.ts` | Fixture corrected; the assertion is untouched |
| `package.json` | `test` script added |

### Partner API, sandbox and the developer role

| File | What changed |
| --- | --- |
| `src/lib/hydrate.ts` | Stops selecting the commission columns, which are no longer in the table grant; merges them from an RPC for entitled roles; carries the new partner fields |
| `src/data/types.ts` | `ReferencingMode`, the capability flags, `REFERENCING_MODES` |
| `src/data/partnersService.ts` | `addPartner` calls a real RPC instead of writing to localStorage |
| `src/pages/PartnerManagement/PartnerManagement.tsx` | Referencing mode and capabilities, with the active-key count in the confirmation |
| `src/pages/UserManagement/UserManagement.tsx` | The developer role card, rewritten twice as the role widened |
| `src/App.tsx`, `src/constants/nav.ts`, `src/components/layout/Sidebar.tsx` | Developer reaches four read routes; Dev Centre gated on the partner capability |
| `src/session/SessionContext.tsx` | Unrecognised role falls to least-privileged, not superadmin |
| `src/components/ui/Button.tsx` | `download` on the anchor variant, for the OpenAPI file |
| `src/data/usersService.ts`, `src/data/mock/*` | Real partner names replaced with invented ones |
| `src/data/exportsService.ts`, `analyticsService.ts`, `paymentMetrics.ts`, `leagueService.ts`, `applicationsService.ts` | Negative role tests converted to positive allowlists |

### Documentation

`HANDOVER.md` (+1,047), `DEFECTS.md` (+1,591), `REGRESSION.md`, `PARTNER-API.md`,
`HANDOVER-MACHINE.md`, `HUBSPOT-SYNC-SPEC.md`, `VERIFICATION-SCRIPT.md`,
`supabase/DEEDS-TESTING.md`, `supabase/PAYMENTS-TESTING.md`.

The three runbooks changed for one reason: they told the reader emails were
redirected when they were not.

---

## New migrations, in order

49 of them. Grouped by what they were for.

**Making the schema rebuildable (defect 5)**
```
20260703153500  enable_pg_cron_pg_net
20260705170500  drop_reconciliation_queue_for_signature_change
```

**Shared validation, then the partner API**
```
20260807120000  extract_referral_validation
20260807130000  partner_api_keys
20260807140000  partner_api_orgs
20260810100000  partner_referencing_mode
20260810110000  partner_api_requests
20260810120000  referral_field_errors
20260810130000  create_referral_api
20260810140000  create_referral_target_api          (later dropped)
20260810150000  partner_webhook_schema
20260810160000  partner_webhook_enqueue
20260810170000  partner_webhook_claim
20260810180000  admin_update_user_name
20260810190000  partner_webhook_reinstated_event
20260810200000  partner_api_applications
```

**The developer role and the Dev Centre**
```
20260810210000  developer_role_and_fail_open_guards
20260810220000  dev_centre_rpcs
20260810230000  partner_api_request_log
20260810240000  dev_reveal_webhook_secret
20260810250000  dev_centre_stable_ordering
```

**Sandbox (`livemode`)**
```
20260810260000  livemode_foundation
20260810270000  livemode_definer_predicates
20260810280000  livemode_create_path_and_webhooks
20260810290000  livemode_partner_api_orgs
20260810300000  livemode_idempotency_ledger
20260810310000  dev_centre_sandbox
20260810320000  dev_centre_livemode_columns
```

**Dev Centre depth**
```
20260810330000  request_log_bodies
20260810340000  webhook_replay
20260810350000  fix_deliveries_column_names          (fixes a contract break in the one above)
20260810360000  dev_centre_fixes
```

**Partner configuration. The first turns the API on.**
```
20260811090000  rightmove_referencing_mode           <- watch its output on production
20260811100000  partner_capabilities_and_mode_snapshot
20260811110000  create_partner_and_settings
```

**Rate limits and organisations**
```
20260811120000  rate_limit_headers
20260811130000  org_resolution_by_name
20260811140000  rate_limit_peek
```

**Role model**
```
20260811150000  dev_live_application_metadata
20260811160000  admin_loses_credential_access
20260811170000  security_events_and_break_glass
20260811180000  revoke_commission_columns            <- changes a table GRANT
20260811190000  developer_reads_partner_data
```

**Defect fixes**
```
20260811200000  refuse_deed_execution_when_refunded  (9)
20260811210000  ops_functions_read_base_url          (2)
20260811220000  contacts_promote_on_demote           (6)
20260811230000  reinstate_clears_stale_markers       (10)
20260811240000  backfill_reinstated_markers          (10, edits historical rows)
20260811250000  lapse_message_says_fifteen           (15)
```

---

## How big a review this is

**Honestly: two to three days for someone cold, and about a day if you only
review what can hurt you.**

The 27,704 figure is not the number. Take off 3,024 lines of line endings, 6,543
of documentation, 1,779 of generated output and 1,493 of lockfile, and the code
to review is **roughly 14,000 lines, of which half is SQL**.

### Deserves real attention

**The migrations that change access, four of them.** These are where a mistake is
a data exposure rather than a bug.
`20260810260000_livemode_foundation` (the restrictive policy),
`20260810270000_livemode_definer_predicates` (nine reporting functions, each
reproduced with one predicate spliced in),
`20260811180000_revoke_commission_columns` (changes a table GRANT and has a
maintenance consequence for every future column),
`20260811190000_developer_reads_partner_data` (six policies).

**`_shared/emailRecipients.ts` and its thirteen callers.** Small, but it decides
whether real tenants get emailed. Check one caller closely and the rest by
pattern.

**`_shared/partnerAuth.ts`.** Timing-safe comparison, the livemode cross-check,
the capability gate. Security-critical and short.

**`stripe-webhook/index.ts` and `pandadoc-webhook/index.ts`.** Mode derived from
which secret verifies, plus the cross-check. Money and legal documents.

**`20260811240000_backfill_reinstated_markers`.** The only migration that edits
historical rows. Read it before running it; its header has the sizing query.

### Read once, or skim

The Dev Centre client (`src/pages/DevCentre/`, ~3,000 lines of new React) is the
largest single block and the least dangerous: it renders data from RPCs that
scope themselves, and the tab is not a security boundary. The generated files are
outputs. The tests changed only where fixtures needed renaming. The CSS is
padding and colour.

### Skip

The ten line-ending files. `package-lock.json` beyond the summary in defect 11.

---

## Would any of it be hard to review without the documents?

**Yes, three things, and this is worth being straight about rather than
defensive.**

**1. The livemode work does not read as complete from the diff alone.** The
guarantee is "no role except a developer sees a sandbox row", and it is carried
by three unrelated mechanisms: a restrictive RLS policy, a trigger, and explicit
predicates in nine definer functions. Reviewing any one of them tells you almost
nothing, because the reason the other two exist is that **RLS does not protect
definer functions and no table sets FORCE ROW LEVEL SECURITY**. That fact is in
`HANDOVER.md` §11.2 and in the migration headers, and without it the predicates
look like belt-and-braces rather than the actual enforcement.

`public.livemode_audit()` is the short version: run it, and an empty result is
the passing state.

**2. Several functions are reproduced in full to change one line.** The diff
shows a 2,900-character function as entirely new when one predicate moved. This
is deliberate: PostgreSQL will not let you patch a function body, and rewriting
one from memory rather than from source is how a behaviour change ships inside a
security fix. `git diff -w` does not help here. The migration headers say which
line changed; trust them and check that line.

**3. The reversed decisions.** Org creation by name was built and then removed;
sandbox was scoped as two projects and built as one. The diff shows both the
building and the removing, and read in isolation the intermediate commits look
like work that was undone for no reason. `PARTNER-API.md` carries SUPERSEDED
banners at each affected section, and `HANDOVER.md` §14 explains what removing
org creation nearly broke in sandbox.

**Everything else stands on its own.** The defect fixes are individually small
and each commit message states the failure it closes. If you want to review only
one thing, review the four access migrations above; if you want to review
nothing, run `REGRESSION.md` section D, which asserts each fix from the outside.

### One thing the documents cannot help with

**The Rightmove migration cannot be verified from a diff.** It matches on slug
and name because this repository has never known Rightmove's id, so whether it
works is a property of your production data, not of the code. Read its output
when you push. `START-HERE.md` leads with it for that reason.
