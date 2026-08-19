# Build log

**Kept as we go, not written up afterwards.** A developer checking this work
should be able to read what was built, in order, with what it touched and what
was proved, without reading a hundred commits or asking anybody.

**The discipline, so it survives whoever writes the next entry:**

- One entry per piece of work, newest at the top, dated.
- Say what it **touched**, not just what it added. Shared ground is the thing a
  reviewer needs to find.
- Say what was **verified live** against a real database and what was only
  reasoned about. Those are different claims and the difference is the whole
  value of the log.
- Say what it **left open**, and where that is recorded.
- Mistakes stay in. A log that only records successes is a marketing document,
  and the retracted things are the ones that cost time when they come back.

Design records live elsewhere and are not repeated here: `TENANT-PLATFORM.md`
for the tenant journey, `PARTNER-API.md` for the partner API, `HANDOVER.md` for
the estate and its open items, `REGRESSION.md` for the test plan.

---

## 2026-08-19 — The tenant journey's front door, look and lifecycle

**Built.** Registration, six-digit email verification, sign-in, password reset,
and a three-audience login (Tenant / Agent / Supplier) seeded from `?tab=`. The
agent handoff: an invite that lets a tenant claim an application their agent
created. The signed-in journey moved into the portal's own app shell. A status
card and timeline. Demo controls to walk the lifecycle in mock mode.

**Touched.** `src/pages/Login/Login.tsx` gained an audience selector; the agent
path is wrapped in a conditional and otherwise byte-identical.
`create-referral` forked on `referencing_mode` so an `opndoor_referenced`
referral mints an invite instead of a Stripe session; the referral path is
`pre_referenced_open` and does not enter the branch.

**Migrations.** `20260812200000` invites, `20260812210000` drafts may be
incomplete, `20260812220000` the fee is not the same event as submission,
`20260812230000` email codes, `20260812240000` two races in those codes.

**Verified live.** Prequalification arithmetic including the share basis;
registration not enumerating; the code's four controls, with eight concurrent
wrong guesses all refused and eight concurrent issues allowing exactly five; a
tenant reading `[]` from PostgREST; the submission gate refusing without the fee;
a real Stripe test session created carrying `purpose=eligibility`.

**Retracted, and worth knowing.** Three security holes I shipped and then fixed
after an adversarial review, all in `tenant-auth`:

- **Critical.** The password-reset link was built from a **client-supplied
  origin**, so one unauthenticated request would have had opndoor's own sender
  deliver a live recovery token to a host the attacker named.
  `send-password-reset` had already solved this in a comment I had read.
- **High.** The whole file was unauthenticated and unthrottled.
- **Medium, twice.** Both code caps were check-then-act and lost their races.

**Also retracted.** A standalone prequalification screen before registration,
built on a wrong reading of the order and deleted when corrected. The rules it
used survive; only the screen went.

**Left open.** `APP_URL` must be set or no tenant reset mail is sent
(`HANDOVER.md` 39). Supplier is a tab with nothing behind it (41). No mail
provider on dev, so codes are issued and never delivered (37).

---

## 2026-08-18 — The tenant journey's form and data model

**Built.** Six tabs and seven steps, the field spec as data (nine employment
types, eighteen additional income types, three years of address history,
adverse credit), autosave with resume, document storage, tenant identity.

**Touched.** `applications` gained `applicant_id`, and `referrer_id` became
nullable with a trigger-based guard replacing the NOT NULL. `liveAnalytics`
excludes unreferred applications from referrer rankings.

**Migrations.** `20260812150000` profile schema, `20260812160000` documents and
buckets, `20260812080000` tenant identity, `20260812090000` referrer optional.

**Verified live.** Autosave and resume against Postgres; cross-tenant access
refused; the mutual-exclusion triggers.

**Left open.** The five later tabs are gated on vendor credentials
(`TENANT-PLATFORM.md` 6.1). No retention on the two new buckets (31).

---

## 2026-08-18 — Rails 3 and 4, org sharing, and the shared-ground work

**Built.** Route-based attribution, org visibility by relationship, a
relationship-aware merge, per-partner CRM cursors, the eligibility criteria in
SQL, the two-payment split, the provider hand-over receiver and callback, joint
tenancies.

**Touched, and this is the important column.** `applications.partner_id` changed
meaning from "who owns the agency" to "which route this arrived by"; the trigger
that overwrote it now only fills it when absent, which is provably a no-op
because both create paths already passed the value it derived. `agencies_select`
and `branches_select` moved to reachability; **`contacts_select` did not**, and
a migration fails if it ever gains a reachability arm.

**Verified live.** Thirty-one checks after the first push, including the six
status constraint rejections tested against a real row inside a rolled-back
subtransaction; eleven org-sharing checks proving visibility was unchanged.

**Left open.** Seams 25, 26 and 27 in `HANDOVER.md`, all needing an answer from
the provider or the developer.
