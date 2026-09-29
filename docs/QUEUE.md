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

## Walk fixes (instruction, 2026-09-29, verbatim). RECORDED, NOT STARTED.

Matt is walking dev. Batches are recorded here as they arrive and NOTHING is
built until he says so.

### Batch 1 (verbatim)

> Walk fixes, batch 1. Add to QUEUE.md verbatim under "Walk fixes" and commit. Do not build anything yet; I'm walking dev and it must not change under me.
>
> 1. Opndoor team page: the three dots on your own row open an empty menu. Either hide them, or show the actions you can take on your own account (rename, reset your own MFA).
> 2. "Sees: Own referrals" is shown for an Opndoor admin. Admin sees everything; it should say so.
> 3. The logo label reads "SUPPLIER PORTAL" when signed in as Opndoor admin. It should say "Admin" for Opndoor staff.
> 4. The Opndoor team page description still says "partners". It should refer to suppliers and agencies.
> 5. The "What [person] can see" dialog opens for Opndoor team members and treats them like agency staff: it says "Own referrals only", asks for an office, and offers agency and supplier branches, and choosing one would limit that person to that branch. Opndoor admins see everything by their role and must never be given an office or position. Remove this dialog for Opndoor team members, and make sure a position can never narrow what an Opndoor admin sees, even if one was set.

### Batch 2 (verbatim)

> Walk fixes, batch 2. Add to QUEUE.md verbatim under "Walk fixes" and commit. Do not build yet.
>
> 6. The "What [person] can see" dialog mixes two things. Split it into two clearly labelled parts: "Works at" (their home office, which decides their team, league and commission statement) and "Oversees" (the branches, brand or agency they manage, which decides what they can see). Retitle the dialog "Office and responsibilities".

### Batch 3 (verbatim)

> Walk fixes, batch 3. Add to QUEUE.md verbatim under "Walk fixes" and commit. Do not build yet.
>
> 7. Applications, Origin picker: choosing an option does nothing, the list doesn't change. Fix it. Matt isn't sure the picker is helpful in this form; after fixing, note in QUEUE.md under "Needs Matt" a one-line simpler alternative for him to consider, but don't redesign it.
> 8. The bordereau export includes every application. It should include only guarantees with an executed deed, in force during the period, and not refunded or withdrawn.

### Batch 4 (verbatim)

> Walk fixes, batch 4. Add to QUEUE.md verbatim under "Walk fixes" and commit. Do not build yet.
>
> 9. Internal notifications page is messy and confusing. Headings run into their labels ("NOTIFICATIONSWhere opndoor's own alerts go", "CRITICALAlways reaches somebody"), the description is repeated, and it isn't clear whose notifications you are changing or why. Ticked boxes can't be unticked and nothing says why (badges like "last one" and "unrouted" aren't explained).
> 10. Matt's direction: this belongs within the Opndoor team page, per person, like permissions. Each Opndoor team member has their own notification settings, reached from their row (the three dots menu), showing which internal alerts that person receives. Remove the separate Internal notifications page from the menu. The rule that a critical alert can never be left with nobody still applies: where a box can't be unticked because that person is the only recipient, say so plainly next to it.
> 11. The Opndoor team list shows "Sees: Own referrals" for every admin, including new invites (Matthew Dwyer). Same fix as item 2, applies to every Opndoor team member.

### Batch 5 (verbatim)

> Walk fixes, batch 5. Add to QUEUE.md verbatim under "Walk fixes" and commit. Do not build yet.
>
> 12. Agency People tab, same problem as Opndoor's internal notifications: notification settings are split across three places (a "Notifications" tickbox column, a "Statements" tickbox column, and a separate "Who is told what" grid underneath with columns for "The referrer" and "Users ticked Receives notifications"). It's messy and hard to tell who gets what. Matt's direction, same as item 10: notifications move onto each person, like permissions, reached from their row. For each person, one panel showing: whether they're copied on referrals within their position, which events they're told about, and whether they get monthly statements. Remove the separate grid and the two tickbox columns from the table. The locked items (every tenant email, and the executed deed reaching its recipient) show as locked with the reason. Build items 10 and 12 as one shared design so Opndoor team and agency people work the same way; suppliers too.

### Batch 6 (verbatim). ITEM 13 IS RANKED FIRST OF ALL WALK FIXES.

> Walk fixes, batch 6. Add to QUEUE.md verbatim under "Walk fixes" and commit. Do not build yet, but rank this first when building: it blocks a core action.
>
> 13. Inviting someone to an agency fails: "Everybody on our estate holds a position... jane@jane.com has none". The rule that every agency person holds a position is right, but the invite form never asks for one and tells you to set it afterwards, so the invite is refused. Fix: the invite form asks where they sit (branch, brand or whole agency, depending on level) and the position is created with the invite in one step. If the agency has only one branch, pick it automatically and don't ask. Add a functional test inviting each level to a one-branch and a multi-branch agency.
> 14. Error messages must be plain English for agency users. "On our estate", "position" and "scope" mean nothing to them. This one should say something like "Choose which branch this person works at." Check other user-facing errors for the same jargon.

---

## Walk fixes, after shipping

Matt's own heading, batch 7. These are NOT part of the walk-fix build above:
they are deferred past shipping.

### Batch 7 (verbatim)

> Walk fixes, batch 7. Add to QUEUE.md verbatim under "Walk fixes, after shipping" and commit. Do not build yet.
>
> 15. Reporting scope picker: choosing an option does nothing (same fault as item 7 on Applications), no suppliers appear under Suppliers (Kestrel is missing), Northgate appears twice, and the page header still says "All partners". Matt finds the picker confusing as hell. What he wants is to see the reports for each customer: each supplier and each agency. Don't build a fix to the picker; write a short proposal under "Needs Matt" for how Matt gets a report per supplier and per agency (for example from each one's own page), and wait for his answer.

### Batch 8 (verbatim)

> Walk fixes, batch 8. Add to QUEUE.md verbatim under "Walk fixes, after shipping" and commit. Do not build yet.
>
> 16. Reporting, "Total guaranteed rent value" (£72k) is wrong. It should be the total rent under guarantee: 12 months' rent for each executed deed in force in the period, counting a joint tenancy once, not once per tenant. Show how the current figure is calculated alongside the fix.

**Item 16: how the current figure is calculated, read off the code now** (this
is the "show how" half of the item, done early because it is reading, not
building). One line does it, `src/data/liveAnalytics.ts:229`:

```
if (inRange(app.deedAt, start, end)) { a.deed += 1; a.guaranteed += guaranteedAnnual(app); }
```

So today's figure is **12 months' rent for every application whose deed was
ISSUED inside the period**. Comparing that against Matt's sentence, the two
halves of his fix are in very different states:

- **"counting a joint tenancy once" is ALREADY DONE.** `guaranteedAnnual(app)`
  returns the application's SHARE, not the whole tenancy's rent, and the
  comment above that line records the fix: a two-tenant tenancy at £2,000 was
  contributing £48,000 to a figure where £24,000 was guaranteed. So this half
  should be verified rather than rebuilt -- and if £72k is still wrong in that
  direction, the share logic is not reaching this path and that is the bug.
- **"in force in the period" is NOT done, and is the likely fault.** The code
  asks when the deed was ISSUED. Matt asked what was IN FORCE. A guarantee
  issued last year and still running contributes nothing today; one issued
  inside the period but already expired contributes fully. Both are wrong, and
  they push the number in opposite directions, which is why the total can look
  plausible while being built from the wrong set.
- **"executed" is not tested either.** The condition keys on `app.deedAt`
  being present and in range, not on the deed actually being executed. An
  issued-but-unsigned deed counts today.

**Item 16 shares its two clauses with item 8** -- "in force during the period"
and "counting a joint tenancy once" are the same two concepts the bordereau
needs. They should share one helper and one set of tests, or they will drift
apart and disagree, which for an underwriter-facing document and a headline
reporting tile is worse than either being wrong alone.

**And item 16 inherits item 8's dependency on R2**: "in force" has to exclude
what was genuinely refunded, which is only meaningful once a partial refund
stops being recorded as a total one.

### Batch 9 (verbatim)

> Walk fixes, batch 9. Add to QUEUE.md verbatim under "Walk fixes, after shipping" and commit. Do not build yet.
>
> 17. Reporting, Monthly volume trend for Opndoor admin defaults to "Commission earned" and shows £0 every month, while Commission payable shows £3,232. Opndoor doesn't earn commission, it pays it. For admin, the trend's options should be Opndoor's view: fees collected, commission payable, referrals sent, deeds issued, defaulting to fees collected. "Commission earned" stays for agency and supplier users, where it's their money. Whichever option is chosen, the trend must match the tiles on the same page.
> 18. Reporting, the referrer list shows "Direct signup" as a Negotiator. A direct signup isn't a person or a referrer; it shouldn't appear there.
> 19. Reporting, "Northgate Lettings's commission": the possessive should read "Northgate Lettings' commission" where the name ends in s.

**Item 17's last sentence is the testable one.** "Whichever option is chosen,
the trend must match the tiles on the same page" is a consistency invariant,
not a copy change, and it is the half most likely to be quietly wrong again
later. It wants a test per option asserting the trend's total for the period
equals the tile, rather than a test that the dropdown lists four things.

**Item 17 rests on a distinction the code already makes.** `liveAnalytics.ts`
separates a genuine supplier's cut from a house route's, with the comment that
a house route's partner cut "is opndoor's own margin", and
`our_margin_is_not_theirs.test.sql` asserts it. So "Opndoor doesn't earn
commission, it pays it" is already true in the money model, and the fault is
that the TREND offers a reader a series that cannot apply to them. The fix is
to pick the option set from who is reading, which is the same shape as the
per-reader digests (rule 4).

**Item 18 is the same root as B1 and B2, and should be fixed with them.** Rule
5 is that direct-rail business is never the matched agency's. B1 has
direct-rail rows counted into agency and branch counters; B2 has direct
applications becoming an invented agency payee named after the matched
agency. Item 18 is that same invented party surfacing a third time, now in
the referrer list wearing a level ("Negotiator") it cannot hold. One cause,
three symptoms: fixing it in the reporting list alone leaves the other two.

**Item 19 should be fixed where the possessive is FORMED, not where it is
read.** If the string is built by appending `'s` at each call site, item 19 is
several bugs; if there is one helper, it is one. Worth finding out first,
because a name ending in s is not the only case -- the rule wants stating once
and testing once.

### Batch 10 (verbatim)

> Walk fixes, batch 10. Add to QUEUE.md verbatim under "Walk fixes, after shipping" and commit. Do not build yet.
>
> 20. Reporting for Opndoor admin should show volume broken down by partner: every supplier and every agency, side by side (referrals sent, fees collected, deeds issued, commission payable). Suppliers are currently left out of the breakdowns entirely (Kestrel appears nowhere). Consider this together with item 15, since both are about Matt seeing results per customer.

**Item 20 ANSWERS the open question in NM-F, and NM-F has been revised.** NM-F
proposed moving the report onto each customer's own page and stated plainly
what that would lose: "Comparing two agencies means opening two pages. If
comparison matters, say so and it changes the proposal." Item 20 is Matt
saying comparison matters -- "every supplier and every agency, side by side".
So the per-customer page alone is not the answer, and NM-F now proposes both
halves. One question to Matt is therefore withdrawn; the other still stands.

**"Kestrel appears nowhere" is the SAME fault as item 15's "no suppliers
appear under Suppliers".** Twice in two screens means it is not a picker bug
and not a breakdown bug: something upstream is dropping suppliers out of
reporting altogether. That shared cause should be found before either screen
is touched, because it is one fix and it is probably the whole of both
symptoms.

**Item 20's four measures are the same four as item 17's admin option set**
(referrals sent, fees collected, deeds issued, commission payable). That is
not a coincidence and should not become two lists: the per-partner breakdown
and the trend should read from one definition of Opndoor's four measures, or
a row total and a trend total will eventually disagree -- which item 17
already forbids in its last sentence.

### Batch 11 (verbatim)

> Walk fixes, batch 11. Add to QUEUE.md verbatim under "Walk fixes, after shipping" and commit. Do not build yet.
>
> 21. Reporting, Volume by referrer: the line under each name shows their level (Negotiator, Director), which is irrelevant. Show where they work instead, depending on who's looking: Opndoor admin sees agency and branch; an agency with more than one branch sees the branch; a single-branch agency sees just the name, nothing underneath. Same rule anywhere else referrers are listed (League, exports).

**Item 21 RENDERS what item 6 EDITS.** "Where they work" is the home office --
the same thing item 6 calls "Works at" and splits out from "Oversees". So the
two items are two ends of one concept and must agree on what the home office
is. If item 6 lands first, item 21 reads the field it established; if item 21
lands first it will invent its own answer and they will diverge. Build 6
before 21, or build them together.

**Item 21 is "depending on who's looking", which is rule 4 again.** That makes
three walk fixes resting on the same rule -- 17 (which trend options a reader
is offered), 12 (which notification rows a party has), and now 21. The reader
is already available to the client, so this is not new machinery; it is
remembering to ask.

**Item 21's single-branch case is an assertion, not an absence.** "A
single-branch agency sees just the name, nothing underneath" needs a test that
nothing is rendered, not merely that the level is gone. That is the same shape
as item 13's "if the agency has only one branch, pick it automatically and
don't ask" -- both say the product should stop asking a question with one
possible answer, and both are easy to implement as "show it anyway, but
empty", which leaves a stray line under every name.

**"Same rule anywhere else referrers are listed (League, exports)" makes this
a shared helper**, exactly like item 19's possessive. One function that takes
the referrer and the reader and returns the subtitle, used by Volume by
referrer, the League and the exports -- not three copies. Worth checking
whether the level subtitle is already centralised (`levelLabel`) before
writing a second helper beside it.

### Batch 12 (verbatim). 22b IS TO BE DONE NOW, READ-ONLY, ON DEV.

> Walk fixes, batch 12. Add to QUEUE.md verbatim and commit. Do not build yet, except the check in 22b.
>
> 22a. Reconciliation, Direct matches: clicking Set branch fails with "canceling statement due to statement timeout". A 100% name match ("Foo Lettings") is shown but not auto-accepted, with no explanation why. The page text is jargon ("canonical records", "Merging likely duplicates is coming in a later release"): rewrite in plain English, explaining that a direct tenant named their letting agent and Opndoor is linking it to a known agency. After shipping.
> 22b. Do this check now, read-only, on dev: find what timed out and whether the cause (for example the new permission checks) also slows any step on the Regent or supplier path: sending a referral, the tenant paying, signing, deed delivery, inviting someone. Report the timings. Don't change anything.
> 23. Reconciliation, Direct matches: "Set branch" and "Not in network" act immediately. Both need a confirmation box first, saying in plain English what will happen (for example "Link this tenant's agent to Foo Lettings, Foo Central?"). Apply the same rule to any other admin action that changes records in one click. After shipping.

**22b is an explicit, named exception to "do not touch the dev project"** and
was done immediately. Read-only: no migration, no schema change, no restart.
Every timing below ran inside a transaction that was rolled back, so dev is
unchanged.

#### 22b findings, 2026-09-29

**1. What is slow on dev: `cron_health()`, and only that.**
`pg_stat_statements` is unambiguous. Everything else on the whole database is
under 1.4 seconds; this one is twenty.

| statement | calls | mean | max |
| --- | --- | --- | --- |
| `cron_health()` (direct) | 75 | **20,315 ms** | **24,092 ms** |
| `cron_health()` via PostgREST | 58 | 232 ms | 1,353 ms |
| everything else | -- | -- | < 1,356 ms |

`authenticated` carries `statement_timeout = 8s` (and `anon` 3s), so the
direct form is three times over the limit.

**2. Why it is slow, and it is not the permission checks.**
`cron.job_run_details` holds **57,240 rows / 34 MB** and grows forever:
`partner-webhooks` runs every minute (1,440 rows a day) and `hubspot-sync`
every two (720 a day), so roughly **2,160 rows a day with nothing deleting
them**. Its only index is the primary key on `runid` -- there is no index on
`jobid` or `start_time`. `cron_health()` then correlates each of the 546
`net._http_response` rows against that table with a LATERAL **range** join:

```
where d.start_time <= r.created
  and r.created  <  d.start_time + interval '5 minutes'
order by d.start_time desc limit 1
```

A range predicate on an unindexed column, run once per response row. It is
O(responses x run_details), and run_details grows every minute forever. The
cost is entirely retention and a missing index; no guard is involved.

**3. Matt's hypothesis is disproved: the permission checks are free.**
Measured as the Regent Director, the reader with the most to resolve:

| check | time |
| --- | --- |
| `app_partner()` | 0.3 ms |
| `may_see_commission()` | 0.6 ms |
| `app_role()` | 0.9 ms |
| `app_scoped_agencies()` (the position lookup) | 1.3 ms |
| `app_may_reach_branch()` | 2.0 ms |

**4. And no step of either journey is slow.** Every one measured end to end:

| step | Regent (agency) | Kestrel (supplier) |
| --- | --- | --- |
| sending a referral (`create_referral`) | 25.2 ms | 6.4 ms |
| the tenant paying (`apply_stripe_payment`) | 3.2 ms | -- |
| a refund (`apply_stripe_refund`) | 1.5 ms | -- |
| deed delivery (`deed_delivery_target`) | 7.9 ms | -- |
| who is emailed (`notification_recipients`) | 4.7 ms | -- |
| inviting someone (`create_invited_user`) | 12.6 ms | -- |

And the Reconciliation screen itself: `resolve_agency_match` (the Set branch
button) **6.7 ms**, `agency_match_queue()` 5.4 ms, `agency_branches_for_match()`
1.2 ms, `reconciliation_queue()` 3.2 ms.

**5. So I could NOT reproduce Matt's timeout, and I will not pretend
otherwise.** The Set branch path is single-digit milliseconds, `cron_health`
is not called from Reconciliation, no cron job takes more than 0.02 s, and
there were no blocking or idle-in-transaction sessions when I looked. The
match queue is also empty now -- its one row is `dismissed` -- so the row Matt
clicked is gone and the exact conditions cannot be recreated. The honest
conclusion is that the Set branch timeout was **transient**, and the thing
that IS reproducibly over the limit is `cron_health`.

**6. The go-live consequence, which is the part that matters.**
This is not a dev-only curiosity. `cron.job_run_details` grows unbounded on
**any** Supabase project running these jobs, live included, and live has been
running longer. `cron_health` is granted to `authenticated` and admin-gated,
so the Health screen gets slower every day and will eventually pass 8 seconds
there too and simply stop working. There is no retention job for it, although
the pattern exists already -- `rate-limit-cleanup` runs hourly for exactly
this kind of housekeeping. **Recorded as B21 in the security backlog.**

**7. A side-finding that shrinks walk-fix item 13.**
`create_invited_user` already takes `p_scope_kind` and `p_scope_target`:

```
create_invited_user(p_id uuid, p_email text, p_full_name text, p_role text,
                    p_partner uuid, p_home_branch uuid, p_sees_commission boolean,
                    p_scope_kind text, p_scope_target uuid)
```

So the server can **already** create the invite and the position in one
transaction, which is exactly what item 13 requires. The invite form simply
does not pass them. Item 13 is therefore mostly a form change against an RPC
that is already the right shape, not the server rework it looked like.

**22a's timeout is a PERFORMANCE finding, and performance has not been
measured once in this entire effort.** Round after round asked whether the
guards were correct; none asked what they cost. A statement timeout on an
admin action is the first hard evidence that the answer might matter, and
Matt's parenthesis -- "for example the new permission checks" -- names the
most likely cause: the reach predicates are `security definer` functions
called per row from RLS policies, and a policy predicate that is fine on ten
rows is not necessarily fine on ten thousand.

**22a also reports a product question, not only a fault.** "A 100% name match
is shown but not auto-accepted, with no explanation why" is a decision
nobody has taken: whether an exact match should link itself. That is Matt's
to make, and it should not be quietly decided while fixing the timeout.

**Item 23 is a general rule, not one screen.** "Apply the same rule to any
other admin action that changes records in one click" means the deliverable is
an inventory first -- every one-click admin action that writes -- and then a
shared confirmation, not a box bolted onto two buttons. Worth noting that
`PersonActions` already has destructive actions ("Remove access") that may
have the same problem.

### Batch 14 (verbatim). NOTE: no batch 13 was received.

Numbering jumps from 12 to 14. Recorded as Matt labelled it. **If a batch 13
was sent and did not arrive, it is not in this file and nothing from it is
known** -- flagged rather than silently renumbered, because a lost batch would
otherwise look like a batch that never existed.

> Walk fixes, batch 14. Add to QUEUE.md verbatim under "Walk fixes, after shipping" and commit. Do not build yet.
>
> 24. Reconciliation, "Not in network": when a direct tenant names a letting agent Opndoor doesn't work with, that agency should go to HubSpot as a new company (a prospect), with the agent contact details the tenant gave, marked as having come from a direct tenant. If the company already exists in HubSpot, add to it rather than duplicating. Only the agency and agent contact go across, never the tenant's details. Check this against the HubSpot consequences report before building.

**Item 24's "add to it rather than duplicating" IS the open decision in the
HubSpot report.** Matt says to check this against Q-07 before building, and
the check comes back pointed: `docs/HUBSPOT-CONSEQUENCES.md` records that the
one decision left open there is **whether the portal stores the HubSpot record
id**. Dedup is not possible without it. Matching on company name instead is
exactly the "name slug" approach fold F3 already rejected for statement
references, and it breaks the same way -- rename the agency and the match is
lost, creating the duplicate the item forbids. So item 24 cannot be built
until that decision is made, and it is the reason to make it.

**Item 24 states a data-protection boundary that wants a test, not a
comment.** "Only the agency and agent contact go across, never the tenant's
details" is the kind of rule that holds on the day it is written and quietly
stops holding when someone adds a field to the payload. It wants an assertion
over the outbound payload's keys -- a deny-list that fails when any tenant
field appears -- rather than a careful `select` that future edits can widen.

**And it is the first walk fix that sends data OUTSIDE the product.**
Everything else on this list is internal. This one pushes records to a third
party, so it is also the first that cannot be undone by fixing a bug: a
prospect wrongly created in HubSpot is in HubSpot. That argues for the dedup
decision and the payload test landing before the first real send, not after.

### Batch 15 (verbatim)

> Walk fixes, batch 15. Add to QUEUE.md verbatim under "Walk fixes, after shipping" and commit. Do not build yet.
>
> 25. Home: nothing says what period the numbers cover. Label every number with what it counts: the four queue tiles as "waiting now", and the Direct signups stages with their period. Confirm from the code what period Direct signups currently uses and write it under "Needs Matt" with the option of a period choice (today, this week, this month, all time) for Matt to decide.

**The "confirm from the code" half is DONE and the answer is ALL TIME.** It is
written up as NM-G below with the period choice Matt asked for. The labelling
itself stays unbuilt.

**The four queue tiles are correctly "waiting now" already, which makes item
25 a labelling fix and not a counting fix for them.** Awaiting decision,
Agency matches, Reconciliation and Delivery failed are current-state counts by
construction -- they ask what is in that state now, not what entered it during
some window. So "waiting now" is an accurate label for what the code already
does, and no arithmetic changes. Direct signups is the opposite case: it is
genuinely all time, and whether that is right is the question NM-G puts.

### Batch 16 (verbatim)

> Walk fixes, batch 16. Add to QUEUE.md verbatim and commit. Do not build yet.
>
> 26. Matt's rule: every tenancy is priced at one month's rent, whether one applicant or two, unless a different deal has been negotiated (like Regent's bands). With two applicants that one month is split between them by share. Suppliers may refer joint tenancies, the same way agencies can: Add another tenant works on the supplier route, shares are set, one fee for the tenancy split by share. Confirm the agency route already follows the one-month rule when no deal is set, and fix it if not.
> 27. New application: the section numbers repeat (Tenant and Property are both "2"). Number the sections in order.

### Batch 17 (verbatim)

> Walk fixes, batch 17. Add to QUEUE.md verbatim and commit. Do not build yet.
>
> 28. Admin New application with Referred by set to Supplier (Kestrel Lettings): the last section says "Your office" and sits on "Working out which office this referral is against" without ever resolving. That's the supplier user's own wording and behaviour. For Opndoor admin it should be "Agency and branch": choose from the chosen supplier's agencies and branches, as specified in the Referred by fold-in. The side navigation should match the section names.

#### Item 26: the confirmation Matt asked for. CONFIRMED, from the files.

**The agency route does follow the one-month rule when no deal is set.** The
standard basis is 4.35 weeks, which is 52/12, one month expressed in weeks,
and `create_referral` prices a no-agreement referral at exactly
`p_rent, 4.35` (`20260928150000_create_referral_resolves_agency_mode.sql:93-94`,
comment: "One month's rent on a 4.35-week basis, snapshotted, never
recomputed"). The fee amount is snapshotted and never re-derived from the
basis.

**And "one month split between them by share" is already the shape, not one
month each.** The walk's Regent pair priced at 5 weeks TOTAL -- £1,384.62 +
£1,384.61, summing to £2,769.23, which is five weeks of a £2,400 rent, not
ten. So the splitting mechanism divides ONE tenancy fee between applicants,
which is what item 26 describes; Regent's five weeks is the negotiated deal
the rule allows for. Nothing to fix on this half.

**One caveat on the confirmation.** This is read from the migration files,
not measured on data, because dev is off limits during the walk except for
the 22b check. The walk (`docs/THE-WALK.md`) already measured the Regent pair
against real dev data and it agreed, so the confirmation rests on a
measurement as well as a reading -- but a no-deal JOINT tenancy specifically
has not been measured, only the no-deal single and the negotiated joint. That
one case should be measured when dev is available again.

#### Item 26 REVERSES an earlier instruction, and a test currently asserts the opposite

This needs to be seen rather than quietly absorbed. Matt's Q-06 item H said,
verbatim, of the supplier path: **"single tenant (no Add another tenant)"**.
Item 26 now says the opposite: *"Suppliers may refer joint tenancies, the same
way agencies can: Add another tenant works on the supplier route."*

Batch 16 is newer, so it governs. The consequences of the reversal:

- **`src/pages/NewApplication/referredBy.render.test.tsx` has an assertion
  that enforces the OLD rule** -- "a supplier referral is single-tenant: the
  button is offered disabled, with the reason" -- and it passes today. When
  item 26 is built that test must be inverted, not deleted quietly: it is the
  record of a decision that changed, and its comment should say so.
- The supplier rail has **no positions** (B3), so "shares are set" needs
  checking on a rail whose people model differs from the agency rail's.
- Joint tenancies are the subject of R3 and R5, both unfixed. **Extending
  joint tenancies to a second rail before those are fixed widens the blast
  radius of both** -- R3 is the uncapped commission on joint tenancies, R5 is
  the correction that leaves two deeds disagreeing. Item 26 should be built
  after R3 and R5, and its tests should cover the supplier rail for each.

#### Items 27 and 28 are the same screen, and 28 is the larger of the two

Item 27 (repeated section numbers) and item 28 (the wrong last section for an
admin on the supplier route) are both New application. 28 also says "the side
navigation should match the section names", which is the same numbering and
naming machinery item 27 touches. One piece of work.

**Item 28 reports a HANG, not only wrong wording.** "Sits on 'Working out
which office this referral is against' without ever resolving" is a promise
that never settles -- the estate probe answering about a branch that was never
chosen, on a path where the admin was supposed to choose the agency and branch
from the supplier instead. That is a functional defect and the wording is
downstream of it, so fixing the copy alone would leave a screen that still
never finishes.

### Batch 18 (verbatim)

> Walk fixes, batch 18. Add to QUEUE.md verbatim and commit. Do not build yet.
>
> 29. Admin New application, Referred by: after choosing Supplier, Kestrel Lettings, then an agency and branch, the choices disappear and the only way to correct a wrong agency or branch is to cancel and start again. Every choice in Referred by stays visible and changeable until the application is sent, with a Change option on each. Changing an earlier choice clears only what depends on it.
> 30. The Referred by description is jargon ("It decides the rail, the route and the commission"). Rewrite in plain English, for example "Who sent us this tenant. This decides the price and who is paid commission."

**Items 28, 29 and 30 are all the Referred by fold-in**, and with 27 that is
four walk fixes on one screen. They want building as one piece: 27 numbers the
sections, 28 replaces the wrong last section and fixes a hang, 29 makes every
choice revisable, 30 rewrites the description.

**Item 29's last sentence is the whole of the difficulty.** "Changing an
earlier choice clears only what depends on it" is a dependency graph, not a
form: supplier -> agency -> branch, where changing the supplier must clear
agency and branch, changing the agency must clear the branch, and changing
the branch clears nothing. The existing test file already asserts the
supplier half of this ("changing the supplier clears both"), so the rule is
half-specified in tests already and should be completed there rather than
re-derived.

**Item 30's replacement wording is Matt's own and should be used as given.**
"Who sent us this tenant. This decides the price and who is paid commission."
It is also a good check on item 14's jargon sweep: "rail" and "route" are
exactly the internal vocabulary item 14 is about, and this is the same fault
on a description rather than an error.

**The proposal item 15 asks for is written up as NM-F below.** Item 15 itself
stays unbuilt and unranked until Matt answers it.

**Item 15 reports four faults, and only the first is the same as item 7.**
"Choosing an option does nothing" is item 7's fault on a second screen, so one
root cause. The other three are separate and each says something:
no suppliers listed, Northgate listed twice, and a header still reading "All
partners" after the Suppliers rename (Q-06). They are recorded here rather
than fixed because Matt has said not to fix the picker. **If the answer to
NM-F is "reports live on each customer's own page", the picker goes away and
three of these four never need fixing** -- which is the reason to ask before
building.

**"Northgate appears twice" is worth a specific look when NM-F is answered.**
Matt's ruling of 17 August is that an agency exists once and is never
duplicated per supplier: an agency under two suppliers is ONE party shown with
two counters. A name appearing twice in a picker is exactly what that ruling
forbids, so this may be the ruling not being honoured rather than a display
bug.

---

### Status: nothing built, and THE SEVEN ARE PAUSED

"Do not build anything yet; I'm walking dev and it must not change under me"
stops the R1-R7 work too, because every one of those fixes is a migration
applied to dev. Nothing has been applied: R1 had reached the
investigation stage only, and no migration file was written. Dev is exactly as
Matt found it.

The only work still running is READ-ONLY and touches no database: the
determination of whether each of the seven also exists on `origin/main`, which
reads git and nothing else.

### Notes recorded now so they are not lost

**Item 5's last clause is a SERVER question, not a dialog one.** "Make sure a
position can never narrow what an Opndoor admin sees, even if one was set" is
answered by the reach predicates, not by hiding a dialog. Hiding the dialog
stops new positions being created; it does nothing about a row already in the
table. Two halves, two tests.

**Items 5 and 6 are the same dialog and must be built together.** 5 removes it
for Opndoor staff; 6 restructures it for everyone else. Built separately they
will conflict over the same component.

**Item 6 names a distinction the data model already makes**, which is the
reason the dialog reads as a muddle: "Works at" is the HOME OFFICE and "Oversees"
is the POSITION set. They are different columns doing different jobs, and the
dialog currently presents them as one list. Item 6 is therefore mostly a
labelling and grouping change over a split that already exists, NOT a data
model change -- to be confirmed against `user_scopes` and the home-branch
column before building, because if any screen today infers the home office
FROM the position set, that inference is the actual bug and wants its own
test.

**Item 6 touches money.** "Works at" is said to decide the commission
statement, so the home office is not cosmetic: changing it moves who gets
paid. Whatever is built needs a test that a change to "Oversees" alone leaves
the commission statement untouched.

**Item 8 DEPENDS ON R2 and must be built after it, not before.** R2 is the
finding that a PARTIAL refund is recorded as a total one: `apply_stripe_refund`
sets `payment_state = 'refunded'` whatever the amount. Item 8 says the
bordereau must exclude what is "refunded". Those two are only consistent once
"refunded" means fully refunded -- build item 8 first and the export will
correctly exclude exactly the wrong rows, dropping still-enforceable
guarantees off the underwriter return because ten pounds came back. That is
the same defect R2 already names as one of its three consequences. So: R2
first, then item 8, and item 8's test must include a partially-refunded
executed guarantee and assert it is PRESENT.

**Item 8 is an underwriter-facing document**, which makes "in force during the
period" the clause to pin down rather than assume. A guarantee whose term
starts inside the period, ends inside it, or spans it entirely is in force
during it; one that expired before it began is not. Overlap, not containment.
Worth stating in the test explicitly, in both directions.

**Item 11 IS item 2.** Matt says so himself ("Same fix as item 2"). One fix,
one test, both items close together. Recorded separately only because he
raised it twice, which is itself evidence the label is wrong in more than one
place: item 2 was the admin's own row, item 11 is every row including pending
invites. The fix belongs wherever the label is computed, not on either screen.

**Item 10 already has a server-side invariant, and a test that guards it.**
"A critical alert can never be left with nobody" is the floor enforced today
and asserted by `who_opndoor_tells.test.sql`. Moving the UI per person does not
get to weaken it: the per-person screen must ask the same server question, and
the existing floor test must still pass unchanged afterwards. What is NEW in
item 10 is only the explanation -- "say so plainly next to it" -- which is the
half item 9 says is missing ("badges like 'last one' and 'unrouted' aren't
explained").

**Item 10 removes a page that NM-2b says is partly fiction.** Four of the
alert types Q-04 names do not exist (NM-2b, still parked on Matt as NM-B).
Rebuilding this per person will surface that again: the per-person screen will
either list four alerts that never fire, or quietly omit them. Neither is
decided here. Flag it when the item is built rather than choosing.

**Items 9, 10 and 12 are now ONE piece of work, on Matt's instruction:**
"Build items 10 and 12 as one shared design so Opndoor team and agency people
work the same way; suppliers too." So the deliverable is a single per-person
notifications panel used by three parties, reached the same way from a row on
each. Three screens today (the Internal notifications page, the agency People
tab's two columns plus grid, and the supplier People tab) collapse into one
component. It is the largest of the walk fixes by some distance and should not
be started piecemeal.

**And it has a server side that already exists.** `notification_enabled`,
`set_notification_setting` and the `notification_types()` catalogue are built
and tested (Q-03), and they already carry the two things item 12 asks the UI
to show: the LOCKED cells and the per-party/per-class shape. So this is
mostly a UI consolidation over a server model that is already the right shape
-- with one gap to check rather than assume: item 12 wants "whether they get
monthly statements" on the SAME panel, and statements are a separate
mechanism from notifications today. Confirm before designing whether that is
one model or two.

**Item 12's locked items differ per rail, which is why one shared design is
the risk as well as the instruction.** On the agency rail the deed to its own
recipient is locked (Q-03) and the copies are switchable; on the supplier rail
the agent contact is the deed's recipient and there are no positions at all
(B3: `set_receives_notifications` cannot be used on a supplier colleague,
because its scope test requires the target to hold a position). A single
component must therefore ask the SERVER what is locked and why, per party, and
must not hard-code a list -- or the supplier rail will show agency rules.

**Item 13 is a BUILD ORDER instruction as well as a fix.** Matt: "rank this
first when building: it blocks a core action." So when the walk fixes start,
13 goes first, ahead of 1-12, whatever order they were raised in.

**Item 13 must be ONE step server-side, not two calls from the browser.** "The
position is created with the invite in one step" is what makes the current
failure impossible to repeat. Inviting and then positioning as two client
calls reintroduces exactly today's bug the moment the second call fails: a
user row exists, has no position, and the constraint trigger refuses it. The
invite RPC has to take the position and create both in one transaction. Note
the invite path already has history here -- round 6's H4 (resend refused every
positioned Director/Manager) and M1 (`create_invited_user` did not validate
`p_role`) -- so it wants its tests at the RPC, not only at the form.

**Item 13's test matrix is specified by Matt and should be built as stated:**
each level (Director, Manager, Negotiator) into a one-branch agency AND a
multi-branch agency. Six cases. The one-branch case has its own assertion
beyond succeeding -- it must NOT ask.

**Item 14 will collide with the pgTAP suite, and that is a feature not a
problem.** Several tests assert exact error text (`throws_ok(..., 'Only an
opndoor admin may choose the route for a referral.')`). Rewording a message
will fail those tests, which is the correct signal: it proves the test was
pinned to the message a user actually sees. Each one wants updating
deliberately, not with a find and replace.

**Item 14 needs a line drawn between two audiences.** "On our estate" is
jargon to an agency user; some other messages are only ever seen by an
opndoor admin, where the internal vocabulary is correct and clearer. The sweep
should reword what AGENCY and SUPPLIER users can see, and leave admin-only
text alone. Which messages reach which audience is worth establishing before
rewording, not after.

**Item 7's "simpler alternative" note is due AFTER the fix, not now.** Matt's
words: "after fixing, note in QUEUE.md under 'Needs Matt' a one-line simpler
alternative for him to consider, but don't redesign it." So the fix comes
first, the one line goes under "Needs Matt" when it lands, and no redesign
happens in between.

---

## FIX THE SEVEN, IN A WORKTREE (instruction, 2026-09-29, verbatim). ACTIVE.

This supersedes the pause below. The seven are being built again, but nowhere
near dev.

> Start the seven fixes from your final review now, but without changing anything I'm walking: work in a separate git worktree, test against a local database, and do not apply any migration to dev, restart 5174 or touch the dev project until I say I've finished walking. Each fix with a test that fails first. For 7, the partner API works out the fee and commission exactly as the portal does when the tenant pays; where someone other than the tenant pays, it refuses with a clear message until Matt decides. Keep recording my walk fixes in QUEUE.md as they arrive, but don't build those yet. When I say the walk is done, merge the seven, apply to dev, then build the walk fixes.

### How this is being obeyed

| the constraint | how |
| --- | --- |
| separate git worktree | branch `fix-the-seven` off `partner-api`, in its own worktree. The main tree stays on `partner-api` so walk fixes can keep being recorded without touching the fix work. |
| test against a local database | **a real local Postgres had to be built first -- this machine had none.** See below. |
| no migration applied to dev | nothing is sent to `nfufwcpgrhfgwtphegca` at all. The dev pgTAP runner is not used. |
| do not restart 5174 | the dev server is left alone; no `npm run dev`. |
| do not touch the dev project | no queries, not even reads. |
| walk fixes still recorded | in the MAIN tree, on `partner-api`, as they arrive. |
| merge, then apply, then walk fixes | in that order, and only when Matt says the walk is done. |

### The local database, and why this was not a five-minute step

This machine has **no Docker, no Postgres, no Homebrew and no Supabase CLI**.
`npm run test:db` is `supabase test db`, which needs Docker; that is the
original reason the pgTAP suite had never been run here and why
`scripts/pgtap-against-dev.py` was written to run it against dev instead. Dev
is now off limits, so neither existing route works and a local Postgres had to
be stood up from nothing.

This is a better test than dev in one specific way, and it is worth saying
plainly: dev carries real seed rows and the accumulated state of 333 applied
migrations, so a pass there proves the assertions hold against *that* state. A
local cluster built by applying all 333 files in filename order to an empty
database proves a **clean apply** -- which is what CI does, and what
`npm run drift` only approximates by computing the final state statically.

---

## FIX THE SEVEN (instruction, 2026-09-29, verbatim). Superseded by the above.

> Fix problems 1 to 7 from your final review, in the order you ranked them, each with a test that fails first. For 7, the partner API must work out the fee and commission exactly as the portal does when the tenant pays, which is every route today. Where a supplier is set so that someone other than the tenant pays, the API refuses the application with a clear message until Matt decides how that payment works; do not build that payment path. For each problem, say whether it also exists on the live system today. When all seven are fixed and green, stop and report in plain English.

### What this instruction settles, and what it does not

It **unblocks R7 only as far as the tenant pays.** NM-A ("how an agency pays
the fee itself") stays parked: where a supplier is configured so that somebody
other than the tenant pays, the API refuses with a clear message. That refusal
is the deliverable; the payment path is explicitly NOT to be built.

"Exactly as the portal does" means R7's fix must call the same resolvers the
portal calls, not a second implementation that agrees with them today.

### Progress

| # | fix | test that failed first | on live too? | status |
| --- | --- | --- | --- | --- |
| R1 | Cross-company contact write, and the deed follows it | | **no** | todo |
| R2 | Partial refund recorded as a total refund | | **YES, and worse** | todo |
| R3 | 50% commission cap not enforced on joint tenancies | | no, feature absent | todo |
| R4 | Four definer RPCs return the commission rates | | **partly, by another route** | todo |
| R5 | Tenancy-start correction fixes only one of a joint pair | | no, feature absent | todo |
| R6 | Commission rates writable from the browser, no audit row | | **YES, and worse** | todo |
| R7 | `create_referral_api` resolves no fee and no rates | | no, feature absent | todo |

### Does it exist on live? Answered, 2026-09-29. Read-only, git only.

Matt asked this as part of the instruction. Each of the seven was examined
against `origin/main` (commit `3520a26`, 65 migrations, byte-identical to local
`main`) by one analyst and then by one refuter told to assume the analyst was
wrong. **Analyst and refuter agreed on all seven**, every one at high
confidence. No database was touched; this reads git and nothing else.

**R1 -- NO, and the reason is instructive.** Live has no agency rail at all:
no `user_scopes`, no house partner, no `app_may_reach_*` family. One partner is
one company, so `partner_id = app_partner()` IS the boundary there. Live's
contact policies have the SAME shape as the broken arm, but a BEFORE trigger
`sync_contact_partner` overwrites `new.partner_id` with the partner read off
the target agency or branch *before* the WITH CHECK runs, so the writer's
supplied value is discarded and the value actually tested is the owner's. The
partner-blind resolver DOES exist live and is reached with the service role
from `pandadoc-webhook`, but it is not exploitable there precisely because the
trigger guarantees every contact row already carries its own branch's partner.
**That trigger is the guard this branch lost**, and it is the shape the fix
should restore rather than invent.

**R2 -- YES, and live is worse.** `apply_stripe_refund` is the same
unconditional flip, last defined live at
`20260702192702_refund_policy_anomaly.sql:10-21`. Live additionally DISCARDS
the RPC's error (origin/main webhook line 104) where this branch added a 500
and an ops incident, and lacks the `deed_state='error'` fallback when a
PandaDoc void fails. Live also carries two consequences the finding did not
list: expiry reminders stop, and the league and climber queries treat the
application as fully refunded. **This is the one to tell Balal about.**

**R3 -- cannot happen live.** No joint tenancies, no pricing agreements, no
`commission_preview`. One flat rate pair per partner, frozen onto the
application. All three mechanisms are branch inventions dated after live's
last migration.

**R4 -- PARTLY, and by a different route.** Live has no `sees_commission` and
no Director/Manager split: its role enum is exactly
`('superadmin','management','referrer')`, so `management` IS the
commission-seeing level and half the finding's victim list does not exist
there. The count is three, not four (`set_application_status` was already
admin-only). But the RETURN TYPE is not the leak on live: the rate columns are
readable by a plain table SELECT, so a negotiator's browser already receives
them and only the screen's choice not to draw them hides it.

**R5 -- cannot happen live.** No joint tenancies; live's own field-mapping
spec says so in writing. One tenant, one application, one deed. The expiry
half IS true on live -- `expiry_date` is generated there too, so a correction
silently moves a signed instrument's expiry -- but it can never produce two
documents that disagree.

**R6 -- YES, and live is worse.** Same shape, smaller surface: rates live in
`partners` and in the per-application snapshot, neither with an audit trigger,
while `update_partner_settings` and `partner_audit` both exist and are simply
optional. Live is worse on `applications`: `applications_update` permits
management-in-partner and referrer-owns-while-sent with no column restriction,
so it is **not only an admin** -- a manager can rewrite the snapshotted rate on
any application at their partner, and a negotiator on their own.

**R7 -- cannot happen live.** There is no partner API there: no
`create_referral_api`, no partner-api edge function among live's 34, no API-key
table. Live's single portal path does resolve the rates correctly.

### What this changes about the live hotfix already with Balal

`docs/HOTFIX-LIVE-FOR-BALAL.sql` revokes insert, update, delete and truncate
on `public.applications` from `anon` and `authenticated`. That **closes R6's
applications half on live**, including the manager-and-negotiator route above,
which is a stronger reason for the hotfix than the one it was written for.

It does **not** close:

- **R6 on `public.partners`.** The hotfix names `applications` only. An
  opndoor admin can still PATCH `partner_rate` and `agent_rate` on `partners`
  straight from the browser, unrecorded, after the hotfix is applied.
- **R2 at all.** The refund defect is in a SECURITY DEFINER function reached
  by the Stripe webhook with the service role; no table grant touches it.

Both are live-system facts and neither is mine to act on: `origin` is a
third-party live repository and Matt pushes. Recorded here so the decision is
his and is made with the full picture.

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

## The list to finish (standing instruction, 2026-09-29, verbatim)

This supersedes "Order of work" as the running order. Items 1, 2, 3 and 5 are
new; item 4 is the list of thirteen I gave Matt in the plain-English report of
2026-09-29, reproduced under "The thirteen" below so "items 3 to 13" is
unambiguous.

> Carry on and finish the whole list in order, without stopping, starting with the live hotfix:
>
> 1. Hotfix for the live system as one file for Balal: managers and referrers may update only the application fields the live screens actually edit, every other column locked; plus the shared change making the four live functions refuse when they cannot tell who the caller is. Prove every live screen action still works and a locked field is refused. Write docs/HOTFIX-LIVE-FOR-BALAL.md in plain English with a read-only check to confirm it took effect. Do not touch production.
> 2. Verify the Regent correction and fix the two documents.
> 3. Verify the monthly commission statement fault. If real, fix it and prove a statement sends.
> 4. Then items 3 to 13 of your list, including the one final review round.
> 5. Finish Climber of the week's test and the team-side notification tickbox.
>
> Matt's decision, already made on 17 August: an agency exists once, never duplicated per supplier, so an agency under two suppliers is one party shown with two counters.
>
> Do not decide anything else on Matt's behalf. The fee payment question (tenant's link or monthly invoice), the four alerts that don't exist, and the other nine supplier-commission questions go at the top of QUEUE.md under "Needs Matt", each in one or two plain sentences with the options and what each would mean. Build everything that doesn't depend on those answers. Anything that does, build up to that point and leave it clearly marked.
>
> Record progress in QUEUE.md as you go. When the list is done or only "Needs Matt" items remain, stop and report in plain English.

### Progress against that list

| item | status |
| --- | --- |
| 1. The live hotfix for Balal | **done** `476d587` |
| 2. Verify the Regent correction, fix the two documents | **done** (this commit) |
| 3. Verify the monthly commission statement fault, fix it, prove a statement sends | **done** (this commit) |
| 4. Items 3 to 13 of the thirteen | in progress -- see below |
| 5. Climber of the week's test, and the team tickbox | **done** `5497a6a` |

**Item 4 in detail.**

| of the thirteen | status |
| --- | --- |
| 3. Supplier commission (Q-05) | as far as it can go: amendments 3 and 4 **done** (`1d25b6a`), the Suppliers rename **done** (`37c8b13`). The paid-by switch, the supplier statement and the editor's shape are blocked on NM-A and NM-C. |
| 4. Supplier detail page as tabs | **mostly done** -- five tabs, Referrals and Integration built, People given the agency's row actions, Overview now names the agent contact a deed would reach. TWO PIECES LEFT, both recorded below. |
| 5. Reporting under View as | **done** `a954e94` |
| 6. Searchable scope picker | **done** `dcbc4ad` |
| 7. Exports and statement | **done** `177c8a7` |
| 8. Three agency levels in admin screens | **done** `2a8fce6` |
| 9. "Referred by" on New application | **done** (this commit) |
| 4a. The supplier COMMISSION EDITOR | blocked on NM-C 3 and 4. The tab shows today's rate figures and today's form; its new shape (Standard / Flat / Volume tiered, and whether it sets the agency rate underneath) is Matt's to settle. |
| 4b. Deleting "Manage" from the suppliers list | todo, and deliberately not done in passing. The SAME modal is the only way to CREATE a supplier: `openAdd` and the else-branch of `save` both use it. Deleting it without first separating create from edit is how the Add button stops working, and that is a change worth making on its own. |
| 10. HubSpot consequences report | **done** -- `docs/HUBSPOT-CONSEQUENCES.md`. Comes back to Matt before fold 17 is designed. |
| 11. The end-to-end walk on dev | **done** for the half that can run here -- `docs/THE-WALK.md`. Payment, deed generation and the emails need a browser: Deno is not installed, so those edge functions cannot run on this machine at all. |
| 12. Handover and cutover checklist | **done** -- `docs/HANDOVER-BALAL.md` updated: counts refreshed 266->333, section 0a for everything since Monday, section 8a listing the settings no migration can carry. |
| 13. The one final review round | **done** -- 26 findings, 9 serious, **7 survived** three-refuter verification. Ranked in "The one final review round" below. R1 is a cross-company write that misdelivers an executed deed, and it is measured, not argued. **None of the seven is fixed.** |

Item 5 was taken out of order because items 1 to 3 were blocked on a scoping
run and it was fully independent. Both halves turned out to be built already;
only the tests were missing, and QUEUE.md was stale in saying otherwise.

### What changed about how I decide

The standing instruction of earlier today said to decide anything the queue did
not answer and record it under "Decisions taken without Matt". **That is now
narrowed: no new decisions on Matt's behalf.** Anything genuinely open goes to
"Needs Matt" and the build stops at that point, clearly marked, while
everything independent of it carries on. D1 to D13 stand; D14 onwards will not
be created.

### The thirteen (item 4 refers to these by number)

| # | item |
| --- | --- |
| 1 | Record the two emergency fixes for the live system and get them to Balal |
| 2 | Verify the Regent correction and fix the two documents that carry the wrong answer |
| 3 | Supplier commission: the editor, Partners renamed to Suppliers, and the four amendments |
| 4 | Supplier detail page rebuilt as tabs, matching the agency page |
| 5 | Reporting under "View as" |
| 6 | A searchable scope picker on Reporting and Applications |
| 7 | Export and statement corrections |
| 8 | The three agency level names in the admin user screens, and Director/Manager moves |
| 9 | A "Referred by" section at the top of the admin new-application form |
| 10 | The HubSpot consequences report |
| 11 | The end-to-end walk on dev |
| 12 | The handover document and cutover checklist |
| 13 | Exactly one final review round, criticals and highs only |

Items 1 and 2 of the thirteen are items 1 and 2 of the instruction above, so
"items 3 to 13" starts at the supplier commission work.

---

## Matt's rulings recorded late

Decisions Matt had already made that were not in this file, and which I would
otherwise have had to ask about or decide.

| date | ruling | what it settles |
| --- | --- | --- |
| 2026-08-17 | **An agency exists once and is never duplicated per supplier. An agency under two suppliers is ONE party shown with TWO counters.** | Answers Q-05 amendment 4 (and the scoping's question M8) in favour of one canonical agency with per-route counters, NOT two agency rows. The scoping recommended the opposite; Matt's ruling wins. It means a canonical agency identity has to exist, and `active_agreement_on`'s one-live-agreement-per-party rule has to admit one agreement per party PER ROUTE. |

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

**The review loop is CLOSED.** Round 7 ran, its one critical and five highs
are fixed and tested, and its mediums and lows are B13-B18 below. No further
rounds until the ONE final round after the queue is built.

**Superseded, 2026-09-29 evening.** The paragraphs above are the state as of
that morning and are kept only so the sequence reads. The thirteen are now all
done or blocked, and the one final round has run.

Next action: **nothing is in flight.** The whole of the thirteen is either done
or recorded as blocked on Matt, and the final round's seven survivors are
written up above and NOT fixed. The next piece of work is whichever Matt picks:
the seven (R1 first, it is the only measured cross-company write), or the
parked NM-A / NM-B / NM-C questions that block the rest of Q-05 and Q-06.

---

## Order of work

| id | item | status |
| --- | --- | --- |
| Q-01 | The security loop | **closed**. Round 7 was the last of the loop; the one final round is item 13, and it has now run. Seven survivors, none fixed, ranked below. |
| Q-01b | The deed goes to the referrer AND every ticked user in scope | **done** |
| Q-02 | Supplier rail notifications | **done** |
| Q-03 | Notification settings per party | **done** |
| Q-04 | Opndoor internal notification routing | **done** (four alert types Matt named do not exist -- NM-2b) |
| Q-05 | Fold 11 and the four commission amendments | in progress: amendments 3 and 4 **done**, the rest blocked on NM-A and NM-C |
| Q-06 | The fold-ins A to H | **done** except A's commission EDITOR (NM-C 3/4) and deleting Manage from the suppliers list, both recorded under item 4 above |
| Q-07 | The HubSpot consequences report | **done** `c7168ef` |
| Q-08 | The end-to-end walk on dev | **done** for the half that runs here `8b1d839` |
| Q-09 | HANDOVER-BALAL.md and the cutover checklist | **done** `103bfe6` |
| Q-10 | Loose ends from item 4 of the 2026-09-28 mandate | **done** `5497a6a` |

Ids were renumbered once, when Q-02 to Q-04 were inserted after the security
loop on Matt's instruction ("in this order, after the current item"). Nothing
outside this file refers to them.

---

## The one final review round (item 13). DONE, 2026-09-29. Seven survivors.

This is the round CLAUDE.md's "How security work ends" allows, and it is the
last one. Nothing below reopens the loop: the survivors are ordinary queue
items now, and from here the definition of secure is the test suite.

26 findings raised, 9 serious. Each serious one went to three independent
refuters instructed to REFUTE it and to default to "refuted" when unsure.
Seven survived. Two died: the "a rate change writes no audit row" editor
finding (there is no editor to write one from) and a Management-guide static
asset.

**Nothing below is fixed.** Each is ranked by what it costs if exploited or
noticed, and each says what is already proven versus what is still argued.

| # | finding | proven? | cost if left |
| --- | --- | --- | --- |
| R1 | **Cross-company write, and the executed deed follows it.** A Manager at any agency can attach a deed contact to another company's branch, and that company's next executed Deed of Guarantee is delivered to the address they wrote. | **MEASURED on dev**, end to end. See below. | A legal instrument, naming a tenant and a property, delivered to an unrelated company. Rule 2. |
| R2 | **A partial refund is recorded as a total refund.** `apply_stripe_refund` sets `payment_state='refunded'` whatever `p_amount` is. | **MEASURED**: a £10 refund on a £1,246.15 fee removed the whole £311.54 commission line. Payees went 5 lines / £1,601.54 to 4 lines / £1,290.00. | Three at once: the agency is short-paid; `stripe-webhook/index.ts:344` voids a deed that is still outstanding; `buildLiveBordereau` drops an executed guarantee off the underwriter return while it remains enforceable. |
| R3 | **The 50% commission cap is not enforced for joint tenancies**, and `commission_preview` ignores pricing agreements, so the operator is told 30% while 55% is paid. | argued, not yet measured | Overpayment, against a number the operator was shown and trusted. |
| R4 | **Four authenticated SECURITY DEFINER RPCs `RETURNS applications`**, which carries `partner_rate` and `agent_rate`. | argued | Commercial terms reach a Manager and a Negotiator. Rule 3: those are Director-level. |
| R5 | **A tenancy-start correction fixes one application**, so a joint tenancy ends with two executed deeds stating contradictory dates. | argued | Two enforceable instruments that disagree on a material term. |
| R6 | **Commission rates and negotiated bands are writable straight from the browser** by an admin via PostgREST PATCH, with no audit row. | argued | A money number changes with nothing recording who changed it. |
| R7 | `create_referral_api` never resolves fee or rates. | **MEASURED** earlier, `1eb6fa0` | Already recorded against NM-C 7. Listed here only so the round's output is complete; fixing it is part of answering that question. |

### R1 in full, because it is the one that is measured and the worst

The predicate is `app_may_reach_contact(p_agency, p_branch, p_partner)`, and
its last arm is the problem:

```
else p_partner = public.app_partner()
```

`p_partner` is the partner_id **on the row being written**, supplied by the
writer. The arm checks it against the caller's own partner and stops there. It
never checks that the partner agrees with the row's `agency_id` or
`branch_id`. So a Manager labels the row with their own partner_id, points it
at somebody else's branch, and the with-check passes.

Which branches are exposed is decided by the FIRST arm, which routes agencies
on an `opndoor_referenced` partner to `app_reachable_agency` and is sound.
Everything else falls through to the broken arm. Measured on dev:

| the branch's partner | mode | branches | a stranger may write to it |
| --- | --- | --- | --- |
| kestrel-lettings | pre_referenced_open | 2 | **yes** |
| referencing-partner | pre_referenced_open | 1 | **yes** |
| harbour-lets | opndoor_referenced | 1 | no |
| opndoor-agents | opndoor_referenced | 6 | no |
| opndoor-direct | opndoor_referenced | 1 | no |

So it is every `pre_referenced_*` partner, which is most of the supplier rail,
and it works supplier-to-supplier as well as agency-to-supplier.

The write alone would be bad enough. What makes it a leak is the rung below
it. `deed_delivery_target` tries `effective_primary_contact_route(branch,
partner)` first, which DOES pin the partner and so cannot be fooled; but when
that finds nothing it falls back to `effective_primary_contact(branch)`, which
keys on the branch alone with no partner filter at all, and which runs inside
a SECURITY DEFINER caller and therefore sees every row regardless of RLS. A
supplier branch with no contact of its own is exactly the state the supplier
page already calls "No agent contact", so this is not a rare configuration.

Walked on dev in a rolled-back transaction: a Manager at an unrelated
house-rail agency wrote the contact, and

```
EXECUTED DEED IS DELIVERED TO  attacker@evil.test via branch_contact
```

Two things are wrong and both want fixing: the predicate's last arm must
require the partner to match the branch's own owner, and
`effective_primary_contact` must not be reachable as a partner-blind fallback
from a definer function.

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
| B4 | Unescaped ILIKE in the partner-API referrer lookup gives a cross-partner existence oracle for staff email addresses. | `supabase/functions/_shared/partnerApplications.ts:76,87` | **done** `20261006710000` + both call sites. Matched by equality on a lowercased key, and `users.email` is normalised on write so the equality is provably exact rather than incidentally so. |
| B5 | `.neq("partner_id", …)` never matches NULL, so the cross-partner referrer guard is blind to every superadmin and opndoor_manager. | `_shared/partnerApplications.ts:86` | **done**, with B4. Asked as "known to somebody who is not us", which includes them. The `maybeSingle()` beside it also ERRORED on two rows and the error was discarded, so two matches read as "not known" -- the opposite of the intended answer. |
| B6 | `send-password-reset` falls back to the caller-supplied origin when `APP_URL` is unset, contradicting its own comment. | `supabase/functions/send-password-reset/index.ts:52` | **done** `_shared/safeOrigin.ts`. Wider than reported: `tenant-portal` took the caller's origin OUTRIGHT, with no APP_URL anywhere, for the Stripe success and cancel URLs. All five senders now share one function. |
| B7 | `commission_statement_refs` has no `may_see_commission()` restrictive policy, unlike `pricing_agreements` and its three children. | policy set on that table | **done** `20261006770000`. Measured first: a Manager without the capability read their own agency's references, count 1 where it should be 0. Leaks the reference and the payee key, no amounts. Both directions asserted, because a capability test that locked the Director out too would be the worse bug. |
| B19 | **Measured, not a hole today, recorded so nobody re-derives it.** 54 tables grant a write privilege to `authenticated` purely from Supabase's default privileges, and on 34 of them there is no write POLICY at all, so the grant is unreachable. | every public table | RLS is enabled on **all 54** -- I checked, expecting to find the production fault repeated here, and it is not. So there is no live exposure: the grant is latent, and becomes real only if somebody later adds a permissive write policy to one of those 34 without noticing the grant is already open. Not swept now because revoking across 34 tables is the exact shape of the change CLAUDE.md warns about, and it would buy nothing today. The durable fix is a pattern check that fails when a table gains a write policy while holding a default grant. |
| B8 | `partner_agency_relationships` has no `require_aal2` restrictive policy. | policy set on that table | **done, and it was nine tables not one** -- `20261006780000`. Three of the nine are commercial, and on those it was not a read-at-aal1 nuisance but a WRITE: measured on dev, a superadmin with no second factor rewrote a commission rate. The mechanism generalises and is the reason B8 looked smaller than it was: permissive policies are OR-ed, so `pricing_agreements_select`'s `is_aal2() and ...` was undone by a sibling `for all` policy using only `is_admin()`. Only a RESTRICTIVE policy is AND-ed. All 27 tables now carry one. |
| B9 | `detach_user_from_agency` requires no group/agency-kind position, unlike `attach_user_to_agency`. | that function | A branch-only manager can detach. Asymmetry with its own sibling. |
| B10 | `set_branch_deed_recipient` uses `users.partner_id = branches.partner_id` as "a user in this organisation", which on the agency rail is every agency. | `20261006310000:1041` | The table is vestigial: nothing live consumes it. Latent rule-2 violation that goes live the moment something does. |
| B11 | Cross-company working copies (`grp_org_v3`, `grp_partners_v2`) persist to localStorage and are not cleared at sign-out. | `src/data/orgService.ts:19`; `src/data/partnersService.ts:21`; `src/session/SessionContext.tsx:280-301` | Data at rest on a shared browser, never rendered (hydrate replaces it before paint). |
| B13 | `amend_tenancy_start` is granted to `authenticated` and commits the new date WITHOUT the deed lifecycle, so the edge function's confirm/archive/void/reissue is advisory. No `tenancy_amended` activity row either. | that RPC; `amend-tenancy-start/index.ts:69,100-110` | The direct-PATCH half died with round 7's A. The RPC half needs the lifecycle moved server-side, which is a build. |
| B14 | On a group with more than one agency, `AgencyHome` passes `orgId=null` to the statement panel, so an admin reading group X's "What they earned" sees other agencies' totals under X's heading. | `AgencyHome.tsx:1251-1256` | Opndoor-facing, and the same root as B1. Fix them together. |
| B15 | `SEES_COMMISSION` is a module global defaulting to TRUE, set only by `resolve()` and reset by neither `signOut()` nor `refresh()`. | `src/data/types.ts:39,59,64` | A Director demoted mid-session keeps a client that believes it may draw commission. The SERVER refuses either way, so this is a stale screen and not a leak. |
| B16 | `VITE_ADDRESS_LOOKUP_KEY` is inlined into the bundle and sent as a query-string `api_key` from the public /apply page. | `src/data/addressService.ts` | Currently commented out, so not live. A public billable credential the moment it is set. |
| B17 | `create-referral`'s `verify_jwt = false` in `supabase/config.toml:137-138` contradicts its own header comment saying true. | that config | Settle which is intended. The function does its own auth, so this is a discrepancy to resolve rather than a hole found. |
| B18 | No executed-deed immutability at table level independent of the grant: `deed_state`, `pandadoc_document_id` and the deed timestamps can be co-edited to null while `status` is downgraded. | `applications` | Closed in practice by round 7's A. Worth a constraint if any write path to `applications` ever returns. |
| B20 | A fee basis is stored as `4.35` with the unit `months`. 4.35 is the number of WEEKS in a month, so the pair reads as 4.35 months -- four months' rent -- where the fee is one. | `resolve_fee`, standard agreements | Found by the walk. Not live: the fee itself is right, and the only renderer, `feeBasisLabel`, checks `is_standard` first and says "one month's rent". It is a quantity and a unit that disagree and only agree because nothing reads them together. Anything NEW that reads the pair -- a statement line, an export column, an API field -- states it wrongly. Not fixed here because it means touching the number every fee derives from. |
| B12 | `definerAllowlistCoverage` counts a function as covered if its NAME appears in any pgTAP file; it does not require the test to assert a refusal. | `src/data/definerAllowlistCoverage.test.ts` | A weakness in a check, not in the product -- but it is how round 6's H3 would have passed the ratchet. Worth tightening. |
| B21 | **`cron.job_run_details` grows forever and nothing prunes it, and `cron_health()` scans it with an unindexed range join.** 57,240 rows / 34 MB on dev, growing ~2,160 a day; `cron_health()` measured at a **20.3 s mean, 24.1 s max**, against an 8 s `statement_timeout` for `authenticated`. | `cron_health`; `cron.job_run_details` (only index is the `runid` primary key) | Found by 22b. **The first performance finding in this whole effort** -- every round asked whether the guards were right, none asked what they cost, and the answer turns out to be that the guards are free (0.3-2 ms) and the ops housekeeping is not. Not blocking because it degrades one admin-only screen (Health) rather than any customer path, and every step of the Regent and supplier journeys measured in single-digit milliseconds. **But it applies to LIVE as well as dev** -- the same jobs run there and have run longer -- so the Health screen will eventually exceed the timeout in production and stop working. Two cheap fixes, either sufficient: a retention job (the `rate-limit-cleanup` hourly job is the existing pattern) and/or an index on `(jobid, start_time)`. |

---

## Needs Matt

Matt's instruction of 2026-09-29: "Do not decide anything else on Matt's
behalf." So everything below is open, and the build stops at the point that
depends on it. Each says what it blocks, so nothing waits unnecessarily.

### NM-F. A report per supplier and per agency. Proposal, asked for by walk-fix item 15.

Matt: *"What he wants is to see the reports for each customer: each supplier
and each agency... write a short proposal for how Matt gets a report per
supplier and per agency (for example from each one's own page), and wait for
his answer."*

**The proposal, in one line: delete the scope picker, and put the report on
each customer's own page as a Reporting tab.**

Why that and not a better picker:

- **The pages already exist and are already the right shape.** The agency page
  and the supplier page both carry tabs today (Overview, People, Commission,
  Referrals, Integration). A Reporting tab is a sixth, in a place that already
  answers "which customer am I looking at" by being that customer's page. No
  picker can answer that as clearly, because a picker's answer is a line of
  text somewhere else on the screen.
- **It removes the class of bug, not an instance.** All four faults item 15
  lists -- the dead control, the missing suppliers, the doubled Northgate, the
  stale "All partners" header -- exist because one screen has to name every
  customer in a list and stay in sync with the estate. A per-customer page
  never builds that list.
- **Reporting is already scope-aware server-side.** The reporting figures are
  computed per party by the same isolation filters the rest of the product
  uses, so a per-customer page asks a question the server already answers.
  This is a move, not a rebuild.

**REVISED after walk-fix item 20.** The first draft of this proposal said the
per-customer page would lose side-by-side comparison, and asked Matt whether
that mattered. Item 20 answers it: *"every supplier and every agency, side by
side (referrals sent, fees collected, deeds issued, commission payable)."* So
comparison matters, and the proposal is now **both halves, not one**:

1. **One estate-wide Reporting page, with no picker**, whose centre is a
   **table with one row per customer** -- every supplier and every agency
   together -- and Opndoor's four measures as the columns. That is item 20,
   and it is also the answer to "I want to see the reports for each
   customer", because a table of all of them IS the per-customer view when
   what you want is to compare.
2. **A Reporting tab on each agency and each supplier page**, for the times
   the question is about one customer in depth rather than all of them at a
   glance. Same figures, same definitions, reached from the page that already
   names the customer.

The picker is deleted either way. It exists to answer "which customer", and
both halves answer that without asking: half 1 shows all of them at once,
half 2 is on the customer's own page.

What is still open, and the only thing I need before building:

- **Does the agency-side reader get the Reporting tab too**, or is it
  opndoor-only? An agency Director seeing their own agency's report is a
  different feature from an opndoor admin seeing everyone's, and it has a
  commercial-terms question inside it (rule 3: only a Director sees
  commission). Half 1 is opndoor-only whatever the answer, because it names
  every customer.

**Blocks:** walk-fix items 15 and 20, and the "simpler alternative" one-liner
item 7 asks for -- because if the picker is deleted, item 7's fix is throwaway
work. Item 7's own fault, the dead control, is shared with this screen, so
answering this decides whether item 7 is worth fixing at all.

### NM-G. What period should Home's Direct signups cover? Asked for by walk-fix item 25.

**Confirmed from the code: it is ALL TIME today.** Three lines settle it.
`src/pages/Home/Home.tsx:36` builds `scopeOpts = { role, scope: ALL_PARTNERS }`
with no period in it; line 75 passes that straight to
`countByStatus({ ...scopeOpts, channel: 'Direct' })`; and
`applicationsService.ts:204` is

```
function inPeriod(r, range?) { if (!range) return true; ... }
```

No range is ever supplied, so every direct application ever created is
counted, in whichever stage it now sits.

**Two consequences worth seeing before choosing.** First, the four numbers
are a mix of the transient and the permanent: "Awaiting decision" empties as
work is done, but "Deed issued" only ever grows, so the panel's shape drifts
from a queue into a lifetime tally. Second, when a period IS supplied
anywhere else in the product, the bucketing is on the SENT date
(`sentTsOf`), which for a direct signup is not the date they signed up. If a
period is chosen here, which date it filters on is a second decision, and
sent-date is probably the wrong one for this panel.

**The choice Matt asked to be offered:**

| option | what the panel becomes |
| --- | --- |
| **Today** | a genuine day's worklist; "Deed issued" means issued today |
| **This week** | the same, at the cadence direct volume actually arrives at |
| **This month** | matches the commission and statement cycle |
| **All time** | what it does today: a lifetime funnel, honest once labelled |

**My recommendation, for Matt to accept or reject: this week.** Home's own
title is "What needs a person today", and three of the four stages are
things a person acts on. All time makes the two right-hand stages grow
forever and stop meaning anything; today is too narrow for a rail that
Home's own code comments say is empty most days ("most days opndoor has no
direct tenants at all"). A week is the smallest window in which the panel is
usually non-empty and still current.

**Whatever is chosen, the label has to say it** -- that is item 25's actual
requirement, and it holds even if the answer is "leave it as all time".

**Blocks:** walk-fix item 25's Direct signups half only. The four queue tiles
can be labelled "waiting now" without this answer, because they already are
current-state counts.

### NM-A. Who pays the guarantee fee, and how they pay it

**This is the one that cannot be patched later.** If an agency (or a supplier)
pays the fee instead of the tenant, how do they pay?

- **By the same tokenised payment link the tenant would get, addressed to
  them.** Everything that exists already works: the link, the card page, the
  receipt, the automatic deed. Nothing new to build, and no new way to mark
  something paid.
- **By monthly invoice.** This is a different product. There is no invoice
  anywhere in the system, no record of what a party owes us, and no way for
  anybody to mark an invoice paid. All three would have to be built, and the
  last one is a privileged "this is paid" button, which is the exact shape of
  the fault we just closed on the live system.

**What it blocks:** the whole three-way "paid by" switch. I will build the
switch so it records WHO pays, which is needed either way, and stop before
anything that decides HOW they pay. Marked in the code where it stops.

### NM-B. The four internal alerts that do not exist

Unchanged from NM-2b below, repeated here because it is a decision, not a
finding. Four of the alert types named in the internal-routing instruction have
nothing that raises them: an application awaiting a decision, reconciliation
items, new applications, and successful payments. The routing screen is built
for the types that do exist.

- **Build all four**, and accept that "new applications" and "payments" fire on
  every single referral and every single payment.
- **Build none**, and the four stay absent from the screen.
- **Build two as daily digests** (awaiting decision, reconciliation items) and
  leave the other two, which is what I would suggest if asked: both are
  backlogs, and a backlog is a daily list rather than an interruption, while a
  message on every payment trains people to ignore the ops inbox.

**What it blocks:** nothing. The routing screen is finished and works for
everything that exists today.

### NM-C. The nine supplier-commission questions

From the scoping of Q-05. Each blocks only the part named.

1. **"Paid by" means which three parties?** Tenant, agency and supplier are the
   three that have a rate, a mailbox and a commercial relationship with us.
   There is a landlord email address on the record, but no money code
   anywhere refers to it. If the third party is meant to be the landlord, the
   switch is a different switch. *Blocks: the switch's options.*

2. **If the agency pays the fee, is it gross or net?** Gross means they pay us
   the fee and we pay them their commission on the 15th as usual. Net means we
   bill them the fee minus their commission and nothing moves on the 15th.
   Gross changes no arithmetic; net changes the order in which we apportion and
   round, which is currently pinned to the penny by a test. *Blocks: the
   statement and the settlement for agency-paid work.*

3. **Does the supplier commission editor set the supplier's own cut only, or
   the supplier's cut and the agency rate underneath it?** The current form
   edits both. If the answer is "supplier's own cut only", I am removing a
   control that works today, so I would rather be told than assume. *Blocks:
   the editor's shape.*

   *Also waiting on this, found while building amendment 3:* a route-scoped
   volume counter now works in the database but cannot be chosen anywhere.
   The existing agreement editor only ever edits an agency, a group or a
   branch, and a route counter is only valid on a supplier-level agreement,
   so adding the option to that editor would put a control on screen that the
   database refuses. It belongs on the supplier commission editor, which is
   what this question is about.

4. **Does the 50% cap include the supplier's cut?** Today a supplier on 60%
   with an agency on 10% underneath passes the cap, because the cap only looks
   at the agency side. It is one fee, so a cap that sees half of it is not
   really a cap, but raising it will refuse deals that are currently accepted.
   *Blocks: whether the editor refuses those combinations.*

5. **Does a paid supplier referral pay both the supplier and the agency under
   it?** I have assumed yes and purely additive, because taking away income an
   agency already earns is a commercial change nobody asked for. *Blocks: the
   payee list on supplier work.*

6. **The two-part supplier statement: a summary document plus separate
   per-agency spreadsheets, or one document with sections?** The document
   generator we have does exactly one title, one table and one total, and its
   own notes say not to grow it into a general-purpose library. Separate
   spreadsheets need nothing new. *Blocks: the statement's format only.*

7. **Should referrals created through the supplier API start charging the
   agreement's fee?** They currently charge nothing but the rent, ignoring any
   negotiated deal. On the standard deal this makes no difference at all. It
   only bites once a supplier has negotiated something. *Blocks: nothing
   visible today; it is a correctness question for the first negotiated
   supplier deal.*

   **Measured 2026-09-29, when the final review round reported it as a HIGH.**
   It is real and it is not high, and the difference matters because fixing
   it would be answering this question on Matt's behalf. `create_referral_api`
   resolves neither the fee nor the rates: it reads `partner_rate` and
   `agent_rate` straight off the PARTNER row, and writes no `fee_amount` at
   all. So an API application carries a null fee and flat rates.

   Why it is not live: every partner-scope agreement on dev is `is_standard`,
   and on standard terms `resolve_fee` returns exactly the rent -- 1500 on a
   1500 rent -- which is precisely what every reader's `fee_amount ??
   monthly_rent` already produces. The two agree today by arithmetic, not by
   luck. They part company the day a supplier negotiates anything, and then
   the API charges the wrong number silently.

   So: not fixed, severity corrected to latent, and it is now a stronger
   reason to answer this question than it was before.

8. **Does a refunded application still count towards a volume tier?** It does
   today, while the statement excludes refunds, so "paid" means two different
   things in one pricing chain. Nobody is on a volume tier yet, so either
   answer is free right now. *Blocks: the volume counter's definition.*

9. **A data question, not a code one.** One supplier is recorded as being on
   the agency estate. That combination means any supplier rate typed for them
   is saved and then paid to nobody. Is that record a supplier, or an agency
   that was set up as a supplier by mistake? *Blocks: nothing; the editor will
   warn when it sees the combination either way.*

### NM-E. ANSWERED, 2026-09-29. Matt's words, verbatim:

> Answers to the six questions:
> 1. Keep the settlement date on the statement. Drop only the two things I named.
> 2. A supplier's Management sees their own commission rates and statements.
> 3. Reporting and Applications share one remembered scope choice.
> 4. "Admin view only" on Referred by means that section only; agencies keep their own form as it is.
> 5. Leaderboard control placement and the audit-table workaround: your call, record what you chose.
>
> Still waiting on me, leave parked: how an agency pays the fee itself, and whether to build the four missing alerts.

**What each settles, and what it unblocks.**

| # | answer | what it changes |
| --- | --- | --- |
| 1 | Settlement date stays. | The statement header drops exactly two labels, Payee level and Currency, and keeps Settlement date and Commission type. Unblocks item 7 (F3). |
| 2 | A supplier's Management sees their own rates and statements. | `SUPPLIER_LEVELS` is a pair, Management and Referrer, and Management carries the see-commission capability. Unblocks the supplier People tab's invite and the Commission tab's figures. Note this is about a supplier seeing its OWN terms; it does not answer NM-C 3, which is about what the editor may SET. |
| 3 | One remembered scope choice, shared. | The selection moves into the session rather than living twice. Changes item 6 from two independent selections sharing a control to one selection shared by both pages, and means Applications stops overriding admin scope to all partners. |
| 4 | "Admin view only" is the SECTION. | No route guard changes. An agency negotiator's own new-application form is untouched; the Referred by block is drawn for admins only. Unblocks item 9. |
| 5 | Mine to choose, and recorded below. | See "Decisions taken on the two Matt handed back". |

**Still parked, not to be built:** NM-A (how an agency pays the fee) and NM-B
(the four alerts nothing raises). NM-C's nine remain unanswered and continue
to bound the supplier COMMISSION EDITOR's shape: the Commission tab is built
with today's two-field form lifted unchanged, which decides nothing.

### Decisions taken on the two Matt handed back

He asked me to choose these and say what I chose.

| # | Decision | Reasoning |
| --- | --- | --- |
| D14 | The referrer leaderboard control goes on the supplier's **People** tab, not Commission. | It governs what a supplier's referrers SEE of each other, which is a question about people and visibility, not about money. Nothing on it is a rate, a band or a statement. Putting it on Commission would also hide it behind the see-commission capability, and after answer 2 that is exactly the set of people it is not about. |
| D15 | A group selection is audited as kind `agency` carrying the group's name and the word "group"; rail-wide and Everything selections are not audited at all. | The audit table admits only `partner` and `agency`. Widening it is a migration to the audit trail of who looked at whose data, and I am not making that change to record a UI convenience. "Everything" and a whole rail are not a view of any one party, so there is no party to log; logging them would put rows in a table whose column means something else. If the audit needs to distinguish a group later, that is a migration made deliberately rather than as a side effect of this screen. |

### NM-D. One hole on the live system the hotfix deliberately does not close

Found while scoping the hotfix, measured, and left open on purpose because
closing it safely is bigger than a hand-applied paste.

**What it is.** The same "a guard that cannot tell who you are does not
refuse" fault, in `create_referral` and eight org/contact functions. The
hotfix closes twelve functions by making `app_role()` answer "nobody" instead
of "I don't know". These nine do not test the role at all: they test the
caller's *company* (`if not (is_admin() or pid = app_partner())`), which is
also unknown, and so also skips the refusal. A sign-in with no user profile
can create referrals, and can change an agent contact's email address, which
is where an executed deed is sent.

**Why the same trick does not work.** Making `app_partner()` answer a
placeholder instead of NULL would fix all nine in one line. It would also
break production: `create_referral_target` uses `pid is not null` to tell a
partner user from an opndoor admin, and an opndoor admin's company is
legitimately empty. Every admin would be routed down the partner branch and
would create agencies belonging to a company that does not exist. I checked
this before proposing it, and it is why the hotfix stops where it does.

**The options.**

- **Leave it until cutover.** The new version already fixes it, from the other
  direction. The exposure in the meantime is: somebody would need a live
  sign-in, with MFA, that has no profile attached. The two accounts of that
  shape were deleted on 2026-09-29, and creating another one needs access to
  the Supabase dashboard.
- **Fix it now, as a second hotfix.** It means pasting nine complete function
  bodies rather than one line, each of which must be copied exactly. That is a
  larger and more error-prone thing to do by hand on a live system, and it
  wants its own rehearsal first.

**My reading, offered not applied:** the first, because the way in was closed
this morning and the second option's risk is the paste itself. But it is a
judgement about how exposed Opndoor is willing to be for a few days, which is
Matt's call and not mine.

### NM-1b. RESOLVED. Regent gets both bands on the branch. Corrected 2026-09-29.

**This was my error, and Matt caught it.** I recorded that Regent's 5-week /
25% band was unreachable because a joint tenancy is refused for anyone
pre-referenced, citing `20261003110000_joint_is_agent_rail_only.sql:55`. That
guard was replaced **the next day** by
`20261004100000_estate_and_journey_are_two_questions.sql` and superseded six
times after that. I quoted a dead rule and its dead error message as current.

**The mistake underneath it**, which is the part worth keeping: I treated
"pre-referenced" and "on our agent estate" as one axis, so an agency had to be
one or the other. They are two questions, and the superseding migration is
named after exactly that.

| | question | read from | property of |
| --- | --- | --- | --- |
| the journey | `referencing_mode` | branch, then agency, then partner | the WORK: are these references already done? frozen onto each application |
| the estate | `is_agent_estate(branch, route)` | the ROUTE PARTNER only | the RELATIONSHIP: is this branch one of the agencies we onboarded? |

An agency can be both, and Regent is: under the house partner
`opndoor-agents`, so on the estate, and `pre_referenced_open`, so
pre-referenced. A joint tenancy needs an agency of ours to sit under. It has
one.

**Proved, not just re-read.**
`supabase/tests/a_pre_referenced_agency_of_ours_may_refer_a_pair.test.sql`, 12
assertions. A Regent-shaped pair at £2,400 goes through
`create_joint_referral` and prices at **five weeks, £2,769.23, 25%
commission**, with each application still carrying the pre-referenced journey
and the two fees summing to the whole with nothing lost to rounding twice. The
same file asserts one tenant at three weeks / 20%, and that a genuine supplier
is still refused.

**Nothing to build.** The test passed first time against the code as it
stands, which is what Matt said it would do.

**The one thing that does still need saying, and it is a shape choice not a
code gap.** The original question was "Regent onboards as **their own
partner** on the pre-referenced rail". In that shape the route partner is
Regent's own pre-referenced partner, `is_agent_estate` is false, and joint
tenancies really are refused, so the 5-week band really would be unreachable.
That case is asserted too. So Regent must be onboarded as an **agency on the
Opndoor estate**, under `opndoor-agents`, carrying
`referencing_mode = 'pre_referenced_open'` -- which is the shape that was
built and walked on dev. It is not a decision that blocks anything; it is a
note for whoever does the onboarding.

**What is unchanged:** everything about `main`. `main` has no
`referencing_mode`, no joint tenancy, no fee basis and one rate per partner,
so it delivers neither band. `docs/REGENT-ON-MAIN.md` sections 1 to 4 stand;
its sections 5 and 6 carry the same correction as this one.

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

**Status: done**, except the four notifications the instruction names that
the platform does not send at all -- see NM-2b. The inventory is committed:
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

**Status: DONE, 2026-09-29. `docs/HUBSPOT-CONSEQUENCES.md`. Still gates NM-2
(fold 17), which is the point of it.**

The headline, so it is not buried: **fold 17 is not a reversal.** There is no
inbound path from HubSpot anywhere in the codebase, the README already calls
the portal the system of record, and the company name in HubSpot is already
overwritten by the portal on every sync. What is described as one decision is
five, three of which need nothing from Matt.

Three things the report found that are wrong TODAY, independent of fold 17:

- **A HubSpot outage over about half an hour destroys events rather than
  delaying them.** The code cannot tell an outage from a bad record, parks the
  event after enough retries, and its own alert says the event will not arrive
  until replayed -- and there is no replay path.
- **Two of the three rails never produce a referral event**, so on dev 31 of
  34 applications would reach HubSpot as anonymous records with no channel.
- **The sandbox gate fails open** when livemode is missing rather than false,
  and nothing in the suite asserts it.

And one thing that does not exist on production and would be CREATED by
shipping this branch: the commission rate pushed to each HubSpot company is
the ROUTE's rate, which is correct on main because main has no negotiated
agreements, and wrong for several agencies the moment this branch lands --
Regent among them. Not a reason to delay the branch; a reason to fix the
pushed number before anything is built on top of it.

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

**Status: DONE, 2026-09-29 (`5497a6a`).** Both halves turned out to be BUILT
already; what was missing was the tests, and this file was stale in saying
otherwise.

Climber of the week has nine assertions, and the one that matters is that
the same function asked by two different readers about the same week returns
two different correct answers -- the agency reader gets their own agency's
riser, the group reader the best across both they hold. No
partition-by-partner implementation can pass both, which is the defect the
function exists to fix. Proved non-vacuous by breaking it three ways.

The Team tickbox already had five assertions and all five were about whether
the control is DRAWN. A control that renders perfectly and is wired to
nothing passed every one of them. Two more cover the write and the Negotiator
row.

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
