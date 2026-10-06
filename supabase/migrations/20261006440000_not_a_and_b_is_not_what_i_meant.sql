-- `not A and B` IS NOT WHAT I MEANT.
--
-- CRITICAL, and entirely self-inflicted. 20261006380000 added the missing
-- AAL2 step-up to agency_match_queue with a DO block that read
-- pg_get_functiondef, ran replace() over the text and executed the result:
--
--   'public.is_opndoor_staff()'  ->  'public.is_opndoor_staff() and public.is_aal2()'
--
-- applied to `if not public.is_opndoor_staff() then raise`. NOT binds tighter
-- than AND, so the refusal became `(not staff) and aal2`:
--
--   Opndoor staff                     -> not refused   correct
--   agency user, stepped up (aal2)    -> refused       correct
--   agency user, password only (aal1) -> NOT REFUSED   the whole queue
--   tenant session                    -> NOT REFUSED   the whole queue
--
-- Reproduced on dev as Regent's Negotiator:
--   aal1 session -> 1 row of the direct-rail match queue
--   aal2 session -> refused
--
-- Exactly inverted. And 20261006420000 then read that damaged body out of the
-- catalogue and froze it as the canonical definition, so the mistake was
-- written into the files by the very migration meant to make the files
-- authoritative.
--
-- WHAT IT EXPOSED. agency_match_queue is SECURITY DEFINER with no partner,
-- agency or branch predicate anywhere in its body, granted to authenticated.
-- It returns, for every direct application in needs_review plus fourteen days
-- of email auto-matches: the guarantee reference, the tenant's first and last
-- name, the property city and postcode, the agency name the tenant typed, the
-- auto-matched agency and the full candidates list. is_aal2() is false for
-- every pre-TOTP session, and tenant-auth issues real sessions, so a TENANT
-- could read Opndoor's direct-rail pipeline.
--
-- THE LESSON, which is the second time this exact technique has cost
-- something: a migration that computes its answer by rewriting text is not
-- reviewable. 20261006420000 already replaced this function's DO block with a
-- literal definition for that reason, and did so from the catalogue, which by
-- then held the damage. Written out literally here, with the guard restored
-- to the two-statement form both its siblings use. No more string surgery.

CREATE OR REPLACE FUNCTION public.agency_match_queue()
 RETURNS TABLE(application_id uuid, guarantee_ref text, tenant_name text, property text, typed_name text, auto_agency_id uuid, auto_agency_name text, candidates jsonb, state text, matched_by text, resolved_branch_name text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- TWO STATEMENTS, as resolve_agency_match and dismiss_agency_match have
  -- always had. They were collapsed into one by a string substitution, and
  -- `not A and B` is `(not A) and B`, so the refusal fired only for a
  -- non-staff caller WHO HAD stepped up, and let every password-only session
  -- straight through.
  if not public.is_opndoor_staff() then raise exception 'not permitted' using errcode = '42501'; end if;
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  return query
    select m.application_id, a.guarantee_ref,
           btrim(coalesce(a.tenant_first_name, '') || ' ' || coalesce(a.tenant_last_name, '')),
           btrim(coalesce(a.prop_city, '') || ' ' || coalesce(a.prop_postcode, '')),
           m.typed_name, m.auto_agency_id, ag.name, m.candidates,
           m.state, m.matched_by, rb.name, m.created_at
      from public.application_agency_match m
      join public.applications a  on a.id  = m.application_id
      left join public.agencies ag on ag.id = m.auto_agency_id
      left join public.branches rb on rb.id = m.resolved_branch_id
     where m.state = 'needs_review'
        or (m.state = 'resolved' and m.matched_by = 'email'
            and m.resolved_at > now() - interval '14 days')
     order by (m.state = 'needs_review') desc, coalesce(m.resolved_at, m.created_at) desc;
end $function$;
