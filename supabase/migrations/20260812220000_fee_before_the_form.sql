-- ===========================================================================
-- The application fee sits BETWEEN the basics and the rest of the form, and
-- paying it is not the same event as going to the referencing partner.
--
-- WHAT I HAD WRONG
-- record_eligibility_payment moved draft -> referencing, on the assumption that
-- the fee was taken when the application was sent for referencing. It is not.
-- The real order is:
--
--   register  ->  basic details  ->  PAY  ->  the rest of the form  ->  sent
--
-- The fee is taken after the basics because that is when somebody has committed
-- enough to be worth charging, and before the bulk of the form because the
-- sections after it are locked until it clears. Sending to the partner happens
-- later, when the form is finished, and that is a separate act.
--
-- Conflating the two meant an application sat in 'referencing', which means
-- "with the provider", while the tenant still had three years of address
-- history to type. Every surface reading that status would have been wrong
-- about where the application actually was.
--
-- WHAT CHANGES
--   paying the fee     records a payment and moves NO status. draft stays draft.
--   submitting         moves draft -> referencing, and refuses unless the fee
--                      has cleared, the history covers three years, and the
--                      completeness rules are met.
--
-- No new status was needed, which is the useful part: "has paid the fee" is a
-- row in application_eligibility_payments, and a fact does not need to be a
-- state. Adding a fifth status would have put another value into every negative
-- predicate in the system for something a join already answers.
--
-- THE REFERRAL PATH IS UNTOUCHED. It never enters draft, never has an
-- eligibility payment, and neither function below is on its path.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Paying records a payment. That is all it does.
-- ---------------------------------------------------------------------------
create or replace function public.record_eligibility_payment(
  p_application uuid,
  p_amount numeric,
  p_session text,
  p_payment_intent text,
  p_livemode boolean
) returns public.application_eligibility_payments
language plpgsql security definer set search_path to ''
as $function$
declare a public.applications; r public.application_eligibility_payments;
begin
  select * into a from public.applications where id = p_application;
  if not found then
    raise exception 'Application % not found', p_application using errcode = '22023';
  end if;

  if a.livemode is distinct from p_livemode then
    raise exception 'Eligibility payment livemode does not match the application'
      using errcode = '22023';
  end if;

  if a.referencing_mode <> 'opndoor_referenced' then
    raise exception 'Application % is not on a rail that takes an eligibility fee', p_application
      using errcode = '22023';
  end if;

  insert into public.application_eligibility_payments
    (application_id, amount, stripe_checkout_session_id, stripe_payment_intent_id, livemode)
  values (p_application, p_amount, p_session, p_payment_intent, p_livemode)
  on conflict (application_id) do update
    set stripe_checkout_session_id = coalesce(public.application_eligibility_payments.stripe_checkout_session_id,
                                              excluded.stripe_checkout_session_id)
  returning * into r;

  -- NO STATUS CHANGE. Paying unlocks the rest of the form; it does not send
  -- anything to anybody. The move to 'referencing' belongs to submission, which
  -- is a decision the tenant makes when they have finished typing.
  return r;
end $function$;

comment on function public.record_eligibility_payment(uuid, numeric, text, text, boolean) is
  'Records the application fee and changes NO status. Paying unlocks the rest of the form; it does not send the application anywhere. Writes no paid_at and never status paid, so no money surface counts it as the guarantee fee.';

-- ---------------------------------------------------------------------------
-- 2. Has the fee cleared? One question, one place.
-- ---------------------------------------------------------------------------
create or replace function public.eligibility_fee_paid(p_application uuid)
returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.application_eligibility_payments e
    where e.application_id = p_application
  )
$$;

revoke all on function public.eligibility_fee_paid(uuid) from public, anon;
grant execute on function public.eligibility_fee_paid(uuid) to authenticated, service_role;

comment on function public.eligibility_fee_paid(uuid) is
  'Whether the application fee has cleared. A row in the ledger, written by the Stripe webhook, so this is true only after Stripe confirmed it and never because a browser said so. The sections after the fee are locked on this.';

-- ---------------------------------------------------------------------------
-- 3. Submission. The gate, in SQL, so the client is not the thing enforcing it.
--
-- "Nothing goes to the partner until it clears" is only true if the server
-- refuses. A locked tab in a browser is a suggestion.
-- ---------------------------------------------------------------------------
create or replace function public.submit_application_for_referencing(p_application uuid)
returns public.applications
language plpgsql security definer set search_path to ''
as $function$
declare a public.applications; v_months int; v_missing text := '';
begin
  select * into a from public.applications where id = p_application;
  if not found then raise exception 'Application % not found', p_application using errcode = '22023'; end if;

  if a.status <> 'draft' then
    raise exception 'This application has already been sent.' using errcode = '42501';
  end if;

  -- THE FEE. First, because it is the one somebody might try to route around.
  if not public.eligibility_fee_paid(p_application) then
    raise exception 'The application fee has not been paid.' using errcode = '42501';
  end if;

  if coalesce(btrim(a.tenant_title), '') = '' then v_missing := v_missing || 'title, '; end if;
  if a.tenant_dob is null                     then v_missing := v_missing || 'date of birth, '; end if;
  if coalesce(btrim(a.tenant_phone), '') = '' then v_missing := v_missing || 'phone, '; end if;
  if coalesce(a.monthly_rent, 0) <= 0         then v_missing := v_missing || 'monthly rent, '; end if;
  if a.tenancy_start is null                  then v_missing := v_missing || 'tenancy start date, '; end if;
  if v_missing <> '' then
    raise exception 'Still needed: %', left(v_missing, length(v_missing) - 2) using errcode = '23502';
  end if;

  v_months := public.address_history_months(p_application);
  if v_months < 36 then
    raise exception 'We need three years of address history. You have given us % months.', v_months
      using errcode = '23502';
  end if;

  if not exists (select 1 from public.application_incomes i
                  where i.application_id = p_application and not i.is_additional) then
    raise exception 'We need at least one main income.' using errcode = '23502';
  end if;

  update public.applications set status = 'referencing' where id = p_application;
  update public.application_profiles
     set completed_at = coalesce(completed_at, now()), updated_at = now()
   where application_id = p_application;

  insert into public.activity_log (application_id, kind, message, actor)
  values (p_application, 'sent_for_referencing',
          'Application completed and sent for referencing.', 'Tenant');

  select * into a from public.applications where id = p_application;
  return a;
end $function$;

revoke all on function public.submit_application_for_referencing(uuid) from public, anon, authenticated;
grant execute on function public.submit_application_for_referencing(uuid) to service_role;

comment on function public.submit_application_for_referencing(uuid) is
  'Moves draft -> referencing, and refuses without the fee, the three years of history, a main income and the completeness fields. Enforced here rather than in the browser: "nothing goes to the partner until the fee clears" is only true if the server says no.';

-- Nothing in flight is left in a state that no longer means what it says.
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from public.applications a
  where a.status = 'referencing'
    and a.referencing_mode = 'opndoor_referenced'
    and not public.eligibility_fee_paid(a.id);
  if v_bad > 0 then
    raise warning
      '% application(s) are in referencing without a recorded fee. They were moved there by the previous record_eligibility_payment. Check them by hand.', v_bad;
  end if;
end $$;
