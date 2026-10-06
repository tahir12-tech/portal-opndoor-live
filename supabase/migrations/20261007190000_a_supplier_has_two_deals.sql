-- A SUPPLIER HAS TWO DEALS: WHAT WE PAY THEM, AND THE AGENTS' SHARE OF IT.
--
-- Matt, 2026-10-01, verbatim: "Supplier Commission tab: use the same
-- commission deal editor agencies have, with all its options (flat rate,
-- volume tiers, bands by number of tenants, and per-agency overrides), for
-- both the supplier's total commission and the agents' share within it. Both
-- can be set independently per supplier. The agents' share can never exceed
-- the supplier's total on any referral, checked on save. The summary line
-- explains the resulting deal in plain English. Changes apply to new referrals
-- only, recorded with who and when."
--
-- Tests: supabase/tests/a_supplier_has_two_deals.test.sql
--
-- =========================================================================
-- WHAT ALREADY EXISTED, AND WHY THIS IS A COLUMN RATHER THAN A SYSTEM
-- =========================================================================
--
-- `resolve_pricing_agreement(branch, route, tenants)` already picks the most
-- specific live agreement -- agency, then group, then PARTNER -- resolves the
-- band by tenant count and the tier by volume, and returns the fee basis and
-- the rate. Partner scope was already allowed by the scope_level check.
--
-- So "the same editor agencies have, for a supplier" is not a second pricing
-- system. It is the one we have, asked a second question. The only thing
-- missing was a way to say WHICH question, because a supplier's party holds
-- two deals at once and a party has only ever held one.
--
-- "PER-AGENCY OVERRIDES" NEEDS NOTHING AT ALL: an agency-scope agreement
-- already beats the partner-scope one in that ORDER BY, and the agencies under
-- a supplier are real agency rows. It is listed in the instruction because it
-- has to be true, not because it has to be built.
--
-- =========================================================================
-- 'commission' AND 'agent_share', NOT 'total' AND 'agent_share'
-- =========================================================================
--
-- The kind has to read correctly on BOTH rails. On the agency rail an
-- agreement says what Opndoor pays that agency and there is no share within
-- it; calling that row 'total' would invite the reader to look for the other
-- half. 'commission' means "what this party is paid" on either rail, and
-- 'agent_share' means "the part of it the agents get", which only a supplier
-- has. Every row that exists today is a 'commission' row and the default says
-- so.

-- ---------------------------------------------------------------------------
-- 1. THE KIND.
-- ---------------------------------------------------------------------------
alter table public.pricing_agreements
  add column if not exists kind text not null default 'commission';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pricing_agreements_kind_check') then
    alter table public.pricing_agreements
      add constraint pricing_agreements_kind_check
      check (kind in ('commission', 'agent_share'));
  end if;
end $$;

/* AN AGENTS' SHARE ONLY EXISTS UNDER A SUPPLIER. On the agency rail there is
   nothing for it to be a share OF: the agreement already is the whole of what
   that agency is paid. A share row at agency or group scope would be a deal
   nothing reads, which is the state this codebase refuses everywhere else. */
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pricing_agreements_share_is_a_suppliers') then
    alter table public.pricing_agreements
      add constraint pricing_agreements_share_is_a_suppliers
      check (kind = 'commission' or scope_level in ('partner', 'agency'));
  end if;
end $$;

comment on column public.pricing_agreements.kind is
  'Which of a party''s deals this is. ''commission'' is what Opndoor pays them and is the only kind on the agency rail. ''agent_share'' is the part of a supplier''s commission that belongs to its agents, and exists only under a supplier (at partner scope, or at agency scope as a per-agency override).';

-- ---------------------------------------------------------------------------
-- 2. FINDING A PARTY'S LIVE AGREEMENT, OF A GIVEN KIND.
-- ---------------------------------------------------------------------------
-- A NEW NAME RATHER THAN A DEFAULTED ARGUMENT. active_agreement_on(text, uuid)
-- is called from the exclusivity trigger and from agreement_conflicts; adding
-- a third parameter with a default would leave both the two- and three-
-- argument forms resolvable and Postgres would refuse the two-argument call as
-- ambiguous. The old name keeps its signature and answers for 'commission',
-- which is exactly what it has always answered.
create or replace function public.active_agreement_of_kind(
  p_level text, p_id uuid, p_kind text
)
returns uuid
language sql stable security definer set search_path to ''
as $function$
  select pa.id
  from public.pricing_agreements pa
  where pa.scope_level = p_level
    and pa.scope_id = p_id
    and pa.kind = p_kind
    and not pa.is_standard
    and pa.ended_at is null
    and pa.effective_from <= current_date
    and (pa.effective_to is null or pa.effective_to >= current_date)
  order by pa.effective_from desc
  limit 1
$function$;

revoke all on function public.active_agreement_of_kind(text, uuid, text) from public, anon, authenticated;
grant execute on function public.active_agreement_of_kind(text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. ONE AGREEMENT PER PARTY, PER KIND.
-- ---------------------------------------------------------------------------
-- The body is 20261003120000's, with the exclusivity question asked of the
-- same KIND. Without this, saving a supplier's agents' share would be refused
-- because the supplier already holds its commission deal -- the trigger would
-- be comparing two deals that are not alternatives to each other.
create or replace function public.enforce_agreement_exclusivity()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
declare v_rate numeric; v_agr uuid; v_n int; r record;
begin
  if new.is_standard then return new; end if;
  if new.ended_at is not null then return new; end if;
  if new.effective_to is not null and new.effective_to < current_date then return new; end if;

  -- The party's own live agreement OF THIS KIND, which is not this row.
  v_agr := public.active_agreement_of_kind(new.scope_level, new.scope_id, new.kind);
  if v_agr is not null and v_agr is distinct from new.id then
    raise exception 'That % already has a live % deal. End it first: a party holds one of each, never two.',
      new.scope_level,
      case new.kind when 'agent_share' then 'agents'' share' else 'commission' end
      using errcode = '22023';
  end if;

  /* A HELD RATE BLOCKS THE COMMISSION DEAL, NOT THE SHARE. `agencies.agent_rate`
     is what that agency is paid, which is the same thing a 'commission'
     agreement says, so the two cannot both stand. An agents'-share deal under a
     supplier says something else entirely and is not in conflict with it.

     THERE IS NO 'partner' ARM, deliberately and as before: every supplier has a
     partners.agent_rate, and treating that as a held rate would refuse every
     supplier deal before it was written. */
  if new.kind = 'commission' then
    select case new.scope_level
      when 'agency' then (select a.agent_rate from public.agencies a where a.id = new.scope_id)
      when 'group'  then (select g.agent_rate from public.agency_groups g where g.id = new.scope_id)
      when 'branch' then (select b.agent_rate from public.branches b where b.id = new.scope_id)
    end into v_rate;
    if v_rate is not null then
      raise exception 'That % already holds its own rate of %. Clear it first: a party holds a rate or an agreement, never both.',
        new.scope_level, to_char(round(v_rate * 100, 2), 'FM999990.00') || '%' using errcode = '22023';
    end if;

    v_agr := public.covering_all_in_agreement(new.scope_level, new.scope_id);
    if v_agr is not null then
      raise exception 'An all-in agreement above this % already covers it. End that one first.',
        new.scope_level using errcode = '22023';
    end if;

    select count(*) into v_n from public.rate_above_all_in(new.scope_level, new.scope_id);
    if new.coverage = 'all_in' and v_n > 0
       and coalesce(current_setting('app.confirm_all_in_breach', true), 'off') <> 'on' then
      for r in select * from public.rate_above_all_in(new.scope_level, new.scope_id) loop
        raise exception '%', public.all_in_breach_sentence(
          r.party_name, r.rate,
          (select name from public.agencies where id = new.scope_id),
          public.agreement_max_rate(new.id)) using errcode = '22023';
      end loop;
    end if;
  end if;

  return new;
end $function$;

-- ---------------------------------------------------------------------------
-- 4. THE RESOLVER ANSWERS FOR ONE KIND.
-- ---------------------------------------------------------------------------
-- DROPPED AND RECREATED, because p_tenant_count already has a default: adding
-- another defaulted parameter would leave the three-argument call ambiguous.
-- Every existing caller passes two or three arguments and resolves to this one
-- with p_kind defaulting to 'commission', which is what they have always been
-- asking for.
drop function if exists public.resolve_pricing_agreement(uuid, uuid, integer);

create or replace function public.resolve_pricing_agreement(
  p_branch uuid, p_route_partner uuid, p_tenant_count integer default 1,
  p_kind text default 'commission'
)
returns table(id uuid, scope_level text, fee_basis_weeks numeric, fee_basis_unit text, agent_rate numeric)
language sql stable security definer set search_path to ''
as $function$
  with ctx as (
    select b.agency_id, a.group_id
    from public.branches b left join public.agencies a on a.id = b.agency_id
    where b.id = p_branch
  ),
  agreement as (
    select pa.*
    from public.pricing_agreements pa, ctx
    where pa.ended_at is null
      and pa.kind = p_kind
      and pa.effective_from <= current_date
      and (pa.effective_to is null or pa.effective_to >= current_date)
      and (
        (pa.scope_level = 'agency'  and pa.scope_id = ctx.agency_id)
        or (pa.scope_level = 'group'   and ctx.group_id is not null and pa.scope_id = ctx.group_id)
        or (pa.scope_level = 'partner' and pa.scope_id = p_route_partner)
      )
    /* MOST SPECIFIC WINS, which is also where "per-agency overrides" comes
       from: an agency-scope deal beats the supplier's own. Unchanged. */
    order by case pa.scope_level when 'agency' then 1 when 'group' then 2 else 3 end,
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

revoke all on function public.resolve_pricing_agreement(uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.resolve_pricing_agreement(uuid, uuid, integer, text) to service_role;

comment on function public.resolve_pricing_agreement(uuid, uuid, integer, text) is
  'The live deal that prices this referral: most specific scope wins (agency, then group, then partner), the band by tenant count, the tier by volume. p_kind picks which of a supplier''s two deals is being asked about; everything on the agency rail is ''commission''.';

-- ---------------------------------------------------------------------------
-- 5. THE RATE A DEAL PRICES AT, FOR A GIVEN TENANT COUNT AND VOLUME.
-- ---------------------------------------------------------------------------
-- The same arithmetic resolve_pricing_agreement does, asked WITHOUT a branch:
-- the guard below has to compare two deals across every combination they could
-- ever meet, and there is no referral to hang that question on.
create or replace function public.agreement_rate_at(
  p_agreement uuid, p_tenants integer, p_volume integer
)
returns numeric
language sql stable security definer set search_path to ''
as $function$
  select coalesce(
    (select t.agent_rate from public.commission_tiers t
      where t.agreement_id = p_agreement
        and p_volume >= t.from_count
        and (t.to_count is null or p_volume < t.to_count)
      order by t.from_count desc limit 1),
    (select b.agent_rate from public.pricing_agreement_bands b
      where b.agreement_id = p_agreement
        and b.min_tenants <= p_tenants
        and (b.max_tenants is null or b.max_tenants >= p_tenants)
      order by b.min_tenants desc limit 1)
  )
$function$;

revoke all on function public.agreement_rate_at(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.agreement_rate_at(uuid, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 6. THE AGENTS' SHARE MAY NEVER EXCEED THE TOTAL, ON ANY REFERRAL.
-- ---------------------------------------------------------------------------
-- Matt: "The agents' share can never exceed the supplier's total on any
-- referral, checked on save."
--
-- "ON ANY REFERRAL" IS THE HARD WORD. With a flat pair it is one comparison,
-- which is what set_supplier_commission already does. With bands on one side
-- and tiers on the other, the two deals can cross at a combination neither
-- side looks wrong at on its own: a total of 35% flat against a share that is
-- 30% up to fifty referrals and 40% after is a deal that reads fine in both
-- editors and overpays on the fifty-first.
--
-- So every combination is checked. The breakpoints are where either deal can
-- change: each band's lowest tenant count, and each tier's first referral.
-- Between two breakpoints nothing moves, so checking the breakpoints checks
-- the whole surface.
create or replace function public.supplier_share_breaches(p_partner uuid)
returns table(tenants integer, volume integer, total_rate numeric, share_rate numeric)
language sql stable security definer set search_path to ''
as $function$
  with deals as (
    select
      public.active_agreement_of_kind('partner', p_partner, 'commission')  as total_id,
      public.active_agreement_of_kind('partner', p_partner, 'agent_share') as share_id
  ),
  -- Every tenant count either deal changes at, and 1 so a deal with no band
  -- at all is still asked about one tenancy.
  tenant_points as (
    select distinct b.min_tenants as n
    from public.pricing_agreement_bands b, deals d
    where b.agreement_id in (d.total_id, d.share_id)
    union select 1
  ),
  -- Every volume either deal changes at, and 0 for the first referral of a
  -- period, which is where the counter actually starts.
  volume_points as (
    select distinct t.from_count as v
    from public.commission_tiers t, deals d
    where t.agreement_id in (d.total_id, d.share_id)
    union select 0
  )
  select tp.n, vp.v,
         public.agreement_rate_at((select total_id from deals), tp.n, vp.v),
         public.agreement_rate_at((select share_id from deals), tp.n, vp.v)
  from tenant_points tp, volume_points vp, deals d
  where d.share_id is not null
    /* NO COMMISSION DEAL AT ALL IS NOT A BREACH HERE. The supplier is then
       priced by partners.partner_rate, which set_supplier_commission already
       holds above the share, and this function would otherwise read a NULL
       total as nought and refuse every share. */
    and d.total_id is not null
    and public.agreement_rate_at(d.share_id, tp.n, vp.v) is not null
    and public.agreement_rate_at(d.total_id, tp.n, vp.v) is not null
    and public.agreement_rate_at(d.share_id, tp.n, vp.v)
      > public.agreement_rate_at(d.total_id, tp.n, vp.v)
  order by tp.n, vp.v
$function$;

revoke all on function public.supplier_share_breaches(uuid) from public, anon, authenticated;
grant execute on function public.supplier_share_breaches(uuid) to service_role;

comment on function public.supplier_share_breaches(uuid) is
  'Every tenant count and volume at which a supplier''s agents'' share would be more than the supplier''s own commission. Empty is the healthy answer. Checked at the breakpoints, which is the whole surface: between two breakpoints neither deal moves.';

create or replace function public.assert_supplier_share_within_total(p_partner uuid)
returns void
language plpgsql stable security definer set search_path to ''
as $function$
declare r record;
begin
  select * into r from public.supplier_share_breaches(p_partner) limit 1;
  if r.tenants is not null then
    /* THE COMBINATION IS NAMED, because "the share exceeds the total" sends an
       administrator back to two editors that each look correct. The sentence
       has to say where they cross. */
    raise exception
      'The agents'' share comes out of the total, so it cannot be more than it. At % tenant(s) and % referrals it would be %%% against a total of %%%. Lower the share or raise the total.',
      r.tenants, r.volume,
      to_char(round(r.share_rate * 100, 2), 'FM999990.00'),
      to_char(round(r.total_rate * 100, 2), 'FM999990.00')
      using errcode = '22023';
  end if;
end $function$;

revoke all on function public.assert_supplier_share_within_total(uuid) from public, anon, authenticated;
grant execute on function public.assert_supplier_share_within_total(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7. SAVING ONE, AND WHICH KIND IT IS.
-- ---------------------------------------------------------------------------
-- agreement_conflicts gains the kind, so "this would replace N arrangements"
-- counts the deals this one actually replaces. Dropped and recreated because
-- p_coverage already has a default.
drop function if exists public.agreement_conflicts(text, uuid, text);

create or replace function public.agreement_conflicts(
  p_level text, p_id uuid, p_coverage text default 'additive', p_kind text default 'commission'
)
returns table (kind text, level text, node_id uuid, node_name text, detail text)
language sql stable security definer set search_path to ''
as $function$
  /* A HELD RATE ONLY CONFLICTS WITH A COMMISSION DEAL, for the reason the
     exclusivity trigger gives: `agencies.agent_rate` says what that agency is
     paid, which is what a commission agreement says, and an agents'-share deal
     under a supplier says something else. */
  select 'rate', 'agency', a.id, a.name,
         'holds its own rate of ' || to_char(round(a.agent_rate * 100, 2), 'FM999990.00') || '%'
  from public.agencies a
  where p_kind = 'commission' and p_level = 'agency' and a.id = p_id and a.agent_rate is not null
  union all
  select 'rate', 'group', g.id, g.name,
         'holds its own rate of ' || to_char(round(g.agent_rate * 100, 2), 'FM999990.00') || '%'
  from public.agency_groups g
  where p_kind = 'commission' and p_level = 'group' and g.id = p_id and g.agent_rate is not null
  union all
  select 'rate', 'branch', b.id, b.name,
         'holds its own rate of ' || to_char(round(b.agent_rate * 100, 2), 'FM999990.00') || '%'
  from public.branches b
  where p_kind = 'commission' and p_level = 'branch' and b.id = p_id and b.agent_rate is not null

  -- One deal of each kind per party. A new one supersedes, it does not stack.
  union all
  select 'agreement', p_level, p_id,
         coalesce(a5.name, g5.name, p5.name),
         'already has a live ' ||
           case p_kind when 'agent_share' then 'agents'' share deal' else 'agreement' end
  from public.pricing_agreements pa5
  left join public.agencies a5      on pa5.scope_level = 'agency'  and a5.id = pa5.scope_id
  left join public.agency_groups g5 on pa5.scope_level = 'group'   and g5.id = pa5.scope_id
  left join public.partners p5      on pa5.scope_level = 'partner' and p5.id = pa5.scope_id
  where pa5.id = public.active_agreement_of_kind(p_level, p_id, p_kind)

  -- ALL-IN additionally swallows the subtree, so everything inside must go.
  -- Commission only: an agents' share is never all-in.
  union all
  select 'rate', 'agency', a2.id, a2.name,
         'holds its own rate of ' || to_char(round(a2.agent_rate * 100, 2), 'FM999990.00') || '%'
  from public.agencies a2
  where p_kind = 'commission' and p_coverage = 'all_in' and p_level = 'group'
    and a2.group_id = p_id and a2.agent_rate is not null
  union all
  select 'rate', 'branch', b2.id, b2.name,
         'holds its own rate of ' || to_char(round(b2.agent_rate * 100, 2), 'FM999990.00') || '%'
  from public.branches b2
  join public.agencies a3 on a3.id = b2.agency_id
  where p_kind = 'commission' and p_coverage = 'all_in'
    and ((p_level = 'agency' and a3.id = p_id) or (p_level = 'group' and a3.group_id = p_id))
    and b2.agent_rate is not null
  union all
  select 'agreement', pa3.scope_level, pa3.scope_id,
         coalesce(a4.name, b4.name),
         'already has a live agreement'
  from public.pricing_agreements pa3
  left join public.agencies a4 on pa3.scope_level = 'agency' and a4.id = pa3.scope_id
  left join public.branches b4 on pa3.scope_level = 'branch' and b4.id = pa3.scope_id
  where p_kind = 'commission' and p_coverage = 'all_in'
    and pa3.ended_at is null and not pa3.is_standard
    and pa3.kind = 'commission'
    and ((p_level = 'group' and (
            (pa3.scope_level = 'agency' and exists (select 1 from public.agencies ax where ax.id = pa3.scope_id and ax.group_id = p_id))
         or (pa3.scope_level = 'branch' and exists (select 1 from public.branches bx join public.agencies ay on ay.id = bx.agency_id
                                                     where bx.id = pa3.scope_id and ay.group_id = p_id))))
      or (p_level = 'agency' and pa3.scope_level = 'branch'
          and exists (select 1 from public.branches bz where bz.id = pa3.scope_id and bz.agency_id = p_id)))
$function$;

revoke all on function public.agreement_conflicts(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.agreement_conflicts(text, uuid, text, text) to service_role;

-- create_agreement gains the kind. Dropped and recreated for the same reason:
-- it already has four defaulted parameters.
drop function if exists public.create_agreement(text, uuid, text, text, text, jsonb, jsonb, text, boolean, boolean);

create or replace function public.create_agreement(
  p_level text, p_id uuid, p_coverage text, p_period text, p_counting_scope text,
  p_bands jsonb, p_tiers jsonb default '[]'::jsonb, p_note text default null,
  p_confirm_replace boolean default false, p_confirm_breach boolean default false,
  p_kind text default 'commission'
)
returns uuid
language plpgsql security definer set search_path to ''
as $function$
declare
  v_id uuid; c record; v_actor text; v_n int; b jsonb; t jsonb; v_worst numeric;
  v_detail text; v_mx numeric; r record; v_breached boolean := false;
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
  /* AN AGENTS' SHARE IS NEVER ALL-IN. All-in means "nobody underneath is paid
     separately", which is a statement about the commission. Saying it of a
     share would be saying the share covers the commission. */
  if p_kind = 'agent_share' and p_coverage <> 'additive' then
    raise exception 'An agents'' share is a part of the commission, so it cannot be all-in.' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_bands,'[]'::jsonb)) < 1 then
    raise exception 'An agreement needs at least one tenant-count band.' using errcode = '22023';
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
      /* ENDS THE SAME KIND ONLY. Without this, saving a supplier's agents'
         share would end its commission deal: they are two live agreements on
         one party and the old statement could not tell them apart. */
      update public.pricing_agreements set ended_at = now()
       where scope_level = c.level and scope_id = c.node_id and not is_standard
         and kind = p_kind
         and ended_at is null;
    end if;
  end loop;

  insert into public.pricing_agreements
    (scope_level, scope_id, coverage, period, counting_scope, note, created_by, effective_from, is_standard, kind)
  values (p_level, p_id, p_coverage, p_period, p_counting_scope, p_note, auth.uid(), current_date, false, p_kind)
  returning id into v_id;

  for b in select * from jsonb_array_elements(p_bands) loop
    insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, fee_basis_unit, agent_rate)
    values (v_id, coalesce((b->>'min')::int, 1), nullif(b->>'max','')::int,
            (b->>'weeks')::numeric,
            case when b->>'unit' = 'months' then 'months' else 'weeks' end,
            nullif(b->>'rate','')::numeric);
  end loop;
  for t in select * from jsonb_array_elements(coalesce(p_tiers,'[]'::jsonb)) loop
    insert into public.commission_tiers (agreement_id, from_count, to_count, agent_rate)
    values (v_id, (t->>'from')::int, nullif(t->>'to','')::int, (t->>'rate')::numeric);
  end loop;

  /* THE 50% CAP applies to what a branch is PAID, which is the commission.
     An agents' share is a part of that same money, already counted. */
  if p_kind = 'commission' then
    v_worst := public.assert_agreement_within_cap(v_id);
  else
    v_worst := 0;
  end if;

  /* AND THE SHARE MAY NOT EXCEED THE TOTAL, checked after the write so the
     comparison is against what was actually stored, and inside the
     transaction so a breach rolls the whole save back. Matt: "checked on
     save". Either side can break it, so both are checked. */
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
end $function$;

revoke all on function public.create_agreement(text, uuid, text, text, text, jsonb, jsonb, text, boolean, boolean, text) from public, anon;
revoke all on function public.create_agreement(text, uuid, text, text, text, jsonb, jsonb, text, boolean, boolean, text) from authenticated;
grant execute on function public.create_agreement(text, uuid, text, text, text, jsonb, jsonb, text, boolean, boolean, text) to authenticated, service_role;
