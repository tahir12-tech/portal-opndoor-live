/* =====================================================================
   THE AUDIT ROW POINTS AT THE DECISION, BECAUSE THERE IS NO AGENCY TO
   POINT AT.

   A correction to 20261007130000, which is applied, so it goes in a new
   file.

   That migration audited a not-in-network decision with `entity_id`
   null, on the reasoning that an agency we do not work with has no row
   in `public.agencies` to name. The reasoning is right and the column is
   NOT NULL, so `decide_not_in_network` raised 23502 on every call and
   the feature did not work at all. Caught by
   `a_decision_is_a_moment_not_a_flag.test.sql` before it went anywhere,
   which is the only reason this is a tidy correction rather than a
   Reconciliation page with two buttons that throw.

   THE DECISION ITSELF IS THE ENTITY. It has an id, it is the thing that
   happened, and pointing the trail at it means "what was decided about
   this name, and when" is answerable by joining the two rather than by
   reading a sentence. `entity_type` stays 'agency_name' so nobody joins
   it to a real agency.
   ===================================================================== */
create or replace function public.decide_not_in_network(p_name_key text, p_decision text, p_typed_name text default null)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare v_who text; v_id uuid; v_name text;
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  /* THE SAME GATE THE LIST HAS. `not_in_network_agencies` is
     is_opndoor_staff, so anybody who can read the list can act on it and
     nobody else can. An agency user has no business here at all: the
     rows are other agencies' names. */
  if not coalesce(public.is_opndoor_staff(), false) then
    raise exception 'Only Opndoor decides what happens to a not-in-network agency.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_name_key), '') = '' then
    raise exception 'No agency named.' using errcode = '22023';
  end if;
  if coalesce(p_decision, '') not in ('added', 'ignored') then
    raise exception 'A decision is either added or ignored.' using errcode = '22023';
  end if;

  v_name := coalesce(nullif(btrim(coalesce(p_typed_name, '')), ''), btrim(p_name_key));

  insert into public.not_in_network_decisions (name_key, decision, decided_by, typed_name)
  values (btrim(p_name_key), p_decision, auth.uid(), nullif(btrim(coalesce(p_typed_name, '')), ''))
  returning id into v_id;

  select coalesce(nullif(btrim(full_name), ''), email) into v_who
    from public.users where id = auth.uid();

  /* POINTED AT THE DECISION, not at an agency that by definition does not
     exist on our estate. entity_type says 'agency_name' so nothing joins
     this to public.agencies. */
  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values ('agency_name', v_id,
          case when p_decision = 'added' then 'not_in_network_added' else 'not_in_network_ignored' end,
          v_name
            || case when p_decision = 'added'
                    then ' was added to HubSpot by hand and taken off the not-in-network list'
                    else ' was ignored and taken off the not-in-network list' end,
          coalesce(v_who, 'opndoor admin'), auth.uid());
end $function$;
