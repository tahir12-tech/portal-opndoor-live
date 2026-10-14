-- AN AGENCY WITH NO OFFICE STILL HAS A DEAL, AND GETS AN OFFICE.
--
-- Matt, 2026-10-09, from the live walk:
--
--   "An independent agency should get its one office created automatically
--    when it's added. An agency with no office should still show its deal on
--    the Agreement card and Commission tab, without the change log printing
--    a 0.00% total."
--
-- WHAT HE SAW ON LIVE. Regent Letting & Property Management was created with
-- no office. Its deal is stored exactly as he entered it, 1 tenant at 3 weeks
-- and 20%, 2 or more at 5 weeks and 25%, and all three surfaces lied about it:
--
--   * the Agreement card said "Standard terms", because
--     `agreement_for_agency` opens by taking the agency's FIRST BRANCH and
--     resolving the price from it. No branch, no row, and the card falls into
--     its `!agreement` arm;
--   * the Commission tab says the same thing, because its top panel IS that
--     card;
--   * the change log said "worst branch total 0.00%", because
--     `assert_agreement_within_cap` reads every branch the agreement reaches
--     and coalesces an empty result to 0.
--
-- THREE SYMPTOMS, TWO CAUSES, AND ONLY ONE OF THEM IS THE DISPLAY. The deal
-- was always right. So this migration fixes the reading in both places and
-- then removes the condition, in that order, because the reading has to be
-- right for the agencies that already exist with no office and cannot be
-- fixed by a better creation path.
--
-- NOTHING HERE TOUCHES THE REFERRAL PATH. `resolve_pricing_agreement`,
-- `resolve_fee` and `create_referral` are unchanged, and the new resolver is
-- a sibling with its own name rather than an overload, because PostgREST
-- resolves by argument name and `resolve_pricing_agreement` is called from
-- four SQL functions positionally.

-- ---------------------------------------------------------------------------
-- 1. THE DEAL RESOLVES FROM THE AGENCY, not only from one of its offices.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_pricing_agreement_for_agency(
  p_agency uuid, p_route_partner uuid, p_tenant_count integer default 1,
  p_kind text default 'commission', p_branch uuid default null
)
returns table(id uuid, scope_level text, fee_basis_weeks numeric, fee_basis_unit text, agent_rate numeric)
language sql stable security definer set search_path to ''
as $function$
  /* THE SAME RESOLVER, ASKED OF THE AGENCY. Everything below this CTE is
     byte for byte resolve_pricing_agreement's body, and deliberately so:
     the ladder, the member rule, the unmarked-default arm and the ordering
     are the money and must not fork. Only the CONTEXT differs, because a
     branch is how the referral path finds the agency and is not the only
     way to have one.

     resolve_pricing_agreement reads its context from public.branches, so an
     agency with no office resolved to no rows and therefore to no deal.
     p_branch survives, last and optional, because the TIER still counts
     volume per branch wherever there is one. */
  with ctx as (
    select a.id as agency_id, a.group_id
    from public.agencies a
    where a.id = p_agency
  ),
  agreement as (
    select pa.*,
           /* IS THIS AGENCY NAMED ON THIS DEAL. Computed once here so the
              ordering below can prefer a membered deal over the default
              without asking the question twice. */
           exists (
             select 1 from public.pricing_agreement_members m, ctx
             where m.agreement_id = pa.id and m.agency_id = ctx.agency_id
           ) as is_member
    from public.pricing_agreements pa, ctx
    where pa.ended_at is null
      and pa.kind = p_kind
      and pa.effective_from <= current_date
      and (pa.effective_to is null or pa.effective_to >= current_date)
      and (
        (pa.scope_level = 'agency'  and pa.scope_id = ctx.agency_id)
        or (pa.scope_level = 'group'   and ctx.group_id is not null and pa.scope_id = ctx.group_id)
        or (pa.scope_level = 'partner' and pa.scope_id = p_route_partner
            /* A PARTNER-SCOPE SHARE DEAL REACHES THIS BRANCH ONLY IF IT IS
               THIS AGENCY'S. A deal with members applies to its members; the
               default applies to everybody else. A membered deal that does
               not name this agency is not a weaker match for it -- it is not
               a match at all, and leaving it in the running would hand the
               agency another agency's terms whenever the default happened to
               sort after it. */
            and (
              p_kind <> 'agent_share'
              or pa.is_default_share
              or exists (
                select 1 from public.pricing_agreement_members m, ctx
                where m.agreement_id = pa.id and m.agency_id = ctx.agency_id
              )
              /* AND A DEAL THAT IS NEITHER IS STILL A DEAL.

                 Without this arm a partner-scope share deal written by
                 anything that does not know about `is_default_share` --
                 a direct insert, a fixture, a migration written next year
                 -- reaches no agency at all and prices nothing, silently,
                 while sitting on the screen looking live. Two tests found
                 it within a minute of the column existing.

                 So the rule is: a deal with members applies to its
                 members; a deal with none applies to everybody else,
                 whether or not anybody remembered to mark it. The mark
                 then buys exactly one thing -- the unique index that
                 stops a supplier having two defaults -- rather than being
                 load-bearing for the money. */
              or not exists (
                select 1 from public.pricing_agreement_members m
                where m.agreement_id = pa.id
              )
            ))
      )
    /* MOST SPECIFIC WINS, which is also where "per-agency overrides" comes
       from: an agency-scope deal beats the supplier's own. A deal this
       agency is NAMED on beats the supplier's default, which is the new
       rung and the reason `is_member` sorts before the date. */
    order by case pa.scope_level when 'agency' then 1 when 'group' then 2 else 3 end,
             /* THE OUTPUT COLUMN, not `pa.is_member`: it is computed by this
                select and is not a column of the table, so qualifying it
                fails to parse. */
             is_member desc,
             /* and a MARKED default beats an unmarked one, so the fallback
                arm above can never quietly outrank the real default. */
             pa.is_default_share desc,
             pa.effective_from desc
    limit 1
  ),
  band as (
    select b.* from public.pricing_agreement_bands b, agreement ag
    where b.agreement_id = ag.id
      and b.min_tenants <= p_tenant_count
      and (b.max_tenants is null or b.max_tenants >= p_tenant_count)
    order by b.min_tenants desc
    limit 1
  ),
  tier as (
    select t.* from public.commission_tiers t, agreement ag
    where t.agreement_id = ag.id
      and public.agreement_volume(ag.id, p_branch, p_route_partner) >= t.from_count
      and (t.to_count is null or public.agreement_volume(ag.id, p_branch, p_route_partner) < t.to_count)
    order by t.from_count desc
    limit 1
  )
  select ag.id, ag.scope_level,
         (select fee_basis_weeks from band), (select fee_basis_unit from band),
         coalesce((select agent_rate from tier), (select agent_rate from band))
  from agreement ag
$function$;

comment on function public.resolve_pricing_agreement_for_agency(uuid, uuid, integer, text, uuid) is
  'The deal in force for one AGENCY, resolved most-specific-wins exactly as resolve_pricing_agreement does for a branch. Exists because an agency with no office has no branch to resolve from, and its deal is still its deal.';

revoke all on function public.resolve_pricing_agreement_for_agency(uuid, uuid, integer, text, uuid) from public, anon;
grant execute on function public.resolve_pricing_agreement_for_agency(uuid, uuid, integer, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. THE AGENCY'S DEAL, WITH OR WITHOUT AN OFFICE.
--
-- Same shape, same columns, same meaning. Three changes:
--
--   * THE GATE MOVED, and that is the load-bearing one. It used to sit inside
--     the first-branch CTE, so an agency with no branch ran no authorisation
--     test at all. It returned nothing anyway, which is why nothing was ever
--     exposed; but a function about to start answering for branchless
--     agencies cannot keep its only permission check inside a branch lookup.
--     It is now its own CTE, keyed on the agency.
--   * THE ROUTE falls back to the agency's own partner when there is no
--     branch to read one from.
--   * THE RESOLVER is the agency one. For an agency that HAS branches the
--     context it builds is identical (the same agency_id and group_id), so
--     the answer does not move for anybody who was already working.
-- ---------------------------------------------------------------------------
create or replace function public.agreement_for_agency(p_agency uuid)
returns table(agreement_id uuid, scope_level text, coverage text, period text,
              counting_scope text, is_standard boolean, note text, effective_from date,
              period_start date, volume integer, volumes jsonb,
              bands jsonb, tiers jsonb, next_rate numeric, next_basis numeric)
language plpgsql stable security definer set search_path to ''
as $function$
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  return query
  with gate as (
    -- AN AGREEMENT IS COMMERCIALLY SENSITIVE, and it is also a commission
    -- figure: both tests, and both on the agency rather than on one of its
    -- offices, because the agency is the thing being priced.
    select a.id as agency_id, a.partner_id, a.group_id
    from public.agencies a
    where a.id = p_agency
      and public.app_may_reach_agency(p_agency)
      and public.may_see_commission()
  ),
  b1 as (
    select b.id as branch_id, b.partner_id
    from public.branches b, gate g
    where b.agency_id = g.agency_id
    order by b.created_at limit 1
  ),
  -- THE ROUTE. An agency's own partner is the route its own people refer on,
  -- and with no office it is the only answer there is.
  route as (
    select coalesce((select partner_id from b1), (select partner_id from gate)) as partner_id
  ),
  r as (
    select * from public.resolve_pricing_agreement_for_agency(
      (select agency_id from gate), (select partner_id from route), 1,
      'commission', (select branch_id from b1))
  ),
  -- EVERY ROUTE THIS AGENCY HAS ACTUALLY TRANSACTED ON. applications.partner_id
  -- is the route, frozen at creation, so this is the honest list: the routes
  -- money has come down, rather than every relationship on file.
  routes as (
    select distinct ap.partner_id as route_id
    from public.applications ap
    where ap.agency_id = p_agency and ap.paid_at is not null and ap.livemode
      and exists (select 1 from gate)
      and public.application_channel(ap.id) <> 'Direct'
  )
  select pa.id, pa.scope_level, pa.coverage, pa.period, pa.counting_scope, pa.is_standard, pa.note, pa.effective_from,
         public.agreement_period_start(pa.id),
         -- Unchanged meaning: the agency's own route. Null branch counts 0,
         -- which is the truth for an agency that cannot yet have been paid.
         public.agreement_volume(pa.id, (select branch_id from b1), (select partner_id from route)),
         -- And every route it has, so two suppliers read as two counters.
         (select coalesce(jsonb_agg(jsonb_build_object(
             'route_id', rt.route_id,
             'route', coalesce(p2.name, 'Unknown route'),
             'count', public.agreement_volume(pa.id, (select branch_id from b1), rt.route_id)
           ) order by coalesce(p2.name, '')), '[]'::jsonb)
          from routes rt left join public.partners p2 on p2.id = rt.route_id),
         (select coalesce(jsonb_agg(jsonb_build_object(
             'min', bd.min_tenants, 'max', bd.max_tenants,
             'weeks', bd.fee_basis_weeks, 'unit', bd.fee_basis_unit, 'rate', bd.agent_rate) order by bd.min_tenants), '[]'::jsonb)
            from public.pricing_agreement_bands bd where bd.agreement_id = pa.id),
         (select coalesce(jsonb_agg(jsonb_build_object(
             'from', t.from_count, 'to', t.to_count, 'rate', t.agent_rate) order by t.from_count), '[]'::jsonb)
            from public.commission_tiers t where t.agreement_id = pa.id),
         (select agent_rate from r), (select fee_basis_weeks from r)
  from public.pricing_agreements pa
  where pa.id = (select id from r);
end $function$;

comment on function public.agreement_for_agency(uuid) is
  'The pricing agreement in force for one agency, with its bands, tiers and '
  'volume. `volume` is the count on the agency''s own route; `volumes` is one '
  'entry per route it has paid business on, because an agency under two '
  'suppliers is one party with two counters and not one pooled total '
  '(Matt, 2026-08-17). Resolves from the AGENCY, so an agency with no office '
  'still reads its own deal (Matt, 2026-10-09).';

revoke all on function public.agreement_for_agency(uuid) from public, anon;
grant execute on function public.agreement_for_agency(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. THE CHANGE LOG STOPS CLAIMING A TOTAL NOBODY PAYS.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_agreement(p_level text, p_id uuid, p_coverage text, p_period text, p_counting_scope text, p_bands jsonb, p_tiers jsonb DEFAULT '[]'::jsonb, p_note text DEFAULT NULL::text, p_confirm_replace boolean DEFAULT false, p_confirm_breach boolean DEFAULT false, p_kind text DEFAULT 'commission'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid; c record; v_actor text; v_n int; b jsonb; t jsonb; v_worst numeric;
  v_detail text; v_mx numeric; r record; v_breached boolean := false;
  v_default_share boolean; v_gap int;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_kind not in ('commission', 'agent_share') then
    raise exception 'A deal is either a commission or an agents'' share.' using errcode = '22023';
  end if;
  if p_coverage not in ('additive','all_in') then
    raise exception 'Coverage must be additive or all-in.' using errcode = '22023';
  end if;
  if p_coverage = 'all_in' and p_level not in ('group','agency') then
    raise exception 'An all-in agreement covers everything under a group or an agency, so it cannot sit on a %.', p_level
      using errcode = '22023';
  end if;
  if p_kind = 'agent_share' and p_coverage <> 'additive' then
    raise exception 'An agents'' share is a part of the commission, so it cannot be all-in.' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_bands,'[]'::jsonb)) < 1 then
    raise exception 'An agreement needs at least one tenant-count band.' using errcode = '22023';
  end if;

  /* A COMMISSION DEAL SETS THE TENANT'S PRICE AND MUST SAY WHAT IT IS. The
     column is nullable now so a share band can leave it alone; that must not
     become a way to save a commission deal that prices nothing. */
  if p_kind = 'commission' and exists (
    select 1 from jsonb_array_elements(p_bands) x
     where nullif(x->>'weeks','') is null or (x->>'weeks')::numeric <= 0
  ) then
    raise exception 'Every band needs the fee the tenant pays.' using errcode = '22023';
  end if;

  select count(*) into v_n from public.agreement_conflicts(p_level, p_id, p_coverage, p_kind);
  if v_n > 0 and not p_confirm_replace then
    raise exception 'This would replace % existing arrangement(s). Confirm to clear them.', v_n
      using errcode = '22023';
  end if;

  select max((x->>'rate')::numeric) into v_mx from jsonb_array_elements(p_bands) x;
  if p_coverage = 'all_in' then
    for r in select * from public.rate_above_all_in(p_level, p_id) loop
      v_breached := true;
      v_detail := public.all_in_breach_sentence(
        r.party_name, r.rate,
        (select name from public.agencies where id = p_id), v_mx);
      if not coalesce(p_confirm_breach, false) then
        raise exception '%', v_detail using errcode = '22023';
      end if;
    end loop;
    if v_breached then perform set_config('app.confirm_all_in_breach', 'on', true); end if;
  end if;

  select full_name into v_actor from public.users where id = auth.uid();

  for c in select * from public.agreement_conflicts(p_level, p_id, p_coverage, p_kind) loop
    if c.kind = 'rate' then
      insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
      values (c.level, c.node_id, 'rate_cleared_for_agreement',
              c.node_name || ' ' || c.detail || ', cleared because an agreement now prices it',
              coalesce(v_actor,'an administrator'), auth.uid());
      if c.level = 'agency'   then update public.agencies      set agent_rate = null where id = c.node_id;
      elsif c.level = 'group' then update public.agency_groups set agent_rate = null where id = c.node_id;
      else                         update public.branches      set agent_rate = null where id = c.node_id;
      end if;
    else
      insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
      values (c.level, c.node_id, 'agreement_superseded',
              coalesce(c.node_name,'A party') || ' ' || c.detail || ', ended because '
              || case when c.level = p_level and c.node_id = p_id
                      then 'a new agreement replaces it'
                      else 'an all-in agreement now covers it' end,
              coalesce(v_actor,'an administrator'), auth.uid());
      update public.pricing_agreements set ended_at = now()
       where scope_level = c.level and scope_id = c.node_id and not is_standard
         and kind = p_kind
         and ended_at is null;
    end if;
  end loop;

  /* THE FIRST AGENTS' SHARE DEAL A SUPPLIER GETS IS ITS DEFAULT, and the
     ones after it are not. Matt, 2026-10-01: "One default deal for all
     agencies, plus extra deals that each apply to agencies picked from a
     searchable list."

     Decided here rather than asked of the caller, because there is exactly
     one right answer and it is derivable: a supplier with no default has no
     terms for the agencies nobody has named, so the deal being written is
     them. A caller that had to pass a flag could get it wrong, and the one
     way to get it wrong leaves a supplier with no default at all.

     `pricing_agreements_one_default_share` is the backstop if two of these
     ever race. */
  v_default_share := p_kind = 'agent_share' and p_level = 'partner' and not exists (
    select 1 from public.pricing_agreements pa
    where pa.scope_level = 'partner' and pa.scope_id = p_id
      and pa.kind = 'agent_share' and pa.is_default_share and pa.ended_at is null
  );

  insert into public.pricing_agreements
    (scope_level, scope_id, coverage, period, counting_scope, note, created_by, effective_from, is_standard, kind, is_default_share)
  values (p_level, p_id, p_coverage, p_period, p_counting_scope, p_note, auth.uid(), current_date, false, p_kind, v_default_share)
  returning id into v_id;

  for b in select * from jsonb_array_elements(p_bands) loop
    insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, fee_basis_unit, agent_rate)
    values (v_id, coalesce((b->>'min')::int, 1), nullif(b->>'max','')::int,
            /* NULL ON A SHARE BAND, whatever the caller sent. The screen does
               not offer the field; this makes the rule the function's rather
               than the screen's, so a direct caller cannot store one either. */
            case when p_kind = 'agent_share' then null else (b->>'weeks')::numeric end,
            case when b->>'unit' = 'months' then 'months' else 'weeks' end,
            nullif(b->>'rate','')::numeric);
  end loop;
  for t in select * from jsonb_array_elements(coalesce(p_tiers,'[]'::jsonb)) loop
    insert into public.commission_tiers (agreement_id, from_count, to_count, agent_rate)
    values (v_id, (t->>'from')::int, nullif(t->>'to','')::int, (t->>'rate')::numeric);
  end loop;

  /* EVERY TENANT COUNT MUST HAVE A PRICE.

     Matt, 2026-10-04: "refuse to save a deal that leaves any tenant count or
     volume unpriced."

     resolve_pricing_agreement matches a band with
     `min_tenants <= n and (max_tenants is null or max_tenants >= n)` and
     returns NOTHING when none matches, so the fee basis and the rate both
     come back null and the referral falls back to standard terms in silence.
     A deal with a closed top band therefore prices some tenancies and
     silently abandons the rest; "1 to 1" is the shape that does it and is
     what the dialog produced when somebody switched to one-price.

     HERE RATHER THAN ONLY IN THE DIALOG, because the dialog is not the only
     way in: this function is granted to authenticated and a deal can be
     written by anything that can call it.

     VOLUME NEEDS NO EQUIVALENT, which is worth saying so nobody adds one: a
     tier that matches nothing falls back to the band's own rate, by the
     coalesce in resolve_pricing_agreement and in agreement_rate_at. A gap in
     the tiers changes which rate applies; a gap in the bands means there is
     no price at all. Only the second can abandon a referral. */
  v_gap := public.agreement_tenant_gap(v_id);
  if v_gap is not null then
    raise exception
      'This deal prices nothing for % tenants, so a tenancy that size would fall back to our usual terms. Give the last band no upper limit, or add one that covers %.',
      v_gap, v_gap
      using errcode = '22023';
  end if;

  if p_kind = 'commission' then
    v_worst := public.assert_agreement_within_cap(v_id);
  else
    v_worst := 0;
  end if;

  /* THE AGENTS' SHARE MAY NOT EXCEED THE SUPPLIER'S TOTAL, CHECKED FOR EVERY
     SUPPLIER THIS DEAL REACHES, not only when the deal is the supplier's own.

     Matt, 2026-10-04: "when any deal is saved (supplier or agency-level within
     a supplier), refuse it if the agency's share could exceed the supplier's
     total at any tenant count or volume".

     THE OLD TEST WAS `p_level = 'partner'`, and that is exactly how the
     Kestrel breach was saved: an AGENCY-scope commission deal of 26% at three
     tenants went in without the guard being consulted at all, because the
     deal was not the supplier's own. The scope being saved is not the scope
     that gets breached.

     RESOLVED THROUGH THE BRANCHES rather than from the scope id, so one loop
     answers all three levels and a group spanning two suppliers checks both.
     A partner-scope deal is also asserted directly, because a supplier with
     no branches yet still has a total and every fixture starts there. */
  for r in
    select distinct b.partner_id as pid
    from public.branches b
    join public.agencies a on a.id = b.agency_id
    where (p_level = 'agency'  and a.id = p_id)
       or (p_level = 'group'   and a.group_id = p_id)
       or (p_level = 'partner' and b.partner_id = p_id)
  loop
    perform public.assert_supplier_share_within_total(r.pid);
  end loop;
  if p_level = 'partner' then
    perform public.assert_supplier_share_within_total(p_id);
  end if;

  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values (p_level, p_id,
          case p_kind when 'agent_share' then 'agent_share_created' else 'agreement_created' end,
          p_coverage || ' ' || case p_kind when 'agent_share' then 'agents'' share' else 'agreement' end
          || ', volume per ' || p_counting_scope || ' per ' || p_period ||
          /* A TOTAL NOBODY PAYS IS NOT A TOTAL. assert_agreement_within_cap
             reads every branch the agreement reaches and coalesces an empty
             result to 0, so an agency with no office logged "worst branch
             total 0.00%" beside a 25% deal. Matt reported exactly that on
             Regent, 2026-10-09. The cap itself is right to pass: there is
             nothing to take past 50%. Only the sentence was wrong. */
          case when p_kind <> 'commission' then ''
               when not exists (
                 select 1
                 from public.branches b3
                 join public.agencies a3 on a3.id = b3.agency_id
                 where (p_level = 'agency'  and a3.id = p_id)
                    or (p_level = 'group'   and a3.group_id = p_id)
                    or (p_level = 'partner' and b3.partner_id = p_id))
                 then ', no office yet, so there is no branch total'
               else ', worst branch total ' || to_char(round(v_worst * 100, 2), 'FM999990.00') || '%'
          end,
          coalesce(v_actor,'an administrator'), auth.uid());

  if v_breached then
    for r in select * from public.rate_above_all_in(p_level, p_id) loop
      v_detail := public.all_in_breach_sentence(r.party_name, r.rate,
        (select name from public.agencies where id = p_id), v_mx);
      insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
      values (p_level, p_id, 'all_in_breach_confirmed', v_detail,
              coalesce(v_actor,'an administrator'), auth.uid());
      insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
      select 'group', a.group_id, 'all_in_breach_confirmed', v_detail,
             coalesce(v_actor,'an administrator'), auth.uid()
      from public.agencies a where a.id = p_id and a.group_id is not null;
    end loop;
    perform set_config('app.confirm_all_in_breach', 'off', true);
  end if;

  return v_id;
end $function$


;

-- ---------------------------------------------------------------------------
-- 4. AND A NEW INDEPENDENT AGENCY ARRIVES WITH ITS ONE OFFICE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_add_agency(p_name text, p_group text DEFAULT NULL::text, p_partner_slug text DEFAULT NULL::text, p_contact_email text DEFAULT NULL::text, p_contact_name text DEFAULT NULL::text, p_contact_phone text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid(); who text; pid uuid; ag_id uuid; br_id uuid;
  v_admin boolean := public.is_admin();
  v_slug text := nullif(btrim(coalesce(p_partner_slug,'')),''); v_email text := btrim(coalesce(p_contact_email,''));
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  /* ON OUR OWN ESTATE, CREATING AN AGENCY IS OPNDOOR'S ACT. The house partner
     is shared, so a Manager creating an agency on it is creating a sibling
     beside their own, not adding to their own book. A SUPPLIER's manager
     still creates agencies under their own partner, which is their book. */
  if not coalesce((v_admin or (public.app_role() = 'management'
                      and not public.is_our_estate_partner(public.app_partner()))), false) then raise exception 'Not permitted.' using errcode = '42501'; end if;
  if btrim(coalesce(p_name,'')) = '' then raise exception 'Agency name is required' using errcode = '22023'; end if;
  if v_email <> '' and v_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then raise exception 'Enter a valid agency contact email.' using errcode = '22023'; end if;
  pid := public.app_partner();
  if pid is null then
    if v_slug is null then raise exception 'Select a specific partner before adding an agency.' using errcode = '22023'; end if;
    select id into pid from public.partners where slug = v_slug;
    if pid is null then raise exception 'Unknown partner.' using errcode = '22023'; end if;
  end if;
  /* REQUIRED ON THE SUPPLIER SIDE ONLY. Matt, 2026-10-02, correcting the
     rule he had given an hour earlier:

       "Supplier side (agencies in a supplier's estate): an agency email
        is required at creation and is the default for all its branches
        ... Opndoor's own agencies (like Regent): no email required.
        Signed deeds go to whoever sent the referral (plus the people
        already ticked to receive them, as now)."

     The requirement moved AFTER the partner is resolved, because until
     then there is no estate to ask about. On our own estate the deed has
     a ladder of real people to go to, so a missing mailbox is not a gap
     and must not be reported as one. */
  if v_email = '' and coalesce(public.is_supplier_estate(pid), false) then
    raise exception 'An agency email is required for an agency that comes through a supplier. Signed deeds for its branches go there.'
      using errcode = '22023';
  end if;
  -- A deliberate org-tool add by admin OR management lands confirmed (instant).
  if exists (select 1 from public.agencies where partner_id = pid and lower(name) = lower(btrim(p_name))) then
    raise exception 'An agency with that name already exists for this partner.' using errcode = '23505';
  end if;
  who := coalesce((select full_name from public.users where id = me), 'an administrator');
  insert into public.agencies(name, group_name, partner_id, review_state, created_by)
  values (btrim(p_name), nullif(btrim(coalesce(p_group,'')),''), pid, 'confirmed', me) returning id into ag_id;
  insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
  values ('agency', ag_id, 'created', btrim(p_name) || ' (added on the Agencies screen)', who, me);
  /* AND ITS ONE OFFICE, because an agency with none cannot be referred to,
     cannot receive a deed and could not even show its own deal.

     Matt, 2026-10-09: "An independent agency should get its one office
     created automatically when it's added." Regent went on to live with no
     office and that is what made its deal read as standard terms and its
     change log print a 0.00% total.

     NAMED AFTER THE AGENCY, which is not a placeholder: NM-P already rules
     that a single-office agency IS the agency, so `officeNameAddsNothing`
     hides this name wherever one office is all there is, and
     20261008290000 keeps it following the agency if the agency is renamed.
     A second office later makes this one visible under the agency's own
     name, which is the honest reading of where its first business sat.

     OUR OWN ESTATE ONLY. A supplier's agencies get their offices from the
     supplier, or from the referral that names one, and inventing one here
     would put a confirmed office on somebody else's book.

     `is_placeholder` is left at its default: this is a real office, the
     only one, and the agency's own name is its real name. */
  if not coalesce(public.is_supplier_estate(pid), false) then
    insert into public.branches(name, agency_id, partner_id, review_state, created_by)
    values (btrim(p_name), ag_id, pid, 'confirmed', me) returning id into br_id;
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('branch', br_id, 'created',
            btrim(p_name) || ' (created with the agency, which has one office)', who, me);
  end if;

  -- Only when there is one. On our own estate it is optional, and an
  -- empty contact row would be a mailbox with no address in it.
  if v_email <> '' then
    insert into public.agent_contacts(agency_id, partner_id, name, email, phone, is_primary, created_by)
    values (ag_id, pid, btrim(coalesce(p_contact_name,'')), v_email, nullif(btrim(p_contact_phone),''), true, me);
  end if;
  return ag_id;
end $function$;
