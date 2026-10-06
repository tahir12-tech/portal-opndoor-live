-- Structured field errors for the partner API, sharing one copy of the rules.
--
-- THE PROBLEM. create_referral raises free text: 'Missing or invalid: title,
-- phone', or one of four standalone sentences, with a SQLSTATE as the only
-- machine-readable signal. A form can show that to a person. An API cannot: a
-- partner needs to know WHICH field failed and WHY, as codes their software can
-- branch on, not prose it would have to parse.
--
-- THE OBVIOUS WRONG ANSWER is to validate again in TypeScript. That is a second
-- copy of eleven field rules and four combined rules, and the two would drift:
-- the portal would start accepting what the API rejects, or worse the reverse.
-- 20260807120000 extracted the rules precisely so that could not happen.
--
-- SO: the rules move down one more level, into a function that RETURNS the
-- errors instead of raising them, and both callers are built on it.
--
--   referral_field_errors()   returns a jsonb array of structured errors. The
--                             single source of truth. Used directly by the API.
--   assert_referral_valid()   calls it and reconstructs the exact legacy raises,
--                             so create_referral's behaviour is unchanged.
--
-- BEHAVIOUR PRESERVED EXACTLY. The field checks run in their original order and
-- are reported together; the combined rules run only when every field passed,
-- and the first one to fail wins. That mirrors the original control flow, where
-- the array was raised before the combined rules were reached. Messages and
-- SQLSTATEs are byte-identical. Verified by calling create_referral with bad
-- payloads and comparing the error text, not by inspection.

-- ---------- the rules, one copy ----------
create or replace function public.referral_field_errors(
  p_branch uuid,
  p_tenant_title text, p_first text, p_last text, p_dob date, p_email text, p_phone text,
  p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text,
  p_rent numeric, p_tenancy_start date
) returns jsonb
language plpgsql stable security invoker set search_path to ''
as $function$
declare errs jsonb := '[]'::jsonb;
begin
  -- Field checks. All are evaluated and reported together, matching the
  -- original: a partner fixing one field at a time per round trip is a poor API.
  if coalesce(p_tenant_title,'') not in ('Mr','Mrs','Miss','Ms','Mx','Dr') then
    errs := errs || jsonb_build_object('kind','field','legacy','title',
      'field','tenant.title','code','invalid_value',
      'message','Title must be one of Mr, Mrs, Miss, Ms, Mx, Dr.');
  end if;
  if btrim(coalesce(p_first,'')) = '' then
    errs := errs || jsonb_build_object('kind','field','legacy','first name',
      'field','tenant.first_name','code','required','message','First name is required.');
  end if;
  if btrim(coalesce(p_last,'')) = '' then
    errs := errs || jsonb_build_object('kind','field','legacy','last name',
      'field','tenant.last_name','code','required','message','Last name is required.');
  end if;
  if p_dob is null then
    errs := errs || jsonb_build_object('kind','field','legacy','date of birth',
      'field','tenant.date_of_birth','code','required','message','Date of birth is required.');
  elsif p_dob >= current_date then
    errs := errs || jsonb_build_object('kind','field','legacy','date of birth (must be in the past)',
      'field','tenant.date_of_birth','code','must_be_in_past','message','Date of birth must be in the past.');
  end if;
  if coalesce(p_email,'') !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    errs := errs || jsonb_build_object('kind','field','legacy','email',
      'field','tenant.email','code','invalid_format','message','Enter a valid email address.');
  end if;
  if btrim(coalesce(p_phone,'')) = '' or p_phone !~ '[0-9]' then
    errs := errs || jsonb_build_object('kind','field','legacy','phone',
      'field','tenant.phone','code','invalid_format','message','Enter a valid phone number.');
  end if;
  if btrim(coalesce(p_addr1,'')) = '' then
    errs := errs || jsonb_build_object('kind','field','legacy','address line 1',
      'field','property.address_line_1','code','required','message','Address line 1 is required.');
  end if;
  if btrim(coalesce(p_city,'')) = '' then
    errs := errs || jsonb_build_object('kind','field','legacy','city/town',
      'field','property.city','code','required','message','City or town is required.');
  end if;
  if coalesce(p_postcode,'') !~* '^[a-z]{1,2}[0-9][a-z0-9]? ?[0-9][a-z]{2}$' then
    errs := errs || jsonb_build_object('kind','field','legacy','postcode',
      'field','property.postcode','code','invalid_format','message','Enter a valid UK postcode.');
  end if;
  if p_rent is null or p_rent <= 0 then
    errs := errs || jsonb_build_object('kind','field','legacy','monthly rent',
      'field','tenancy.monthly_rent','code','must_be_positive','message','Monthly rent must be greater than zero.');
  end if;
  if p_tenancy_start is null then
    errs := errs || jsonb_build_object('kind','field','legacy','tenancy start date',
      'field','tenancy.start_date','code','required','message','Tenancy start date is required.');
  end if;
  if p_branch is null then
    errs := errs || jsonb_build_object('kind','field','legacy','branch',
      'field','org.branch_id','code','required','message','A branch is required.');
  end if;

  -- The original raised the field list here, so the combined rules below were
  -- only ever reached with every field present and valid. Returning early
  -- preserves that, and avoids evaluating date arithmetic on nulls.
  if jsonb_array_length(errs) > 0 then return errs; end if;

  -- Combined rules. The original raised on the first to fail, so each returns
  -- immediately rather than accumulating.
  if (p_dob + interval '18 years')::date > p_tenancy_start then
    return errs || jsonb_build_object('kind','rule',
      'field','tenant.date_of_birth','code','must_be_18_by_tenancy_start',
      'message','Tenant must be 18 by the tenancy start date.');
  end if;
  if (p_dob + interval '100 years')::date < p_tenancy_start then
    return errs || jsonb_build_object('kind','rule',
      'field','tenant.date_of_birth','code','implausible_age',
      'message','Check the date of birth: the tenant would be over 100 at the tenancy start.');
  end if;
  if p_tenancy_start < (current_date - interval '7 days')::date then
    return errs || jsonb_build_object('kind','rule',
      'field','tenancy.start_date','code','too_far_in_past',
      'message','Tenancy start date cannot be more than 7 days in the past.');
  end if;
  if p_tenancy_start > (current_date + interval '2 years')::date then
    return errs || jsonb_build_object('kind','rule',
      'field','tenancy.start_date','code','too_far_ahead',
      'message','Tenancy start date cannot be more than 2 years ahead.');
  end if;

  return errs;
end $function$;

comment on function public.referral_field_errors(uuid, text, text, text, date, text, text, text, text, text, text, text, numeric, date) is
  'Single source of truth for referral field validation. Returns structured errors rather than raising, so the partner API can report per-field codes and create_referral can reconstruct its legacy messages from the same rules.';

revoke all on function public.referral_field_errors(uuid, text, text, text, date, text, text, text, text, text, text, text, numeric, date) from public, anon;
grant execute on function public.referral_field_errors(uuid, text, text, text, date, text, text, text, text, text, text, text, numeric, date) to authenticated, service_role;

-- ---------- the legacy raiser, now built on the rules above ----------
-- create_referral is unchanged and still calls this. Its error text and
-- SQLSTATEs are exactly what they were before this migration.
create or replace function public.assert_referral_valid(
  p_branch uuid,
  p_tenant_title text, p_first text, p_last text, p_dob date, p_email text, p_phone text,
  p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text,
  p_rent numeric, p_tenancy_start date
) returns void
language plpgsql stable security invoker set search_path to ''
as $function$
declare errs jsonb; legacy text[]; first_rule text;
begin
  errs := public.referral_field_errors(
    p_branch, p_tenant_title, p_first, p_last, p_dob, p_email, p_phone,
    p_addr1, p_addr2, p_city, p_county, p_postcode, p_rent, p_tenancy_start);

  if jsonb_array_length(errs) = 0 then return; end if;

  select array_agg(x->>'legacy' order by ord)
    into legacy
    from jsonb_array_elements(errs) with ordinality as t(x, ord)
   where x->>'kind' = 'field';

  if legacy is not null then
    raise exception 'Missing or invalid: %', array_to_string(legacy, ', ') using errcode = '22023';
  end if;

  select x->>'message'
    into first_rule
    from jsonb_array_elements(errs) with ordinality as t(x, ord)
   where x->>'kind' = 'rule'
   order by ord limit 1;

  raise exception '%', first_rule using errcode = '22023';
end $function$;
