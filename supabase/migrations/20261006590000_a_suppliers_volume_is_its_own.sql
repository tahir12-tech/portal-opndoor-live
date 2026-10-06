-- A SUPPLIER'S NEGOTIATED VOLUME IS ITS OWN.
--
-- Round 6, M13. The third instance of one slip, and the reason it is worth a
-- migration of its own rather than a line in another: the rule is "direct-rail
-- applications never count as the matched agency's business", and written as
-- an INCLUSION of the agency rail it silently deletes the supplier rail.
--
--   agency_weekly_digest        `= 'Agent referral'`   fixed 20261006580000
--   commission_statement_lines  no test at all         fixed 20261006580000
--   agreement_volume            `= 'Agent referral'`   here
--
-- agreement_volume decides which BAND of a negotiated agreement a party is on.
-- For a supplier it returned 0 for every application they had ever paid for,
-- so their tier never advanced and they were charged the opening band of a
-- deal they had outgrown. Nothing would surface it: there is no error, no
-- empty screen, just a number that is always zero.

CREATE OR REPLACE FUNCTION public.agreement_volume(p_agreement uuid, p_branch uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with pa as (select * from public.pricing_agreements where id = p_agreement),
  ctx as (
    select b.id as branch_id, b.agency_id, a.group_id
    from public.branches b left join public.agencies a on a.id = b.agency_id
    where b.id = p_branch
  )
  select count(*)::int
  from public.applications ap
  join public.branches b2 on b2.id = ap.branch_id
  left join public.agencies a2 on a2.id = b2.agency_id
  cross join pa cross join ctx
  where ap.paid_at is not null
    -- NOT THE DIRECT RAIL. A direct application is given a branch by the
    -- automatic matcher, so it landed inside that agency's negotiated volume
    -- and could push them into a better commission band; Opndoor's own direct
    -- business is not the matched agency's.
    --
    -- Written as `= 'Agent referral'` when that was fixed, which is the same
    -- slip 20261006580000 corrected in agency_weekly_digest: there are THREE
    -- rails, so including one excludes two. A SUPPLIER with a negotiated
    -- agreement counted zero applications forever, its tier never advanced,
    -- and it stayed on the worst band of a deal it had already outgrown --
    -- invisibly, because the count is simply always 0.
    and public.application_channel(ap.id) <> 'Direct'
    and ap.livemode
    and ap.paid_at::date >= public.agreement_period_start(p_agreement)
    and case pa.counting_scope
          when 'branch' then b2.id = ctx.branch_id
          when 'agency' then b2.agency_id = ctx.agency_id
          else a2.group_id is not distinct from ctx.group_id and ctx.group_id is not null
        end
$function$;
