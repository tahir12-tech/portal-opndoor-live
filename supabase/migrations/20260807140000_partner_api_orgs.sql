-- Read model for GET /orgs on the partner API. See PARTNER-API.md section 7.5.
--
-- WHY THIS ENDPOINT EXISTS. Today the New Application form submits agency and
-- branch as free-text NAMES, and an unmatched name silently creates new org
-- records rather than erroring (create-referral/index.ts:66-90). Across a
-- partner sending applications at volume that produces duplicate orgs steadily
-- and invisibly. The partner API requires stable IDs instead, and this endpoint
-- is how a partner discovers the IDs it should be sending.
--
-- WHY has_agent_contact IS COMPUTED AND NOT A COLUMN. It answers "can a deed be
-- issued for this branch", which is not the same as "does a contact row exist".
-- Deed generation resolves the agent email through effective_primary_contact and
-- dead-ends when it comes back empty (_shared/pandadoc.ts:412-418), setting
-- deed_state = 'error' AFTER the tenant has paid. A branch with contacts but
-- none flagged primary resolves to nothing, because effective_contacts only
-- falls back to the agency when the branch has NO contacts at all
-- (20260702134358:31-35). So this calls the same function the deed path calls,
-- rather than reimplementing the fallback and risking the two disagreeing.
--
-- SECURITY DEFINER because every table carries a restrictive AAL2 policy that an
-- API-key request can never satisfy. effective_primary_contact is security
-- invoker (20260702134957:15), so called from here it runs as this function's
-- owner and resolves across all rows. p_partner is supplied by the Edge Function
-- from the verified API key and never from a request payload.

create or replace function public.partner_api_orgs(p_partner uuid)
returns table (
  agency_id                 uuid,
  agency_name               text,
  agency_has_agent_contact  boolean,
  branch_id                 uuid,
  branch_name               text,
  branch_has_agent_contact  boolean
)
language sql security definer set search_path to '' stable
as $function$
  select
    a.id,
    a.name,
    exists (
      select 1 from public.agent_contacts c
      where c.agency_id = a.id and c.is_primary
    ) as agency_has_agent_contact,
    b.id,
    b.name,
    -- Null branch (an agency with no branches) yields null, not false: there is
    -- no branch to answer the question about.
    case when b.id is null then null
         else ((public.effective_primary_contact(b.id)).email is not null)
    end as branch_has_agent_contact
  from public.agencies a
  -- The partner filter is repeated on the join rather than moved to the WHERE
  -- clause, so an agency with no branches still returns one row. branches.partner_id
  -- is trigger-maintained from the agency (core_schema.sql:146-152) so this is
  -- defence in depth rather than a distinct condition.
  left join public.branches b
    on b.agency_id = a.id
   and b.partner_id = p_partner
  where a.partner_id = p_partner
  order by a.name, b.name nulls first;
$function$;

comment on function public.partner_api_orgs(uuid) is
  'Agencies and branches for one partner, with has_agent_contact meaning "a deed can be issued", computed via effective_primary_contact so it matches the deed path exactly. Called by the partner API Edge Function with a partner_id derived from a verified API key.';

revoke all on function public.partner_api_orgs(uuid) from public, anon, authenticated;
grant execute on function public.partner_api_orgs(uuid) to service_role;
