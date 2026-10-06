-- A STARTED TENANCY IS OPNDOOR'S TO AMEND.
--
-- Matt, 2026-10-04, deciding a rule he had asked me to describe first:
-- "agency and supplier users can change a start date only before the tenancy
-- starts (signed or not); after the start date, only Opndoor staff can."
--
-- Test: supabase/tests/a_started_tenancy_is_opndoors.test.sql
--
-- =========================================================================
-- WHAT THE RULE WAS, AND THAT NOBODY CHOSE IT
-- =========================================================================
--
-- Asked to say where today's rule came from, I traced it: the role test is
-- from 20260703103841_amend_deed_state_aware, whose header is engineering
-- reasoning about deed states rather than a quoted instruction, and the
-- five-year range bound arrived in the same commit. Nothing in the queue
-- records a decision about who may move a start date. It was a default.
--
-- AND IT HAD NO TIME LIMIT AT ALL. A signed, live guarantee six months into
-- its term could have its start date moved by a Manager. `expiry_date` is
-- GENERATED from tenancy_start, so that silently changed the period of cover
-- on a deed somebody had signed and the underwriter held on the bordereau.
-- That is a contract variation wearing the clothes of a correction.
--
-- =========================================================================
-- THE NEW RULE CUTS ON ONE FACT, WHICH IS WHY IT IS BETTER THAN MINE
-- =========================================================================
--
-- I recommended splitting on whether the deed was signed AND whether the
-- term had started. Matt's splits on one question: HAS THE TENANCY STARTED.
-- Signed stops mattering, which takes a whole axis out of a permission that
-- the RPC, the dialog, the FAQ and the tests all have to agree about.
--
-- IT WIDENS AND NARROWS AT ONCE, deliberately:
--   before the start  an agency or supplier user may now amend a SIGNED
--                     deed, which was Management and admin only
--   after the start   nobody outside opndoor may amend at all, where
--                     anybody with the role could
--
-- THE DATE ON THE ROW DECIDES IT, never the proposed one: reading the new
-- date would let somebody out of a started tenancy by amending it into the
-- future.
--
-- =========================================================================
-- "OPNDOOR STAFF" HERE IS SUPERADMIN ONLY, AND THAT IS NOT WHAT IT MEANS
-- EVERYWHERE ELSE. Flagged for Matt rather than decided quietly.
-- =========================================================================
--
-- public.is_opndoor_staff() is is_admin() plus opndoor_manager, and
-- isOpndoorStaff() in the client says the same. I wrote this arm as that
-- pair, and my own test caught it: an opndoor_manager was still refused.
--
-- THE REASON IS OLDER THAN THIS RULE. `amend_tenancy_start`'s reach guard,
-- the one above this check, has exactly three arms: is_admin(), management
-- within reach, and an owning referrer. `opndoor_manager` is in none of
-- them, and has never been able to amend a start date on ANY application,
-- started or not. That is the state of things before today and I have not
-- changed it.
--
-- SO THE CHOICE WAS between widening the reach guard to let opndoor managers
-- through, which grants a new write on live cover that nobody asked for, and
-- writing this arm to match what the function will actually permit. A
-- predicate that says yes where the guard says no is worse than either: it
-- is a button that opens a dialog that fails on save.
--
-- FOR MATT: if "only Opndoor staff can" was meant to include opndoor
-- managers, this is a one-line change in two places (this arm and the reach
-- guard above). My recommendation is to leave it: moving the start date of a
-- tenancy that has already begun changes the expiry on a signed deed the
-- underwriter is holding, and admin-only is the right size of hole for that.
--
-- It cannot call is_opndoor_staff() in any case: that is STABLE and reads
-- auth.uid(), while this is IMMUTABLE and is handed the role precisely so
-- the caller decides whose role is being tested.

drop function if exists public.can_amend_tenancy_start(text, text, boolean, text);

create function public.can_amend_tenancy_start(
  p_role text, p_status text, p_owned boolean, p_deed_state text default null,
  p_started boolean default false
) returns boolean language sql immutable set search_path to '' as $function$
  select case
    /* THE TENANCY HAS BEGUN. Moving the start date now moves the expiry, and
       with it the cover on a deed that may already be signed and reported. */
    when coalesce(p_started, false)
      then p_role = 'superadmin'
    /* BEFORE IT BEGINS, a correction is a correction, signed or not. An
       owning Negotiator or Referrer may make it on their own referral;
       anybody at management level may make it on any of theirs. */
    when p_role = 'referrer' then coalesce(p_owned, false)
    else p_role in ('superadmin', 'management')
  end
$function$;

-- GRANTS AS 20261006400000 LEFT THEM, which is service_role alone. That
-- migration revoked `authenticated` from this function with a reason worth
-- not undoing by habit: it is reached only from inside SECURITY DEFINER
-- functions, which run as their owner and need no grant, so an open one only
-- lets a signed-in caller run a guard out of context. The DROP above took the
-- old grants with it, so they are restated rather than inherited; I had
-- copied the 2026-07 grant line, which would have re-opened it to every
-- signed-in user, and that migration's own proof block runs earlier in
-- filename order and so would not have caught it.
revoke all on function public.can_amend_tenancy_start(text, text, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.can_amend_tenancy_start(text, text, boolean, text, boolean) to service_role;

do $proof$
begin
  if has_function_privilege('anon', 'public.can_amend_tenancy_start(text, text, boolean, text, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.can_amend_tenancy_start(text, text, boolean, text, boolean)', 'execute') then
    raise exception 'can_amend_tenancy_start is callable outside a definer again.';
  end if;
end $proof$;

comment on function public.can_amend_tenancy_start(text, text, boolean, text, boolean) is
  'May this reader move a tenancy start date? Before the tenancy begins, an owning referrer or anyone at management level may, whether or not the deed is signed. Once it has begun, superadmin only: the expiry is generated from this date, so moving it changes the cover on a deed that may already be signed and on the bordereau. Superadmin rather than is_opndoor_staff because amend_tenancy_start''s reach guard is is_admin(), and an opndoor_manager has never been able to amend a start date at all.';

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

    if not coalesce((public.is_admin()
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
