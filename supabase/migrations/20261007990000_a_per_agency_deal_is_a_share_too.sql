-- A PER-AGENCY DEAL IS A SHARE TOO, AND IT IS CHECKED ON SAVE.
--
-- Matt, 2026-10-04, verbatim: "when any deal is saved (supplier or
-- agency-level within a supplier), refuse it if the agency's share could
-- exceed the supplier's total at any tenant count or volume, with a plain
-- message saying which band breaks it."
--
-- Test: supabase/tests/a_per_agency_deal_is_a_share_too.test.sql
--
-- =========================================================================
-- THE HOLE WAS THE SCOPE, NOT THE SWEEP
-- =========================================================================
--
-- `supplier_share_breaches` already walked every breakpoint of both deals,
-- which is the hard half and is 20261007190000's. What it compared was the
-- PARTNER-scope commission deal against the PARTNER-scope agent_share deals.
--
-- The deal that breached on Kestrel is neither: it is an AGENCY-scope
-- COMMISSION deal, 3 weeks at 12% for one tenant, 5 at 20% for two, 6 at 26%
-- for three. 20261007190000 left per-agency overrides unbuilt on the stated
-- ground that "PER-AGENCY OVERRIDES NEEDS NOTHING AT ALL", because an
-- agency-scope agreement already wins resolve_pricing_agreement's ordering.
-- That is true, and it is true in `commission_split`, which is the SHARE. It
-- is deliberately NOT true in `resolve_rates`, which skips a non-partner deal
-- for the TOTAL so an agency's own rate is not double-counted as the
-- supplier's margin (20261007200000 says so in as many words).
--
-- So the share moved with the override and the total did not, and the two
-- were never compared. MEASURED on dev: 0.2600 against 0.2500 at three
-- tenants. It was unreachable until 20261006970000 opened the supplier rail
-- to joint tenancies, because at one tenant only the first band resolves.
--
-- =========================================================================
-- THE SHARE IS THE SUM OF THE SPLIT, NOT THE BAND'S OWN RATE
-- =========================================================================
--
-- An override fills ONE slot. The branch, group and partner slots can carry
-- their own flat rates alongside it, and what a referral actually pays out is
-- the sum. So the new arm sums `commission_split_for` -- the same function
-- `assert_agreement_within_cap` uses for the 50% cap -- at the override's
-- rate for that band. Reusing it means this guard cannot drift from what is
-- charged, and it counts the slots an override does not fill.
--
-- WORST BRANCH OF THE AGENCY, because one breaching branch is a breach.
--
-- =========================================================================
-- SIBLINGS ARE STILL EXEMPT, AND THAT IS MATT'S OWN RULE, NOT AN EXCEPTION
-- =========================================================================
--
-- 20261007230000, from his words: with "Opndoor pays the agents directly" ON,
-- `partner_rate` is the SUPPLIER'S OWN and the total is the SUM of the two
-- deals. There is then no "supplier's total" for a share to sit inside, so
-- "the agency's share could exceed the supplier's total" has nothing to test.
-- Those estates are bounded instead by the 50% hard cap in
-- `assert_agreement_within_cap`, which every commission save passes through.
-- Stated here because a reader comparing this guard with Matt's sentence will
-- otherwise think the ON shape was forgotten.
--
-- =========================================================================
-- AND WHICH BAND, WHICH IS THE PART THE OLD MESSAGE COULD NOT SAY
-- =========================================================================
--
-- The checker now returns the agency and the band in the editor's own words
-- ("3 or more tenants"), so the refusal names the row to go and change. The
-- volume is mentioned only where a tier exists, because "at 0 referrals" in a
-- message about a flat deal reads as a bug.

drop function if exists public.supplier_share_breaches(uuid);

create or replace function public.supplier_share_breaches(p_partner uuid)
returns table(
  tenants integer, volume integer, total_rate numeric, share_rate numeric,
  agency_name text, band text, scope text
)
language sql stable security definer set search_path to ''
as $function$
  with total_deal as (
    select public.active_agreement_of_kind('partner', p_partner, 'commission') as id
  ),
  /* ARM A: THE SHARE DEALS, unchanged in meaning. Every partner-scope
     agent_share deal, the default and the bespoke ones alike, because a deal
     with members applies to its members and 20261007240000 made that a set
     rather than a single row. */
  share_deals as (
    select pa.id, null::uuid as agency_id, 'share'::text as kind_label
    from public.pricing_agreements pa
    where pa.scope_level = 'partner'
      and pa.scope_id = p_partner
      and pa.kind = 'agent_share'
      and not pa.is_standard
      and pa.ended_at is null
      and pa.effective_from <= current_date
      and (pa.effective_to is null or pa.effective_to >= current_date)
  ),
  /* ARM B, WHICH IS THE NEW ONE AND THE ONE THAT BREACHED.

     A COMMISSION deal at agency or group scope fills that level's slot in
     commission_split, so on a supplier's estate it IS what the agency keeps.
     20261007190000 left it unbuilt on the stated ground that agency scope
     already wins the resolve order, which is true in commission_split and
     deliberately NOT true in resolve_rates -- so the share moved and the
     total did not, and no guard held the two together.

     GROUP SCOPE IS IN, though Matt named agency level. The slot mechanism is
     identical and leaving it out would be a hole in "any deal". */
  override_deals as (
    select distinct pa.id, a.id as agency_id, pa.scope_level as kind_label
    from public.pricing_agreements pa
    join public.agencies a
      on (pa.scope_level = 'agency' and a.id = pa.scope_id)
      or (pa.scope_level = 'group' and a.group_id is not null and a.group_id = pa.scope_id)
    where pa.kind = 'commission'
      and not pa.is_standard
      and pa.ended_at is null
      and pa.effective_from <= current_date
      and (pa.effective_to is null or pa.effective_to >= current_date)
      and exists (select 1 from public.branches b
                   where b.agency_id = a.id and b.partner_id = p_partner)
  ),
  candidates as (
    select id, agency_id, kind_label from share_deals
    union all
    select id, agency_id, kind_label from override_deals
  ),
  /* THE BREAKPOINTS, which is every tenant count and every volume at which
     EITHER side can change. Between two breakpoints nothing moves, so
     checking them checks the whole surface. */
  tenant_points as (
    select distinct b.min_tenants as n
    from public.pricing_agreement_bands b
    where b.agreement_id in (select id from candidates)
       or b.agreement_id in (select id from total_deal)
    union select 1
  ),
  volume_points as (
    select distinct t.from_count as v
    from public.commission_tiers t
    where t.agreement_id in (select id from candidates)
       or t.agreement_id in (select id from total_deal)
    union select 0
  ),
  /* WHAT EACH COMBINATION COMES TO. The share for an override is the SUM of
     the whole split, computed by commission_split_for -- the same function
     assert_agreement_within_cap uses for the 50% cap -- so it cannot drift
     from what a referral is actually charged, and it counts the branch and
     partner slots that sit alongside the overridden one. Worst branch of the
     agency, because one breaching branch is a breach. */
  measured as (
    select
      tp.n, vp.v, c.agency_id, c.kind_label, c.id as deal_id,
      case when c.agency_id is null
        then public.agreement_rate_at(c.id, tp.n, vp.v)
        else (
          select max(x.total) from (
            select (select coalesce(sum(s.rate), 0)
                      from public.commission_split_for(
                             b.id, b.partner_id, c.id,
                             nullif(public.agreement_rate_at(c.id, tp.n, vp.v), 0)) s) as total
            from public.branches b
            where b.agency_id = c.agency_id and b.partner_id = p_partner
          ) x)
      end as share_rate,
      /* THE TOTAL, resolved the way resolve_rates resolves it: the supplier's
         own partner-scope deal first, then the estate's flat overrides, then
         the partner's flat rate. */
      coalesce(
        public.agreement_rate_at((select id from total_deal), tp.n, vp.v),
        (select a.partner_rate from public.agencies a where a.id = c.agency_id),
        (select g.partner_rate from public.agencies a
           join public.agency_groups g on g.id = a.group_id where a.id = c.agency_id),
        (select p.partner_rate from public.partners p where p.id = p_partner)
      ) as total_rate
    from tenant_points tp, volume_points vp, candidates c
  )
  select m.n, m.v, m.total_rate, m.share_rate,
         (select a.name from public.agencies a where a.id = m.agency_id),
         /* WHICH BAND, in the words the editor uses. */
         coalesce((
           select case
             when b.min_tenants = 1 and b.max_tenants = 1 then '1 tenant'
             when b.max_tenants is null then b.min_tenants || ' or more tenants'
             when b.min_tenants = b.max_tenants then b.min_tenants || ' tenants'
             else b.min_tenants || ' to ' || b.max_tenants || ' tenants'
           end
           from public.pricing_agreement_bands b
           where b.agreement_id = m.deal_id
             and b.min_tenants <= m.n
             and (b.max_tenants is null or b.max_tenants >= m.n)
           order by b.min_tenants desc limit 1
         ), m.n || ' tenant(s)'),
         case when m.agency_id is null then 'the agencies'' share'
              else 'a per-agency deal' end
  from measured m
  /* SIBLINGS DO NOT BOUND EACH OTHER, and this is not an exception to Matt's
     rule but a consequence of it. 20261007230000, from his own words: with
     "Opndoor pays the agents directly" ON, partner_rate is the SUPPLIER'S OWN
     and the total is the SUM of the two deals. There is then no "supplier's
     total" for a share to exceed. Those estates are bounded instead by the
     50% hard cap in assert_agreement_within_cap, which every commission save
     already passes through. */
  where public.supplier_settles_its_own_agents(p_partner)
    and public.is_supplier_estate(p_partner)
    and m.share_rate is not null
    and m.total_rate is not null
    and m.share_rate > m.total_rate
  order by m.n, m.v
$function$;

revoke all on function public.supplier_share_breaches(uuid) from public, anon, authenticated;
grant execute on function public.supplier_share_breaches(uuid) to service_role;

comment on function public.supplier_share_breaches(uuid) is
  'Every tenant count and volume at which a supplier''s agents would keep more than the supplier''s own total. Covers the partner-scope share deals AND the per-agency and per-group commission overrides, whose share is the summed split rather than the band''s own rate. Empty is the healthy answer. Siblings estates are exempt: there the total is the sum of two deals, so there is nothing to sit inside.';

create or replace function public.assert_supplier_share_within_total(p_partner uuid)
returns void
language plpgsql stable security definer set search_path to ''
as $function$
declare r record; v_where text; v_pct text; v_tot text;
begin
  /* THE FIRST BREACH, which is the LOWEST tenant count that breaks, because
     supplier_share_breaches orders by it. Naming the first one is what makes
     the message actionable: an administrator fixes that band and saves again. */
  select * into r from public.supplier_share_breaches(p_partner) limit 1;
  if r.tenants is null then return; end if;

  /* THE PERCENT SIGN IS PART OF THE VALUE, not part of the format. RAISE
     reads %% as a literal percent and % as a placeholder, so a format trying
     to print "26.00%" from a placeholder has to spell %%% and Postgres parses
     that left to right as literal-then-placeholder: the sign lands in front
     of the number. Carrying it on the string removes the question. */
  v_pct := to_char(round(r.share_rate * 100, 2), 'FM999990.00') || '%';
  v_tot := to_char(round(r.total_rate * 100, 2), 'FM999990.00') || '%';
  /* THE VOLUME ONLY WHERE IT IS PART OF THE ANSWER. Every deal has a band;
     only a tiered one has a volume, and "at 0 referrals" in a message about a
     flat deal reads as a bug. */
  v_where := 'the ' || r.band || ' band';
  if coalesce(r.volume, 0) > 0 then
    v_where := v_where || ', from referral ' || r.volume;
  end if;

  if r.agency_name is null then
    /* THE AGENCIES' SHARE, which is the arm that existed. */
    raise exception
      'The agencies'' share comes out of the supplier''s total, so it cannot be more than it. On % it would be % against a total of %. Lower the share or raise the total.',
      v_where, v_pct, v_tot
      using errcode = '22023';
  else
    /* A PER-AGENCY DEAL. The agency is named because this is the arm where
       two editors each look correct on their own: the deal is being saved on
       one agency's row and the total it breaches lives on the supplier. */
    raise exception
      'On %, % would keep % of the guarantee fee, which is more than the % this supplier is paid in total. The agencies'' share comes out of that total, so it cannot be more than it. Lower this deal or raise the supplier''s total.',
      v_where, r.agency_name, v_pct, v_tot
      using errcode = '22023';
  end if;
end $function$;

revoke all on function public.assert_supplier_share_within_total(uuid) from public, anon, authenticated;
grant execute on function public.assert_supplier_share_within_total(uuid) to service_role;

comment on function public.assert_supplier_share_within_total(uuid) is
  'Refuses with a plain message naming the agency and the band where the agents'' share would exceed the supplier''s total. The first breach is the lowest tenant count that breaks, so the message points at the row to change.';

-- ---------------------------------------------------------------------------
-- THE SAVE PATHS. All of them, or the guard is advisory.
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
  v_default_share boolean;
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
          case when p_kind = 'commission'
               then ', worst branch total ' || to_char(round(v_worst * 100, 2), 'FM999990.00') || '%'
               else '' end,
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

CREATE OR REPLACE FUNCTION public.set_agency_share_deal(p_agreement uuid, p_agency uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  if not coalesce(public.is_admin(), false) then
    raise exception 'Only Opndoor moves an agency between deals.' using errcode = '42501';
  end if;

  insert into public.pricing_agreement_members (agreement_id, agency_id, added_by)
  values (p_agreement, p_agency, auth.uid())
  on conflict (agency_id) do update
    set agreement_id = excluded.agreement_id,
        added_by     = excluded.added_by,
        /* RE-STAMPED, because the question the audit answers is "since when
           has this agency been on THIS deal", and a move is a new answer to
           it. Keeping the original would date the agency's terms to a deal
           it is no longer on. */
        added_at     = now();

  /* AND THE MOVE IS A SAVE. Moving an agency onto a deal changes which share
     applies to it, so it can breach the supplier's total without any deal
     being edited. The partner comes from the deal, which is partner-scope by
     construction: 20261007240000 keeps share deals there and expresses "which
     agencies" as members. */
  perform public.assert_supplier_share_within_total(
    (select pa.scope_id from public.pricing_agreements pa where pa.id = p_agreement));
end $function$


;

CREATE OR REPLACE FUNCTION public.set_supplier_commission(p_slug text, p_total numeric, p_agent_share numeric, p_pays_agents boolean)
 RETURNS partners
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur public.partners; res public.partners; who text;
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  if not coalesce(public.is_admin(), false) then
    raise exception 'Only Opndoor sets a supplier''s commission.' using errcode = '42501';
  end if;

  select * into cur from public.partners where slug = p_slug;
  if cur.id is null then
    raise exception 'Supplier not found' using errcode = '22023';
  end if;

  /* NOT ON A HOUSE ROUTE. `opndoor-agents` carries every agency referral
     on the estate and its partner_rate is Opndoor's own margin, not a
     total owed to anybody; the same is true of opndoor-direct and the
     referencing hand-over. One definition of "a real supplier", the one
     our_margin_is_not_theirs pins. */
  if public.is_house_partner_id(cur.id) then
    raise exception 'That is not a supplier.' using errcode = '22023';
  end if;

  if p_total is null or p_total < 0 or p_total > 1 then
    raise exception 'The total commission must be between 0%% and 100%%.' using errcode = '22023';
  end if;
  if p_agent_share is null or p_agent_share < 0 or p_agent_share > 1 then
    raise exception 'The agents'' share must be between 0%% and 100%%.' using errcode = '22023';
  end if;
  /* THE SENTENCE, ENFORCED WHERE IT IS ENTERED. */
  if p_agent_share > p_total then
    raise exception 'The agents'' share comes out of the total, so it cannot be more than it. Raise the total or lower the share.'
      using errcode = '22023';
  end if;

  who := coalesce((select full_name from public.users where id = auth.uid()), 'opndoor admin');

  -- One audit row per changed field, rates to ONE DECIMAL so 9.5% can
  -- never be mistaken for 10%. The same shape update_partner_settings
  -- uses, because this trail is read alongside that one.
  if cur.partner_rate is distinct from p_total then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'partner_rate',
            to_char(cur.partner_rate*100, 'FM990.0') || '%',
            to_char(p_total*100, 'FM990.0') || '% (total, agents'' share included)', who);
  end if;
  if cur.agent_rate is distinct from p_agent_share then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'agent_rate',
            to_char(cur.agent_rate*100, 'FM990.0') || '%',
            to_char(p_agent_share*100, 'FM990.0') || '% (carved out of the total)', who);
  end if;
  if cur.opndoor_pays_agents is distinct from coalesce(p_pays_agents, false) then
    -- Worth its own plain sentence: this one changes WHO Opndoor pays, so
    -- somebody reconciling a month will want to know the day it moved.
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'opndoor_pays_agents',
            case when cur.opndoor_pays_agents then 'opndoor pays the agents' else 'the supplier pays its own agents' end,
            case when coalesce(p_pays_agents, false) then 'opndoor pays the agents' else 'the supplier pays its own agents' end,
            who);
  end if;

  update public.partners
     set partner_rate = p_total,
         agent_rate = p_agent_share,
         opndoor_pays_agents = coalesce(p_pays_agents, false)
   where id = cur.id
   returning * into res;

  /* AND THE FLAT PAIR IS CHECKED AGAINST THE DEALS, not only against itself.
     The comparison above is p_agent_share > p_total, which is the whole of
     the test while both sides are flat. A supplier with a banded per-agency
     deal has a share this function never looks at, so LOWERING the total here
     could put an existing deal over it without either editor complaining.
     Asserted after the update so the check reads the new total. */
  perform public.assert_supplier_share_within_total(cur.id);

  return res;
end $function$


;

/* END_AGREEMENT IS DELIBERATELY NOT GUARDED. Ending a deal is not saving one,
   and refusing it would be a trap: when a per-agency deal is over the total,
   ending that deal is one of the two ways out, and a guard on the exit would
   leave an administrator with a breach they cannot clear. The breach is
   caught where it is created. */
