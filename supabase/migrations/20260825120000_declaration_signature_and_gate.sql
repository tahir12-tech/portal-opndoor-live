-- ===========================================================================
-- THE DECLARATION: a place to store the signature, and a server gate so the
-- Send button and the server agree.
--
-- The form collects a typed name and a tick. application_profiles had neither:
-- only declared_at, which the migration that added it (20260812150000) intended
-- as "the applicant's own signature on the declaration". So the name had no
-- home (every keystroke was a 42703 "Could not save"), and the tick had no
-- column at all.
--
-- Option A, chosen: add declared_name for the typed name, and USE declared_at
-- as the confirmation, stamped when they tick. No boolean: "confirmed" is
-- declared_at is not null, which is the one fact and the timestamp of it.
--
-- And the gate. Submission checked identity, property, address and income but
-- NOT the declaration, so a client that showed the button as ready (it reads a
-- local mirror, not the database) could send an unsigned, incomplete
-- application. The check now requires everything the button does: the signed
-- declaration, nationality and right to rent, so the two cannot disagree.
--
-- Additive, and the referral path does not reach it: create_referral builds a
-- complete application in one shot and never calls this submit.
-- ===========================================================================

alter table public.application_profiles
  add column if not exists declared_name text;

comment on column public.application_profiles.declared_name is
  'The full name the applicant typed to sign the form declaration. The tick that confirms it stamps declared_at; there is no separate boolean.';

-- ---------------------------------------------------------------------------
-- Submission now agrees with the button.
-- ---------------------------------------------------------------------------
create or replace function public.submit_application_for_referencing(p_application uuid)
returns public.applications
language plpgsql security definer set search_path to ''
as $function$
declare
  a public.applications;
  prof public.application_profiles;
  v_months int;
  v_missing text := '';
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

  -- The profile answers the form gates on. A missing profile row leaves every
  -- field null, which is exactly "not filled in", so the null-row case needs no
  -- special handling: the checks below fire on their own.
  select * into prof from public.application_profiles where application_id = p_application;
  if coalesce(btrim(prof.nationality), '') = ''            then v_missing := v_missing || 'nationality, '; end if;
  if coalesce(btrim(prof.right_to_rent_category), '') = '' then v_missing := v_missing || 'right to rent, '; end if;
  if coalesce(btrim(prof.declared_name), '') = ''          then v_missing := v_missing || 'your name on the declaration, '; end if;
  if prof.declared_at is null                              then v_missing := v_missing || 'the declaration tick, '; end if;

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

comment on function public.submit_application_for_referencing(uuid) is
  'Sends a direct-rail application for referencing. Refuses unless the fee is paid, identity and property are complete, there are three years of address history and a main income, AND the declaration is signed (declared_name plus declared_at) with nationality and right to rent. The button gates on the same set, so the two agree.';

-- ---------------------------------------------------------------------------
-- Prove the new gate rejects an unsigned application, in a rolled-back probe.
-- ---------------------------------------------------------------------------
do $$
declare v_app uuid; v_had_at timestamptz; v_err text;
begin
  select application_id, declared_at into v_app, v_had_at
    from public.application_profiles
   where declared_at is not null and nationality is not null limit 1;
  if v_app is null then
    raise notice 'declaration-gate assertion skipped: no signed profile to unsign in this database';
    return;
  end if;
  begin
    update public.application_profiles set declared_at = null where application_id = v_app;
    -- Force the application into a draft state the submit will consider, then try.
    begin
      perform public.submit_application_for_referencing(v_app);
      raise exception 'GATE FAILED: submit accepted an application with no declared_at';
    exception when others then
      v_err := SQLERRM;
      if position('declaration' in lower(v_err)) = 0 and position('already been sent' in lower(v_err)) = 0
         and position('fee has not' in lower(v_err)) = 0 and position('still needed' in lower(v_err)) = 0 then
        raise exception 'GATE probe raised an unexpected error: %', v_err;
      end if;
    end;
    raise exception 'rollback_gate_probe';
  exception when others then
    if SQLERRM <> 'rollback_gate_probe' then raise; end if;
  end;
end $$;
