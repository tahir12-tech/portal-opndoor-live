# QUEUE

The single source of truth for outstanding work on this branch.

**The rule this file exists for:** every instruction from Matt is written in
here VERBATIM and committed BEFORE work starts on it. Status is updated and
committed when an item finishes. Nothing is marked done without the proof
beside it. Work is resumed from the first item that is not done.

Verbatim means verbatim: the instruction text below is Matt's own words,
punctuation included, not a summary and not tidied. Where I have added
anything it is under a heading that says so.

Statuses: `todo` | `in progress` | `done` | `blocked`.

---

## Order of work

| id | item | status |
| --- | --- | --- |
| Q-01 | The security loop | in progress |
| Q-02 | Supplier rail notifications | todo |
| Q-03 | Notification settings per party | todo |
| Q-04 | Opndoor internal notification routing | todo |
| Q-05 | Fold 11 and the four commission amendments | todo |
| Q-06 | The fold-ins A to H | todo |
| Q-07 | The HubSpot consequences report | todo |
| Q-08 | The end-to-end walk on dev | todo |
| Q-09 | HANDOVER-BALAL.md and the cutover checklist | todo |
| Q-10 | Loose ends from item 4 of the 2026-09-28 mandate | in progress |

Ids were renumbered once, when Q-02 to Q-04 were inserted after the security
loop on Matt's instruction ("in this order, after the current item"). Nothing
outside this file refers to them.

---

## Needs Matt

Things asked for earlier that are NOT recoverable from this repository or from
the session transcript, so they are not in the queue below. I am not guessing
at them.

### NM-1. Folds 12 to 16

The mandate of 2026-09-28 says "The queued list: folds 11 to 16". Fold 11's
scope is recoverable and is queued below as Q-05. **Folds 12, 13, 14, 15 and
16 are named nowhere** in this repository or in the session transcript, and no
document lists them. The numbered fold list came from an admin walk in an
earlier session whose transcript is not on this machine.

The fold-ins A to H (Q-06) came from "the admin walk" and may well BE some of
folds 12 to 16 renumbered. Matt's covering note says "The numbering was lost,
so check each against the code as it stands". If A to H is the whole of what
12 to 16 were, this item closes with them; if there were others, I need them.

**What I need:** either confirmation that A to H replaces folds 12 to 16, or
the text of the ones that are missing.

### NM-2. Fold 17

Named but not specified beyond its subject: "platform as source of truth" -
"what making the platform authoritative does to renamed companies with deals
attached, removed people who own activity, two-to-one mappings, properties
renamed in the Hub, the referencing rail and direct signups, joint tenancies,
sandbox leakage, Regent's sync volume, and a HubSpot outage."

Explicitly gated: "Fold 17 is not built until I have read that report." The
report is Q-04. So this is correctly blocked rather than missing, but the
build instruction itself does not exist yet.

### NM-3. The Help slow half

Recorded in an earlier status as queued after the push, never specified
further: "in-app HTML viewer with Save as PDF, tenant one-pager with agency
fee basis, `public/help-docs` sweep". Not scheduled here because it was
explicitly "after the push".

---

## Q-01. The security loop

**Status: in progress.**

### The instruction, verbatim (2026-09-28)

> Fix every finding in both reviews, all severities, then kill each class so it cannot come back. Report once. Do not checkpoint. Do not push.
>
> 1. Home branch. No user may change their own or anyone's home_branch_id except through an admin-or-permitted RPC with the full reach and level checks; guard it with a column trigger like the other five. And stop any boundary trusting a user-editable column: app_scoped_agencies must derive agency membership from positions, not home_branch_id. Test the self-PATCH repro exactly as written.
>
> 2. No unpositioned management on the house partner, ever. Invite, promotion (referrer to management), level changes and imports must all require a position; enforce it in SQL with a constraint or trigger, not only in the UI. Backfill or refuse any existing row. Then remove every "not app_has_scope() or" and every "else partner_id = app_partner()" fail-open across the people surface, definer functions and policies, replacing each with the app_may_reach_* predicates, failing closed. users_select and user_scopes_select included.
>
> 3. Grants. Every definer function not meant to be called from the browser is service_role only, revoked from public, anon and authenticated explicitly. Add ALTER DEFAULT PRIVILEGES so new functions are not executable by anon or authenticated by default. Add a CI check over pg_proc: any SECURITY DEFINER function executable by anon or authenticated fails the build unless it is on an explicit allowlist, and every allowlisted function must be covered by a test proving its reach check.
>
> 4. A second CI check that fails on the patterns themselves: "not public.app_has_scope() or", a bare "partner_id = public.app_partner()" as an authorisation test, and "revoke ... from public;" without anon.
>
> 5. Everything else in both lists: invite-user's service-role read, partner_agency_relationships, expiry-reminders discriminating on channel and parking with an alert on an empty ladder, attach/detach seniority, users_mgmt_insert and the commission capability on insert, the tenancy-correction replay guard, user_scopes write policy so Remove position works, activity_log visibility in the policy not the screen, the two nested policies given their own agency test, expiry-cohorts test-run ledger, viewer_runs_eligibility_journey, and the full rate-helper list.
>
> 6. Every repro in both reviews becomes a test in the isolation suite, each failing against the current code.
>
> 7. Then spawn a new independent reviewer, again with no sight of the work or of the earlier reviews, and repeat. Keep fixing and re-reviewing with a fresh agent each time until one comes back with no finding above low. Report each round's findings.
>
> Then carry on with the rest of the list as already given. Tell me whether any finding reaches code already on the live system, from the migration dates and production's applied list.

### Where it stands

Items 1 to 6 are **done** and committed as `3438444`, plus round 2's findings.
Item 7 is **in progress**: rounds 1 and 2 are complete and fixed, round 3 is
running.

**Done, with proof:**

| Part | Proof |
| --- | --- |
| 1. Home branch | `20261006310000`. Repro re-run on dev: PATCH refused, reach unchanged at 7 applications / 1 agency. `app_scoped_agencies` derives from positions only. |
| 2. Positions mandatory, fail-opens gone | `20261006300000`, `20261006310000`, `20261006320000`. Catalogue scan: `not app_has_scope() or` = **0**, `app_has_scope ... else true` = **0**. Six negotiators backfilled. |
| 3. Grants | `20261006330000`. anon 35 to **0**; authenticated 193 to 115, all allowlisted. `ALTER DEFAULT PRIVILEGES` for postgres. CI check `supabase/tests/definer_grants.test.sql`. |
| 4. Pattern CI check | `src/data/migrationPatterns.test.ts`, 6 assertions. It caught a real instance in my own `20261006310000` on first run. |
| 5. The rest | `20261006340000`, `20261006350000`, `20261006360000`, plus the edge functions. |
| 6. Repros as tests | `supabase/tests/every_repro_from_both_reviews.test.sql` (29) and `every_browser_rpc_checks_its_reach.test.sql` (38). Each verified to SUCCEED against the pre-sweep definitions restored in a rolled-back transaction. |
| Round 1 review | Findings fixed in `20261006290000` onwards. |
| Round 2 review | 2 highs (`create_referral_target` name-to-uuid oracle; `fire_renewal_notices` ignoring rail, ladder and livemode), 1 high (unescaped email HTML), 4 mediums, 9 lows. All fixed in `20261006350000`, `20261006360000` and the edge functions. |

**Live-system question, answered:** the house partner `opndoor-agents` is
created by `20260904240000`, which is **branch-only**. `origin/main` carries 65
migrations, newest `20260705171000`. So on production today every partner is
still one company and `partner_id = app_partner()` IS a company boundary.
Exactly one finding reaches live code independently of that: **`activity_log_select`
has no visibility filter** (`20260702174141`, on `origin/main`), so rows written
`visibility = 'internal'` are readable by any partner user who can see the
application. Live since 2026-07-02. Everything else becomes reachable only when
this branch ships.

**Remaining:** round 3 and any further rounds until one returns nothing above low.

---

## Q-02. Supplier rail notifications

**Status: todo.**

### The instruction, verbatim (2026-09-28)

> 1. Supplier rail notifications. On the supplier rail (Rightmove via the API, Lettings in a Box inbound, Kestrel on dev), list every email and in-app notification sent today and who receives each, from the code, not the documents. Intended rule: the referrer and the branch's agent contact both receive the executed deed and every per-application notification, subject to item 2's settings; the tenant's own emails are unchanged. Where the referrer is an API partner with no human user attached, the agent contact still receives what item 2 allows. Show the table before and after, with tests for each, failing against the current code where it changes anything.

---

## Q-03. Notification settings per party

**Status: todo.** Q-02 is "item 2" in Q-02's text and in this one; they are one
design and Q-02's "subject to item 2's settings" means this matrix.

### The instruction, verbatim (2026-09-28)

> 2. Notification settings per party. Each supplier and each agency has a matrix: notification types (sent, paid, signed, deed issued, tenancy start correction, renewal notice, lapse, decline) against recipients (referrer, branch agent contact, ticked users), each on or off. Defaults: everything on for agencies; on suppliers, everything on for the referrer and deed issued only for the agent contact. Opndoor admin can edit any party's matrix, on the supplier and agency detail pages; an agency's directors can edit their own agency's, no one else's. Not switchable, and shown as locked with the reason: delivery of the executed deed to its recipient, every email to the tenant, and ops alerts. Enforced in the send path server-side, not by hiding UI, with the change audited. Tests for each default, each toggle, the locked items, and that a director cannot edit another agency's matrix.

---

## Q-04. Opndoor internal notification routing

**Status: todo.**

### The instruction, verbatim (2026-09-28)

> 3. Opndoor internal notification routing. First list every internal email and in-app notification the platform sends to Opndoor today (ops alerts by kind, awaiting decision, reconciliation items, deeds needing a staff send, new applications, payments, refunds, sync failures, security events and any others) and where each goes now, from the code. Then build an admin settings page: each type, grouped (Critical, Operations, Commercial, Information), with its recipients chosen from active Opndoor team members and named shared inboxes, and on or off per recipient. Only superadmin can edit; opndoor_manager can view. Critical types (ops alerts, deed chain failures, security events, sync failures on production) can be rerouted but never left with zero recipients: refused in SQL and shown as locked below one. Enforced in the send path server-side, every change audited. A deactivated team member drops off every route, and any critical type left empty falls back to support@opndoor.co with an alert saying so. Tests for routing, the floor on critical types, deactivation, and that nobody below superadmin can change it.

---
## Q-05. Fold 11 and the four commission amendments

**Status: todo.**

### The instruction, verbatim

Fold 11, as put to Matt and accepted:

> Supplier Manage page becomes the Commission editor (Standard, Flat, Volume tiered only), Partners renamed to Suppliers throughout, plus the four amendments: the three-way paid-by switch, the two-part supplier statement with per-agency schedules, route-scoped volume counters, and two independent counters for an agency on both routes. Touches pricing arithmetic and needs migrations.

And from the mandate of 2026-09-28:

> the four supplier-commission additions (three-way "paid by" switch, the two-part supplier statement, route-scoped volume counters, two independent counters for an agency on both routes)

---

## Q-06. The fold-ins A to H

**Status: todo.** Audit of what is already done is running.

### The instruction, verbatim (2026-09-28)

> Here are the fold-ins from the admin walk, verbatim in substance. The numbering was lost, so check each against the code as it stands: build whatever is missing or partial, and in your report say which were already done. Where two conflict, the later one listed here wins.
>
> A. Supplier detail page mirrors the agency page: tabs Overview (the supplier's agencies and branches with agent contacts and deed recipients, capabilities and referencing mode), People (their staff with the same row actions, levels Management and Referrer plus Developer), Commission (the supplier commission editor from fold 11 and the supplier's statement), Referrals, and Integration (API access, keys summary, Dev Centre link). The Manage form's fields live on the tabs they belong to; Manage as a separate page goes. Regent's agency page is the template.
>
> B. Under View as, Reporting shows exactly what that party's management sees: no bordereau, no Opndoor settlements, "Your commission" reads as the party's own statement. Settlements and the bordereau export render as cards matching the rest of Reporting, admin only, and appear when not viewing as anyone.
>
> C. Admin Reporting scope: replace the "All partners" dropdown with a searchable picker (type to find any supplier, agency or group), with Everything, Suppliers, Agencies and Direct as quick choices at the top and recent selections remembered. Every tile, chart, export and statement on the page follows the selection. Same control for the Origin filter on Applications.
>
> D. Joint tenancy grouping on Applications, admin and agency lists: header is the property address with a small "Joint tenancy" tag and, right-aligned, "2 of 2 paid · 1 of 2 deeds". Drop "one tenancy, a deed each", drop the LEAD badge everywhere, drop "Tenant 1 of 2". Sibling rows: name and reference, share, status, date, and the property address in muted text rather than a dash (this supersedes the earlier instruction not to repeat it).
>
> E. Commission statement (screen, PDF, CSV): drop the Branch column when the payee's scope holds one branch, drop the Source column when every row has the same source, same rule for the Agency column on group statements. One place for the rule (viewerShape()).
>
> F. Exports and statement:
> 1. Monthly trend prints pence like everything else (Sep showed £4,431.00 against £4,430.77 elsewhere); assert every money figure in an export comes from one formatter.
> 2. Application export: drop Lead tenant; Agency and Branch columns only where the scope holds more than one; Commission payees column only where there is more than one payee.
> 3. Statement: reference becomes STMT-YYYY-MM-NNNN, sequential per payee per month, stable across renames (no name slug). Header block is Payee, Period, Statement reference, Generated, Basis only; drop Payee level and Currency. No blended rate in the total row. One "Commission statement" heading, not two.
>
> G. Three agency levels (check, likely done): Director sees everything including commission; Manager sees every referral, branch and the team with no commission figures by any route; Negotiator sees own referrals only. Same three names on admin screens.
>
> H. Admin New application, "Referred by" section at the top of the form, above Tenant, replacing the Agency and branch section at the bottom. First field is Supplier or Agency, required, no default.
> Supplier: pick the supplier (real suppliers only, never a house partner), then Agency and Branch search only that supplier's agencies and branches; changing the supplier clears both. The application goes on the supplier rail: Supplier referral route, single tenant (no Add another tenant), fee one month's rent, supplier commission. Adding an agency or branch on the fly attaches it to that supplier through the normal dedup path.
> Agency: Agency search across all agencies, and the application goes on the agent rail with the Agency referral route and agency commission, even where that agency was introduced by a supplier. Add another tenant appears once the agency is chosen.
> Tenant, Property and Tenancy stay disabled until Referred by is complete. The server checks the branch belongs to the chosen supplier and refuses otherwise. Admin view only.
>
> Add these to docs/PROGRESS.md as the remaining queue, in this order after the security loop: fold 11 and the four commission amendments, then A to H, then the HubSpot consequences report, then the walk and handover. Carry on.

### Note on the file name

Matt asked for `docs/PROGRESS.md`; the later instruction asked for
`docs/QUEUE.md` as the single source of truth and said to fold PROGRESS.md
into it rather than keep two files. PROGRESS.md was never created, so there was
nothing to fold. This file is it.

### Per-item status

| Item | Status | Notes |
| --- | --- | --- |
| A. Supplier detail page | todo | |
| B. Reporting under View as | todo | |
| C. Searchable scope picker | todo | |
| D. Joint tenancy grouping | todo | |
| E. Statement column elision | todo | |
| F1. One money formatter | todo | |
| F2. Application export columns | todo | |
| F3. Statement reference and header | todo | `commission_statement_ref` already mints `STMT-YYYY-MM-NNNN` sequentially per payee per month (`20261005190000`, reach-gated in `20261006350000`). The UI/PDF side is unverified. |
| G. Three agency levels | todo | "check, likely done" |
| H. Referred by section | todo | Supersedes the earlier "admin New application Referred by section as specified", which had no recoverable spec. This IS the spec. |

---

## Q-07. The HubSpot consequences report

**Status: todo. Gates NM-2 (fold 17).**

### The instruction, verbatim

> the HubSpot consequences report, which comes back to me before fold 17 is built.

and, from the option Matt accepted:

> what making the platform authoritative does to renamed companies with deals attached, removed people who own activity, two-to-one mappings, properties renamed in the Hub, the referencing rail and direct signups, joint tenancies, sandbox leakage, Regent's sync volume, and a HubSpot outage. No code, so it cannot affect tonight's push, and it may change what you want built.

---

## Q-08. The end-to-end walk on dev

**Status: todo.**

### The instruction, verbatim

> 6. Walk it end to end on dev, one real application per rail: agency referral (single and joint), supplier referral via Kestrel, direct. Each to executed deed, checking every email and who received it.

---

## Q-09. HANDOVER-BALAL.md and the cutover checklist

**Status: todo.**

### The instruction, verbatim

> 7. HANDOVER-BALAL.md and the cutover checklist: every migration on the branch in apply order, all applied together after the clone rehearsal, never split; counts matching the branch at the end; HubSpot token set on production with hubspot-sync showing successes on Health after deploy; every dashboard-only setting listed.

---

## Q-10. Loose ends from item 4 of the 2026-09-28 mandate

**Status: in progress.**

### The instruction, verbatim

> 4. Finish item 1's loose ends: the Team-side tickbox with vitest coverage of the UI. Bring Climber of the week back, ranked within the reader's own agency and scope rather than withdrawn.

### Where it stands

- **Climber of the week: done, not yet committed.** `20261006370000` adds
  `agency_weekly_climber(p_user, ...)`, which partitions by the READER rather
  than by the partner, so a group director sees the best riser across the
  agencies they hold and a branch manager sees theirs. `weekly-digest` asks it
  per reader and renders no line when there is no riser. Needs a test before it
  is marked done.
- **Team-side tickbox: in progress.** The tickbox exists on the agency side
  (`AgencyHome.tsx`, column plus `NOTIFY_LABEL` / `NOTIFY_NOTE` shared in
  `positionsService.ts`). Team.tsx renders people as `tm-person` cards rather
  than a table and has no tickbox yet. Vitest coverage of the UI not written.

---

## Standing constraints

These are not queue items. They apply to everything above and have been stated
more than once.

- The live Supabase project `xogpsaoyprgmxdkmcype` is **never** touched, read or
  written. Dev is `nfufwcpgrhfgwtphegca`.
- `origin` is a third-party live repo. **Matt pushes. I only commit.**
- Commit each step by path. Never `git add -A`.
- Keep the dev server on 5174 running.
- Typecheck is `npm run typecheck`. Tests are `npm test`. Never bare `tsc`.
- Never report a bare test total: report added, removed and renamed separately.
- No em dashes in product copy.
- Deno is not installed on this machine, so `deno test` and `deno check` cannot
  run. Edge functions are syntax-checked with
  `./node_modules/.bin/esbuild --loader=ts < file`.
- Migrations before functions.
