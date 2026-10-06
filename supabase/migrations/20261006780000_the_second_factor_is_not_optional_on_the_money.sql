-- THE SECOND FACTOR IS NOT OPTIONAL ON THE TABLES THAT HOLD THE MONEY.
--
-- Found while clearing backlog B8, which was about one missing `require_aal2`
-- policy and turned out to be nine, three of them commercial.
--
-- THE MECHANISM, because it is the generalisable part. Eighteen tables carry
-- a RESTRICTIVE `require_aal2` policy. The nine below did not. Three of the
-- nine -- pricing_agreements, pricing_agreement_bands, commission_tiers --
-- LOOK as though they check the second factor, because their SELECT policy
-- reads `is_aal2() and (...)`. That is not enough, and the reason is that
-- PERMISSIVE POLICIES ARE OR-ED TOGETHER:
--
--   pricing_agreements_select      permissive, for select, is_aal2() and ...
--   pricing_agreements_admin_write permissive, FOR ALL,    is_admin()
--
-- `for all` includes SELECT, so the second policy re-admits at aal1
-- everything the first was careful to exclude, and admits every write as
-- well. A guard in one permissive policy is undone by any sibling permissive
-- policy that omits it. Only a RESTRICTIVE policy is AND-ed with the rest,
-- which is why the other eighteen tables use one.
--
-- MEASURED ON DEV, as a real superadmin with `"aal":"aal1"`, before this ran:
--
--   is_aal2() false, is_admin() TRUE, may_see_commission() TRUE
--   select count(*) from pricing_agreements          -> 8    (should be 0)
--   update pricing_agreements set note = ...         -> 1 row rewritten
--   update pricing_agreement_bands set agent_rate=.99 -> 1 rate rewritten
--
-- So an Opndoor admin holding a password and nothing else could rewrite the
-- commission rate on any deal. Every other route to money in this product
-- already required the second factor; this was the way round it, and it is
-- the single place where a stolen password on its own moves money.
--
-- THE OTHER SIX are not commercial but are the same omission, and are
-- included because a rule with six exceptions is not a rule: the application
-- children (commission lines, delivery contacts, documents, eligibility
-- payments), the statement references, and tenancies.
--
-- WHY THIS BREAKS NOTHING. `is_aal2()` reads the JWT's aal claim. Every
-- staff session in this product steps up to aal2 -- MFA enrolment is
-- mandatory and the enrol screens are the only thing reachable below it.
-- Edge functions and the cron hold the service key, which bypasses RLS
-- entirely, so none of them is affected. The tenant payment page is anon and
-- reaches none of these tables. The full suite is the proof, not this
-- paragraph.
--
-- Extends the isolation suite: supabase/tests/tenant_isolation.test.sql
-- asserts both that an aal1 admin sees nothing and that no rate moves.

-- WRITTEN OUT ONE TABLE AT A TIME, not as a loop over an array.
--
-- The first version of this migration was a `do $$ ... execute format(...)`
-- loop, which is nine lines instead of forty and which `npm run drift`
-- cannot read: the drift model computes the final schema from the FILES by
-- static analysis, so it saw no policies at all and reported all nine as
-- "on dev, not in the files". That is the blind spot decision D7 was about,
-- and a check with a blind spot reads exactly like a check that passes.
--
-- So the verbose form is the correct one here. The drift check is one of the
-- five suites that now define "secure", and a security migration it cannot
-- see is worse than a longer file.


-- The money.

alter table public.pricing_agreements enable row level security;
drop policy if exists require_aal2 on public.pricing_agreements;
create policy require_aal2 on public.pricing_agreements as restrictive for all to authenticated
  using (public.is_aal2()) with check (public.is_aal2());

alter table public.pricing_agreement_bands enable row level security;
drop policy if exists require_aal2 on public.pricing_agreement_bands;
create policy require_aal2 on public.pricing_agreement_bands as restrictive for all to authenticated
  using (public.is_aal2()) with check (public.is_aal2());

alter table public.commission_tiers enable row level security;
drop policy if exists require_aal2 on public.commission_tiers;
create policy require_aal2 on public.commission_tiers as restrictive for all to authenticated
  using (public.is_aal2()) with check (public.is_aal2());

alter table public.commission_statement_refs enable row level security;
drop policy if exists require_aal2 on public.commission_statement_refs;
create policy require_aal2 on public.commission_statement_refs as restrictive for all to authenticated
  using (public.is_aal2()) with check (public.is_aal2());

-- The application's children, which carry the tenant's own details.

alter table public.application_commission_lines enable row level security;
drop policy if exists require_aal2 on public.application_commission_lines;
create policy require_aal2 on public.application_commission_lines as restrictive for all to authenticated
  using (public.is_aal2()) with check (public.is_aal2());

alter table public.application_delivery_contacts enable row level security;
drop policy if exists require_aal2 on public.application_delivery_contacts;
create policy require_aal2 on public.application_delivery_contacts as restrictive for all to authenticated
  using (public.is_aal2()) with check (public.is_aal2());

alter table public.application_documents enable row level security;
drop policy if exists require_aal2 on public.application_documents;
create policy require_aal2 on public.application_documents as restrictive for all to authenticated
  using (public.is_aal2()) with check (public.is_aal2());

alter table public.application_eligibility_payments enable row level security;
drop policy if exists require_aal2 on public.application_eligibility_payments;
create policy require_aal2 on public.application_eligibility_payments as restrictive for all to authenticated
  using (public.is_aal2()) with check (public.is_aal2());

alter table public.tenancies enable row level security;
drop policy if exists require_aal2 on public.tenancies;
create policy require_aal2 on public.tenancies as restrictive for all to authenticated
  using (public.is_aal2()) with check (public.is_aal2());
