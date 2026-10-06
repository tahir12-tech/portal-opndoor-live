-- ===========================================================================
-- What a tenant actually tells us, on the rails where we arrange the reference.
--
-- Encoded from the integration documents: the tabs are Basic Information,
-- Address (three years), Income (nine employment types, eighteen additional
-- income types), Nationality and Declaration.
--
-- ---------------------------------------------------------------------------
-- WHY PER-APPLICATION AND NOT PER-PERSON
-- ---------------------------------------------------------------------------
-- An applicant record holds who somebody is. This holds what was true when they
-- applied. A tenant who applies twice a year apart has one identity and two
-- sets of income, addresses and adverse-credit answers, and a reference is
-- assessed against the set that was submitted with it. Hanging income off the
-- applicant would silently rewrite the basis of a completed reference the next
-- time they updated their job.
--
-- ---------------------------------------------------------------------------
-- WHY SEPARATE TABLES AND NOT COLUMNS ON applications
-- ---------------------------------------------------------------------------
-- Three reasons, in order of weight. The referral path would carry sixty
-- permanently-null columns it will never use. Every new column on that table
-- now needs its own grant because the table grant was revoked per column
-- (20260811180000), so sixty columns is sixty grants and sixty chances to
-- forget one. And addresses and incomes are lists, not fields: three years of
-- address history is a variable number of rows and cannot be flattened without
-- inventing address_1_postcode through address_5_postcode.
--
-- The referral path never writes or reads any of this. Rightmove applications
-- have no row in any of these tables, which is what makes the whole piece
-- additive.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The single-answer part of the form.
-- ---------------------------------------------------------------------------
create table if not exists public.application_profiles (
  application_id uuid primary key references public.applications(id) on delete cascade,

  other_names        boolean,
  maiden_name        text,
  marital_status     text,
  nationality        text,

  -- Right to rent, captured as the applicant's own declared category rather
  -- than a derived status. What follows from it is the provider's business.
  right_to_rent_category text,

  -- Adverse credit. Each headline is a yes/no and the detail only exists when
  -- the answer is yes, which is why every detail column is nullable and the
  -- headline is not inferred from them: "no CCJs" and "did not answer" are
  -- different states and a null count cannot tell them apart.
  adverse_credit     boolean,
  ccjs               boolean,
  ccjs_count         int check (ccjs_count is null or ccjs_count >= 0),
  ccjs_total_value   numeric(12,2) check (ccjs_total_value is null or ccjs_total_value >= 0),
  ccjs_most_recent   date,
  bankrupt           boolean,
  bankrupt_date      date,
  iva                boolean,
  iva_date           date,
  iva_value          numeric(12,2) check (iva_value is null or iva_value >= 0),

  declaration_note   text,
  -- The applicant's own signature on the declaration. PandaDoc signs the deed;
  -- this is the form declaration, which is a different act at a different time.
  declared_at        timestamptz,

  -- Set when the applicant says they have finished, not when the last field is
  -- filled. Submission is a decision.
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint profile_ccj_detail   check (ccjs is not true or ccjs_count is not null or ccjs_most_recent is not null),
  constraint profile_bankrupt_detail check (bankrupt is not true or bankrupt_date is not null),
  constraint profile_iva_detail   check (iva is not true or iva_date is not null or iva_value is not null)
);

-- ---------------------------------------------------------------------------
-- 2. Address history. Three years, oldest last.
-- ---------------------------------------------------------------------------
create table if not exists public.application_addresses (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  -- 0 is current, 1 is the one before, and so on. Explicit because "three years
  -- of history" is a rule about the SEQUENCE and cannot be checked without one.
  seq            int not null check (seq >= 0),

  in_uk          boolean not null default true,
  flat_number    text,
  house_number   text,
  house_name     text,
  address_1      text,
  address_2      text,
  city           text,
  county         text,
  postcode       text,

  residency_type text check (residency_type in (
    'renting','council_or_housing_association','living_with_family_or_friends',
    'student_accommodation','homeowner','other')),
  residency_other_detail text,

  moved_in_month int  check (moved_in_month between 1 and 12),
  moved_in_year  int  check (moved_in_year between 1900 and 2200),

  -- Only meaningful for the current address, which is why it is nullable
  -- rather than defaulted.
  proof_type     text,

  -- Not applicable is a real answer, distinct from no.
  rental_arrears text check (rental_arrears in ('yes','no','not_applicable')),
  rental_arrears_detail text,

  created_at     timestamptz not null default now(),
  unique (application_id, seq)
);

create index if not exists application_addresses_app_idx on public.application_addresses (application_id, seq);

-- Does the history actually cover three years? The rule the form enforces by
-- looping, expressed once so the server can answer it too.
create or replace function public.address_history_months(p_application uuid)
returns int
language sql stable security definer set search_path to '' as $$
  select coalesce(
    greatest(0, (extract(year  from age(now(), make_date(min(moved_in_year), min(moved_in_month), 1))) * 12
               + extract(month from age(now(), make_date(min(moved_in_year), min(moved_in_month), 1))))::int),
    0)
  from public.application_addresses
  where application_id = p_application
    and moved_in_year is not null and moved_in_month is not null
$$;

comment on function public.address_history_months(uuid) is
  'Months covered by the declared address history, from the earliest move-in date. The form loops until this reaches 36; this is the same question answerable server side, because a form that decides its own completeness cannot be checked.';

-- ---------------------------------------------------------------------------
-- 3. Income. One row per source, main employment and additional alike.
--
-- The type list is the document's, verbatim. A CHECK rather than a lookup table
-- because these are a closed vocabulary that changes when the product changes,
-- not data somebody administers.
-- ---------------------------------------------------------------------------
create table if not exists public.application_incomes (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  seq            int not null default 0,

  income_type text not null check (income_type in (
    'permanent','self_employed','contract','temporary','retired','homemaker',
    'unemployed_or_other','zero_hours','student',
    -- additional income sources
    'second_job','bonus','commission','overtime','pension','working_tax_credit',
    'child_tax_credit','disability_or_pip','child_maintenance','bursary',
    'stipends','sponsorship','carers_allowance','housing_benefit',
    'income_support','jobseekers_allowance','universal_credit','student_loan')),

  is_additional  boolean not null default false,

  start_date     date,
  end_date       date,

  employer_name  text,
  employer_in_uk boolean,
  employer_address text,
  employer_postcode text,
  job_title      text,

  referee_name   text,
  referee_email  text,
  referee_phone  text,

  pay_basis      text check (pay_basis in ('annual_salary','hourly_rate')),
  annual_salary  numeric(12,2) check (annual_salary is null or annual_salary >= 0),
  hourly_rate    numeric(10,2) check (hourly_rate is null or hourly_rate >= 0),
  weekly_hours   numeric(6,2)  check (weekly_hours is null or weekly_hours >= 0),

  -- self employed
  has_accountant   boolean,
  accountant_name  text,
  accountant_email text,

  -- retired
  pension_income numeric(12,2) check (pension_income is null or pension_income >= 0),

  -- employment quality questions, which the provider weighs
  probation           boolean,
  probation_months    int check (probation_months is null or probation_months >= 0),
  disciplinary        text check (disciplinary in ('yes','no','dont_know')),
  foreseeable_future  text check (foreseeable_future in ('yes','no','dont_know')),

  -- additional income only
  guaranteed        boolean,
  amount            numeric(12,2) check (amount is null or amount >= 0),
  amount_frequency  text check (amount_frequency in ('weekly','monthly','annually')),

  created_at timestamptz not null default now(),
  unique (application_id, seq)
);

create index if not exists application_incomes_app_idx on public.application_incomes (application_id, seq);

-- The number the eligibility rules need, from whatever shape the answers took.
-- One place, because "annual income" is computed four different ways depending
-- on how somebody is paid and two copies of that arithmetic is two answers.
create or replace function public.application_annual_income(p_application uuid)
returns numeric
language sql stable security definer set search_path to '' as $$
  select coalesce(sum(
    case
      when i.pay_basis = 'annual_salary' then coalesce(i.annual_salary, 0)
      when i.pay_basis = 'hourly_rate'   then coalesce(i.hourly_rate, 0) * coalesce(i.weekly_hours, 0) * 52
      when i.income_type = 'retired'     then coalesce(i.pension_income, 0) * 12
      when i.is_additional then
        case i.amount_frequency
          when 'weekly'   then coalesce(i.amount, 0) * 52
          when 'monthly'  then coalesce(i.amount, 0) * 12
          when 'annually' then coalesce(i.amount, 0)
          else 0
        end
      else coalesce(i.annual_salary, 0)
    end
  ), 0)
  from public.application_incomes i
  where i.application_id = p_application
    -- Income that is not guaranteed is declared but not counted. The provider
    -- may take a view on it; our own prequalification does not get to.
    and (not i.is_additional or i.guaranteed is not false)
$$;

comment on function public.application_annual_income(uuid) is
  'Total annual income from all declared sources, normalising hourly, monthly and weekly figures. Non-guaranteed additional income is declared but not counted towards the prequalification. One implementation because two would be two answers.';

-- ---------------------------------------------------------------------------
-- 4. RLS. Same posture as every other tenant-owned table: no policies, reached
--    through a service-role Edge Function. Staff read the SUMMARY of this from
--    the application, not the raw form.
-- ---------------------------------------------------------------------------
alter table public.application_profiles  enable row level security;
alter table public.application_addresses enable row level security;
alter table public.application_incomes   enable row level security;

revoke all on function public.address_history_months(uuid) from public, anon;
revoke all on function public.application_annual_income(uuid) from public, anon;
grant execute on function public.address_history_months(uuid) to service_role;
grant execute on function public.application_annual_income(uuid) to service_role;

comment on table public.application_profiles is
  'The single-answer part of the tenant form, per application rather than per person: a reference is assessed against what was true when it was submitted. No RLS policies; reached through the tenant Edge Function.';
