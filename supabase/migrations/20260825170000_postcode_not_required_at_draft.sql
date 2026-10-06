-- ===========================================================================
-- A draft may hold a half-typed postcode.
--
-- applications_postcode_valid was a plain regex CHECK on every write. The
-- Property step autosaves each keystroke, so "S", "SW", "SW1" each reached the
-- column and each failed the regex, and the tenant got "Could not save. We will
-- try again as you type." on a postcode they had not finished typing.
--
-- Same shape as the phone (20260825160000), property and rent relaxations
-- (20260821020000): the requirement is real, it just belongs at SUBMISSION, not
-- at every keystroke. Drafts are exempt; a submitted row still needs a valid UK
-- postcode. create_referral validates the postcode with the same regex before
-- its status='sent' insert, so the referral rail is unaffected.
-- ===========================================================================
alter table public.applications drop constraint applications_postcode_valid;
alter table public.applications add constraint applications_postcode_valid
  check (status = 'draft' or prop_postcode ~* '^[a-z]{1,2}[0-9][a-z0-9]? ?[0-9][a-z]{2}$');

-- ---------------------------------------------------------------------------
-- The completeness guard already fires on the draft -> referencing flip and
-- names what is missing. Now that phone and postcode are only format-checked at
-- submission, it also checks their SHAPE, so a badly formed value that survived
-- in a draft (a phone with no digits, a half-typed postcode) leaves draft with a
-- readable line instead of the raw check-constraint violation. It mirrors the
-- two draft-exempt CHECKs exactly, so the trigger and the constraints agree and
-- the constraint never fires first. Presence logic is unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.assert_application_complete() returns trigger
language plpgsql security definer set search_path to '' as $function$
declare v_missing text := '';
begin
  -- Drafts are exempt, and only drafts.
  if new.status = 'draft' then return new; end if;

  if coalesce(btrim(new.tenant_title), '') = '' then v_missing := v_missing || 'title, '; end if;
  if new.tenant_dob is null                     then v_missing := v_missing || 'date of birth, '; end if;
  if coalesce(btrim(new.tenant_phone), '') = '' then v_missing := v_missing || 'phone, '; end if;

  if coalesce(btrim(new.prop_addr1), '')    = '' then v_missing := v_missing || 'property address, '; end if;
  if coalesce(btrim(new.prop_city), '')     = '' then v_missing := v_missing || 'town or city, '; end if;
  if coalesce(btrim(new.prop_postcode), '') = '' then v_missing := v_missing || 'postcode, '; end if;
  if coalesce(new.monthly_rent, 0) <= 0         then v_missing := v_missing || 'monthly rent, '; end if;

  if v_missing <> '' then
    raise exception 'Application is missing: %', left(v_missing, length(v_missing) - 2)
      using errcode = '23502';
  end if;

  -- Present, but is it real? These mirror the two draft-exempt CHECKs so
  -- submission gives a readable line, not the raw constraint violation.
  if new.tenant_phone !~ '[0-9]' then
    raise exception 'Your mobile number needs to be a real phone number.' using errcode = '23514';
  end if;
  if new.prop_postcode !~* '^[a-z]{1,2}[0-9][a-z0-9]? ?[0-9][a-z]{2}$' then
    raise exception 'That property postcode is not a valid UK postcode.' using errcode = '23514';
  end if;

  return new;
end $function$;

comment on function public.assert_application_complete() is
  'Everything an application needs before it leaves draft: the tenant''s title, date of birth and a phone that contains a digit, and the property address, town, a valid UK postcode and a monthly rent above zero. Drafts are exempt, because a draft is allowed to be incomplete.';

-- ---------------------------------------------------------------------------
-- Prove it: a draft takes a half-typed postcode, and submission refuses both a
-- partial postcode and a digitless phone with a readable message, not a raw
-- constraint violation. Rolled back.
-- ---------------------------------------------------------------------------
do $$
declare v_app uuid; v_applicant uuid; v_err text; v_left boolean;
begin
  select id into v_applicant from public.applicants limit 1;
  if v_applicant is null then raise notice 'postcode probe skipped: no applicant'; return; end if;

  select id into v_app from public.create_direct_application(p_applicant := v_applicant);
  -- Fill the guard's whole presence set with valid values, still a draft.
  update public.applications set
     tenant_title = 'Mr', tenant_dob = '1990-01-01', tenant_phone = '07700 900123',
     prop_addr1 = '1 Test Street', prop_city = 'Sheffield', prop_postcode = 'S1 1AA', monthly_rent = 1000
   where id = v_app;

  -- A half-typed postcode saves fine on a draft (the reported bug).
  update public.applications set prop_postcode = 'SW1' where id = v_app;

  -- ...but cannot leave draft, and the message is readable.
  v_left := false;
  begin
    update public.applications set status = 'referencing' where id = v_app;
    v_left := true;
  exception when others then v_err := SQLERRM;
  end;
  if v_left then raise exception 'PROBE FAIL: a partial postcode left draft'; end if;
  if position('valid UK postcode' in v_err) = 0 then
    raise exception 'PROBE FAIL: partial postcode gave a raw message: %', v_err;
  end if;

  -- A digitless phone: same, readable refusal.
  update public.applications set prop_postcode = 'S1 1AA', tenant_phone = 'not a phone' where id = v_app;
  v_left := false;
  begin
    update public.applications set status = 'referencing' where id = v_app;
    v_left := true;
  exception when others then v_err := SQLERRM;
  end;
  if v_left then raise exception 'PROBE FAIL: a digitless phone left draft'; end if;
  if position('real phone number' in v_err) = 0 then
    raise exception 'PROBE FAIL: digitless phone gave a raw message: %', v_err;
  end if;

  raise exception 'rollback_postcode_probe';
exception when others then
  if SQLERRM <> 'rollback_postcode_probe' then raise; end if;
end $$;
