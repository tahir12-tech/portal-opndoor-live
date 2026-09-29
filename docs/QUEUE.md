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

## How I am working (standing instruction, 2026-09-29, verbatim)

> From now until the queue is empty, work without stopping for me. For every decision: if QUEUE.md or an earlier ruling answers it, apply it. If not, make the choice most consistent with the five rules and my earlier rulings, write it under "Decisions taken without Matt" at the top of QUEUE.md with one line of reasoning, and carry on. Only stop for something irreversible outside dev: pushing, touching production, deleting data that isn't test data, or spending money. Never mark an item done without a test that failed first. If the session is running out, commit, update QUEUE.md with exactly where you are, and end with "Resume: read docs/QUEUE.md". Work through the whole queue in order.

---

## How security work ends (standing instruction, 2026-09-29, verbatim)

This REPLACES "repeat fresh reviewer rounds until nothing above low".

> Change to how security work ends, replacing "repeat until nothing above low":
>
> 1. Finish round 7: fix its critical and high findings, each with a failing test first. Then the review loop ends. No more rounds.
>
> 2. From here the definition of secure is the test suite, not reviewer opinion: the isolation suite, the functional guard suite, the definer grants check, the pattern checks and the drift check. Every future security fix must add or extend one of these, and every fix runs the full suite before it's committed, so a fix cannot break something elsewhere silently.
>
> 3. Mediums and lows from round 7 go into QUEUE.md under "Security backlog", ranked. They do not block the queue. Fix any that are cheap and self-contained as you pass them; leave the rest listed.
>
> 4. Move to the queue from Q-02 and build it through to the end.
>
> 5. After the queue is done, run exactly one final review round: fresh reviewers, the five rules, the whole codebase. Fix its criticals and highs only, with tests. Anything below that goes to the security backlog. Then the walk and the handover.
>
> 6. Never start another review round unless I ask for one.
>
> Record this in QUEUE.md and CLAUDE.md so it survives a new session, and carry on.

### The five suites that now define "secure"

Named here so "extend one of these" is unambiguous:

| | what it is |
| --- | --- |
| the isolation suite | `supabase/tests/tenant_isolation.test.sql`, `every_repro_from_both_reviews.test.sql`, `every_browser_rpc_checks_its_reach.test.sql`, and the per-round files (`what_the_*_reviewer_found`, `what_the_sixth_round_found`, `a_null_guard_refuses`, `one_rail_excluded_not_one_rail_included`) |
| the functional guard suite | `supabase/tests/the_work_still_works.test.sql` -- every user-facing action a security migration touches, run as the role that should be allowed, asserting it SUCCEEDS |
| the definer grants check | `supabase/tests/definer_grants.test.sql` + `src/data/definerAllowlistCoverage.test.ts` |
| the pattern checks | `src/data/migrationPatterns.test.ts`, `guardsAreNullSafe.test.ts`, `testsRunAsTheirRole.test.ts`, `credentialsAreNotAcceptedFromCallers.test.ts`, `sandboxDoesNotEmailRealPeople.test.ts`, `everyInviteSaysTheLevel.test.ts` |
| the drift check | `npm run drift` -- final state computed from the migration FILES, diffed against dev |

**Run before every commit from here:** `npm run typecheck`, `npm test`,
`npm run drift`, and the pgTAP suite.

---

## The five rules (my restatement, not Matt's words)

Matt's standing instruction says to decide by "the five rules and my earlier
rulings". They have been used as the frame for every reviewer round this
session and were nowhere in this repository, which is its own small version of
the problem this file exists for. Written down here so a fresh reviewer, or
whoever picks this up, is judging against the same five. **This is my wording,
not Matt's**, and it is a restatement of how they have actually been applied,
so correct it if it has drifted.

1. **An agency referral reaches the people whose POSITION covers it.** Not the
   partner, not the home branch, not a setting somebody ticked: the position
   they already hold. The referrer is always one of them. "Receives
   notifications" adds a person within their existing position; it is never a
   subscription to the estate.

2. **On the supplier and direct rails the partner IS the company.** There
   `partner_id` is a real boundary and there is one contact, not a list. On the
   agency rail every agency shares the house partner `opndoor-agents`, so the
   same column is a route and not a boundary. The same predicate means
   different things on different rails, which is where most of this session's
   findings came from.

3. **Commercial terms are Director-level.** Rates, bands, statements, what an
   agency earns. Director and Manager are one role separated by
   `sees_commission`, so anything that states money tests the capability and
   not the role.

4. **A digest is built per reader.** Anything sent to a person contains what
   THAT person may see, resolved for them, rather than one query's rows fanned
   out to a list.

5. **Direct-rail business is never the matched agency's business.** The
   auto-matcher points a direct application at a branch so somebody can service
   it; that does not make it theirs on any agency-facing surface -- not
   digests, not cohort CSVs, not volume, not the league.

---

## Decisions taken without Matt

Each is the reading most consistent with the five rules and the rulings
already given. Any of them can be reversed by saying so.

| # | Decision | Reasoning |
| --- | --- | --- |
| D1 | `deed_delivery_target` returns one row PER RECIPIENT on the agency rail and one row on the other two. | The rule names a list on the agency rail and a single contact on the others. Making the resolver plural everywhere would invent a list for rails that have one contact. |
| D2 | The deed is ONE email with every recipient on it, not one email each. | Matt's words: "as one send with each as a recipient". It also lets the people on it see who else holds the deed. |
| D3 | `auto_send` and `verified` are repeated unchanged on every row rather than made per-recipient. | Both answer questions about the application (may this send automatically, did the tenant verify the address), not about a person. |
| D4 | A one-off override address on the manual send suppresses the copies. | An override is "send this to this person"; fanning it out to the ladder as well would be a second, unasked-for send. The resolved ladder is still reported to the screen as `resolved_contact`. |
| D5 | All 205 raising `if not` guards are coalesce-wrapped, not only the ones that can go NULL today. | Wrapping only the exposed ones needs a judgement per guard, silently reopens when a NOT NULL is dropped, and makes the CI rule need an allowlist. Wrapping all of them makes it checkable with none. |
| D6 | The deny-IF polarity (`if X then raise`) is counted, not wrapped. | Turning NULL into a raise there breaks legitimate paths (`if p_user = auth.uid()` must not fire for a service-role caller). All 54 were audited by hand instead, and the count is asserted so a new one forces a look. |
| D9 | An agency's matrix has the classes `referrer` and `ticked_users`; a supplier's has `referrer` and `agent_contact`. "Everything on for agencies" means every cell an agency HAS. | The deed rule settled two instructions earlier says the deed goes to the ticked user in scope "and not to the branch mailbox", and that is asserted. Defaulting a branch-mailbox class ON for agencies would contradict it. |
| D10 | The locked cell is deed_issued to the rail's PRIMARY recipient (referrer on the agency rail, agent contact on the supplier rail); copies to the other class stay switchable. | Matt's words are "the executed deed to its recipient", singular. Locking every class would make the matrix pointless for the one event it most matters for. |
| D11 | A supplier's own people cannot edit their matrix; it stays with Opndoor. | Matt granted editing to "an agency's directors" for their own agency. The supplier rail has no Director level to hold that decision, so there is nobody the permission could be given to. |
| D12 | The matrix carries a ninth type, `approved`, which Q-03's list of eight omits. | `notifyReferrer` sends submitted, approved, declined and paid; `decline` is in the list and its opposite is not. Mapping `approved` onto `signed` would mean turning off "deed signed" silently also turned off "approved" -- a switch governing something it is not named after. |
| D13 | The deed's matrix filter goes inside `deed_delivery_target`, not in the three callers. | It is the one resolver every deed send asks. A rule applied in the caller is a rule the other caller forgets, and there are three. |
| D8 | The first person invited when an org is created is its DIRECTOR, at whatever node, and the "Agency manager" option is relabelled "Agency director". | Granting a level requires holding it, so an agency whose only person is a Manager cannot see what it earns and cannot promote anyone to it. It arrives unable to staff itself. |
| D7 | `schema-final-state.mjs` now expands `do $$ ... execute $ddl$ ... $ddl$` blocks. | One function (`partner_api_key_rail_guard`) was created that way, so it was in dev's catalogue and absent from the model: both the drift check and the new lint skipped it in silence. A check with a blind spot reads exactly like a check that passes. |

---

## Where I am (2026-09-29)

**Q-01, the security loop, is at round 6 fixed / round 7 not yet run.** Rounds
1-5 are closed. Round 6 ran four fresh reviewers and produced SEVEN highs, all
fixed and tested; twelve mediums and a batch of lows are listed under "Round
6's findings" and are NOT fixed. The mandate says "until nothing above low", so
the loop is not finished: round 7 should run after those mediums, because a
round launched over a known list mostly re-finds it.

Two of round 6's highs were in work committed the same day, which is the
argument for the rounds continuing.

**Q-02 and Q-03 are DONE.** The inventory (`docs/NOTIFICATIONS.md`), the SQL
layer, the send-path wiring and the matrix UI, each with tests that failed
first. The UI is one component on both parties: the agency People tab (beside
the "Receives notifications" tick, because the tick says which PEOPLE and the
matrix says which EVENTS) and the supplier detail page.

**Q-04 onwards** is untouched.

Next action, in order: round 7's criticals and highs when it reports (it is
the last round of the loop), then Q-04 onward.

---

## Order of work

| id | item | status |
| --- | --- | --- |
| Q-01 | The security loop | in progress |
| Q-01b | The deed goes to the referrer AND every ticked user in scope | **done** |
| Q-02 | Supplier rail notifications | **done** |
| Q-03 | Notification settings per party | **done** |
| Q-04 | Opndoor internal notification routing | todo |
| Q-05 | Fold 11 and the four commission amendments | todo |
| Q-06 | The fold-ins A to H | in progress (D and E done) |
| Q-07 | The HubSpot consequences report | todo |
| Q-08 | The end-to-end walk on dev | todo |
| Q-09 | HANDOVER-BALAL.md and the cutover checklist | todo |
| Q-10 | Loose ends from item 4 of the 2026-09-28 mandate | in progress |

Ids were renumbered once, when Q-02 to Q-04 were inserted after the security
loop on Matt's instruction ("in this order, after the current item"). Nothing
outside this file refers to them.

---

## Security backlog

Not blocking. Per the standing instruction of 2026-09-29, mediums and lows do
not hold up the queue: they are listed here, ranked, and fixed when cheap and
self-contained or when somebody is passing anyway. Round 7's mediums and lows
join this list when it reports.

Ranked by what it would actually cost us if exploited or noticed, not by how
easy it is to fix.

| # | finding | where | why it is not blocking |
| --- | --- | --- | --- |
| B1 | Direct-rail rows are counted into agency and branch counters, and a group page's "What they earned" lists every payee on the whole rail. Rule 5 and rule 3. | `src/lib/hydrate.ts:281-284,312-315,327-329`; `src/pages/Agencies/AgencyHome.tsx:1251-1256`; `src/components/CommissionStatement.tsx:153` | Opndoor-facing only: `applications_select` pins the partner, so no agency sees it. Mis-attribution in our own numbers, not a customer leak. |
| B2 | Direct applications become an invented agency payee in the agent settlement, named after the matched agency. | `src/data/commissionSplit.ts:95-99`; `src/data/liveAnalytics.ts:790,832-837` | Superadmin surface. Produces a £0.00 line and an inflated payee count; the statement panel already filters it, the settlement block does not. |
| B3 | `set_receives_notifications` can never be used on a supplier colleague: its scope test requires the TARGET to hold a position, and positions are mandatory only on the house partner. | `user_within_caller_scope` | A lock, not a hole, and only on the supplier rail. Becomes live work when Q-03's matrix ships to suppliers. |
| B4 | Unescaped ILIKE in the partner-API referrer lookup gives a cross-partner existence oracle for staff email addresses. | `supabase/functions/_shared/partnerApplications.ts:76,87` | Needs an API key, creates nothing, and leaks only whether an address is known. Escape the pattern and use a bounded select. |
| B5 | `.neq("partner_id", …)` never matches NULL, so the cross-partner referrer guard is blind to every superadmin and opndoor_manager. | `_shared/partnerApplications.ts:86` | Backstopped today by the `public.users` primary key; becomes real if that path ever upserts. |
| B6 | `send-password-reset` falls back to the caller-supplied origin when `APP_URL` is unset, contradicting its own comment. | `supabase/functions/send-password-reset/index.ts:52` | GoTrue's redirect allowlist is the remaining gate. `tenant-auth` has the correct `safeOrigin` pattern to copy. |
| B7 | `commission_statement_refs` has no `may_see_commission()` restrictive policy, unlike `pricing_agreements` and its three children. | policy set on that table | Own agency only, so rule 3 rather than a company boundary. |
| B8 | `partner_agency_relationships` has no `require_aal2` restrictive policy. | policy set on that table | Reads at aal1 what it would read at aal2; no cross-company exposure found. |
| B9 | `detach_user_from_agency` requires no group/agency-kind position, unlike `attach_user_to_agency`. | that function | A branch-only manager can detach. Asymmetry with its own sibling. |
| B10 | `set_branch_deed_recipient` uses `users.partner_id = branches.partner_id` as "a user in this organisation", which on the agency rail is every agency. | `20261006310000:1041` | The table is vestigial: nothing live consumes it. Latent rule-2 violation that goes live the moment something does. |
| B11 | Cross-company working copies (`grp_org_v3`, `grp_partners_v2`) persist to localStorage and are not cleared at sign-out. | `src/data/orgService.ts:19`; `src/data/partnersService.ts:21`; `src/session/SessionContext.tsx:280-301` | Data at rest on a shared browser, never rendered (hydrate replaces it before paint). |
| B12 | `definerAllowlistCoverage` counts a function as covered if its NAME appears in any pgTAP file; it does not require the test to assert a refusal. | `src/data/definerAllowlistCoverage.test.ts` | A weakness in a check, not in the product -- but it is how round 6's H3 would have passed the ratchet. Worth tightening. |

---

## Needs Matt

### NM-1b. Regent's two bands cannot both exist on the pre-referenced rail

**2026-09-29.** Asked whether Regent could go live on production as their own
pre-referenced partner with "3 weeks at 20%, 5 weeks at 25%". Full analysis in
`docs/REGENT-ON-MAIN.md`. The answer is no, and the reason is not engineering:

**The 5-week band is the two-or-more-tenants band, and a pre-referenced
referral covers one tenant by our own explicit rule.**
`20261003110000_joint_is_agent_rail_only.sql:55` refuses `create_joint_referral`
for any mode other than `opndoor_referenced`, with the message "a
pre-referenced referral covers one tenant. Refer each tenant separately." So
on the pre-referenced rail Regent only ever reaches 3 weeks at 20%, **on either
codebase**. Shipping the branch would not deliver the second band.

**What I need from Matt: which is it?**

1. **Regent goes on the AGENCY rail**, where joint tenancies and both bands are
   real. Then the honest answer is that the branch ships, because back-porting
   `referencing_mode`, `user_scopes`, the additive commission split,
   `pricing_agreements` with bands and tiers, the tenancies schema and
   `create_joint_referral` IS the branch, not a subset of it.
2. **Regent's deal is rewritten as one band, 3 weeks at 20%, single tenant.**
   Then it is three migrations and about eight files on `main`, live in days.
   `docs/REGENT-ON-MAIN.md` section 4, Option B.

Note for option 2: `main` has no fee basis at all. The guarantee fee IS
`monthly_rent`, hard-wired at both Stripe call sites, and the tenant is told
"One month's rent" in the product description. On a £1,000 tenancy Regent's
tenant would be charged £1,000 where the 3-week band is £692.31.

And a trap to refuse if it is proposed: faking `monthly_rent` to encode the
fee gets the fee, league, digest and commission arithmetically right, because
`main` defines all of those AS `monthly_rent` -- and breaks every
rent-denominated figure, including the rent shown to the tenant at checkout
and two adjacent export columns that would read identically.

### NM-1c. Four defects on main that are nothing to do with Regent

Live on production today, with the current partners on it, and unaffected by
the Regent decision:

- the phantom "Add partner" (`src/data/partnersService.ts:67`)
- the unguarded column write through `applications_update`
  (`20260702134358_access_rls_rpc.sql:124-135`) -- management can write
  `partner_rate` directly on an application
- the unaudited `users_mgmt_update` (`:79-81`)
- the NULL-guard family, in `amend_tenancy_start` and the three `admin_*_user_*`
  RPCs, plus the four covered in NM-0

### NM-2b. Four internal notifications Q-04 names that do not exist

Q-04 says to list "ops alerts by kind, awaiting decision, reconciliation
items, deeds needing a staff send, new applications, payments, refunds, sync
failures, security events and any others" and then build routing for them.

Most exist. Four do not, and they are a build rather than a routing change:

| named | status |
| --- | --- |
| awaiting decision | nothing. An application sitting at `referencing` raises no internal alert. |
| reconciliation items | nothing internal. The screen exists; it does not notify. |
| new applications | nothing. A referral being created raises no internal alert. |
| payments | nothing on success. Only `stripe_refund_not_applied`, which fires on a FAILED refund. |

I am building the settings page for the types that DO exist, because a switch
for something nothing sends is worse than no switch. **What I need:** whether
to build those four as new alerts now, or leave them. My recommendation is to
leave "new applications" and "payments" -- on any volume they are a firehose
that trains people to filter the ops inbox, which is the failure mode the
whole item is trying to avoid -- and to build "awaiting decision" and
"reconciliation items" as DIGESTS rather than per-event alerts, because both
are backlogs and a backlog is a daily list, not an interrupt.

### NM-0. The 35 orphan accounts are DEV, and the production question is narrower than it looked

**2026-09-29.** Matt ran "auth.users rows with no public.users row" and got 35,
including `walk*/probe*/bulk*@example.invalid` (21 August), `test@test.com`,
`john@wayne.com`, `mdwyer@opndoor.co` and six throwaway addresses that had
signed in.

**Those are dev accounts.** Dev returns exactly 35 for the same query and every
address named is present with the same dates. The query was run against
`nfufwcpgrhfgwtphegca` (dev), not production. I cannot read production and have
not tried.

**And "orphan" is the wrong thing to count.** Broken down on dev:

| | count |
| --- | --- |
| orphans | 35 |
| of those, **applicants (tenants)** | **32** |
| neither a user nor an applicant | 3 |
| holding a **verified MFA factor** | **1** |

A tenant having an `auth.users` row and no `public.users` row is the DESIGNED
shape: the tenant rail is service-role-only behind `tenant-portal`/`tenant-auth`
and tenants never get a staff row. So 32 of the 35 are not anomalies at all.
And all four affected functions on `main` open with
`if not public.is_aal2() then raise 'MFA required'`, so an account without a
verified MFA factor cannot reach the flaw whatever else is true of it. On dev
exactly one orphan qualifies: `dev@foolettings.test`, a test fixture from
10 August.

**The query to run on production** is therefore not the one that returned 35.
It is this, and it should return zero:

```sql
select au.id, au.email, au.created_at, au.last_sign_in_at
from auth.users au
left join public.users u  on u.id  = au.id
left join public.applicants ap on ap.id = au.id
where u.id is null
  and ap.id is null
  and exists (select 1 from auth.mfa_factors f
               where f.user_id = au.id and f.status = 'verified');
```

That is "somebody who can complete MFA and is neither staff nor a tenant" --
in practice a former staff member deleted from `public.users` while their
`auth.users` row and MFA factor survived. **What I need: that query run on
production.** If it returns rows, each one can do the four things below on live
data until the branch ships.

#### What those four functions let such an account do on `main`

For a caller with no `public.users` row, `app_role()` is NULL, so in every
guard below `(r = 'management' and ...)` is NULL and `(r = 'referrer' and
owned)` is false; `false or NULL or false` is NULL, `not NULL` is NULL, and
`if NULL then raise` does not fire. All four are reachable, and each has a
SECOND gate that is defeated the same way.

| function on main | reached by | what it does once past the guard |
| --- | --- | --- |
| `mark_withdrawn(ref, reason, note)` | guarantee ref, which is sequential | Refuses unless `status = 'sent'`, then sets status `withdrawn` and stamps `withdrawn_by`. **Kills any unpaid referral, at any agency, before the tenant pays.** Revenue path denial of service; recoverable by an admin, but the tenant has been told it is cancelled. |
| `add_application_note(ref, body)` | guarantee ref | No status restriction. Inserts a **business-visible** note (up to 2000 chars) on any application, authored as the orphan. Also an existence oracle for any ref. |
| `amend_tenancy_start(uuid, date)` | application UUID | Second gate `can_amend_tenancy_start(NULL, …)` also returns NULL, **including on `status='deed'` / `deed_state='executed'`**. `expiry_date` is GENERATED from `tenancy_start`, so this **silently moves the expiry of an already-executed Deed of Guarantee** — up to five years out or back to 2000. The most serious of the four: it changes the term of a signed legal instrument with no audit row. |
| `send_deed_to_agent(uuid, email, bool)` | application UUID | Second gate `can_send_deed(NULL, owned)` returns NULL. Requires `status='deed'`. The `r = 'referrer'` clamp on a caller-supplied address is also NULL, so the orphan may pass **any** recipient address; the function resolves and authorises and the edge function then emails **the executed deed** there. Note it has NO explicit grant on main and both blanket revokes predate its creation, so it keeps the default PUBLIC EXECUTE. |

`applications.referrer_id` is `not null` on main, so the OTHER route into the
same flaw (a NULL referrer) does not reach production; it is opened only by
`20260812090000_referrer_optional.sql`, which is branch-only.


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
Item 7 is **in progress**: rounds 1, 2, 3 and 4 are complete; 1 to 3 are fixed
and round 4's findings are listed below.

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

### Round 4's instruction, verbatim (2026-09-28)

> Fix all of it, H1 to L5, not just H1 and H2. Rulings: M3, demoting to Manager clears receives_commission_statements, and commission_statement_recipients also requires the recipient may see commission. M4, direct-rail applications never count as the matched agency's business: exclude them from agency digests, cohort CSVs and every other agency-facing surface. M1, no developer role on the house partner by any path, admin_update_user_role included, and the dev_* reads get an agency predicate regardless.
>
> Before fixing H1: explain why the suite was green when definer_grants.test.sql and every_browser_rpc_checks_its_reach.test.sql should both have failed against 20261006330000. Make sure every pgTAP and vitest file runs against the final migration state in CI, and prove it by showing both tests failing before the fix.
>
> Add a functional guard alongside the security ones: a test for every user-facing action that a security migration touches (invite a new user, re-invite, remove a position, change level, deactivate, reset MFA, send deed, withdraw), run as the role that should be allowed, asserting it succeeds. Lock-downs must not break legitimate work silently again.
>
> Then the next fresh reviewer round, as before, until nothing above low. Record all of this in QUEUE.md and carry on.

### Round 4's findings

Two HIGHs, both guards of mine that block legitimate work, and both invisible
to the suite for reasons that are themselves the finding.

| # | Finding | Status |
| --- | --- | --- |
| H1 | `create_invited_user` revoked from `authenticated`, so no new user could be invited. | **done** `20261006410000`, proven by `the_work_still_works.test.sql` assertion 1 |
| H2 | `user_scopes_delete` called `may_act_on_user`, which `authenticated` may not execute, so "Remove position" raised permission denied for everyone. | **done** `20261006410000`, proven by assertions 4 and 5 of the same file |
| H3 (found by the file-derived allowlist, not by the reviewer) | `set_home_branch`, the one sanctioned way to change a home branch, was service-role only. | **done** `20261006430000`, proven by assertion 8 |
| M1 | `admin_update_user_role` could mint a `developer` on the house partner; the four `dev_*` reads were partner-wide. | **done** `20261006410000`, both halves |
| M2 | `fire_renewal_notices` emailed a DEACTIVATED referrer. | **done** `20261006410000` |
| M3 | Demoting a Director left `receives_commission_statements` set. | **done** `20261006410000`, both halves per Matt's ruling: `set_agency_level` clears it AND `commission_statement_recipients` requires the level |
| M4 | Direct-rail applications counted as the matched agency's business. | **done** `20261006410000` (digest) and `expiry-cohorts/index.ts` (CSV), per Matt's ruling |
| L1 | The referrer arm of `applications_update` had no partner pin. | **done** `20261006410000` |
| L2 | `authenticated` could WRITE the commission columns it may not read. | **done** `20261006410000`, table revoke then per-column re-grant, asserted in the migration |
| L3 | expiry-reminders used the estate flag, true for opndoor-direct, so every direct guarantee raised a false ops incident. | **done** now uses `application_channel` |
| L4 | `app_may_reach_application_org` bare `else true`. | **done** already closed by `20261006350000`; confirmed by the file replay |
| L5 | `agency_weekly_climber` had no status filter. | **done** `20261006410000` |

### And the drift work, which is the reason the two HIGHs were invisible

| Part | Proof |
| --- | --- |
| The file model | `scripts/schema-final-state.mjs` replays all 295 migrations in filename order and reports the final grants, bodies, policies, triggers and any return-type change without a DROP. `npm run schema:final`. No database needed, so it belongs in CI. |
| The diff | `scripts/schema-drift.mjs` compares that against a live catalogue. `npm run drift`. It found 68 differences, 54 of which were the model being wrong (type aliases, blanket revokes, generated policies) and 14 real. Now prints "No drift". |
| The corrections | `20261006400000` (grants dev had that the files closed, plus the two functions that were only callable because of a Supabase platform default) and `20261006420000` (four function BODIES where dev had an older definition than the files, including two fixes that had been written, applied, tested and silently rolled back). |
| ALTER DEFAULT PRIVILEGES | **Not in effect, and now said plainly.** Measured: a function created on dev right now still gets `=X/postgres`, i.e. PUBLIC EXECUTE, with `anon` and `authenticated` both true, even though the `postgres` default-ACL row is exactly right. Schema `public` is owned by `pg_database_owner` and `postgres` is not a member of `supabase_admin`, whose default-ACL row does grant anon and authenticated and cannot be altered from a migration. So the guard is an explicit revoke per function plus the pgTAP check, not the default. `20261006400000` says so at length. |
| The allowlist | Now derived from the migration FILES, not the database (`definerAllowlistCoverage.test.ts`). That change alone found two more mismatches: `may_act_on_user` granted but unlisted, and `set_home_branch` listed but not granted (H3). |
| Tests run as their role | `src/data/testsRunAsTheirRole.test.ts` fails any pgTAP assertion expecting 42501 that runs outside `set local role authenticated`. Found 5; four were fixed to run as the role, one annotated as a column trigger that raises for every role. |
| The functional guard | `supabase/tests/the_work_still_works.test.sql`, 15 assertions: invite, move, deactivate, remove position, change level both ways, set home branch, rename, reset MFA, read own book, withdraw, add a note, reach the deed path. All `lives_ok`, all as the role that should be allowed. |
| Cutover | `HANDOVER-BALAL.md` sections 1.1b and 1.1c: apply from zero in filename order in one run, then both suites against the clone, then `npm run drift` against the clone, before production is touched. |

Matt's rulings on the three that were judgement calls are in the verbatim
instruction above and are not re-stated here.

---
### The drift instruction, verbatim (2026-09-28)

Given after I explained why the suite was green. Matt chose option (b), the
analytical replay, and the file-derived allowlist.

> Go with (b), and the allowlist derived from the migration files, not the database. Then:
>
> 1. Never re-apply an existing migration to dev again. Any correction to an earlier migration goes in a new migration. Add that rule to CLAUDE.md.
>
> 2. Drift check: compute the final state from the files (grants, function bodies, policies, triggers, column privileges) and diff it against dev's live catalogue. List every difference. Fix dev to match the files with a new corrective migration, never by editing or re-running old ones. Make the diff a permanent check that fails when dev and the files disagree.
>
> 3. Tests run as the role they claim to test. Every RLS and grant assertion runs under set local role authenticated with a real JWT claim for the user in question. Add a lint that fails any test asserting a policy or grant after reset role or as postgres. Fix the H2 test and any others it finds.
>
> 4. Then the whole H1 to L5 list and the functional guard suite in one pass, each fix proven by a test that fails first.
>
> 5. Add to the cutover rehearsal in HANDOVER-BALAL.md: all migrations applied from zero to the clone in filename order, then the full pgTAP and vitest suites run against the clone before production is touched. That is the real fresh-database proof.
>
> Record in QUEUE.md, then the next fresh reviewer round. Carry on without stopping.

### Why the suite was green, which is the finding underneath H1 and H2

Three separate causes, and the third is the one that matters most.

1. **Dev was not a faithful replay of filename order.** `20261006300000:188`
   grants `create_invited_user` to `authenticated`; `20261006330000:486`
   revokes it. In filename order the revoke wins and every invite breaks. On
   dev the grant was live, because when I fixed a plpgsql bug in
   `user_must_hold_a_position` I RE-APPLIED 300000 after 330000 had already
   run, re-executing line 188. Dev and a clean migration run disagreed, and
   every local test run measured the wrong one. Hence rule 1 above.

2. **A test exercised its path as the wrong role.** `user_scopes_delete` calls
   `may_act_on_user`, which `20261006330000:594` revokes from `authenticated`.
   The removal test in `every_repro_from_both_reviews.test.sql` did the delete
   after `reset role`, as `postgres`, which bypasses RLS entirely: the policy
   predicate was never evaluated. It asserted the constraint trigger and
   nothing else. Hence rule 3 above.

3. **The allowlist was generated from the database it was testing.** I built
   `definer_grants.test.sql`'s expected answer by querying dev's catalogue. A
   test whose expectation is derived from the system under test cannot detect
   drift in that system; it restates it. That is why the assertion "every
   allowlisted name is executable by authenticated" passed while the migration
   on disk said the opposite. Hence the file-derived allowlist above.

CI would have caught (1), because `supabase db start` applies migrations in
filename order into a fresh database. It would not have caught (2) or (3).

---
### Round 5's findings (2026-09-29)

A fifth fresh reviewer, told to look for LOCKS as well as holes. One critical,
four high, nine medium, twelve low. The critical and the deed gap are fixed
(`20261006440000`, `20261006450000`, commit 489ad78); the rest are below.

| # | Finding | Status |
| --- | --- | --- |
| C1 | `agency_match_queue` operator precedence inverted its guard: a password-only session, including a tenant's, read the direct-rail queue. | **done** `20261006440000` |
| C2 | **Found while asserting M9, not by the reviewer.** Every authorisation guard in the schema evaluates to NULL when any arm is NULL, and `if NULL then raise` does not fire. A Regent Negotiator read a direct application's journey, withdrew it, and minted a 90-day payment-page token for it. | **done** `20261006470000` + `20261006480000` |
| H2 | `pricing_agreements` is readable by Managers and Negotiators and states `agent_rate`. The restrictive `may_see_commission()` policy was added to its three child tables and not to the parent. | **done** `20261006460000` |
| H3 | LOCK: "Resend invite" can never succeed on the estate. `usersService` sends no scope, and invite-user's position requirement fires before the re-invite branch. | **done** `_shared/invitePosition.ts`, commit f570ca2 |
| H4 | `commission_statement_recipients` still has no level test. My `20261006410000` changed the comment and not the SQL. | **done** `20261006460000` |
| H5 | `agreement_volume` counts direct-rail applications toward an agency's negotiated volume, and therefore its commission tier. | **done** `20261006460000` |
| M6 | `referencing-inbound` reads livemode off the token and the creator hardcodes `true`, so a sandbox token mints a live application. | **done** `20261006490000` |
| M7 | `referrerNotify` has no livemode test, so sandbox applications send real Opndoor email. | **done** `_shared/referrerNotify.ts` |
| M8 | `admin_update_user_role` skips `assert_may_grant_level` and never touches `sees_commission`: a Manager can promote somebody to Director, one rank above themselves. | **done** `20261006460000` |
| M9 | `application_journey`'s developer arm is bounded by `partner_id` alone; its four `dev_*` siblings were widened and it was missed. | **done** `20261006460000`; asserting it is what surfaced C2 |
| M10 | LOCK: the Users screen cannot invite any management user onto the estate, and can never create a Director. | **done** `UserManagement.tsx` |
| M11 | Agency onboarding invites its "Group director" as a Manager, so a new agency has nobody who may see commission and nobody who can create one. | **done** `orgShapes.ts` |
| M12 | LOCK: the position modal offers Remove (refused by the constraint for an active person) and Add position (which silently deletes the existing one). | **done** `PositionModal.tsx` |
| M13 | `hubspot-sync` accepts its outbound bearer token from a request header. | **done** `hubspot-sync/index.ts` |
| M14 | `set_receives_commission_statements` has no level test. | **done** `20261006460000` |
| L | Twelve lows: `applications_*` policies lost `to authenticated`; `users_mgmt_insert` has no containment; `create-referral` writes caller-supplied shares; `fire_expiry_reminders` does not filter a deactivated referrer on the supplier rail; `application-document-url` signs any bucket; `staff_payment_page_token` and `agency_branches_for_match` lack the AAL2 step-up; `referrer_league` ranks leavers; ten functions still PUBLIC-executable; `tenant-portal` reads the wrong Stripe key; `may_act_on_user` is strictly-above where two siblings are at-or-below. | **done** — nine in `20261006500000`, three in edge functions; `referrer_league` was closed in `20261006460000`. `may_act_on_user` is CORRECT as strictly-above (it governs things done TO somebody); the at-or-below sibling is `set_receives_notifications`, and the client now has `mayActOnOrEqual` for exactly that distinction. |

#### C2 in full: a guard that does not know is not a guard

Not a reviewer's finding. It surfaced because the M9 assertion refused to pass,
and chasing why produced this, measured on dev as Regent's own Negotiator:

```
  a direct application with no referrer        GR-20626
  a Negotiator reads its journey               ALLOWED
  and mints a 90-day payment token for it      384250ed-2f5b-41f9-9d92-16b7a4233527
```

In plpgsql `if NULL then ...` does not fire. Every authorisation guard in this
schema is written `if not (A or B or C) then raise`, and
`applications.referrer_id` is nullable, so for a Negotiator reading an
application with no referrer the owning arm is `true and NULL` = NULL, the OR
is NULL, `not NULL` is NULL, and the gate is skipped entirely.

Nine functions were reachable this way: `application_journey`,
`staff_payment_page_token`, `mark_withdrawn`, `add_application_note`,
`amend_tenancy_start`, `clear_awaiting_staff_send`, `my_application_delivery`,
`send_deed_to_agent`, `send_deed_to_landlord`. Two of them write.

| Part | Proof |
| --- | --- |
| The nine are refused | `supabase/tests/a_null_guard_refuses.test.sql`, 14 assertions. **Eleven fail against the code before `20261006470000`**, including two that assert the WRITES did not happen (`have: 1` payment token minted, `have: withdrawn`). |
| The class, not the nine | `referrer_id` is one NULL source of several: `app_partner()` and `app_role()` are both NULL for a caller with no `public.users` row (measured; `is_aal2`, `is_admin`, `is_opndoor_staff`, `app_has_scope`, `may_see_commission` are total). So all 205 raising `if not` guards in 89 functions are wrapped, including the ones provably total today, because wrapping only the exposed ones needs a judgement per guard and reopens the day somebody drops a NOT NULL. |
| It cannot come back | `src/data/guardsAreNullSafe.test.ts`, 4 assertions over the replayed final state. **Fails with all 205 listed when the two migrations are removed.** |
| The lock-downs did not break work | `the_work_still_works.test.sql` unchanged and green, plus two assertions in the new file that the owning Negotiator still reads and annotates their own application. |

**`20261006470000` was wrong and `20261006480000` fixes it.** The first wrapped
the OPERAND of each guard (`if not X` -> `if not coalesce(X, false)`), which is
right for a single term and wrong for six compound ones, because `not` binds
tighter than `and`: `(not A) and (not B)` became `not (A and not B)`. This is
the second precedence slip from a mechanical edit this session. The un-wrap
proof did not catch it, and that is the lesson worth keeping: **a proof that an
edit is REVERSIBLE says nothing about whether it is SEMANTICS-PRESERVING.** The
only form that cannot re-associate is wrapping the whole condition, which is
what `20261006480000` uses and what the lint now requires wherever a condition
is compound. All six were left over-strict, never under, so dev refused
legitimate work (`agent_rail_funnel` and `create_referral_target` stopped
answering) and opened nothing; the pgTAP suite failed on the next run.

##### Does this reach the live system?

**Yes, partly, and it needs Balal's attention at cutover rather than mine.**

- Four of the nine are on `main` and therefore live: `mark_withdrawn`,
  `add_application_note`, `amend_tenancy_start`, `send_deed_to_agent`. All four
  carry the identical `owned := a.referrer_id = auth.uid()` shape.
- **The `referrer_id` route does NOT reach live.** On `main`
  `applications.referrer_id` is `not null`; it becomes nullable only in
  `20260812090000_referrer_optional.sql`, which is on this branch and not on
  `main`. So the exact reproduction above cannot be run against production.
- **The `app_role()` route DOES reach live.** For any caller with no
  `public.users` row, `app_role()` is NULL and the whole shipped guard
  evaluates to NULL. Measured on dev against the guard as `main` writes it:

  ```
  app_role  is_admin  shipped_guard_fires  guard_is_null
  null      false     null                 true
  ```

  `main` revokes these from `anon` and grants them to `authenticated`, so the
  exposure is any authenticated principal holding no `public.users` row: a
  tenant account, or somebody removed from `public.users` while their
  `auth.users` row survived. `mark_withdrawn` and `add_application_note` both
  take a `guarantee_ref`, which is sequential.

I have not touched production and am not proposing to. The fix ships with this
branch. **What Matt or Balal should check on the live project:** whether any
`auth.users` row exists with no matching `public.users` row.

---
### Round 6's findings (2026-09-29)

Four fresh reviewers, on four dimensions: cross-company isolation, the level
ladder, what leaves the building, and LOCKS. Two of them found defects in work
committed earlier the same day, which is the point of a fresh reviewer.

| # | Finding | Status |
| --- | --- | --- |
| H1 | `authenticated` held table-wide UPDATE on `public.users` and both gates read the PRE-image, so a Manager PATCHed their Negotiator to `developer` on the house route. Measured, rolled back. | **done** `20261006550000` |
| H2 | `set_agency_group(agency, null)` let an agency manager detach their own agency from its group, removing it and all its people from the group Director's reach, irreversibly except by Opndoor. | **done** `20261006550000` + `20261006560000` |
| H3 | `notification_recipients` and `notification_enabled` (mine, committed an hour earlier) were granted to `authenticated` with no authorisation of any kind: a Negotiator at aal1 read another agency's staff names and addresses. | **done** `20261006570000` |
| H4 | LOCK: "Resend invite" still refused every positioned Director/Manager — the home-branch requirement sat above the `existing` lookup. Round 5's H3, one block higher, and my test missed it by exercising the extracted helper rather than the path. | **done** `invite-user/index.ts` |
| H5 | LOCK: `dev_sandbox_application_document` was revoked from `authenticated` but called caller-scoped, so the sandbox signing link was a hard 42501 for developer and admin alike. | **done** `20261006570000` |
| H6 | An agency Director's Reporting page stated Opndoor's own 25% house cut on their own book and added it to what they were owed. | **done** `liveAnalytics.ts` |
| H7 | `FinanceSurfaces`, the Opndoor money-ops surface, was mounted for every Director, not just superadmin. | **done** `Dashboard.tsx` |
| M1 | `create_invited_user` did not validate `p_role`, so any role outside management/referrer skipped the level assertion entirely — a second door to a developer on the house route. | **done** `20261006550000` |
| M2 | `create_invited_user` never checked `p_home_branch`. | **done** `20261006550000` |
| M3 | `agency_weekly_digest` pins `= 'Agent referral'`, so a supplier agency's digest is all zeros and the reader is dropped — while `staff_notification_scopes` has a supplier arm added for exactly that reason. | **done** `20261006580000` |
| M4 | The tenancy-correction replay guard is per-token, and every deed send mints another, so the same destructive correction replays on a second link. | todo |
| M5 | `commission_statement_lines` has no rail exclusion, so a matched direct-rail application becomes the matched agency's statement payee. Held off today only by `opndoor-direct`'s rate being 0. | **done** `20261006580000` |
| M13 | **Found while fixing M3/M5, not by a reviewer.** `agreement_volume` carries the same inclusion-form predicate the digest had (`application_channel(ap.id) = 'Agent referral'`), so a SUPPLIER agency's negotiated volume is always zero and its commission tier never advances. One line, same rule as `20261006580000`. | **done** `20261006590000` |
| M6 | `referencing-inbound`'s idempotency claim is keyed on `table_id` alone, so any inbound token can claim or burn another agency's hand-over. Not yet in use (zero rows). | **done** `20261006610000`; M1's replay-read oracle closed with it |
| M7 | The re-invite path never asks the ladder: a Manager can trigger a recovery link and an audit row against the Director above them. | **done** `invite-user/index.ts` |
| M8 | Five `language sql` functions still answer a password-only session (`agreement_for_agency`, `commission_preview`, `commission_split_batch`, `org_deed_readiness`, `org_rate_tiers`). The two plpgsql ones are done. | **done** `20261006600000` |
| M9 | Direct-rail rows counted into agency/branch counters in `hydrate.ts`; a group page's "What they earned" lists every payee on the rail; direct rows become an invented agency payee in `commissionSplit.ts`. | todo |
| M10 | `set_receives_notifications` can never be used on a supplier colleague (its scope test requires the TARGET to hold a position, which only estate users do). | todo |
| M11 | `opndoor_manager` sees the notifications tick on the agency People tab and every click raises 42501. | **done** `AgencyHome.tsx` |
| M12 | `set_home_branch` has no caller anywhere in the product: a home branch cannot be corrected after invite. | **done** `PositionModal.tsx` + `positionsService.setHomeBranch` |
| L | Several lows: unescaped ILIKE in the partner-API referrer lookup (a cross-partner existence oracle); `.neq("partner_id", …)` misses NULL; `send-password-reset` falls back to the caller's origin; `commission_statement_refs` has no may-see-commission policy; `partner_agency_relationships` has no AAL2 policy; `detach_user_from_agency` needs no group/agency position; `set_branch_deed_recipient` uses partner_id as "same organisation"; localStorage working copies survive sign-out. | todo |

**Does round 6 reach production?** No. `main` carries 65 migrations, newest
`20260705171000`. Every function and file named above is branch-only, except
the `public.users` grant in H1 — and on `main` `users_mgmt_update` did not yet
exist, so the PATCH had no policy to admit it.

**A weakness in my own check, found by the reviewer and worth recording:**
`definerAllowlistCoverage.test.ts` counts a function as covered if its name
appears in any pgTAP file. It does not require that the test actually asserts a
REFUSAL, so a definer function with no reach check can pass the ratchet. That
is how H3 would have sailed through. Tightening it is a todo.

---
## Q-01b. The deed goes to the referrer AND every ticked user in scope

**Status: done.** `20261006450000`, plus the Team-side control and two test
files.

| Part | Proof |
| --- | --- |
| The resolver is plural on the agency rail | `deed_delivery_target` returns one row per recipient there and one row on the other two rails. `supabase/tests/the_ticked_user_gets_the_deed.test.sql`, 13 assertions. **Four of them fail against the old `limit 1` resolver**, verified by restoring it in a rolled-back transaction. |
| One send, each as a recipient | `_shared/deedEmail.ts` takes `also[]` and sends one message to all of them; `pandadoc-webhook` passes every row; `send_deed_to_agent` returns the whole list and the manual button uses it. |
| Fallbacks unchanged | The ladder is `agency_notification_recipients`, untouched. Asserted: with the referrer deactivated the deed goes to the ticked user in scope and not to the branch mailbox. |
| The tickbox on the agency People tab | Already existed: `src/pages/Agencies/AgencyHome.tsx:862` (control), `:819` (the note), `:520` (handler). Opndoor admin reaches this screen. |
| The tickbox on Team | **Did not exist and now does**: `src/pages/Team/Team.tsx`, in the person row between the position and the actions, with the shared note above the list. `src/pages/Team/notificationTickbox.render.test.tsx`, 5 assertions, **all failing before the control existed**. |
| Who may tick | The row gate is `mayActOnOrEqual`, a new predicate in `src/data/types.ts`. `mayActOn` is strictly-below and governs things done TO somebody; `set_receives_notifications` admits a peer and yourself. Gating on `mayActOn` hid the control from every Manager on a team of Managers. |

### The instruction, verbatim (2026-09-28)

> Add to QUEUE.md verbatim and do it in this pass: the executed deed goes to the referrer AND to every user ticked "Receives notifications" whose position covers the referral, as one send with each as a recipient, same as every other per-application notification. This is the specified rule, not a question. Deed delivery on the agency rail must not resolve to a single address. Fallbacks unchanged when the referrer is deactivated.
>
> Also confirm the tickbox exists and works in the interface, not just the database: on the Team screen for an agency's directors and managers (for people at or below their own position), and on the agency People tab for Opndoor admin. Show me where each is, and add a functional test that ticking it as a director makes that user receive the next deed and notification. Tests fail against the current code first.

---
## Q-02. Supplier rail notifications

**Status: in progress.** The BEFORE table is done and committed:
`docs/NOTIFICATIONS.md`, read from the code -- every `sendMessage` in
`supabase/functions` enumerated and each recipient expression resolved back to
what produces it. It names three gaps against the intended rule, all on the
supplier rail: the executed deed does not reach the referrer; the four
lifecycle notifications do not reach the agent contact (so a supplier
referring by API key with no human user is told nothing); and the expiry
reminder adds that partner's management instead of the branch's agent contact.
Plus a fourth, smaller: the renewal notice loops one email per recipient
instead of one send with each as a recipient.

The AFTER half is built together with Q-03, because "subject to item 2's
settings" means they are one design: changing who receives what, with no
matrix to govern it, would be a change nobody could turn off.

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

**Status: in progress.** The inventory is done and committed:
`docs/OPS-NOTIFICATIONS.md`, read from the code. Today every internal alert
takes one path -- `report_ops_incident` dedupes per (kind, hour) into
`ops_alerts`, posts to `ops-alert`, and that sends to ONE address from
`OPS_ALERT_ADDRESS ?? EMAIL_REVIEW_ADDRESS ?? ""`. If neither is set the alert
is silently dropped. Twenty-four named kinds plus five `cron_error:<fn>`
variants.

**Four things the instruction names do not exist as internal notifications
at all**, and are a build rather than a routing change: awaiting decision,
reconciliation items, new applications, and payments (only a FAILED refund
alerts today, not a successful payment). The settings page is being built for
the types that exist. **Needs Matt:** whether those four should be built now
or listed. See NM-2b.

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

Audited against the code on 2026-09-28 by eight parallel readers plus a
critic that re-checked every "done" and "partial". Verdicts below are theirs,
spot-checked by me where they bore on something I had just changed.

| Item | Audit verdict | What is left |
| --- | --- | --- |
| A. Supplier detail page | **partial** | `PartnerHome.tsx` has no tabs at all: four flat cards. Overview lacks agent contacts and deed recipients; People is a read-only table with no row actions; Commission is two static figures; Referrals and Integration do not exist. Manage is still a modal on the Suppliers LIST (`PartnerManagement.tsx:301-423`), not folded onto tabs. `PersonActions` (`AgencyHome.tsx:113`) is not exported, so it has to be lifted to a shared module first. **A's Commission tab is blocked on Q-05 (fold 11)**; build the other four tabs first. |
| B. Reporting under View as | **missing** | There is no view-as predicate on Reporting at all. The bordereau card, the whole Opndoor settlement stack and the "Commission by partner" supplier split all still render under View as. "Your commission" is a hard-coded literal with no party name. Settlements and bordereau are raw `.card` sections, not `Card`/`CardHead` panels. And they are gated on `maySeeCommission`, not admin, so a Director sees them today. No test covers any of it. |
| C. Searchable scope picker | **partial** (effectively missing) | Reporting's picker is `getPartners()`, which strips house partners, so it cannot select an agency, a group, Direct, or the agency rail. Both controls are bare native selects. No quick choices, no recents (no storage key exists). The two pages use unrelated vocabularies: a `PartnerScope` slug on Reporting, an origin string on Applications. The analytics layer cannot express an agency scope at all (`paymentMetrics.scopeFull` filters `a.partner === scope`), and three export builders re-resolve the scope themselves instead of being handed it. |
| D. Joint tenancy grouping | **done** | The heading already carried the address, the "Joint tenancy" tag and the paid/deed tallies, and the LEAD badge and "Tenant 1 of 2" were already gone. The two remaining things are done: the sibling rows print the property in muted text instead of a dash, and `jointTenancy.render.test.tsx` now asserts that, replacing the assertion that D supersedes. 17 tests in that file pass. |
| E. Statement column elision | **done** | With three deviations worth keeping: the rule lives in `statementShape()` in `src/data/statementColumns.ts` rather than `viewerShape()`; the Branch rule fires on "every row names the same branch" rather than "the payee's scope holds one branch", which is the same answer by a more direct route; and the Agency clause is inert because no statement line carries an agency today. `buildAllStatementsCsv` is deliberately exempt. |
| F. Exports and statement | **partial** | **F1**: `bxRound2` is a second money rounder used by the bordereau, outside the one-formatter route, and the test does not walk `buildAllStatementsCsv` or either bordereau builder. **F2**: not started. **F3**: both settlement statements still mint a name-slug reference via `statementRef()`, still carry Currency and Payee level, still print a blended rate in the total row, and still print "Commission statement" twice. The screen shows no reference at all. |
| G. Three agency levels | **partial** | The SQL half is now done (`agreement_for_agency` gained its `may_see_commission()` gate in `20261006380000`, which was the one open commission route the audit found). The UI half is not: `UserManagement.tsx` still says "Management" and "Referrer" rather than the three level names, its invite has no level picker so every management invite from that screen lands as a Manager, and its change-role dialog cannot move somebody between Director and Manager. |
| H. Referred by section | **missing** | Nothing of it exists. Sections still run Tenant, Property, Tenancy, Agent and branch. The rail, the route and the fee are all inferred from the branch after the fact, not chosen up front. `AgentBranchPicker` searches by ambient partner scope. No RPC takes a supplier, so there is no server-side check that the branch belongs to one. `/new-application` is open to management and referrer as well as admin. Needs a migration. |

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
