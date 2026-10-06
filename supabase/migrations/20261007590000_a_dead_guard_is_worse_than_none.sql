-- ===========================================================================
-- THE on conflict ON THE SUPPLIER ARM WAS DEAD, AND ITS COMMENT SAID
-- OTHERWISE.
--
-- 20261007580000 added `on conflict (application_id, level) do nothing`
-- to the supplier insert and called it idempotent, "so a re-run or a
-- retried creation cannot raise on the unique (application_id, level)
-- rather than doing nothing."
--
-- It cannot do that. The agency-side insert is a CTE in the same
-- statement and is evaluated first; it has no conflict clause and never
-- has, so a second run raises on the AGENCY line before the supplier
-- arm is reached and the whole statement rolls back. The pgTAP test
-- written for the claim is what proved it:
--
--   died: 23505: duplicate key ... Key (application_id, level)=(..., agency)
--
-- SO IT GOES, rather than being made true on both arms. "The same way
-- agency commission is stored" is the instruction, and the agency side
-- has never been idempotent: the three creation paths call this once,
-- and a retried creation failing loudly is the behaviour they were
-- written against. Making both arms swallow a duplicate would change
-- what a retry does on the agency side as a side effect of adding the
-- supplier's line, which is not this file's business.
--
-- A dead guard with a comment claiming it works is worse than no guard:
-- the next person to need idempotency here reads the comment and stops
-- looking.
-- ===========================================================================
create or replace function public.freeze_commission_lines(
  p_application uuid, p_branch uuid, p_route_partner uuid, p_tenant_count integer,
  p_basis numeric, p_tenancy_basis numeric default null::numeric,
  p_pcts numeric[] default null::numeric[], p_position integer default null::integer)
returns void
language sql security definer set search_path to ''
as $function$
  with agency_side as (
    insert into public.application_commission_lines
      (application_id, level, org_id, org_name, rate, basis_amount, source, amount)
    select p_application, s.level, s.org_id, s.org_name, s.rate, p_basis, s.source,
           case
             when p_pcts is null or p_position is null or p_tenancy_basis is null
               -- A tenancy of one: its single line IS the tenancy's commission, so
               -- rounding it once here is the same arithmetic apportion would do.
               then round(p_basis * s.rate, 2)
             else
               -- Round the TENANCY's commission once, then divide. The reverse
               -- order is the defect.
               (public.apportion(round(p_tenancy_basis * s.rate, 2), p_pcts))[p_position]
           end
    from public.commission_split(p_branch, p_route_partner, p_tenant_count) s
    returning 1
  )
  -- WHAT OPNDOOR OWES THE SUPPLIER, written exactly as the agency side
  -- is: one row, the rate from the application's own snapshot, the
  -- amount rounded once here so every surface reads one number, and no
  -- conflict clause, because the arm above it has none.
  insert into public.application_commission_lines
    (application_id, level, org_id, org_name, rate, basis_amount, source, amount)
  select p_application, 'supplier', pt.id, pt.name, a.partner_rate, p_basis,
         -- The supplier's rate is resolved by resolve_rates and carries no
         -- source today. Null is "not recorded", which is what the agency
         -- side's historic lines say and is honest; naming one would be a
         -- guess printed on a statement.
         null,
         case
           when p_pcts is null or p_position is null or p_tenancy_basis is null
             then round(p_basis * a.partner_rate, 2)
           else (public.apportion(round(p_tenancy_basis * a.partner_rate, 2), p_pcts))[p_position]
         end
  from public.applications a
  join public.partners pt on pt.id = a.partner_id
  where a.id = p_application
    and public.is_supplier_estate(a.partner_id)
    and coalesce(a.partner_rate, 0) > 0
$function$;

revoke all on function public.freeze_commission_lines(uuid, uuid, uuid, integer, numeric, numeric, numeric[], integer) from public, anon, authenticated;
grant execute on function public.freeze_commission_lines(uuid, uuid, uuid, integer, numeric, numeric, numeric[], integer) to service_role;
