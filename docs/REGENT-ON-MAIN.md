> ## CORRECTION, 2026-09-29, after Matt read this
>
> **Sections 5 and 6 were wrong about the BRANCH, and the recommendation has
> flipped.** Sections 1 to 4, which are about `main`, all stand.
>
> I wrote that even on the branch a pre-referenced agency can never have a
> joint tenancy, citing
> `20261003110000_joint_is_agent_rail_only.sql:55`. That guard was replaced
> **the next day** by
> `20261004100000_estate_and_journey_are_two_questions.sql`, and has been
> superseded six times since. I read a dead guard as the live rule.
>
> **The mistake underneath it.** I treated "pre-referenced" and "on our agent
> estate" as one axis, so an agency had to be one or the other. They are two
> questions, and the migration that split them says so in its name:
>
> - the **journey** (`referencing_mode`): are this tenant's references already
>   done before the referral reaches us? A property of the work, frozen onto
>   each application.
> - the **estate** (`is_agent_estate(branch, route)`): is this branch one of
>   the agencies Opndoor onboarded? A property of the relationship, read from
>   the route partner.
>
> An agency can be both, and Regent is: under the house partner
> `opndoor-agents`, so on the estate, and carrying
> `referencing_mode = 'pre_referenced_open'`, so pre-referenced. A joint
> tenancy needs an agency of ours to sit under. Regent has one.
>
> **Proved**, not merely re-read:
> `supabase/tests/a_pre_referenced_agency_of_ours_may_refer_a_pair.test.sql`.
> A Regent-shaped pair at £2,400 goes through `create_joint_referral`, prices
> at **five weeks (£2,769.23)** with **25% commission**, and each application
> still records the pre-referenced journey. The same file asserts the contrast
> at one tenant (three weeks, 20%) and the still-correct refusal for a real
> supplier. 12 assertions.
>
> **What this document was NOT wrong about, and it matters.** It was answering
> the proposal as worded: *Regent onboards as their **own partner** on the
> pre-referenced rail*. In that shape the route partner is Regent's own
> pre-referenced partner, `is_agent_estate` is false, joint tenancies really
> are refused, and the 5-week band really is unreachable. That is asserted in
> the test too. So the fix is not code: it is **onboarding Regent as an agency
> on the Opndoor estate rather than as their own partner**, which is the shape
> that was built and walked on dev.
>
> **The corrected recommendation: ship the branch, and put Regent on the
> agency rail.** Both bands work there today. There is no commercial
> contradiction and nothing left to settle before costing it. Section 6 below
> is superseded by this box.

---

# Can Regent go live on production as their own pre-referenced partner?

Asked 2026-09-29. Answered against `main` (commit f2816a7, 65 migrations,
newest `20260705171000`), which is what production runs -- NOT the
`partner-api` working tree, which carries ~247 extra migrations.

The proposal: Regent Property onboards as their own partner on the
pre-referenced rail, with an agreement of 3 weeks' rent at 20% and 5 weeks'
rent at 25%.

Produced by five independent reviewers (pricing, commission, deed delivery,
joint tenancies, onboarding and isolation), with every BROKEN or ABSENT claim
adversarially re-checked against `main` by a separate agent. Three reviewer
claims were refuted in that pass and are adjudicated at the end.

---

# Can Regent Property go live on `main`? Decision document

Baseline checked: `main` = `f2816a755fb88fa4a23c7a806ad2dc672b0bb113`, 65 migrations, newest `20260705171000_reconciliation_fold_head_office.sql`.

> **Baseline footnote added 2026-09-29.** That is the LOCAL `main`. The live
> repository's main is `origin/main` = `3520a26`, and the two have diverged:
> neither contains the other, and origin/main carries eight commits from
> 27 August to 18 September that the local copy does not (deed email fixes, a
> PandaDoc wait, a refund timeout, toast fixes). Their
> `supabase/migrations` trees are **byte-identical**, 65 files each, so every
> claim in this document about what `main`'s DATABASE can and cannot do is
> unaffected.
>
> Of the client files cited here, I checked each against `3520a26` rather than
> assuming: `partnersService.ts`, `NewApplication.tsx`,
> `applicationsService.ts` and `liveAnalytics.ts` are identical in both, so
> those citations stand as written. **`PartnerManagement.tsx` is not** -- it is
> one of the 26 that differ -- so the line number in the phantom "Add partner"
> finding (`:166`) may have moved on the deployed copy. The finding itself is
> in `partnersService.ts`, which is identical, so only the line reference is
> in doubt. Every claim below was re-checked with `git show main:` / `git grep â¦ main`. The working tree (`partner-api`, 312 migrations, 432 commits ahead, 55k lines changed in `src/` + `supabase/functions/`) is cited only where labelled BRANCH.

---

## 1. The answer

**No.** Regent cannot go live on `main` as proposed: the pre-referenced rail does not exist on `main` (`referencing_mode` returns zero hits tree-wide), the guarantee fee is not a configurable quantity but is hard-wired to `applications.monthly_rent` at both Stripe call sites, and a two-band deal has nowhere to live because `partners` carries exactly one `partner_rate` and one `agent_rate`. Worse, the band discriminator in Regent's actual deal is **tenant count**, and `main` has no joint-tenancy concept at all, so the 5-week band is unreachable on `main` under any configuration.

---

## 2. What would work

These are genuinely production-ready on `main` for a standalone partner:

- **Partner isolation.** `partner_id` is applied consistently as the boundary: `20260702134358_access_rls_rpc.sql:64` (partners), `:71` (users), `:85`/`:95`/`:105` (agencies/branches/contacts), `:116-118` (applications). Regent as its own partner is properly walled off from Harbour Lets, Kestrel, Letly. This is exactly the supplier-rail shape, and it is `main`'s only shape.
- **MFA/AAL2.** `20260702134358_access_rls_rpc.sql:23` `is_aal2()`, restrictive `require_aal2` on every base table (`:56-61`), re-checked as the first statement of every RPC. Client refuses `ready` below aal2 (`src/session/SessionContext.tsx:125-141`).
- **Invites.** `supabase/functions/invite-user/index.ts:64-68` ignores the client-supplied partner slug for a management caller and pins `inviteePartnerId = caller.partner_id`. Regent's manager can staff Regent and cannot invite into another partner. `/accept-invite` route exists (`src/App.tsx:41`), password + TOTP in one journey, `pending -> active` on first verified factor (`20260704185754:8`).
- **Agencies and branches.** `20260705140827_management_org_adds_apply_instantly.sql:7` `admin_add_agency`, `:40` `admin_add_branch`, both AAL2-gated and both forcing the row onto `app_partner()`.
- **Rate snapshotting.** `20260704100425_application_rate_snapshot.sql:6-7,21-22`; `create_referral` freezes the pair at insert (`20260705140347_snapshot_referrer_name.sql:54,68,75`). Rate edits never restate history. Correct behaviour, just with only one rate to snapshot.
- **The referral-to-deed journey itself.** Intake, Stripe checkout, webhook, PandaDoc generation, execution, deed download. Single-tenant, one-month-rent, it works.

---

## 3. What would not

### Pricing

**The fee is not a number the system holds. It is `monthly_rent`.**

- `supabase/migrations/20260702134239_core_schema.sql:125` `monthly_rent numeric(10,2) not null` is the only money input on `applications`. `git grep -iE 'fee_amount|fee_basis|basis_weeks|weeks_of_rent|share_amount' main` returns **zero hits tree-wide** (I reran it).
- The charge is minted at exactly two sites, both `unit_amount: Math.round(rent * 100)` with no coefficient: `supabase/functions/create-referral/index.ts:117` and `supabase/functions/payment-page/index.ts:147`. Both carry the literal product description `"One month's rent, for the opndoor Deed of Guarantee."` (`:118` and `:148`). The tenant is told the basis at checkout.
- There is no partner-level or global escape hatch. `app_settings` exists (`20260704123353_app_settings_bordereau_rate.sql:6`) but its setter hard-rejects every key but one: `:52` `if p_key <> 'bordereau_insurance_rate' then raise exception 'Unknown setting'`.

**Visible consequence.** On a Â£1,000 pcm tenancy Regent's tenant is charged **Â£1,000.00**. The 3-week band should be Â£692.31 and the 5-week band Â£1,153.85. The tenant is overcharged by Â£307.69 (+44%) on the cheap band and undercharged by Â£153.85 (-13%) on the expensive one, and the Stripe line item tells them, falsely, that they are paying one month's rent.

**No banding mechanism of any kind.** `partners.partner_rate numeric(5,4) default 0.25` / `agent_rate default 0.10` (`core_schema.sql:43-44`) are the only rate store. No agency or branch rate column exists. The only setter takes one scalar each and overwrites globally for the partner: `20260705160000_partner_rate_audit_one_decimal.sql:10,56`. The admin UI is two number inputs captioned "Each a share of the guarantor fee (one month's rent)" (`src/pages/PartnerManagement/PartnerManagement.tsx:261,264-265`), which is the product declaring the basis as a system constant in its own words.

### Commission

- Commission is computed **client-side only**, never stored: `src/data/liveAnalytics.ts:360` `const commission = a.rent * a.partnerRate;`, `:445` the agent equivalent, `src/data/exportsService.ts:639-640`. There is no `application_commission_lines` table on `main` and no `share_amount`.
- **Regent becomes both payees at once.** `applications.agency_id` is NOT NULL (`core_schema.sql:111`), and the two settlements key independently on partner (`liveAnalytics.ts:361`) and on partner+agency (`:447`). Regent as its own partner earns `partner_rate` **and**, for each of its own agencies, `agent_rate`. At schema defaults that is 25% + 10% = **35% of a month's rent shown on Regent's own dashboard**, against an agreed 20% or 25%. `agent_rate` must be zeroed **before the first referral**, because the rates are snapshotted at insert and `update_partner_settings` deliberately never touches the snapshots (`20260704100519:5`). The over-credit also propagates to HubSpot: `supabase/functions/hubspot-sync/index.ts:225-226` writes `partners.agent_rate` as the company `commission_rate`.
- **No Director/Manager distinction.** `sees_commission` and `user_scopes` return zero hits on `main`. Roles are the three in `core_schema.sql:53`. Every Regent user set to `management` sees the full settlement, per-application commission and the statement download (`src/pages/Dashboard/Dashboard.tsx:109,617,667`). There is no way to give a Regent Manager operational access while withholding commission.
- **Statements are a browser download of last month only.** `src/data/exportsService.ts:855`/`:901`, period hard-coded at `src/data/liveAnalytics.ts:351-353` with no parameter on `getCommissionSettlement(role, scope)` (`:349`). Nothing is archived, no server-side statement, no month selector. A refund landing later silently restates a month Regent has already been paid for, with no ledger row to reconcile against. (The month picker on the Dashboard at `:244` is the underwriter bordereau, not a commission statement.)

**Visible consequence.** Regent is paid a flat Â£200 (at 0.20) or Â£250 (at 0.25) on every Â£1,000 tenancy, against an intended Â£138.46 or Â£288.46. They cannot be both. And if `agent_rate` is left at default, their own screens claim Â£350.

### Deed delivery to the referrer

- The executed deed goes to exactly two addresses: one contact resolved from the **branch** contact book, and the tenant. `supabase/functions/pandadoc-webhook/index.ts:77-92` calls `effective_primary_contact(p_branch)` and passes that single email; `:104-113` emails the tenant. `supabase/functions/_shared/deedEmail.ts:39-42` sends `to: [opts.to]`, no cc, no bcc.
- **The referring negotiator is never a recipient.** The webhook does not even select `referrer_id` (`pandadoc-webhook/index.ts:45-47`), and `effective_primary_contact` reads `agent_contacts` only (`20260702134358_access_rls_rpc.sql:38-42`), a table with no identity link to `public.users`.
- No preference mechanism exists: zero hits on `main` for `notification_recipient`, `deed_delivery_target`, `receives_deed`, `notify`, `opt_in`. `public.users` (`core_schema.sql:49-62`) gains no column in any of the 65 migrations.
- Per-application **email** to the referrer across the whole lifecycle is the expiry reminder and nothing else (`supabase/functions/expiry-reminders/index.ts:130-141`), and that only fires on applications already at `status = 'deed'` (`20260703122741:41`), roughly 11 months later. Not on payment, not on decline, not on expiry, not on deed issue.
- If no contact resolves, the deed is **not generated at all**: `supabase/functions/_shared/pandadoc.ts:412-420` sets `deed_state='error'`. The only signal is an in-app `deed_delivery_failed` activity row (`pandadoc-webhook/index.ts:93-97`).

**Visible consequence.** A Regent negotiator refers a tenant, the tenant pays and signs, and the negotiator gets no email. Onboarding requires an `agent_contacts` primary row on every Regent branch before the first deed executes, or the deed reaches nobody. A negotiator cannot even resend it to themselves: `20260702171551_tighten_related_writes.sql:53-55` refuses a referrer an override address.

One correction to reviewer 3 here, which I accept: the in-app bell **does** cover the referrer for `payment_received`, `deed_sent`, `deed_signed`, `deed_issued`, `refunded` and `expiry_reminder` (`src/data/activityService.ts:168,202-212`), and `weekly-digest/index.ts:213` plus `expiry-cohorts/index.ts:188` do email partner management. So it is pull-not-push, not total silence. `expired`, `withdrawn` and declined appear in neither `NOTIF_KINDS` nor `FEED_KINDS`.

### Joint tenancies

**This is the part that decides the question, and no reviewer joined it up.**

- `main` has no joint-tenancy concept, and says so in its own migration: `20260705150500_hubspot_sync_seed.sql:70` seeds `tenant_role` as the constant `'Tenant'` with the note **"Portal has no joint-tenant concept"**. `applications` carries one singular tenant (`core_schema.sql:114-119`), the deed has one signer (`_shared/pandadoc.ts:104`) and six merge tokens with no second-signer, apportionment or cap token (`:69-80`).
- Nothing refuses a joint tenancy. The only unique on `applications` is `guarantee_ref` from a sequence. The soft duplicate guard matches tenant **email** + postcode (`src/data/applicationsService.ts:222,232`), so two different joint tenants at one address never trigger it, and `NewApplication.tsx:326-338` never blocks anyway.
- **Consequence on `main`:** a 2-tenant Â£1,000 tenancy becomes two unrelated applications, Â£2,000 charged, two separate full-cover single-signer deeds over one property, doubled commission to Regent, and Â£24,000 reported guaranteed exposure against a Â£12,000/yr tenancy (`src/data/liveAnalytics.ts:116`). Silently accepted, discoverable only by a human noticing two refs at one address.

**And here is the fact that reframes the proposal.** Regent's bands are not volume bands or period bands. They are **tenant-count** bands. The branch migration that implements them names Regent explicitly: `supabase/migrations/20260929100000_agreements_bands_and_tiers.sql:6-8`, "Regent's pay 3 weeks at 20% for a single tenant, 5 weeks at 25% for two or more", implemented as `pricing_agreement_bands (min_tenants, max_tenants, fee_basis_weeks, agent_rate)` at `:50-56`. `20260930100000_joint_referral.sql:9-10` repeats it: "Regent's: 2 tenants = 5 weeks at 25%".

So the 5-week band **is** the joint-tenancy case. On `main`, which cannot represent a joint tenancy, that band is not merely unpriced, it is unreachable in principle.

### Anything else material

- **"Add partner" silently persists nothing.** `src/pages/PartnerManagement/PartnerManagement.tsx:166` calls `addPartner()` and `:167` toasts `Partner "Regent" created at 20% partner / 0% agent`. But `src/data/partnersService.ts:67-88` has **no** `SUPABASE_ENABLED` branch (contrast `updatePartnerSettings` at `:137`, which does call the RPC): it pushes to an in-memory array and writes localStorage. `src/lib/hydrate.ts:84,335` re-reads partners from the DB and `partnersService.ts:32` replaces the array wholesale. Regent vanishes on next login. `main`'s own `supabase/README.md:143-144` admits it. There is **no** create-partner RPC on `main`; `update_partner_settings` raises `'Partner not found'` (`20260704100519:53-54`). Creating Regent requires a hand-written `insert into public.partners`, with no audit row.
- **Per-application rates are writable by Regent's own managers, unaudited.** `applications_update` (`20260702134358_access_rls_rpc.sql:124-135`) is row-level with no column list; there is no column GRANT/REVOKE and the only trigger on the table fires on `branch_id` (`core_schema.sql:182`). RLS cannot restrict columns. So a Regent Director or Manager can `PATCH` `applications.partner_rate` or `monthly_rent` over PostgREST, and because `payment-page/index.ts:73,147` recomputes the charge on every checkout action rather than reusing the session, editing `monthly_rent` before payment **changes what Stripe takes**. No audit row anywhere.
- **`users_mgmt_update`** (`20260702134358_access_rls_rpc.sql:79-81`) lets a Regent manager re-role themselves or a colleague between management and referrer directly, bypassing `admin_update_user_role` (`20260704104758:107-150`) and its self-role, last-superadmin and `user_audit` logic. No escalation to superadmin and no cross-partner reach, but no audit either.
- **NULL-guard flaw, latent.** `app_role()`/`app_partner()` return NULL for an `auth.users` row with no `public.users` row, making `if not (is_admin() or (app_role() = 'management' and â¦))` evaluate to NULL and never raise. Cannot be reached by a correctly provisioned Regent user (`users_partner_by_role`, `core_schema.sql:58`), only by an orphan created if `invite-user/index.ts:103` fails after `generateLink`. Affected final definitions: `amend_tenancy_start` (`20260703103841:40`), `send_deed_to_agent` (`20260702171551:16`), `admin_set_user_status`/`admin_update_user_role`/`admin_reset_user_mfa` (`20260704104758:75,119,165`).

---

## 4. The smallest safe change to `main`

**There is no small change that makes the proposal work. Two honest options exist, and only one of them is small.**

### Option A, which does not exist

Making `main` express "3 weeks at 20% for one tenant, 5 weeks at 25% for two or more" requires, in order:

1. A fee basis (`applications.fee_amount`, `partners.fee_basis_weeks`) plus a new `create_referral` to snapshot it. ~170 lines of SQL, mirroring branch migrations `20260928100000` (69 lines) and `20260928110000` (100 lines).
2. Rewriting every consumer that defines "fees" as `sum(monthly_rent)`: three final-state SQL functions (`referrer_league`, `20260705115145`; the weekly digest metrics, `20260705110146`; `partner_weekly_climbers`, `20260705130959`), about eight client computation sites in `src/data/liveAnalytics.ts` and `src/data/exportsService.ts`, and **22 hard-coded "one month's rent" copy strings across 14 files** including the two Stripe product descriptions and four tenant emails.
3. A bands table keyed on tenant count: branch `20260928120000` (153 lines) + `20260929100000` (221 lines) + resolution `20260929110000` (136) + `20260929120000` (118).
4. **Joint tenancies**, because step 3's discriminator is meaningless without them: the dormant tenancies schema, `share_amount`, per-applicant fee shares, `application_commission_lines.basis_amount`, and a multi-signer PandaDoc template. Branch `20260930100000`.
5. `partners.referencing_mode` (branch `20260810100000`, 50 lines) and a create-partner RPC, because `main` has neither.

That is roughly 1,100 lines of new migration plus a rewrite of the money path through `main`'s untested client analytics layer, on a codebase where the fee basis is asserted to tenants in four emails and two Stripe line items. It is a re-architecture, not a patch. **Do not attempt it.**

There is one thing that must be said plainly because it will otherwise be proposed as a shortcut: **faking `monthly_rent`** to encode Â£692.31 is not viable. It would actually get the fee, the fee reporting, the league, the digest and the commission arithmetically right, because `main` defines all of those as `monthly_rent` and `rate Ã monthly_rent`. What it breaks is every rent-denominated figure: guaranteed exposure reported as Â£8,307.72 instead of Â£12,000 (`liveAnalytics.ts:116`), `avgRent`, both export rent columns, the applications list sort, and the rent shown to the tenant at checkout (`src/pages/Pay/PayLanding.tsx:171`). `src/data/exportsService.ts:646` emits `a.rent, a.rent` into the adjacent "Monthly rent" and "Guarantor fee" columns, so the two would be visibly identical and one of them false. The deed PDF itself is unaffected, since no rent token exists (`_shared/pandadoc.ts:69-80`). Not usable.

### Option B, the genuinely small change, which requires changing the deal

If Regent will accept **one band, single tenant only**, then the minimum on `main` is:

1. **Migration 1** (~40 lines): `insert into public.partners` for Regent with `partner_rate = 0.2000`, **`agent_rate = 0.0000`**, plus a `create_partner` RPC so this is not a hand-written statement. Zeroing `agent_rate` before the first referral is mandatory, not optional; see the 35% finding above.
2. **Migration 2** (~80 lines): add `partners.fee_basis_weeks numeric(4,2) not null default 4.35` and `applications.fee_amount numeric(10,2)`, backfill `fee_amount = monthly_rent`, and a new `create_referral` that sets `fee_amount = round(p_rent * 12 / 52 * weeks, 2)`.
3. **Two edge functions**: `create-referral/index.ts:102,117-118` and `payment-page/index.ts:73,147-148` charge `fee_amount` and take the description from the basis. ~10 lines each.
4. **Three SQL functions**: swap `sum(a.monthly_rent)` for `sum(a.fee_amount)` in the referrer league, the weekly digest and the climbers. New migration, ~120 lines total.
5. **Client**: `liveAnalytics.ts` (`:105,109-113,317,360,445`), `exportsService.ts` (`:412-413,639-640,646`), `hydrate.ts` to carry `feeAmount`. ~60 lines.
6. **Copy**: 22 strings across 14 files.
7. **Operational prerequisite, no code**: an `agent_contacts` primary row on every Regent branch before the first deed, or no deed is generated.

That is 3 migrations and about 8 files. It gives Regent one correct band. It does not give them `referencing_mode`, but on `main` that is harmless: **`main` has no referencing, screening or criteria step at all** (zero hits for `criteria`, `screening`, `prequal`, `start_application`), so `main`'s single undifferentiated rail already behaves exactly as `pre_referenced_open` describes. What is absent is the flag, not the behaviour. It also does not give them a Director/Manager split, statement archiving, or deed email to the negotiator, all of which have to be accepted as known gaps.

---

## 5. Risk of that change versus shipping the branch

**Option B's risk is concentrated and legible.** It touches the money path in a codebase whose fee aggregates are client-side and untested by pgTAP, and the failure mode is a wrong Stripe charge. But the diff is three migrations and eight files, reviewable in an afternoon, and it changes nothing for the existing partners because `fee_basis_weeks` defaults to 4.35 and `fee_amount` backfills to `monthly_rent`. The `sum(monthly_rent)` to `sum(fee_amount)` swap is the one place a mistake is silent rather than loud, and it is three functions.

**Shipping the branch is a different category of risk, in both directions.**

Against: 247 extra migrations and 55,422 lines changed across 303 files in `src/` and `supabase/functions/`. That is not a release, it is a platform change, and it brings the whole three-rail model, `user_scopes` positions, the additive commission split and the agreement resolver into production at once. Per `CLAUDE.md`, `partner_id = app_partner()` stops being a company boundary on the agency rail the moment that lands, and every existing partner is re-hosted on a new authorisation model. `npm run drift` must be clean and the pgTAP suite must be read as added/removed/renamed, not as a total.

For: the branch has had six rounds of security review and **`main` has had none of those fixes**. The four defects above that are not about pricing at all, the phantom "Add partner", the unguarded `applications` column write, the unaudited `users_mgmt_update`, and the NULL-guard family, are all live on `main` today with Opndoor's current partners on it. Shipping Option B leaves every one of them in place. The branch's hardened `users_mgmt_update` (scope plus level-rank comparison) exists only on `partner-api`.

~~**And the decisive asymmetry:** even on the branch, `20261003110000_joint_is_agent_rail_only.sql:55` refuses `create_joint_referral` for any mode other than `opndoor_referenced` ... So **Regent on `pre_referenced_open` never reaches the 5-week/25% band on the branch either.** ... That is a commercial contradiction in the proposal, not a code gap.~~

> **WRONG, corrected 2026-09-29. See the box at the top of this file.** That
> guard was replaced the next day by
> `20261004100000_estate_and_journey_are_two_questions.sql`. The live rule
> asks `is_agent_estate(branch, route)`, not `referencing_mode`, and Regent is
> on the estate *and* pre-referenced. **On the branch a Regent pair at £2,400
> prices at five weeks with 25% commission**, proved end to end in
> `supabase/tests/a_pre_referenced_agency_of_ours_may_refer_a_pair.test.sql`.
> There is no commercial contradiction, and nothing here needs settling before
> costing.
>
> The asymmetry that survives is the opposite one, and it now points the same
> way as the security argument above: the branch delivers **both** of Regent's
> bands and `main` delivers neither.

---

## 6. Recommendation

> **SUPERSEDED 2026-09-29 by the correction box at the top of this file.** The
> paragraph below rests on a guard that had already been replaced when it was
> written. Kept, struck through, because the reasoning around it about `main`
> is still sound and because a decision document that quietly rewrites its own
> conclusion is worth less than one that shows the change.
>
> **The recommendation now: ship the branch, and onboard Regent as an agency
> on the Opndoor estate (under `opndoor-agents`) carrying
> `referencing_mode = 'pre_referenced_open'` -- not as their own partner.**
> Both bands work in that shape today, proved in
> `supabase/tests/a_pre_referenced_agency_of_ours_may_refer_a_pair.test.sql`.
> The security argument in section 5 already pointed at shipping the branch;
> the commercial argument now points the same way instead of against it.
>
> The one thing the struck paragraph gets right and which still holds: if
> Regent were onboarded as **their own partner**, joint tenancies would still
> be refused, because `is_agent_estate` reads the route partner. The choice
> that matters is which estate Regent sits on, not which codebase ships.

~~Do not put Regent on `main` as proposed, and do not ship the branch to do it. The proposal contains a contradiction that no amount of engineering resolves: the 5-weeks-at-25% band is the two-or-more-tenants band, and a pre-referenced referral covers one tenant by the branch's own explicit rule (`20261003110000_joint_is_agent_rail_only.sql:55`), so on the pre-referenced rail Regent only ever hits 3 weeks at 20% no matter which codebase runs. Settle that with Matt first: either Regent goes on the **agency rail**, where joint tenancies and both bands are real and the branch is the only thing that carries them, or Regent's deal is rewritten as a **single band, 3 weeks at 20%, single tenant**, in which case Option B above is three migrations and eight files on `main` and can be live in days. If it is the agency rail, then the honest answer is ship the branch, because back-porting `referencing_mode`, `user_scopes`, the additive commission split, `pricing_agreements` with bands and tiers, the tenancies schema and `create_joint_referral` is the branch, not a subset of it.~~ Either way, four defects on `main` should be fixed regardless of the Regent decision, because they affect the partners already in production: the phantom "Add partner" (`src/data/partnersService.ts:67`), the unguarded column write through `applications_update` (`20260702134358_access_rls_rpc.sql:124-135`), the unaudited `users_mgmt_update` (`:79-81`), and the NULL-guard family in `amend_tenancy_start` and the three `admin_*_user_*` RPCs.

**Reviewer disagreements adjudicated.** Three findings were wrong and I verified each personally. (a) Reviewer 5's "SECURITY DEFINER contact reader with no scope check" is **refuted**: `20260702134957_harden_functions.sql:14` flips `effective_contacts` to `security invoker` 599 seconds after it was created, so a Regent manager holding a foreign branch UUID gets zero rows. The reviewer read the creating migration and not the one that alters it. (b) Reviewers 1 and 2's "nothing can amend the per-application rate" is **refuted**: `applications_update` is row-level with no column list and no guard trigger, so management can write `partner_rate` directly. That makes it a live audit gap, not a missing capability. (c) Reviewer 1's "faking `monthly_rent` misstates every fee, league and digest figure" is **wrong in one clause**: those figures are `sum(monthly_rent)` and would stay consistent with the charge; what breaks is the rent-denominated set. The conclusion "not usable" survives. Reviewer 5's naming of `set_application_status` as the NULL-guard victim is also wrong, `20260703143224:20-22` makes it admin-only and NULL-safe; the real victims are the five functions listed above.
