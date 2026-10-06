-- R5. A TENANCY HAS ONE START DATE.
--
-- `amend_tenancy_start` corrected ONE application, by id. A joint tenancy is
-- two applications over one tenancy, each with its own Deed of Guarantee, so
-- a correction moved one deed and left the other: two executed instruments
-- stating different start dates for the same let.
--
-- AND THE EXPIRY FOLLOWS IT OUT OF THE BUILDING. `expiry_date` is GENERATED
-- from `tenancy_start`, so the two deeds also expire on different days. The
-- bordereau bills each deed as its own row, so the discrepancy is carried to
-- the underwriter rather than staying internal.
--
-- Test: supabase/tests/a_tenancy_has_one_start_date.test.sql
-- Failed first on 4 of 8, with 4 regression guards passing throughout.
--
-- =========================================================================
-- THE RULE, AND ITS SECOND HALF
-- =========================================================================
--
-- A tenancy has one start date, so a correction applies to the WHOLE tenancy
-- or to NONE of it.
--
-- The second half is not decoration. Moving every sibling unconditionally
-- would swap one divergence for another: `can_amend_tenancy_start` is
-- stricter once a deed is executed, so in a pair where one deed is signed and
-- the other is not, a Negotiator allowed to move their own unsigned
-- application would drag the signed one with it -- editing the term of an
-- executed legal instrument they may not touch directly.
--
-- So every sibling is tested for BOTH permission and eligibility before
-- anything is written, and one refusal aborts the whole correction. Nothing
-- half-applies. Assertions 5 and 6 are that, and assertion 6 in particular
-- checks that not even the row they WERE allowed to touch moved.
--
-- The `tenancies` row is carried along too: it holds its own tenancy_start,
-- and leaving it behind would simply move the disagreement one table over.
--
-- The MFA gate, the date range check and the rates redaction (R4) are
-- unchanged.

create or replace function public.amend_tenancy_start(p_app uuid, p_new_start date)
returns applications
language plpgsql security definer set search_path to ''
as $function$
declare
  a public.applications;
  s public.applications;
  r text;
  owned boolean;
  v_tenancy uuid;
  v_id uuid;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_new_start is null then raise exception 'A new tenancy start date is required' using errcode = '22023'; end if;
  if p_new_start < date '2000-01-01' or p_new_start > (current_date + interval '5 years')::date then
    raise exception 'Tenancy start date is out of range' using errcode = '22023';
  end if;

  select * into a from public.applications where id = p_app;
  if not coalesce(found, false) then raise exception 'application not found'; end if;

  r := public.app_role();
  -- Held in plain variables: these are used in the WHERE of an UPDATE on the
  -- very table the record came from, where `a.tenancy_id` would be ambiguous.
  v_tenancy := a.tenancy_id;
  v_id      := a.id;

  -- EVERY APPLICANT OF THE TENANCY IS TESTED BEFORE ANYTHING IS WRITTEN.
  -- A single refusal aborts the function, so a correction is all or nothing.
  for s in
    select * from public.applications
     where (v_tenancy is not null and tenancy_id = v_tenancy)
        or (v_tenancy is null and id = v_id)
  loop
    owned := coalesce(s.referrer_id = auth.uid(), false);

    if not coalesce((public.is_admin()
            or (r = 'management' and s.partner_id = public.app_partner()
                and public.app_may_reach_branch(s.branch_id))
            or (r = 'referrer'   and owned)), false) then
      raise exception 'not permitted' using errcode = '42501';
    end if;

    if not coalesce(public.can_amend_tenancy_start(r, s.status, owned, s.deed_state), false) then
      raise exception 'amend not permitted for this role and status' using errcode = '42501';
    end if;
  end loop;

  -- Date only. expiry_date is generated from tenancy_start; the deed
  -- lifecycle is handled by the amend-tenancy-start Edge Function, not here.
  update public.applications set tenancy_start = p_new_start
   where (v_tenancy is not null and tenancy_id = v_tenancy)
      or (v_tenancy is null and id = v_id);

  -- The tenancy row carries its own start date. Leaving it behind would move
  -- the disagreement one table over rather than ending it.
  if v_tenancy is not null then
    update public.tenancies set tenancy_start = p_new_start where id = v_tenancy;
  end if;

  select * into a from public.applications where id = p_app;
  return public.rates_for_reader(a);
end $function$;

comment on function public.amend_tenancy_start(uuid, date) is
  'Corrects a tenancy start date across the WHOLE tenancy. Every applicant is tested for permission and eligibility first and one refusal aborts the lot, so a joint tenancy can never end up with two deeds stating different dates -- nor with a caller dragging an executed co-tenant along with their own unsigned one.';
