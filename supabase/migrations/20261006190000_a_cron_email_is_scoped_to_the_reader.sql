-- A CRON EMAIL IS SCOPED TO THE READER.
--
-- Three scheduled emails resolved their staff recipients the same way:
--
--   service.from("users").select("email, partner_id").eq("role","management")
--   ...bucketed by partner_id
--
-- with no status filter, no position filter and no agency filter, at
-- expiry-reminders/index.ts:119, weekly-digest/index.ts:147 and
-- expiry-cohorts/index.ts:134. The CONTENT was built the same way: one digest
-- per partner, one CSV per partner.
--
-- For a SUPPLIER that is right, because a supplier is a company. On the AGENCY
-- rail every agency shares the house partner 'opndoor-agents', so each of
-- those emails went to every agency on the route and carried every agency's
-- rows. The expiry-cohort attachment is a CSV whose columns are Tenant name,
-- Property address, Agency, Branch, Tenancy start, Monthly rent and Referrer:
-- one agency's tenants, spreadsheet-ed to its competitors, monthly.
--
-- THE SCOPE IS THE POSITION SOMEBODY ALREADY HOLDS, which is the same rule the
-- new notification tickbox uses and the same helper set the agencies, branches
-- and agent_contacts policies were converted to in 20260924120000. There is no
-- new concept here and no second setting: a branch-positioned user covers
-- their branch, an agency-positioned user every branch in the agency, a
-- group-positioned user the whole group.
--
-- ONE ROW PER (READER, AGENCY) is deliberate. The edge functions can then
-- group by reader and build each email out of exactly the agencies that reader
-- covers, which is the only shape that makes "no cross-agency recipient, row
-- or CSV line" true of the CONTENT as well as of the address list.

create or replace function public.staff_notification_scopes(p_partner uuid)
returns table (user_id uuid, email text, full_name text, agency_id uuid, agency_name text)
language sql stable security definer set search_path to ''
as $function$
  select distinct
         u.id, u.email, u.full_name, a.id, a.name
    from public.users u
    join public.user_scopes s on s.user_id = u.id
    join public.agencies a
      on (s.kind = 'agency' and s.agency_id = a.id)
      or (s.kind = 'group'  and a.group_id is not null and s.group_id = a.group_id)
      or (s.kind = 'branch' and exists (
            select 1 from public.branches b where b.id = s.branch_id and b.agency_id = a.id))
   where u.partner_id = p_partner
     -- ACTIVE ONLY. None of the three had this filter, so a pending invitee
     -- and a deactivated colleague were both still being emailed.
     and u.status = 'active'
     and u.role = 'management'
     and coalesce(btrim(u.email), '') <> ''
     and not a.is_placeholder

  union

  /* THE SUPPLIER RAIL IS UNCHANGED, and this arm is what keeps it that way. A
     supplier's management users hold no position (positions are an agency-rail
     idea), so the join above returns nothing for them and they would silently
     stop receiving their own digest. On that rail the partner IS the company,
     so every agency under it is legitimately theirs. */
  select distinct u.id, u.email, u.full_name, a.id, a.name
    from public.users u
    join public.partners p on p.id = u.partner_id
    join public.agencies a on a.partner_id = p.id
   where u.partner_id = p_partner
     and u.status = 'active'
     and u.role = 'management'
     and coalesce(btrim(u.email), '') <> ''
     and not a.is_placeholder
     and p.referencing_mode is distinct from 'opndoor_referenced'
$function$;

comment on function public.staff_notification_scopes(uuid) is
  'One row per (staff reader, agency they cover) for a partner. On our own estate the reader''s position decides it, so a scheduled email can be addressed and CONTENT-scoped per reader rather than per partner; on the supplier rail the partner is the company and every agency under it is theirs. Active management users only.';

revoke all on function public.staff_notification_scopes(uuid) from public;
grant execute on function public.staff_notification_scopes(uuid) to service_role;
