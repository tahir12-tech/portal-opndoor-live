# What making the platform authoritative actually does

**Q-07, for Matt, 2026-09-29. No code was written for this and none is
proposed here.** You asked for it before fold 17 is built because it might
change what you want built. It does.

Everything below was read from the code and measured read-only against dev
(`nfufwcpgrhfgwtphegca`). The live project was not touched.

---

## The short version

**Fold 17 is not a reversal, because the direction is already the way you want
it.** There is no inbound path from HubSpot at all: one file in the whole
repository talks to HubSpot and it only ever writes. The portal's own README
already calls the portal the system of record. The company *name* in HubSpot
is already overwritten by the portal whenever the sync runs, which quietly
contradicts the position that HubSpot is commercial truth.

So "make the platform authoritative" is not a switch to throw. It is five
separate things, and **three of them are worth doing whether or not fold 17
ever happens, and need no decision from you.**

**The one decision that is genuinely yours, and that everything else waits
on:** does the portal record *which* HubSpot record each agency and branch
corresponds to, and is the portal allowed to create, merge and retire those
records?

Today it records nothing. The link is "the letters RFL plus the first eight
characters of the portal's internal id", recalculated every time and stored
nowhere. HubSpot hands back its own record id every single time the portal
writes, and the code throws it away. So today, "the platform is authoritative"
is a claim the platform makes about a link it cannot see. It cannot tell
whether its key now points at a company somebody merged, it cannot follow one
of its own agencies being merged away, it cannot delete anything, and it
cannot answer "which HubSpot records are mine".

---

## Three things that are wrong now, regardless of fold 17

These are not consequences of the change. They are true today.

**1. A HubSpot outage longer than about half an hour starts destroying data.**
This is the most serious thing in the report. The sync cannot tell an outage
from a bad record: a "service unavailable", a "slow down" and a "this data is
wrong" all arrive as the same failure. After enough retries the event is
*parked*, and the system's own alert says it "will NOT reach HubSpot until it
is replayed" — but nothing can replay it. There is no replay path. So a long
outage is not a delay, it is a permanent hole, and the only sign is an alert
nobody can act on.

**2. Two of the three rails never reach HubSpot as a referral at all.** A
direct signup and a supplier's API referral both create an application without
writing the record the sync reads, so neither produces a referral event.
Everything that identifies a referral — who, what property, which channel — is
attached to that one event. On dev that is 31 of 34 applications that would
arrive as anonymous records with no channel. Reversing the direction of
authority is worth nothing while the feed only covers one rail in three.

**3. The sandbox gate fails open when it cannot tell.** The test is written so
that "not explicitly a rehearsal" counts as real, which means a record whose
livemode is missing or unknown is treated as live and sent. Nothing in the
test suite asserts the gate at all. There are zero sandbox rows today, so
nothing has leaked — but under the rule that the test suite is the definition
of secure, this gate is currently undefended.

---

## What shipping this branch creates, which does not exist in production

Worth separating, because it bears on cutover rather than on fold 17.

The portal pushes a commission rate onto each HubSpot company. It pushes the
**route's** rate, not the party's negotiated rate. On production today that is
correct, because production has no negotiated agreements at all — there is one
rate per partner and that is the rate. **This branch introduces negotiated
agreements, and the moment it ships that pushed number becomes wrong for
several named agencies on dev**, including Regent, whose real terms are three
weeks at 20% or five weeks at 25% and whose HubSpot company would say
something else entirely.

That is not a reason to delay the branch. It is a reason to fix the rate the
sync sends *before* anybody builds a deal mirror on top of it, because a
mirror built on a wrong number makes the wrong number authoritative.

---

## The ten situations you named

**Renamed companies.** The cheapest of the ten, and the surprise. Because the
link is an internal id rather than a name, a rename on either side cannot
detach anything. But a rename in HubSpot is silently undone the next time that
agency sends a referral, and a rename in the portal never reaches HubSpot at
all, because there is no rename screen and org changes do not generate sync
events. Nine agencies on dev, seven distinct normalised names.

**Removed people who own activity.** People are not in this integration at
all. The sync writes about forty applicant fields and seven company fields and
not one of them names a member of staff. HubSpot holds no portal person and
the portal holds no HubSpot person. So the honest answer is "nothing happens",
and the consequence for fold 17 is to build *less*, not more: there is nothing
to keep in step.

**Two-to-one mappings.** The main case is deliberate and therefore will never
be reported as a bug: an agency with a single office is collapsed into one
HubSpot company. Nothing records that the collapse happened. When that agency
opens a second branch, a new company is minted for the original office while
the old one keeps serving as it, and the existing applicants are never
re-pointed. Ordinary growth quietly splits a company in two.

**Properties renamed in the Hub.** There is no address-change event and no
address-edit screen, so for this one "the platform is authoritative" is not a
configuration change at all — it is a new screen, a new event and a migration.
Also, one real address is many HubSpot records (one per applicant), and a
correction has no way to fan out to them.

**The rail and direct signups.** Covered above: two rails in three never
produce a referral event.

**Joint tenancies.** Two problems, and the first is live in a weekly email
already. The rent recorded against each tenant of a joint tenancy is the
**whole** tenancy rent, by design, because that is what the fee is calculated
from. HubSpot receives that number once per tenant, so any total, rollup or
forecast on rent over-counts a joint let. Second, there is nothing in HubSpot
that can tell that two applicants are one tenancy — no shared key, no link —
so the deal count is inflated and cannot be corrected.

**Sandbox leakage.** Covered above. Zero rows today; the gate is real but
narrow and fails open.

**Regent's sync volume.** The volume question has the wrong shape. Regent at
500 referrals a month is roughly 200 calls a day against an allowance of
hundreds of thousands. Volume is not the risk. The risk is that the queue is
**per route, not per company**, and on the agency rail every agency Opndoor
onboards shares one queue that stops at the first failure. One bad Regent
record stalls every other agency behind it. There is also no handling of
HubSpot's "slow down" response anywhere, which is what turns a busy hour into
the parking problem above.

**A HubSpot outage.** Covered above. The most serious item in the report.

**Deals and commercial terms.** Covered above: the rate being pushed is the
route's, not the party's.

---

## A safer order, if you want it

Three of these need nothing from you.

1. **Fix the feed before reversing it.** Make the two missing rails produce
   referral events. Until then the reversal covers a third of the business.
2. **Store the HubSpot record id.** One migration, plus keeping the id HubSpot
   already hands back instead of discarding it. This is the precondition for
   merging, deleting, reconciling, and for any honest claim of authority. *This
   is the decision that is yours.*
3. **Write down who owns each property, one at a time.** Three columns:
   ours, theirs, calculated by them. Start by telling sales that the company
   name is already ours, because they may not know.
4. **Add a way to answer "what changed" before promising to reconcile.** The
   main tables have no general "last edited" stamp, so a reconciliation job has
   no source to read. Three of the ten analyses assumed one exists.
5. **Only then decide whether the platform may create and retire HubSpot
   records.** This is the irreversible half, and it is where deletion and a
   tenant's right to erasure have to be answered — a mirror that cannot delete
   is a retention problem.

Leave the "who owns the commission number" question last, despite it being the
loudest. It is cheap and reversible, and answering it early gives false
confidence that the harder half is settled.

---

## Two things found while looking, that are not about fold 17

**There is a second producer of HubSpot company records outside this
repository.** The prospecting pipeline in `~/Downloads` builds lists of
letting agents for outbound and is described by its own instructions as
HubSpot-ready. If both it and the portal create companies, they will not agree
on identity, because the portal's key is derived from an id that pipeline has
never seen. Worth knowing before the portal is made authoritative over
companies it did not create.

**Turning the sync on in production is a single hand-edited flag.** It is not
a migration, so it leaves no trace in the history and the drift check cannot
see it. Worth a line in the cutover checklist rather than a change.

---

## What I would want answered first

If only one thing comes back: **may the portal store, and own, the identity of
the HubSpot records it writes?** Everything else in fold 17 is a list of
properties and can be changed later. That one is the difference between a
platform that is authoritative and a platform that asserts it.
