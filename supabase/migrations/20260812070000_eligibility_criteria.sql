-- ===========================================================================
-- The eligibility criteria, in one place, in SQL.
--
-- WHERE THESE COME FROM
-- PARTNER-API.md open question 2 says the acceptance criteria "have not been
-- written down anywhere, in the codebase or outside it", and calls it the
-- blocking item for pre_referenced_screened. That is why the partner API 501s
-- that mode rather than accepting everyone silently
-- (supabase/functions/_shared/partnerApplications.ts:360-373).
--
-- They now exist. The integration documents supplied by the developer who
-- maintains the existing platform state them, and this is that statement
-- encoded. Open question 2 is closed by this migration.
--
-- ---------------------------------------------------------------------------
-- THE RULES, VERBATIM FROM THE SOURCE
-- ---------------------------------------------------------------------------
--   1. Rent basis. Use the applicant's SHARE of the monthly rent where one is
--      given, otherwise the full monthly rent.
--   2. Credit score. If a score is supplied it must be at least 519. If none is
--      supplied the hurdle DROPS AWAY entirely, which is deliberate: a foreign
--      applicant with no UK credit file has no score and must not be failed for
--      the absence of one.
--   3. Income. A non-student must have annual income of at least 1.5x the
--      monthly rent basis, assessed monthly (annual / 12).
--   4. Students are exempt from the income rule. The conditional credit rule
--      still applies to them.
--
-- ---------------------------------------------------------------------------
-- WHY SQL AND NOT TYPESCRIPT
-- ---------------------------------------------------------------------------
-- Two callers need the identical answer and would otherwise each have their own
-- copy: the free prequalification on the rails we reference, and the screening
-- gate on the pre-referenced-screened rail. Two copies of a commercial rule is
-- two rules, and the day they disagree is the day somebody is declined by one
-- surface and accepted by another. Defect 19 in this repo is what a
-- TypeScript-only rule looks like after a year.
--
-- ---------------------------------------------------------------------------
-- IT IS VERSIONED, AND THE VERSION IS RETURNED
-- ---------------------------------------------------------------------------
-- A decision made under one set of rules must stay explainable after the rules
-- change. Every verdict carries the version that produced it, so "why was this
-- person declined in March" has an answer in September. Bump the constant and
-- add a row to the comment when the rules change; never edit a rule in place.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS IS NOT
-- ---------------------------------------------------------------------------
-- On the rails where we arrange the reference, this is NOT the decision. The
-- referencing provider approves or declines and that verdict stands. This runs
-- BEFORE them, on what the tenant has told us, and it can only ever say
-- "nothing here rules you out". It cannot see a credit file, which is the most
-- common reason a marginal applicant actually fails. The outcome name says so:
-- 'not_ruled_out', never 'eligible'. A surface that renders it as "you qualify"
-- is a defect.
-- ===========================================================================

create or replace function public.eligibility_criteria_version()
returns text language sql immutable set search_path to '' as $$ select '2026-08-12.1' $$;

comment on function public.eligibility_criteria_version() is
  'The criteria version stamped onto every verdict. 2026-08-12.1: credit floor 519 when a score is present, income 1.5x the monthly rent basis for non-students, students income-exempt, share of rent used where given. Bump on any rule change; never edit a rule in place.';

-- ---------------------------------------------------------------------------
-- The assessment.
--
-- Every input is nullable on purpose. The whole point of rule 2 is that a
-- MISSING credit score is different from a low one, and a function that took a
-- NOT NULL score could not express that difference.
--
-- Reason codes are drawn from the vocabulary in PARTNER-API.md section 15.4 and
-- nowhere else. That vocabulary is deliberately coarser than any provider's
-- internal set so the public contract does not leak a provider's taxonomy.
-- ---------------------------------------------------------------------------
create or replace function public.assess_eligibility(
  p_monthly_rent   numeric,          -- the full rent for the property
  p_share_amount   numeric,          -- this applicant's share, when apportioned
  p_credit_score   int,              -- null means no UK credit file
  p_annual_income  numeric,
  p_is_student     boolean default false
) returns table (
  outcome        text,               -- 'not_ruled_out' | 'ruled_out'
  reason         text,               -- null when not ruled out
  rent_basis     numeric,            -- what affordability was actually judged against
  income_needed  numeric,            -- the monthly income the basis required
  version        text
)
language plpgsql immutable set search_path to ''
as $function$
declare
  v_basis   numeric;
  v_needed  numeric;
  v_monthly numeric;
begin
  version := public.eligibility_criteria_version();

  -- Rule 1. The share where there is one, the full rent otherwise. A share of
  -- zero is a real answer, not a missing one: on a joint tenancy one applicant
  -- may carry nothing and be covered by the others, so the test is IS NOT NULL
  -- rather than truthiness.
  v_basis := case when p_share_amount is not null then p_share_amount else p_monthly_rent end;
  rent_basis := v_basis;

  if v_basis is null or v_basis < 0 then
    outcome := 'ruled_out'; reason := 'declined_other'; income_needed := null;
    return next; return;
  end if;

  v_needed := round(v_basis * 1.5, 2);
  income_needed := v_needed;

  -- Rule 2. Conditional by design. No score is not a failure.
  if p_credit_score is not null and p_credit_score < 519 then
    outcome := 'ruled_out'; reason := 'adverse_credit';
    return next; return;
  end if;

  -- Rule 4 before rule 3: a student is exempt from the income test entirely,
  -- having already passed the conditional credit test above.
  if coalesce(p_is_student, false) then
    outcome := 'not_ruled_out'; reason := null;
    return next; return;
  end if;

  -- Rule 3. Annual stated, monthly assessed.
  if p_annual_income is null then
    outcome := 'ruled_out'; reason := 'affordability_below_threshold';
    return next; return;
  end if;

  v_monthly := p_annual_income / 12.0;
  if v_monthly < v_needed then
    outcome := 'ruled_out'; reason := 'affordability_below_threshold';
    return next; return;
  end if;

  outcome := 'not_ruled_out'; reason := null;
  return next;
end $function$;

comment on function public.assess_eligibility(numeric, numeric, int, numeric, boolean) is
  'The documented acceptance criteria, one implementation for both the prequalification and the screened rail. Closes PARTNER-API.md open question 2. Outcome is not_ruled_out or ruled_out, never "eligible": on the rails we reference, the provider makes the decision and this cannot see a credit file.';

revoke all on function public.assess_eligibility(numeric, numeric, int, numeric, boolean) from public, anon;
grant execute on function public.assess_eligibility(numeric, numeric, int, numeric, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The group test, for joint tenancies.
--
-- Opndoor guarantees 100% of the tenancy, not a share of it. Applicants may
-- hold varying percentages, and the test is whether the GROUP covers the whole
-- rent, individually or between them. One applicant carrying the full rent
-- while another carries nothing passes, and each still holds the percentage
-- they were assigned.
--
-- Assessing each applicant against their OWN share is what makes that work
-- arithmetically: the zero-share applicant is judged against zero and passes,
-- and the shares summing to the rent is what makes the group cover 100%. This
-- is also why the shares must be assigned BEFORE the reference is requested
-- rather than after it comes back.
--
-- CAVEAT, AND IT IS THE OPEN QUESTION ON THIS RAIL. Where the provider returns
-- a per-applicant verdict rather than a capacity figure, this arithmetic can
-- only be done on what the applicant told US. Whether the provider assesses
-- against the share we send or against the full rent decides whether joint
-- tenancies work on the rails we reference at all. See HANDOVER open items.
-- ---------------------------------------------------------------------------
create or replace function public.assess_group_eligibility(
  p_monthly_rent numeric,
  p_shares       numeric[],          -- each applicant's share amount, same order
  p_incomes      numeric[],
  p_scores       int[],
  p_students     boolean[]
) returns table (
  outcome       text,
  reason        text,
  covered       numeric,             -- how much of the rent the passing members cover
  shortfall     numeric,
  member_count  int,
  version       text
)
language plpgsql immutable set search_path to ''
as $function$
declare
  i int;
  v_res record;
  v_covered numeric := 0;
  v_first_reason text := null;
begin
  version := public.eligibility_criteria_version();
  member_count := coalesce(array_length(p_shares, 1), 0);

  if member_count = 0 or p_monthly_rent is null then
    outcome := 'ruled_out'; reason := 'declined_other';
    covered := 0; shortfall := p_monthly_rent;
    return next; return;
  end if;

  for i in 1 .. member_count loop
    select * into v_res from public.assess_eligibility(
      p_monthly_rent,
      p_shares[i],
      case when p_scores   is null then null else p_scores[i]   end,
      case when p_incomes  is null then null else p_incomes[i]  end,
      case when p_students is null then false else coalesce(p_students[i], false) end
    );

    if v_res.outcome = 'not_ruled_out' then
      -- Only a member who clears their own share contributes it. A member who
      -- does not clear theirs contributes nothing rather than contributing
      -- partially, because a guarantee is not partially given.
      v_covered := v_covered + coalesce(p_shares[i], 0);
    elsif v_first_reason is null then
      v_first_reason := v_res.reason;
    end if;
  end loop;

  covered   := v_covered;
  shortfall := greatest(p_monthly_rent - v_covered, 0);

  if v_covered >= p_monthly_rent then
    -- The group covers the whole tenancy. Individual members may have been
    -- ruled out on their own share and that does not matter: the test is the
    -- group's, and this is the case where one applicant carries another.
    outcome := 'not_ruled_out'; reason := null;
  else
    outcome := 'ruled_out';
    reason  := coalesce(v_first_reason, 'affordability_below_threshold');
  end if;
  return next;
end $function$;

comment on function public.assess_group_eligibility(numeric, numeric[], numeric[], int[], boolean[]) is
  'The joint-tenancy group test: does the group cover 100% of the rent between them. Each member is judged against their own share, so a zero-share member passes and is carried. Individual failure does not fail the group as long as the shares that clear sum to the rent.';

revoke all on function public.assess_group_eligibility(numeric, numeric[], numeric[], int[], boolean[]) from public, anon;
grant execute on function public.assess_group_eligibility(numeric, numeric[], numeric[], int[], boolean[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The rules, executed. These run at migration time and fail the push rather
-- than shipping a criteria engine nobody has exercised.
-- ---------------------------------------------------------------------------
do $$
declare r record; g record;
begin
  -- No credit file: the hurdle drops away, income alone decides.
  select * into r from public.assess_eligibility(1000, null, null, 18000, false);
  if r.outcome <> 'not_ruled_out' then raise exception 'no-score applicant with 1.5x income should not be ruled out (got %/%)', r.outcome, r.reason; end if;

  -- Same applicant, one pound under the multiple.
  select * into r from public.assess_eligibility(1000, null, null, 17999, false);
  if r.reason <> 'affordability_below_threshold' then raise exception 'income just under 1.5x should be affordability_below_threshold (got %)', r.reason; end if;

  -- The credit floor, on the boundary and one below it.
  select * into r from public.assess_eligibility(1000, null, 519, 18000, false);
  if r.outcome <> 'not_ruled_out' then raise exception '519 is on the floor and passes'; end if;
  select * into r from public.assess_eligibility(1000, null, 518, 18000, false);
  if r.reason <> 'adverse_credit' then raise exception '518 is below the floor'; end if;

  -- Students: exempt from income, still subject to the conditional credit rule.
  select * into r from public.assess_eligibility(1000, null, null, 0, true);
  if r.outcome <> 'not_ruled_out' then raise exception 'a student is exempt from the income rule'; end if;
  select * into r from public.assess_eligibility(1000, null, 400, 0, true);
  if r.reason <> 'adverse_credit' then raise exception 'a student with a bad score is still ruled out'; end if;

  -- The share basis is used when present, so a shared rent is judged smaller.
  select * into r from public.assess_eligibility(2000, 500, null, 9000, false);
  if r.outcome <> 'not_ruled_out' then raise exception 'share basis should be used, not full rent'; end if;
  if r.rent_basis <> 500 then raise exception 'rent_basis should be the share (got %)', r.rent_basis; end if;

  -- THE CASE THE GROUP RULE EXISTS FOR: one applicant carries the whole rent,
  -- the other carries nothing, and both are held to the percentage assigned.
  select * into g from public.assess_group_eligibility(
    10000, array[10000, 0]::numeric[], array[200000, 0]::numeric[], null, array[false, false]);
  if g.outcome <> 'not_ruled_out' then
    raise exception 'a group where one member covers the whole rent must pass (got %, shortfall %)', g.outcome, g.shortfall;
  end if;

  -- And the case it must not wave through: nobody covers their share.
  select * into g from public.assess_group_eligibility(
    10000, array[5000, 5000]::numeric[], array[1000, 1000]::numeric[], null, array[false, false]);
  if g.outcome <> 'ruled_out' then raise exception 'a group covering none of the rent must be ruled out'; end if;
end $$;
