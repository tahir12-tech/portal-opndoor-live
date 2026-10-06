-- OPNDOOR STAFF MAY AMEND A START DATE AT ANY TIME.
--
-- Matt, 2026-10-04, answering the question 20261008090000 left open:
-- "any Opndoor staff (admins and opndoor managers) can change a start date
-- at any time, including after the tenancy starts; agency and supplier users
-- only before it starts. Widen amend_tenancy_start's guard to match and test
-- it as the dev opndoor manager."
--
-- Test: supabase/tests/a_started_tenancy_is_opndoors.test.sql
--
-- =========================================================================
-- THIS OVERTURNS WHAT THE LAST MIGRATION RECOMMENDED, AND IT IS RIGHT TO
-- =========================================================================
--
-- 20261008090000 wrote the started arm as superadmin alone and said why:
-- the reach guard in `amend_tenancy_start` was `is_admin()`, so an opndoor
-- manager was refused before the predicate was ever consulted, and writing
-- the wider predicate would have offered them a dialog the server refused.
-- I recommended leaving it, on the grounds that it granted no new write.
--
-- Matt's answer is that "Opndoor staff" should mean throughout the estate
-- what `is_opndoor_staff()` means, and a rule whose words disagree with the
-- predicate of the same name is one somebody will misread. That is a better
-- reason than mine. So the guard moves to meet the words.
--
-- IT IS WIDER THAN THE BRACKET LOOKED, and both arms change. "At any time"
-- also covers BEFORE the start, where an opndoor manager was excluded too:
-- the old arm was superadmin plus management. So:
--
--   before the start   an owning referrer, anyone at management level, and
--                      now any opndoor staff
--   after the start    opndoor staff, now both of them rather than admins
--
-- NOTHING AN AGENCY OR SUPPLIER USER MAY DO CHANGES. The half of the rule
-- Matt decided this morning is untouched; this is only about who counts as
-- opndoor.

drop function if exists public.can_amend_tenancy_start(text, text, boolean, text, boolean);

create function public.can_amend_tenancy_start(
  p_role text, p_status text, p_owned boolean, p_deed_state text default null,
  p_started boolean default false
) returns boolean language sql immutable set search_path to '' as $function$
  select case
    /* THE TENANCY HAS BEGUN. Moving the start date now moves the expiry, and
       with it the cover on a deed that may already be signed and reported.
       Opndoor only, and opndoor means both staff roles. */
    when coalesce(p_started, false)
      then p_role in ('superadmin', 'opndoor_manager')
    /* BEFORE IT BEGINS, a correction is a correction, signed or not. An
       owning Negotiator or Referrer may make it on their own referral;
       anybody at management level may make it on any of theirs; opndoor
       staff may make it on anybody's. */
    when p_role = 'referrer' then coalesce(p_owned, false)
    else p_role in ('superadmin', 'opndoor_manager', 'management')
  end
$function$;

-- GRANTS AS 20261006400000 LEFT THEM, which is service_role alone: this is
-- reached only from inside SECURITY DEFINER functions, so an open grant
-- would only let a signed-in caller run a guard out of context. The DROP
-- above took the old grants with it, so they are restated, not inherited.
revoke all on function public.can_amend_tenancy_start(text, text, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.can_amend_tenancy_start(text, text, boolean, text, boolean) to service_role;

comment on function public.can_amend_tenancy_start(text, text, boolean, text, boolean) is
  'May this reader move a tenancy start date? Before the tenancy begins, an owning referrer, anyone at management level, or opndoor staff. Once it has begun, opndoor staff alone: the expiry is generated from this date, so moving it changes the cover on a deed that may already be signed and on the bordereau. Opndoor staff is is_opndoor_staff(), superadmin plus opndoor_manager, and amend_tenancy_start''s reach guard says the same.';

CREATE OR REPLACE FUNCTION public.amend_tenancy_start(p_app uuid, p_new_start date)
 RETURNS applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

    /* OPNDOOR STAFF, NOT JUST ADMINS. Matt, 2026-10-04: "any Opndoor staff
       (admins and opndoor managers) can change a start date at any time ...
       Widen amend_tenancy_start's guard to match."

       THIS GUARD WAS THE REAL RESTRICTION, not the predicate below it. It
       read `is_admin()`, so an opndoor manager was refused here before
       can_amend_tenancy_start was ever consulted -- which is why writing
       that predicate as is_opndoor_staff would have produced a dialog the
       server then refused. Both now say the same thing. */
    if not coalesce((public.is_opndoor_staff()
            or (r = 'management' and s.partner_id = public.app_partner()
                and public.app_may_reach_branch(s.branch_id))
            or (r = 'referrer'   and owned)), false) then
      raise exception 'not permitted' using errcode = '42501';
    end if;

    /* HAS THE TENANCY STARTED. Matt, 2026-10-04: "agency and supplier users
       can change a start date only before the tenancy starts (signed or
       not); after the start date, only Opndoor staff can."

       THE DATE ON THE ROW, NOT THE NEW ONE. What decides this is whether the
       tenancy the reader is amending has begun, not where they are trying to
       move it to. Reading the proposed date instead would let somebody out
       of a tenancy that has started by amending it into the future. */
    if not coalesce(public.can_amend_tenancy_start(
         r, s.status, owned, s.deed_state,
         s.tenancy_start is not null and s.tenancy_start <= current_date), false) then
      raise exception 'The tenancy has started. Contact opndoor to change the date.'
        using errcode = '42501';
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
end $function$
;
