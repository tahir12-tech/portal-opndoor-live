-- =========================================================================
-- A SUPPLIER'S AGENCIES ARE NEVER WRITTEN TO. THE SUPPLIER IS.
--
-- Matt, 2026-10-02: "Agencies in a supplier's estate need no finance
-- email. For now, all commission statements for a supplier's agencies go
-- to the supplier (its statement plus the per-agency schedules), never to
-- the agencies, whatever the 'Opndoor pays the agents directly' setting.
-- Remove anything that sends a statement to a supplier-estate agency."
--
-- This replaces yesterday's narrower answer. 20261007390000 excluded the
-- PERSON arm of commission_statement_recipients for a supplier estate and
-- left the agency's finance address, on his earlier sentence that the
-- statement went to "that agency's contact email". It does not: it goes
-- to the supplier.
--
-- TWO CHANGES, AND THE SECOND IS THE ONE WITH THE SUBTLETY.
--
--   1. `commission_statement_recipients` answers NOBODY for any party in
--      a supplier's estate, on the whole function rather than one arm, so
--      the rule cannot be got round by whichever arm somebody adds next.
--      The partner level is untouched and is the point: that is the
--      supplier, and it is who everything goes to.
--
--   2. `commission_statement_payees` gains `supplier_estate`, and the
--      payee STAYS. Where "Opndoor pays the agents directly" is on,
--      Opndoor really does owe that agency the money -- the settlement
--      PDF is "what opndoor owes out for the month, across every payee",
--      and dropping the row would make that figure disagree with the
--      ledger. What changes is that nothing is posted to them. The run
--      skips them by this flag and counts them separately, and the
--      per-agency schedule for that money is already an attachment on the
--      supplier's own email (buildSupplierBundle, since 20261007040000).
--
-- THE FINANCE EMAIL IS NOT TAKEN AWAY from a supplier-estate agency, only
-- stopped from being written to. It is a column an admin may have filled
-- in for their own reasons, and emptying somebody's data to enforce a
-- rule about who we email is the wrong tool.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.commission_statement_recipients(p_level text, p_org_id uuid)
 RETURNS TABLE(email text, full_name text, source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with party as (
    select case when p_level = 'group'   then p_org_id end as group_id,
           case when p_level = 'agency'  then p_org_id end as agency_id,
           case when p_level = 'branch'  then p_org_id end as branch_id,
           case when p_level = 'partner' then p_org_id end as partner_id
  ),
  /* WHICH ESTATE THE PARTY SITS IN. Matt, 2026-10-01: "If Rightmove's
     'Opndoor pays the agents directly' is on, that commission is paid to
     the Rightmove-estate agency and its statement goes to that agency's
     contact email, NEVER INTO ANY LOGIN." Read once here so the person arm
     below can ask it without repeating the three-way join. */
  estate as (
    select coalesce(a.partner_id, b.partner_id, g.partner_id) as partner_id
    from party pa
    left join public.agencies a      on a.id = pa.agency_id
    left join public.branches b      on b.id = pa.branch_id
    left join public.agency_groups g on g.id = pa.group_id
  ),
  -- The party itself plus every party ABOVE it. Upwards only: see the header.
  chain as (
    select coalesce(pa.group_id, ag.group_id, bag.group_id) as group_id,
           coalesce(pa.agency_id, br.agency_id)             as agency_id,
           pa.branch_id                                     as branch_id
    from party pa
    left join public.agencies ag  on ag.id  = pa.agency_id
    left join public.branches br  on br.id  = pa.branch_id
    left join public.agencies bag on bag.id = br.agency_id
  ),
  found as (
    /* THE SUPPLIER'S OWN MANAGEMENT. Matt, 2026-09-30: "sent to the
       supplier's Management users who have statements switched on."

       The same four tests as the agency arm below -- ticked, management
       with the commission bit, active, has an address -- and the boundary
       is `partner_id`, which on this rail IS the company. A supplier's
       REFERRER is refused by the level test, which is what "Management
       users" means and is the half most easily lost. */
    select u.email, u.full_name, 'person'::text as source
    from party pa
    join public.users u on u.partner_id = pa.partner_id
    where pa.partner_id is not null
      and u.receives_commission_statements
      and u.role = 'management' and u.sees_commission
      and u.status = 'active'
      and coalesce(btrim(u.email), '') <> ''
    union all
    /* AND THE NAMED ADDRESSES THAT ARE NOT PORTAL USERS. Matt: "Opndoor
       admin can also add named email addresses that aren't portal users
       (e.g. a finance inbox)."

       A LIST, not a column. Agencies and groups carry a single
       `finance_email`; his word is "addresses", and a supplier plausibly
       wants a finance inbox AND an accounts contact. The table is
       admin-managed and carries a name beside the address so the run can
       say who it wrote to. */
    select r.email, nullif(btrim(r.full_name), ''), 'named'
    from party pa
    join public.partner_statement_recipients r on r.partner_id = pa.partner_id
    where pa.partner_id is not null
      and coalesce(btrim(r.email), '') <> ''
    union all
    select u.email, u.full_name, 'person'::text as source
    from chain c
    join public.user_scopes s
      on (s.kind = 'group'  and s.group_id  = c.group_id)
      or (s.kind = 'agency' and s.agency_id = c.agency_id)
      or (s.kind = 'branch' and s.branch_id = c.branch_id)
    join public.users u on u.id = s.user_id
    -- AND THEY MUST BE ENTITLED TO SEE COMMISSION. The admin-set tick was the
    -- only test, so a Director demoted to Manager kept receiving a PDF of
    -- every commission line for their party: the one figure withheld from a
    -- Manager on every other surface. The LEVEL is the rule; the tick only
    -- says which of the people at that level want the email.
    -- ACTIVE, not "not deactivated". A pending invite has never signed in, so
    -- the portal link in the statement goes somewhere they cannot open. The run
    -- reports a payee it could not address rather than mailing a dead account.
    where u.receives_commission_statements
      -- THE LEVEL, which 20261006410000 claimed in a comment and did not add.
      -- The tick says which of the people entitled to a statement want the
      -- email; it does not confer the entitlement. A Manager or Negotiator
      -- holding it was being posted every commission line for their party.
      and u.role = 'management' and u.sees_commission
      and u.status = 'active'
      and coalesce(btrim(u.email), '') <> ''
    union all
    select f.finance_email, null, 'finance'
    from (
      select ag.finance_email from public.agencies ag, party pa
       where p_level = 'agency' and ag.id = pa.agency_id
      union all
      select gr.finance_email from public.agency_groups gr, party pa
       where p_level = 'group' and gr.id = pa.group_id
    ) f
    where coalesce(btrim(f.finance_email), '') <> ''
  )
  -- One address, once. A finance mailbox that is also somebody's login would
  -- otherwise receive the statement twice, from two different reasons.
  select distinct on (lower(btrim(r.email))) btrim(r.email), r.full_name, r.source
  from found r
  /* AND NOBODY AT ALL FOR AN AGENCY IN A SUPPLIER'S ESTATE. Matt,
     2026-10-02: "all commission statements for a supplier's agencies go
     to the supplier (its statement plus the per-agency schedules), never
     to the agencies, whatever the 'Opndoor pays the agents directly'
     setting."

     ON THE WHOLE FUNCTION, not on one arm. Yesterday this excluded the
     PERSON arm only, leaving the agency's finance address. The ruling is
     that the agency is not written to at all, so the test belongs where
     it cannot be got round by whichever arm somebody adds next.

     The PARTNER level is untouched and is the point: that is the
     supplier itself, and it is who everything now goes to. */
  where not coalesce((select public.is_supplier_estate(e.partner_id) from estate e), false)
  order by lower(btrim(r.email)), r.source desc
$function$;

-- The row gained a column, so the function is dropped and recreated
-- rather than replaced. Nothing depends on it in SQL; its callers are the
-- statement run and the pgTAP suite.
drop function if exists public.commission_statement_payees(date);

create or replace function public.commission_statement_payees(p_month date)
returns table (
  payee_key  text,
  level      text,
  org_id     uuid,
  org_name   text,
  partner_id uuid,
  line_count integer,
  total      numeric,
  /* IS THIS PAYEE AN AGENCY INSIDE A SUPPLIER'S ESTATE? Matt, 2026-10-02:
     "all commission statements for a supplier's agencies go to the
     supplier (its statement plus the per-agency schedules), never to the
     agencies."

     THE PAYEE STAYS. Where "Opndoor pays the agents directly" is on,
     Opndoor really does owe that agency the money, and the settlement
     total is what Opndoor owes out. What changes is that nothing is
     POSTED to them: the run skips them by this flag, and the per-agency
     schedule for that money travels inside the supplier's own email.
     Dropping the row instead would have made the settlement figure
     disagree with the ledger, which is a worse lie than a payee with no
     letter. Always false at partner level: that IS the supplier. */
  supplier_estate boolean
)
language sql stable security definer set search_path to ''
as $function$
  select g.payee_key, g.level, g.org_id,
         -- The party's CURRENT name, not the one frozen onto the oldest line in
         -- the month. This is addressed to them; an agency that rebranded in
         -- March should not read its old name on an April statement.
         coalesce(
           case g.level
             when 'agency' then ag.name
             when 'group'  then gr.name
             when 'branch' then br.name
             -- A SUPPLIER PAYEE IS THE COMPANY. On that rail partner_id IS
             -- the company, which is the one rail where that is true.
             when 'partner' then pr.name
           end,
           g.frozen_name
         ),
         g.partner_id, g.line_count, g.total,
         coalesce(public.is_supplier_estate(
           case g.level
             when 'agency' then ag.partner_id
             when 'group'  then gr.partner_id
             when 'branch' then br.partner_id
           end), false)
  from (
    select l.payee_key, l.level, l.org_id, l.partner_id,
           count(*)::int as line_count,
           sum(l.commission) as total,
           min(l.org_name) as frozen_name
    from public.commission_statement_lines(p_month) l
    group by l.payee_key, l.level, l.org_id, l.partner_id
  ) g
  left join public.agencies      ag on g.level = 'agency' and ag.id = g.org_id
  left join public.agency_groups gr on g.level = 'group'  and gr.id = g.org_id
  left join public.branches      br on g.level = 'branch' and br.id = g.org_id
  left join public.partners      pr on g.level = 'partner' and pr.id = g.org_id
  order by g.total desc, g.frozen_name
$function$;

/* AND ITS GRANTS COME BACK WITH IT. `drop function` takes the revokes
   with it and `create` hands EXECUTE to PUBLIC again, which is how a
   recreated function quietly becomes callable from the browser. It
   carries every agency's and supplier's commission total, and has been
   service-role only since 20261005140000. */
revoke all on function public.commission_statement_payees(date) from public, anon, authenticated;
grant execute on function public.commission_statement_payees(date) to service_role;

-- The function's shape changed, so re-state what it is for.
comment on function public.commission_statement_payees(date) is
  'Everybody owed commission for a month, with their total. supplier_estate marks an agency inside a supplier''s estate: still owed where "Opndoor pays the agents directly" is on, never posted a statement, and carried instead as a schedule inside the supplier''s own email.';

-- ---------------------------------------------------------------------------
-- AND IT HOLDS ON THIS DATABASE. Kestrel has "Opndoor pays the agents
-- directly" on and one agency with paid business, which is exactly the
-- case the ruling is about, so this is not hypothetical here.
-- ---------------------------------------------------------------------------
do $$
declare v_ag uuid; v_recipients int; v_flagged int;
begin
  select p.org_id into v_ag
  from public.commission_statement_payees(date_trunc('month', current_date - interval '1 month')::date) p
  where p.supplier_estate limit 1;

  if v_ag is null then
    raise notice 'no supplier-estate payee last month on this database; nothing to check';
    return;
  end if;

  select count(*) into v_recipients
  from public.commission_statement_recipients('agency', v_ag);

  select count(*) into v_flagged
  from public.commission_statement_payees(date_trunc('month', current_date - interval '1 month')::date) p
  where p.level = 'partner' and p.supplier_estate;

  if v_recipients > 0 then
    raise exception 'a supplier-estate agency still has % statement recipient(s)', v_recipients;
  end if;
  if v_flagged > 0 then
    raise exception 'a partner-level payee was marked as being inside a supplier estate';
  end if;
end $$;
