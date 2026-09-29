-- A STATEMENT REFERENCE IS A COMMERCIAL ARTEFACT, SO IT IS DIRECTOR-LEVEL.
--
-- Security backlog B7, fixed in passing while working on the statement cron.
--
-- The family is three tables and they did not agree with each other:
--
--   pricing_agreements        restrictive pa_commission_readers_only
--                             using may_see_commission()
--   pricing_agreement_bands   restrictive pab_commission_readers_only
--                             using may_see_commission()
--   commission_statement_refs nothing. One permissive SELECT that tests
--                             REACH -- app_may_reach_agency and friends --
--                             and never capability.
--
-- So a Manager, who by definition does not hold sees_commission, could read
-- the statement references of any agency they reach, including their own.
-- Measured on dev before this migration: count 1 where it should be 0.
--
-- WHAT IT ACTUALLY LEAKS, stated plainly so the severity is not overstated:
-- the reference string and the payee key. No amounts, no rates, no lines.
-- What it tells a Manager is that a statement exists for their agency and
-- what its number is. That is why it was a backlog item rather than a
-- critical, and why it is worth fixing anyway: rule 3 is that anything
-- stating commercial business tests the CAPABILITY and not the role, and two
-- of the three tables in this family already did.
--
-- RESTRICTIVE, not a rewrite of the permissive policy. The permissive one
-- answers "which parties' references may this caller see at all", which is
-- still the right question and is unchanged. This adds the second question,
-- "may this caller see commercial figures", the same way and in the same
-- shape as its two siblings -- so the three now read alike, which is most of
-- the value.
--
-- Extends the isolation suite: supabase/tests/tenant_isolation.test.sql,
-- where the refusal AND the Director's continued access are both asserted.
-- A capability test that locked out the Director too would pass the first
-- assertion and be a worse bug than the one it fixed.

alter table public.commission_statement_refs enable row level security;

drop policy if exists csr_commission_readers_only on public.commission_statement_refs;
create policy csr_commission_readers_only
  on public.commission_statement_refs
  as restrictive for all to authenticated
  using (public.may_see_commission());

comment on table public.commission_statement_refs is
  'STMT-YYYY-MM-NNNN, one per payee per month, sequential and stable across '
  'renames. Readable only by a caller who may see commission figures, the '
  'same restriction pricing_agreements and pricing_agreement_bands carry: a '
  'reference is a commercial artefact even though it states no amount.';
