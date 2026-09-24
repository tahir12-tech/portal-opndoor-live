-- M1. THE FEE BECOMES A CONCEPT, AND NOTHING PRICES DIFFERENTLY.
--
-- There is no fee in this system. The guarantee fee IS monthly_rent: it is
-- charged as Math.round(rent * 100) in create-referral and twice in payment-page,
-- and every commission figure in the product is rent * rate. That works only
-- while the fee is universally one month's rent, which deal-shape pricing ends.
--
-- So the fee becomes a real, snapshotted value BEFORE any pricing varies. This
-- migration is deliberately inert: every existing row is backfilled to exactly
-- what it already charged, and create_referral writes the same number it would
-- have charged anyway. The point of doing it as its own step is that the risky
-- part — teaching a dozen consumers to read a fee instead of a rent — is paid
-- down while the two values are provably identical.
--
--   fee_amount       what was actually charged for the guarantee.
--   fee_basis_weeks  WHY it was that. 4.35 = 52/12, one month expressed in weeks,
--                    so "3 weeks" and "5 weeks" later sit on the same scale
--                    rather than being a different kind of number.
--
-- A NOTE ON 4.35. One month is 52/12 = 4.3333... weeks. The stored basis is the
-- explanation, not the multiplier: fee_amount is monthly_rent exactly, never
-- recomputed from the basis, so no rounding is introduced anywhere. When a real
-- 3-week agreement arrives it will set fee_amount from the basis; until then the
-- basis is documentation of what already happened.
alter table public.applications
  add column if not exists fee_amount numeric(10,2),
  add column if not exists fee_basis_weeks numeric(4,2);

alter table public.applications drop constraint if exists applications_fee_amount_check;
alter table public.applications add constraint applications_fee_amount_check
  check (fee_amount is null or fee_amount >= 0);

comment on column public.applications.fee_amount is
  'The guarantee fee actually charged, snapshotted at creation and never recomputed. Equal to monthly_rent on every application created before deal-shape pricing.';
comment on column public.applications.fee_basis_weeks is
  'Why the fee was that amount, in weeks of rent. 4.35 (52/12) is one month. Documentation of the basis: fee_amount is authoritative and is never derived from this.';

-- BACKFILL: exactly what each row already charged. No arithmetic.
update public.applications
   set fee_amount = monthly_rent,
       fee_basis_weeks = 4.35
 where fee_amount is null;

-- The applications table has PER-COLUMN grants (20260811180000 took the rate
-- columns off the table grant entirely), so a new column is invisible to the
-- client until granted. fee_amount is no more sensitive than monthly_rent, which
-- is already readable, and the client needs it to show a fee at all.
grant select (fee_amount)      on public.applications to authenticated;
grant select (fee_basis_weeks) on public.applications to authenticated;

-- ---------------------------------------------------------------------------
-- INERTNESS GUARD. Every row must still carry exactly the fee it charged.
-- ---------------------------------------------------------------------------
do $$
declare v_bad int; v_null int;
begin
  select count(*) into v_bad
  from public.applications
  where fee_amount is distinct from monthly_rent;

  select count(*) into v_null from public.applications where fee_amount is null;

  if v_bad > 0 or v_null > 0 then
    raise exception 'REFUSING: % row(s) whose fee differs from their rent, % with no fee. The backfill must be exact.',
      v_bad, v_null;
  end if;
  raise notice 'Fee backfilled on % application(s), every one equal to its rent.',
    (select count(*) from public.applications);
end $$;
