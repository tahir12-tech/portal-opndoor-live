# QUEUE

## Small items done

Everything small from the list, in the order Matt sent it. One commit each,
full suite and drift after each, every edge function deployed to dev.

- A Developer's "Sees" reads "Dev Centre and API (no commission)" (already
  shipped; verified tonight on both people lists).
- Every email link lands on the tab that person signs in on (`882abea`).
- The deed warning follows the branch, everywhere it appears, and the agency
  banner is Matt's sentence (`40f9b9a`).
- Applications has a "Referred by" column (`48a0e24`).
- The rent reads "Rent to be guaranteed" until the deed is issued (`d61141d`).
- The League says what each column is, "Change this week" replaces "7d", and
  "Agency referral" is off the header line (`4a690d8`).
- One address, one fee name, one date format on the tenant side (`bf5a643`).
- The deed count is of signatures, not of the tenant's place in the list, and
  the tenant's copy says the insurance sentence once (`846db61`).
- The fee-paid email says how many of the tenants have paid (`8e3d1ab`).
- The landlord gets one email with every signed deed, and no reminder nobody
  sends (`175c19a`).
- A corrected deed says it is a correction, the correction page names every
  tenant, and a corrected deed gets delivered at all (`5b96bea`).
- Money to the penny, the payment link beside Copy, "both tenants" (`1811be7`).

Three of these turned out to be bigger than the wording: the deed count was an
ordinal read as a count, the landlord email promised a reminder nobody sends,
and the corrected deed would have been signed and never sent, because the
one-delivery guard I added earlier in the evening could not tell a correction
from a duplicate.


## THE NIGHT'S ORDER, 2026-10-01 (verbatim). THIS IS THE PLAN UNTIL MORNING.

> I'm going to sleep; work through the night without waiting for me.
>
> 1. First, everything small in QUEUE.md (bugs and wording), in the order I sent it, so I can check them shortly. When they're done, write "Small items done" at the top of QUEUE.md with a one-line list of what changed.
>
> 2. Then the bigger screens (shared people table, Director's Reporting, application detail, New application with the office first, notifications panel), in the order I sent them.
>
> 3. Then one agency record across routes. How it must work, using Frost as the example:
>    - Frost is one company in the system: one set of offices, people and branch contacts.
>    - When Frost's own staff sign in and refer, that's the direct route: Frost's own deal with Opndoor, Opndoor pays Frost, and Frost sees those referrals and their commission.
>    - When Rightmove refers a Frost tenant, that's the supplier route: Rightmove's deal, commission handled the Rightmove way (to Rightmove, or to Frost directly if Rightmove's "Opndoor pays the agents directly" switch is on). The signed deed still goes to Frost's branch contact. For now Frost's staff do not see Rightmove-route referrals in their login.
>    - Separate deals, volume counters and statements per route; League and Reporting show Frost as one agency, split by route where it matters.
>    Migrate dev's existing data so nothing changes for any current agency. Keep the duplicate-name warning until this is done.

**SUPERSEDED** by "SEPARATE ESTATES" below, sent the same night. Phase 3 is
not built as written: there is no one agency record across routes.
>
> Rules: dev only, never touch live, never push. Deploy edge functions to dev with the npx command after any function change. Full tests and drift after each item, commit each separately. If something needs a decision from me, don't guess: note it in QUEUE.md under "For Matt in the morning" and move on. In the morning, give me a short plain-English summary: what's done, what's left, and any decisions waiting for me.

> 4. Then: the admin Agencies tab lists only agencies with a direct relationship with Opndoor. Agencies that only come through a supplier appear on that supplier's page, in an "Agents" tab, not in Agencies. An agency on both routes (like Frost) appears in both places as the same company.

**SUPERSEDED** by "SEPARATE ESTATES" below. The Agents tab survives in a
different shape: a supplier's page gets an "Agencies" tab holding that
supplier's own estate, and admin's Agencies tab holds Opndoor's clients
only. The same company in both places is two records, not one.

## SEPARATE ESTATES: THE CORRECTION TO STEPS 3 AND 4 (correction, 2026-10-01, verbatim). THIS REPLACES BOTH.

> CORRECTION to steps 3 and 4 of tonight's instructions; this replaces both. Do NOT build one agency record across routes or any membership table. Instead, separate estates:
>
> - Opndoor's estate: agencies that are Opndoor's own clients (like Regent). They have logins, users, branches, their own deals, and Opndoor pays them. Admin's Agencies tab lists only these.
> - Each supplier's estate (e.g. Rightmove): the agencies and branches that come through that supplier. They never have logins. On admin's view, they appear in an "Agencies" tab on that supplier's page, not in admin's main Agencies tab. The supplier's own staff keep seeing their agencies in their own Agencies tab, as now.
> - The same real company can exist in both estates (Frost as Opndoor's client and Frost under Rightmove). They are two separate records that never link, share nothing, and never show each other's data. Remove the duplicate-name warning across estates; keep it only within one estate.
> - Supplier-route data belongs to the supplier only. Frost's own login never sees anything from Rightmove's estate: no referrals, no commission, no statements. If Rightmove's "Opndoor pays the agents directly" is on, that commission is paid to the Rightmove-estate agency and its statement goes to that agency's contact email, never into any login.
> - Signed deeds on supplier referrals go to the branch contact in the supplier's estate.
> - Check commission, volume counters, League and Reporting treat the two estates separately, and remove any code that assumes an agency exists once across routes. Nothing changes for any current agency on dev.
> - Remove the after-launch item about agencies seeing their supplier-route referrals; that's now never.
>
> When done, set up a test "Frost" in both estates on dev, refer once each way, and write in QUEUE.md exactly what each screen showed (admin Agencies, admin Rightmove page, Frost's login, Rightmove's login), as a checklist I can repeat. Steps 1 and 2 and the rules are unchanged.

- **Phases 3 and 4 above are dead.** No `agency_routes` table, no shared
  record, no join. The model is the one the database already has:
  `agencies.partner_id` IS the estate, and two estates means two rows.
- That makes most of phase 3 a DELETION job rather than a build: find and
  remove the places that assume an agency exists once across routes. The
  `AgreementView.volumes` comment ("an agency exists once and is never
  duplicated per supplier, so an agency under two suppliers is one party
  with two counters") is the first of them, and the cross-estate
  duplicate-name warning is the second.
- The checklist Matt wants at the end is a test fixture plus four
  screenshots described in words. It goes in this file.

### SEPARATE ESTATES: DONE, 2026-10-02

Five commits. Full vitest and pgTAP after each, drift clean after each.

- `b054ae0` **Two estates, and the same company can be in both.** The
  client was the half that assumed one agency across routes. An origin
  selection is now `agency:<estate>:<name>`; `agencyOffices`,
  `showsOffices` and `officeLabel` take the estate and every caller that
  knows it passes it (the League, the list, Agencies & branches, the
  record, the agency's own page). `ApplicationDetail` gained a partner
  SLUG beside its partner NAME, because it had nothing to pass. Admin's
  Agencies tab filters out supplier estates; a supplier's page gained an
  Agencies tab holding its own. The older `agency:<name>` selection still
  matches by name, because those are in links people have saved.
- `841e499` **The same name in two estates is not a duplicate.**
  `duplicate_agency_groups()` grouped by name across the whole table and
  marked the cross-partner groups urgent. It now groups by partner AND
  name, and `cross_partner` is dropped rather than left always false. The
  reconciliation queue an admin actually reads has always matched within
  one partner, so nothing on screen changed. Also: the client's PREDICTION
  of where a deed will go resolved the contact by name alone, so with two
  Frosts the record could name the other company's mailbox. The SEND was
  always right (`deed_delivery_target` reads agency_id and branch_id).
- `5a58113` **Three delivery columns went on the table without a grant.**
  Not an estates item. `deed_delivered_at`, `deed_delivered_to` and
  `deed_resent_at` were added by 20261007320000 and never granted, and the
  grant on `applications` is a denylist. Nothing was visibly wrong, which
  is the dangerous part: the next `select *` by a signed-in role returns
  "permission denied" and a blank screen. Found by running the WHOLE pgTAP
  suite rather than the files the night's work touched.
- `eb5682e` **Two note refusals now stop earlier than they did.** Also not
  an estates item. Since notes became the shared record,
  `add_application_note` is SECURITY INVOKER, so a caller who cannot see
  the application stops at "application not found" instead of a guard's
  42501. Same claim, corrected expectation.
- `5716208` **A supplier-estate statement reaches no login.** The agency
  arm of `commission_statement_recipients` resolves people through
  `user_scopes` and never asked which estate the party was in, so a
  Management user positioned on one of a supplier's agencies was addressed
  beside the finance address. That arm now excludes a supplier estate. New
  predicate `is_supplier_estate(uuid)`, the server twin of
  `partyIsSupplier`.

**Checked and already correct, so nothing was changed:** the League has
always grouped by partner and name together (`keyOf`); commission lines
hang off `org_id`, an agency ROW, so the same name in two estates is two
sets of lines; `agreement_volume` counts by `agency_id`; the New
Application picker already resolves the chosen agency's own partner and
passes it to `origin_is_agent_estate`, `origin_referencing_mode` and
`referral_fee_preview`. `whereTheyWork` still asks by name alone on
purpose: it is the line under a PERSON, and only Opndoor's estate has
people.

**The after-launch item is removed.** Phase 3 said "For now Frost's staff
do not see Rightmove-route referrals in their login", which implied a
later change. There is no later: two estates never show each other's
data, and it is now asserted in
`supabase/tests/two_estates_never_meet.test.sql`.

### THE FROST CHECKLIST, to repeat on dev

Kestrel Lettings is dev's supplier and stands in for Rightmove; dev has no
Rightmove partner. The fixture is `docs/reference/frost-both-estates.dev.sql`
and is idempotent: re-running it rebuilds everything, and its delete block
alone removes the lot. Nothing it creates touches an existing row. It is a
dev fixture, not a migration, and is deliberately not in
`supabase/migrations/`.

What it creates:

| | Opndoor's estate | Kestrel's estate |
|---|---|---|
| Agency | Frost Partnership (`...a001`) | Frost Partnership (`...a002`) |
| Office | Frost Mayfair | Frost Mayfair |
| Branch mailbox | mayfair@frost.example | mayfair@frost-via-kestrel.example |
| Finance email | finance@frost.example | finance@frost-via-kestrel.example |
| Login | director@frost.dev.test / `Frost!Dev2026` | none, by design |
| Referral | GR-FROST-OURS, paid, £2,400 rent | GR-FROST-KES, paid, £2,400 rent |
| Commission line | £240 to the Opndoor-estate Frost | £240 to the Kestrel-estate Frost |

Both offices are called "Frost Mayfair" on purpose. Anything that resolves
an agency or a branch by name alone picks the wrong one, and the two
mailboxes are how you see it happen.

**1. Admin, Agencies.** Six rows: Harbour Lets, Frost Partnership,
Harborview Lettings, Northgate Lettings, Regent's Lettings, Southbank
Residential. Frost appears ONCE, with one office (Frost Mayfair). The
Kestrel-estate Frost is not on this screen at all.

**2. Admin, Kestrel Lettings → Agencies tab.** Two rows: Kestrel Lettings
(Kestrel Central, Kestrel Riverside) and Frost Partnership (Frost
Mayfair). Headed "Kestrel Lettings's agencies". This is the only admin
screen that carries it.

**3. Frost's own login** (director@frost.dev.test, Director). One agency:
Frost Partnership, under opndoor-agents. One application: GR-FROST-OURS.
One commission line: £240, against GR-FROST-OURS. One person on Team:
themselves. GR-FROST-KES is absent — not greyed, not empty, absent — and
so is its £240, although that line carries the same agency NAME.

**4. Kestrel's own login** (director@kestrel.dev.test, Director). Two
agencies, both Kestrel's: Kestrel Lettings and Frost Partnership. Two
applications: GR-22162 (sent) and GR-FROST-KES (paid). Nothing of
Opndoor's Frost.

**5. The deed, and this is the one worth checking by hand.** GR-FROST-OURS
goes to director@frost.dev.test (the referrer, on our own estate's
ladder). GR-FROST-KES goes to mayfair@frost-via-kestrel.example, the route
contact in Kestrel's estate — never to mayfair@frost.example, which is the
same office name in the other estate.

**6. The statement.** Our Frost: director@frost.dev.test and
finance@frost.example. Kestrel's Frost: finance@frost-via-kestrel.example
and nothing else. No login is ever addressed for a supplier-estate agency.

**7. The duplicate report.** `duplicate_agency_groups()` returns nothing.
Two Frosts in two estates are not a duplicate.

**8. The statement run, which is where the split is easiest to see.**
`commission_statement_payees('2026-09-01')` returns TWO payees called
Frost Partnership, £240 each, one per estate, plus a partner-level line
of £600 for Kestrel (its own cut of GR-FROST-KES). Two payees of one
name is the right answer: they are two companies as far as the book is
concerned, and each gets its own statement.

That eighth check cost one test assertion. `a_supplier_gets_its_own_statement`
counted EVERY partner-level payee in that month and expected none, which
held only because dev had no supplier with a paid referral in September.
Kestrel now has one. The claim the case makes is about the HOUSE agency
partner never becoming a supplier payee, so it now asks that instead of
asking nobody is.

Measured on dev as each user, through the queries those screens run
(`agencies` as hydrated by the browser, `applications` and
`application_commission_lines` under RLS, and the two resolvers the send
path and the statement run call). Screens 1 and 2 are also rendered, with
the same two-Frost fixture, in
`src/pages/Agencies/twoFrostsOnTwoScreens.render.test.tsx`.

## FOUR DECISIONS, 2026-10-02 (instruction, verbatim). **all four done** (`bf6a505`, `a0b25c9`, `3dbd2c1`, `45e8797`).

> Decisions:
> 1. Nobody is ever positioned at an agency or branch in a supplier's estate. A supplier's own staff sit at the supplier level only (they choose the agency and branch on each referral, but are never positioned there), and supplier-estate agencies never get logins. Enforce it: refuse any position or invite that would place someone at a supplier-estate agency or branch, and rewrite the two tests that modelled a supplier's referrer sitting at a branch to match.
> 2. A contact email is required when any agency or branch is created, in any estate, so one always exists; creating one without it is refused with a clear message. Check existing agencies and branches on dev and list any without one.
> 3. Agencies in a supplier's estate need no finance email. For now, all commission statements for a supplier's agencies go to the supplier (its statement plus the per-agency schedules), never to the agencies, whatever the "Opndoor pays the agents directly" setting. Remove anything that sends a statement to a supplier-estate agency.
> 4. Fix the three older items: remove the reminder promise from the tenant's deed email unless tenants really get that reminder; remove the duplicate "not insurance" sentences; change "guarantor fee" to "guarantee fee" in CSV exports, the activity feed and the API docs wording, but do not rename any API field or CSV column a partner's code may read.
> Deploy to dev and check there.

- Item 1 answers the first question under "For Matt in the morning" and
  reverses what I backed out: the trigger on `user_scopes` goes back in,
  the INVITE path gets the same rule, and the two fixtures that model a
  supplier's referrer at a branch are rewritten rather than worked around.
- Item 3 answers the second and goes further than the question asked: the
  fallback is not the deed contact, it is that a supplier-estate agency
  gets no statement at all. That makes `commission_statement_recipients`
  return nothing for one, and the per-agency schedules stay where they
  are, inside the supplier's own email.
- Item 4's second half has teeth: "do not rename any API field or CSV
  column a partner's code may read". The wording changes; the keys do not.

### WHAT EACH ONE CAME TO

**1. Nobody is ever placed in a supplier's estate** (`bf6a505`). Three
doors shut: a trigger on `user_scopes`, the same test inside
`assert_may_grant_position` so the INVITE refuses before it creates an
account, and a trigger on `users.home_branch_id`, which is the other half
of being placed and is what the people lists print under somebody's name.
All three raise 22023, not 42501: the rule fires for an Opndoor admin and
for postgres exactly as it fires for anybody, and 42501 is reserved for
authorisation. Nothing on dev had to move: 0 positions and 0 home
branches were in a supplier estate. The two fixtures were rewritten, not
worked around, and every assertion in both still passes at the same count
(112 and 12), because what isolates a supplier's own staff was always
`partner_id`.

**2. A contact email is required at creation** (`a0b25c9`). Four doors
create an agency or a branch and only `admin_add_agency` asked. All four
refuse now, and the forms ask rather than letting the server refuse.

> **THE BRANCH READING, which is the one judgement in it.** A branch with
> no contacts of its own uses its agency's: `effectiveContacts` has
> always done that, and the deed panel prints it as "agency default for
> X". The governing clause is "so one always exists", and under an agency
> that has a contact, one does. So a branch is refused only when its
> agency has nothing to fall back on, which is the case that actually
> leaves a deed stranded. Requiring a second address per office would
> undo the agency default rather than add to it. **If you want the
> stricter reading it is one condition in two functions, say the word.**

**What is on dev without a contact anywhere**, as asked. Two, and neither
is in a supplier estate:

| Estate | Agency | Offices | Contact |
|---|---|---|---|
| opndoor-agents | **Regent's Lettings** | Regent's Park | none, anywhere |
| opndoor-agents | **Harborview Lettings** | Brighton Marina | none, anywhere |

Every other agency has one on each of its offices: Northgate (both),
Southbank, both Frosts, Kestrel (both) and Harbour Lets. No agency
anywhere on dev has an AGENCY-level contact; every contact that exists
today sits on a branch. Nothing was backfilled: the instruction was about
creation, and Regent's is the go-live agency, so what goes in its record
is yours to say. Regent is on the agency rail, where a deed goes to the
org's own PEOPLE through `deed_people_target` rather than to a mailbox,
so nothing is broken today by its having none.

**3. A supplier's agencies are never written to** (`3dbd2c1`).
`commission_statement_recipients` answers nobody for any party in a
supplier's estate, on the whole function rather than one arm. The PAYEE
stays, because where "Opndoor pays the agents directly" is on, Opndoor
really does owe that agency the money and the settlement PDF is what
Opndoor owes out; dropping the row would make that figure disagree with
the ledger. The run skips them by a new `supplier_estate` flag and
reports them under "Went to the supplier instead", apart from "Nobody to
send to", because one is the rule working and the other is a gap to fix.
Dry run on dev for September: Kestrel gets three attachments (its own PDF
and CSV plus the zip holding Frost's schedule), Opndoor's own Frost gets
its statement, and Kestrel's Frost is listed at £240 and written to by
nobody.

**4. The three older items** (`45e8797`). The tenant's reminder STAYS,
and the "unless" is why: I raised it believing the tenant was on no lapse
list, which is true of `notification_recipients` and is not the whole
answer. `renewal-notices` adds the tenant itself, on every rail, within
30 days of the end, and both its cron jobs are active on dev. The
duplicate "not insurance" sentences are gone, keeping on the deed-to-sign
email only the half the footer does not say. "Guarantee fee" now in the
activity feed (the browser's wording and what stripe-webhook writes), the
webhook-event descriptions in both doc generators, and the export summary
labels and hints -- while the CSV column headings still read "Guarantor
fee" and `application.paid` is untouched, which the test asserts on
purpose so nobody tidies them later.

## THE CONTACT EMAIL RULE, CORRECTED (correction, 2026-10-02, verbatim). **done** (`55b981b`). THIS REPLACES DECISION 2.

> Correction to the contact email rule:
> - Supplier side (agencies in a supplier's estate): an agency email is required at creation and is the default for all its branches; a branch's own email, if set, overrides it for that branch. Signed deeds go there.
> - Opndoor's own agencies (like Regent): no email required. Signed deeds go to whoever sent the referral (plus the people already ticked to receive them, as now). The agency or a branch can optionally add an email that also receives the deed; leave it blank and nothing is missing.
> For supplier-estate agencies with no agency email, show a clear warning on the supplier's Agencies tab and list them on Reconciliation so Opndoor can add one. No warnings for Opndoor's own agencies without an email. Don't invent or copy addresses. Deploy to dev and check there.

- This narrows what I built an hour ago: the requirement was "in any
  estate", and it is now the SUPPLIER estate only. Regent and the rest of
  Opndoor's own agencies go back to needing nothing, which also answers
  the two rows I listed on dev as missing one -- they are not missing
  anything.
- And it widens one thing: on OUR estate an agency or branch email, where
  somebody has set one, now ALSO receives the deed. Today it does not:
  `deed_delivery_target` resolves the referrer and the ticked people on
  that rail and never looks at `agent_contacts`. GR-FROST-OURS proves it
  -- its branch has a mailbox and the deed resolves to the referrer only.
- "Don't invent or copy addresses" rules out the obvious shortcut of
  backfilling an agency email from a branch's, or from the first person
  on the org.

### WHAT IT CAME TO

**Required on the supplier side, optional on ours.** The four creation
doors ask the estate after resolving the partner. A BRANCH is never asked
on either side: Matt's own word is "overrides", and an override is
optional by definition. Both forms keep the field, still check its shape,
and create on a blank one.

**The deed now reaches an optional mailbox on our estate**, which it did
not. `deed_delivery_target` returns the ladder on that rail and its
second arm only runs when the ladder is EMPTY, so an address set on one
of our agencies was stored, shown and never written to. GR-FROST-OURS is
the proof: its branch holds mayfair@frost.example and the deed resolved
to the referrer alone. A third arm adds it beside the ladder, deduped
against it. The supplier rail is untouched and still one address.

**The warning changed subject, not just scope.** It asked "is any deed
stranded"; it now asks "has this agency got the default", in a supplier's
estate only.

> **Worth knowing, because it looks like a regression and is not.**
> Kestrel Lettings is reported again. It is the shape you complained
> about yesterday: no agency address, a mailbox on each of its two
> branches. Under the old rule that was a false alarm, because nothing
> was stranded. Under yours it is the thing to fix, because the agency
> email is the default and the next office added under Kestrel would
> inherit nothing. So the row no longer says "a deed cannot be issued",
> which was the untrue part. It says **"No agency email · nothing
> stranded today, but the next office would inherit nothing"**, and the
> genuinely stranded case says how many branches instead. If you would
> rather Kestrel stayed quiet until something is actually stranded, it is
> one condition in `agencyContactState`.

**Where it shows.** The agency row and the page banner on the Agencies
screen, the same row on the supplier's page under admin, and a new
Reconciliation tab, "Supplier agencies with no email", reading
`supplier_agencies_without_an_email` (staff-only). On dev that tab lists
Kestrel Lettings and Kestrel's Frost Partnership, each with every office
covered. Nothing of ours appears anywhere, and no address is suggested
for promotion.

**This also withdraws the list I gave you earlier today.** Regent's
Lettings and Harborview Lettings were reported as having no contact
anywhere. They are Opndoor's own, so under the corrected rule they are
not missing anything and nothing warns about them.

## HOME'S RECONCILIATION COUNT MISSES THE NEW TAB (bug, 2026-10-02, verbatim). **done** (`f1f98e1`).

> Home's Reconciliation count shows 0 while the "Supplier agencies with no email" tab lists two. Include those in the Home count and say what they are, e.g. "2 supplier agencies need an email".

- Reported immediately after the tab shipped, which is the shape of it: a
  new kind of work was added to Reconciliation and the tile that counts
  Reconciliation was not told. The tile is the thing that gets somebody to
  the page at all, so a tab nobody is sent to is a tab nobody opens.
- Two halves: the NUMBER has to include them, and the SENTENCE has to say
  what they are, in his words.

## FOUR, 2026-10-02 (instruction, verbatim). **all four done** (`8fc29bc`, `f016369`, `7432f9a`, `7115ca7`).

> 1. Applications from Home's "View all Direct" (Origin: Direct): there is only one direct application, and "All" correctly shows 1, but In progress shows 8, Fee unpaid 4 and Expired 1. Those tabs are counting non-direct applications. Every tab count must follow the current filters. Reproduce through the browser path first, then fix.
>
> 2. Change of decision: Opndoor admin does not need the Dev Centre in the sidebar; the supplier's Integration tab covers it. Leave it off for admin, and update the test and QUEUE.md so it isn't restored.
>
> 3. Supplier Integration tab: Opndoor admin can revoke a single key here. List each active key by its name, when it was created and when it was last used, each with a Revoke button and a confirmation ("This key stops working immediately. Their other keys keep working."). Admin still never sees or creates a full key. Record who revoked what and when. Update the wording on this tab to match, removing any mention of Break glass or the Dev Centre for admin.
>
> 4. Same tab, admin view: replace developer instructions with plain admin wording. Empty states read "No sandbox applications yet", "No API requests in this period", "No webhook deliveries in this period". Remove the PandaDoc sandbox email warning, the "POST to /v1/applications" line and "check on Configuration" from the admin view; they stay in the developer's own Dev Centre.
>
> Deploy to dev and check there.

- Item 2 REVERSES the correction of 2026-10-01 ("Admin keeps the Dev
  Centre route"), which itself reversed the instruction before it. The
  route and `mayUseDevCentre` were restored for superadmin then; they come
  out again now. The comment in capabilities.ts records both turns and has
  to record this one, or the next reader restores it a third time.

### WHAT THE FOUR CAME TO

**1. The tab counts already followed the filters** (`8fc29bc`). Measured
on dev: the three numbers were 8 direct drafts, 4 of them unpaid and 1
direct expired referral. The fault was the word "All", which was the
funnel. Matt chose the wider reading the same day and it is built: see
"ALL MEANS ALL" above (`d357fa9`).

**2. The Dev Centre is developers only** (`f016369`). Third ruling on
one subject; the predicate, the test and this file all carry the three
turns so it is not restored a fourth time.

**3. One key, one Revoke, on the tab** (`7432f9a`). Two new functions,
both narrow. `dev_api_keys` has no admin arm at all by design -- "an
opndoor admin gets zero rows" -- which is why the old copy sent admin to
Break glass with a prefix they had to find elsewhere. So
`admin_supplier_api_keys` returns the four facts the screen shows and
CANNOT return a prefix: "admin never sees a key" is a property of the
function, not of its caller. `admin_revoke_partner_api_key` acts by id,
admin only, recorded to security_events with the person, the key and the
supplier. Neither widens an existing door, and the test asserts both
refusals.

**4. The tab speaks to an admin** (`7115ca7`). The three empty states in
Matt's words, and the PandaDoc warning, the POST line and "check on
Configuration" behind the developer arm. Two of those three pointed at
screens an admin can no longer open as of item 2.

## LINKS SET THE FILTERS THEY NAME (instruction, 2026-10-02, verbatim). **done** (`ac3c466`).

> Also: Home's "View all applications" link opens /applications still filtered to Origin: Direct, remembered from the previous visit. Any link that opens Applications sets exactly the filters it names and clears the rest; "View all applications" clears them all. Filters chosen on the page itself can still be remembered while you stay on it. Deploy to dev and check there.

## AND FILTERS DO NOT CARRY BETWEEN PAGES (instruction, 2026-10-02, verbatim). **done** (`ac3c466`), with the three above, as one subject.

> League has also picked up Origin: Direct from Applications, so the Agencies table shows "No matches". Filters must not carry between pages: League, Applications and Reporting each open with their own defaults (Origin: Everything) unless a link sets a filter. Check every page with an Origin filter. Deploy to dev and check there.

- **This reverses a ruling of 2026-09-29**, which is recorded in
  `src/data/origin.ts` as the reason the selection is session-level at
  all: "Reporting and Applications share one remembered scope choice. So
  this is not a per-page preference; it is the party the reader is
  currently looking at, and it lives on the session." It is now the
  opposite: per page, defaulting to Everything, and a link is the only
  thing that may set one. That comment has to be turned over rather than
  deleted, or the shared scope gets rebuilt by somebody reading it.
- The three instructions above are one subject and are built together:
  all three are the same remembered selection leaking -- into a tab
  count, into a link, and into another page.

## THE SUPPLIERS LIST, THREE THINGS (instruction, 2026-10-02, verbatim). **all three done** (`05fee8e`).

> Suppliers list (admin):
> 1. Harbour Lets shows as a supplier, but it's an agency (Opndoor-referenced). Only real suppliers appear here; agencies appear under Agencies. Check every partner is listed in the right place.
> 2. Under each supplier's name, replace "Total 25.0%, agents' share 10.0%" with the plain one-line summary of its current deal from its Commission tab, e.g. "25% of the fee, agencies 10%" or "Tiered deal", so it never shows a rate that isn't in force.
> 3. Remove the "All users · all suppliers" link if it leads to the old Users page; each supplier's people are on its People tab.
> Deploy to dev and check there.

- Item 1 is the same three-way split as the estates work: `partyIsSupplier`
  already answers it, and Harbour Lets is `opndoor_referenced`, so the
  Suppliers list is asking a two-way question. Where Harbour Lets should
  appear instead is the half to check rather than assume -- it is a
  partner with one agency under it, not an agency itself.
- Item 2 says "from its Commission tab", so the summary must be the SAME
  reader that tab uses, not a second sentence built from the two rate
  columns. Those columns are what make it show a rate that is not in
  force when a negotiated deal is.

## THE SUPPLIER PAGE, FOUR THINGS (instruction, 2026-10-02, verbatim). **all four done** (`e7dadd3`).

> Supplier page (admin, e.g. Kestrel Lettings):
> 1. Overview tab is blank. Give it a short summary: the commission deal in one line (as on the Commission tab), who gets the statements, any warnings (e.g. an agency with no agency email, linking to it), and the supplier's Recent changes.
> 2. Agencies tab: fix "Kestrel Lettings's agencies" to "Kestrel Lettings' agencies" (use the shared possessive helper everywhere).
> 3. Agencies tab: next to "No agency email", an "Add email" button that sets the agency's email in place, with a confirmation, recorded in Recent changes. Each branch's email can be added or changed the same way.
> 4. Agencies tab: the "-" after each branch name is an empty address. Show the branch address when there is one, and nothing when there isn't.
> Deploy to dev and check there.

- Item 1's "the commission deal in one line (as on the Commission tab)"
  is the same reader the Suppliers list needs for its own item 2. One
  summary, two callers.
- Item 2: `src/lib/possessive.ts` exists and the heading was built by
  hand. The instruction says "everywhere", so it is a sweep and not one
  string.
- Item 3 contradicts nothing in the Reconciliation list: that is where
  Opndoor SEES the gap, and this is where they close it. It wants the
  write in place, a confirmation, and an org_audit entry so Recent
  changes carries it.
- Item 4 is `orgLabel`'s "-" being printed for an address rather than for
  a name. An empty address is not a placeholder org.

## ADD AGENCY AND ADD BRANCH ON THE SUPPLIER'S TAB (instruction, 2026-10-02, verbatim). **done** (`0bbabce`).

> Also on the supplier's Agencies tab: an "Add agency" button (name, address, agency email required) and, on each agency, "Add branch" (name, address, email optional; it uses the agency email if blank). Both create the agency or branch in this supplier's estate, never in Opndoor's. Deploy to dev and check there.

- The RPCs already enforce the half that matters: `admin_add_agency`
  requires the email in a supplier's estate and `admin_add_branch` does
  not require one at all. What is missing is the way in from this tab,
  and the partner it creates under: `admin_add_agency` takes
  `p_partner_slug` and this must pass the supplier's, not fall back to
  `app_partner()`.

## THE SUPPLIER SETTINGS TAB, THREE THINGS (instruction, 2026-10-02, verbatim). **all three done** (`9eafeec`).

> Supplier Settings tab (admin):
> 1. Capabilities: replace "an agency is portal only, a CRM is API only, and some are both" with "Some suppliers refer through the portal, some through the API, and some use both."
> 2. Commission section: replace the description with "Set on the Commission tab." and a link.
> 3. Recent changes: hide old entries where nothing actually changed (e.g. "Live from changed from August to August 2026").

- Item 3 is not a wording fix: those rows exist because the two sides were
  FORMATTED differently before being compared, so a no-op write was
  recorded as a change. Hiding them is what he asked for; whatever still
  writes them has to stop too, or the list refills.

## THE SUPPLIER COMMISSION TAB, WORDING (instruction, 2026-10-02, verbatim). **done** (`09d9170`).

> Supplier Commission tab: under "Kestrel Lettings and each agency, separately", replace "Each agency gets its own statement from opndoor, and Kestrel Lettings gets its own" with "opndoor pays each agency its share directly. All statements still go to Kestrel Lettings." Check the confirmation dialog for this switch says the same. In "Who gets the statements", replace "On this rail only Opndoor can change that" with "Only Opndoor can change that." Deploy to dev and check there.

- The old sentence is now FALSE as well as unclear, which is why it has
  to change: 20261007410000 stopped sending a statement to a
  supplier-estate agency at all. The new wording is the behaviour.

## THE AGENCIES' % EDITOR NEEDS THE SAME WARNING (bug, 2026-10-02, verbatim). **done** (`7724710`).

> The agencies' % editor (supplier Commission tab, default and bespoke deals) saved a tenant step of "1 to 10 tenants" with no warning. Add the same warning the main deal editor has: before saving any tenant step above 4 tenants, ask "Did you mean referrals sent? A tenancy rarely has more than 4 tenants." with options to switch to "% grows with referrals sent" or save anyway. Deploy to dev and check there.

## THE ADMIN AGENCIES PAGE, THREE THINGS (instruction, 2026-10-02, verbatim). **all three answered or done** (`e66ff68`); 1 and 3 are answers, under "For Matt in the morning".

> Admin Agencies page:
> 1. It says "6 agencies" but only shows Frost Partnership, Regent's Lettings, Harbour Lets and Harborview Lettings, even with Expand all. Northgate Lettings and Southbank Residential are missing. Find out why and fix it, or tell me if they've been moved to a supplier's estate.
> 2. Every link from an agency or branch to Applications filters by name (e.g. ?agency=Frost Partnership), so with two Frosts in different estates it can show the other one's applications. Links must filter by the agency's or branch's id, everywhere.
> 3. Frost Partnership in Opndoor's estate is inside Meridian Property Group. Tell me if that's just the test setup; if so, move it out so it stands alone.
> Deploy to dev and check there.

- Item 1 is a question before it is a fix: the count and the tree
  disagree, so one of them is reading a different set. Neither agency has
  moved estate -- both are under `opndoor-agents` on dev -- so the answer
  is in the page.
- Item 2 is the last piece of separate estates that was left as a known
  gap: a name is not an identity any more.
- Item 3: the Frost fixture did not set a group. Something else put it in
  one, and that is worth knowing before moving it.

## THE AGENCY PAGE, THREE THINGS (instruction, 2026-10-02, verbatim). **all three done** (`7b206a4`).

> Agency page (admin, e.g. New Independent):
> 1. When the only person who could receive the deed has a pending invite, say "Independent Director hasn't accepted their invite yet; deeds will reach them once they do" instead of "No one at this agency can receive the deed".
> 2. Recent changes: "invited set to management" should read "Independent Director invited as Director", using agency level names (Director, Manager, Negotiator) everywhere on agency pages.
> 3. The "Set rate" button beside the agency name: if commission is set on the Commission tab, remove it so there's one place to set commission.
> Deploy to dev and check there.

## HOW ARE THIS AGENCY'S TENANTS CHECKED? (instruction, 2026-10-02, verbatim). **done** (`0c62295`).

> Agency page, the "Referrals from this agency" dropdown: replace it with a clear choice titled "How are this agency's tenants checked?" with two options:
> - "Opndoor checks eligibility" (the tenant completes eligibility before paying)
> - "Agency has already referenced them" (the tenant goes straight to payment)
> Remove the separate "Follow the default" option; new agencies start on "Opndoor checks eligibility". Changing it asks for confirmation and applies to new referrals only, and is recorded in Recent changes. Deploy to dev and check there.

- "Remove the separate 'Follow the default' option" is a DATA change as
  well as a control change: `agencies.referencing_mode` is nullable today
  and null means inherit. Two options means it stops being nullable, and
  the existing nulls have to become something.
- **done `0c62295`.** `20261007470000` backfilled every null to
  `opndoor_referenced` (Matt: "there are no real agencies yet, only dev
  test data"), set the column NOT NULL with that default, and made
  `set_agency_referencing_mode` refuse null. Regent's keeps
  `pre_referenced_open`. The radios replace the dropdown on the agency
  page, the confirmation says referrals already sent keep their route,
  and a `tenant_check_changed` audit row is written only when the value
  moves. Three pgTAP fixtures used null as a fixture value and now state
  the mode they were inheriting.

## THE AGENCY PEOPLE TAB USES THE SHARED TABLE TOO (instruction, 2026-10-02, verbatim). **done** (`65551ef`).

> The agency People tab (admin view, e.g. New Independent) only shows Name, Level and Status. Use the same shared people table as every other people screen, with Sees and Last active (or "Invited [date]" for pending invites). Show the Office column only when the agency has more than one office; for a single-office agency like New Independent, leave it out. Check every people screen uses the shared table and list any that don't. Deploy to dev and check there.

- `PeopleTable` already drops the Office column when no row has one
  (`e2cd4c7`), which is the single-office case, so the column rule may
  need nothing. The AGENCY People tab is the one screen that was not
  moved onto it, and "list any that don't" is a sweep with an answer owed
  either way.
- **done `65551ef`.** The tab WAS on the shared table already; what it
  passed was three of its columns. It now passes `extraHeader="Sees"`
  with `agencySees(role, level)` and `lastActive`. Both Sees sentences
  (ours and the supplier's) moved into `positionsService`.
  `20261007480000` adds `invited_at` to `list_managed_users`, so a
  pending row reads "Invited 2 Oct 2026" instead of repeating its own
  pill. The Office rule needed no code and is asserted.
- **The sweep, which was asked for either way.** All four people screens
  draw `<PeopleTable>`: agency Team, admin agency People, supplier
  People, the opndoor team page. None of them hand-draws people columns.
  `PositionModal` lists one person's positions and is not a people list;
  the only other `<th>Name</th>` in `src` is the Dev Centre's webhooks
  table. **Nothing to report as missing.**
- **Not fixed, not reported: one header, two meanings.** Team puts
  `describePosition` in the Office column, so a Director reading their
  own Team sees "Agency: Regent's Lettings" under a header that means
  the branch name on the admin view of the same people. For Matt.

## "ALL" MEANS ALL (instruction, 2026-10-02, verbatim). **done** (`d357fa9`).

> Applications: the "All" tab counts and shows every application in the current filters, including In progress, Fee unpaid and Expired, so "All" equals the sum of the other tabs. "Showing X of Y" counts the same set. Deploy to dev and check there. Yes to defaulting agencies on "Follow the default" to "Opndoor checks eligibility". There are no real agencies yet, only dev test data.

- This is the answer to the question I left under "For Matt in the
  morning": All was the operational funnel (sent + paid + deed) and the
  other five statuses were counted on their own tabs and left out of it.
  He has chosen the wider of the two readings.
- "so 'All' equals the sum of the other tabs" is true of the EXCLUSIVE
  tabs. Three of the chips are subsets rather than siblings -- Fee unpaid
  and Invited are both inside In progress, and Refunded is inside Paid --
  so the sum that can hold is draft + awaiting decision + declined + sent
  + paid + deed + withdrawn + expired. Fee unpaid is one of the three he
  names, and it is a subset, which is how I know the sentence means "All
  holds everything" rather than "add the chips up".
- And the second half answers the consequence I flagged: the existing
  nulls on `agencies.referencing_mode` become "Opndoor checks
  eligibility", and he has said there is no real agency data to protect.

## THE OFFICE COLUMN SAYS WHAT IT MEANS (instruction, 2026-10-02, verbatim). **done** (`27d6bd1`).

> Office column on every people screen: show the branch name for someone positioned at a branch, and "Whole agency" for someone positioned at the agency (or "Whole group" at a group level). Same wording on the agency Team page and the admin views. Deploy to dev and check there.

- This is the thing I flagged at the end of the People tab item and left
  for Matt: Team put `describePosition` in the Office column, so a
  Director reading their own Team saw "Agency: Regent's Lettings" under a
  header that means the branch name on the admin view of the same people.
  One header, two meanings. He has chosen a third wording for both.
- It is about the WORDING of the cell, not about when the column appears.
  The rule from earlier today stands: the column is dropped when no row
  fills it, which is the single-office case he named on New Independent.
- **done `27d6bd1`.** `officeLabel`/`officeOf` in positionsService;
  `describePosition` deleted, its two test files turned over onto
  `agencySees` and `officeLabel`. Verified on dev against the real
  `user_scopes`: 7 branch positions read their office name, 7 agency
  positions read "Whole agency", Dara Whitfield at Meridian Property
  Group reads "Whole group", the 6 unpositioned read nothing.
- **ONE JUDGEMENT CALL, FOR MATT TO OVERRULE IN A WORD.** This morning's
  rule was "show the Office column only when the agency has more than
  one office", and his reason was that it carried nothing on New
  Independent. The new wording changes that on **Regent's**: one office,
  but three people at the agency ("Whole agency") and two at the branch
  ("Regent's Park"). Under the old gate the admin view of Regent's would
  have had NO Office column while its own Team page showed one, which is
  the opposite of "same wording on the agency Team page and the admin
  views". So the table now draws the column **when the rows differ**,
  which is his reason rather than his proxy: New Independent still has
  none, Regent's gains one and the two screens match. Say the word and
  it goes back to "more than one office".

## UNFINISHED DIRECT APPLICATIONS (instruction, 2026-10-02, verbatim). **all four done** (`4bb4f41`).

> Unfinished direct applications:
> 1. List every reminder email a tenant can receive today (what triggers it, when, and the wording), so I can see the full set.
> 2. An unfinished direct application expires after 30 days with no activity. Expiry loses nothing: if the tenant signs in again, it reopens where they left off, back to In progress, same reference.
> 3. At 25 days with no activity, email the tenant: their application will close in 5 days, with a link to carry on.
> 4. In the Applications list, an unfinished application with no rent yet shows "Not given yet" instead of "£0 per month".
> Deploy to dev and check there.

- Item 1 is a REPORT, not a build, and it comes first for a reason: 2 and
  3 add a reminder to a set nobody has seen whole. It has to be the set
  as it actually is, read out of the senders, not out of the docs.
- "Expiry loses nothing" is the whole of item 2. There is already an
  expiry on the direct rail; what matters is that reopening is the same
  row -- same reference, back to In progress -- and not a new
  application.

### ITEM 1: EVERY REMINDER EMAIL A TENANT CAN RECEIVE, AS AT 2026-10-02

Read out of the senders and the templates, not the docs. There are
**two** today, and a third from this commit.

**1. The guarantee fee is unpaid.** `payment-reminders`, daily at 08:00
London (pg_cron fires 07:00 and 08:00 UTC to cover BST; the function
no-ops on the off hour). Fires at **2, 5 and 9 days** after the
application was Sent while the fee is still unpaid, once per threshold,
and only the HIGHEST threshold reached -- an application first seen on
day 21 gets one email, not a backlog of three. Subject "A reminder about
your opndoor guarantee", heading "Your guarantee is still waiting". The
lead escalates and says nothing else: "Just checking this reached you." /
"This one is still outstanding." / "This is now holding your tenancy
up." Then one sentence carrying every fact: "[Agency] has arranged an
opndoor guarantee for your tenancy at [address]. To put it in place, pay
the guarantee fee of [amount] ([basis])" -- or, on the direct rail,
"opndoor is acting as guarantor for your tenancy at [address]...". Rows:
Reference, the fee (labelled "your share" on a joint tenancy), and "Open
until" where there is one. Button: "Pay the guarantee fee".

**2. The guarantee is ending.** `renewal-notices`, same schedule. ONCE
per application, when the twelve-month cover ends within 30 days.
Subject "The opndoor guarantee for [tenant] ends on [date]", heading
"The guarantee is ending soon", body "The guarantee for [tenant] at
[address] ends on [date]. If the tenancy is continuing and you would
like cover to continue, email support@opndoor.co."

**3. The unfinished application is closing.** New in this commit. 25
quiet days, once, see item 3 below.

**NOT to the tenant, though it reads like it might be.**
`expiry-reminders` fires at 30 / 14 / 7 days and then daily inside the
last week, and goes to the owning referrer and partner management. The
tenant is never on it.

**Manual, so not a reminder:** `resend-payment-email`, which a person
presses.

**Not reminders at all**, for completeness: the sign-in code, password
reset, the tenant invite, "submission received", the payment link, the
direct approval, the payment receipt, a refund, the deed to sign, and
the executed deed. Each fires once, on an event.

**ONE THING WORTH YOUR EYE, Matt.** Reminder 2 goes to the tenant AND
the agent or landlord AND the referrer, as ONE send with everybody on
it, and the wording is written for the agent: a tenant reads "The
guarantee for Amara Okonjo at 14 Chalcot Square ends on 1 September
2027", which is a third-person email about themselves, and the only
action offered is to email support. Not changed, because it is not what
you asked for. Say the word and the tenant gets their own wording.

## ADMIN REPORTING, THREE THINGS (instruction, 2026-10-02, verbatim). **all three done** (`2ea5f13`).

> Admin Reporting:
> 1. Wherever an agency or branch from a supplier's estate appears alongside Opndoor's (branch and agency charts, referrer list, settlements, payees, statements), label it with its supplier, e.g. "Frost Partnership (via Kestrel Lettings)", so two same-named companies can always be told apart.
> 2. "Commission by route": Harbour Lets is an agency, so it belongs in "Agency referral", not listed as its own route. Only real suppliers appear as routes.
> 3. Use "guarantee fee" on every screen, not "guarantor fee" (e.g. "Guarantee fee paid", "Guarantee fees collected"), matching the emails. API field names and CSV column headings stay as they are.
> Deploy to dev and check there.

- Item 1 is the consequence of separate estates arriving on a screen that
  mixes them: two Frosts, one per estate, side by side in one chart. The
  label belongs in ONE helper, or it will be written six ways across the
  six surfaces he lists.
- Item 2 is the same fault as "Harbour Lets shows as a supplier" on the
  Suppliers list (`05fee8e`), on a different screen: something is
  deciding "route" by partner rather than by whether the partner is a
  supplier.
- Item 3 is the rest of the sweep I said was about twenty minutes and did
  not do on a guess, now authorised, and with the same caveat he gave
  before: the API field names and the CSV column headings do not move.
  The activity feed writes its rows from stripe-webhook, so old rows keep
  the old words whatever the sender says next.

## THE PERFORMANCE EXPORT, FIVE THINGS (instruction, 2026-10-02, verbatim). **all five done** (`cca54fc`).

> Performance export (Export summary, admin):
> 1. Remove the hard-coded percentages from labels ("Partner commission (2% of…)", "Agent commission (15% of…)"). Rates vary by deal; label them "Supplier commission (net of refunds)" and "Agent commission (net of refunds)".
> 2. For All time, show "All time" with the date of the first referral to today, not "01/09/2024 to 31/12/2051".
> 3. Breakdown by branch shows £0 agent commission on every branch while the agency rows have commission. Branch rows must carry the commission earned by their own referrals, and add up to the agency row.
> 4. Say "Supplier", not "Partner", in every heading and label (column headings a partner's code may read can stay).
> 5. Label supplier-estate agencies and branches with their supplier, e.g. "Frost Partnership (via Kestrel Lettings)", as on screen.
> Check the other exports (Application export, Expiries, statements) for the same faults. Deploy to dev and check there.

- Item 5 is the same helper as item 1 of "ADMIN REPORTING" above, and the
  two must share it: "as on screen" is the instruction.
- Item 3 is the only one that is not wording. £0 on every branch beside a
  non-zero agency row means the branch aggregation is not reading the
  commission lines at all, and "add up to the agency row" is the test.

## THE APPLICATION EXPORT, SIX THINGS (instruction, 2026-10-02, verbatim). **all six done** (`c7581ee`).

> Application export (admin):
> 1. GR-20846 shows agent commission £265.39 here and £265.38 on Regent's commission statement. Every export, statement and screen must take commission from the same stored amount, never recalculate and round differently. Find every place commission is recomputed rather than read, fix them, and add a test that the export and statement agree to the penny for every application.
> 2. Direct signups show "Unattached" for Agency and Branch; show blank, as on screen.
> 3. Unfinished applications: leave "Guarantor fee charged" blank and Payment state "Not yet at payment" until the tenant actually reaches payment.
> 4. Fee basis: show "1 month" for one month's rent, and weeks only where the deal is in weeks (e.g. "5 weeks").
> 5. Replace "Commission rate" with two columns, "Supplier commission rate" and "Agent commission rate".
> 6. Share of tenancy: show 100% for every single-tenant application, never blank.
> Plus the header fixes from the summary export (no made-up end date, "Supplier" not "Partner"). Deploy to dev and check there.

- Item 1 is the big one and is not an export bug: a penny's disagreement
  between two surfaces means at least one of them is RECOMPUTING from a
  rate instead of reading `application_commission_lines`. The instruction
  is explicit that the sweep is "every place commission is recomputed
  rather than read", so the fix is a hunt and the test is per
  application, not per screen.
- Item 5 renames a COLUMN HEADING, which the other instructions have
  deliberately protected ("column headings a partner's code may read can
  stay"). This one says to replace it, and it is adding a column as well
  as renaming, so it is a deliberate exception rather than a conflict.

## THE BORDEREAU NEVER SHOWS A PLACEHOLDER (instruction, 2026-10-02, verbatim). **done** (`fec2309`).

> Underwriter bordereau: "Landlord Name" shows "Unattached" for a direct signup. Never show the placeholder: show the landlord's name where we hold it, otherwise leave it blank. Check every column of the bordereau for "Unattached" or any other internal placeholder. Deploy to dev and check there.

- "Unattached" is the house rails' placeholder agency, which exists so an
  application's NOT NULL agency_id resolves. It is an internal row and it
  has now surfaced on three documents: the application export (item 2 of
  that instruction), this one, and whatever the sweep finds. The fix is
  one rule -- a placeholder renders as nothing -- applied everywhere a
  name is printed, not three separate blanks.
- The landlord's name is a different question from the agency's: this
  column was reading the agency because a direct signup has no agent, and
  `landlord_name` is the column that answers it.

## THE EXPIRIES EXPORT, THREE LABELS (instruction, 2026-10-02, verbatim). **all three done** (`fec2309`).

> Expiries export: label "Annualised rent" as "Annualised rent (this tenant's share)"; say "Guarantee fee (whole tenancy)" not "Guarantor fee"; replace the Tenancy ID code with "Joint with" listing the other tenants' guarantee references (blank for single tenancies). Deploy to dev and check there.

- The third is not a label: "Joint with" has to resolve the other tenants
  on the tenancy and print THEIR references, which the export does not
  currently carry.
- The first two are the same subject as item 3 of "ADMIN REPORTING" and
  of the application export: one fee name, and a figure that says whose
  share it is.

## THREE, AFTER THE EXPORTS (instruction, 2026-10-02, verbatim). **done** (`9a8628e`); item 1 needed no work.

> 1. Keep the Office column rule as you built it (shown when rows differ).
> 2. Renewal notice: send the tenant their own email, worded for them ("Your guarantee for [property] ends on [date]…"), and the agent theirs, as two separate sends.
> 3. Store supplier commission per application the same way agency commission is stored, and read it everywhere (statements, exports, reporting, settlements) instead of recalculating, with a test that the supplier statement and exports agree to the penny.
> Deploy to dev and check there.

- Item 1 settles the judgement call recorded under THE OFFICE COLUMN
  SAYS WHAT IT MEANS: the rule stands, and this is Matt's word on it, not
  mine. Nothing to build.
- Item 2 is the thing I flagged rather than changed when he asked for the
  reminder list. One send carrying tenant and agent means ONE wording,
  and it was the agent's.
- Item 3 is the other half of the penny. `agentAmountOf` reads a stored
  amount because the agency side has one; the supplier side has no line
  at any level, which is exactly what I said could not be swept and is
  now what he is asking for. It is a migration, a backfill, and then the
  same sweep again on the other side.

## RECONCILIATION COUNTS WHAT IS WAITING (instruction, 2026-10-02, verbatim). **all three done** (`d6f8422`).

> Reconciliation:
> 1. The "All" tab must include every item from every tab; it currently says "Nothing to check" while "Supplier agencies with no email" has 2 and "Not in network" has 1. The top three tiles must also count what's actually waiting.
> 2. Home's Reconciliation count and the sidebar badge must equal the "All" count, including "Not in network".
> 3. Home's Reconciliation link opens on whichever tab has items (or All).
> Deploy to dev and check there.

- The same fault as Applications' "All", which Matt reported on
  2026-10-02 and which was answered with "All means all" (`d357fa9`): a
  tab called All that holds a subset. This is that rule on a second
  screen, and the tiles above it are a third place the same count is
  stated.
- Item 2 says the Home tile and the sidebar badge are the SAME number as
  All, which is stronger than the fix I made this morning (`f1f98e1`):
  that one added the email tab to the Home count and left "Not in
  network" out of both.
- One count, read in four places, is the shape this wants: the tiles, the
  All tab, the Home tile and the badge.

## ADD THE EMAIL WHERE THE ROW IS (instruction, 2026-10-02, verbatim). **done** (`1784a9b`).

> Reconciliation, "Supplier agencies with no email": each row gets an "Add email" button that sets the agency email right there (same as on the supplier's Agencies tab), plus a link to the agency on its supplier's page. Once added, the row disappears and the counts update. Deploy to dev and check there.

- The tab has listed these since `55b981b` and been a list you could only
  read: the fix was on the supplier's Agencies tab (`e7dadd3`), one
  navigation away, so the page that tells you about the work could not do
  it.
- "Same as on the supplier's Agencies tab" is the instruction and the
  constraint: the same component, not a second dialog that drifts.
- "the counts update" is the whole chain from this morning's work -- the
  tab, the All count, the three tiles, Home's tile and the sidebar badge
  are one number now, so the row disappearing has to move all of them.

## A TILE THAT IGNORES THE PERIOD SAYS SO (instruction, 2026-10-02, verbatim). **done** (`d181e0e`). The sweep's answer: the Needs-attention block is the page's only other period-blind figure set, and it now says so once for the section.

> Reporting: "Total guaranteed rent value" doesn't change with the period, because it's everything currently guaranteed. Label it "Guaranteed rent in force (whole book, not affected by the period)" so it isn't read as this period's figure. Check any other tile that ignores the period and label it the same way.

- The second sentence is the work. One mislabelled tile is a wording
  fix; "check any other tile that ignores the period" is a sweep, and
  the answer is owed either way.
- A tile under a period picker is READ as being of that period. That is
  the whole defect: the figure is right and the reader is wrong, and
  the label is what made them wrong.

## THE PERFORMANCE EXPORT'S WORDING SWEEP, FINISHED (instruction, 2026-10-02, verbatim). **done** (`d181e0e`).

> Performance export: finish the wording sweep. Replace every remaining "Partner"/"partner" with "Supplier"/"supplier" (header "All suppliers (combined)", "Commission by supplier", "Supplier commission (gross/net)", "Attributed supplier commission", the settlement's "Supplier" column), and "Guarantor fee" with "Guarantee fee". This file is for Opndoor only, so its column headings can change. Label "Total guaranteed rent value" as in force across the whole book, not the period, as on screen. Deploy to dev and check there.

- **This lifts the exception I have been holding twice.** "Column
  headings a partner's code may read can stay" was Matt's own caveat on
  the summary export and on the fee rename, and I asserted it in two
  tests so a later sweep could not quietly finish the job. He is now
  saying this file is Opndoor's own, so its headings move. The
  assertions have to be turned over rather than deleted, or the next
  reader restores them.
- It does NOT lift the caveat on the APPLICATION export or the expiries
  file, which partners do read. Only this one.
- The last sentence is the same subject as the instruction above it, so
  the two are built together.

## THE APPLICATION EXPORT'S WORDING SWEEP (instruction, 2026-10-02, verbatim). **PART DONE** (`d181e0e`): the headings moved. The via-supplier labels and the blank rents are NOT done.## THE APPLICATION EXPORT'S WORDING SWEEP (instruction, 2026-10-02, verbatim). **done** (`d181e0e` headings, `d92072b` the via labels and the blank rents).

> Application export: same wording sweep as the Performance export. Replace every remaining "Partner"/"partner" with "Supplier"/"supplier" (the first column, "Partner commission", "All suppliers (combined)" in the header) and "Guarantor fee" with "Guarantee fee", including the notes; this file is for Opndoor only, so its headings can change. Label supplier-estate agencies and branches "(via [supplier])" as on screen. Leave Monthly rent and Share of rent blank where the tenant hasn't given a rent yet. Deploy to dev and check there.

- **This lifts the exception on a SECOND file.** I have twice held
  "column headings a partner's code may read can stay" and asserted it
  in tests. He has now said it of the performance export and of this
  one. The expiries file and the API are not covered by either sentence.
- "Leave Monthly rent and Share of rent blank where the tenant hasn't
  given a rent yet" is the same subject as "Not given yet" on the
  Applications list, on the export.

## THE EXPIRIES EXPORT ON DEV IS STALE (bug, 2026-10-02, verbatim). **answered, and every function deployed** (16:35, all 35). ONE QUESTION BACK FOR MATT, below.## THE EXPIRIES EXPORT ON DEV IS STALE (bug, 2026-10-02, verbatim). **done**: answered, every function deployed (16:35, all 35), and the other file brought into line (`6baf1c7`).

> The Expiries export on dev still produces the old file (no "Joint with", old "Annualised rent" and "Guarantor fee" headings) after your fix in fec2309. If it's built by an edge function such as expiry-cohorts, deploy it to dev with the npx command, and check every function changed today has been deployed. Then download it yourself on dev and confirm the new headings.

- **Take this first.** It is a report that something recorded as done is
  not on dev, which makes the record wrong as well as the file.
- "check every function changed today has been deployed" is the real
  instruction. One stale function is a mistake; not knowing which are
  stale is the thing to fix.
- The precedent is in `tenantFeeEmails.test.ts`: a create-referral fix
  was committed at 09:17 against a bundle deployed at 09:16, so dev ran
  the old code for a day. "Nothing about the repo was wrong. The deploy
  was."

### WHAT THE DEPLOY CHECK FOUND

- **Every function was on the 10:06 bundle.** `_shared/emailTemplates.ts`
  changed at 14:0x and again at 15:41, and a shared file is bundled into
  every function that imports it, so ELEVEN were behind: approve-
  application, create-referral, expiry-reminders, invite-user, ops-alert,
  payment-page, resend-payment-email, send-mfa-reset-notice,
  send-password-reset, tenant-auth, weekly-digest. (payment-reminders,
  tenant-portal and renewal-notices had been redeployed with their own
  changes.) All 35 are now deployed at 16:35 and none is older.
- **The expiries file was never one of them.** The Reporting download is
  built in the client by `buildExpiriesCsv`, not by an edge function,
  and both dev servers serve the fixed module -- checked by fetching it.
  So the old headings came from a page loaded before the change, or from
  the other file.
- **THE OTHER FILE, which is the question back.** `expiry-cohorts` emails
  a MONTHLY COHORT CSV to each agency, with its own shorter column set:
  no "Joint with", no fee column at all, and a bare "Annualised rent".
  It is agency-facing, so the "Opndoor only" exception does not cover
  it, and fec2309 never touched it. Say the word and it gets the same
  three labels.

## ADMIN LEAGUE, THREE THINGS (instruction, 2026-10-02, verbatim). **done** (`9e4d0c6`), with the two restatements below.

> Admin League: rename "Partner comm." to "Supplier comm." on every tab. Where a row already carries its supplier's tag (e.g. "Kestrel Lettings"), drop the "(via …)" from the name so it isn't said twice. Add the dashboard's one-line note that a rate can exceed 100% when payments land this period for referrals sent earlier. Deploy to dev and check there.

- The second item is the cost of `viaSupplier` (`2ea5f13`) meeting a
  table that already has a Supplier column. The label was written for
  the charts, where there is no such column; on League it says the same
  thing twice on one row.
- So the rule is about the SURFACE, not the name: label it where the
  estate is not already stated, and not where it is.
- The third is the funnel note on the dashboard, which League needs for
  the same reason: its conversion is period throughput too.

## THE LEAGUE EXPORTS (instruction, 2026-10-02, verbatim). **done** (`d181e0e` the two labels, `9e4d0c6` the rest).

> League exports (every tab): "All suppliers (combined)" in the header and "Supplier commission" instead of "Partner commission". Deploy to dev and check there.

- The third file in the same sweep. The performance export, the
  application export and now the league exports are all Opndoor's own,
  so all three lose the column-heading exception. The expiries file and
  the partner API keep it: nothing has been said about those.

## THE LEAGUE, RESTATED WITH THE EXPORTS IN IT (instruction, 2026-10-02, verbatim). **done** (`9e4d0c6`).

> League screen and exports: where a row already shows its supplier (the tag on screen, the Detail column in exports), drop "(via …)" from the name so it isn't said twice. Rename "Partner comm." to "Supplier comm." on screen on every tab, and add the dashboard's one-line note that a rate can exceed 100% when payments land this period for referrals sent earlier. Deploy to dev and check there.

- This supersedes the two League entries above by naming the EXPORT's
  Detail column as the second place the supplier is already stated. The
  three are built as one.
- So the rule is: `viaSupplier` labels a name where nothing else on the
  row says the estate, and is dropped where something does. The charts
  have no such column and keep it; League, on screen and in its
  exports, has one and does not.

## THE LEAGUE'S PEOPLE TAB (instruction, 2026-10-02, verbatim). **done** (`9e4d0c6`).

> League, people tab: call it "Referrers" on screen and in the export, since it includes Directors and supplier staff. Add an "Agency or supplier" column (e.g. "Regent's Lettings", "Kestrel Lettings"), on screen and in the export. Deploy to dev and check there.

## EVERY LEAGUE EXPORT IS TITLED AFTER ITS OWN TAB (bug, 2026-10-02, verbatim). **done** (`9e4d0c6`). The sweep's answer: the sheet name and the first column came from a ternary with agency, branch and "Referrer" for everything else, so the Suppliers board -- added fourth -- fell into the else. `LEAGUE_NOUN` is a Record<LeagueView, ...>, so a fifth board has to be named to compile.

> League Suppliers tab export: it's titled "League table: Referrers" with a "Referrer" column. Title it "League table: Suppliers" with a "Supplier" column. Check every League tab's export is titled after its own tab. Deploy to dev and check there.

- A whole tab's export carrying another tab's title and column heading
  is the League-export family's own version of the fault the last four
  instructions are about: a document that does not say what it is.
- "Check every League tab's export" is the sweep, and the answer is
  owed for all of them, not just Suppliers.

## THE WARNING ICON, AND A QUESTION ABOUT DEV DATA (instruction, 2026-10-02, verbatim). **done** (`fea1ccd` the icon); the question is answered in the notes below.

> Supplier Overview, "Needs attention": the warning icon renders at full card size and squashes the text into a narrow column. Size the icon like every other warning icon in the portal (small, beside the text). Check every place this component is used. Also: Recent changes shows "Who pays the agents" switched to "the supplier pays its own agents" on 2 Oct by Nicholas Dwyer. Tell me if you changed that while testing; if so, say what you changed and put it back. Deploy to dev and check there.

- **ANSWERED: no.** `partner_audit` holds the row -- 2 Oct 09:33:06 UTC,
  Kestrel Lettings, `opndoor_pays_agents` from "opndoor pays the agents"
  to "the supplier pays its own agents", actor Nicholas Dwyer -- and an
  earlier flip the other way on 1 Oct 15:52. Both are app writes through
  `update_partner_settings`, which is admin + AAL2 and only reachable
  from the browser. I have never signed into the dev app; every write I
  have made is SQL as the service role or an edge function invoked with
  the cron secret, and neither can set `actor` to a person's name. The
  rows around it are three suppliers created at 09:28-09:29 and an
  agents'-share deal at 09:32: somebody walking the admin screens.
- NOTHING PUT BACK, deliberately: nothing of mine moved it, and which
  way it should sit is a commercial setting. Kestrel currently reads
  "the supplier pays its own agents".
- The ICON is still to do.

## THE ADMIN WALK, SIX (instruction, 2026-10-02, verbatim).

> Batch of fixes from the admin walk:
> 1. Supplier Overview, "Who gets the statements": "Kestrel Lettings's" should be "Kestrel Lettings'". Use the shared possessive helper everywhere a name is made possessive.
> 2. Supplier Overview, Commission: "What opndoor charges on a referral through this supplier" should read "What opndoor pays this supplier on a referral".
> 3. Recent changes (supplier and agency): hide old entries where nothing actually changed, e.g. "Live from changed from August to August 2026".
> 4. League: the people tab is "Negotiators" on screen and "Referrers" in its export. Call it "Referrers" in both, since it includes Directors and supplier staff, and add an "Agency or supplier" column on screen and in the export.
> 5. League Suppliers tab export is titled "League table: Referrers" with a "Referrer" column. Title it "League table: Suppliers" with a "Supplier" column, and check every League tab's export is titled after its own tab.
> 6. Reporting: "Total guaranteed rent value" doesn't change with the period. Label it "Guaranteed rent in force (whole book, not affected by the period)", and label any other tile that ignores the period the same way.
> Deploy to dev and check there.

- Items 4, 5 and 6 restate instructions already recorded above; they are
  one build each, not two.
- Item 3 was asked once before, of the SUPPLIER's Recent changes
  (`9eafeec`, `isNoOpChange`). This asks for it on the agency's too, and
  says it is still showing on dev, which means either the agency page
  never got the filter or the filter does not catch this shape.

## TWO ON SUPPLIER SETTINGS (instruction, 2026-10-02, verbatim). **item 1 done** (`fea1ccd`); **item 2 is a report, below**.

> 1. Supplier Settings: the "Commission tab" link opens Overview; make it open the Commission tab.
> 2. Supplier Settings offers "opndoor referenced" as a referencing mode. Since supplier vs agency is partly decided by referencing mode, check what happens if a supplier is switched to it: does it vanish from Suppliers, change estate, or alter commission and statements? Tell me what happens before changing anything. If it reclassifies the supplier, the supplier/agency decision must not depend on referencing mode.

- Item 1 is the link I added in `9eafeec`, which predates PartnerHome
  learning `?tab=` an hour ago: it had no way to name a tab.
- **Item 2, MEASURED ON DEV in a rolled-back transaction. It does
  reclassify, and the two halves of the product disagree about it.**

  SQL barely moves. Switching Kestrel to `opndoor_referenced` flips
  `is_supplier_estate` to false and `is_our_estate_partner` to true, and
  changes nothing else that was measured: the partner payee row and the
  statement line are both still there (1 and 1). They survive because
  the partner arm of `commission_statement_lines` is guarded by
  `isHousePartner`, not by the estate, and `supplier_settles_its_own_
  agents` reads `opndoor_pays_agents`, not the mode.

  THE CLIENT MOVES A LOT, because `partyIsSupplier` IS
  `referencingMode !== 'opndoor_referenced'`:
    * it VANISHES from Suppliers and appears under Agencies
      (the Harbour Lets fault, which is what `05fee8e` fixed)
    * "Commission by route" folds it into "Agency referral" (`routeOf`)
    * its agencies lose their "(via Kestrel Lettings)" labels
    * its agencies stop needing an agency email, so they drop off
      Reconciliation (`agencyContactState`)
    * Reporting serves it the agency-facing layout, not the supplier one
    * **the supplier settlement SKIPS it entirely** -- `agentRailApp`
      becomes true, so Opndoor stops showing it as owed anything while
      the database still produces a statement line for it

  THAT LAST ONE IS THE SERIOUS ANSWER: the screen would stop listing a
  supplier the server still bills. So his conditional applies -- "If it
  reclassifies the supplier, the supplier/agency decision must not
  depend on referencing mode" -- and the fix is a real one: a partner
  needs its own `is_supplier` fact, with the mode left to answer the
  journey question it is named for. NOT STARTED: it is a schema change
  touching every surface above, and he asked to be told first.

## THE SUPPLIER'S COMMISSION STATEMENTS NEVER BUILD (bug, 2026-10-02, verbatim). **done** (`9e4d0c6`).

> Supplier Reporting tab (admin, Kestrel Lettings): "Commission statements" stays on "Building September 2026..." and never shows the statement or downloads. Find why (the statement function on dev, an error being swallowed, or a missing deploy), fix it, and show a clear error if building ever fails. Deploy to dev and check there.

- A spinner that never resolves is an error nobody is shown, which is
  the second half of the instruction and the more important half.

## VIEW AS KESTREL, REPORTING (instruction, 2026-10-02, verbatim).

> View as Kestrel Lettings (and Kestrel's own login), Reporting:
> 1. Don't add "(via Kestrel Lettings)" to agency and branch names in the supplier's own view; it's only needed where Opndoor sees both estates.
> 2. "Kestrel Lettings' commission": show Kestrel's own statement first (its total, reference and downloads), with its agencies' schedules beneath it, not a single agency's statement as the headline.
> 3. Frost Partnership (Kestrel's estate) has its own statement reference, STMT-2026-09-0004. Tell me whether a statement was posted or emailed to that agency. Per the decision, statements for a supplier's agencies go only to the supplier: if anything was sent to the agency, say what and to whom, and make sure it can't happen again.
> Deploy to dev and check there.

- Item 1 is the third refinement of the same rule in a day: label the
  estate where the reader can see both, and nowhere else. Charts yes;
  League no (it has a Supplier column); a SUPPLIER's own view no (every
  row is theirs). The rule is about the reader as well as the surface.
- **ITEM 3 ANSWERED: nothing was sent.** `commission_statement_refs` has
  STMT-2026-09-0004 as `kestrel-lettings|agency:f005...a002`, which is
  Frost Partnership in Kestrel's estate, reference minted 2026-10-02
  15:38:48. `commission_statement_sends` has NO row for it: the only
  sends are the 1 Oct 07:00 cron run, three opndoor-agents agencies and
  the settlement summary. So the reference exists and the document was
  never posted or emailed.
- THE GUARD ALREADY HOLDS for the run: `commission_statement_lines`
  excludes payees where `supplier_settles_its_own_agents`, so Kestrel's
  agencies are not in Opndoor's statement run. What is NOT guarded is
  that the reference was minted at all -- something built that agency's
  statement document at 15:38, the same minute the supplier Reporting
  tab was sitting on "Building September 2026...". That ties items 2 and
  3 to the spinner bug: the tab builds the wrong document, the build
  mints a reference, and then it hangs.
- Items 1 and 2 are still to build.

## THE AGENCY'S MONTHLY EXPIRIES EMAIL (instruction, 2026-10-02, verbatim). **done** (`6baf1c7`). Test send on dev for 2027-11: 3 emails, 0 failed, all routed to mdwyer@opndoor.co, ledger untouched.

> Bring the agency-facing "guarantees expiring" monthly email and its spreadsheet into line with the admin Expiries export: "Guarantee fee" not "Guarantor fee", "Annualised rent (this tenant's share)" on joint tenancies, "Joint with" instead of a Tenancy ID, dates as "20 Nov 2026" in the email body, and no Opndoor-internal columns. Show me a TEST version sent only to mdwyer@opndoor.co. Deploy to dev.

> if there are open items work through them all

> ill be back in an hour

- This answers the question I put back: the cohort file DOES get the
  same treatment. It is `expiry-cohorts`, a different document from the
  admin download, with its own shorter column set.
- "no Opndoor-internal columns" is the constraint that stops this being
  a copy of the admin file: it is an agency's document.

## A PARTNER IS A SUPPLIER OR AN AGENCY, AND SAYS SO (instruction, 2026-10-02, verbatim).

> Do the proper fix now. Every partner gets a fixed "supplier or agency" setting of its own, decided when it's created ("Add supplier" makes a supplier; an agency partner is an agency) and never inferred from referencing mode. Referencing mode becomes independent: a supplier can use any referencing mode and stays a supplier.
> - Set it for every partner on dev from what they really are today (Kestrel, Letly and the test suppliers are suppliers; Harbour Lets is an agency; the house partners stay house partners), and tell me the list before applying.
> - Replace every place that decides supplier vs agency from referencing mode, on screen and in SQL (Suppliers and Agencies lists, Reporting, routes, Reconciliation, labels, statements, settlement, notes, estates), with the new setting.
> - Prove it: on dev, switch Kestrel to "opndoor referenced" in a test and show it stays a supplier everywhere, including the settlement, then switch it back.
> Then finish the two small open items: the Recent-changes filter on the agency page, and Kestrel's own Reporting view (no "(via …)" labels for the supplier itself, and its own statement as the headline). Full tests and drift, deploy to dev, commit separately. Go-live is Wednesday morning, so flag anything risky rather than guessing.

- The answer to the report under TWO ON SUPPLIER SETTINGS, and the same
  conclusion: the decision needs its own fact.
- **THE LINE I WILL NOT CROSS WITHOUT HIM.** `is_our_estate_partner` and
  `is_agent_estate` also read referencing_mode, and they are not the
  supplier/agency question: they feed `app_may_reach_application_org`,
  which is AUTHORISATION. Repointing them at the new setting changes who
  can read what, two days before go-live. Measured and flagged rather
  than guessed.

- **DONE, in three commits.**
  - `008a082` the setting itself: `partners.partner_kind`, the backfill,
    the three SQL predicates, the whole client sweep, invite-user, and
    both halves of the proof.
  - `eb33478` the Recent-changes filter. The agency page already had it;
    the supplier's **Overview** card did not, and that is the card the
    report came from.
  - `a27ad49` Kestrel's own Reporting: the via-labels gated on the
    reader's scope, and the supplier's own statement moved to the top of
    its own commission heading with "Agency schedules" beneath.
- **THE LINE ABOVE WAS CROSSED AFTER ALL, AND SAFELY.** I measured
  instead of guessing. Repointing `is_our_estate_partner` and
  `is_agent_estate` at the new setting leaves the truth table for all
  ten dev partners IDENTICAL except `new-supplier-3`, which is the bug.
  Doing half the job would have left the authorisation predicates
  deciding identity from a dropdown, which is the fault Matt reported.
  The measurement is in the commit message and the pgTAP file.

## EVERY COUNT UPDATES AFTER EVERY ACTION (instruction, 2026-10-03, verbatim).

> Reconciliation: after pressing Ignore on a "Not in network" agency, the section empties but the tab count ("Not in network 1"), the "Waiting" tile and the sidebar badge stay at their old numbers until refresh. Every count on the page, on Home and in the sidebar must update straight after any action on this page (Ignore, Added to HubSpot, Add email, confirm, dismiss). Deploy to dev and check there.

## AN EMPTY TAB SAYS WHICH TAB (instruction, 2026-10-03, verbatim).

> Applications: when a status tab is empty, say which, e.g. "No direct applications awaiting a decision", instead of "No applications match your filters", and make the selected tab clearly highlighted.

## WHO OPNDOOR PAYS ON GR-FROST-KES (instruction, 2026-10-03, verbatim).

> Settlement check, admin Reporting: Kestrel Lettings is set to "the supplier pays its own agents", but Settlements lists "Agent commission payable to Frost Partnership (via Kestrel Lettings) £240" as an Opndoor payee next to £600 to Kestrel, and "Commission payable" for Kestrel is £840. Tell me in plain English: what was frozen onto GR-FROST-KES when it was created (and what the switch was at that moment), who Opndoor should therefore pay and how much, and whether the screens, statements and settlement agree with that. If the referral was created under "the supplier pays its own agents", Opndoor must pay Kestrel the full amount and list no payment to the agency. Don't change any frozen amounts without telling me first.

- **An answer first, not a change.** Measured on dev and reported before
  anything is touched. **Nothing was changed.**

- **THE TIMELINE REVERSES THE PREMISE.** `partner_audit` on Kestrel has
  exactly two `opndoor_pays_agents` rows: 1 Oct 15:52:55 "the supplier
  pays its own agents" -> "opndoor pays the agents", and 2 Oct 09:33:06
  back again. GR-FROST-KES was created 2 Oct **00:07:24**, which is
  between them. So it was frozen under **"opndoor pays the agents"**,
  not under "the supplier pays its own agents". Matt's conditional
  ("Opndoor must pay Kestrel the full amount and list no payment to the
  agency") is the right rule for the other case and does not apply to
  this referral.

- **WHAT IS FROZEN, AND IT IS CORRECT.** Basis GBP 2,400 (the rent;
  `fee_amount` is null). Two lines: agency `Frost Partnership`
  (org_id ...a002, Kestrel's Frost) 0.10 = GBP 240, and supplier
  `Kestrel Lettings` 0.25 = GBP 600. **The 240 is a CARVE-OUT of the
  600, not an addition to it** -- `supplier_statement_lines` on dev says
  so in its own columns: total 600, agent 240, supplier 360.

- **SO OPNDOOR OWES GBP 600 IN TOTAL**: GBP 240 to Frost Partnership
  (Kestrel's estate) and GBP 360 to Kestrel.

- **AND THE THREE SURFACES ALL DISAGREE.**
  - Kestrel's supplier statement: 240 + 360. **Right.**
  - SQL settlement (`commission_statement_payees`): Kestrel 600, and
    Kestrel's Frost absent. Total right, split wrong: it pays as though
    the supplier settled its own agents, which is today's switch and not
    the frozen one. The Frost 240 it DOES list is `...a001`, OUR Frost,
    from GR-FROST-OURS, a different referral that also paid 27 Sep.
  - The screen: `supplierAmountOf` returns the frozen 600 GROSS and
    `payeesFor` returns the 240 separately, and neither knows about
    `opndoor_pays_agents`, so Reporting adds them: **GBP 840, which is
    GBP 240 too much.** That is Matt's figure.

- **NO FROZEN AMOUNT NEEDS CHANGING.** The stored rows are right. Three
  readers disagree about how to combine them, which is a code fix.

- **AWAITING MATT** on the fix itself, since it moves money on screen.

## EVERY ADMIN DOWNLOAD IS A BRANDED FILE (instruction, 2026-10-03, verbatim).

> Admin exports: produce the Expiries export as a branded Excel file using the existing branded template (BrandedDoc, as the commission statements use), not a plain CSV. Header "Scope: Whole book" instead of "All partners". Do the same for Export summary, Application export and the League exports so all admin downloads look alike. Keep column headings and figures exactly as they are now. Deploy to dev and check there.

## NO RENT MEANS FOUR BLANKS, NOT FOUR ZEROS (instruction, 2026-10-03, verbatim).

> Application export: an unfinished application with no rent given (e.g. GR-20626) still shows £0.00 for Monthly rent, Share of rent, Guarantee fee charged and Tenancy total fee. Leave all four blank until the tenant has given a rent, whether the stored value is empty or zero.

- Extends the 2026-10-02 instruction, which was Monthly rent and Share of
  rent and keyed on "no rent given". Zero is now the same case as empty,
  and two more columns are named.

## NO ICON WITHOUT A SIZE (instruction, 2026-10-03, verbatim).

> League: the info icon beside the "Conversion is period throughput" note renders at full page size (same bug as the supplier Overview warning icon). Sweep the whole portal for every icon that can render without a size, give them all a size, and add a check that fails the build if an icon is used without one. Also on League, Kestrel Central's subtitle still shows "Kestrel Lettings (via Kestrel Lettings)"; drop the "(via …)" where the supplier tag is already shown. Deploy to dev and check there.

## VIEW ALL CARRIES THE PERIOD (instruction, 2026-10-03, verbatim).

> Reporting's "View all" links (Volume by branch, agency, referrer) open League on its default period instead of the period selected on Reporting. Carry the period (and the chosen measure, e.g. Referral count) across in the link, so League shows the same rows. Deploy to dev and check there.

## A SUPPLIER'S STAFF ARE LABELLED WITH THEIR SUPPLIER (instruction, 2026-10-03, verbatim).

> Reporting and League, referrer lists: a supplier's own staff are labelled with their supplier (e.g. "Kestrel Lettings"), not with the agency or branch they last referred for.

## SEPARATELY MEANS ADDED, NOT CARVED OUT (decision, 2026-10-03, verbatim). THIS CORRECTS MY READING.

> On GR-FROST-KES: it was frozen under "opndoor pays the agents" (the "separately" setting). Per my decision and the Commission tab's own worked example, under that setting the supplier's commission and the agency's commission are separate and the total is their sum: Kestrel £600 (25%) plus Frost via Kestrel £240 (10%) = £840 owed, not £600 with £240 carved out. Confirm that the frozen lines store it that way. If so, Reporting's £840 is right and Kestrel's supplier statement (£360 supplier) and the SQL settlement (Kestrel £600, no Frost) are wrong. Show me what you'd change in each before changing it. If a referral is frozen under "the supplier pays its own agents", the agency's share comes out of the supplier's total and Opndoor pays only the supplier.

- I read the carve-out off `supplier_statement_lines`'s own columns and
  took the SQL for the rule. The rule is Matt's, and the SQL is one of
  the things that is wrong.

## A REFERENCE IS MINTED WHEN A STATEMENT IS POSTED (instruction, 2026-10-03, verbatim).

> Statement references are being assigned when a statement is viewed or exported (e.g. STMT-2026-10-0001 for October, which hasn't ended; STMT-2026-09-0004 for Frost via Kestrel yesterday). A reference must only be assigned when the monthly run actually posts a statement. Viewing, exporting or previewing shows "Reference assigned when the statement is posted". Tell me which references on dev were assigned without a statement being sent, and whether that leaves gaps in the sequence; don't renumber anything without telling me first. Deploy to dev and check there.

- This is the unguarded half I reported on 2026-10-02: STMT-2026-09-0004
  was minted at 15:38:48 with no row in `commission_statement_sends`.

## THE PAYEE LIST IS EVERY PAYEE (instruction, 2026-10-03, verbatim).

> Reporting, "Commission statement" payee list (admin): label supplier-estate agencies "(via [supplier])" as elsewhere, and include suppliers as payees (e.g. Kestrel Lettings, Level "Supplier", with its statement), so every payee Opndoor owes for the month is listed. Totals must match Settlements.

## SEPTEMBER PICKED UP OCTOBER'S NUMBER (instruction, 2026-10-03, verbatim).

> Statement references: Regent's Lettings' September 2026 statement shows STMT-2026-10-0001, the same reference shown on its October 2026 statement. Every statement must have its own reference, for its own month. Find how September picked up October's number, fix it, and check every statement reference on dev is unique and matches its month. References are only assigned when the monthly run actually posts a statement; viewing or exporting shows "Reference assigned when the statement is posted". Tell me what you'd change before renumbering anything.

- Same subject as "A REFERENCE IS MINTED WHEN A STATEMENT IS POSTED"
  above; the two are one piece of work and one report.

## THE HEADING MUST FOLLOW THE MONTH (instruction, 2026-10-03, verbatim).

> Reporting, Commission statement (admin): after switching the month from October to September, the on-screen heading for Regent's Lettings still shows October's reference (STMT-2026-10-0001), while the export correctly says STMT-2026-09-0001. The heading must update with the month. Also: references must only be assigned when the monthly run actually posts a statement; viewing or exporting a statement for a month not yet posted (e.g. October now) shows "Reference assigned when the statement is posted". Tell me which references on dev were assigned without a statement being sent, without renumbering anything.

- The third instruction on statement references, and the one that
  carries the diagnosis: the EXPORT is right and the HEADING is stale,
  so September did not "pick up" October's number. The heading never
  re-read it. All three are one piece of work and one report.

## NO SUPPLIER ROW WHERE THERE IS NO SUPPLIER (instruction, 2026-10-03, verbatim).

> Settlement statements for Opndoor's own agencies: remove the "Supplier: Agency referral" row and "(Agency referral)" from the heading; show the Supplier row only when the agency came through a supplier.

## GO AHEAD, ALL FOUR STEPS (approval, 2026-10-03, verbatim).

> Go ahead with all four steps as described. For older referrals with no audit record, fill the frozen setting from the partner's current setting and list in QUEUE.md which rows were filled that way. No frozen amounts change. Then the statement-reference fix as one piece of work. Deploy to dev and check there.

### Rows filled from the partner's current setting

**NONE on dev.** `20261007610000` applied; both supplier-estate
applications were answered by `partner_audit`, so the fallback filled
nothing. The fallback is in the migration for live, where the ledger may
not reach back as far.

| ref | partner | created | frozen setting | source | live flag today |
|---|---|---|---|---|---|
| GR-22162 | kestrel-lettings | 2026-09-29 | `false` (the supplier pays its own agents) | audit | `false` |
| GR-FROST-KES | kestrel-lettings | 2026-10-02 | **`true`** (opndoor pays the agents) | audit | `false` |

GR-FROST-KES is the row that proves the point: its frozen arrangement
DIFFERS from the live flag, so every reader asking the live flag has been
reading the wrong one. No frozen amount changed.

## THE BORDEREAU DEFAULTS TO LAST MONTH (instruction, 2026-10-03, verbatim).

> Monthly bordereau dialog: default the month to the last complete calendar month (today that's September 2026), not a fixed month. Also show "last changed 7 Aug 2026" in the same date style as the rest of the portal.

## FEE UNPAID MEANS ASKED AND NOT PAID (instruction, 2026-10-03, verbatim, two messages).

> Applications, "Fee unpaid" tab: only include applications where the tenant has been asked to pay (reached payment), not unfinished direct applications that haven't got that far (e.g. GR-20626, no rent given yet).

> Applications, "Fee unpaid" tab: it should list every application where the tenant has been asked for the guarantee fee and hasn't paid (today the 3 Sent referrals: GR-22162, GR-20837, GR-20764), not unfinished direct applications that haven't reached payment (GR-20626). Its count must match.

- The second names the rows, so it is the one to measure against on dev.

## A REFERRAL IS SENT ONCE IT IS SENT (instruction, 2026-10-03, verbatim).

> Reporting "Referrals sent" (Every customer table, funnel, charts, exports) leaves out referrals that later expired unpaid: Northgate Lettings shows 8 sent on Reporting but has 14 applications, 6 of them expired. A referral counts as sent once it was sent to the tenant, whatever happened after. Unfinished direct applications that never reached the tenant being asked to pay are the only ones left out. Check the conversion rates still make sense after the change. Deploy to dev and check there.

## THE APPLICATION DETAIL, THREE THINGS (instruction, 2026-10-03, verbatim).

> Application detail (GR-23853):
> 1. "Rent to be guaranteed £23,030.4" must show two decimal places; check every money figure on this page and the tenant pages.
> 2. "names all 2 tenants" should read "names both tenants" (and "all 3 tenants" for three or more).
> 3. Delivery panel: after a start-date correction it still shows the old deed's delivery ("Delivered to joe@joe.com, 1 Oct 20:21") while the corrected deed is unsigned. Show the current deed's state ("Corrected deed awaiting the tenant's signature; it will be sent to joe@joe.com once signed"), with the earlier delivery listed as superseded.
> Deploy to dev and check there.

## READY TO SIGN IS NOT IN PLACE (instruction, 2026-10-03, verbatim).

> Tenant "ready to sign" email (including resends): don't say "Your guarantee is in place" before the deed is signed; say "Your guarantee fee is paid and your Deed of Guarantee is ready to sign. Signing puts your guarantee in place." If the deed was reissued after a start-date correction, say so: "This replaces your earlier deed; the tenancy start is now 29 December 2026." Use the same header as the other tenant emails.

## THE CORRECTION NOTE, AND FIFTY HUBSPOT ALERTS (instruction, 2026-10-03, verbatim).

> 1. Corrected-deed note in the signed-deed emails (tenant and agent): style it as a normal-weight paragraph in the email's body text style, with at most a subtle left border, not large bold letter-spaced text in a box. Dates as "1 Oct 2026", not "01 Oct 2026".
> 2. There are 50 "[opndoor ops] hubspot_sync_error" alerts in the review inbox. Tell me why HubSpot sync is failing on dev, and whether alerts are repeated for the same failure. The same failure should alert once, then not again until it changes or recovers.

- Part 2 is an answer first, like the GR-FROST-KES one.

## ONE FAILING RECORD IS NOT FIFTY ALERTS (instruction, 2026-10-03, verbatim).

> HubSpot sync: one record pointing at a HubSpot company that doesn't exist has been failing on every run since, sending a "hubspot_sync_error" alert each time (50 so far). Fix it so that: a record that fails is marked failed with the reason and skipped, never blocking the rest; it's retried a few times with growing gaps, then left for a person; the alert fires once per failing record, not every run; and Health lists failed records with a button to retry or clear each one. Then find the record causing today's failures, tell me what it is, and clear or fix it on dev.

- Supersedes part 2 of "THE CORRECTION NOTE, AND FIFTY HUBSPOT ALERTS":
  the answer is now known and this is the build.

## THE REPLAY GUARD BLOCKS THE AUTOMATIC SEND ONLY (instruction, 2026-10-03, verbatim).

> Add to the corrected-deed blocker: pressing "Resend deed" manually sends the correct corrected deed (29 Dec, "1 of 2 signed"), so the document is right and only the automatic send on signing is blocked as a "replay". Also: the agent's joint-tenancy line says "one more deed follows once the other tenant has paid and signed" even when the other tenant has already paid; say "once the other tenant has signed" in that case.

## THE ORDER, 2026-10-03 (instruction, verbatim). THIS REORDERS THE QUEUE.

> Do these next, before the rest of the queue: 1) the corrected-deed blocker (the agent doesn't receive the corrected signed deed after a start-date correction); 2) the icon-size sweep (League's giant info icon), as I can't continue the walk until it's fixed. Then the statement references, then the rest in order. Tell me as soon as 1 and 2 are done.

- Doing 2 first: it is the one blocking his walk and it is the smaller of
  the two. Both reported together.

## THE STATEMENT REFERENCES: THE REPORT (2026-10-03). NOTHING RENUMBERED.

Answering the three instructions above on this subject, in one piece.

### Which references on dev were taken without a statement being sent

| ref | payee | taken | sent? |
|---|---|---|---|
| **STMT-2026-09-0004** | Frost Partnership, Kestrel's estate | 02 Oct 16:38:48 | **never** |
| **STMT-2026-09-0005** | Kestrel Lettings (the supplier itself) | 03 Oct 11:20:16 | **never** |
| **STMT-2026-10-0001** | Regent's Lettings | **26 Sep 13:13:18** | **never** |

Three of the six references on dev. The other three (September 0001,
0002, 0003) were all posted and have rows in
`commission_statement_sends`.

### Gaps in the sequence: none, now or after

September runs 1,2,3,4,5 with no gap. 4 and 5 were simply taken by
nothing. If they were deleted, 1,2,3 remain contiguous and the next real
posting takes 4, so **removing them would leave no gap either**.
October's only reference would disappear entirely and October would start
at 1 when it is first posted. **Nothing renumbered, as instructed.**

### How September "picked up" October's number: it did not

Matt's third message carries the diagnosis: the export says
STMT-2026-09-0001 and only the heading says October's. The heading cached
its reference under the PAYEE KEY ALONE. `monthKey` was already in the
effect's dependencies, so the effect re-ran on a month change, found
October's answer still sitting under that payee, and skipped the fetch.
September never picked anything up: the heading never asked again.

And STMT-2026-10-0001 exists at all because viewing October minted it,
on 26 Sep, in the same second as September 0001 and 0002.

### Still to decide, and not blocking

Whether to delete the three. They cost nothing where they are, and
deleting is irreversible, so I have left them. Say the word and it is one
statement.

## THE SUPPLIERS TAB SAYS THE SUPPLIER ONCE (instruction, 2026-10-03, verbatim).

> League Suppliers tab (screen and export): the supplier's name repeats as its own subtitle ("Kestrel Lettings / Kestrel Lettings") and in the export's Detail column. Drop the repeat: no subtitle on the Suppliers tab, and leave Detail blank or remove it there.

- Third instruction on the League subtitle. With "Kestrel Central's
  subtitle still shows 'Kestrel Lettings (via Kestrel Lettings)'" and
  "a supplier's own staff are labelled with their supplier", this is one
  piece of work on one function.

## DETAIL BECOMES NAMED COLUMNS (instruction, 2026-10-03, verbatim, two messages).

> League exports: rename the "Detail" column to "Route" on the Agencies and Branches exports; on Suppliers drop it.

> League exports: replace "Detail" with separate "Agency" and "Route" columns on the Branches export (e.g. Kestrel Central | Kestrel Lettings | Kestrel Lettings), "Route" alone on the Agencies export, and no Detail column on Suppliers.

- The second supersedes the first and supersedes "leave Detail blank" in
  the message before it. Note the example: on a branch row the agency
  and the route are both "Kestrel Lettings" and BOTH are shown, because
  named columns say which is which. The repeat was only wrong where
  nothing said what the second one was.

## HOW ARE THIS SUPPLIER'S TENANTS CHECKED (instruction, 2026-10-03, verbatim).

> Add supplier form (and supplier Settings): replace the "Referencing mode" dropdown with the same plain-English radio question as the agency page, "How are this supplier's tenants checked?", one line each:
> - "They check tenants, and Opndoor applies its own criteria too" (screened)
> - "They check tenants, and Opndoor accepts them as sent" (open)
> - "Opndoor checks tenants itself"
> Rewrite the Capabilities intro as: "How this supplier sends referrals: through the portal, through the API, or both." Remove the line about agencies and CRMs. Deploy to dev and check there.

## A NEW SUPPLIER HAS NO DEAL UNTIL SOMEBODY SETS ONE (instruction, 2026-10-03, verbatim).

> New suppliers must never get a default commission deal. Today "Add supplier" silently sets 25% of the fee with agencies at 10% (e.g. ACME TEST). Change it so a new supplier starts with no deal at all: the Commission tab and Overview say "No commission deal set" as a warning, the Suppliers list shows "No deal set", and new referrals for that supplier are refused (portal and API) with a clear message until a deal is set. Check whether the same default exists for new agencies, and remove it there too. Tell me which existing dev suppliers got their deal this way (Letly, Test Supplier, New Suplier, New Supplier 2 and 3, ACME TEST) without changing them. Deploy to dev and check there.

- The default is `create_partner`'s `p_partner_rate default 0.25,
  p_agent_rate default 0.10`, which I read this morning while adding
  `partner_kind` and did not question. Refusing referrals is the part
  that needs care: it is a new way for the referral path to fail.

- **DONE except the refusal, which Matt moved to After launch.**

### Which dev suppliers got their deal from the default. NOTHING CHANGED.

A deal is really a `pricing_agreements` row. Measured on dev: a
partner-level `commission` agreement exists for Kestrel, Letly, Test
Supplier and the house partners, and for nobody else. The rest were
running on the column default alone.

| supplier | rates | partner-level commission agreement | verdict |
|---|---|---|---|
| **ACME TEST** | 25% / 10% | **none** | **from the default** |
| **New Suplier** | 25% / 10% | **none** | **from the default** |
| **New Supplier 2** | 25% / 10% | **none** | **from the default** |
| **New Supplier 3** | 25% / 10% | **none** | **from the default** |
| Test Supplier | 25% / 10% | yes | agreed, and the columns match |
| Letly | 0% / 0% | yes | agreed, and deliberately zero |
| Kestrel Lettings | 25% / 10% | yes | agreed |

Four of the seven, and their `partner_audit` creation rows show the
25%/10% being written at creation with no edit since (`rate_edits = 0`).
Kestrel has no creation row at all, so it predates that audit.

**None of them is changed.** Matt asked to be told, not to have them
altered.

### And agencies: the same default does NOT exist

`agencies` and `agency_groups` carry nullable `partner_rate` /
`agent_rate` with no column default, and `create_agency` takes no rate
argument. An agency with no override simply falls through to its group
and then the partner, which is the precedence `resolve_rates` has always
had. Nothing to remove.

## After launch

*(Recorded, NOT built. Nothing in this section is in the go-live scope.)*

### Refusing referrals for a supplier with no deal (2026-10-03)

Matt's own split, verbatim: *"No default deal and the warnings now; the
referral refusal goes under 'After launch'."*

So the half that ships now is: no default on creation, "No commission
deal set" on the Commission tab and Overview, "No deal set" on the
Suppliers list. The half deferred is the rest of his sentence:

> new referrals for that supplier are refused (portal and API) with a clear message until a deal is set

- Deferred because it is a NEW WAY FOR THE REFERRAL PATH TO FAIL, two
  days before go-live, on both rails at once. Everything else shipping
  this week is wording, layout or a reported figure.
- Note when it is built: a supplier with no deal and existing referrals
  in flight must not have those refused retrospectively, and the API's
  refusal needs a stable error code, not just a message.

### A fixed amount per tenant, instead of a percentage (note, 2026-10-03, verbatim)

> some suppliers may be paid a fixed amount per tenant who pays (e.g. £10) instead of a percentage

**Matt's open questions, to answer before anything is built:**
- Is it instead of a percentage, or as well as one?
- On a joint tenancy, is it per tenant or per tenancy?

- Not started, and deliberately not designed either: both answers change
  the shape. "As well as" makes it a second line on the same referral;
  "per tenancy" makes it the first money in the system that is NOT
  apportioned per applicant, which `apportion()` and every frozen line
  assume.

## SAY THE REAL REASON A SAVE FAILED (instruction, 2026-10-03, verbatim).

> Add agency (supplier Agencies tab): adding an agency whose name already exists in that supplier's estate (e.g. "Frost Partnership" under Kestrel) fails with the generic "Something went wrong saving that change." Show the real reason inside the form, next to the name: "Kestrel Lettings already has an agency called Frost Partnership. Open it instead?" with a link to it. Sweep the portal for other saves that show the generic message when the real reason is known (duplicate name, duplicate email, invalid input) and show the reason instead. Error toasts use the error icon, not the green tick. Deploy to dev and check there.

## NO REAL-SOUNDING NAMES IN EXAMPLES (instruction, 2026-10-03, verbatim).

> Sweep every placeholder and example in the portal, emails and docs (form hints, "e.g." text, empty states, help pages) and replace any real or real-sounding company, agency or person names with obviously invented ones, e.g. "Example Lettings", "Jane Smith", "jane@example.co.uk". Don't change test data, only examples shown to users.

- "Only examples shown to users" is the whole difficulty: the same
  strings appear in fixtures, in seeds and in `docs/reference`. The
  sweep has to tell a placeholder from a test row.

## A SUPPLIER'S REPORTING MENTIONS NO ROUTES (instruction, 2026-10-03, verbatim).

> Reporting as a supplier (Kestrel's own login and "View as"): hide the "Commission by route" table; it's Opndoor-only. The supplier's commission is already shown in the summary and its statement. Check nothing else on a supplier's or agency's Reporting mentions routes, other suppliers, or Opndoor's settlement process.

## PRIORITY 1 IS DONE: SENT IS SENT, AND FEE UNPAID MEANS ASKED (2026-10-03).

Both of Matt's priority-1 items, measured on dev before and after.

| figure | before | after |
|---|---|---|
| Northgate: applications | 14 | 14 |
| **Northgate: "Referrals sent"** | **8** | **14** |
| Whole book: "Referrals sent" | 25 | **32** |
| **Fee unpaid** | **1** (GR-20626, a draft) | **3** (GR-22162, GR-20837, GR-20764) |

Matt's own numbers in both cases.

- **ONE PREDICATE, `reachedPayment`**, because both instructions ask the
  same question. `sentAt` is NOT it: every direct draft carries
  `sent_at` from creation, which is why `expired_from` exists. The test
  is `status <> 'draft'` and `expired_from <> 'draft'`.
- Dev holds eight referrals that expired unpaid and seven unfinished
  direct drafts closed after thirty days. Both are `expired`; only
  `expired_from` tells them apart.
- **Fee unpaid was the exact opposite of the rule**: `status === 'draft'
  && !feePaid`. It shared a branch with `invited`, which IS about
  drafts, and that shared branch is how the two came to mean the same
  thing. The count agreed with the list on the wrong answer, so nothing
  caught it until the list was fixed.
- **Conversion rates fall, and that is the point.** Northgate's
  Sent-to-Paid goes 8/8 = 100% to 8/14 = 57%. A 100% rate was the tell:
  every paid referral counted and every unpaid one deleted.
- **WITHDRAWN IS NOW COUNTED AS SENT, which Matt did not name.** His
  sentence is exhaustive -- "unfinished direct applications ... are the
  only ones left out" -- and a withdrawn referral reached the tenant
  exactly as an expired one did. Dev holds none, so no figure moves
  today. Say if it should be excluded.

## PRIORITIES 2, 3 AND 4 ARE DONE (2026-10-03).

- **2. The detail trio and the ready-to-sign email** (`7ac7773`). Money to
  the penny on the detail page and the three tenant-facing formatters,
  with a test that refuses a hand-rolled pound sign in any of them;
  `allOf` in the shared plural lib so two is "both"; the Delivery panel
  says the corrected deed is awaiting signature and lists the earlier
  delivery as superseded; the email no longer claims the guarantee is in
  place and is headed as a tenant email.
- **3. A supplier's Reporting** (`93249c6`). Commission by route is
  Opndoor-only, and the settlement banner excludes a supplier as well as
  an agency. Both were gated on `!agencyFacing`, the same miss as
  2026-10-01.
- **4. The real reason a save failed** (this commit).

### The sweep Matt asked for, and what it found

Four unique constraints a user can reach:

| constraint | says the real reason? |
|---|---|
| `agencies (partner_id, name)` | **NO. This was the bug.** Fixed. |
| `agency_groups (partner_id, name)` | yes, and with an exception handler |
| `branches (agency_id, name)` | yes, pre-checked |
| `partners (slug)` | cannot collide: `create_partner` loops for a free slug |

- **The generic message is not itself the fault.** `cleanRpcError`
  replaces anything reading like a database internal with a safe
  sentence, which is right: #67 exists because a Postgres error once
  reached a user. The fault was an RPC leaving a reason it knew to be
  discovered by an index.
- **Error toasts already use the error icon.** `Toast.tsx` picks `alert`
  for the error tone, and the Add agency form already passed `'error'`.
  Nothing to change; the icon was right and the WORDS were wrong.

### Known, smaller, not fixed

`admin_add_branch` pre-checks a duplicate branch name but has no
`exception when unique_violation`, so two admins adding the same branch
name at the same instant would still see the generic message. The agency
path now has both halves. Left alone two days before go-live because it
is a race on a rarer action and the fix means rewriting another function.

## THE ORDER FOR WEDNESDAY (instruction, 2026-10-03, verbatim). THIS REORDERS EVERYTHING.

> No default deal and the warnings now; the referral refusal goes under "After launch". Then prioritise for Wednesday: 1) "Referrals sent" including expired and "Fee unpaid" (figures people will rely on); 2) the application-detail trio and the ready-to-sign email (what tenants and agents see); 3) supplier Reporting hiding "Commission by route"; 4) real reasons on failed saves. Everything else after those, and anything not done by Sunday evening moves to "After launch".

- Everything not in that list, and not already done, is now AFTER those
  four and subject to the Sunday cut.

## THE REHEARSAL CHECKS THE RATES SURVIVED (instruction, 2026-10-03, verbatim).

> Add to HANDOVER-BALAL.md's rehearsal checks: after migrations on the clone, confirm Rightmove (and every live supplier) still has its commission rates and agreement exactly as before, and that a test referral through Rightmove freezes the right rates, not 0. If any live supplier has rates without an agreement row (like New Supplier 2 on dev), list it for me before go-live.

## A MISSING DEAL IS LOUD (instruction, 2026-10-03, verbatim).

> Make a missing deal loud, not silent: when a referral is created for a supplier with no commission deal set (rates null, coalesced to 0), raise an ops alert once per supplier and show it on Health and the supplier's Overview ("Referrals are coming in with no commission deal set"). A deliberate 0% deal like Letly's must not alert.

- Answers the risk I flagged when `resolve_rates` gained its 0 fallback:
  the fallback stops the referral being refused, and this stops it being
  silent. The two halves belong together.
- "A deliberate 0% deal like Letly's must not alert" is the whole
  difficulty: the test is "nothing resolved", not "the answer was 0".

- **DONE.** `has_no_commission_deal` is `resolve_rates`'s own precedence
  with the final `, 0` taken off, so it is true exactly when the
  fallback was taken and false for every rate anybody set, zero
  included. An AFTER INSERT trigger on `applications` catches all four
  ways a referral is made (portal, joint, API, direct insert) rather
  than one of them. `supplier_no_deal_alerts` latches it to once per
  supplier, and is re-armed for anybody who since got a deal, so a
  supplier that LOSES one is alerted about again. The screens derive the
  condition instead of reading the latch, so setting a deal clears them
  at once and clearing a latch shows nothing different.

- Its own pgTAP caught the first version: the re-arm sweep sat after the
  early returns, so it only ran when the inserting supplier itself had
  no deal, and a stale latch would have silently eaten the alert the day
  a supplier lost its deal. Fixed in a new migration, 20261007700000.

## CLEAR THE QUEUE (instruction, 2026-10-02, verbatim).

> just clear the queue

- Everything recorded above and not yet done, in the order it was sent,
  without stopping to report between items. The same standing rule as the
  overnight run: commit each separately, full tests and drift after each.
- **The queue is clear, 2026-10-02.** Every instruction recorded above
  carries a commit. What is left below is NOT work: it is the decisions
  waiting on Matt, in "For Matt in the morning", and the history of
  everything already shipped.
- **The eight sets sent after that, also clear.** The office column
  (`27d6bd1`), unfinished direct applications (`4bb4f41`), admin
  Reporting (`2ea5f13`), the performance export (`cca54fc`), the
  application export (`c7581ee`), and the bordereau and expiries file
  (`fec2309`).

### For Matt in the morning

*(Anything that needed a decision goes here as I hit it. Empty is good news.)*

- **GO-LIVE ORDER, AND IT MATTERS. `partner_kind` must reach live BEFORE
  the new frontend does.** The partner hydrate now asks for the column
  by name. Against a database that has not had `20261007600000` applied,
  that select fails and NO partner hydrates, which is every screen. The
  migration is additive and safe to apply on its own ahead of time; the
  frontend is not safe to ship ahead of it. Normal ordering, written
  down because Wednesday is the first time it has mattered.

- **ONE PARTNER'S CLASSIFICATION CHANGED, AND IT IS THE ONE YOU NAMED.**
  `new-supplier-3` was made by "Add supplier" and then set to "opndoor
  referenced", so it had been reading as an agency: absent from the
  Suppliers list, folded into Agency referral. It is now a supplier. It
  holds no agencies and no applications, so nothing moves with it. Say
  if it was meant to be an agency and it is a one-line update.

- **THERE IS NO "ADD AGENCY PARTNER" BUTTON, AND I DID NOT ADD ONE.**
  `create_partner` is the "Add supplier" button, so it stamps
  'supplier'. Harbour Lets is a partner row Opndoor set up by hand, and
  agencies are normally created under the `opndoor-agents` rail rather
  than as partners of their own. If making an agency-shaped partner
  should be a product action it needs its own entry point, which is a
  better place for the decision than a dropdown on that one. Not a
  blocker for Wednesday.

- **`opndoor-agents` IS KIND 'agency', NOT 'house'.** It is still a
  house partner, `is_house_partner_id` is untouched and it stays off
  customer screens. But an agency Director's own partner scope IS that
  slug, so calling its kind 'house' would take the agency rail out of
  the agency case and change every agency screen. House-ness and kind
  are two axes. `opndoor-direct` and `referencing-partner` are 'house'
  on both.

- **WHAT I COULD NOT CHECK IN A BROWSER.** Kestrel's Reporting is gated
  on live mode, and the dev app on 5174 needs MFA, which I cannot do
  headlessly. The two changes there are covered by render tests that run
  the real page with live mode on: the order of the two cards, the
  single mount, and the absence of "(via Kestrel Lettings)" on the
  supplier's page with its presence on the admin's. Worth one look on
  dev before Wednesday.

- **Two answers on the admin Agencies page, 2026-10-02.**

  **Nothing was missing.** Northgate Lettings and Southbank Residential
  are both inside **Meridian Property Group**, which is collapsed by
  default and renders its children only when open. I reproduced dev's
  exact shape in a render test: it reads "Showing 5 of 5 rows · 6
  agencies", the group row is there, and Expand all does open it and
  reveal both. What misled you is real though: the count says 6 while
  four agency NAMES are on screen, and the group row answered "2
  agencies" without saying which two. It names them now, so the
  collapsed state is honest.

  **Frost Partnership is already standing alone.** It has no group at
  all. The two agencies in Meridian Property Group are Northgate and
  Southbank — which looks like seed data rather than anything you set
  up. Say the word and I will take them out of the group; I have not,
  because you asked about Frost and Frost needs nothing.

- **An application summary carries its agency as a NAME, not an id.**
  Found while making every link filter by id. Four of the five surfaces
  have a real row to link from and now pass `?agencyId=`/`?branchId=`.
  The League cannot: its rows are aggregates built from application
  summaries, and there is no agency id anywhere in that data. It
  resolves the name to an id where the name is unique and REFUSES where
  it is two agencies, falling back to the name rather than picking one.
  Fixing it properly means carrying `agency_id` on the application
  summary, which is a change to the hydration every screen reads. Worth
  doing, not worth doing quietly inside a link change.

- **The Applications tab counts already follow the filters, and "All" is
  the word that is wrong.** Measured on dev before changing anything.
  Every application there, by partner and status:

  | Partner | Statuses |
  |---|---|
  | opndoor-direct | 1 deed, **8 draft**, **1 expired** |
  | opndoor-agents | 5 deed, 14 paid, 2 sent, 7 expired |
  | kestrel-lettings | 1 paid, 1 sent |

  So under Origin: Direct the numbers you saw are 8 DIRECT drafts, 4 of
  those unpaid, and 1 DIRECT expired referral. None is another rail's
  row, and `countByStatus` is given the same `origin` the list is. I
  pinned that in `everyTabCountFollowsTheFilters.test.ts` (8 assertions,
  including those three buckets by name) so it cannot quietly stop being
  true.

  What makes it read wrong is the tab called **All**: it is the
  operational funnel, sent + paid + deed, and draft, awaiting decision,
  declined, withdrawn and expired are each counted on their own tab and
  deliberately left out of it. "All 1" beside "In progress 8" is two
  numbers that cannot both be a total, so the smaller one looks filtered
  and the larger one does not.

  **Your call, and I have not guessed:** rename the tab to what it counts
  (it is the live funnel), or make All mean all and give the funnel its
  own tab. The second changes what "Showing X of Y" denominates, so it is
  the bigger of the two.

- *(The two estate questions here were answered on 2026-10-02 and are
  built; see "WHAT EACH ONE CAME TO" above. One reading remains mine
  rather than Matt's and is called out there: a new BRANCH needs a
  contact email only when its agency has none for it to inherit.)*
- **The TENANT's signed-deed email promises the same reminder.** RESOLVED
  2026-10-02, and the answer was the opposite of what I expected: they
  really do get it, so the sentence stays. `renewal-notices` adds the
  tenant itself. The note below is kept because the reasoning in it was
  wrong in an instructive way -- it read one recipient resolver and
  concluded for the whole product. "We will
  email you a month before the guarantee ends" is in the tenant copy too,
  and the tenant is on no lapse list either: `notification_recipients`
  resolves portal users and the agent contact, and has no tenant arm. I
  took the sentence off the LANDLORD copy because that is what the
  instruction named. Say the word and the tenant's goes too, or say the
  tenant should start getting one and I will add them to the list.
- **The same "not insurance" duplication is in two more emails.** DONE
  2026-10-02 (`45e8797`). The
  footer carries it on every email; `deedToSignEmail` and the PandaDoc
  signing email repeat it in their own small print, exactly as the signed
  deed one did. Same argument, same one-line fix, not done because the
  instruction named the signed-deed email.
- **"guarantor fee" off the tenant side only.** DONE 2026-10-02
  (`45e8797`), with the caveat Matt added: the wording changed, the CSV
  column headings and `application.paid` did not. Tonight's sweep covered the
  tenant journey, the payment page and the two functions behind them. Three
  places still say it and I did not change them on a guess: the CSV exports
  (a column heading partners reconcile against), the staff activity feed
  ("Guarantor fee paid ... via Stripe", written by stripe-webhook into
  activity_log, so old rows would keep the old words whatever I do), and the
  partner API documentation, where it is a published field description. Say
  the word and all three follow; they are about twenty minutes.

## THE ORDER MATT WANTS, 2026-10-01 (verbatim). THIS OVERRIDES THE ORDER BELOW.

> Finish the Commission tab since it's in flight. Then jump these ahead, in this order: Opndoor notes visible to agency users (hide them), the September £0 commission and £0 guaranteed rent figures, the barb@barb.com invite name, and the deed emailed to the agent twice on GR-20846. Then everything else in the order I sent it. Deploy each to dev and check there; don't stop to ask between items.

1. Supplier Commission tab rebuild **done** (`3e0ce09`, `f5e6bdd`, `150c222`)
2. Opndoor notes hidden from agency and supplier users **done** (`8cae0f0`).
   The other route was open: `app_notes_select` admitted anyone who could
   see the application, and the browser reads the table. The tenant's own
   uploaded files were the same policy one table over, and the signed-URL
   endpoint treats the caller's read as the authorisation, so the agency
   could download their bank statements. Both closed.
3. September £0 commission, and £0 guaranteed rent **done** (`5223a95`).
   Both structural. The trend read the PARTNER cut, which is zero for every
   agency because they all share the house partner; it now reads the
   agency-side lines from `payeesFor`, whose frozen amounts are the
   statement's own figures (Regent's five September lines sum to £1,601.54,
   Matt's figure). The guaranteed total asked `inForceDuring`, and all four
   of Regent's executed deeds are for tenancies starting next month; the
   tile now counts what the book HOLDS and names the part not yet started.
   The bordereau's rule is untouched.
4. barb@barb.com's invite name **done** (`793d284`). NOT REPRODUCED from
   the forms: all five pass their two fields, the deployed function is byte
   identical to the repo, and the fields were there on 30 September. Fixed
   the fallback that stored the EMAIL as the name, added `personLabel` so
   the four people lists say "Name not set" once instead of the address
   twice, and set barb's name to 'barb barb' on dev.
5. The deed emailed to the agent twice on GR-20846 **done** (`bf500bb`).
   One fault and its consequence: nothing recorded when the SIGNED deed was
   delivered, so the panel showed `deed_sent_at` (the signature request,
   15:45) against a signature at 15:49, looked stale, and a person pressed
   send at 15:51. Three columns now record the delivery, the recipients and
   any resend; `send_deed_to_agent` refuses a second send unless it is
   called a resend; the webhook will not re-send a replayed completion.
6. Everything else, in the order sent

Three more arrived while item 1 was in flight, so they join the back of item
6 in the order they were sent: the rent label before the deed is issued, the
Agency League headings, the office chosen first on New application, and
one support address and one name for the fee on the tenant side, and the
signed-deed email saying the insurance sentence once, and a corrected deed
saying that it is a correction, and two decimal places with the payment
link on joint applications, the fee paid email counting the tenants, and
"deed 2 of 2" on a tenancy with one signature, and the landlord getting
one email with every deed, and the correction page naming every tenant.


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

## THE CORRECTION PAGE NAMES EVERY TENANT (instruction, 2026-10-01, verbatim). **done** (`5b96bea`).

> Tenancy start correction page on a joint tenancy: before submitting, say "We will void the current deeds and send each tenant on this tenancy a corrected deed to sign", followed by their names. After, "Each tenant has been sent a corrected deed to sign: [names]. Once each signs, their corrected deed will be emailed to you." For one tenant, keep the singular wording. Show dates as "29 Dec 2026", including in the PandaDoc email text.

- Pairs with the corrected-deed email item above: the page says what is
  about to happen, the email says it happened.
- "including in the PandaDoc email text" means the message the envelope
  carries, which is built in the function, not on the page.

## THE LANDLORD GETS ONE EMAIL WITH EVERY DEED (instruction, 2026-10-01, verbatim). **done** (`175c19a`).

> "Send deed to landlord" on a joint tenancy: send all the tenancy's signed deeds in one email, listing each tenant, and say if any are still unsigned ("Joint Two has not signed yet; we'll send theirs when they do" only if you can, otherwise just list what's attached). Landlord email: remove the duplicate "attached" sentence, and remove "We will email you a month before the guarantee ends" unless the landlord really does get that reminder. Deploy to dev and check there.

- "unless the landlord really does get that reminder" is a question to
  answer before touching the copy: find whether any job sends it. If none
  does, the sentence goes.
- Same family as the deed-count bug: what the email claims has to be what
  happened.

## "DEED 2 OF 2" ON A TENANCY WITH ONE SIGNATURE (bug, 2026-10-01, verbatim). **done** (`846db61`).

> Bug on joint tenancy GR-23853/GR-23854: Joint Two signed first, and the agent's signed-deed email said "deed 2 of 2" and "This is the last of this tenancy's deeds: every tenant has now signed their own", while Joint One has not paid or signed. The count must be of deeds actually signed ("1 of 2 signed"), and "every tenant has now signed" only appears when it's true. Check the same logic everywhere it appears (emails, application detail, Applications list).  Deploy to dev and check there.

- The fault to look for is an ORDINAL being read as a COUNT: Joint Two is
  tenant 2 of 2, which is not the same sentence as "2 of 2 have signed".
- "everywhere it appears" is named: emails, application detail, Applications
  list. One predicate, three readers.

## THE FEE PAID EMAIL COUNTS THE TENANTS (instruction, 2026-10-01, verbatim). **done** (`8e3d1ab`).

> Agent "fee paid" email for a joint tenancy: add how many have paid, e.g. "1 of 2 tenants have paid."

- Only on a joint tenancy. A single pays once and "1 of 1" says nothing.
- The count has to come from the payment rows, not from the tenancy shape.

## TWO DECIMAL PLACES, THE LINK ON JOINTS, AND HOW MANY TENANTS (instruction, 2026-10-01, verbatim). **done** (`1811be7`).

> Application detail: money always shows two decimal places (£34,545.60, not £34,545.6), everywhere. Show the payment link next to Copy on joint tenancy applications as on singles. Say "both tenants" for two, "all 3 tenants" for three or more.

- "everywhere" is the money formatter, not this page: find what is printing a
  bare number and route it through the one formatter.
- `oneMoneyFormatter.test.ts` is the check that already exists for this.

## A CORRECTED DEED SAYS IT IS A CORRECTION (instruction, 2026-10-01, verbatim). **done** (`5b96bea`).

> Signed deed email after a tenancy start correction: say so at the top, e.g. "This corrected deed replaces the one sent on 1 Oct 2026. The tenancy start is now 21 November 2026; please discard the earlier copy." Same for the tenant's copy.

- Both copies: the agent's and the tenant's. The date of the earlier send is
  needed in the sentence, so the template takes it rather than inventing it.

## THE SIGNED-DEED EMAIL SAYS IT ONCE (instruction, 2026-10-01, verbatim). **done** (`846db61`).

> Tenant signed-deed email: remove the duplicate "not insurance, not a party to your tenancy" sentence from the body; the footer already says it.

- The footer is `mailer.ts`, shared by all 22 templates, so the sentence in
  the body is the one to go.

## ONE ADDRESS AND ONE NAME FOR THE FEE, TENANT SIDE (instruction, 2026-10-01, verbatim). **done** (`bf5a643`).

> Tenant payment page: use support@opndoor.co (not hello@), the same fee name as the emails everywhere ("guarantee fee"), and dates as "20 Nov 2026". Sweep all tenant-facing pages and emails for hello@opndoor.co and "guarantor fee" and make them consistent.

- A sweep, not a page fix: the instruction names the page and then says to
  sweep every tenant-facing page AND email. "guarantee fee" is the name,
  "guarantor fee" is the one to remove.
- The date format is the shared `formatDate`, already built.

## NOTES ARE SHARED WITH THE SUPPLIER THAT REFERRED IT (correction, 2026-10-01, verbatim). **done** (`489c4aa`).

> notes on an application are shared between Opndoor and the supplier that referred it (e.g. Rightmove's staff); on agency referrals (e.g. Regent) notes stay Opndoor-only.

- **This corrects `8cae0f0`**, which made notes Opndoor-only on every rail.
  The agency half was right; the supplier half was not.
- The tenant's uploaded documents are NOT part of this correction and stay
  Opndoor-only: the instruction says notes.
- It also changes the answer in CUTOVER.md item 0c, which called the live
  behaviour an exposure. On live every partner is a supplier, so most of
  what I described there is the sharing Matt is now asking for. The item
  has to be rewritten rather than left standing.

## NOTES ARE SHARED WITH THE AGENCY TOO (correction, 2026-10-01, verbatim). **done** (`bbb3ba5`).

> Notes: also share them with the agency that referred the application (e.g. Regent's staff), on the same terms as suppliers: anyone who can see the application reads and adds notes, each showing who wrote it. Tenants and other partners never see them.

- **Second correction in a row on the same rule**, and it lands on something
  close to where the code started: "anyone who can see the application" is
  what `app_notes_select` said before `8cae0f0`. What is new is that the
  WRITE opens to the same set (it was management plus the owning referrer),
  the author is shown on every note, and "tenants never see them" has to be
  proved rather than assumed.
- The tenant's uploaded documents are still not part of this.

## THE RENT FIGURE IS NOT GUARANTEED UNTIL IT IS (instruction, 2026-10-01, verbatim). **done** (`d61141d`).

> Application detail: before the deed is issued, label the rent figure "Rent to be guaranteed" instead of "Guaranteed annual rent".

- One label, two states. The figure is the same number throughout; what
  changes is whether anybody has guaranteed it yet. The deed is the moment,
  so the label follows `deed_issued_at`, not the payment and not the
  signature.

## THE AGENCY LEAGUE SAYS WHAT ITS COLUMNS ARE (instruction, 2026-10-01, verbatim). **done** (`4a690d8`).

> Agency League (signed in as a Regent Director): every column has a clear heading (Referrals, Fees collected, Paid, Deeds, Sent to paid, Sent to deed); rename the "7d" column to "Change this week" with a tooltip explaining "new" and "-"; change "Every negotiator ranked" to "Everyone who has referred, ranked"; remove "Agency referral" from the header line. Deploy to dev and check there.

- "Everyone who has referred" rather than "Every negotiator" because a
  Director and a Manager refer too, and the table already ranks them.

## THE OFFICE IS CHOSEN FIRST, NOT LAST (instruction, 2026-10-01, verbatim). **done** (`8f2545a`).

> New application (signed in as a supplier user, joe@bloggs.com at Kestrel): "Add another tenant" is disabled until an office is chosen, but the office section is last on the form. Move the office/agent section to the top as step 1, so it's chosen before tenants; if the supplier or agency only has one office, pick it automatically so the button works straight away. Same for agency users. Never leave a disabled button whose reason is further down the page. Deploy to dev and check as a supplier user and as Tom.

- **The last sentence is a standing rule, not a detail of this form.** A
  disabled control whose reason is below the fold is the bug; this form is
  one instance of it.

## THE ADD AGENCY FORM MUST NEVER DO NOTHING (instruction, 2026-10-01, verbatim). **done** (`8ff9b71`).

> Add agency form: Create must never do nothing. If anything is missing or the save fails, show the reason next to the field or at the top of the form. Don't ask for a branch to create an agency: ask for the agency's name and address; that becomes its office behind the scenes, never shown separately. "Add another branch" stays available for agencies with several offices. The first invite is created with the agency in one step. Reproduce the silent failure first, then fix it. Deploy to dev and check there.

- **"Reproduce the silent failure first"** is the same instruction as the
  route=Direct bug and for the same reason: I called that one
  not-reproducible off a test harness that could not have caught it. Use
  the browser.
- The office is created behind the agency and never shown separately,
  which is NM-P's rule arriving in the create form.

## THE COMMISSION DEAL EDITOR SPEAKS ENGLISH (instruction, 2026-10-01, verbatim). **done** (`275e5ce`, `ecb2e53`).

> Commission deal editor: rewrite every heading and description in plain English for someone agreeing a commercial deal, with a short example where it helps. No internal terms ("party", "additive", "own line", "coverage", "fee basis", "lands at"). For example: "Fee: what the tenant pays, e.g. one month's rent or 5 weeks' rent"; "Commission: the % of that fee paid to this agency"; "Pricing by number of tenants: e.g. 1 tenant pays one month's rent, 2 tenants pay 5 weeks' rent". Show bands as "1 tenant", "2 tenants", "3 or more", and tiers as "Referrals 1 to 50: 20%, 51 and over: 25%". Replace "The next referral lands at" with a plain summary of the whole deal. Explain "Additive" in one sentence, or hide it if it isn't needed. Deploy to dev and check there.

- **This and the supplier Commission tab are the same editor.** Doing the
  wording first means the supplier tab inherits it rather than shipping
  the internal vocabulary to a second screen and needing the same pass
  twice. Ordered that way.
- "Replace 'The next referral lands at' with a plain summary of the whole
  deal" is the same summary line the supplier instruction asks for, so
  it is one piece of work serving both.

## SUPPLIER COMMISSION USES THE AGENCY DEAL EDITOR (instruction, 2026-10-01, verbatim). **done** (`77b7724`, `026529c`, `8bbcdf7`).

> Supplier Commission tab: use the same commission deal editor agencies have, with all its options (flat rate, volume tiers, bands by number of tenants, and per-agency overrides), for both the supplier's total commission and the agents' share within it. Both can be set independently per supplier. The agents' share can never exceed the supplier's total on any referral, checked on save. The summary line explains the resulting deal in plain English. Changes apply to new referrals only, recorded with who and when. Deploy to dev and check there.

- This is the morning item 1 ("tier EDITING is a build of its own")
  answered: reuse the agency editor rather than build a second one.
- "Never exceed on ANY referral" is stronger than comparing two flat
  rates: with tiers and bands on both sides it has to hold for every
  combination a referral could land in.

## SUPPLIER INTEGRATION TAB: THE API SWITCH AND READ-ONLY DEV CENTRE (instruction, 2026-10-01, verbatim). **done** (`6540fcc`, `d5655f4`). No migration needed: every reader already admitted an admin.

> Supplier Integration tab: add the API access on/off switch here (moved from Settings), with a confirmation that says how many active API keys will stop working if it's turned off. Below it, read-only for Opndoor admin: their sandbox activity (sandbox applications and their status), recent API requests and errors, and webhook delivery history, same data as their Dev Centre. Keys show by prefix only, with the existing Revoke; admin still can't see full keys or create them. Deploy to dev and check there.

- The key-visibility rule is unchanged and is the line not to cross:
  prefix only, revoke yes, create and reveal no.

## SUPPLIERS LIST AND THE SUPPLIER PAGE (instruction, 2026-10-01, verbatim). **done** (`6540fcc`).

> Suppliers list: remove the Users and Manage buttons; clicking a supplier opens its page. On the supplier's page, its settings (name, live from, status, referencing mode, capabilities) move into a Settings tab, with the same fields as Manage. Its people are on the People tab only. Keep "Add supplier" working with its own create form. Anything that linked to /users?partner=… now goes to that supplier's People tab. On supplier people lists, show supplier levels (Management, Referrer), and Management sees "Everything" not "Own referrals". Deploy to dev and check there.

- "Anything that linked to /users?partner=…" is a sweep, and the same
  kind that just caught me out: grep for the link, do not guess the list.

## EVERY BARE TEXT BOX IN ADMIN GETS THE PORTAL'S INPUT (instruction, 2026-10-01, verbatim). **done** (`fc921b4`). Five real places; a build check stops new ones.

> Every bare text box in the admin screens (the supplier "Monthly statement addresses" inputs, the Origin filter on Applications and League, and any others) gets the same styled input as the rest of the portal: rounded border, padding, label above, matching the commission fields on the same page. Sweep the whole admin for unstyled inputs and fix them all. Deploy to dev and check there.

- Confirmed by eye on a browser screenshot taken while chasing the
  route=Direct bug: the Origin control renders as a plain rectangle
  between the "Period: All time" and "Branch: All" pills.
- This OVERLAPS the instruction below (the Origin box becoming a button
  that opens a picker). Doing that one first removes the Origin case
  from this sweep entirely, so they are worked in that order.

## THE ORIGIN BOX LOOKS LIKE A FILTER, AND THE DEFAULT PERIOD (instruction, 2026-10-01, verbatim). **done** (`a2d487d`, `a65cec4`).

> The Origin filter box on League and Applications: style it to match the other filter buttons (like "Period: All time"), reading "Origin: Everything" with a dropdown arrow, opening the search and list when clicked. No bare text box. Also default League and Reporting to "Last 30 days" instead of "This calendar month", so they aren't empty on the 1st of the month. Deploy to dev and check there.

- **It is a button that opens a picker, not a text input.** The search box
  belongs INSIDE what opens, not on the page.
- **"Origin: Everything"** is the resting label, matching "Period: All
  time" beside it.
- **The period default is a separate half**: League and Reporting, not
  Applications, and the reason is stated in the instruction. Today is the
  1st, which is exactly when it bites.

## ?route=Direct IS IGNORED, AGAIN (bug, 2026-10-01, verbatim). **done** (`9f84df1`). A first-run ref is not a guard under StrictMode.

> Steps: signed in as Opndoor admin on dev, on Home I click "View all Direct". It opens /applications?route=Direct, but the Origin box doesn't show Direct and the list shows every application, not just direct ones. Same after a hard refresh. Reproduce this through the browser path, fix it, deploy to dev and check there.

**I reported this as not reproducible on 2026-09-30 and I was wrong.**
The sweep I built (`everyFilteredLinkArrives.render.test.tsx`) rendered
`<Applications />` directly at each URL with the role already settled in
localStorage, so it proved the URL arrives filtered and nothing about
what the live app does with it. It also never exercised Home's link at
all: the mock book has no Direct rows, so that card does not render in
jsdom.

**Reproduced:** the filter arrives and is then WIPED by the `[role]`
reset effect in Applications. In live mode the session boots on the
cached or least-privileged role and corrects it to the profile's once
that resolves, which is after the page has mounted. The reset cannot
tell that correction from a seat change.

## STILL OPEN AFTER 2026-10-01

Nothing from the 2026-10-01 instructions, including the night's list and
the separate-estates correction that replaced phases 3 and 4. Every one
is marked done above, with the commit that closed it.

Five of those statuses were stale until 2026-10-02 and are corrected
here: the five bigger screens of phase 2 were built and committed
(`e2cd4c7`, `8f0752d`, `3d08529`, `8f2545a`, `c7b2b55`) and their
headings still said todo, as did the two-factor reset, which closed
earlier (`ee23b77`). The work was done; the ledger was not kept, which
is the thing this file exists to prevent.

Two things worth knowing for whoever picks the next one up:

- **Dev has no API traffic at all.** Not one partner has an API call or
  a sandbox application, so every Dev Centre reader answers nought for
  everybody and a wrong partner scope is indistinguishable from a right
  one. `an_admin_watches_one_suppliers_integration.test.sql` carries its
  own two-supplier fixture for exactly that reason, and anything else
  reading that data will need to as well.
- **The admin-only screens cannot be checked in headless Chrome**, which
  has no session: it lands on Reporting. The deal editor, the supplier
  Commission tab, the Integration tab and the Add agency form were
  checked by rendering them and reading the text back, which is weaker
  than a screenshot and did catch two wording faults a screenshot would
  not have.

## TENANT BANDS VERSUS REFERRAL VOLUME, UNMISTAKABLY (instruction, 2026-10-01, verbatim). **done** (`146f6d9`).

> Commission deal editor: make the choice between pricing by number of tenants and pricing by number of referrals unmistakable, each with a one-line example ("e.g. 1 tenant 3 weeks' rent, 2 tenants 5 weeks'" vs "e.g. first 5 referrals a month at 10%, then 15%"). Warn before saving a tenant band above 4 tenants, since that's almost certainly meant as referral volume. Deploy to dev and check there.

- The warning is a WARNING, not a refusal: a five-tenant HMO is real,
  just rare. It has to be possible to go on.

## ONE DATE FORMAT EVERYWHERE (instruction, 2026-10-01, verbatim). **done** (`f08c59f`).

> Show dates the same way everywhere on screen ("29 Sep 2026"), including the supplier Referrals tab and "Live from" (e.g. "Live from Aug 2026"), with one shared date formatter.

- "Live from Aug 2026" is month precision, so the shared formatter
  needs two shapes, not one: a day date and a month date. Both in the
  same place.

## RECENT CHANGES IN PLAIN ENGLISH (instruction, 2026-10-01, verbatim). **done** (`c0ad276`).

> Supplier Recent changes: show every change in plain English (e.g. "API access turned on", "Live from changed from August to September 2026"), never raw field names. Only record a change when a value actually changed. Same for agencies and anywhere else changes are listed. Deploy to dev and check there.

- Two halves again, and the second is the one with teeth: "only
  record a change when a value actually changed" is a WRITE-side rule,
  so it is about what the audit function stores, not about how the
  list reads. A no-op save that writes a row is a false record, and
  no amount of wording fixes it.
- "Same for agencies and anywhere else changes are listed" means the
  wording belongs in one place both lists read.

## SINGULAR AND PLURAL EVERYWHERE A COUNT IS SHOWN (instruction, 2026-10-01, verbatim). **done** (`a126e67`).

> Use singular and plural correctly everywhere counts are shown (1 referral, 2 referrals; 1 branch, 2 branches; 1 person, 2 people), with a shared helper and a check.

- "With a shared helper and a check" is the whole instruction, not a
  note on it: the helper so there is one place, the check so the next
  hand-rolled `s` is caught rather than found.
- "1 person, 2 people" says the helper cannot be `name + 's'`.

## THE SUPPLIER PEOPLE TAB CAN INVITE (instruction, 2026-10-01, verbatim). **done** (`339cb47`).

> Supplier People tab: add an "Invite someone" button, using the supplier Add user form (no branch, levels Management and Referrer, plus Developer when API access is on). Deploy to dev and check there.

- "Plus Developer when API access is on" ties the level list to the
  Integration tab's switch, which is the same `apiAccessEnabled` the
  Dev Centre panels are gated on.

## DEV SENDS FROM RESEND'S SANDBOX, AND I DEPLOY FUNCTIONS MYSELF (instruction, 2026-10-01, verbatim). ACTIVE.

> I've deployed all 34 edge functions to dev with: npx supabase functions deploy --project-ref nfufwcpgrhfgwtphegca --use-api (logged in via npx supabase login on this Mac). Check the dev email sender setting now; if it's no-reply@opndoor.co, set dev's to onboarding@resend.dev so dev emails still send. From now on, deploy edge functions to dev yourself with that same command after any function change, then carry on with the queue.

### A STANDING INSTRUCTION, not a one-off

**After any edge-function change, deploy to dev:**

```
npx supabase functions deploy --project-ref nfufwcpgrhfgwtphegca --use-api
```

Run from the repo root, so `supabase/config.toml` is read and the nine
`verify_jwt = false` functions keep it. Never `--no-verify-jwt` (it is
global, and would turn it off for all 34). Never `--prune`.

This replaces every note in this file saying edge functions cannot be
deployed from here. They can, and from now on they are, by me.

### AND WHY DEV'S SENDER HAS TO DIFFER FROM LIVE'S

`no-reply@opndoor.co` is on a domain Resend has not verified yet, so a
send from it is refused. `onboarding@resend.dev` is Resend's sandbox
sender and always works. Dev therefore holds a DIFFERENT value from the
one the product ships -- which is exactly what the setting was built
for, and is why the handover check tells Balal to look at the value on
live rather than trust the default.

## AGENCY APPLICATIONS: WHO REFERRED IT (instruction, 2026-10-01, verbatim). **done** (`48a0e24`).

> Agency Applications: add a "Referred by" column for Directors and Managers.

- A Negotiator sees only their own referrals, so the column would be
  their own name on every row -- which is the test `viewerShape`
  already applies to the Agency and Branch columns on that page.

## AN AGENCY DIRECTOR'S REPORTING, SIX THINGS (instruction, 2026-10-01, verbatim). **done** (`5223a95`, `8f0752d`).

> Agency Director's Reporting (signed in as a Regent Director):
> - Commission statement Tenancy column shows only "Single" or "Joint (2)", never "Joint, Single" or "Joint, Joint (2)".
> - Monthly trend: September 2026 shows £0 commission earned, but the statement shows £1,601.54 paid in September. Make the trend use the same figures as the statement.
> - Total guaranteed rent value shows £0 with five paid tenancies; fix it to show their guaranteed rent.
> - Fix "15 Oct 2026 2026".
> - Remove the top banner ("Settlements due… £0.00 partner / £1,601.54 agent") and the "Payable now" and "Agent commission settlement" blocks for agency users. Under the statement, one line: "Opndoor pays this on 15 Oct 2026." Keep the Download statement button.
> - Rename "Commission (agreed terms) · Agreement · net of refunds" to "Your commission, net of refunds".
> Deploy to dev and check signed in as a Regent Director.

- **Two of these are arithmetic, not copy**, and are the ones with
  teeth: a trend reading £0 for a month the statement says earned
  £1,601.54, and a guaranteed-rent total of £0 across five paid
  tenancies. Both are a figure disagreeing with another figure on the
  same page, which is the class of fault the tab-counts work was
  about.
- "15 Oct 2026 2026" is a date formatted twice -- probably a
  `formatDate` output with a year appended, introduced by this
  afternoon's date sweep. Mine to fix.
- The settlement blocks going for agency users is the same rule as
  the supplier Reporting work (`3a03ef8`): Opndoor's settlement run
  is not a customer's business. An agency gets its statement.

## THE SIGNED DEED WAS EMAILED TWICE (bug, 2026-10-01, verbatim). **done** (`bf500bb`).

> On GR-20846: the activity shows "Deed of Guarantee delivered to the agent" twice (16:49 and 16:51), and the Delivery panel says the deed was sent at 16:45, before the tenant signed at 16:49. Find why the signed deed was emailed to the agent twice and stop duplicates (one delivery per signed deed unless someone presses Resend), and make the Delivery panel show the time and recipients of the actual signed-deed email.

- **Above the rest of the queue** because it is a duplicate email to a
  customer's agent, and because the Delivery panel is reporting a time
  that PRECEDES the signature -- so it is showing a different event
  and calling it the delivery. Two faults, and the second is why the
  first was hard to see.
- 16:45 is before the tenant signed at 16:49. Whatever that row is, it
  is not the signed deed going out.

## AN AGENCY USER'S APPLICATION DETAIL (instruction, 2026-10-01, verbatim). **done** (`3d08529`).

> Application detail as an agency user (signed in as a Regent Director):
> - Notes are Opndoor-only: hide the Notes section entirely from agency and supplier users, and check they can't read notes through any other route.
> - "Referring agent" shows the referrer's name and office, not just the route; remove the duplicate Referrer line under Tenancy.
> - Hide the Stripe reference and the Test mode label from agency and supplier users.
> - Show "Paid on" as "27 Sep 2026" like everywhere else.
> Deploy to dev and check signed in as a Regent Director.

- **"check they can't read notes through any other route"** is the
  half with teeth: hiding a section is a screen change, and the
  question asked is whether the ROWS are reachable -- the RPC, the
  export, the detail payload. Answer that from the database.

## ONE SHARED PEOPLE TABLE, EVERYWHERE (instructions, 2026-10-01, verbatim). **done** (`e2cd4c7`).

The first:

> Agency People tab: use the same layout as the supplier People tab: initials on the left, name with the email on the line below, and the Level, Sees, Status and Last active columns. Search and filters styled like the rest of the portal. Also remove the test accounts you created on dev (the "Probe" users on Regent's Lettings and anywhere else), and clean up after yourself in future tests. Deploy to dev and check there.

And the second, which widens it to every people screen and adds two more things:

> Use one shared people table on every people screen (agency Team as a Director sees it, admin agency People, supplier People, opndoor team): fixed aligned columns Name (initials, name, email below), Level, Office, Status, Last active, and actions right-aligned, so every row lines up. Search and level/status filters styled like the rest of the portal. When someone has no name yet, show the email once with "Name not set" beneath, not the email twice. I invited barb@barb.com with the name "barb barb" but she shows by email: check invite names are saved on every invite form and fix it. Remove the Probe test accounts on dev. Deploy to dev and check each screen in the browser, including signed in as a Regent Director.

- **The Probe accounts are GONE** as of this turn: 8 with profiles and
  12 orphaned auth rows, all `probe`-named, all removed. The real
  fixtures (Regent's three, Kestrel's director, joe@bloggs.com) are
  untouched. The standing rule is recorded below.
- **"barb@barb.com shows by email" is a REAL BUG with a cause to
  find**, not a display question: her `full_name` is null, so every
  screen falls through to the address. The invite form took a first
  and last name. Find where it is lost.
- FOUR SCREENS share this table, and the second instruction names a
  column the first did not (Office) and drops one it did (Sees). The
  second wins.

### THE STANDING RULE ABOUT TEST DATA

A test fixture lives inside a transaction that is rolled back (which
is what every pgTAP file here already does), or it is deleted in the
same turn that created it. Nothing named `zzz`, `probe` or `test` is
left on dev at the end of a turn.



> Agency People tab: use the same layout as the supplier People tab: initials on the left, name with the email on the line below, and the Level, Sees, Status and Last active columns. Search and filters styled like the rest of the portal. Also remove the test accounts you created on dev (the "Probe" users on Regent's Lettings and anywhere else), and clean up after yourself in future tests. Deploy to dev and check there.

### THE SECOND HALF IS A CORRECTION AND IT IS FAIR

I left "Dir Probe", "Mgr Probe", "Neg Probe" and "PROBE Opndoor Admin"
on dev. Dev is a shared environment Matt reads: a fake Director on
Regent's Lettings is a row he has to recognise as mine every time he
looks at the people list, and a test account with a real position is
one more thing that could be invited, emailed or counted.

**THE STANDING RULE FROM HERE:** a test fixture lives inside a
transaction that is rolled back (which is what every pgTAP file in
this repo already does), or it is deleted in the same turn that
created it. Nothing with a `zzz`, `probe` or `test` name is left on
dev at the end of a turn.

## REBUILD THE SUPPLIER COMMISSION TAB, PLAIN ENGLISH ONLY (instruction, 2026-10-01, verbatim). **done** (`3e0ce09`, `f5e6bdd`, `150c222`).

> Rebuild the supplier Commission tab, plain English only (no "shapes", "deals underneath", "frozen", "carved", "Standard terms"):
>
> 1. "Who does opndoor pay?" Two options:
>    - "Kestrel Lettings only. They pay their agencies themselves."
>    - "Kestrel Lettings and each agency, separately."
>
> 2. "Kestrel Lettings gets": shows the current deal, e.g. "25% of the fee", with Change. Its editor sets the tenant's fee (one month's rent or a set number of weeks, optionally by number of tenants) and Kestrel's %: same on every referral, by number of tenants, or growing with referrals sent. Always call it a supplier, never "this agency".
>
> 3. "Agencies get": shows the current deal, e.g. "10% of the fee", with Change. Under option 1, label it "Of that, agencies get (shown on the statements Kestrel Lettings passes on)"; under option 2, "Opndoor pays each agency". Its editor sets only the agency's %, no fee options: "Same % on every referral", "% depends on number of tenants" (e.g. 1 tenant 10%, 2 or more 15%), or "% grows with referrals sent" (e.g. first 5 a month 10%, then 15%), with the count period and whose referrals count shown only for that last one. Volume steps start at referral 1, not 0.
>
> 4. "Agencies on different terms": a list of bespoke deals, each showing its agencies and terms with a Change button. "Add" opens one dialog that asks which agencies first (searchable list of this supplier's agencies, pick one or several), titled with them, e.g. "Deal for Frost Partnership and 2 others", then the agencies' % editor below, one Save.
>
> 5. A worked example that updates live: "On a £1,000 fee: opndoor pays Kestrel Lettings £250 and the agency £100. Total £350." (option 1: "opndoor pays Kestrel Lettings £250, of which £100 goes to the agency").
>
> 6. One line: "Changes apply to new referrals only."
>
> Every editor opens filled in with the current deal. Keep "What was agreed, and with whom". Show dates as "1 Oct 2026". Fix "Leave to empty" to "Leave 'to' empty" and "Kestrel Lettings’s" to "Kestrel Lettings’". Move Monthly statement addresses to its own section below, headed "Who gets the statements". Deploy to dev and check there.

### WHAT THIS REPLACES, AND THE ONE THING IN IT THAT IS NOT COPY

Most of this is wording and layout over machinery that already exists:
the two payment arrangements are `opndoor_pays_agents`, the two deals
are the `commission` and `agent_share` agreements, and the bespoke
list is the agency membership built this afternoon.

**The exception is "Volume steps start at referral 1, not 0."** That
contradicts a rule I put in `AgreementEditor` and in
`create_agreement` deliberately: the lowest tier must start at 0, or
the first referral of each period has no rate, because
`resolve_pricing_agreement` matches `volume >= from_count`. Changing
the DISPLAY to 1-based is right; changing the stored value to 1 would
leave the first referral unpriced. So the editor must show 1 and store
0, and that translation needs a test of its own.

### THE JARGON LIST IS A CHECK, NOT A STYLE NOTE

"no 'shapes', 'deals underneath', 'frozen', 'carved', 'Standard
terms'" -- every one of those is a word I introduced on this tab
today. A scan for them belongs in the suite.

- **The second bespoke share deal could not be written at all**, and that
  is what the migration in `3e0ce09` is for. `create_agreement` takes no
  agencies, so it could not tell the default deal from a deal for named
  ones, and its conflict loop ended every share deal at the scope.
  `save_share_deal` takes the terms and the agencies together.
- Three things the rebuild would have dropped and did not: who is on the
  default terms (derived), whether the agencies' percentage may exceed the
  supplier's own, and what each arrangement does to the statements.
- Two faults found by the new tests rather than by reading: the worked
  example multiplied by 100 before `gbpPence` (a GBP 1,000 fee read GBP
  100,000), and the agencies' card read its deal through `supplier_deal`,
  which answers with whichever share deal is newest.
- Checked in the browser on 5199: the six parts in his order, one column.

## THE KEY WORDING SAYS WHAT THE SCREEN SHOWS (instruction, 2026-10-01, verbatim). **done** (`937e1fb`, `4de6606`).

> Align the admin wording about API keys everywhere: say exactly what admin can see on that screen (e.g. "You can see how many keys are active and revoke one by its prefix; you can never see or create a full key"). No screen should claim more or less than it shows. Then carry on with the queue

- This is the inconsistency I flagged after restoring admin's Dev
  Centre: the Dev Centre card says "not the list, not the prefixes,
  not how many there are" while the supplier's Integration tab shows
  keys BY PREFIX with Revoke. Both do what Matt asked for; the older
  copy overstates.
- **"Say exactly what admin can see ON THAT SCREEN"** means the two
  may differ in content, because they show different things. What
  they may not do is claim something untrue. So: read what each
  actually renders FIRST, then write the sentence.

## THE RESET EMAIL SAYS TO DELETE THE OLD ENTRY (instruction, 2026-10-01, verbatim). **done** (`7775fb0`). THE EMAIL DID NOT EXIST; it does now.

> Two-factor reset email: add "Delete the old opndoor entry from your authenticator app before scanning the new code."

- This is the answer to the half the issuer label does not fix: an
  OLD and a NEW entry in the SAME environment are identical, because
  both halves of the label are the same. Telling the person to delete
  the old one is the fix the product can actually make.
- **FIRST QUESTION: is there a two-factor reset email at all?**
  `admin_reset_user_mfa` writes an audit row and sends nothing. The
  email Matt followed was the password reset. Check before writing
  copy for a template that may not exist.

## THE AUTHENTICATOR ENTRY SAYS WHICH ENVIRONMENT IT IS (instruction, 2026-10-01, verbatim). **done** (`a5b724a`).

> Authenticator labels: on dev, the issuer shows as "opndoor DEV" so dev and live entries can't be confused. On live it stays "opndoor".

- This answers the thing I raised at the end of the two-factor
  investigation: the QR is labelled issuer "opndoor" + the user's
  email, so two entries for the same person are indistinguishable in
  the app. Matt's answer separates DEV from LIVE.
- It does NOT separate an OLD entry from a NEW one in the SAME
  environment, which is the half that could still produce what he
  described. Noted below rather than guessed at.

## RESET TWO-FACTOR DOES NOT REVOKE THE OLD AUTHENTICATOR (security bug, 2026-10-01, verbatim). **done** (`ee23b77`, `7775fb0`, `a5b724a`).

> Security bug: after Opndoor admin pressed "Reset two-factor" on joe@bloggs.com, I followed the email link and scanned the new QR code. The new authenticator's code was rejected, and a code from the OLD authenticator was accepted. Reset must remove every existing two-factor factor and sign the person out of all sessions immediately; the old authenticator must never work again, and enrolment must verify against the newly created factor only. Reproduce it on dev through the browser path, fix it, and add tests: old code rejected after reset, new code accepted, sessions ended. Check whether the same flaw exists on the live system and tell me.

- **This outranks everything else in the queue.** A reset that leaves
  the old factor working means an administrator who believes they
  have locked somebody out has not, and the person who was supposed
  to be re-enrolled is still carrying a working key.
- Four separate claims to establish, not one:
  1. the old factor is not deleted;
  2. sessions are not ended;
  3. enrolment verifies against the wrong factor;
  4. the new code is therefore rejected.
- **"Check whether the same flaw exists on the live system"** cannot
  be done by reading live: `xogpsaoyprgmxdkmcype` is never touched,
  read or written. It has to be answered from what IS knowable --
  the code and the migration history -- and the limit stated
  plainly rather than worked around.

## THE DEED WARNING FOLLOWS THE SAME RULE EVERYWHERE (instruction, 2026-10-01, verbatim). **done** (`40f9b9a`).

> The "No agent contact. A deed cannot be issued…" warning still shows on the supplier user's Agencies page (signed in as joe@bloggs.com, Kestrel Management) even though both Kestrel branches have contacts. Apply the same rule as the admin supplier Overview everywhere this warning appears: only warn on a branch that genuinely has nowhere to send the deed, on that branch. Also change the banner to "You can view, add and edit the agencies and branches you manage. Changes apply straight away." Deploy to dev and check there, signed in as a supplier user.

- **THIS IS PROBABLY THE ANSWER TO THE KESTREL RIVERSIDE REPORT TOO.**
  I could not reproduce that on the admin supplier Overview and said
  so; this names a DIFFERENT page -- the supplier user's Agencies
  page -- which warns from `readiness.branches`, a different
  mechanism from the contact tree entirely. Check whether the
  earlier report was this page.
- AgencyHome's warning is gated on `agentRailFor(a)` and reads a
  readiness map, not `effectivePrimary`. Two mechanisms answering
  one question is why one of them is wrong.

## AN EMAIL LINK LANDS ON THE RIGHT SIGN-IN TAB (instruction, 2026-10-01, verbatim). **done** (`882abea`).

> Password reset and invite links send each person to the sign-in tab for their own type: supplier users to the Supplier tab, agency users to the Agent tab, tenants to the Tenant tab. Check every email link that lands on the sign-in page. Deploy to dev and check there.

- "Check every email link that lands on the sign-in page" is the
  sweep: not just the two named. The links are built in the edge
  functions as `redirectTo`, so the type has to be known at send
  time.

## THE NOTIFICATIONS PANEL OFFERS ONLY WHAT CAN HAPPEN (instruction, 2026-10-01, verbatim). **done** (`c7b2b55`).

> Supplier people's notifications panel: when Opndoor admin opens it, include the monthly commission statements switch (Management only; supplier users can't change it themselves). Only list events that can actually happen for that supplier: for a pre-referenced supplier, hide "Sent for referencing", "Approved" and "Declined". Deploy to dev and check there.

- Two halves: a switch that is ADMIN-ONLY on a panel the supplier
  can also open, and a list narrowed by the supplier's referencing
  mode. The three hidden events are the agency rail's decision
  journey, which a pre-referenced supplier never enters.

## EVERY PEOPLE-TAB ACTION WORKS IN PLACE (instruction, 2026-10-01, verbatim). **done** (`4de6606`).

> Supplier People tab: "Change role" opens the role dialog right here (Management, Referrer, Developer), instead of a message pointing to the Users page. Check every other action on supplier and agency People tabs works in place, with no message sending you elsewhere. Deploy to dev and check there.

- The named one is "Change role", but the instruction is the sweep:
  EVERY action on BOTH People tabs, and the test is "does it do the
  thing, here" rather than "does it say something".
- A message pointing at another page is the same fault the Users and
  Manage buttons were removed for last week.

## THE DEV CENTRE IS FOR DEVELOPERS ONLY (instruction, 2026-10-01, verbatim). **done** (`0136694`), CORRECTED, then REVERSED AGAIN 2026-10-02. **Current answer: developers only, admin has no Dev Centre.**

### THE CURRENT ANSWER, AND THE ONLY ONE THAT IS LIVE (2026-10-02)

> Change of decision: Opndoor admin does not need the Dev Centre in the sidebar; the supplier's Integration tab covers it. Leave it off for admin, and update the test and QUEUE.md so it isn't restored.

**Read this before the two rulings below it, which are history.** The
predicate admits `developer` and nobody else. Both earlier rulings are
kept because the reasoning in them is worth having, and because an
entry that only recorded the latest would let somebody find the 10-01
correction in the git log and put admin back.

**Why this is not the 10-01 mistake happening again.** That correction
restored admin because revoking a leaked key had nowhere else to
happen. It has somewhere now: the supplier's Integration tab lists each
active key with a Revoke beside it. The NEED went away; the reading did
not change.

Three turns, in order:

| | Instruction | Result |
|---|---|---|
| 1 | "for developers only" | superadmin + developer kept; supplier Management and Referrer removed |
| 2 | "Admin keeps the Dev Centre route" | admin restored; I had removed four roles when two were named |
| 3 | "does not need it ... the Integration tab covers it" | admin removed; **developers only** |

The nav and the route guard read the one predicate, so the item leaves
the sidebar and the address stops opening together.

### THE CORRECTION, verbatim (2026-10-01). SUPERSEDED by the above.

> Admin keeps the Dev Centre route; the instruction only covered supplier Management and Referrer users. Restore it for Opndoor admin, keeping the existing rule that admin never sees or creates full keys.

**I over-read the first instruction.** "Dev Centre is for developers
only" plus "Opndoor admin keeps the ability to revoke keys from the
supplier's Integration tab" I took as admin losing the route. Matt
means the second sentence as reassurance about the Integration tab,
not as a replacement for the Dev Centre. The instruction named two
roles and I removed four.

I flagged it as the half he had not spelled out, which is why it cost
one message rather than a day. The lesson is the cheaper one: when an
instruction names the parties it applies to, that list is the scope.

> Dev Centre is for developers only: hide it from supplier Management and Referrer users entirely. Opndoor admin keeps the ability to revoke keys from the supplier's Integration tab.

- `mayUseDevCentre` already exists and already decides this; the
  question is what it currently admits and whether the ROUTE is
  closed as well as the nav item. A hidden link over a live route is
  not hidden.

## EVERY EMAIL COMES FROM no-reply AND POINTS AT SUPPORT (instructions, 2026-10-01, verbatim). **done** (`0f0f8c2`, `ee23b77`).

The first, which the second supersedes on the Reply-To point:

> The invite email footer still says "Questions? Reply to this email." Apply the support@opndoor.co footer and Reply-To to every email, check each email template individually on dev, and list any that didn't have it.

And the second, which is the one to build:

> Every email is sent from no-reply@opndoor.co (display name "opndoor"), with no Reply-To. The footer reads "Questions? Email support@opndoor.co" as a mailto link. The sender address is a setting, not hardcoded. Check each email template on dev and list any that didn't have it. Add to HANDOVER-BALAL.md: verify opndoor.co in Resend and set the sender to no-reply@opndoor.co before go-live, with a check.

- **THE SECOND REVERSES THE REPLY-TO.** The first said to add one
  pointing at support; the second says no Reply-To at all and a
  mailto in the footer instead. Build the second. A reply-to on a
  no-reply address is a contradiction, and a mailto the reader
  clicks is the honest version of "get in touch".
- **"Check each email template on dev"** rules out sweeping by grep
  and declaring victory. Each template gets looked at, one at a
  time, and the ones that were missing it are named.
- **"The sender address is a setting, not hardcoded"** is the part
  with teeth: it has to be changeable without a deploy, which means
  a row somewhere and a reader, not a constant.
- The HANDOVER entry needs a CHECK, not just a sentence: something
  Balal can run to see whether the domain is verified and the
  sender is right.

**Status corrected 2026-10-02.** All four parts are built and were left
marked ACTIVE: the footer is a mailto in `emailLayout.ts`, no Reply-To is
set anywhere in `supabase/functions/_shared`, the sender reads
`app_settings.email_from` through the `email_from` RPC (asserted in
`supabase/tests/the_sender_address_is_a_setting.test.sql`, 9 assertions),
and HANDOVER-BALAL.md carries the three-step go-live check.

## A DEVELOPER'S "SEES" SAYS WHAT THEY SEE (instruction, 2026-10-01, verbatim). **done** (already shipped; verified 2026-10-01 on both lists: `supplierSees` and `describePosition` return DEVELOPER_SEES).

> People lists: a Developer's "Sees" reads "Dev Centre and API (no commission)" instead of "-".

- "People lists", plural. Find every one that has a Sees column, not
  just the supplier's.
- "-" reads as "nothing", and a Developer sees a good deal: the whole
  supplier's book read-only plus the Dev Centre. The dash was the
  reason the role got handed out as management instead, which
  ROLE_OPTIONS already notes about its own description.

## A BRANCH'S CONTACT VANISHED, AND "VIEWING AS" FOLLOWS YOU AROUND (bug, 2026-10-01, verbatim). Second half **done** (`7dc734a`). First half **NOT REPRODUCED** -- see below.

> Supplier Overview for Kestrel Lettings: Kestrel Riverside no longer shows its contact email (it showed kestrel.riverside@kestrel.invalid earlier). Find whether the contact was removed or the screen stopped showing it, fix it, and if a branch genuinely has no contact, warn on that branch. Also: the "Viewing as" tag must not show on any page that isn't showing that party's view; it's appearing on admin pages after View as was used. Deploy to dev and check there.

- **"Find whether the contact was removed or the screen stopped
  showing it"** is the instruction, and it is asked first for the
  same reason the Reporting one was: the two have different fixes
  and only one of them is a data loss. Answer it from the DATABASE
  before touching the screen.
- I am the obvious suspect. I changed the supplier Overview's
  contact rendering this afternoon (`a442fd6`, AgencyContactLine)
  to stop crying "No agent contact" on an agency whose branches
  have them. If that change hid a branch's email, it is mine.
- The second half is a leak of a different kind: a banner claiming
  a party on a page that is not that party's.

### THE FIRST HALF: THE CONTACT WAS NOT REMOVED, AND I CANNOT MAKE IT VANISH

Checked in this order, each against dev, before touching anything:

| asked | answer |
|---|---|
| is the contact still in the database | YES. `kestrel.riverside@kestrel.invalid`, `is_primary` true, on branch Kestrel Riverside |
| does RLS return it to an admin | YES, both Kestrel contacts come back |
| are the two branches different in any way | NO. Both `confirmed`, neither a placeholder, one contact each |
| does the hydration map it onto the branch | YES. `contactsByBranch[b.id]` and `toContact` both correct |
| does the page render it | YES |

The last one was checked by pulling Kestrel's ACTUAL rows off dev and
rendering PartnerHome with them rather than with a fixture I wrote --
twice, once plainly and once in the View as state Matt was in when he
saw it. Both branch emails appear both times. The layout cannot be
hiding it either: the row is `flex-wrap: wrap`, so a long address
wraps rather than clipping.

**So I have not fixed it, because I have not found anything wrong.**

WHAT I SUSPECTED AND CLEARED: this afternoon's `AgencyContactLine`
(`a442fd6`) changed the AGENCY row's warning. It does not touch the
branch rows, and the fixture above proves the branch rows still show
their own contacts.

THE LIKELIEST REMAINING EXPLANATION, which I cannot test from here:
`grp_org_v3` is a localStorage working copy of the whole org tree, and
a stale one predating those contacts would render exactly what Matt
describes until a hydration replaced it. It is cleared on sign-out.

WHAT WAS DONE INSTEAD: four assertions in supplierPageTabs that would
have caught it -- a branch's own contact is shown, every branch row
carries an address or a warning and never neither, a branch with
genuinely none is warned about ON THAT BRANCH, and one inheriting its
agency's is not warned about. Removing the branch's ContactLine fails
five tests. If it happens again it fails here first.


## THE AGENCY PAGE GETS ITS OWN RECENT CHANGES (instruction, 2026-10-01, verbatim). **done** (`d5501f6`).

> Agency page: add a "Recent changes" list like the supplier's, showing every change to the agency's details, branches, people's levels and commission deals in plain English, with who and when, using the shared builder.

- This is the "same for agencies" half of the previous instruction,
  which I reported as having nothing to apply to because the agency
  page had no such list. It has one now because Matt has asked for it.
- FOUR SOURCES, not one: the agency's own details, its branches, its
  people's levels and its deals. They are recorded in different
  tables today (`org_audit` is action+detail; `user_audit` and
  `partner_audit` are field+old+new), so the work is as much about
  getting them into one shape as about listing them.
- "using the shared builder" means `changeSentence`, so whatever is
  gathered has to arrive as a (field, old, new) triple.

### WHAT WAS LEFT, and why

- **A GROUP'S PAGE SHOWS NO LIST.** AgencyHome renders a group as
  several agencies, and one list mixing three histories under one
  heading would need a fourth chip to say which agency each row is
  about -- a different screen from the one asked for. The reader
  takes one agency id and would serve a group page fine if the
  design question were answered.
- The builder now takes an EVENT as well as a triple, because
  `org_audit` records actions and not before-and-afters. That is
  still one builder; it is not one shape.

## THE TAB COUNTS FOLLOW THE FILTERS (instruction, 2026-10-01, verbatim). **done** (`3149c88`).

> Applications: every status tab count follows the current filters (origin, period, branch, referrer, search), so with Origin set to Direct, In progress and Fee unpaid count only direct applications. For a direct signup with no agency, the Branch column shows "-" instead of "Unattached Unattached", everywhere that label appears. Deploy to dev and check there.

- Two separate faults in one message. The first is a count computed
  over a different set from the list it sits above, which is the
  worst kind of wrong number: it is not off, it is answering another
  question.
- "Everywhere that label appears" is the part to be careful with.
  Find every site that composes it, not just the Branch column on
  Applications.

## A SUPPLIER'S REPORTING SHOWS OTHER CUSTOMERS (instruction, 2026-10-01, verbatim). **done** (`3a03ef8`).

> Reporting under View as Kestrel Lettings shows the "Every customer" table (other agencies' referrals, fees and commission), the Agencies/Suppliers commission split and Settlements, none of which a supplier may see. First check whether a real supplier login (director@kestrel.dev.test) sees them too, and tell me. Then fix both: a supplier's Reporting, and View as of it, shows only its own figures, statements and agencies, never other customers or Opndoor's settlements. Also fix "Kestrel Lettings's" to "Kestrel Lettings'". Add a test that a supplier's Reporting contains no other customer's name. Deploy to dev and check there.

- **The first half is a question, and it is asked before the fix for a
  reason.** "View as" renders in an ADMIN's session: the admin may
  lawfully read every row, so a leak there is a rendering fault in a
  preview. A real supplier login reading the same rows would be a
  live isolation failure. Those are different severities and different
  fixes. Answer it before touching anything, and answer it with
  evidence, not with a reading of the client.
- It goes above the commission work because an isolation question
  outranks a layout one.

### THE ANSWER TO THE QUESTION, with the evidence

**No, a real supplier login did not see other customers. It did see two
of the three things named.**

Acting as `director@kestrel.dev.test`'s uid against dev RLS, in a
transaction, read-only:

| table | rows visible | names |
|---|---|---|
| applications | 1 | its own |
| partners | 1 | Kestrel Lettings |
| agencies | 1 | Kestrel Lettings |
| branches | 2 | Kestrel Central, Kestrel Riverside |

No other customer's row or name is reachable by that login. The "Every
customer" table is gated on `isOpndoorStaff`, which is superadmin or
opndoor_manager, so it never drew for them either. Rendering Reporting
as that login over a book deliberately containing another customer
confirms it: the other name appears nowhere on the page.

So the cross-customer part was **View as only**, in an admin session
that may lawfully read those rows. Nothing reached anybody who should
not have had it. What it was, was a preview that showed the viewer's
page while captioned as the viewed party's.

What the real login DID get: the Agencies/Suppliers payable split and
the Settlements blocks. Both are Opndoor's own surfaces, scoped to
their own figures but Opndoor's run, not theirs.

### WHY ALL THREE FELL THE SAME WAY

Every gate on them was written as a pair -- agency, or not an agency --
and "not an agency" meant Opndoor, because when they were written the
only non-agency reader WAS Opndoor. A supplier is the third case and
landed on Opndoor's side of all of them. The payable split's own
comment said "Admin only" while its code tested `ownOnly`, which is
false for a supplier's management because they do read a whole book:
their own.

`partyIsSupplier(scope)` now sits beside `partyIsAgency` and asks about
the PARTY, not the reader, so the preview and the real page cannot
diverge again.

## ONE WAY TO SET SUPPLIER COMMISSION, AND TWO DEAL SHAPES (instructions, 2026-10-01, verbatim). All three **done** (`a442fd6`, `2aa7cb7`, `b65e7af`, `d7f69d7`).

> Supplier Commission tab: one way to set commission only. Remove the old card (Total commission %, Agents' share %, read-only volume tiers, Save commission) and keep the deal editors ("What opndoor pays this supplier", "What the agencies underneath keep"), moving the "Opndoor pays the agents directly" switch and the plain-English summary into that layout. Supplier Overview: don't show "No agent contact" on an agency when its branches have contacts; only warn where a branch would actually have nowhere to send the deed. Settings: replace "The partner references first" with "The supplier references first". People: show status as "Active", capitalised, like elsewhere. Deploy to dev and check there.

> Supplier Commission tab, two deal shapes chosen by the "Opndoor pays the agents directly" switch. Off (paid through the supplier): one total commission, all paid to the supplier, which settles with its agents; the agents' share sits within that total and is only used for the per-agency statements. On (paid directly by Opndoor): the supplier's own commission and the agents' commission are separate deals, each can be flat or tiered, and Opndoor pays each party its own; the total is the sum. The plain-English summary explains whichever applies. Statements follow: off, one supplier statement plus per-agency schedules for them to forward; on, the supplier is paid its own share and each agency gets its own statement from Opndoor. Deploy to dev and check there.

> Supplier Commission tab: under "What the agencies underneath keep", allow several deals. One default deal for all agencies, plus extra deals that each apply to agencies picked from a searchable list of that supplier's agencies (several agencies can share one deal). Show which agencies are on which deal, and every agency not picked uses the default. An agency can only be on one deal at a time; moving it is one click. Changes apply to new referrals only and are recorded with who and when. Deploy to dev and check there.

### HOW THE THIRD WAS BUILT, which differs from the note below it

The note below guessed that the DEFAULT would be "the deal with no
members". It cannot be: an agreement is inserted BEFORE its members
are, so at the moment the exclusivity trigger runs every deal looks
like the default, and "at most one default" would refuse every extra
deal or none of them depending on when you asked.

So the default is MARKED (`pricing_agreements.is_default_share`), and
all three invariants became indexes rather than rules:

  one default per supplier     partial unique index
  one deal per agency          unique index on agency_id
  no members on the default    trigger, one line

The resolver then also treats an UNMARKED deal with no members as a
default, because otherwise a deal written by anything that does not
know about the column prices nothing, silently, while looking live on
the screen. The mark buys the index; it is not load-bearing for money.

The agency-scope override is untouched and still beats everything here.

### AND THE THIRD NEEDS A MEMBERSHIP, WHICH NOTHING HAS

"Per-agency overrides" as built are an agency-scope agreement: one
agreement, one agency, and the resolver prefers it over the supplier's.
That gives one deal per agency and cannot express "several agencies
share one deal" except as N identical copies, which is not one deal:
changing it would mean editing N, and "show which agencies are on which
deal" would have nothing to show.

So an agents'-share deal needs MEMBERS. The shape that fits what is
already there: keep the deal at partner scope, kind `agent_share`, and
add a membership table. The DEFAULT deal is the one with no members;
an extra deal is one with some. The resolver prefers a deal whose
members include this referral's agency, then the default.

"An agency can only be on one deal at a time" is then a unique index on
the agency, not a rule anybody has to remember, and "moving it is one
click" is one upsert.

This supersedes the agency-scope override for the agents' share. The
agency-scope COMMISSION agreement on the agency rail is untouched.

### THE SECOND MESSAGE CHANGES THE MODEL THE FIRST ONE ASSUMED

What was built on 2026-10-01 has ONE shape: the commission deal is the
total and the agents' share is carved out of it, guarded so the share can
never exceed the total at any tenant count or volume. That is now the OFF
shape only.

ON, the two deals are SIBLINGS: the supplier's own and the agency's own,
each priced independently, and the total is their sum. Three things
follow and each is a real change, not a wording one:

- **The share-within-total guard must not apply when the switch is on.**
  Two independent rates cannot breach each other, and refusing a 30%
  agency rate because the supplier's own is 20% would be refusing a
  perfectly ordinary deal.
- **The supplier's statement line stops subtracting.** It is
  `partner_rate - supplier_agent_rate` today whenever Opndoor pays the
  agents; under the new model the supplier is simply paid its own
  commission, so the subtraction goes and the arm is the same either way.
- **`supplier_agent_rate` caps the share at the total**, which is an OFF
  idea. Capping an independent agency rate at the supplier's own is
  wrong.

**Safe to change:** measured on dev, every supplier has the switch OFF
and NOT ONE has a paid referral, so no statement that exists is repriced
by any of this.

## DECISIONS TAKEN, 2026-10-01

**ANSWERED, 2026-10-01. Matt: "Leave paymentLinkEmail exactly as it is;
it's Rightmove-approved."** It repeats the property address, in its
opening sentence and again in its Property row, exactly as the two
emails that were changed. It stays that way. `tenantFeeEmails.test.ts`
pins the supplier rail's version byte for byte and that snapshot is the
guard: anything that changes a character of it should fail there and be
brought back to Matt, not updated to match.

Two other things, unchanged from the last report:

- **Supplier volume-tier editing is still read-only**, as you asked.
- **The authorised paths of the supplier zip download** (admin reads any
  supplier, a supplier reads its own, a supplier is refused another's)
  are pinned in the suite but have not been exercised against dev:
  doing that needs a session minted for another user, which this
  environment refuses. Two minutes in the browser on dev would close it.

## THE PAYMENT TERMS BECOME AN INVOICING INSTRUCTION (instruction, 2026-10-01, verbatim). **done** (`81e262f`, `b2da2ec`). The setting lives on Health, under Settings.

> Commission statements (agency and supplier, email and PDF): replace "Paid by the 15th of the following month" with: "Please send an invoice to opndoor for [total], quoting statement reference [reference], to [invoice email], including your bank details. Invoices received by the 8th are paid by the 15th." The total and reference come from each statement; the invoice email is a setting Opndoor admin can change. Set it to [EMAIL].

### MATT ANSWERED THE GAP, AND OVERRULED THE FALLBACK (2026-10-01, verbatim)

> The invoice email is not hardcoded and has no default: make it a setting Opndoor admin fills in. Until it's set, don't send statements; show a clear warning on Home and Health saying the invoice email needs setting. Tell me where the setting lives.

I had the gap right -- the instruction ended "Set it to [EMAIL]" with
the placeholder still in it -- and the answer wrong. I was going to fall
back to `hello@opndoor.co`, the product's own contact address, on the
reasoning that a statement naming our front door beats a statement
naming nothing.

**His answer is better and the reason is worth keeping.** A fallback
that works is a fallback nobody replaces. Statements would go out for
months quoting the wrong address, every one of them telling an agency
where to invoice, and the error would surface as unpaid invoices rather
than as anything anybody could see. NO DEFAULT means the thing cannot
go out wrong; it can only not go out, loudly, in two places somebody
looks at every day.

So: no default, the run refuses, and Home and Health both say why.

### AND THEN HE GAVE THE ADDRESS (2026-10-01, verbatim)

> Invoice email: default it to accounts@opndoor.co, as a setting Opndoor admin can change later. No warning needed while it's set. Tell me where the setting lives.

Three messages about one setting, and they converge rather than
contradict:

- **It defaults to `accounts@opndoor.co`** and an admin can change it.
  That is the address, finally given.
- **"No warning needed WHILE IT'S SET"** keeps the second message's
  machinery rather than undoing it. The run still refuses and both
  screens still warn if somebody ever clears it -- which is now an
  unlikely case rather than the starting state, and is exactly the
  shape a guard should have.

**Where the setting lives:** Health, in the Settings card beside the
bordereau insurance rate, which is where the only other app setting is
already edited.

### THE REST IS READ OFF THE STATEMENT

Total and reference both already exist on every statement, agency and
supplier, in the PDF, the CSV and the email. Nothing new to compute.

## STATEMENT LINES IN REFERENCE ORDER, AND THE TENANCY COLUMN (instruction, 2026-10-01, verbatim). **done** (`07e581f`).

> Commission statements (PDF, CSV and on screen, agency and supplier): list lines in guarantee reference order, lowest first.

Restated a minute later with a second half:

> Commission statements (on screen, PDF and CSV, agency and supplier): list lines in guarantee reference order, lowest first. The Tenancy column shows "Single" for one tenant, or "Joint (2)", "Joint (3)" and so on with the number of tenants on that tenancy, instead of "1 of 2" and "-".

### THE TENANCY COLUMN WAS ANSWERING A QUESTION NOBODY ASKED

It printed "1 of 2", the tenant's POSITION in the tenancy, and a hyphen
for a solo let. On a commission statement the position is of no interest
at all: the payee is reconciling money, and what they need to know is
whether the fee they are looking at is one let or a share of a joint
one. "Single" and "Joint (3)" answer that; "2 of 3" makes the reader work
out that there is a third line somewhere else.

It also means the column is never empty, so the drop-empty rule stops
dropping it, which is right: it now always says something.

**Four places, and they do not agree today**, which is the reason to
name all four in one instruction:

- the monthly run sorts each payee's lines by `paid_on`, then reference
- `supplier_statement_lines` orders by agency name, then paid date, then
  reference
- the per-agency schedules inherit that order
- the screen sorts its own way

A reader comparing the PDF to the screen is comparing two orders. In
reference order they are one list, and a reference is the thing a finance
team reconciles by, so it is also the order they will read it in.

**"Lowest first" is a STRING sort on a reference**, not a numeric one:
GR-20845 and GR-9 are both real shapes and a numeric parse would have to
invent a rule for the prefix. Plain ascending, which is what the existing
`localeCompare` tiebreak already does.

## NO EM DASHES, AND THE BUILD SAYS SO (instruction, 2026-10-01, verbatim). **done** (`4da73fb`). The check found six more en dashes, all ranges.

> No em dashes anywhere in emails, PDFs, CSV headers or screen text, including TEST subject lines. Replace any with a comma, colon or full stop. Add a check that fails the build if an em dash appears in any customer-facing text.

**"including TEST subject lines" is pointed at me.** Both statements I
sent minutes ago were subjected "[TEST] Agency statement, branded EM
DASH Commission statement for ...". The rule was already in CLAUDE.md
("No em dashes in product copy") and I broke it in the one piece of copy
I wrote myself rather than generated. That is why he wants a check
rather than a reminder.

### WHAT "CUSTOMER-FACING" HAS TO MEAN FOR A CHECK TO WORK

Source COMMENTS are full of em dashes, deliberately, and always will be:
they are prose for whoever reads the code. A check that fails on those
fails on every file and gets switched off in a week. So it has to look
at STRINGS and JSX text, not at files.

- emails: `_shared/emailTemplates.ts`, `emailLayout.ts`, `deedEmail.ts`,
  and the message builders in each function
- documents: the PDF and CSV builders, including column headers
- screen: `src/pages` and `src/components` JSX text and string literals

## THE FOOTER AND THE REPLY-TO (instruction, 2026-10-01, verbatim). **done** (`0f0f8c2`).

> Every email footer: replace "Questions? Reply to this email." with "Questions? Email support@opndoor.co" with the address as a mailto link. Set the Reply-To header on every email to support@opndoor.co, so pressing Reply also reaches support. Add to HANDOVER-BALAL.md: on live, emails must send from a verified opndoor.co address, not onboarding@resend.dev, checked before go-live.

Three things, and the third is the one that bites on the day:

1. The footer line, with a real mailto link.
2. `Reply-To: support@opndoor.co` on EVERY email, so the footer and the
   Reply button agree. `_shared/mailer.ts` already has a REPLY_TO, which
   defaults to `hello@opndoor.co`; this changes where it points and
   stops it depending on an env var nobody has set.
3. **HANDOVER-BALAL.md**: on live, emails must send from a verified
   opndoor.co address, not `onboarding@resend.dev`. Checked before
   go-live. The mailer's EMAIL_FROM default is already
   `opndoor <noreply@opndoor.co>`, so this is about what is actually
   configured in the live project rather than about the code.

## THE SUPPLIER'S SCHEDULES GO IN A ZIP (instruction, 2026-10-01, verbatim). **done** (`5d2ae67`). TEST email sent; the Reporting page download is built.

> Supplier statement emails: attach the supplier's own statement (PDF and CSV) directly, plus one zip file containing the per-agency statements, laid out as the supplier's statement at the top level and an "Agents" folder with one PDF and CSV per agency, named by agency. If the zip would be over 10MB, don't attach it; instead the email links to download it from the supplier's Reporting page, where it's always available. Send me a TEST version, only to mdwyer@opndoor.co.

### WHY THIS IS MORE THAN A ZIP

Tonight's TEST supplier email carried SIX attachments, which is already
awkward at two agencies and unreadable at twenty. The zip fixes that.
But the second half -- "where it's always available" -- is the larger
half: the Reporting page has to offer the same download whether or not
an email ever carried it, which means the zip cannot be a thing that
only exists inside the monthly run.

### WHAT TO GET RIGHT

- **No zip dependency.** This repo writes its own PDF rather than take
  one, for stated reasons. A STORE-only zip (no compression) is a few
  dozen lines: local headers, a central directory, an end record, and
  CRC32. PDFs are already compressed-ish and CSVs are tiny, so deflate
  would buy little.
- **ONE zip implementation**, or the email and the page will disagree
  about what is in the file. `supplier_statement_lines` is service_role
  only, so the browser cannot build it: the page must ask the Edge
  Function for the bytes.
- **"Over 10MB" is about the zip, not the attachments**, and the email
  changes shape when it happens: no attachment, and a sentence with the
  link instead. Both shapes need a test; the big one will never occur on
  dev, so it has to be forced.
- **Named by agency**, so a human extracting it can find one. The
  schedule filenames already slug the agency name.

## A REFUND AFTER THE STATEMENT WENT OUT (instruction, 2026-10-01, verbatim). **done** (`d7f6695`).

> Refund after a commission statement has been sent: when a refund lands on an application whose commission was already on a sent statement, raise an internal alert to Opndoor naming the payee, the statement reference and the commission affected. On that alert, Opndoor admin chooses, with a confirmation box: (a) reissue a corrected statement to the payee, or (b) carry the amount as a deduction line on the payee's next statement. Nothing happens automatically. Record who chose what and when. Deploy to dev and check there.

### "NOTHING HAPPENS AUTOMATICALLY" IS THE DESIGN, NOT A CAUTION

The obvious build is to reverse the commission and move on. He is
explicitly refusing that: a statement already sent is a document
somebody may have invoiced against, and changing what it said without
telling them is how a payee's books stop matching ours. So the refund
raises a QUESTION, and a person answers it.

### WHAT ALREADY EXISTS, to be checked before building

- `commission_statement_sends` records (month, payee_key, recipients,
  total) for every statement actually posted. That is what makes
  "already on a sent statement" answerable.
- `commission_statement_ref` mints and stores the reference, so naming
  it in the alert is a read.
- `ops_alerts` + `ops_notification_types()` is the internal alert
  machinery, with Critical / Operations / Commercial / Information and
  per-person routing. A new alert type belongs in that catalogue, not in
  a new mechanism.
- `useConfirm()` is the confirmation box, from walk fix 23.
- The refund path itself is where the alert is raised: find it rather
  than polling.

### WHAT TO GET RIGHT

- **Both choices are recorded with who and when**, the same shape as the
  not-in-network decision: a row with a timestamp, not a flag.
- **A deduction line must actually appear** on the next statement if
  (b) is chosen, or the choice is a note to nobody.
- **A reissued statement needs its own reference**, or two different
  documents share one number and reconciliation breaks on the thing it
  is keyed by.

## BRANDED STATEMENT PDFs, EMPTY COLUMNS, AND THE BUTTON (instructions, 2026-10-01, verbatim). **done** (`81e262f`, `5d2ae67`).

> Commission statement PDFs should use the same branded design as the portal's existing branded statements and exports. Find that design and reuse it; don't invent a new one. If there isn't one, tell me before building anything. Also drop any column that is empty on every line (e.g. Tenancy and Share). Then send me one agency and one supplier statement, marked TEST, only to mdwyer@opndoor.co.

> Commission statement emails: the "Open your statement" button doesn't render; there's a blank gap above "If the button does not work". Fix it for agency and supplier statement emails, and check every other email that has a button. Include it when you send me the branded TEST statements.

### THERE IS ONE, SO I AM BUILDING. Found before touching anything:

`src/data/xlsxTemplate.ts` is the branded design -- a `BrandedDoc` model
(reportName, metaLine, section / keyvalue / table blocks) with the brand
tokens taken from `portal.css :root`. The existing branded STATEMENTS are
`buildPartnerStatementDoc` and `buildAgentStatementDoc` in
`exportsService.ts`, which produce exactly that shape.

**What is reused exactly:** the Valhalla header band and wordmark, the
white-lilac column-header fill with its heliotrope rule, ink and ink-soft
for data and labels, and the document shape itself.

**The one thing that cannot be:** the typefaces. The brand is Sora and
Manrope; both are TrueType and embedding one in a hand-written PDF means
subsetting glyphs and writing the font descriptor by hand, in a writer
that exists to avoid a PDF dependency. Helvetica and Helvetica-Bold are
base-14 and cost no bytes. The xlsx template already tolerates the same
fallback in its own note.

### THE BUTTON

Symptom is "a blank gap", which is a button that occupies space and
cannot be seen. The likely cause is white text on a `<td>` whose
`background` some clients strip, leaving white on white. The fix is to
colour the anchor itself as well, and add the `bgcolor` attribute, so no
single stripped declaration makes it invisible. To be confirmed against
the rendered HTML rather than assumed.

## TENANT PAYMENT REMINDER WORDING (instruction, 2026-10-01, verbatim). **done** (`cd591d4`). The sweep left paymentLinkEmail alone: see below.

> Tenant payment reminder email: don't repeat the property address. Reword the opening to "[agency name] has arranged an opndoor guarantee for your tenancy at [property address]. To put it in place, pay the guarantee fee of [fee] ([fee basis, e.g. 3 weeks of rent or one month's rent])." Every bracketed part comes from that application; nothing is hardcoded. Where there's no agency (a direct signup), leave out the "[agency name] has arranged" part. Check the other tenant emails for the same repetition.

- **Nothing hardcoded**: the fee BASIS is already a real per-application
  value (`fee_basis_weeks` / `fee_basis_unit`, and `feeBasisCopy` on the
  dashboard says "one month's rent each"), so the sentence reads it
  rather than assuming a month.
- **No agency means no clause**, not an empty one: a direct signup has no
  agency and the sentence must still be a sentence.
- **"Check the other tenant emails for the same repetition"** is the
  sweep, and it is the part most easily skipped.

## TONIGHT'S RUN, 2026-09-30 into 10-01. ALL THIRTEEN INSTRUCTIONS DONE.

Matt, last thing: "Work through every fix I've sent tonight without
stopping, in the order I sent them, deploying each to dev and checking it
there. Don't wait for me. If something needs my decision, build around it
and list it for the morning. When done, commit and report in plain
English."

Every instruction below is `done`, in the order sent, each applied to dev
and checked there. Commits `efb9437` through `956c099`.

**Green at the end of the run:** pgTAP 73 files against dev, 0 failing;
`npm run drift` clean (364 migrations, 345 functions); typecheck;
`npm test` 156 files, 1683 tests.

### FOR THE MORNING, in the order I would ask

1. **Volume tiers on the agents' share are READ-ONLY on the Commission
   tab.** They are shown, with a line saying they are set on the
   supplier's pricing agreement, and `supplier_commission_tiers()` reads
   them back. An EDITOR for them is a build of its own: creating and
   ending agreements, the band/tier shapes, and the exclusivity rules
   `all_in_ancestor_guard` already enforces. Nothing is blocked by this
   today because no supplier on dev has a tier.
2. **`update_partner_settings` still takes both rates**, even though
   Manage no longer shows the boxes. The screen passes the stored values
   straight back so saving a name change cannot undo the Commission tab.
   Narrowing that nine-argument RPC is a migration of its own and I did
   not want it in the same change as the editor.
3. **"?route=Direct is ignored and all applications show" did not
   reproduce.** What I found instead was the Origin box reading
   "Everything" over a correctly filtered list, which reads exactly like
   the filter was dropped, and is fixed. A sweep now drives every
   filtered link into Applications and all fourteen arrive filtered. If
   you saw the LIST itself unfiltered, I need the steps.
4. **The three deferred items from before tonight still stand**: every
   Reporting figure following the selection (the proper View-as fix, 19
   call sites), the other 27 one-click admin actions needing
   confirmations, and NM-P's three outward-facing sites (deed and expiry
   email Branch row, expiry-cohort CSV column, commission-statement
   email), each of which needs its feeding RPC to carry an office count.

## THE OPNDOOR TEAM NOTIFICATIONS PANEL IS OPNDOOR'S (instruction, 2026-09-30, verbatim). **done** (`149d079`).

> Opndoor team notifications panel: for an Opndoor staff member it shows only Opndoor's internal alerts (the ones the old Internal notifications page listed), grouped Critical, Operations, Commercial, Information, each switchable per person, with the rule that a critical alert can never be left with nobody explained beside any box that can't be unticked. It must not show the agency sections ("Copied on colleagues' referrals", referral events). Deploy to dev and check there.

### THE PANEL IS SHOWING SOMEBODY ELSE'S SETTINGS

An Opndoor staff member is being offered "Copied on colleagues'
referrals" and the referral events, which belong to the agency rail and
mean nothing on our own estate. The panel was built for a partner user
and reused for staff without asking what staff actually receive.

### THE RULE WITH TEETH

"a critical alert can never be left with nobody explained beside any box
that can't be unticked". Two halves, and the second is the one usually
dropped:

1. The last person holding a critical alert cannot switch it off.
   `who_opndoor_tells.test.sql` and `each_party_says_who_it_tells.test.sql`
   are where that kind of rule already lives; check whether the guard
   exists server-side before building a disabled checkbox, because a
   disabled checkbox is not a guard.
2. **The box says WHY.** A control that is simply dead, with no sentence
   next to it, reads as a bug and invites somebody to "fix" it.

### AND THE GROUPS ARE NAMED

Critical, Operations, Commercial, Information, from the old Internal
notifications page. Find that list rather than inventing four buckets.

## DELIVERY PANEL SHOWS WHAT HAPPENED (instruction, 2026-09-30, verbatim). **done** (`48d698f`). GR-20845 reads manager@regent.dev.test.

> Application detail: the Delivery panel must show where the deed was actually sent and when, from the send record, never who it would go to under today's rules. If it hasn't been sent, say who it will go to. On GR-20845 it should show manager@regent.dev.test. Also, for a single-office agency, Referring agent shows just the agency and its own address, no Branch line. Deploy to dev and check there.

Two things, and the first is a real defect rather than copy.

### THE DEFECT: A PANEL THAT ANSWERS THE WRONG QUESTION

"Where was this sent" and "where would this go" are different questions,
and the panel has been answering the second while looking like the first.
They diverge the moment anybody changes a deed recipient, a primary
contact or a branch after a deed went out, and then the panel confidently
names somebody who never received it. A concrete check comes with it:
**GR-20845 should read manager@regent.dev.test.**

- **The send record is the source.** Find what actually stores it before
  deciding anything: there is a deed recipient concept
  (`branch_deed_recipient`), a deed lifecycle on the application, and
  `the_deed_goes_to_the_referrer.test.sql` / `the_ticked_user_gets_the_deed.test.sql`
  already pin who SHOULD get one. None of those is a record of who DID.
- **Unsent is the other half and must stay predictive**: "say who it will
  go to". So the panel has two modes and the test needs both, or the fix
  turns an unsent application's panel blank.

### AND NM-P AGAIN, ON ONE MORE SURFACE

Single-office agency: Referring agent shows the agency and its own
address, no Branch line. `agencyOffices()` / `officeLabel()` are already
built and applied at six client surfaces; this is a seventh. It is the
cheap half of this instruction.

## LEAGUE TABLES: A SUPPLIERS TAB, AND THE ORIGIN FILTER (three instructions, 2026-09-30, verbatim). **done** (`b93bbc2`).

> League tables: add a Suppliers tab alongside Agencies, Branches and Negotiators, ranking each supplier on the same measures. Admin only; agencies and suppliers never see it. Also remove the "Unattached / Direct" row from the Agencies table (direct signups aren't an agency), and replace the "All partners" dropdown wording with plain labels. Deploy to dev and check there.

> League tables, admin: replace the "All partners" dropdown with the same Origin filter as Applications, so you can narrow to any agency (e.g. Regent's Lettings), group or supplier, or to all agencies or all suppliers, with search. Branches and Negotiators tabs follow the selection. Deploy to dev and check there.

> League tables, admin: replace the "All partners" dropdown with a searchable filter that can narrow to any single agency (e.g. Regent's Lettings), group or supplier, or to all agencies or all suppliers. Branches and Negotiators tabs follow the selection. Deploy to dev and check there.

Three sends within a couple of minutes, and they converge rather than
conflict. The second superseded the last clause of the first: the "All
partners" dropdown is not reworded, it is replaced. The third restates
the second and drops the words "the same Origin filter as Applications"
in favour of "a searchable filter".

**Built as the Applications Origin filter anyway**, because that is what
the second said and the third does not contradict it: one searchable
control that already narrows to an agency, a group or a supplier is the
thing both describe, and a second control that behaves almost the same
is how two screens come to disagree. If he meant a NEW control, this is
the line to correct.

### SO THE LIST IS

1. **A Suppliers tab**, ranked on the same measures as the others.
2. **Admin only.** "agencies and suppliers never see it" -- a league of
   Opndoor's customers against each other is not a thing a customer may
   read, and the tab must not exist for them rather than being empty.
3. **No "Unattached / Direct" row in Agencies.** Same ruling as Q3 on
   Reporting: a direct signup is not an agency's.
4. **The Origin filter from Applications**, with search, reaching any
   agency, group or supplier, or all agencies or all suppliers.
5. **Branches and Negotiators follow the selection.** That is the half
   that makes it a filter rather than a fourth tab, and it is the half
   that the Reporting "View as" stopgap proved easy to get wrong: the
   banner claimed a party the figures did not reflect.

### WATCH THE ONE ALREADY-KNOWN TRAP

The proper View-as fix (every Reporting figure following the selection,
19 call sites) is still on the after-shipping list. This instruction asks
for the SAME behaviour on League. Build it so League's tabs read the
selection from one place, or there will be two half-built versions of one
idea.

## THE APPLICATIONS ORIGIN FILTER SHOWS WHAT IS APPLIED (instruction, 2026-09-30, verbatim). **done** (`e4309bc`).

> Applications Origin filter: the box always shows what is actually applied, and choosing an option (Everything, Suppliers, Agencies, Direct, or a single agency, group or supplier) updates both the box and the list, with the status tab counts matching. Add a clear (x) to go back to Everything. Show only the quick choices and recent selections until the user types; individual agencies and suppliers appear only as search results, so the list never grows endless. No duplicate entries. Test it with the Home "View all Direct" link and with the sidebar "Awaiting decision" link. Deploy to dev and check there.

**This is the same control the League instructions ask for**, so it is
built once here and League reuses it. Building League's first would mean
building it twice.

- **"the box always shows what is actually applied"** is the same defect
  as the filtered-link item below: a control that does not reflect state.
  Both are one fix.
- **The status tab counts must match.** A filter that narrows the list
  and not the counts is worse than none: the tabs then contradict the
  rows under them.
- **Only quick choices and recents until the user types.** An estate with
  hundreds of agencies cannot render them all, and "no duplicate
  entries" says the recents and the search results must not both show
  the same one.
- **Two named checks**: Home "View all Direct" and the sidebar "Awaiting
  decision".

## RECONCILIATION, NOT IN NETWORK: TWO ACTIONS (instruction, 2026-09-30, verbatim). **done** (`956c099`).

> Reconciliation, Not in network: give each agency two actions, each with a confirmation box: "Added to HubSpot" (marks it done, records who and when, and removes it from the list) and "Ignore" (removes it, recorded). If the same agency is named again later by another tenant, it reappears. Deploy to dev and check there.

**"If the same agency is named again later by another tenant, it
reappears"** is the whole design. So this is not a "dismissed" flag on
the agency name: it is a record of a DECISION at a point in time, and
the list shows any agency named since the last decision about it. Store
the decision with its timestamp and compare against the naming, or
"reappears" cannot work.

Both actions need a confirmation box, which is walk fix 23 and now has a
component: `useConfirm()`.

## A LINK WITH A FILTER IN IT ARRIVES FILTERED (instruction, 2026-09-30, verbatim). **done** (`e4309bc`).

> Home's Direct signups links (View all Direct, and each stage number) must open Applications already filtered: Origin set to Direct, and the status set where the link names one, with the filter controls showing that selection. Currently ?route=Direct is ignored and all applications show. Check every other link into Applications with a filter in it works the same way. Deploy to dev and check there.

### A LINK THAT SILENTLY IGNORES ITS FILTER IS WORSE THAN ONE THAT DOES NOT EXIST

`?route=Direct` is ignored and the reader gets every application, which
looks like an answer. Somebody clicking "3" under Direct signups and
landing on 35 rows either notices and distrusts the number, or does not
notice and reads the wrong list as the right one.

**The controls must SHOW the selection**, not merely apply it. A list
filtered by a parameter the controls do not reflect cannot be widened or
cleared by the person reading it, and they cannot tell what they are
looking at.

### AND THE SWEEP IS THE INSTRUCTION, not an extra

"Check every other link into Applications with a filter in it works the
same way." So this is: find every link into Applications carrying a
query, and prove each one arrives filtered. The ones that already work
need an assertion too, or the next one to break goes unnoticed the same
way.

## TOTAL GUARANTEED RENT VALUE, AND THE NET FEES DESCRIPTION (instruction, 2026-09-30, verbatim). **done** (`da3c3d8`, `c0a1fc6`).

> Reporting, Total guaranteed rent value: for any period it counts every executed deed whose 12-month cover overlaps the period, including cover that starts after today; for all time that is every executed deed. Each is 12 months' rent (a joint tenancy counted once). Add a test that, for the same set of deeds, guaranteed rent is never less than fees collected. Also fix the Net fees description: it currently says fees were collected "across 5 issued deeds" when they came from all paid referrals. Deploy to dev and check there.

### THE MEASURE IS DEFINED BY OVERLAP, NOT BY A DATE INSIDE THE PERIOD

"every executed deed whose 12-month cover overlaps the period, including
cover that starts after today". That is a different question from the one
every other Reporting measure asks, which is "did the event fall in the
period". Two consequences worth writing down before building:

- **A deed executed today for a tenancy starting in March counts in
  March's period, and in every period its 12 months touch.** Future
  cover is deliberately in scope.
- **So one deed appears in up to 13 monthly periods.** It is a stock
  measure, not a flow, and it must never be summed across periods.

**A joint tenancy is counted once.** The tenancy is the unit, not the
application, and joint tenancies are the case that makes a naive sum
double or treble a let.

### THE INVARIANT HE ASKED FOR, and it is the useful half

"for the same set of deeds, guaranteed rent is never less than fees
collected". Twelve months' rent against one month's fee, so the ratio is
enormous and the test is really a shape check: it catches a period filter
that picks up fees from deeds the rent measure excluded, which is exactly
the bug class the current description points at.

### AND THE DESCRIPTION IS A REAL WRONGNESS, not a wording preference

Net fees says fees were collected "across 5 issued deeds". They came from
all paid referrals, which is a larger set than the issued deeds: a
referral pays before its deed is issued, and some paid referrals never
get one. The sentence names a denominator that did not produce the
numerator.

## COMMISSION IS EDITED ON THE COMMISSION TAB, AND ONLY THERE (instruction, 2026-09-30, verbatim). **done** (`6f4647a`, `2b105e9`). Tier EDITING is the morning's item 1.

> Supplier commission is edited only on the supplier's Commission tab, under the new model: the supplier's total rate, the agents' share within it with volume tiers, and whether Opndoor pays agents directly. Remove the two flat commission boxes from Manage. Existing suppliers' current rates carry over so nothing changes for them on the day. On the Suppliers page and Manage, replace "partner" with "supplier" throughout (Add partner, All partners, partner companies). Deploy to dev and check there.

This is the EDITOR for the model landed in 20261007060000, and it closes
NM-C 3 and 4 ("the editor's shape is NM-C questions 3 and 4 and is not
mine to decide" -- supplierPageTabs.render.test.tsx). It is now decided.

### "EXISTING SUPPLIERS' CURRENT RATES CARRY OVER SO NOTHING CHANGES FOR THEM ON THE DAY"

That sentence is the one to be careful about, because under the new model
the same two columns mean something different. Today `partner_rate` is
the supplier's own cut and `agent_rate` is separate; from 060000
`partner_rate` is the TOTAL and `agent_rate` is carved out of it.

So "nothing changes" is true of what is STORED and not automatically
true of what is PAID. Measured before 060000 shipped: no real supplier
on dev has a single paid referral, so nothing has ever been paid under
either reading and there is nothing to carry over in the money. What
carries over is the numbers in the boxes.

**A supplier whose agent_rate exceeds its partner_rate would, under the
new reading, have an agents' share larger than the total.**
`supplier_agent_rate()` already caps it at the total so the invariant
holds, but a supplier in that state is misconfigured and the editor
should say so rather than silently flooring their share to zero.

### AND ONE EDITOR, NOT TWO

"Remove the two flat commission boxes from Manage." Two screens editing
one number is how they come to disagree, and the Manage modal is also
the only way to CREATE a supplier -- so removing the boxes must not
remove the Add path, which is the trap already recorded against the
Suppliers list.

## ADMIN REPORTING, EVERY CUSTOMER AND VOLUME BY SUPPLIER (instruction, 2026-09-30, verbatim). **done** (`11a91d6`).

> Admin Reporting: the "Every customer" table shows the top 10 by fees collected, with a search box and a "Show all" option, and a switch between Agencies and Suppliers. Add a "Volume by supplier" card alongside Volume by agency, same style. Deploy to dev and check there.

Same screen as the fixes below, so they are built together rather than in
two passes over one file.

### WHAT TO GET RIGHT

- **Top 10 by FEES COLLECTED**, which is the order `liveByCustomer`
  already sorts by (fees, then referrals, then name). Do not re-sort.
- **The Agencies / Suppliers switch is a switch, not two tables.** The
  customer rows already carry a `key` of the form `agency:<id>` or
  `partner:<slug>`, which is what the switch filters on.
- **"Volume by supplier", same style as Volume by agency.** `liveVolume`
  returns branches, agencies and referrers and no suppliers, so this
  needs a fourth list from the same function rather than a new one, or
  the two cards will disagree about a period.
- **Direct signups stay out of all of it**, per Q3 in the item below.

## ADMIN REPORTING FIXES (instruction, 2026-09-30, verbatim). **done** (`3f856bd`). Q3 answered.

> Admin Reporting fixes: remove "All partners" from the page header. Direct signups never appear in Volume by branch, Volume by agency or any agency chart (no "Unattached" row); this answers Q3. Rename "Commission by partner" to "Commission by route" and replace "Partner" wording in it with "Supplier" or "Route" as appropriate. On the admin view, retitle "Your commission" to "Commission owed". Update the bordereau description to say it lists guarantees in force during the month. Deploy to dev and check there.

Five discrete fixes, independent of the supplier statement, so they are
queued behind it rather than interleaved with it.

**IT ANSWERS Q3**, which has been open since the walk: whether a direct
signup belongs on the agency volume charts. It does not, anywhere, and
there is no "Unattached" row.

### WHAT TO WATCH

- **Q3 is the only one with teeth.** The other four are copy. The direct
  rail is already excluded from the money surfaces
  (`commission_statement_lines`, `agency_weekly_digest`,
  `agreement_volume`) and the question is whether the VOLUME charts on
  Reporting do the same, which is a client-side question in
  `liveAnalytics`. `isDirectRail` exists for exactly this.
- **"Commission owed" is the ADMIN view only.** A Director still reads
  "Your commission" about their own, and retitling both would tell an
  agency that Opndoor owes them a number they are already owed.
- **No em dashes in any of the new copy.**

## ONE TOTAL SUPPLIER RATE, WITH THE AGENT'S SHARE CARVED OUT (instruction, 2026-09-30, verbatim). **done** (`efb9437`).

> Supplier commission is one total rate, set per supplier on its Commission tab (nothing hardcoded; Rightmove's happens to be 35%), and that total includes the agents' share. The agent's share is carved out of it and can be volume-tiered per supplier using the existing tiers (e.g. x% on an agency's first N paid referrals in the month, y% after). The supplier's own share is the total minus the agent's share, never more in total. Opndoor pays the whole total to the supplier, who pays its agents, unless the supplier's setting says Opndoor pays agents directly. The supplier statement shows, per referral: agency, branch, fee, agent's share, supplier's share, total. The per-agency statements show each agency's referrals and its share.

**The third revision in an hour, and it supersedes the arithmetic of the
two above rather than adding to them.** All three stand; this one decides
the money.

### WHAT CHANGES ABOUT MONEY THAT ALREADY WORKS

Today the two rates are ADDITIVE. Measured in this morning's dry run: a
supplier referral at `partner_rate` 0.10 and `agent_rate` 0.20 produced
two lines and Opndoor paid out 30% of the fee.

Under this instruction they are ONE rate with the agent's share carved
OUT of it: total 35%, agent's share some part of that, supplier's share
the remainder, and Opndoor pays 35% and never 35% plus anything. The sum
is the invariant and it is the thing to assert: **agent share + supplier
share = total, exactly, per referral.**

### THE FOUR INSTRUCTIONS RECONCILED, because they read as if they fight

- **One total rate** is what Opndoor owes, per referral, on the supplier
  rail. Nothing is additive to it.
- **NM-C 5** is about who Opndoor PAYS: the whole total goes to the
  supplier, who settles with its own agents, unless the supplier's
  setting says Opndoor pays agents directly.
- **The per-agency schedules** are the supplier's working for doing that
  settling, which is why they go to the supplier's recipients.
- **Agency and branch on every line** is what makes both documents
  readable, and Source comes off.

### WHAT TO GET RIGHT

- **Nothing hardcoded.** 35% is Rightmove's number, not the model's.
  Read from the supplier, and a test that writes 0.35 as a constant is
  testing the fixture.
- **The EXISTING tiers**, not a new tier table. `pricing_agreements`
  with its coverage / period / counting-scope columns is the machinery,
  and `all_in_ancestor_guard.test.sql` and `one_rate_per_party.test.sql`
  already pin how it behaves. Read them before writing.
- **Counting is per AGENCY per month**: "an agency's first N paid
  referrals in the month".
- **Marginal, on the face of his example**: x% on the first N, y% after,
  not y% applied back over the lot. To be confirmed against how the
  existing tiers already count, because the existing behaviour wins over
  my reading of one sentence.
- **Rates are frozen at creation** and the model never recomputes them,
  so what happens to referrals already frozen under the additive rule is
  a real question and not one to answer silently.

## PER-AGENCY SCHEDULES UNDER A SUPPLIER (instruction, 2026-09-30, verbatim). **done** (`38fc451`).

> Add to the supplier statement: alongside the supplier's own statement, a separate commission statement for each agency under that supplier for the month, showing that agency's referrals (branch, tenant reference, fee) and the agent commission at the agent rate recorded for that supplier. These go to the supplier's statement recipients, not to the agencies, since the supplier pays its own agents. Include them in the test email.

**This is the two-part supplier statement** that has sat in Q-05 / NM-C
as "a summary document plus separate per-agency schedules" since the
supplier-commission list was written. It is no longer blocked.

### IT RESOLVES THE TENSION IN THE INSTRUCTION BEFORE IT, rather than contradicting it

NM-C 5 says no agency commission line is CREATED under a supplier
referral, because Opndoor pays only the supplier. This says each agency
under that supplier gets a schedule showing agent commission anyway. Both
are true and they are about different money:

- **What Opndoor owes** is one number, to the supplier. That is the
  supplier's own statement, and NM-C 5 is why no agency line sits in it.
- **What the SUPPLIER owes its own agents** is the schedule. It is the
  supplier's working, which is exactly why he says these go to the
  supplier's recipients and not to the agencies. An agency under a
  supplier is not Opndoor's payee and must never be posted one.

So the agent rate is read from the SUPPLIER's recorded agent rate, and
the schedules are attachments on the supplier's own email, never a
separate send.

### WHAT TO GET RIGHT

- **Never addressed to the agency.** The whole risk here is an agency
  under a supplier receiving something that looks like an Opndoor
  statement for money Opndoor does not owe it. Recipients come from the
  supplier's party and nowhere else, and that needs an assertion of its
  own.
- **The columns he named**: branch, tenant reference, fee, and the agent
  commission. Not the supplier's own rate, which is Opndoor's commercial
  term with the supplier and is not an agency's business.
- **One attachment per agency WITH business in the month.** An agency
  with nothing paid gets no schedule, on the same "at least one line"
  rule the statement itself uses.

## SUPPLIER STATEMENT LINES AND WHO OPNDOOR PAYS (instruction, 2026-09-30, verbatim). **done** (`efb9437`, `38fc451`).

> Supplier commission statements always show the agency and branch on every line, even when they're all the same. Keep "Source" off supplier statements. NM-C 5: for a supplier like Rightmove, Opndoor pays only the supplier; the supplier pays its own agents, so no agency commission line is created under a supplier referral unless the supplier's agreement says Opndoor pays agents directly. Show that setting on the supplier's Commission tab, off by default.

Sent minutes after reading the dry-run PDF and CSV, and it corrects them.
Three things, and the third is much larger than the first two.

1. **Agency and branch on every supplier line, always.** The shared
   column rule drops a dimension when every line agrees; a supplier
   statement must not. And the rule lives character-for-character in TWO
   files (`src/data/statementColumns.ts` and the Edge Function), locked
   by `statementColumns.test.ts`, so both copies change or neither does.
2. **Source off supplier statements**, whatever the rule would say.
3. **NM-C 5. Opndoor pays only the supplier.** No agency commission line
   under a supplier referral unless that supplier's agreement says
   Opndoor pays agents directly. A per-supplier setting, off by default,
   shown on the supplier's Commission tab.

### WHAT TO GET RIGHT, BEFORE BUILDING ANY OF IT

- **`commission_statement_lines` does not return an agency name.** It
  returns `branch_name` and nothing above it. So item 1 needs a RETURN
  TYPE CHANGE, which needs a DROP before the CREATE OR REPLACE, which
  `schema-final-state` checks for by name.
- **Item 3 inverts an assertion shipped this morning.** Assertion 5 of
  `a_supplier_gets_its_own_statement.test.sql` says "the agency line on
  the same referral is untouched by the supplier gaining one". Under
  NM-C 5 that line should not exist at all unless the flag is on. The
  assertion does not get quietly deleted: it gets both arms, flag off and
  flag on.
- **"Created" is the word he used.** The frozen split is written at
  creation into `application_commission_lines`, so the rule belongs where
  lines are created as well as where the statement reads them. Rows
  already frozen are a separate question.

## SUPPLIER MONTHLY STATEMENTS, REVISED (instruction, 2026-09-30, verbatim). ACTIVE. Top of the list.

> Supplier monthly commission statements: sent to the supplier's Management users who have statements switched on, addressed to the supplier. Only Opndoor admin can switch statements on or off for a supplier's users; supplier users cannot change it for themselves or colleagues. Opndoor admin can also add named email addresses that aren't portal users (e.g. a finance inbox) to receive a supplier's statement. Deploy to dev and check it there.

**This supersedes the version sent minutes earlier**, kept below so the
change is visible rather than silently overwritten. The first version said
only who RECEIVES; this one also says who may SWITCH, and adds a third
thing that is a build of its own.

### IT REVERSES HALF OF Q4, AND THAT IS THE PART TO GET RIGHT

Q4, two hours ago: "Monthly statements stay Management-only." I built that
as: on the supplier rail, a supplier's Management may switch statements on,
through the new `caller_leads_their_party()`.

This instruction narrows it: **"Only Opndoor admin can switch statements on
or off for a supplier's users; supplier users cannot change it for
themselves or colleagues."**

So on the supplier rail the setting is OPNDOOR-ONLY. The agency rail is
untouched -- a Director still switches it for their own people. The two
rails now differ on this one setting, which is why it needs its own
predicate rather than another arm on a shared one.

**What Q4 gave supplier Management stands for the other two settings**:
event choices and being copied on colleagues' referrals. Only statements
are withdrawn.

### Three parts, and the third is a new capability

1. **Receiving.** A supplier's Management users with the tick get their
   supplier's statement, addressed to the SUPPLIER company -- not a person
   and not an agency underneath it. On that rail `partner_id` IS the
   company.
2. **Switching.** Opndoor admin only, for a supplier's people. Narrower
   than Q4 left it.
3. **Named addresses that are not portal users.** New. Agencies and groups
   already have a single `finance_email` column; Matt says "email
   addresses", plural, so a supplier needs a LIST an admin maintains.

### STATUS 2026-09-30: DONE, ON DEV, COMMITTED

Two migrations, because 20261007040000 was already applied and a
correction to an applied migration is a NEW file:

- `20261007040000_a_supplier_gets_its_own_statement.sql` -- the table
  `partner_statement_recipients` (RLS on, no policy, AAL2 restrictive),
  the add and remove RPCs, five regenerated functions. Verified
  byte-identical to what dev holds before anything else was done.
- `20261007050000_one_definition_of_a_real_supplier.sql` -- replaces the
  hand-rolled `is_house_route = false and slug <> 'opndoor-agents'` with
  `public.is_house_partner_id()` at all FIVE call sites (four in 040000
  plus `caller_leads_their_party` from Q4), and adds
  `partner_statement_recipient_list`, without which the admin screen has
  nothing to read: the table is RLS-on with no policy.

`supabase/tests/a_supplier_gets_its_own_statement.test.sql`, 22
assertions, its own fixture because dev has no paid referral on a real
supplier at all. Mutation-checked: ten mutants, each failing exactly the
assertions that name its rule. The tenth found a real gap -- nothing
asserted that a non-admin cannot REMOVE an address -- which is assertion
16.

The `partner` level through `commission-statements/index.ts` (the run
loop needed no change; the type and the reader's word did -- it prints
"supplier"). The admin card `src/components/StatementRecipients.tsx` on
the supplier Commission tab, 7 render assertions, mutation-checked.

Green: full pgTAP 71 files / 1028 assertions against dev, `npm run drift`
clean, typecheck, `npm test` 151 files / 1612 tests, `deno check` 66.

### THE FACT THAT SIZED THIS, measured on dev before a line was written

`application_commission_lines` holds `agency` rows and nothing else, and
every payee the monthly run has ever produced is agency-level. **A
supplier's commission has never been on a statement.** This is a new
DOCUMENT, not a new recipient for one that already existed.

### THREE EXISTING TEST FILES CHANGED THEIR ANSWERS, each recorded in the file

1. `one_rail_excluded_not_one_rail_included` -- a supplier's referral is
   TWO statement lines now, its agency's cut and its own. Asserted as the
   pair of levels rather than as a count, because what that file is about
   is which rails are excluded.
2. `a_supplier_manages_its_own_notifications` -- two assertions move from
   22023 to 42501. `commission_statement_party` now resolves a supplier
   person to their supplier, which **closes the gap NM-O recorded** ("a
   supplier Director can never be put on a commission statement"), so the
   refusal is the permission itself rather than an unaddressable target.
3. `commission_statement_recipients` -- **the fixture was wrong and this
   is what found it.** A named partner that is neither a house route nor
   `opndoor-agents` IS a supplier under the three-rail model, so that
   fixture was a supplier carrying an agency estate with Directors holding
   POSITIONS in it -- a shape the product cannot create. Measured on dev:
   all 20 positioned users are on `opndoor-agents`, and the two users on
   real suppliers hold no position. Its estate moved to the house partner,
   which is what "Group Director" always meant.

---

## SUPERSEDED: the first version of the supplier-statements instruction (sent minutes earlier, 2026-09-30, verbatim). ACTIVE. Top of the list.

> Supplier monthly commission statements: a supplier's Management users who have statements switched on receive their supplier's monthly commission statement, addressed to the supplier. Deploy to dev and check it there.

### This closes the gap Q4 surfaced an hour earlier

Q4 gave a supplier's Management the PERMISSION to switch statements on and
left the statement itself undeliverable, which the pgTAP file records as a
22023: `commission_statement_party(p_user)` returns nothing for anybody
holding no org attachment, and a supplier's staff hold none by design
(decision D11, "positions are an agency-estate thing and this rail has
none").

So the party lookup, not the permission, is what has to change.

### What "addressed to the supplier" settles

The payee is the SUPPLIER COMPANY, not the person and not an agency
underneath it. That matters because a supplier carries agencies, and a
statement addressed to one of those would be the agency's money, not the
supplier's. On the supplier rail `partner_id` IS the company, so the party
is the partner row -- the one rail where that is the right answer, which is
rule 2 and the same distinction Q4 turned on.

### Three things to get right, each of which is a way to get it wrong

1. **The agency rail must not move.** `commission_statement_party` is asked
   for every recipient of every statement, so a new arm has to be additive
   and must not shadow the group / agency / branch ladder above it.
2. **A supplier's REFERRER must not receive one.** Matt says Management,
   and the existing level gate (`role = 'management'` plus the commission
   bit) already says so -- but it has to keep firing on the new arm rather
   than being bypassed by it.
3. **A supplier person with statements OFF must not receive one.** The tick
   is the whole instruction: "who have statements switched on".

---

## Q4 ANSWERED: SUPPLIER MANAGEMENT MANAGES ITS OWN PEOPLE (instruction, 2026-09-30, verbatim). ACTIVE.

> Q4: yes. A supplier's Management user can change the notification settings of anyone at the same supplier, the same way an agency Director can for their agency. Referrers can change only their own event choices. Monthly statements stay Management-only. Deploy to dev and check it there.

### What this settles, in the three-setting table the ladder already uses

The agency rail's rules were settled on 2026-09-30 and are unchanged. This
adds the supplier rail's column, which was previously "nobody can, ever".

| setting | agency | supplier (NEW) |
| ------- | ------ | -------------- |
| **Event choices** | the person, or a Director at or above them in their own agency, or an Opndoor admin | the person, or **any `management` at the same supplier**, or an Opndoor admin |
| **Monthly statements** | Director-only, and only for somebody whose level may see commission | **Management-only** at the same supplier |
| **Copied on colleagues' referrals** | Director-only | **Management-only** at the same supplier |

"The same way an agency Director can for their agency" is the sentence that
settles the third row: he did not name that setting, and the natural
reading of "the notification settings of anyone" plus the explicit
Director parallel is the whole set, not two of three.

### Why it could not work before, and it is not an oversight in the UI

`caller_may_set_for` tests the ladder through `user_within_caller_scope`,
which requires the TARGET to hold a row in `user_scopes`. A supplier's
staff never hold one, and deliberately:
`user_must_hold_a_position` returns early off the estate and says why --
"on the supplier rail partner_id IS the company boundary ... requiring a
position there would be ceremony with no boundary behind it."

So the guard was not refusing supplier management; it was failing to find
anything to reason about, and answering no. Recorded as B3 and as round
6's M10, both of which this closes.

**On the supplier rail the boundary is `partner_id`**, which is rule 2, and
that is what the new arm tests. It is the one rail where that column IS a
company boundary, so this is not the fail-open shape CI rejects on the
agency rail.

---

## ANSWERS, AND THE LAST TWO BUILDS (instruction, 2026-09-30, verbatim). ACTIVE. Top of the list.

> Q1: a start-date correction on a joint tenancy moves every tenant's application and reissues every deed, never one. Q9: only the two Reconciliation buttons; the other 27 go on the after-shipping list. Q7: fine as done.
>
> Also build the two I asked for today: the supplier Add user form (no branch for any supplier role, "Supplier" not "partner"), and single-office agencies shown as just the agency with no branch level, with Add branch still available.
>
> Then merge, apply the migrations and deploy everything to dev, check each item there, and tell me when dev is ready for me to walk.

**The walk freeze is lifted by this instruction.** Merging, applying and
deploying are exactly what it asks for, so the "DEV IS FROZEN" section below
is spent.

### Q1 is answered, and the answer has two traps the answer does not mention

Matt's words: "moves every tenant's application and reissues every deed,
never one." That is option B, and it is the faithful mirror of what
`amend_tenancy_start` already does for the STAFF path. Two things have to
come with it or it ships a worse bug than the one it fixes, both found by
the adversarial check before any of it was built:

1. **THE CLAIM IS PER APPLICATION AND THE CORRECTION IS NOW PER TENANCY.**
   `deedEmail` mints and reuses a token per applicant, so each tenant of a
   joint let has their OWN live 7-day link. Correct the whole tenancy
   through tenant 1's link and tenant 2's link is still unused and still
   live -- and clicking it would re-run the entire teardown across every
   sibling. That is round 6's M4 one level up. The claim has to move to the
   tenancy.

2. **R5 TESTS EVERY SIBLING BEFORE IT WRITES ANYTHING, AND THE AGENT PATH
   TESTS ONE.** `amend_tenancy_start` checks permission AND eligibility for
   every application in the tenancy and aborts the lot on a single refusal;
   the edge function's only check is `withdrawn_at` on the clicked
   application. Without the same pre-check, a correction would move a
   withdrawn sibling's date and tear down a deed that should not have been
   touched.

### Q9 is answered: the two, and the rest go after shipping

Only the two Reconciliation buttons, which are built. **The other 27 one-click
admin actions are recorded under "Walk fixes, after shipping"** as item 23b,
with the inventory, so the list is not lost.

### Q7 is confirmed: the Merge button stays deleted

### DONE, MERGED, APPLIED AND CHECKED ON DEV. Dev is ready to walk.

| item | commit | checked on dev |
| ---- | ------ | -------------- |
| Q1, the whole-tenancy correction | `0f6c1f5` | `tenancy-correction` deployed (v11); the DEPLOYED bundle carries `tenancy_id`, `in("application_id", ids)` and `from("tenancies")` |
| Q9, the two Reconciliation buttons | `0e176cd` | served by 5174 |
| NM-O, supplier users have no branch | `fb98252` | served: `label="Supplier"`, the hint, and the estate-only Branch condition |
| NM-P, a single-office agency | `c7ac4a1` | predicate served on all six client surfaces; SQL predicate live |

**Four migrations applied to dev:** 20261006990000, 20261007000000,
20261007010000, 20261007020000. `npm run drift` clean -- 354 migrations,
331 functions. **pgTAP against dev: 69 files, 0 failing.** Client suite 150
files / 1605 tests, typecheck clean, `deno check` 66 clean.

**NM-P measured against dev's own agencies, which is the check that
matters:** Regent's Lettings, Southbank Residential, Harbour Lets and
Harborview Lettings each have exactly ONE office, so the rule fires for
them; Kestrel and Northgate have two and keep their office names. The
"Unattached" placeholders have zero and correctly still show, because zero
is not one.

### NM-P: three sites NOT done, and they are the outward-facing ones

The deed/expiry email's Branch row, the expiry-cohort CSV column and the
commission-statement email. Each is built from rows an RPC hands a Deno
function, so each needs its feeding RPC to carry an office count -- a
migration per RPC. **The SQL predicate they will use is already live**
(`public.agency_names_its_offices`), so this is wiring rather than design.
Recorded rather than claimed, because an email is the one surface where
"mostly done" is indistinguishable from done until a customer reads one.

### Walk fix 23b: the other 27 one-click admin actions, after shipping

Matt's Q9 answer: "only the two Reconciliation buttons; the other 27 go on
the after-shipping list." The two are done. The inventory of the remaining
27 is in the mapping run and is not lost; `useConfirm()` exists for them.


---

## NM-P. A SINGLE-OFFICE AGENCY IS JUST THE AGENCY (instruction, 2026-09-30, verbatim). ACTIVE.

> A single-office agency shows only as the agency, e.g. "Regent Property", everywhere: agencies list, agency page, applications, reporting, statements, emails, deeds and the referral form. No "1 branch", no branch row, no branch name. Where the system needs an office behind the scenes, it uses the agency's own name and address and is never shown separately. "Add branch" stays available on the agency (its menu or page), and as soon as a second office is added, both appear as branches.

### What this is, and why it is bigger than a display rule

It is a **display** rule with a **data** rule behind it, and the second
sentence is the one that decides the size: "Where the system needs an office
behind the scenes, it uses the agency's own name and address and is never
shown separately."

So the branch row does not stop existing. Every referral still hangs off a
branch, `branch_id` is still how the agency rail resolves a position, and
deeds, statements and notifications all still route through one. What
changes is that when an agency has exactly ONE office, no surface says the
word "branch", shows its name, or counts it.

**The rule is conditional on a count, which means it can flip.** "As soon as
a second office is added, both appear as branches." So this cannot be
implemented by deleting the branch layer or by renaming the office after the
agency: it has to be one predicate, asked in every one of the nine places he
lists, and the answer has to change the moment a second branch exists.

### The nine surfaces he names

agencies list; agency page; applications; reporting; statements; emails;
deeds; the referral form; and "no '1 branch'" wherever a count is printed.

### Known related work already in the tree

The collapse-when-there-is-only-one idea already exists for COLUMNS, in
`viewerShape` / `dimensionCollapsed` / `statementColumns`, with the
"empty book answers one of everything" convention. That is the same shape of
question and may be the right predicate to extend rather than a new one --
but note it answers about the READER's book, not about one agency, so it is
a starting point and not the answer.

**Status: not started.** Recorded before work, per the rule at the top of
this file.

---

## NM-O. SUPPLIER USERS HAVE NO BRANCH (instruction, 2026-09-30, verbatim). RECORD NOW, BUILD AFTER THE WALK.

> Supplier Add user form: suppliers' own staff do the referring, so a supplier user has no branch. Remove the Branch field from inviting or editing a supplier user entirely, for every role; the agency and branch are chosen on each referral instead. Replace "Partner company" and "partner" with "Supplier" throughout, including the role descriptions. Check nothing else (league, statements, notifications) assumes a supplier user has a home branch. Record in QUEUE.md; build after I say the walk is done.

**Not started.** Matt's own words: "build after I say the walk is done."

### The three parts, as I read them

1. **Remove the Branch field** from inviting AND editing a supplier user,
   for EVERY role. Not hidden for some roles: removed.
2. **Rename "Partner company" and "partner" to "Supplier" throughout**,
   including the role descriptions. Note this is the user-facing vocabulary
   only. `partner_id`, `app_partner()`, `partnerScope` and the whole
   isolation model keep their names: on the supplier rail the partner IS the
   company boundary and renaming the boundary in code would be a much larger
   and riskier change than the one being asked for.
3. **Check nothing else assumes a supplier user has a home branch** --
   he names league, statements and notifications. This is the part that
   decides whether the item is small or not, because a home branch that
   other code relies on cannot simply stop being collected.

### Why this is more than a form change, and where the risk is

The constraint trigger that refuses an unpositioned user on our own estate,
and `set_home_branch`, both exist because an AGENCY user's position is how
the agency rail derives its boundary. A supplier user's boundary is
`partner_id`, which is why they need no position at all. So removing the
field should be consistent with the model rather than fighting it -- but
anything that reads a home branch and does not first ask which rail the
user is on will start reading null.

### The read-only check is DONE. Answer: the model already agrees with Matt

Run while the walk was on, against the migration files and the client. No
file changed, no database touched.

**Nothing in league, statements or notifications assumes a supplier user has
a home branch.** Exactly FOUR functions in the whole final schema still
mention `users.home_branch_id`: `create_invited_user` (writes it; null skips
its reach test), `set_home_branch` (the only writer),
`users_home_branch_guard` (refuses any other write) and
`list_managed_users` (selects it for display). Every boundary that used to
read it was rewritten to positions by 20261006310000 and 20261006320000.

- **League.** `agency_weekly_climber` carries the comment "Positions only:
  home_branch_id is not a boundary anywhere any more." Client side is
  positions-only too.
- **Statements.** `commission_statement_party`'s home-branch arm was
  DELETED by 20261006320000; recipients join `user_scopes` only.
- **Notifications.** The supplier arm resolves from
  `effective_primary_contact_route(a.branch_id, a.partner_id)` -- the
  APPLICATION's branch, chosen per referral, which is exactly what Matt
  says should happen.

And the position requirement is already estate-only by design:
`user_must_hold_a_position` returns early when the partner is not
`opndoor_referenced`, and says why -- "on the supplier rail partner_id IS
the company boundary ... requiring a position there would be ceremony with
no boundary behind it."

There is even a green test proving it: `a_suppliers_volume_is_its_own.test.sql`
creates a supplier referrer with `home_branch_id` NULL and no `user_scopes`
row.

**So this is a form-and-copy change, not a data change.** Good news for its
size.

### Three things the sweep found that the instruction does not name

1. **The Branch field is offered in THREE places, not one.** The /users Add
   user dialog; the row menu's "Set what they see", which opens
   PositionModal and writes `home_branch_id` through `set_home_branch` --
   this is the "or editing" half and is easy to miss because nothing on it
   says "Branch"; and AgencyHome's InviteToLevel, reachable for an admin
   from PartnerHome's Structure tree, which sends BOTH a home branch and a
   position into a supplier partner.

2. **The client is STRICTER than the server and will block on a control
   that is no longer there.** `UserManagement.tsx:564` refuses to let a
   supplier's Manager invite a Referrer until they pick a branch. The
   server never asks: `invite-user`'s equivalent is gated on `callerScoped`,
   true only for users holding `user_scopes` rows, which a supplier's staff
   never do. Remove the field without removing this guard and a supplier
   Manager is blocked by a toast about a field that is not on screen.

3. **PartnerHome already does it right and is the precedent to copy**:
   `manyOffices={false}`, `onPosition` a no-op, with a comment recording it
   as decision D11, "positions are an agency-estate thing and this rail has
   none."

### And two pre-existing gaps it surfaced, which are POSITION-shaped, not branch-shaped

Neither is caused by the Branch field and both survive this change:

- A supplier **Director can never be put on a commission statement** --
  `commission_statement_party` returns nothing for them.
- The /users **"Sees" column reads "Own referrals" for every supplier
  user**, including their management.

### The rename: what moves and what must not

Moves: `UserManagement.tsx` label "Partner company" and its hint (the select
under it is fed by `getPartners()`, which strips every house partner, so the
label is already wrong about its own contents); the Management and Developer
role descriptions; the Partner column and chip; the re-invite sentence.

**Must not move:** `partner_id`, `app_partner`, `partnerScope`,
`addPartnerId`, `getPartners`, the `partner` key in the inviteUser payload,
and Dashboard's "Commission by partner" / DevCentre / exportsService copy --
those mean the ROUTE, and `suppliersAreCalledSuppliers.test.ts` exists
specifically to stop a sweep renaming them. That test should be extended to
cover the invite surface when the build happens.

---

## DEV IS FROZEN WHILE MATT WALKS (instruction, 2026-09-30, verbatim). OVERRIDES THE DEPLOY RULE BELOW.

> Pause changes to dev while I walk the Regent and Kestrel paths. Carry on in the worktree and don't merge or deploy until I say the walk is done.

### What this changes, precisely

| | before | while the walk is on |
| - | ------ | -------------------- |
| Where code is written | main tree | **the `fix-the-seven` worktree** |
| Merging to `partner-api` | after each item | **not until Matt says the walk is done** |
| Migrations applied to dev | yes, per item | **none** |
| Any write to the dev project | allowed | **none, including rolled-back probes** |
| "check it there before marking it done" | on dev | **cannot be satisfied.** Items are built and tested locally and marked `awaiting dev check`, not `done` |
| The 5174 server | kept running | **kept running and kept on the pre-walk code**, because it is what Matt is walking |

**Why nothing is merged, not just "not deployed".** The 5174 dev server is
served out of the MAIN tree. A merge into `partner-api` changes what Matt is
looking at mid-walk, so the freeze has to be on the merge, not only on a
deploy step.

**QUEUE.md is the one exception and stays in the main tree**, per CLAUDE.md:
it is the copy Matt reads, and it is documentation, so editing it cannot
change the running app.

**The local pgTAP cluster replaces dev for database work.**
`scripts/pgtap-local.sh` applies every migration in filename order to a
throwaway local Postgres and runs the suite against it. That is a STRONGER
check than dev for a new migration -- it proves a clean apply, which dev
cannot -- and it touches nothing of Matt's. What it cannot do is prove dev
agrees with the files; `npm run drift` is that check and it waits.

---

## VIEW AS: STOPGAP (instruction, 2026-09-30, verbatim). ACTIVE. Ahead of the queue-clearing run.

> Stopgap now: hide View as on agency and group pages, keep it on supplier pages where it works, and make sure no banner can claim a party the figures don't reflect. Also fix the three small ones: the Expiries button for opndoor_manager, the invisible Not in network empty state, and last_named_at. Record the proper fix (every Reporting figure following the selection) as the first item after shipping, and don't start it now. Then carry on clearing the rest of the queue, deploy each to dev and check it there.

### Why the stopgap is two changes and not one

Hiding the button is NOT sufficient for "no banner can claim a party the
figures don't reflect", and this is the part worth writing down. `scopeSel`
is ONE shared selection: Applications still has its own Origin picker
(`Applications.tsx`, walk fix 7), and it writes the same value. So an admin
can choose "Regent's Lettings" on Applications, open Reporting, and get the
false banner with no View as button involved at all. The selection also
survives a browser restart from localStorage, and the recents list offers it
back.

So the second half of the stopgap is in `SessionContext`: `viewingAs` derives
ONLY from a selection the figures actually follow, which today is
`partner:<slug>` alone. `partnerFor` yields a real partner slug for that and
ALL_PARTNERS for everything else, and every figure on Reporting is keyed on
`partnerScope`. Narrowing the derivation is what makes the banner honest
whatever route the selection arrived by.

### AFTER SHIPPING: AN AGENCY BELONGS WHERE ITS RELATIONSHIP IS (instruction, 2026-10-01, verbatim)

**Matt has said to record this and NOT build it.**

> the Agencies tab lists only agencies with a direct partnership with Opndoor. Agencies that only come through a supplier appear under that supplier, in an "Agents" tab on the supplier's page, not in the main Agencies list. An agency that has both appears in both, as the same record.

Worth noting now, while it is fresh, because it bears on the supplier-page
work in flight: this adds a THIRD tab to a supplier's page ("Agents"),
alongside the Settings and Integration tabs being built today. Whoever
does that should leave room for it rather than design the tab strip twice.

The hard half is "as the same record": one agency row, reachable from two
places, with no second copy and no merge. The agency rail already shares
one house partner, so "has a direct partnership with Opndoor" is a fact
that is not currently recorded anywhere and will need somewhere to live.

### AFTER SHIPPING, FIRST ITEM: every Reporting figure follows the selection

**This is the proper fix and Matt has said not to start it now.**

`scopeFull(apps, role, scope, sel)` already takes the selection as its fourth
argument and applies `originMatches` AFTER isolation, which is the correct
order and the whole design. **No production call site passes it** -- 19 of
them, across `liveAnalytics.ts`, `exportsService.ts`, `viewerShape.ts` and
`paymentMetrics.ts`, all stop at three arguments. So an `agency:` or
`group:` selection narrows nothing anywhere.

This is the same defect walk item 15 reported about the picker ("choosing an
option does nothing") and NM-F's acceptance line is the specification for
fixing it: *"Every tile, chart, export and statement on the page follows the
selection."*

The work is to thread the selection through the Reporting entry points --
`getDashboardData`, `getTrend`, `getCommissionSettlement`,
`getAgentCommissionSettlement`, `livePartnerBreakdown`, `liveScopeShape`,
`liveByCustomer`, `liveAggregate`, `liveVolume`, `liveTrend` -- and the
export builders, then restore View as on agency and group pages and widen
`viewingAs` back. The test that must fail first measures a FIGURE, not a
caption: the twelve assertions shipped with NM-M all checked the localStorage
string and the banner text, and the older test named "viewing as one of our
agencies" actually stages `partner:northwind`, the supplier arm that does
narrow, so the agency path had never been measured by anything.

---

## CLEAR THE QUEUE (instruction, 2026-09-30, verbatim). ACTIVE. Top of the list.

> Clear the whole queue now, without stopping: the Home wording change ("Awaiting decision, Sent and Paid show who is there now. Deed issued is all time."), round 6's M4, M9, M10, the eight lows, the allowlist ratchet, and walk fixes 22a and 23. Keep the audit to the three items you just built; no new review rounds. Deploy each to dev and check it there before marking it done.
>
> Anything that needs my decision, don't guess and don't stop: build everything around it, then give me all the open questions together at the end, one plain sentence each with the options.

### What this covers, resolved to the items in this file

| # | item | where it is recorded |
| - | ---- | -------------------- |
| 1 | Home wording: "Awaiting decision, Sent and Paid show who is there now. Deed issued is all time." | new, from this instruction |
| 2 | Round 6 **M4** -- tenancy-correction replay guard is per-token | line ~3616 |
| 3 | Round 6 **M9** -- direct-rail rows counted as agency business in the client | line ~3622 |
| 4 | Round 6 **M10** -- `set_receives_notifications` cannot reach a supplier colleague | line ~3623 |
| 5 | The **eight lows** | line ~3626 |
| 6 | The **definer allowlist ratchet** | `definerAllowlistCoverage.test.ts` |
| 7 | **Walk fix 22a** | walk batch, parked "after shipping" |
| 8 | **Walk fix 23** | walk batch, parked "after shipping" |

### The three standing rules for this run

1. **No new review rounds.** The audit already running covers NM-M, NM-N and
   the opndoor_manager fix and nothing else. The security review loop stays
   closed.
2. **Each item is deployed to dev and checked there before it is marked
   done.** Not at the end, per item.
3. **Decisions are not guessed and do not stop the run.** Anything needing
   Matt is built around, recorded under "Open questions for Matt" at the
   bottom of this section, and carried to the final report as one plain
   sentence with its options.

### Progress. EVERYTHING BUILDABLE WITHOUT A DECISION IS DONE.

Eight commits on the `fix-the-seven` worktree, unmerged and undeployed
because dev is frozen for the walk.

| item | state | commit |
| ---- | ----- | ------ |
| Home wording | **done**, checked on dev before the freeze | `065b72d` |
| View as stopgap | **done** | `66c8d5e` |
| The three small ones | **done** | `9b68c48` |
| M4 | **already fixed** by `dee9079`; the `todo` row below is stale. An adjacent defect is open on Q1. |  |
| M9 | **two of three done**; M9-b and a fourth site are Q2 and Q3 | `9427d43` |
| M10 | **not real as recorded**; the real one beside it is Q4 |  |
| The eight lows | **four already done** (verified), **four now done** | `320eb4c`, `ff47377` |
| The allowlist ratchet | **done** | `1972efc` |
| Walk fix 22a | **done** | `461027f` |
| Walk fix 23 | **the two Matt named, done**; the other 27 are Q9 | `0e176cd` |

**Verification, in place of the dev check Matt's rule asks for.** A clean
filename-order apply of all 353 migrations to a local Postgres: 69 pgTAP
files / 991 assertions / 0 failing. 146 vitest files / 1560 tests,
typecheck clean. The 11 unhandled vitest errors are the baseline's.

**NOTHING HERE IS "DONE" BY MATT'S OWN RULE YET.** Each item still needs
its dev deploy and check. That is roughly an hour once the walk finishes,
and it covers three new migrations -- 20261006990000, 20261007000000,
20261007010000 -- plus all the client work.

### Three things the mapping found that were worth more than the fixes

1. **Half the queue was already done.** M4, four of the eight lows and
   22a's timeout are all fixed or not real, and the rows here said `todo`.
   Verified individually rather than taken on trust.
2. **The coverage ratchet was counting comments.** "Exercised by a test"
   meant the name appeared followed by a paren anywhere in the suite,
   including inside SQL comments and inside grant assertions. Two
   functions were recorded as proven and were not, one of them
   `is_opndoor_staff` -- the predicate four RPCs gate on.
3. **Walk fix 23 is 29 actions, not two.** That is Q9 and it is the one
   answer that changes the size of what is left.

### Open questions for Matt

Collected rather than guessed, per his instruction. One sentence each.

**Q1. The agent's correction link on a joint tenancy.** R5 made a tenancy
have one start date, but the agent's unauthenticated 7-day link bypasses
that RPC and moves one application, leaving the co-tenant's executed deed
on the old date: should that link refuse joint tenancies and fall back to
a report Opndoor applies through the audited staff path, or move the whole
tenancy and reissue every sibling deed with no sign-in behind it?

**Q2. What "What they earned" means on a group page.** The group's own cut
only, or the group plus every agency and branch under it?

**Q3. A direct signup on the agency volume chart.** A direct row matched to
Regent appears under Regent's NAME on an admin's agency breakdown: should
it read "Direct" instead, or be dropped from that breakdown entirely?

**Q4. Supplier colleagues and notification settings.** `caller_may_set_for`
blocks a supplier's own management from changing their colleagues'
notification settings because it requires a position and the supplier rail
has none: should they manage them at all, and if so is it any
`role='management'` in that partner?

**Q5. The help cache on sign-out.** Everything else a sign-out left behind
is now cleared; `grp_help_v9` is admin-authored shared content, so
clearing it costs a re-download and protects nothing, except that it can
hold uploaded PDFs as data URLs: clear it too, or leave it?

**Q6. The ratchet: the number, or the guarantee?** A further day takes the
uncovered list from 36 to about 14 by writing cheap MFA-only assertions,
but the 14 dev-centre reads are the only ones that would prove anything
about the supplier boundary.

**Q7. ANSWERED BY ME, flagged rather than asked.** The permanently
disabled "Merge into..." button is gone. Matt quoted the roadmap sentence
beside it as jargon to remove, and a greyed button saying "coming in a
later release" is the same promise in another form. Say if you wanted it
left.

**Q8. A 100% name match with exactly one branch.** An exact EMAIL match
already links itself with no click; should an exact NAME match on an
agency with only one office do the same, or must a person always press?

**Q9. The size of walk fix 23.** "Any other admin action that changes
records in one click" is **29 actions**, not the two on Reconciliation:
all 29 (about a week), or only the 19 that cannot be undone or that send
something outward (about three days)?

---

## NM-M AND NM-N ANSWERED, PLUS ONE MORE (instruction, 2026-09-30, verbatim). ACTIVE. Top of the list.

> NM-M: keep View as, moved to a "View as" button on each agency and supplier page; delete the Reporting scope picker. NM-N: don't create companies in HubSpot automatically; list agencies a direct tenant named that we don't work with on the Reconciliation page, with the agent contact given, for someone to add to HubSpot by hand. Also fix the blank Reporting page for opndoor_manager. Deploy to dev and check each there, then stop and report.

### What this settles, and what it changes

**NM-M is answered as option 2, the one that loses nothing.** View as survives;
what goes is the picker. The button moves the control to the page that already
names the party, which is also where item 15's Reporting tab now lives.

**One thing that follows and is not in the sentence.** The picker was the only
way to STOP viewing as. A button that starts it needs something that ends it, or
an admin who views as Regent has no way back to the estate view -- and
`scopeSel` is shared with Applications, so they would find that list narrowed
too, with no control on either screen. So Reporting gains a "viewing as X ·
stop" banner. Recorded here as a consequence of the instruction rather than an
addition to it.

**NM-N is answered as none of my three options**, and the answer is better than
all of them: nothing is written to HubSpot at all, so the dedupe problem that
blocked it does not arise. The portal lists what it knows and a person decides.

**The opndoor_manager fix is new** and was not in any item. It came out of
walk fix 20: `paymentMetrics.scopeFull` has a positive role allowlist naming
only `referrer`, `superadmin` and `management`, so that role is handed an empty
set and every live figure reads zero.

### Order, and what happened

| # | item | status | commit |
| - | ---- | ------ | ------ |
| 1 | **opndoor_manager's blank Reporting** | **done**, on dev | `f2ccdb0` |
| 2 | **NM-M: the View as button, then the picker's deletion** | **done**, on dev | `a5b93ae` |
| 3 | **NM-N: the not-in-network list on Reconciliation** | **done**, on dev | `50c60b3` |

Merged into `partner-api`. Migration `20261006980000` applied to dev;
`npm run drift` clean. Suite 139 files / 1496 tests, typecheck clean. The
11 unhandled errors in the vitest output are the baseline's and predate
this work (measured at 135/1453/11 before it started).

#### 1 was five allowlists, not one line

The scopeFull fix recorded under walk fix 20 was necessary and nowhere near
sufficient. Four more blank the page independently -- `partnerScope` (ops
staff have no home partner, so they were pinned to the mock default
'northwind' and scopeFull's FIRST filter emptied the book before the role
allowlist was reached), the two `ownOnly` copies that drive the page's
words, nine `RoleOnly` gates, and the export gate. All four went stale
together when the role was added in 20260922090000. The hand-copied literal
is now one name, `READS_THE_WHOLE_BOOK`, beside `maySeeCommission` in
types.ts, because the whole defect is the difference between those two
questions.

**And a sixth that made any test of this role a lie.** `KNOWN_ROLES` in
SessionContext never learned `opndoor_manager`, and `initialRole()` falls to
the least privileged role for anything not on it. In Supabase mode that is a
wrong-role flash until the profile lands; in mock and test mode there is no
profile, so staging the role produced a Negotiator permanently. No render
test of this role could say anything true, and one of mine was passing for
exactly that reason until this was found. Worth remembering as a class: a
green render test of a role the harness cannot stage is worse than no test.

**A tenth thing the widening woke up, which is the reason a sweep is not
just an apply.** `trendMeasuresFor` had named `opndoor_manager` since it was
written and offered them "Commission payable". It never mattered, because
the trend card sat behind a gate that omitted them. Drawing the card made it
live -- and `liveMonths` computed `payable` with no commission guard at all,
so the figures behind it were real. Both halves closed, both
mutation-checked. 20261005170000 is explicit: may_see_commission is "never
true for opndoor_manager".

#### 2 came with a broken link of my own making

`CustomersTable` (walk fix 20, mine, yesterday) linked an agency by NAME.
`/agencies/:key` resolves against `id ?? name`, which is what the exported
`agencyKey` helper returns and what every other agency link uses. The mock
seed gives its agencies no id, so `id ?? name` IS the name there and the
fixture agreed with the bug; on dev, where every agency has a uuid, every
row landed on "Agency not found". That made the new View as button
unreachable from the page it is reached from. The existing render test
asserted the href starts with `/agencies/`, which stayed true throughout:
starting with the right prefix and pointing at the right record are two
claims and only the first was being made.

#### What "checked on dev" means for each, plainly

There is no browser automation here, so none of the three was clicked
through in a browser. What was done instead:

- **1.** The server's answer for the role was measured on dev inside a
  rolled-back transaction: identical book to a superadmin (35 applications,
  9 agencies, 11 branches, 7 partners), `app_partner()` **null** -- which is
  the exact cause of the partnerScope defect -- and `may_see_commission()`
  **false**, which is the line the client must hold. So the server was
  serving the whole book and the client was discarding it, which is the
  diagnosis. The client half was confirmed in the code the dev server is
  serving. **Dev has no `opndoor_manager` account**, so a real login as one
  was not possible; creating one is a persistent credential on dev and is
  your call, not mine. Say the word and it is five minutes.
- **2.** Confirmed in the served code: no ScopePicker on Reporting, the
  banner and its stop control present, ViewAsButton on both pages,
  Applications' own picker untouched, the customer link carrying the id.
  Behaviour is covered by 12 render assertions.
- **3.** The RPC was run against real dev data inside a rolled-back
  transaction: two dismissed matches spelled "Knight Frank" and "Knight
  Frank Ltd" collapsed to one row keyed `knight frank` with tenants = 2 and
  their shared contact de-duplicated to a single object; the existing
  dismissed row came back with an empty contacts array, correctly, because
  the contact that tenant gave was a private landlord. Dev is unchanged
  afterwards. `definer_grants` 4/4 and
  `every_browser_rpc_checks_its_reach` 44/44 green against dev.

### Found on the way, NOT fixed, needs your call

None of these is in the instruction, and each is recorded rather than folded
in.

1. **`Help.tsx` hands Opndoor ops staff the commission guides.** The only
   genuine over-grant found. `ROLE_RANK` ranks `opndoor_manager` **equal to
   superadmin** (both 3), and `admin: role === 'superadmin' || role ===
   'opndoor_manager'` short-circuits the `needsCommission` test in
   `mayOpenResource`. So they can open every `minRole: 'superadmin'`
   resource including the Opndoor admin guide, and the Management guide,
   which states the commission in prose. Migration 20261005170000 says
   may_see_commission is "never true for opndoor_manager, who is Opndoor
   operations and has never seen commission." The client hands it to them in
   a PDF. Small, but it is a real leak and it is one line each to close.

2. **The same role is routed to a decision queue and given no decision
   buttons.** `ApplicationDetail`'s Approve and Decline are gated on
   `isAdmin = role === 'superadmin'`, while `nav.ts:138` gives
   `opndoor_manager` the "Awaiting decision" queue **with a live badge**,
   `App.tsx:130` admits them to the record, and the SQL admits them --
   `set_application_status` and `decline_application` both swapped
   `is_admin()` for `is_opndoor_staff()` in 20260922090000. The database
   would accept the call. Same file: the activity feed hides internal rows
   from them, and `maySeeDocuments` refuses them the bank statements the
   guarantee decision is made on.

3. **`canSeeSettlements` on Reporting still omits the role**, so the
   agent-rail funnel and two needs-attention lines stay hidden for them.
   Deliberately not widened: `get_agent_rail_funnel`
   (20260904210000:25) refuses `opndoor_manager` outright, so widening the
   client alone turns a hidden card into a thrown error on dev. Needs a
   migration first, then the gate.

4. **The Reconciliation sidebar badge disagrees with the ops Home tile** for
   this role. `Sidebar.tsx:32` returns 0 for anybody who is not
   `superadmin`, while `Home.tsx:45` counts matches for them under
   `isOpndoorStaff`. The queue can back up silently, which is the exact
   failure the badge exists to prevent.

5. **`OrgManagement.tsx:888` scopes the Agencies list to `partnerScope`**
   for anybody who is not superadmin. With today's partnerScope fix that is
   now ALL_PARTNERS for ops staff and so is no longer wrong, but the line
   still reads as though only an admin gets the estate. Worth a look when
   somebody is next in that file.

6. **View-as is still unaudited for agencies and groups.** `log_view_as`
   exists and the Topbar partner switch writes to it, but `partnerFor`
   leaves partnerScope at All for `agency:` and `group:`, so those never
   reached it. True of the picker too, so NM-M does not change it -- but the
   button makes view-as a deliberate, named, routine action, which is the
   kind the audit table exists for. Closing it needs a migration:
   `log_view_as` refuses any kind but 'partner' and 'agency', so a group
   cannot be audited at all today.

7. **`agency_match_queue` does not filter `livemode`**, unlike its siblings
   in the same file. Sandbox applications reach the Direct matches queue.
   The new `not_in_network_agencies` filters it; the sibling was left alone
   because changing what an existing queue shows is a behaviour change
   nobody asked for.

**Step 4 of the night run is not finished and is NOT abandoned.** "Every defect
recorded from last week's walks and reviews that is still open in QUEUE.md or
DEFECTS.md" -- DEFECTS.md is done; QUEUE.md still carries round 6's **M4, M9,
M10 and the eight lows**, plus the allowlist-ratchet tightening. This
instruction ends with "then stop and report", so those wait for the report
rather than being folded in.

---

## THE NIGHT RUN (instruction, 2026-09-29, verbatim). ACTIVE. Top of the list.

> I'm stopping for the night and not walking again until morning, so you may merge the worktree and apply to dev when ready.
>
> Work through QUEUE.md in order, doing exactly what is recorded there, no more and no less:
> 1. R2 to R7 of the seven fixes.
> 2. Walk fixes 13 and 14 (inviting, plain-English errors), since they block shipping.
> 3. Every other walk fix, batches 1 to 18, including those marked after shipping.
> 4. Every defect recorded from last week's walks and reviews that is still open in QUEUE.md or DEFECTS.md.
> 5. Then walk it end to end on dev yourself: as Tom at Regent, a single tenant and a joint pair; as the Kestrel user, a single tenant; each through payment and signature to an executed deed, checking the fee, the commission and who received every email. Also invite one person at each level to Regent. Report what worked and what didn't.
>
> Each fix with a test that fails first. Anything under "Needs Matt" stays parked; build up to it and mark it clearly. No review rounds, no new features, nothing not in the queue. Do not touch production. Keep QUEUE.md current as you go. When done, or if you run out of session, commit, report in plain English, and end with "Resume: read docs/QUEUE.md".

### What this changes

Dev is **unlocked**. The worktree merges, R1 applies to dev, and everything
after that is built the normal way. Production stays untouched.

### Two things flagged at the start rather than discovered at the end

**Step 5 cannot fully run on this machine, and that is not new.** The walk
needs Stripe, PandaDoc and an inbox, and all three live inside Deno edge
functions. **Deno is not installed here**, which is why `docs/THE-WALK.md`
could only walk the database half in the first place. So "through payment and
signature to an executed deed, checking every email" is not something a
terminal can do. What CAN be done, and will be, is everything the database
decides: the fee, the commission split, and exactly who each email would be
addressed to, per rail, walked as the real users. That distinction is stated
here so the final report is not read as more than it is.

**Step 5 also needs a Kestrel login, and there isn't one.** There is no active
user on Kestrel, Harbour, Letly or the referencing partner; the only
supplier-side account is `123@opndoor.co` on test-supplier, still pending with
no password. Creating one is a change to Matt's data, so it is NOT done
silently: it is listed under "Needs Matt" as NM-H, and the supplier half of
the walk is run against a user this session creates ONLY if Matt says so.
Until then the supplier rail is walked at the database level, which needs no
login.

**Step 4's scope, stated before starting it.** `DEFECTS.md` is 19 defects
about the LIVE system. Several are explicitly not fixable from here -- 1
(rotate the committed cron secret), 2 and 17's scheduling, 5 (disaster
recovery) -- because they are actions on live infrastructure, and Matt's own
instruction says do not touch production. Those get marked, not attempted.
The ones that are code in this repo get fixed.

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

### Batch 19 (verbatim). Item 34 is being built with the invite fix.

> Walk fixes, batch 19. Add to QUEUE.md verbatim and commit. Build item 34 as part of the inviting fix you're already doing; the rest in queue order.
>
> 31. Invite email: the App Store and Google Play lines print raw code as text ('<a href="..." style="color:#5b3fd9;">') and show each link twice. Each should be one clean link.
> 32. Invite email: the authenticator app is explained twice ("You will need an authenticator app" then "You need an authenticator app"). One short line.
> 33. Invite email: it says "invited you to the portal for Opndoor Agents", naming the hidden house account. It must name the agency or supplier the person is joining (e.g. Regent's Lettings), and Opndoor staff invites should say Opndoor. Check every other email for the house account name.
> 34. Invite email: the setup link redirects to localhost:5173 while the portal runs on 5174, so accepting an invite on dev may fail. Fix it on dev, and add the correct live portal address for invite and email links to HANDOVER-BALAL.md as a cutover step with a check.

**Item 33 is the serious one of the four.** The other three are the email
reading badly; 33 is the email telling a letting agent the name of an
internal plumbing account. `opndoor-agents` is the house route every agency
shares -- it is not a company, it is not the reader's employer, and it should
never appear in front of a customer. Matt's "check every other email for the
house account name" is the right instruction: the invite is where he saw it,
not necessarily the only place it is.

**Item 31 is an escaping bug, not a copy bug.** Raw `<a href=...>` printed as
text means a link was built as a string and then escaped, or inserted into a
template that escapes its input. Whatever is doing that will be doing it to
anything else built the same way, so the fix belongs at the builder rather
than in the two lines Matt saw.

## NOTIFICATIONS ARE GENUINELY PER PERSON (instruction, 2026-09-30, verbatim). ACTIVE.

> Notifications: genuinely per person, for agency and supplier users as well as Opndoor staff. Each person chooses which events they are told about for the referrals they can see, on their own panel, and whether they get monthly statements if their level allows it. The locked items stay locked for everyone (every tenant email, and the executed deed reaching its recipient). Opndoor admin can see every person's choices from that person's row on the agency, supplier and Opndoor team pages. Replace the agency-wide event switches with this; migrate today's agency settings onto each existing person so nobody's emails change on the day it ships.
>
> Applications Origin filter: keep it and make it work.
>
> Carry on with docs/QUEUE.md. Work in the worktree, deploy to dev and check each item there before marking it done.

### This REVERSES my judgement call, and that is the right outcome

I recorded that making the agency side per-person was "a schema change that
redefines what Q-03 built and tested, on the night before a cutover, to
answer a question nobody has asked", and built the panel to show party-wide
switches with a warning instead. Matt has now asked the question, so the
schema change is the work rather than something to avoid. The warning-label
compromise is withdrawn.

**What survives from the half-built work:** the assembler, the panel
component and the row action. They were built so the per-person case was
already the shape for Opndoor; the agency and supplier sides now join it
rather than needing a different panel.

**What is thrown away:** the `partyWide` flag and the warning that goes with
it, and the party-wide half of the assembler. Their tests go with them, and
that is a deliberate deletion rather than a regression -- recorded here so
the test count moving down is explained.

### One part of "replace the agency-wide switches" cannot be per person, and here is why

**The supplier rail's `agent_contact` is not a person.** It is resolved by
`effective_primary_contact_route` from `agent_contacts` -- a contact record
with a name and an email, no login, and no row in `public.users`. So it
cannot have a panel, because there is nobody to open one.

| party | classes today | can become per person? |
| --- | --- | --- |
| agency | `referrer`, `ticked_users` | **yes, both are users** |
| supplier | `referrer`, `agent_contact` | referrer yes; **agent_contact no** |
| Opndoor | already per recipient | already yes |

So the build is: every class that is a USER becomes per person, and the
supplier's agent-contact routing stays a party setting, because there is no
third option. It will be shown on the supplier's own page rather than in a
person's panel, and labelled as what it is: where the executed deed goes when
the supplier has no human on the referral.

**Flagged rather than decided.** If Matt wants the agent contact gone as a
concept, that is a different and much larger change -- it is the only
recipient on the supplier rail when a referral arrives through an API key
with no human attached, which is the case Q-02 exists for.

### A second thing the instruction does not settle, so it is being read literally

"Each person chooses" and "Opndoor admin can see every person's choices" name
two capabilities: the person CHOOSES, the admin SEES. It does not say whether
an agency Director may change their own staff's choices.

Read literally, they may not -- and that is a real change, because today a
Director can edit their agency's matrix for everybody. **Built as: the person
edits their own, an opndoor admin edits anyone's, and a Director can SEE
their team's but not change them.** Say if that is wrong; it is one predicate
either way.

### The clause that is easy to miss, and is the whole risk

> **migrate today's agency settings onto each existing person so nobody's
> emails change on the day it ships.**

The settings are stored today per (party, event, recipient CLASS). They must
become per (person, event). That is not a copy: it is a JOIN, because which
class a person falls into depends on the person -- the referrer of a given
referral, somebody ticked "receives notifications", or a supplier's agent
contact. Getting it wrong means somebody silently stops being emailed, and
nobody finds out until a deed does not arrive.

So the migration needs a test that asserts, for every existing person, that
the set of events they would be emailed about is IDENTICAL before and after.
Not that the rows look right: that the outcome is unchanged.

### Four other things in the instruction that each need their own assertion

1. **"for the referrals they can see"** -- the scope is unchanged. A person's
   position still decides WHICH referrals; the new setting only decides WHICH
   EVENTS. The per-person setting must not become a way to widen reach.
2. **"whether they get monthly statements if their level allows it"** -- the
   statements toggle is offered only where `may_see_commission()` is true, so
   a Manager does not get a control that the server will refuse.
3. **"The locked items stay locked for everyone"** -- the executed deed to
   its own recipient, and every tenant email. Locked must survive the move to
   per-person, and must not become per-person-overridable.
4. **"Opndoor admin can see every person's choices"** -- from the row, on all
   three pages. A read for an admin, an edit for the person's own party
   within the existing ladder.

---

### WHO MAY CHANGE WHAT (instruction, 2026-09-30, verbatim). ACTIVE.

> Change to notifications: a Director can change the notification settings of anyone at or below them in their own agency, not just see them. Each person can still change their own event choices. Two settings are Director-only: turning monthly commission statements on or off (and only for people who can see commission), and whether someone is copied on colleagues' referrals within their position. Opndoor admin can change anyone's. Enforce all of this server-side, with tests for each role, then carry on with docs/QUEUE.md without stopping.

**This supersedes the read-literally choice I flagged an hour ago.** I had
built "the person edits their own, an admin edits anyone's, a Director may
see but not change" and said it was one predicate either way. It is now
three predicates, because the three settings no longer share one rule.

### DONE `1218473`, and checked on dev against real people

| who | did | outcome |
| --- | --- | --- |
| Rosa (Regent Director) | change Tom's event choice | **allowed** |
| Rosa (Regent Director) | copy Tom in on colleagues' referrals | **allowed** |
| Tom (Negotiator) | change his OWN event choice | **allowed** |
| Tom (Negotiator) | copy himself in | **refused** |
| Tom (Negotiator) | give himself statements | **refused** |

15 assertions across four roles, nine failing first. Applied to dev, drift
clean, 64 pgTAP files / 0 failing there.

**Three existing tests changed, all deliberately**, and one of them is worth
knowing about: `commission_statement_recipients` had two assertions saying
"an agency manager cannot set it" about a fixture that has always been an
Agency DIRECTOR. Under the ruling she can, so they flipped -- and the
mismatch between the old wording and the data it described is part of why
the change reads as surprising.

**The one capability REMOVED:** `set_receives_notifications` previously
allowed `p_user = auth.uid()` outright, so anybody could copy themselves in
on their colleagues' referrals. Withdrawn.

### The three settings, and they are now genuinely different

| setting | who may change it |
| --- | --- |
| **Event choices** (`user_notification_settings`) | the person themselves, **or** a Director at or above them in their own agency, **or** an opndoor admin |
| **Monthly statements** (`receives_commission_statements`) | **Director-only** -- NOT the person themselves -- and only for somebody whose level lets them see commission. Plus an opndoor admin. |
| **Copied on colleagues' referrals** (`receives_notifications`) | **Director-only** -- NOT the person themselves. Plus an opndoor admin. |

**The half that is easy to get wrong is the negative one.** "Director-only"
means a Negotiator may not switch their OWN statements on, and a Manager may
not either. That is a capability being REMOVED from self-service, not just
one being granted to Directors, and it needs its own assertion per role
rather than being assumed to fall out of the positive rule.

**And "only for people who can see commission"** is a second gate on the
same setting: even a Director may not switch statements on for a Manager,
because a Manager may not see commission at all. Rule 3.

**"At or below them in their own agency"** is the reach test, and it is
`user_within_caller_scope` / the position ladder, not `partner_id` -- on the
agency rail every agency shares the house partner, so a partner test would
let a Director at one agency change somebody at another. That is rule 2, and
it is the single most repeated finding in this whole effort.

### Progress on the per-person change

| part | state |
| --- | --- |
| `user_notification_settings` table, RLS, per-person gate, the chooser RPC | **DONE** `fd52f37`, **applied to dev and checked there** |
| Migrating today's settings onto each person | **DONE** -- 198 person/event rows written on dev |
| Proof nobody's emails change | **DONE on dev**: 198 person/event pairs compared before vs after, **0 changed** |
| A real person choosing, on dev | **DONE** -- signed in as a Regent director, changed their own setting, read it back |
| A refund is the whole fee (Matt's other ruling) | **DONE** `fd52f37`, applied to dev; stripe-webhook deployed |
| The PANEL reading per-person settings instead of the party matrix | **DONE** `d1bfcb6`, **checked on dev** |
| Wiring the panel into the screens | **DONE** `d1bfcb6` -- FOUR, not three; see below |
| REMOVING the two tickbox columns, both grids, the Team tickbox and the Internal notifications page | **DONE** `d1bfcb6` |
| Applications Origin filter (item 7) | **DONE** `2fffe58`, **checked against dev's own book** |

**The client half is done and the old surfaces are gone.** Merged into
`partner-api` (`e257e14` + `fix-the-seven`), so the dev server on 5174 serves
it.

### The one number worth keeping

`198 person/event pairs compared, 0 changed`. That is the migration clause
Matt singled out, measured on dev's real people rather than argued. It was
run as a comparison of OUTCOMES -- what each person would be emailed about
before versus after -- not as a check that the rows look plausible.

---

## Items 9, 10 and 12: one per-person notifications panel. DONE AND CHECKED ON DEV.

`d1bfcb6`. This section replaces the "HALF BUILT" note that stood here; that
note also recorded a judgement call (that the agency side would stay
party-wide) which Matt's ruling of 2026-09-30 overturned, so keeping it would
have left a wrong answer in the file Matt reads.

### What is on the screen now

| part | state |
| --- | --- |
| `person_notification_panel(p_user)`, the whole panel in one round trip | **done**, migration `20261006930000`, applied to dev |
| `src/data/personNotifications.ts` reading it | **done** |
| `PersonNotifications.tsx` drawing it | **done** |
| The opndoor team page and Users, from the three dots menu | **done** |
| The agency People tab, from the row | **done** |
| The supplier People tab, from the row | **done** |
| Team -- an agency Director's own screen | **done**, and see the gap below |
| The two tickbox columns on the agency People tab | **removed** |
| Both "Who is told what" grids | **removed** |
| The loose tickbox column on Team | **removed** |
| The Internal notifications page, its route and its menu entry | **removed** |
| `NotificationMatrix`, `notificationMatrixService`, `opsRoutingService` | **removed** -- nothing imported them once the grids had gone |

### The server decides what may be changed, per section

There is deliberately no single "may edit" boolean. For a Negotiator reading
their own panel the honest answer is three different answers: yes to events,
no to the two Director-only settings. A client that re-derived the rules
would eventually disagree with the server, and that failure presents as a
control which looks live, accepts a click and throws.

`statements_apply` is also separate from `may_edit_statements`. A
Negotiator's LEVEL cannot receive a statement, so the section is absent
rather than disabled: a greyed control implies somebody could switch it on.

### The gap this work found, and closed

`PersonActions` opened with `if (!isAdmin) return null`. That is right for
everything else it draws -- resend, change level, position, password,
two-factor, remove, restore are all things Opndoor does TO somebody. So an
agency Director on the People tab was drawn no row action at all, and the
capability Matt had asked for the hour before existed in SQL with no door in
the product. Notifications now survives that return, gated per row on
`mayNotify` = `mayActOnOrEqual(me, them)`, the client twin of
`caller_may_set_for`. Two assertions failed first.

### One thing the old screens said that was not true

Both grids, and the Team column, told you a Negotiator had nothing to widen
and drew a sentence instead of a control. The deed resolver in
`20261006160000` copies anybody ticked whose scope covers the referral and
does **not** filter on role, so a ticked Negotiator IS copied. The panel
offers them the section, which matches the server. Not a change of
behaviour: the resolver is untouched, only the screen that described it
wrongly.

### What was walked on dev, as each role, through the RPCs the screen calls

| | |
| --- | --- |
| Negotiator, own panel | events yes / copied no / statements no; statements not offered at all |
| Negotiator changes an own event | `sent` true -> false, read back false |
| Negotiator reads the Manager's panel | refused, "You can only see this for yourself, or for people at or below you in your own agency." |
| Negotiator copies themselves in | refused, "You can only change this for people at or below your own position, in your own agency." |
| Manager, on their Negotiator | may READ, may change nothing |
| Manager, own panel | may change their own events |
| Director, on their Negotiator | all three |
| Director copies the Negotiator in | false -> true, read back true |
| Director sets a statement for a Negotiator | refused, "Only a Director receives a commission statement. Change their level first." |
| Director reads a supplier person's panel | refused |
| Admin, on the Kestrel director | kind `supplier`, copied-on not offered (no positions on that rail, B3) |
| A locked event | carries its sentence, not a bare flag |

And over the wire, not only through SQL: signed in as the Regent negotiator
with a real password grant and called `person_notification_panel`,
`set_notification_for`, `set_receives_notifications` and
`set_receives_commission_statements` through PostgREST. All four answered
`42501 MFA required` from INSIDE the function body, which is the proof that
PostgREST found each one and was allowed to execute it. A missing grant
fails differently.

**One measurement artefact worth recording, because the first pass reported a
false negative.** `person_notification_panel` is STABLE, so reading it in the
SAME statement as the write sees the pre-write snapshot. The first walk said
a Director's change had not landed when it had. Each write is its own
statement now.

### Still open on this rail

A supplier's **agent contact** is a contact record with no user row, so it
has no per-person settings to hold. Its deliveries are unchanged. B3.

A supplier's own staff, and an agency Negotiator, reach their panel only
where a screen lists them: Team for the agency estate, and nothing for a
supplier user, since `/partners/:key` is superadmin-only. Flagged rather than
answered: giving supplier staff a people screen is a new screen, not a
wiring job.

## The end-to-end walk on dev. DONE, 2026-09-30.

Step 5 of the night run: "walk it end to end on dev yourself". Every fix
from this session asked of dev as a real signed-in reader, through the RPCs
the screens call, with RLS on and never as service_role. Rolled back.

| | checked | got |
| - | --- | --- |
| 1 | a Director may change their Negotiator's event choices | true |
| 2 | a locked event carries its sentence, not a bare flag | yes |
| 3 | an admin cannot be given a position | refused |
| 4 | `cron_health()` answers | **649 ms** (was 46,715) |
| 5 | the scheduled-job log has a trim job | yes |
| 6 | a partial refund is refused | yes |
| 7 | a supplier may refer a joint tenancy, priced once | 2 applications, fees £2,000.00 |

And the client half, fetched from the dev server on 5174 rather than read
off disk, because the question is what a browser loads:

| file | |
| --- | --- |
| `PersonNotifications.tsx` | served |
| `Applications.tsx` (the origin filter) | served |
| `UserManagement.tsx` (your own row) | served |
| `PositionModal.tsx` (Office and responsibilities) | served |
| `inForce.ts`, `jointAllowed.ts`, `whereTheyWork.ts`, `format.ts` | served |
| `CustomersTable.tsx`, `CustomerReport.tsx`, `Home.tsx` | served |
| `OpsNotifications.tsx` | **gone** -- the URL falls through to index.html |

**One thing the walk caught about itself rather than the product.** The first
pass grepped the served bundle for a COMMENT string and reported the
Applications fix missing. Vite strips comments; the code was there. Checked
on the code afterwards. Worth recording because "grep the bundle for the
marker I wrote" is a check that looks conclusive and is not.

### The state of the tree at the end

```
typecheck          clean
vitest             134 files / 1444 tests / 0 failing
pgTAP (local,      68 files / 980 assertions / 0 failing
  clean apply)
npm run drift      clean -- dev matches a clean apply of the files
deno check         66 clean / 0 failing
```

---

## The handover and the defect list. DONE.

`2359795`, `82a557f`.

### HANDOVER-BALAL.md: only what Balal must do

- The counts were stale (333 / 266, "refreshed Monday"). Now 349 / 65, with
  the two commands that produce them written down so a later reader counts
  rather than trusts a number.
- "What has to be true by Monday 28 September" named a date that has passed.
- Two sections were status reports about ME rather than instructions to him:
  "the walk is half done" and "things I could not finish". Both reframed as
  his list, with the content kept.
- One bullet deleted as simply wrong: `commission-statements` IS deployed
  (dev, 2026-09-30 10:09, with the other 33), and section 6b already covers
  deploying every function at cutover.
- One added: an `opndoor_manager` sees a blank Reporting page, so somebody
  reporting it does not have it diagnosed from scratch.

### DEFECTS.md, and one entry that contradicted itself

Every claim of "fixed" was re-checked against the branch and dev rather than
re-read. **Defect 13's index line said "Fixed here, component and all 35 call
sites" while its own body said "This is not fixed ... every one of the 34
error paths still renders green."** Both in the same file. That is worse than
either being wrong alone, because a reader believes whichever they reach
first, and the likely outcome was somebody redoing a sweep already done.

Measured: 99 toast calls pass an explicit tone and **every `catch` that
raises a toast passes `'error'`**. The index was right. The body is corrected
and now carries the commands to re-check it, with the distinction that
matters: a call with no tone is not a defect, a FAILURE rendering as a
success is.

Three others verified rather than assumed:

| # | |
| - | - |
| 19 | `partner_rate` and `agent_rate` are not in `authenticated`'s SELECT grant on `partners`. |
| 4 | Redirection is on only when `EMAIL_REVIEW_ADDRESS` is set, so it fails safe in the right direction. The danger is the reverse and HANDOVER section 7 already warns of it. |
| 2 | Fixed by a later migration. The July files still contain the old project literal and must not be edited: read the final state, not the tree. |

The three left for Balal are unchanged and cannot be done from here: rotating
the committed cron secret, and the two scheduling items.

---

## Walk fixes 15 and 20: reporting per customer. BUILT; ONE DECISION LEFT.

`91369f8` (item 20), `b80f696` (item 15's tab). Both on dev.

### Why Kestrel appeared nowhere, which is the fault under the fault

The only breakdown groups by `app.partner`, and on the agency rail every
agency of ours is carried by one house partner. So it had ONE row for the
whole agency estate -- named after a company that does not exist outside our
schema -- plus one per supplier. "Per partner" was never "per customer": on
the agency rail the partner is a ROUTE. It is also why "Northgate appears
twice" on the same screen.

The customer is the ORIGIN, which is what origin.ts exists to name. Verified
against dev's real book: Northgate 14 sent, Regent 7, Southbank 3, **Kestrel
1**, and the 10 direct rows excluded because the direct rail is Opndoor's
own business and not a customer.

`Commission by partner` is KEPT: it answers a different question and is
right about it.

### One thing found and NOT fixed, because it is not in the queue

`paymentMetrics.scopeFull` has a positive allowlist naming only `referrer`,
`superadmin` and `management`. An **`opndoor_manager` is handed an empty
set**, so every live figure on their Reporting page is blank. The role was
added in `20260922090000` and that allowlist was never widened. No walk item
reports it; recorded here rather than fixed.

### What is left: NM-M

"The scope picker is deleted" is the one line of NM-F not done, because
deleting it also deletes **"view as"** from Reporting -- the same mechanism,
and more than the picker. Three options, written up as NM-M. Nothing else is
blocked.

---

## Walk fix 26: a supplier may refer a joint tenancy. DONE AND CHECKED ON DEV.

`66f4d3e`. **It reverses Q-06 item H**, which said "single tenant (no Add
another tenant)" of the supplier path. Batch 16 is newer and governs. Three
existing assertions enforced the old rule; all three are **inverted with the
reason in place, not deleted**, so a reader who finds Q-06's wording can see
which one is live.

### Most of it already worked

Measured on dev before anything was written, guard lifted in a rolled-back
transaction, real Kestrel joint referral:

| | |
| --- | --- |
| applications / tenancies | 2 / 1 |
| fees | £2,000.00 -- exactly one month of a £2,000 rent |
| share amounts | £2,000.00 -- exactly the rent |
| rates | 0.2500 / 0.1000 on both, Kestrel's own |

`resolve_fee` already prices per TENANCY on that rail (£2,000 for one tenant
and for two, measured directly) and `apportion` already splits to the penny.
One guard was the whole of it.

### Narrowed, not removed

Matt named suppliers. He did not name the DIRECT rail, and a direct signup is
one tenant applying for themselves with no staff referrer to create a joint
one. `opndoor-direct` and `referencing-partner` still refuse.

### It waited for R3 and R5, as the earlier note said it should

Both are done, so this was safe to build now and was not a week ago.

### The one that nearly went wrong, and the honest ending

The form DROPS tenants already typed when the origin "cannot carry them",
and that test read `estate` -- false for a supplier. Changing only the button
would have left the two disagreeing, so the moment the rail probe settled it
would have silently wiped the tenants an admin had just added, on the one
path this opens.

I wrote a render assertion for it, **checked it by mutation, found it did
NOT bite** -- reaching the wipe needs the probe to settle and the supplier
path's never does without a branch chosen -- and replaced it.
`mayAddAnotherTenant` is one predicate in its own file now, asked by both
places, so they cannot disagree. The render test says plainly what it does
not cover rather than looking like it does.

### Tests

New `a_supplier_may_refer_a_joint_tenancy.test.sql`, 9 assertions, all
failing first: the money, the direct rail still refusing, and the two
validations that guard the money on the new rail (shares totalling 100,
duplicate emails) -- because adding a rail is where a validation gets
skipped. New `jointAllowed.test.ts` (9). Local clean-apply cluster 68 files
/ 980 assertions / 0 failing; green on dev; drift clean. Client 131 files /
1418 tests.

---

## The hotfix is retired: it ships with the cutover. DONE AND CHECKED ON DEV.

`58de1c2`, `0a8ecaa`. Matt: *"there is no separate live hotfix. Everything in
HOTFIX-LIVE-FOR-BALAL.md ships with the cutover instead. Make sure each is on
the branch and covered by a test, then retire the hotfix document."*

Each of the five checked against dev before anything was deleted:

| item | state |
| --- | --- |
| payment column lock | `20261006720000`. Dev has no INSERT/UPDATE/DELETE/TRUNCATE grant to anon or authenticated on `applications`. |
| NULL guard | `20261006470000`. `app_role()` coalesced on dev. |
| full-refund-only rule | `20261006910000`. `apply_stripe_refund` raises 22023. |
| log cleanup | **was absent.** Now `20261006960000`. |
| Health index | **was absent, and cannot exist.** See below. |

Both files deleted; HANDOVER 0a rewritten so nobody goes looking for them.

### Two of the five are not what the instruction assumed, and it matters

**The index cannot be created by anyone.** `create index on
cron.job_run_details` is refused: *"must be owner of table
job_run_details"*. pg_cron's tables belong to `supabase_admin`; neither a
migration nor Balal running SQL as `postgres` can do it. Measured on dev.

**And retention was never the cause.** Trimming in a rolled-back transaction
and re-timing `cron_health()`:

| rows | time |
| ---: | ---: |
| 58,868 (today) | 46,715 ms |
| 41,107 (30 days, as asked) | 37,130 ms |
| 15,357 (7 days) | 25,203 ms |

Three times the 8 s cut-off even at a week.

### What it actually was

| | ms |
| --- | ---: |
| 16 job laterals (last run per job) | 237 |
| 547 http responses attributed to a job | 10,939 |
| **the same 547, computed a second time** | 10,863 |
| the activity_log and ops_alerts counts | 1 |
| `cron_health()` end to end | **46,715** |

The `attributed` set was written out byte-identically in two statements, and
each read seq-scanned 35 MB once per response. A time bound on the lateral
changes nothing (11,163 ms against 11,094 ms) because without an index the
rows are read and then discarded.

There is one index we may rely on: the primary key on `runid`. It is
monotonic, so `runid > max(runid) - 20000` is a range scan, and the time
predicate makes it exact. Read once, as a `materialized` CTE.

**46,715 ms -> 666 ms on dev, with the log still untrimmed.** The retention
job ships as housekeeping, not as the fix.

### The migration was built on the wrong definition twice

Worth recording, because it is a trap this repo has now sprung twice.
Generated first from `20261006140000` (the migration walk item 22b names) --
wrong, because `20261006280000` redefines `cron_health` to add
`hubspot_disabled`, so replaying the older body silently DELETED that key and
the Health page would have begun alerting on an integration somebody had
deliberately switched off. Caught by `health_tells_you_what_to_do` going red
on the local clean-apply cluster.

Rebuilt, and still wrong: `npm run drift` then found `20261006470000`
redefines it a third time, which `grep -l` had missed because that file
writes `CREATE OR REPLACE` in capitals.

**The rule:** generate a `create or replace` from the LAST definition, not
from the one whose comment describes the problem. `npm run drift` is the
check that catches it; a case-sensitive grep is not.

### Tests

New `the_health_screen_is_quick.test.sql`, 7 assertions, six failing first.
It asserts the SHAPE, not a timing: "under N milliseconds" passes on a fast
machine and fails on a loaded one, and this suite runs on both. Local
clean-apply cluster 67 files / 971 assertions / 0 failing; green on dev;
drift clean.

---

## Walk fixes 31, 32, 33 and 34: the invite email. DONE AND CHECKED ON DEV.

`603b0c1`. Deployed to dev: `invite-user`, `payment-page`. `deno check`: 66
clean, 0 failing.

### 31 is not a template bug, and it is wider than this email

`rich()` in emailLayout matched an href with `[^&quot;\s<>]+`. That looks
like "anything that is not the escaped quote" and is not: it is a CHARACTER
CLASS, so it excluded the individual characters `&` `q` `u` `o` `t` `;`
along with whitespace and angle brackets. **Nearly every real URL contains
one of those** -- both store links contain o, u and t -- so the pattern
never matched and the escaped markup was printed to the reader as words.
That is both halves of the report: the raw code, and the address twice,
because the URL was also the link text.

Every anchor in every `p`, `small` or `list` block in the product was
affected, not only this email.

`renderText` prints "label: address" for an anchor now instead of dropping
it, which is what lets the store lines be one clean link each without the
plain-text reader losing the URL -- the only reason the URL was the link
text in the first place.

### 33's leak is in the callers, and there were two

`invite-user` read `partners.name` and passed it through. On the agency rail
that is the house partner "Opndoor Agents". Which party to name is one
decision now, in `_shared/namedParty.ts`.

And Matt's last sentence -- "Check every other email for the house account
name" -- found the second, and it is not an email. **The tenant's payment
page** read `partnerRow?.name ?? "your letting agent"`, so on an agency-rail
referral that was not agency-arranged, the screen where a tenant hands over
a card named a company they have never dealt with. PayLanding's
agency-arranged branch already names the agency, which is why it survived:
it is the other branch.

### 34: APP_URL was already right. Site URL was not.

`APP_URL` on dev is `http://localhost:5174` and the deployed invite-user
builds on it, so the link is right. Measuring it found the other half:
GoTrue's **Site URL was `http://localhost:3000`**, a port nothing runs on,
and Site URL is the fallback whenever a link is generated with no
`redirect_to` or with one the allow-list refuses. Set to
`http://localhost:5174` on dev and proved: a link generated with no
`redirect_to` now lands on the portal.

HANDOVER 7a gains that half, with two checks, plus the trap that cost time
here: on the admin `generate_link` endpoint `redirect_to` must be a QUERY
parameter. In the body as `options.redirect_to` it is accepted, ignored and
silently replaced with the Site URL -- which reads as a broken allow-list
when nothing is broken.

### Tests

New `inviteEmailReadsAsEnglish.test.ts`, 17 assertions, five failing first,
in `src/` because Deno is not installed here and a test that cannot be run
is not a guard. Two assertions in `authenticatorCopy` were rewritten rather
than deleted: one quoted the duplicated sentence word for word, and one
required the URL to BE the link text -- true when renderText dropped
anchors, and the cause of the address appearing twice. The requirement is
now the opposite and the file says so.

130 files / 1408 tests; one file and 17 assertions added, none removed.

---

## Walk fix 25: Home says what its numbers count. DONE AND CHECKED ON DEV.

`4d33d9f`. The four queue tiles say "waiting now".

**The Direct stages needed more than one label**, which is the part worth
knowing. Confirmed from the code as the item asks: `countByStatus` is called
with no periodRange, so it is ALL TIME, and it counts CURRENT STATUS rather
than events in a window. So three of the four are a snapshot and the fourth
is a lifetime total, and one period label over all four would have been wrong
about three of them or about the fourth.

The period choice Matt asked to be offered is **NM-L**, with what the three
honest options actually are.

Test: 6 assertions, five failing first. It hydrates a direct book, because
the mock is 16 agency and 5 supplier with no direct rows and the card only
draws when the rail has some -- without it three assertions would have passed
over an absent card.

### Walk fixes 22a and 23 stay parked

Both say "After shipping." in Matt's own text. 22b was the read-only check
and is done, above.

---

## Walk fixes 17, 18, 19 and 21: Reporting. DONE AND CHECKED ON DEV.

`d9accfd`, `6f78039`.

### 18. Measured on dev, and the obvious fix is a trap

`keyOf` already dropped an application nobody referred, and said so in its
own comment. But dev's ten direct applications have `referrer_id` NULL and
`referrer_name` = **'Direct signup'**, and hydrate reads
`referrer_name ?? joined.full_name ?? '(unknown)'`. The guard was asked about
a LABEL when the question is about a PERSON, so it never fired.

**And `referrerRole` is not the answer either.** It comes from the embedded
users row, and RLS can withhold that from a reader who can still see the
application: dev has **17** agency applications with a real `referrer_id`
whose `referrer_name` is NULL. Keying on the role would have dropped real
referrals by real people while fixing the direct ones. `FullApp` carries
`referrerId` now, and only an explicit null means "nobody referred this".

**B1 and B2 are the same cause on two other surfaces and are NOT closed
here.** They are separate recorded findings; this closes the referrer list,
which is the one Matt walked.

### 19. Fixed where the possessive is formed

There was no helper: **eight** call sites each wrote `${name}’s` inline, so
it was eight bugs. One now. The rule is exactly the one Matt named and no
wider -- names ending in x or z, or in a silent s, are argued over by style
guides and nobody has asked, so the omission is deliberate and the helper
says so.

### 21. The reader decides, not the person

The same referrer's line differs by who has the page open. Opndoor staff get
agency and branch; for everybody else it is the SHAPE of their book and not
their permissions, so a Director and a Negotiator at the same agency read the
same line. Counted off the scoped set BEFORE the period filter, because "an
agency with more than one branch" is a fact about the agency and not about
what it referred this month. Somebody who moved office is shown BOTH offices:
printing one would state as a fact something half wrong. League and the
by-referrer trend take the same rule, which is Matt's last sentence.

### 17. The chart was offering a series that cannot apply to the reader

`£0 every month` is not a blank series. The trend's "commission" is the
supplier cut, and `liveMonths` zeroes that on a house route because a house
route's cut is Opndoor's own margin owed to nobody -- correct, and asserted
in `our_margin_is_not_theirs.test.sql`. So an admin on the house rail could
only ever see twelve bars of zero beside a tile saying £3,232. **The money
model was right and fixing the numbers would have been fixing the wrong
thing.** The option SET is picked from who is reading.

**"Whichever option is chosen, the trend must match the tiles" needed saying
what it can mean.** The trend is a trailing twelve months by construction and
the tiles follow the period picker, so they are not the same window and no
assertion can make them one. What must hold is that each option measures the
same QUANTITY as its tile: over one window, the series sums to the aggregate.
Four assertions, one per measure.

And one more that stops the whole thing passing on `0 === 0`: on the house
rail the old series is zero where the new one is not. With a real supplier in
the book the old series is NOT zero, which is why that option was not dead
and still belongs to customers.

### Tests

Added: `possessive.test.ts` (8), `whereTheyWork.test.ts` (11),
`directIsNobodysAgency.test.ts` (4), `opndoorPaysCommission.test.tsx` (17).
One assertion added to `viewAsIsTheParty` at the exact place Matt reported
the possessive. Every fix verified by mutation: reverting each rule fails
exactly its own assertions and nothing else. 128 files / 1384 tests; four
files and 40 assertions added, none removed or renamed.

---

## Walk fixes 27, 28, 29 and 30: New application. DONE AND CHECKED ON DEV.

`95f9bb6`. Four on one screen, built as one piece.

### 27. The numbers were literals, not a typo

Referred by 1, Tenant `isAdminForm ? 2 : 1`, Property 2, Tenancy 3, the
office section 4. So the admin form read **1, 2, 2, 3, 4**. Two of the five
knew about `isAdminForm` and three did not. Counted in render order now;
renumbering the literals would leave the next conditional section to break it
again.

### 28. Measured on dev, twice, because the cause is not what it looks like

`my_org_shape` answers "what should I be asked about MY org", and an Opndoor
admin has none:

| call | returns |
| --- | --- |
| `my_org_shape(null)` | **no row at all** |
| `my_org_shape(<kestrel>)` | **Kestrel's own shape**: `refers_own_stock` true, one agency and it is yours, "Kestrel Lettings" |

So the admin was answered as somebody else in both directions: the
placeholder's words while the call was out, and the supplier user's words
once it landed. Matt's sentence exactly.

**And the heading was only half of it.** While the shape is unresolved the
PICKER returns that placeholder *and nothing else*, so there was no agency or
branch control on the page at all.

An admin's question is fixed and needs no round trip. It is `FULL_PICKER`,
taken directly, so the section is never unresolved and never collapses one of
somebody else's agencies away. The agencies offered are still the supplier's
own, because they come from the scope Referred by set. The call, its four
retries and the collapse it drives are skipped.

### 29. The disappearance was the one-office collapse

It hides the whole section once the org resolves to a single office. Right
for somebody who works at one office and has nothing to choose; wrong for an
admin choosing somebody else's agency and branch and needing to correct it.
Never applied to an admin now.

### 30. Matt's own wording, used as given

"Rail" and "route" are internal vocabulary: a rail is which of the three
kinds of referral this is, a route is the partner record carrying it.

### Two assertions that are not render assertions, and why

The hang **cannot be reproduced in mock mode**: `loadOrgShape` returns a
resolved shape there without asking anything. So two of the seventeen assert
the rule where it lives instead -- the copy against the shape that never
resolves, and the ABSENCE of the server call, which is the substance of "does
not wait". Both were checked against the unfixed picker and fail there.

17 assertions, five failing first. 124 files / 1343 tests.

---

## Walk fixes 8 and 16: the book in force. DONE AND CHECKED ON DEV.

`7a4f578`. One rule for both (`src/data/inForce.ts`), because they are the
same three clauses said twice and an underwriter's document disagreeing with
our own headline figure is worse than either being wrong alone.

### Item 16's "show how the current figure is calculated", answered with dev's own numbers

The old line was `if (inRange(app.deedAt, start, end)) a.guaranteed +=
guaranteedAnnual(app)`: twelve months of rent for every deed **issued**
inside the period. Dev's five executed deeds were all issued in September, so
every period containing September totals £72,000 whatever is on cover.

| period | old (deed issued) | new (executed, in force) |
| --- | ---: | ---: |
| all time | £72,000 | £12,000 |
| September 2026 | £72,000 | £12,000 |
| October 2026 | £0 | £48,000 |
| December 2026 | £0 | £72,000 |

**£72,000 is the right number for December**, when all five are on cover.
Shown in September, when one guarantee had started, it was six times the
truth. And the old rule reports **zero** for October and December, when
£48,000 and £72,000 are under guarantee. The two errors move the total in
opposite directions, which is exactly how a wrong figure looks plausible.

### The four clauses were in three different states

| clause | before |
| --- | --- |
| counting a joint tenancy once | **already true.** `guaranteedAnnual` returns the SHARE and the shares sum to the rent, so no dedupe is needed and none was added. Asserted so the fix cannot undo it. |
| executed | **not true, in either place.** `status === 'deed'` and `deedAt` present are the deed ISSUED. Dev has two applications whose deed is out for the tenant's signature, and the bordereau was reporting them to the insurer as cover. |
| in force in the period | **not true, in either place**, and this is the fault. Both asked when the cover was WRITTEN. |
| refunded / withdrawn | the bordereau excluded refunds. The tile excluded neither. |

### Half a tenancy is half the money

Where one tenant of a pair has signed and the other has not -- dev's
GR-20762 and GR-20763 -- the guaranteed value is the signed share. Not the
whole tenancy, which nobody has promised, and not nothing, which would
ignore a signed deed. Asserted both ways.

### One thing worth knowing about what this changes

The bordereau's MEANING moved. It was new business in the month; it is now
the book on cover during the month, which is what Matt's sentence says. A
guarantee written in September and running to next September now appears on
every month's bordereau until it expires, where before it appeared on
September's alone.

### Tests

Added: `inForce.test.ts` (18), `bordereauIsTheBookInForce.test.ts` (12, five
failing first), `guaranteedValueIsInForce.test.ts` (11, five failing first).

Rewritten in place rather than re-baselined, each with the reason in the
file: `settlement-bordereau`'s two bordereau assertions, which named a rule
that no longer exists ("commencing in the month"); `liveAnalytics`'s
guaranteed assertion, whose fixture had no tenancy dates at all and was
asserting £12,000 from a row that never said when its cover ran;
`bordereauBasis`'s fixture gains `deedState` with no assertion moved.

123 files / 1326 tests; three files and 41 assertions added, none removed.

---

## Walk fixes 1, 5 and 6. DONE AND CHECKED ON DEV.

`00a3644`, `7ee274b`.

### Item 1: your own row

The three dots opened an empty menu because every item is gated on `mayAct`,
`canEditRole` or `canDeactivate`, and all three are false on your own row --
correctly, since they govern things done TO somebody.

Matt offered either; the two actions are shown, because both exist. **They do
not share a rule**, which is the whole of the care here. Walked on dev first,
in a rolled-back transaction because an MFA reset deletes factors and
sessions:

| | Opndoor admin | supplier management |
| --- | --- | --- |
| rename yourself | allowed | allowed |
| reset your own two-factor | allowed | **refused** |
| deactivate yourself | refused | refused |

`admin_update_user_name` skips the ladder when the target is the caller, and
`assert_may_act_on_user` names that as the documented exception in its own
comment. `admin_reset_user_mfa` always asks the ladder, whose opndoor-staff
early return comes BEFORE its self check, and its own authorisation arm is
`is_admin()`, which is superadmin alone. Its confirmation is its own copy,
not the existing one reworded: this signs YOU out.

### Item 5: two halves, and only one was broken

**Measured on dev before changing anything.** A branch position written
straight onto an admin, then their reads counted:

| | before | after |
| --- | --- | --- |
| applications | 35 | 35 |
| agencies | 9 | 9 |
| branches | 11 | 11 |
| users | 25 | 25 |

So "a position can never narrow what an Opndoor admin sees, even if one was
set" already held: every read policy ORs its admin arm ahead of the scope
test. Now asserted, rather than left as a consequence of how a dozen policies
happen to be written.

**The other half did not hold.** `set_user_scope` and `set_home_branch`
authorise on `is_admin()` and then ask the ladder, and
`assert_may_act_on_user` returns early for opndoor staff, before its own self
check. So an admin could position another admin, an opndoor manager, or
themselves -- which is the case the walk found, because the dialog opened on
your own row. Both refuse an Opndoor-staff target now (`20261006940000`), and
"Set what they see" is not drawn on their row.

**One ordering decision worth recording.** The new guard sits AFTER the
authorisation test, not before it. Before it was the first instinct and wrong
twice: an unauthorised caller should learn "not permitted" and nothing about
the target, and `a_null_guard_refuses` measures, on `set_home_branch`, that a
caller with no `users` row is refused by the ROLE check rather than a later
one -- and it has to use an opndoor_manager as its target, because
`users_partner_by_role` allows a NULL partner_id for nobody else. A guard in
front would have answered with the new message, and that property would have
gone untested while its test still passed.

### Item 6: the dialog is two labelled parts

"Office and responsibilities". **Works at** first, because for most people it
is the only one that applies, then **Oversees**. Each says what it decides,
which is what makes the split useful rather than cosmetic.

### Tests

pgTAP: new `an_opndoor_admin_has_no_office.test.sql`, 7 assertions, four
failing first; the other three are the measurement above, which passed before
the migration and is the point of it. Local clean-apply cluster: 66 files,
964 assertions, 0 failing. Green on dev. `npm run drift` clean.

Client: new `yourOwnRow.render.test.tsx` (6, two failing first) and
`officeAndResponsibilities.render.test.tsx` (7, five failing first).
`guardsAreNullSafe`'s deny-if count 64 -> 66 with the audit note that file
requires. 120 files / 1285 tests; two files and thirteen assertions added,
none removed or renamed.

---

## Walk fix 7: the Origin picker narrows the list. DONE AND CHECKED ON DEV.

`2fffe58`.

**What was wrong, and it was true of the two choices at the top.** The picker
offers Everything, Suppliers and Agencies as quick choices. The second and
third are `rail:supplier` and `rail:agency` -- rails, not parties, so no row
is one and `originOptions` never produces them; the picker adds them from its
own QUICK list. The page narrowed by translating a selection through
`originToFilter`, which has no rail arm and whose fallthrough is `return {}`,
meaning no filter. So picking either left the whole book on screen.

**The fix is one predicate, not a new one.** `originMatches` already had both
rail arms and is what Reporting narrows by. `AppFilterOpts` now takes
`origin` and applies it in `getApplications` AND in `countByStatus` -- two
separate filters, and teaching only the first would have moved the rows while
leaving "Showing 5 of 21" behind, which is the same complaint one line
further down the page.

`originToFilter` keeps its other job: narrowing `scopeOpts` to a partner so
the Agency, Branch and Referrer chips list that party's own options. A rail
names no single partner, and leaving those chips open across a rail is right.

**Why nothing caught it.** The existing coverage loops
`originOptions(book)` -- precisely the set of values that DO work.

**Checked against dev's own book, not the fixture.** No browser driver is
installed here, so the check is the real predicate run over dev's real 35
applications (their partner slug and agency name, with dev's own partner
records hydrated so the rail is read the way the page reads it):

| selection | rows on dev |
| --- | --- |
| Everything | 35 |
| Agencies | 24 |
| Suppliers | 1 (Kestrel) |
| Direct | 10 |
| `partner:kestrel-lettings` | 1 |

Disjoint, summing to 35. Before the fix, Agencies and Suppliers each returned
all 35. Dev's book is a better test than the mock, which has no Direct rows
at all. The merged branch is what 5174 serves.

**Tests.** `src/data/origin.test.ts` +6 (37 from 31), five failing first. New
`src/pages/Applications/originPicker.render.test.tsx`, 5 assertions, four
failing first -- driven through the CONTROL rather than the service, because
the data layer was never wrong and a service-level test would have passed on
the day of the defect.

**Matt's one-line alternative** is NM-K under Needs Matt, as item 7 asks.

---

### NM-2b, flagged now the work is finished rather than left to notice

Four of the alert types Q-04 names do not exist. The per-person panel
therefore lists fewer alerts than the old page implied. That is the honest
state, not a loss.

---

## NOTHING IS DONE UNTIL IT IS DEPLOYED TO DEV AND CHECKED THERE

**Matt's instruction, 2026-09-30, verbatim:**

> Walk fixes 13 and 14 are not working on dev. Inviting a Negotiator to Regent's Lettings as Opndoor admin, the form now says "They are invited to Regent's Park", but Send invite still fails with the old message: "Everybody on our estate holds a position... jane@jane.com has none". So the page is new and whatever runs on the server is old.
>
> Find out why: whether the invite function was never deployed to dev, a migration wasn't applied, or the admin path doesn't pass the office. You may change dev to fix this. Prove it by actually inviting through the same path the browser uses on dev, for each level, from Opndoor admin and from a Regent director, not only by the test suite.
>
> Then check every item you reported done this morning (the seven fixes and walk fixes 2, 3, 4, 11, 13, 14) against what is actually running on dev, including server functions, and list which are live and which aren't. From now on nothing is marked done until it is deployed to dev and checked there. Report, then carry on with the queue.

### The cause, and it is worse than the one item he hit

**No Edge Function had been deployed to dev since 28 September at 10:21.**
Not by me and not by anyone. I had no way to deploy one: the Supabase CLI was
not installed on this machine, and I never noticed that this made "done" mean
something different for a function than for a migration.

Matt's three candidate causes were: the function was never deployed, a
migration was not applied, or the admin path does not pass the office. It was
the first. Proven by fetching the deployed bundle from the Management API:
it contained the old message and did NOT contain `resolveInvitePosition`,
which was introduced in `f570ca2`. The deployed code predated even that.

**It was 32 function files, not one.** Everything any Edge Function did on
dev was up to two days old. So Matt's walk was not testing this branch: the
database was current and the server code was not.

### What was done about it

| | |
| --- | --- |
| Deno installed | 2.9.7, and `deno check` run over the functions for the first time ever. It found **two real defects** immediately -- see below. |
| Supabase CLI installed | 2.118.0, standalone binary, no Homebrew or Docker needed. |
| All 34 functions deployed | 30 in the bulk run, 4 retried individually after 500s from the deploy API. Verified: 34 of 34 now stamped today. |
| `APP_URL` corrected | walk fix 34: it was `http://localhost:5173`, proven by matching the Management API's SHA-256 digest against candidate strings. Now `:5174`, confirmed the same way. |
| `npm run check:functions` added | so the type check is one command and cannot be forgotten again. |

### The two defects `deno check` found on its first run

Both had been invisible because the only tool that could see them was not
installed.

1. **`expiry-reminders` crashed the whole nightly job.** It called
   `.catch()` directly on a Supabase query builder. A builder is a THENABLE:
   it implements `then` and not `catch`, so that line threw a TypeError
   before the RPC was awaited. It runs when a reminder is PARKED -- a
   guarantee about to expire with nobody to send to -- so one guarantee with
   a missing contact silenced the reminders for every other guarantee that
   night. Fixed, with a lint so it cannot come back.
2. **`create-referral` could drop a failed-email flag.** `emailError` is
   declared `string | null` and was being handed `string | undefined`. Across
   JSON an `undefined` property DISAPPEARS rather than arriving as null, so a
   caller testing for the key would read a failed send as a successful one.

### Proof through the real path, not the test suite

Matt asked for this specifically, and it is a fair demand: the suite passed
throughout while the product was broken.

Two probe accounts were created on dev, an Opndoor admin and a Regent
director, and each invited all three levels by **signing in with a password,
enrolling and verifying a real TOTP second factor, and calling the
`invite-user` function over HTTPS with that session** -- exactly what the
browser does. Six of six succeeded, and the invitees were then checked in the
database: Negotiator at the branch, Manager at the agency without commission,
Director at the agency with it.

**One thing that fell out of it:** the hand-made accounts could not sign in at
all at first -- `Database error querying schema`. Four token columns on
`auth.users` were NULL where GoTrue expects empty strings. **The Kestrel login
handed to Matt earlier had the same fault and would not have worked.** Fixed
for all three.

### The audit Matt asked for

Every database fix was already live, because migrations had been applied all
along. The gap was entirely the server functions.

| item | on dev? |
| --- | --- |
| R1 (three parts: predicate, trigger, deed fallback) | **live** |
| R2 refund state | **live** |
| R3 preview reads the agreement | **live** |
| R4 rates redacted (helper + callers) | **live** |
| R5 amend covers the whole tenancy | **live** |
| R6 rates and bands not writable from a browser | **live** |
| R7 API prices like the portal, and refuses a non-tenant payer | **live** |
| Walk 14 server messages | **live** |
| Walk 2, 3, 4, 11 (client only) | **live** -- served by Vite from this branch |
| Walk 13 form | **live** -- client |
| Walk 13/14 invite FUNCTION | **was NOT live. Now deployed and proven.** |

61 pgTAP files / 0 failing against dev. 34 of 34 functions current.

### The rule, from now on

A change is not done when it is committed, and not done when its test passes.
It is done when the thing that runs it has been updated and the behaviour has
been observed there. For a migration that means applied to dev; for an Edge
Function it means **deployed**; for either it means checked afterwards
against dev rather than against a local database.

---

### Status, updated as the night run proceeds

**This table was stale and is rewritten. It said NOT STARTED about work
finished hours earlier, which is the same fault found in DEFECTS.md: a status
line contradicting the document under it. The order below it is kept as the
record of the sequence, with every row now marked.**

| what | state |
| --- | --- |
| R1-R7, all seven | **DONE**, each with a test that failed first, all applied to dev |
| Walk fixes 2, 3, 4, 11 (Opndoor team page) | **DONE** `806a300` |
| Walk fixes 13, 14 (inviting, plain-English errors) | **DONE** `bdf260c` |
| Walk fixes 9, 10, 12 (notifications per person) | **DONE** `d1bfcb6` |
| Walk fix 7 (Applications Origin filter) | **DONE** `2fffe58` |
| Walk fix 1 (your own row) | **DONE** `00a3644` |
| Walk fixes 5, 6 (Office and responsibilities) | **DONE** `7ee274b` |
| Walk fixes 8, 16 (the book in force) | **DONE** `7a4f578` |
| Walk fixes 27, 28, 29, 30 (New application) | **DONE** `95f9bb6` |
| Walk fixes 17, 18, 19, 21 (Reporting) | **DONE** `d9accfd`, `6f78039` |
| Walk fix 25 (Home says what it counts) | **DONE** `4d33d9f` |
| Walk fixes 31, 32, 33, 34 (the invite email) | **DONE** `603b0c1` |
| Walk fix 26 (supplier joint tenancies) | **DONE** `66f4d3e` |
| Walk fixes 15, 20 (reporting per customer) | **DONE** `91369f8`, `b80f696` |
| Walk fixes 22a, 23 | **PARKED** -- Matt's own text says "After shipping" |
| Walk fix 24 (HubSpot) | **ANSWERED 2026-09-30**: no automatic HubSpot write. See the instruction at the top. |
| The hotfix, retired into the cutover | **DONE** `58de1c2`, `0a8ecaa` |
| HANDOVER-BALAL.md trimmed | **DONE** `2359795` |
| DEFECTS.md | **DONE** `82a557f` -- and one entry contradicted itself |
| The end-to-end walk | **DONE** `afd4625` |
| Round 6's M4, M9, M10 and the eight lows | **OPEN.** Step 4 of the night run covers "still open in QUEUE.md" and these are it. |

### RESUME HERE. The order the rest should be done in.

Matt's instruction is "in order", and the order below is his, with the
dependencies found while working recorded against each so nothing is built
before the thing it needs.

| next | item | note found while working |
| --- | --- | --- |
| 1 | **Walk fix 1** -- three dots on your own row open an empty menu | Small. Same screen as 2/3/4/11, which are done. |
| 2 | **Walk fixes 5 + 6** -- the "What X can see" dialog | MUST be built together: 5 removes it for Opndoor staff, 6 restructures it for everyone else, and they are one component. 5's second half ("a position can never narrow what an Opndoor admin sees, even if one was set") is a SERVER question and wants its own test. |
| 3 | **Walk fixes 9 + 10 + 12** -- notifications per person | The largest by some distance. Matt: "one shared design so Opndoor team and agency people work the same way; suppliers too." Three screens collapse into one component. The server model already exists (Q-03) and already carries the locked cells; the one thing to CHECK rather than assume is whether monthly statements are the same model or a second one. |
| 4 | **Walk fix 7** -- Applications Origin picker does nothing | **May be throwaway.** NM-F proposes deleting the picker entirely. Answering NM-F first could save this work; Matt has not answered. |
| 5 | **Walk fix 8** -- bordereau includes every application | **AFTER R2, which is now done.** Its test must include a partially-refunded executed guarantee and assert it is PRESENT. "In force during the period" is OVERLAP, not containment. |
| 6 | **Walk fix 16** -- Total guaranteed rent value | Shares both clauses with 8; build together, one helper, one set of tests. The "show how it is calculated" half is already done and written up above. |
| 7 | **Walk fixes 27 + 28 + 29 + 30** -- the New application form | Four items on one screen; 28 is a HANG, not just wrong wording. |
| 8 | **Walk fixes 17, 18, 19, 21** -- Reporting labels and lists | 18 shares a root with B1 and B2; 21 renders what 6 edits, so 6 first. |
| 9 | **Walk fixes 22a, 23, 24, 25** -- Reconciliation and Home | 22b is DONE. 24 is blocked on the HubSpot record-id decision in Q-07. 25's Direct-signups half is blocked on NM-G. |
| 10 | **Walk fixes 15 + 20** -- Reporting per customer | Both blocked on NM-F. |
| 11 | **Walk fix 26** -- suppliers may refer joint tenancies | AFTER R3 and R5 (both now done). Reverses Q-06 item H, and `referredBy.render.test.tsx` asserts the OLD rule -- invert it with a comment, do not delete it. |
| 12 | **DEFECTS.md** | 19 defects. Several are actions on LIVE infrastructure (rotate the committed cron secret, the two scheduling items, disaster recovery) and Matt's own instruction says do not touch production: those get marked, not attempted. |
| 13 | **The end-to-end walk** | Needs NM-H answered for the supplier half, and cannot cover payment, signature or email at all from a terminal -- Deno is not installed. |

### Superseded status note (kept for the sequence)

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
| R1 | Cross-company contact write, and the deed follows it | `a_contact_belongs_to_a_company_that_holds_the_branch.test.sql` -- failed first on 3 of 10, 6 regression guards green throughout | **no** | **DONE** `7cf3f21` |
| R2 | Partial refund recorded as a total refund | `a_partial_refund_is_not_a_total_refund.test.sql` (6/11 failed first) + `aPartialRefundKeepsTheGuarantee.test.ts` (1/6 failed first) | **YES, and worse** | **DONE** `581d21c` |
| R3 | 50% cap + preview ignores agreements | `the_preview_shows_what_is_actually_paid.test.sql` (1/6 failed first) | no, feature absent | **DONE** `017f4f3`. **Half did not reproduce**: the cap IS enforced and DOES see joint bands (measured, a 0.55 joint band refused by name). Only the preview was wrong: it showed 0.10 where the agreement pays 0.30. |
| R4 | Definer RPCs return the commission rates | `the_rates_are_not_in_the_reply.test.sql` (3/9 failed first) | **partly, by another route** | **DONE** `90b7f4d`. **Six, not four.** Measured: a Negotiator got partner_rate 0.30 and agent_rate 0.10 back from `create_referral`. |
| R5 | Tenancy-start correction fixes only one of a joint pair | `a_tenancy_has_one_start_date.test.sql` (4/8 failed first) | no, feature absent | **DONE** `f681a5a` |
| R6 | Commission rates writable from the browser, no audit row | `the_money_goes_through_the_front_door.test.sql` (5/8 failed first) | **YES, and worse** | **DONE** `9380426`. Found worse than reported: a **90% band went straight in**, because the 50% cap is called by the save RPC and is not a trigger. |
| R7 | `create_referral_api` resolves no fee and no rates | `the_api_prices_like_the_portal.test.sql` (7/9 failed first) | no, feature absent | **DONE** `feeeebc`. Refusal built as Matt specified; no payment path. |

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
| B1 | Direct-rail rows are counted into agency and branch counters, and a group page's "What they earned" lists every payee on the whole rail. Rule 5 and rule 3. | `src/lib/hydrate.ts:281-284,312-315,327-329`; `src/pages/Agencies/AgencyHome.tsx:1251-1256`; `src/components/CommissionStatement.tsx:153` | **done** `9427d43`. The client half of M9: `hydrate.ts` excludes the direct rail from both org indexes. |
| B2 | Direct applications become an invented agency payee in the agent settlement, named after the matched agency. | `src/data/commissionSplit.ts:95-99`; `src/data/liveAnalytics.ts:790,832-837` | **done** `9427d43`. `linesFor` returns no line for a direct-rail application, excluded for the whole function as the server does it. |
| B3 | `set_receives_notifications` can never be used on a supplier colleague: its scope test requires the TARGET to hold a position, and positions are mandatory only on the house partner. | `user_within_caller_scope` | A lock, not a hole, and only on the supplier rail. Becomes live work when Q-03's matrix ships to suppliers. |
| B4 | Unescaped ILIKE in the partner-API referrer lookup gives a cross-partner existence oracle for staff email addresses. | `supabase/functions/_shared/partnerApplications.ts:76,87` | **done** `20261006710000` + both call sites. Matched by equality on a lowercased key, and `users.email` is normalised on write so the equality is provably exact rather than incidentally so. |
| B5 | `.neq("partner_id", …)` never matches NULL, so the cross-partner referrer guard is blind to every superadmin and opndoor_manager. | `_shared/partnerApplications.ts:86` | **done**, with B4. Asked as "known to somebody who is not us", which includes them. The `maybeSingle()` beside it also ERRORED on two rows and the error was discarded, so two matches read as "not known" -- the opposite of the intended answer. |
| B6 | `send-password-reset` falls back to the caller-supplied origin when `APP_URL` is unset, contradicting its own comment. | `supabase/functions/send-password-reset/index.ts:52` | **done** `_shared/safeOrigin.ts`. Wider than reported: `tenant-portal` took the caller's origin OUTRIGHT, with no APP_URL anywhere, for the Stripe success and cancel URLs. All five senders now share one function. |
| B7 | `commission_statement_refs` has no `may_see_commission()` restrictive policy, unlike `pricing_agreements` and its three children. | policy set on that table | **done** `20261006770000`. Measured first: a Manager without the capability read their own agency's references, count 1 where it should be 0. Leaks the reference and the payee key, no amounts. Both directions asserted, because a capability test that locked the Director out too would be the worse bug. |
| B19 | **Measured, not a hole today, recorded so nobody re-derives it.** 54 tables grant a write privilege to `authenticated` purely from Supabase's default privileges, and on 34 of them there is no write POLICY at all, so the grant is unreachable. | every public table | RLS is enabled on **all 54** -- I checked, expecting to find the production fault repeated here, and it is not. So there is no live exposure: the grant is latent, and becomes real only if somebody later adds a permissive write policy to one of those 34 without noticing the grant is already open. Not swept now because revoking across 34 tables is the exact shape of the change CLAUDE.md warns about, and it would buy nothing today. The durable fix is a pattern check that fails when a table gains a write policy while holding a default grant. |
| B8 | `partner_agency_relationships` has no `require_aal2` restrictive policy. | policy set on that table | **done, and it was nine tables not one** -- `20261006780000`. Three of the nine are commercial, and on those it was not a read-at-aal1 nuisance but a WRITE: measured on dev, a superadmin with no second factor rewrote a commission rate. The mechanism generalises and is the reason B8 looked smaller than it was: permissive policies are OR-ed, so `pricing_agreements_select`'s `is_aal2() and ...` was undone by a sibling `for all` policy using only `is_admin()`. Only a RESTRICTIVE policy is AND-ed. All 27 tables now carry one. |
| B9 | `detach_user_from_agency` requires no group/agency-kind position, unlike `attach_user_to_agency`. | that function | **done** `320eb4c`. The clause its twin always had, added inside the existing coalesce so the guard stays one null-safe compound. |
| B10 | `set_branch_deed_recipient` uses `users.partner_id = branches.partner_id` as "a user in this organisation", which on the agency rail is every agency. | `20261006310000:1041` | **done** `320eb4c`. Now `app_may_reach_user`, and the two checks reordered so authorisation runs before the recipient lookup. |
| B11 | Cross-company working copies (`grp_org_v3`, `grp_partners_v2`) persist to localStorage and are not cleared at sign-out. | `src/data/orgService.ts:19`; `src/data/partnersService.ts:21`; `src/session/SessionContext.tsx:280-301` | **done** `ff47377`. Storage AND memory, in one synchronous call: a dynamic import raced the incoming user's hydrate. |
| B13 | `amend_tenancy_start` is granted to `authenticated` and commits the new date WITHOUT the deed lifecycle, so the edge function's confirm/archive/void/reissue is advisory. No `tenancy_amended` activity row either. | that RPC; `amend-tenancy-start/index.ts:69,100-110` | The direct-PATCH half died with round 7's A. The RPC half needs the lifecycle moved server-side, which is a build. |
| B14 | On a group with more than one agency, `AgencyHome` passes `orgId=null` to the statement panel, so an admin reading group X's "What they earned" sees other agencies' totals under X's heading. | `AgencyHome.tsx:1251-1256` | Opndoor-facing, and the same root as B1. Fix them together. |
| B15 | `SEES_COMMISSION` is a module global defaulting to TRUE, set only by `resolve()` and reset by neither `signOut()` nor `refresh()`. | `src/data/types.ts:39,59,64` | A Director demoted mid-session keeps a client that believes it may draw commission. The SERVER refuses either way, so this is a stale screen and not a leak. |
| B16 | `VITE_ADDRESS_LOOKUP_KEY` is inlined into the bundle and sent as a query-string `api_key` from the public /apply page. | `src/data/addressService.ts` | Currently commented out, so not live. A public billable credential the moment it is set. |
| B17 | `create-referral`'s `verify_jwt = false` in `supabase/config.toml:137-138` contradicts its own header comment saying true. | that config | Settle which is intended. The function does its own auth, so this is a discrepancy to resolve rather than a hole found. |
| B18 | No executed-deed immutability at table level independent of the grant: `deed_state`, `pandadoc_document_id` and the deed timestamps can be co-edited to null while `status` is downgraded. | `applications` | Closed in practice by round 7's A. Worth a constraint if any write path to `applications` ever returns. |
| B20 | A fee basis is stored as `4.35` with the unit `months`. 4.35 is the number of WEEKS in a month, so the pair reads as 4.35 months -- four months' rent -- where the fee is one. | `resolve_fee`, standard agreements | Found by the walk. Not live: the fee itself is right, and the only renderer, `feeBasisLabel`, checks `is_standard` first and says "one month's rent". It is a quantity and a unit that disagree and only agree because nothing reads them together. Anything NEW that reads the pair -- a statement line, an export column, an API field -- states it wrongly. Not fixed here because it means touching the number every fee derives from. |
| B12 | `definerAllowlistCoverage` counts a function as covered if its NAME appears in any pgTAP file; it does not require the test to assert a refusal. | `src/data/definerAllowlistCoverage.test.ts` | **done** `1972efc`. The suite text is scrubbed of comments and grant assertions before the coverage regex runs; two names were riding on those. |
| B22 | **`contacts_maintain_primary` is SECURITY INVOKER and counts a branch's existing contacts THROUGH RLS.** A caller who cannot see the current primary counts zero, has their own row force-promoted to primary, and collides with `agent_contacts_primary_per_branch`. | that trigger function | Found by R1's test, which needed the legitimate sharing case to work and could not get it. **It blocks a feature rather than opening a hole**, which is why it is here and not fixed with R1: a supplier that legitimately introduced an agency cannot place its own route contact on a branch that already has one. Worth noting the near miss -- had the unique index not been there, the row would have SILENTLY stolen primary status from the other company's contact instead of erroring, and the deed would have followed it. The index turned a breach into a bug. Fix is to make the function security definer (or count with an explicit definer helper), with a test for the shared-agency case. |
| B21 | **`cron.job_run_details` grows forever and nothing prunes it, and `cron_health()` scans it with an unindexed range join.** 57,240 rows / 34 MB on dev, growing ~2,160 a day; `cron_health()` measured at a **20.3 s mean, 24.1 s max**, against an 8 s `statement_timeout` for `authenticated`. | `cron_health`; `cron.job_run_details` (only index is the `runid` primary key) | **done** `20261006950000` (one 11-second query written out twice: 46,715 ms to 649 ms) and `20261006960000` (the nightly trim). |

---

## Needs Matt

Matt's instruction of 2026-09-29: "Do not decide anything else on Matt's
behalf." So everything below is open, and the build stops at the point that
depends on it. Each says what it blocks, so nothing waits unnecessarily.

### NM-N. Item 24's dedupe rule, which the HubSpot report says we cannot have yet.

Item 24 says: *"when a direct tenant names a letting agent Opndoor doesn't
work with, that agency should go to HubSpot as a new company (a prospect),
with the agent contact details the tenant gave, marked as having come from a
direct tenant. If the company already exists in HubSpot, add to it rather
than duplicating. Only the agency and agent contact go across, never the
tenant's details. **Check this against the HubSpot consequences report before
building.**"*

Checked. Here is what the check says.

**The data exists.** `application_delivery_contacts` already holds
`agency_name, title, first_name, last_name, email, phone` per application --
exactly the agent contact the tenant gave, and nothing of the tenant's. Dev
has 5 rows, and the one dismissed match has a contact against it. No capture
step needs building.

**The write is mechanical.** `hubspot-sync` already upserts companies via
`POST /crm/v3/objects/companies/batch/upsert` on the unique property
`crm_company_key`, and already searches HubSpot on that same property. A
prospect is that call with a different key and a "came from a direct tenant"
property.

**The dedupe is not, and it is the sentence "if the company already exists in
HubSpot, add to it rather than duplicating".** HubSpot's upsert matches ONLY
on the unique property. A prospect keyed on something of ours dedupes against
our own previous writes and **will happily create a second company next to
one a salesperson typed in by hand** -- which is precisely what item 24
forbids.

Matching it instead needs a search by NAME or DOMAIN and a rule for what
counts as the same company. "Foo Lettings" against "Foo Lettings Ltd" against
"Foo Lettings (Chelsea)" is a judgement, and getting it wrong attaches a
prospect's contact to the wrong company in your CRM.

**And this is the report's own open question.** HUBSPOT-CONSEQUENCES.md ends:
*"If only one thing comes back: may the portal store, and own, the identity
of the HubSpot records it writes?"* Today it stores none -- HubSpot returns
its record id on every write and the code throws it away -- so the portal
cannot tell whether a company it is about to create is one it already made,
let alone one somebody else did.

**Three ways, and it is your call:**

1. **Match on name, exactly, case- and punctuation-insensitive; create if no
   exact match.** Simple, predictable, and will still create a duplicate of
   "Foo Lettings Ltd" when the tenant typed "Foo Lettings". Safe in the
   direction that matters -- it never merges the wrong two -- and leaves you
   tidying duplicates.
2. **Match on the agent's email DOMAIN first, then name.** Much better hit
   rate; risks attaching to the wrong company where an agent uses a personal
   or shared domain (gmail, a franchise's head-office domain).
3. **Answer the report's question first** -- let the portal store the HubSpot
   company id it is given -- and then this becomes exact for everything the
   portal has ever written, with name matching only for the rest.

**Not built.** Creating companies in your CRM is outward-facing and hard to
undo, and every option above duplicates or mis-merges without your answer.
Everything up to the write is ready.

### NM-M. Deleting the Reporting scope picker also deletes "view as". Item 15.

**This is the one thing in items 15 and 20 I have not done, and it is a
decision rather than an ordering problem.**

Both halves of NM-F are built and on dev: the estate-wide per-customer table
(`91369f8`) and the Reporting tab on each customer's own page (`b80f696`).
NM-F's third line says "The scope picker is deleted." I have not deleted it.

**Because the picker is not only a picker.** It sets `scopeSel`, and
`SessionContext` derives `viewingAs` from it, and Reporting reads `viewingAs`
in four places:

| | what it does |
| --- | --- |
| `agencyFacing` | drops Opndoor's own money-ops blocks when viewing as an agency |
| `drawAs` | renders the page as that party's own management sees it |
| the commission eyebrow | "Regent's Lettings' commission" rather than "Your commission" |
| one block gated on `viewingAs === null` | Opndoor-only content, hidden while viewing as somebody |

So an admin can currently open Reporting **as an agency sees it** -- their
own tiles, their own settlement, without Opndoor's internals. Nine
assertions in `viewAsIsTheParty.render.test.tsx` protect that, and one of
them is an isolation property worth keeping: an admin viewing as an agency
is not shown Opndoor's own commission-by-partner split.

**The new tab is not the same thing.** It is the four measures for that
customer. It is not their Reporting page.

**And the picker cannot simply be left, either.** `scopeSel` is shared with
Applications (your 2026-09-29 answer). With no picker on Reporting, an admin
who narrows on Applications would find Reporting silently narrowed too, with
no control to widen it back. That is worse than today.

**So, three ways, and it is your call:**

1. **Delete the picker and "view as" with it.** Reporting becomes
   estate-wide, full stop. The per-customer tab is the answer to "how is
   this customer doing". The nine assertions go, and the isolation one moves
   to wherever view-as still exists -- nowhere, so it is simply deleted.
   Simplest, and loses a capability you asked for two days ago.
2. **Delete the picker, keep "view as" by moving it to the customer's own
   page.** The Reporting tab grows from four measures into that customer's
   full Reporting page. Most work, loses nothing, and is the most faithful
   reading of "see the reports for each customer".
3. **Keep the picker on Reporting.** Items 15 and 20 are otherwise done, the
   per-customer table and tab both exist, and the picker stays as the way to
   view as a party. Least work, and leaves the control you called confusing.

Nothing else is blocked by this; everything else in items 15 and 20 is
shipped and checked on dev.

### NM-L. What period should Home's Direct signups cover? Item 25.

Item 25 asks for this: "Confirm from the code what period Direct signups
currently uses and write it under 'Needs Matt' with the option of a period
choice (today, this week, this month, all time) for Matt to decide."

**What it uses today, read off the code.** `countByStatus({ ...scopeOpts,
channel: 'Direct' })` with **no periodRange**, so `inPeriod` waves everything
through: it is **all time**. And `countByStatus` counts **current status**,
not events in a window -- a row is under `sent` because it is sitting at Sent
now, not because it was sent recently.

**Which makes three of the four numbers a different kind of thing from the
fourth.** Awaiting decision, Sent and Paid are states a referral waits in and
leaves, so those three are already "waiting now" whatever period were
applied. Deed issued is terminal: nothing leaves it, so that number is every
direct deed ever issued and grows for ever.

They are labelled accordingly for now, which is item 25's own instruction.

**The decision.** A period choice (today / this week / this month / all time)
would change the fourth number and would change nothing about the first
three, because a queue does not have a period. So the honest options are:

1. **Leave it.** Three queues and one running total, each labelled. No
   control, nothing to get wrong.
2. **A period on Deed issued alone.** The only number a period changes.
   Slightly odd to have one control over one of four tiles.
3. **A period over the whole panel**, which would turn the first three into
   "how many ENTERED this state in the period" -- a different question from
   the one they answer now, and a different query.

Option 3 is the only one that makes all four consistent, and it is a rebuild
of the panel rather than a control added to it. Not started; nothing is
blocked by it.

### NM-K. The simpler Origin picker Matt asked to be offered. Item 7.

Item 7, verbatim: *"Matt isn't sure the picker is helpful in this form; after
fixing, note in QUEUE.md under 'Needs Matt' a one-line simpler alternative
for him to consider, but don't redesign it."* The picker is fixed and works;
this is the one line, not a build.

**The one line:** replace the type-to-search picker with three plain chips
that are already the shape of the rest of the filter bar -- Origin
(Everything / Agencies / Suppliers / Direct), then a second chip listing the
parties of whichever of those is chosen -- so choosing a rail and choosing a
party are two visible steps instead of one box that has to be searched.

**Why it is worth considering.** The whole fault in item 7 came from the two
rails being choices the book cannot produce, wedged into a control built to
search the book. Two chips put the rail where it belongs, which is a property
of the estate, and leave the search to the parties.

**Why it is NOT being built.** It is a redesign, item 7 says not to, and the
same control is shared with Reporting, where item 15 and NM-F are still open.
Changing it here would decide half of those.

**One thing found while fixing item 7, for NM-F / item 15.** Item 15 says the
Reporting picker has "the same fault as item 7". It does not have the same
CAUSE: Reporting narrows through `paymentMetrics.scopeFull`, which already
calls `originMatches` and already has both rail arms. So whatever is wrong
there is something else, and fixing item 7 will not have fixed it. Parked
with item 15, not investigated, because item 15 says to wait for an answer.

### NM-F. ANSWERED by Matt, 2026-09-30. Both halves, and the tab is Opndoor-only.

Matt, verbatim: *"NM-F: yes to both halves. The per-customer Reporting tab is
Opndoor-only; agencies and suppliers keep their own Reporting page as it is."*

**So the build is:**

1. **One estate-wide Reporting page with NO picker**, whose centre is a table
   with one row per customer -- every supplier and every agency together --
   and Opndoor's four measures as the columns (referrals sent, fees
   collected, deeds issued, commission payable). That is walk-fix item 20.
2. **A Reporting tab on each agency and each supplier page, for Opndoor
   only.** Walk-fix item 15.
3. **The scope picker is deleted.**
4. **Agency and supplier users keep their existing Reporting page unchanged.**
   This is the half that stops the work spreading: no customer-facing screen
   changes, so rule 3 (only a Director sees commission) is not re-litigated
   and nothing a customer sees today moves.

**This decides walk-fix item 7 as well.** Item 7 is "the Applications Origin
picker does nothing -- fix it". The Reporting picker is being deleted, and
item 15 records that the two pickers share one fault and one control. Matt
also said of item 7: *"Matt isn't sure the picker is helpful in this form."*

**I am not deleting the Applications picker on the strength of that**, because
item 7 says fix it and item 15's deletion was only ever about Reporting. But
fixing a control on Applications that is being deleted from Reporting means
the two screens stop sharing one component, so item 7 is now a smaller,
self-contained fix to Applications alone. Recorded here rather than decided:
if Matt wants the Origin picker gone from Applications too, say so and item 7
disappears entirely.

**Unblocks:** walk-fix items 15 and 20. **Item 7 is no longer blocked** and is
a standalone fix.

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

### NM-H. There is no supplier login on dev, and step 5 of the night run needs one

The end-to-end walk asks for "the Kestrel user". **There isn't one.** No
active user exists on `kestrel-lettings`, `harbour-lets`, `letly` or
`referencing-partner`. The only supplier-side account anywhere is
`123@opndoor.co` on `test-supplier`, which is still `pending` with no password
set, so it cannot sign in.

That also means **the supplier rail has never been walked through a browser by
anyone**, which is worth knowing on its own, and it is the rail R1 was found
on.

**What I need:** may I create a Kestrel Director and a Kestrel Negotiator with
a known password on dev? It is dev and disposable, but it is Matt's data and
it adds accounts, so it is not being done unasked.

**Until answered:** the supplier half of the walk runs at the database level,
as the real resolvers see it, which needs no login. The browser half of the
supplier rail stays unwalked and will be reported as such.

**Also parked with it:** the three Regent logins' passwords are not recorded
anywhere and cannot be read back from their hashes. All three have been signed
into recently, so Matt or Balal hold them. They are NOT being reset, because
resetting mid-cutover would lock out whoever is using them.

### NM-I. ANSWERED by Matt, 2026-09-30. OPNDOOR NEVER GIVES PARTIAL REFUNDS.

**The rule: a refund is always the full fee. The refund action refuses any
other amount. Pro-rating is NOT built.**

Matt, verbatim: *"Opndoor never gives partial refunds. A refund is always the
full fee. Make the refund action refuse any amount other than the full fee,
on dev and in Balal's live hotfix package, instead of changing how partial
refunds affect commission."* And again: *"Do not build pro-rating. Correct
NM-I to say so."*

**A superseded answer of mine was recorded here and was wrong.** When Matt
asked me to write the answer I proposed pro-rating the commission. He then
told me partial refunds do not happen at all, which makes the question moot
rather than differently answered. The pro-rating proposal is gone; it is
mentioned only so nobody finds a stale version of this file and builds it.

#### The thing Matt needs to know before this ships

**There is no refund action in the portal.** Nothing in `src/` and nothing in
any edge function creates a Stripe refund. `apply_stripe_refund` has exactly
one caller, `stripe-webhook`, and it is not performing a refund -- it is
RECORDING one that has already happened inside Stripe, because somebody
refunded there by hand.

You cannot refuse a fact. If the RPC simply raises on a partial:

1. Stripe has already moved the money.
2. The RPC raises, the webhook returns 500, and Stripe retries -- for ever.
3. The application is never marked refunded at all. It still reads as fully
   paid: commission still paid out, deed still live, underwriter still billed.

That is **worse than the bug being replaced**. Today a partial over-corrects
by wiping the whole commission; a bare refusal would under-correct to nothing
and jam the webhook.

**So the rule is implemented in the only way that is both what Matt asked for
and safe:**

- `apply_stripe_refund` **refuses** any amount that is not the full fee, with
  a clear message naming both figures. That is Matt's rule, enforced at the
  database.
- `stripe-webhook` recognises that specific refusal and, instead of looping,
  raises a LOUD ops incident naming the guarantee and the amount, and returns
  200 so Stripe stops retrying.

The row then still says paid while Stripe says partly refunded -- a real
divergence, left deliberately visible. That is the honest handling of
something the business says never happens: somebody is told immediately and
has to go and look. It is not silently mis-applied and it is not silently
retried.

**R2 is NOT reverted.** Its `partially_refunded` state stays, because the
refusal only prevents FUTURE partials and says nothing about history: if any
application was already mis-marked by the old unconditional flip, R2's logic
is what distinguishes it. The state simply becomes unreachable going forward,
which is what "never happens" should look like in a schema.

**Status: test written (`a_refund_is_the_whole_fee.test.sql`, 9 assertions),
implementation next.**

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
| M4 | The tenancy-correction replay guard is per-token, and every deed send mints another, so the same destructive correction replays on a second link. | **done** `dee9079`. An ADJACENT defect, found later, is also done: the agent's link moved one application of a joint tenancy. `0f6c1f5`, per Matt's Q1 answer. |
| M5 | `commission_statement_lines` has no rail exclusion, so a matched direct-rail application becomes the matched agency's statement payee. Held off today only by `opndoor-direct`'s rate being 0. | **done** `20261006580000` |
| M13 | **Found while fixing M3/M5, not by a reviewer.** `agreement_volume` carries the same inclusion-form predicate the digest had (`application_channel(ap.id) = 'Agent referral'`), so a SUPPLIER agency's negotiated volume is always zero and its commission tier never advances. One line, same rule as `20261006580000`. | **done** `20261006590000` |
| M6 | `referencing-inbound`'s idempotency claim is keyed on `table_id` alone, so any inbound token can claim or burn another agency's hand-over. Not yet in use (zero rows). | **done** `20261006610000`; M1's replay-read oracle closed with it |
| M7 | The re-invite path never asks the ladder: a Manager can trigger a recovery link and an audit row against the Director above them. | **done** `invite-user/index.ts` |
| M8 | Five `language sql` functions still answer a password-only session (`agreement_for_agency`, `commission_preview`, `commission_split_batch`, `org_deed_readiness`, `org_rate_tiers`). The two plpgsql ones are done. | **done** `20261006600000` |
| M9 | Direct-rail rows counted into agency/branch counters in `hydrate.ts`; a group page's "What they earned" lists every payee on the rail; direct rows become an invented agency payee in `commissionSplit.ts`. | **two of three done** `9427d43` (hydrate.ts, commissionSplit.ts). The group page's "What they earned" is Q2, open. |
| M10 | `set_receives_notifications` can never be used on a supplier colleague (its scope test requires the TARGET to hold a position, which only estate users do). | **not real as recorded.** A different, real defect sits beside it in `caller_may_set_for`, and it needs a decision: Q4. |
| M11 | `opndoor_manager` sees the notifications tick on the agency People tab and every click raises 42501. | **done** `AgencyHome.tsx` |
| M12 | `set_home_branch` has no caller anywhere in the product: a home branch cannot be corrected after invite. | **done** `PositionModal.tsx` + `positionsService.setHomeBranch` |
| L | The eight lows. | **all eight done.** Four were already fixed and verified rather than taken on trust (ILIKE `20261006710000`, the `.neq` NULL hole, `send-password-reset`'s origin, `commission_statement_refs`). Three done `320eb4c`: the second factor on **three** tables the last sweep missed, not one; `detach_user_from_agency`'s missing position; `set_branch_deed_recipient` calling the house partner "this organisation". The last, localStorage surviving sign-out, done `ff47377`. |

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
