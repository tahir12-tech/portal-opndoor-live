-- A MANAGER COULD STILL ASK THE DATABASE FOR THE RATE.
--
-- 20261005170000 gated the four routes a client is supposed to use
-- (application_commission_rates, my_partner_rates, commission_split_batch,
-- commission_preview) and its header listed four MORE that were deliberately
-- left alone:
--
--   commission_total, resolve_rates, commission_split, freeze_commission_lines
--
-- The reason was right. create_referral calls commission_total to freeze the
-- rate, running SECURITY DEFINER but under the referring user's own auth.uid(),
-- so gating that function on may_see_commission() would have had Managers
-- silently creating referrals worth nothing. manager_sees_no_commission.test.sql
-- asserts exactly that, and it must keep passing.
--
-- What was missed is that "not gated" and "granted to authenticated" are two
-- decisions, and only the first one was thought about. They are SECURITY DEFINER
-- and every one of them was executable by any signed-in user, so they were not
-- internal helpers at all, they were endpoints. Proved on dev as the staged
-- Regent Manager (sees_commission false, may_see_commission() false):
--
--   select * from public.commission_split(<branch>, <partner>, 1);
--     --> (agency, b93277db..., "Regent's Lettings", 0.2000, agreement)
--   select public.commission_total(<branch>, <partner>, 1);
--     --> 0.2000
--
-- That is the agency's commission rate, in one PostgREST call, to the level the
-- whole ruling exists to withhold it from.
--
-- THE FIX IS THE GRANT, NOT A GATE, and that distinction is the point. Adding
-- may_see_commission() inside these would break referral creation for Managers,
-- which is the trap the original header correctly avoided. Taking EXECUTE off
-- `authenticated` breaks nothing: SECURITY DEFINER callers run as the function
-- OWNER, which keeps its own rights, so create_referral, the statement builders
-- and the settlement functions all keep calling them exactly as before. Nothing
-- in src/ references any of the four (checked: zero occurrences), because they
-- were never meant to be called from a browser.

revoke execute on function public.commission_total(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.commission_split(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.resolve_rates(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.freeze_commission_lines(uuid, uuid, uuid, integer, numeric) from public, anon, authenticated;

comment on function public.commission_total(uuid, uuid, integer) is
  'INTERNAL. The frozen rate for a referral, called by create_referral as its definer. NOT granted to authenticated: it answers with a commission rate and has no reader gate of its own, by design, because gating it would make a Manager''s referrals worthless. See 20261005220000.';
comment on function public.commission_split(uuid, uuid, integer) is
  'INTERNAL. The payout split behind commission_split_batch, which is the gated route a client uses. Not granted to authenticated: see 20261005220000.';

-- ---------------------------------------------------------------------------
-- AND THE THREE TABLES THAT STATE A RATE.
--
-- Same question asked of rows rather than functions. All three are granted
-- SELECT to authenticated and their RLS lets an agency read its own:
--
--   application_commission_lines  the frozen line per referral, with `rate`.
--                                 Proved: the Manager read 4 rows at 0.20 and
--                                 0.25, and hydrate.ts asks for this table on
--                                 EVERY sign-in, so it is not even a devtools
--                                 exercise, the client fetches it for them.
--   pricing_agreement_bands       agent_rate per tenant-count band. Proved: the
--                                 Manager read 0.20 and 0.25.
--   commission_tiers              agent_rate per volume tier. Empty on dev today,
--                                 so nothing leaked yet, which is luck rather
--                                 than design.
--
-- A RESTRICTIVE policy, not a replacement for the ones there. Restrictive
-- policies AND with every permissive policy, so this subtracts a reader without
-- touching the existing arms and without anybody having to re-derive who may see
-- which row. A Director, an opndoor admin and every SECURITY DEFINER caller are
-- unaffected: the definer functions run as the owner and the owner bypasses RLS,
-- which is why the statement and settlement builders keep working and why
-- create_referral can still freeze a Manager's rate from the bands.
--
-- WHAT A MANAGER SEES INSTEAD: nothing, rather than an error. Their hydrate
-- select returns zero commission lines and the screens that would have drawn
-- them are already gated on the client, so the two agree.
-- ---------------------------------------------------------------------------

alter table public.application_commission_lines enable row level security;
drop policy if exists acl_commission_readers_only on public.application_commission_lines;
create policy acl_commission_readers_only on public.application_commission_lines
  as restrictive for select to authenticated
  using (public.may_see_commission());

alter table public.pricing_agreement_bands enable row level security;
drop policy if exists pab_commission_readers_only on public.pricing_agreement_bands;
create policy pab_commission_readers_only on public.pricing_agreement_bands
  as restrictive for select to authenticated
  using (public.may_see_commission());

alter table public.commission_tiers enable row level security;
drop policy if exists ct_commission_readers_only on public.commission_tiers;
create policy ct_commission_readers_only on public.commission_tiers
  as restrictive for select to authenticated
  using (public.may_see_commission());

-- ---------------------------------------------------------------------------
-- STILL OPEN, DELIBERATELY, AND WRITTEN DOWN SO IT IS NOT LOST.
--
-- public.agencies.agent_rate, public.agencies.partner_rate and
-- public.branches.agent_rate are readable by every signed-in user. Their
-- attacl is null and both tables carry a TABLE-level SELECT grant to
-- authenticated, so the denylist re-grant that 20260811180000 applied to
-- public.applications was never applied to the org tables. A referrer at a
-- rate-priced agency can read their agency's rate today.
--
-- It is not closed here because closing it is not one statement. A column-level
-- REVOKE cannot subtract from a table-level grant (20260811180000 explains this
-- at length), so it needs the drop-and-re-grant-per-column pattern, and
-- src/lib/hydrate.ts names partner_rate and agent_rate in its select strings for
-- agencies, agency_groups and branches. PostgREST errors a select naming a
-- column the caller cannot read, so revoking without changing hydrate in the
-- same breath is a failed sign-in for every user, which is too large a change to
-- make in the same migration as the four lines above.
--
-- Not urgent for the Regent cutover: enforce_one_rate_per_party means an agency
-- priced by a negotiated agreement cannot also hold its own rate, and Regent is
-- agreement-priced, so their agent_rate is null. The exposure is real for
-- rate-priced agencies and should be the next piece of this work.
-- ---------------------------------------------------------------------------
