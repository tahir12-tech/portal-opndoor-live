-- ONE RAIL EXCLUDED, NOT ONE RAIL INCLUDED.
--
-- Two findings from round 6, and they are the same sentence read two ways.
--
-- The ruling is: "direct-rail applications never count as the matched agency's
-- business: exclude them from agency digests, cohort CSVs and every other
-- agency-facing surface." That is an exclusion of ONE rail. Written as an
-- inclusion of one rail it says something different and wrong, because there
-- are three.
--
-- M5. commission_statement_lines had no rail test at all -- the only money
-- surface without one. resolve_agency_match rewrites a direct application's
-- branch_id and agency_id to a REAL agency so somebody can service it, while
-- pinning partner_id to opndoor-direct, so that application became an
-- agency-level payee and commission-statements posts the statement to that
-- agency's Directors. Measured on dev before the fix:
--
--   payee_key                                    level   org_name     ref
--   opndoor-direct|agency:f5a6d6a6-...           agency  Unattached   GR-20621
--
-- It reads "Unattached" only because that row has not been through the
-- matcher. What held it at zero is opndoor-direct's agent_rate being 0.0000,
-- which is a number an admin edits on the partner-settings screen.
--
-- M3. agency_weekly_digest went the other way: it pins
-- `application_channel(a.id) = 'Agent referral'`, so a SUPPLIER agency's row
-- comes back all zeros and the reader is dropped by the "nothing happened this
-- week" skip -- while staff_notification_scopes carries a dedicated supplier
-- arm added for exactly the reason that they would otherwise "silently stop
-- receiving their own digest". The recipient half kept suppliers in and the
-- data half took them out. expiry-cohorts got this right by pinning the
-- reader's own partner instead.

-- agency_weekly_digest(timestamp with time zone,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.agency_weekly_digest(p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(agency_id uuid, agency_name text, partner_id uuid, sent integer, sent_paid integer, paid integer, fees numeric, deeds integer, awaiting integer, top_branch text, top_branch_fees numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  return query
  with base as (
    select a.agency_id, a.partner_id, a.status, a.sent_at, a.paid_at, a.deed_issued_at,
           a.deed_state, a.monthly_rent, a.fee_amount, b.name as branch_name
    from public.applications a
    left join public.branches b on b.id = a.branch_id
    where a.livemode
      /* AGENCY-RAIL BUSINESS ONLY. A direct application keeps
         partner_id = 'opndoor-direct' but is given an agency_id and a
         branch_id by the automatic matcher, so it is invisible to that agency
         in the portal (applications_select pins the partner) and was counted
         in their weekly digest anyway. A direct tenant is Opndoor's business,
         never the matched agency's. */
      and -- NOT 'Agent referral'. Round 6, M3: pinning the channel to the agency rail
      -- excluded every SUPPLIER agency, so their digest came back all zeros and
      -- the reader was dropped by the "nothing happened this week" skip -- while
      -- staff_notification_scopes has a dedicated supplier arm added precisely
      -- so they would not silently stop receiving it. The ruling this came from
      -- is "direct-rail applications never count as the matched agency's
      -- business", which is an exclusion of one rail, not an inclusion of one.
      public.application_channel(a.id) <> 'Direct'
  ),
  per_agency as (
    select ag.id as aid, ag.name as aname, ag.partner_id as apid,
      count(*) filter (where base.status <> 'withdrawn' and base.sent_at >= p_start and base.sent_at < p_end)::int as v_sent,
      count(*) filter (where base.status <> 'withdrawn' and base.sent_at >= p_start and base.sent_at < p_end and base.paid_at is not null)::int as v_sent_paid,
      count(*) filter (where base.paid_at >= p_start and base.paid_at < p_end)::int as v_paid,
      coalesce(sum(coalesce(base.fee_amount, base.monthly_rent)) filter (where base.paid_at >= p_start and base.paid_at < p_end), 0) as v_fees,
      count(*) filter (where base.deed_issued_at >= p_start and base.deed_issued_at < p_end)::int as v_deeds,
      count(*) filter (where base.deed_state = 'awaiting_tenant')::int as v_awaiting
    from public.agencies ag
    left join base on base.agency_id = ag.id
    where not ag.is_placeholder
    group by ag.id, ag.name, ag.partner_id
  ),
  branch_agg as (
    select base.agency_id as aid, base.branch_name as bname,
      coalesce(sum(coalesce(base.fee_amount, base.monthly_rent)) filter (where base.paid_at >= p_start and base.paid_at < p_end), 0) as bf
    from base
    where base.branch_name is not null
    group by base.agency_id, base.branch_name
  ),
  top_branch as (
    select ba.aid, ba.bname, ba.bf,
      row_number() over (partition by ba.aid order by ba.bf desc, ba.bname asc) as rn
    from branch_agg ba
  )
  select pa.aid, pa.aname, pa.apid, pa.v_sent, pa.v_sent_paid, pa.v_paid, pa.v_fees,
         pa.v_deeds, pa.v_awaiting, tb.bname, tb.bf
  from per_agency pa
  left join top_branch tb on tb.aid = pa.aid and tb.rn = 1;
end $function$;

-- commission_statement_lines(date)
CREATE OR REPLACE FUNCTION public.commission_statement_lines(p_month date)
 RETURNS TABLE(payee_key text, level text, org_id uuid, org_name text, partner_id uuid, guarantee_ref text, tenant_name text, tenancy_place text, branch_name text, paid_on date, fee numeric, share_percent numeric, rate numeric, source text, commission numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with bounds as (
    select date_trunc('month', p_month)::date                         as m_start,
           (date_trunc('month', p_month) + interval '1 month')::date  as m_next
  ),
  paid as (
    select a.*
    from public.applications a, bounds b
    where a.paid_at is not null
      and (a.paid_at at time zone 'Europe/London') >= b.m_start
      and (a.paid_at at time zone 'Europe/London') <  b.m_next
      and coalesce(a.payment_state, '') <> 'refunded'
      and a.livemode is true
      /* DIRECT-RAIL BUSINESS IS NEVER THE MATCHED AGENCY'S. Round 6. The
         auto-matcher rewrites a direct application's branch_id and agency_id
         to a real agency so somebody can service it, while pinning partner_id
         to opndoor-direct. This function had no rail test at all -- the only
         money surface without one -- so that application became an
         agency-level PAYEE, and commission-statements posts the PDF and CSV
         to that agency's Directors. What stopped it firing was opndoor-direct's
         agent_rate being 0.0000, i.e. a number an admin can edit on the
         partner-settings screen.

         `<> 'Direct'` and NOT `= 'Agent referral'`: the digest was written the
         second way and silently dropped every supplier, which is round 6's M3
         in the same list of findings. */
      and public.application_channel(a.id) <> 'Direct'
  ),
  -- Named split_line, not line: `line` is a built-in geometric type name, and a
  -- CTE that shadows a type is a trap nobody needs to walk into.
  split_line as (
    -- The frozen split. basis_amount is what the rate was a share of, snapshotted
    -- at creation; the fee is the fallback for rows frozen before that column
    -- existed, and is the same number by construction.
    select p.id as application_id, l.level, l.org_id, l.org_name, l.rate, l.source,
           coalesce(l.basis_amount, p.fee_amount, p.monthly_rent, 0) as basis,
           l.amount as frozen_amount
    from paid p
    join public.application_commission_lines l on l.application_id = p.id
    union all
    -- No split: a historic row, whose money was always the referring agency's.
    select p.id, 'agency', p.agency_id, coalesce(ag.name, '(unknown agency)'),
           coalesce(p.agent_rate, 0), null,
           coalesce(p.fee_amount, p.monthly_rent, 0),
           -- No frozen line at all, so nothing to read: this arm keeps the old
           -- arithmetic, which is all it ever had.
           null::numeric
    from paid p
    left join public.agencies ag on ag.id = p.agency_id
    where not exists (
      select 1 from public.application_commission_lines l where l.application_id = p.id
    )
  )
  select
    -- Same shape as the client's payeeKey (partner slug, level, org), so a payee
    -- has one identity whichever side of the wire names it.
    coalesce(pt.slug, '') || '|' || l.level || ':'
      || coalesce(l.org_id::text, 'name/' || lower(btrim(l.org_name))),
    l.level, l.org_id, l.org_name, p.partner_id,
    p.guarantee_ref,
    btrim(coalesce(p.tenant_first_name, '') || ' ' || coalesce(p.tenant_last_name, '')),
    case
      when p.tenancy_id is null or p.tenancy_position is null then ''
      else p.tenancy_position::text || ' of '
           || (select count(*) from public.applications s where s.tenancy_id = p.tenancy_id)::text
    end,
    coalesce(br.name, ''),
    (p.paid_at at time zone 'Europe/London')::date,
    l.basis, p.share_percent, l.rate, l.source,
    -- THE FROZEN AMOUNT, and round(basis * rate) only for a row frozen before
    -- that column existed. Computing it here per line is the defect: two lines of
    -- one tenancy could each round up and sum to a penny more than the tenancy's
    -- own commission.
    coalesce(l.frozen_amount, round(l.basis * l.rate, 2))
  from split_line l
  join paid p on p.id = l.application_id
  left join public.branches br on br.id = p.branch_id
  left join public.partners pt on pt.id = p.partner_id
$function$;

