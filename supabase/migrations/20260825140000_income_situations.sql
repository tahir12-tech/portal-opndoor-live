-- ===========================================================================
-- The income step is not only a wage. On the direct rail Lettings in a Box make
-- the decision, so this step's job is to COLLECT the tenant's situation, not to
-- judge it. Three situations the wage columns could not hold get their own:
--
--   savings_amount     a savings-route applicant with capital and no income
--   maintenance_loan   a student's maintenance loan
--   family_support     money a student (or anyone) receives from family
--
-- Additive. save_row upserts the patch generically, so no function changes; a
-- situation that does not use a column simply never writes it. Retired keeps
-- pension_income and benefits reuse amount/amount_frequency, both of which
-- already exist.
-- ===========================================================================
alter table public.application_incomes
  add column if not exists savings_amount   numeric(12,2) check (savings_amount   is null or savings_amount   >= 0),
  add column if not exists maintenance_loan numeric(12,2) check (maintenance_loan is null or maintenance_loan >= 0),
  add column if not exists family_support   numeric(12,2) check (family_support   is null or family_support   >= 0);

comment on column public.application_incomes.savings_amount is
  'Capital for a savings-route applicant. The direct rail collects it; it does not gate on it.';
