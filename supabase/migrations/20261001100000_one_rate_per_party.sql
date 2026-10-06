-- ONE RATE PER PARTY, ENFORCED STRUCTURALLY.
--
-- A party could hold an explicit node rate AND a negotiated agreement, and the
-- resolver quietly preferred one. Precedence is the wrong tool for this: it means
-- the answer to "what does this agency earn?" depends on knowing which rule wins,
-- and two people reading the same screen can disagree. So the two states are made
-- mutually exclusive, by TRIGGER rather than by RPC guard — the rule then holds
-- however the row is written, including by a future screen that forgets.
--
-- COVERAGE. Every agreement now says how far it reaches:
--   ADDITIVE (default) resolves this party's OWN line. Every other level adds
--     exactly as it adds on top of an explicit rate. Nothing else changes.
--   ALL-IN is the entire commission for its subtree: no node inside it may hold
--     a rate or an agreement of its own.
--
-- Lines ABOVE an all-in party still add, deliberately: an agency's all-in deal
-- covers its branches, not its group. All-in is therefore only meaningful where
-- there IS a subtree, so it is confined to group and agency scope.

-- ---------------------------------------------------------------------------
-- 1. COVERAGE
-- ---------------------------------------------------------------------------
alter table public.pricing_agreements
  add column if not exists coverage text not null default 'additive';

-- An agreement can be stopped on the day it was written, before it has priced
-- anything. Expressing that as effective_to = yesterday breaks the date ordering
-- constraint, and "effective_to = today" would still read as live. So ENDING is a
-- fact of its own: effective_to stays the date the deal was negotiated to run to,
-- and ended_at records that we actually stopped it.
alter table public.pricing_agreements
  add column if not exists ended_at timestamptz;
comment on column public.pricing_agreements.ended_at is
  'When this agreement was actually stopped, as opposed to effective_to, which is the date it was negotiated to run to. A live agreement has ended_at null.';

alter table public.pricing_agreements drop constraint if exists pricing_agreements_coverage_check;
alter table public.pricing_agreements add constraint pricing_agreements_coverage_check
  check (coverage in ('additive','all_in'));

-- All-in describes a subtree. A partner-scoped or branch-scoped all-in would
-- either swallow every agency on the rail or be indistinguishable from additive.
alter table public.pricing_agreements drop constraint if exists pricing_agreements_all_in_scope_check;
alter table public.pricing_agreements add constraint pricing_agreements_all_in_scope_check
  check (coverage = 'additive' or scope_level in ('group','agency'));

comment on column public.pricing_agreements.coverage is
  'additive: this agreement resolves the party''s own line, and every other level still adds. all_in: the agreement is the whole commission for everything under the party, so nothing inside may hold a rate or its own agreement. Lines above an all-in party still add.';

-- ---------------------------------------------------------------------------
-- 2. THE TWO QUESTIONS THE RULE TURNS ON
-- ---------------------------------------------------------------------------

-- The live, negotiated agreement on this exact node, if any.
create or replace function public.active_agreement_on(p_level text, p_id uuid)
returns uuid
language sql stable security definer set search_path to ''
as $function$
  select pa.id from public.pricing_agreements pa
  where pa.scope_level = p_level and pa.scope_id = p_id
    and not pa.is_standard and pa.ended_at is null
    and pa.effective_from <= current_date
    and (pa.effective_to is null or pa.effective_to >= current_date)
  order by pa.effective_from desc
  limit 1
$function$;

-- The all-in agreement that covers this node from STRICTLY ABOVE it, if any.
create or replace function public.covering_all_in_agreement(p_level text, p_id uuid)
returns uuid
language sql stable security definer set search_path to ''
as $function$
  with node as (
    select
      case p_level
        when 'branch' then (select b.agency_id from public.branches b where b.id = p_id)
        when 'agency' then p_id
      end as agency_id,
      case p_level
        when 'branch' then (select a.group_id from public.branches b
                            join public.agencies a on a.id = b.agency_id where b.id = p_id)
        when 'agency' then (select a.group_id from public.agencies a where a.id = p_id)
        when 'group'  then p_id
      end as group_id
  )
  select pa.id
  from public.pricing_agreements pa, node n
  where pa.coverage = 'all_in' and not pa.is_standard and pa.ended_at is null
    and pa.effective_from <= current_date
    and (pa.effective_to is null or pa.effective_to >= current_date)
    and ((pa.scope_level = 'agency' and pa.scope_id = n.agency_id)
      or (pa.scope_level = 'group'  and pa.scope_id = n.group_id))
    and not (pa.scope_level = p_level and pa.scope_id = p_id)   -- above, not itself
  limit 1
$function$;

-- The name an error message should blame.
create or replace function public.agreement_party_name(p_agreement uuid)
returns text
language sql stable security definer set search_path to ''
as $function$
  select coalesce(a.name, g.name, 'a party above')
  from public.pricing_agreements pa
  left join public.agencies a      on pa.scope_level = 'agency' and a.id = pa.scope_id
  left join public.agency_groups g on pa.scope_level = 'group'  and g.id = pa.scope_id
  where pa.id = p_agreement
$function$;

revoke all on function public.active_agreement_on(text, uuid) from public, anon;
revoke all on function public.covering_all_in_agreement(text, uuid) from public, anon;
revoke all on function public.agreement_party_name(uuid) from public, anon;
grant execute on function public.active_agreement_on(text, uuid) to authenticated, service_role;
grant execute on function public.covering_all_in_agreement(text, uuid) to authenticated, service_role;
grant execute on function public.agreement_party_name(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. WHAT AN AGREEMENT WOULD HAVE TO REPLACE. The admin screen shows this and
--    asks for confirmation; create_agreement then clears exactly this list.
-- ---------------------------------------------------------------------------
create or replace function public.agreement_conflicts(p_level text, p_id uuid, p_coverage text default 'additive')
returns table (kind text, level text, node_id uuid, node_name text, detail text)
language sql stable security definer set search_path to ''
as $function$
  -- The party's own rate.
  select 'rate', 'agency', a.id, a.name,
         'holds its own rate of ' || to_char(round(a.agent_rate * 100, 2), 'FM999990.00') || '%'
  from public.agencies a where p_level = 'agency' and a.id = p_id and a.agent_rate is not null
  union all
  select 'rate', 'group', g.id, g.name,
         'holds its own rate of ' || to_char(round(g.agent_rate * 100, 2), 'FM999990.00') || '%'
  from public.agency_groups g where p_level = 'group' and g.id = p_id and g.agent_rate is not null
  union all
  select 'rate', 'branch', b.id, b.name,
         'holds its own rate of ' || to_char(round(b.agent_rate * 100, 2), 'FM999990.00') || '%'
  from public.branches b where p_level = 'branch' and b.id = p_id and b.agent_rate is not null

  -- One agreement per party too: a second one would leave the resolver picking
  -- between two live deals with the same start date, which is the ambiguity this
  -- whole ruling exists to remove. A new agreement supersedes, it does not stack.
  union all
  select 'agreement', p_level, p_id,
         coalesce(a5.name, g5.name),
         'already has a live agreement'
  from public.pricing_agreements pa5
  left join public.agencies a5      on pa5.scope_level = 'agency' and a5.id = pa5.scope_id
  left join public.agency_groups g5 on pa5.scope_level = 'group'  and g5.id = pa5.scope_id
  where pa5.id = public.active_agreement_on(p_level, p_id)

  -- ALL-IN additionally swallows the subtree, so everything inside must go.
  union all
  select 'rate', 'agency', a2.id, a2.name,
         'holds its own rate of ' || to_char(round(a2.agent_rate * 100, 2), 'FM999990.00') || '%'
  from public.agencies a2
  where p_coverage = 'all_in' and p_level = 'group'
    and a2.group_id = p_id and a2.agent_rate is not null
  union all
  select 'rate', 'branch', b2.id, b2.name,
         'holds its own rate of ' || to_char(round(b2.agent_rate * 100, 2), 'FM999990.00') || '%'
  from public.branches b2
  join public.agencies a3 on a3.id = b2.agency_id
  where p_coverage = 'all_in' and b2.agent_rate is not null
    and ((p_level = 'agency' and b2.agency_id = p_id)
      or (p_level = 'group'  and a3.group_id = p_id))
  union all
  select 'agreement', 'agency', a4.id, a4.name, 'has its own agreement'
  from public.pricing_agreements pa
  join public.agencies a4 on a4.id = pa.scope_id
  where p_coverage = 'all_in' and p_level = 'group'
    and pa.scope_level = 'agency' and not pa.is_standard and pa.ended_at is null
    and (pa.effective_to is null or pa.effective_to >= current_date)
    and a4.group_id = p_id
$function$;

comment on function public.agreement_conflicts(text, uuid, text) is
  'Everything a proposed agreement would have to clear before it can exist: the party''s own rate always, and for all-in every rate and agreement inside its subtree. The admin screen shows this list and asks to confirm; create_agreement clears exactly it, audited.';

revoke all on function public.agreement_conflicts(text, uuid, text) from public, anon;
grant execute on function public.agreement_conflicts(text, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. THE CONSTRAINT ITSELF. Setting a rate where an agreement already speaks
--    for the party is refused, and the refusal names the agreement.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_one_rate_per_party()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
declare v_level text; v_agr uuid;
begin
  v_level := tg_argv[0];

  if public.active_agreement_on(v_level, new.id) is not null then
    raise exception 'This % is priced by a negotiated agreement, so it cannot also hold its own rate. Change the agreement instead.', v_level
      using errcode = '22023';
  end if;

  v_agr := public.covering_all_in_agreement(v_level, new.id);
  if v_agr is not null then
    raise exception 'An all-in agreement with % covers this %, and an all-in agreement is the whole commission for everything under it. Change that agreement instead.',
      public.agreement_party_name(v_agr), v_level using errcode = '22023';
  end if;

  return new;
end $function$;

drop trigger if exists agencies_one_rate on public.agencies;
create trigger agencies_one_rate
  before insert or update of agent_rate on public.agencies
  for each row when (new.agent_rate is not null)
  execute function public.enforce_one_rate_per_party('agency');

drop trigger if exists agency_groups_one_rate on public.agency_groups;
create trigger agency_groups_one_rate
  before insert or update of agent_rate on public.agency_groups
  for each row when (new.agent_rate is not null)
  execute function public.enforce_one_rate_per_party('group');

drop trigger if exists branches_one_rate on public.branches;
create trigger branches_one_rate
  before insert or update of agent_rate on public.branches
  for each row when (new.agent_rate is not null)
  execute function public.enforce_one_rate_per_party('branch');

-- ...and the mirror image: an agreement cannot land on a party that holds a rate,
-- nor inside an all-in subtree. create_agreement clears first, in the same
-- transaction, so the legitimate path passes; a hand-written insert does not.
create or replace function public.enforce_agreement_exclusivity()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
declare v_rate numeric; v_agr uuid; v_n int;
begin
  if new.is_standard then return new; end if;
  if new.ended_at is not null then return new; end if;
  if new.effective_to is not null and new.effective_to < current_date then return new; end if;

  -- The party's own live agreement, which is not this row.
  v_agr := public.active_agreement_on(new.scope_level, new.scope_id);
  if v_agr is not null and v_agr is distinct from new.id then
    raise exception 'That % already has a live agreement. End it first: a party holds one agreement, never two.',
      new.scope_level using errcode = '22023';
  end if;

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
    raise exception 'An all-in agreement with % already covers this %. Change that agreement instead.',
      public.agreement_party_name(v_agr), new.scope_level using errcode = '22023';
  end if;

  if new.coverage = 'all_in' then
    -- Not counting itself: converting a party's existing agreement to all-in is
    -- legitimate, and agreement_conflicts lists that agreement because it lists
    -- the party's live one. The same-node case is settled above, by id.
    select count(*) into v_n
    from public.agreement_conflicts(new.scope_level, new.scope_id, 'all_in') c
    where not (c.kind = 'agreement' and c.level = new.scope_level and c.node_id = new.scope_id);
    if v_n > 0 then
      raise exception 'An all-in agreement is the whole commission for everything under this %, but % arrangement(s) inside it are still set. Clear them first.',
        new.scope_level, v_n using errcode = '22023';
    end if;
  end if;

  return new;
end $function$;

drop trigger if exists pricing_agreements_exclusivity on public.pricing_agreements;
create trigger pricing_agreements_exclusivity
  before insert or update on public.pricing_agreements
  for each row execute function public.enforce_agreement_exclusivity();

-- ---------------------------------------------------------------------------
-- 5. SETTING A RATE. The trigger already refuses the illegal case; set_node_rate
--    keeps its cap check and its admin gate.
-- ---------------------------------------------------------------------------
create or replace function public.set_node_rate(p_level text, p_id uuid, p_rate numeric)
returns numeric
language plpgsql security definer set search_path to ''
as $function$
declare v_worst numeric;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_level not in ('group','agency','branch') then
    raise exception 'Unknown level %', p_level using errcode = '22023';
  end if;
  if p_rate is not null and (p_rate < 0 or p_rate > 1) then
    raise exception 'A rate must be between 0%% and 100%%.' using errcode = '22023';
  end if;

  -- One rate per party is enforced by trigger, so this write simply fails if an
  -- agreement already prices the party. Clearing to null is always allowed.
  if p_level = 'group'  then update public.agency_groups set agent_rate = p_rate where id = p_id;
  elsif p_level = 'agency' then update public.agencies     set agent_rate = p_rate where id = p_id;
  else                          update public.branches      set agent_rate = p_rate where id = p_id;
  end if;

  select max(t.total) into v_worst
  from (
    select public.commission_total(b.id, b.partner_id) as total
    from public.branches b
    left join public.agencies a on a.id = b.agency_id
    where (p_level = 'branch' and b.id = p_id)
       or (p_level = 'agency' and b.agency_id = p_id)
       or (p_level = 'group'  and a.group_id = p_id)
  ) t;

  if v_worst is not null and v_worst > 0.50 then
    raise exception 'That rate would take a branch to % of the guarantee fee. The most a branch may pay out in total is 50%%.',
      to_char(round(v_worst * 100, 2), 'FM999990.00') || '%' using errcode = '22023';
  end if;
  return coalesce(v_worst, 0);
end $function$;

revoke all on function public.set_node_rate(text, uuid, numeric) from public, anon;
grant execute on function public.set_node_rate(text, uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. CREATING AN AGREEMENT clears what it replaces in the SAME transaction, and
--    audits each clearance with who, when and the old value.
-- ---------------------------------------------------------------------------
create or replace function public.create_agreement(
  p_level text, p_id uuid, p_coverage text, p_period text, p_counting_scope text,
  p_bands jsonb, p_tiers jsonb default '[]'::jsonb, p_note text default null,
  p_confirm_replace boolean default false
)
returns uuid
language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid; c record; v_actor text; v_n int; b jsonb; t jsonb; v_worst numeric;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_coverage not in ('additive','all_in') then
    raise exception 'Coverage must be additive or all-in.' using errcode = '22023';
  end if;
  if p_coverage = 'all_in' and p_level not in ('group','agency') then
    raise exception 'An all-in agreement covers everything under a group or an agency, so it cannot sit on a %.', p_level
      using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_bands,'[]'::jsonb)) < 1 then
    raise exception 'An agreement needs at least one tenant-count band.' using errcode = '22023';
  end if;

  select count(*) into v_n from public.agreement_conflicts(p_level, p_id, p_coverage);
  if v_n > 0 and not p_confirm_replace then
    raise exception 'This would replace % existing arrangement(s). Confirm to clear them.', v_n
      using errcode = '22023';
  end if;

  select full_name into v_actor from public.users where id = auth.uid();

  for c in select * from public.agreement_conflicts(p_level, p_id, p_coverage) loop
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
         and ended_at is null;
    end if;
  end loop;

  insert into public.pricing_agreements
    (scope_level, scope_id, coverage, period, counting_scope, note, created_by, effective_from, is_standard)
  values (p_level, p_id, p_coverage, p_period, p_counting_scope, p_note, auth.uid(), current_date, false)
  returning id into v_id;

  for b in select * from jsonb_array_elements(p_bands) loop
    insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, agent_rate)
    values (v_id, coalesce((b->>'min')::int, 1), nullif(b->>'max','')::int,
            (b->>'weeks')::numeric, nullif(b->>'rate','')::numeric);
  end loop;
  for t in select * from jsonb_array_elements(coalesce(p_tiers,'[]'::jsonb)) loop
    insert into public.commission_tiers (agreement_id, from_count, to_count, agent_rate)
    values (v_id, (t->>'from')::int, nullif(t->>'to','')::int, (t->>'rate')::numeric);
  end loop;

  v_worst := public.assert_agreement_within_cap(v_id);

  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values (p_level, p_id, 'agreement_created',
          p_coverage || ' agreement, volume per ' || p_counting_scope || ' per ' || p_period ||
          ', worst branch total ' || to_char(round(v_worst * 100, 2), 'FM999990.00') || '%',
          coalesce(v_actor,'an administrator'), auth.uid());
  return v_id;
end $function$;

comment on function public.create_agreement(text, uuid, text, text, text, jsonb, jsonb, text, boolean) is
  'The only way to put a negotiated agreement on a party. Clears the rate (and, for all-in, every arrangement inside the subtree) it replaces in the same transaction, audits each clearance with who and the old value, then checks the 50% cap against the worst case the new shape allows.';

revoke all on function public.create_agreement(text, uuid, text, text, text, jsonb, jsonb, text, boolean) from public, anon;
grant execute on function public.create_agreement(text, uuid, text, text, text, jsonb, jsonb, text, boolean) to authenticated;

-- Ending an agreement returns the party to standard terms, unless a rate is set.
create or replace function public.end_agreement(p_agreement uuid)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare v_actor text; a record;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  select * into a from public.pricing_agreements where id = p_agreement;
  if not found then raise exception 'Agreement not found' using errcode = '22023'; end if;
  if a.is_standard then raise exception 'Standard terms cannot be ended.' using errcode = '22023'; end if;
  if a.ended_at is not null then raise exception 'That agreement has already ended.' using errcode = '22023'; end if;
  select full_name into v_actor from public.users where id = auth.uid();
  update public.pricing_agreements set ended_at = now() where id = p_agreement;
  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values (a.scope_level, a.scope_id, 'agreement_ended',
          'Back to standard terms unless a rate is now set.', coalesce(v_actor,'an administrator'), auth.uid());
end $function$;

revoke all on function public.end_agreement(uuid) from public, anon;
grant execute on function public.end_agreement(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. RESOLUTION. Additive is byte-identical to M4. All-in silences its subtree.
-- ---------------------------------------------------------------------------

-- The resolver learns about ended_at. Everything else here is M4's function,
-- unchanged: one agreement, one band, optionally one volume tier.
create or replace function public.resolve_pricing_agreement(
  p_branch uuid, p_route_partner uuid, p_tenant_count int default 1
)
returns table (id uuid, scope_level text, fee_basis_weeks numeric, agent_rate numeric)
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
      and pa.effective_from <= current_date
      and (pa.effective_to is null or pa.effective_to >= current_date)
      and (
        (pa.scope_level = 'agency'  and pa.scope_id = ctx.agency_id)
        or (pa.scope_level = 'group'   and ctx.group_id is not null and pa.scope_id = ctx.group_id)
        or (pa.scope_level = 'partner' and pa.scope_id = p_route_partner)
      )
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
      and public.agreement_volume(ag.id, p_branch) >= t.from_count
      and (t.to_count is null or public.agreement_volume(ag.id, p_branch) < t.to_count)
    order by t.from_count desc
    limit 1
  )
  select ag.id, ag.scope_level,
         (select fee_basis_weeks from band),
         coalesce((select agent_rate from tier), (select agent_rate from band))
  from agreement ag
$function$;

revoke all on function public.resolve_pricing_agreement(uuid, uuid, int) from public, anon;
grant execute on function public.resolve_pricing_agreement(uuid, uuid, int) to authenticated, service_role;
create or replace function public.commission_split(
  p_branch uuid, p_route_partner uuid, p_tenant_count int default 1
)
returns table (level text, org_id uuid, org_name text, rate numeric)
language sql stable security definer set search_path to ''
as $function$
  with ag as (
    select * from public.resolve_pricing_agreement(p_branch, p_route_partner, p_tenant_count)
  ),
  cov as (
    -- The level an ALL-IN agreement sits at, or no row when the agreement is
    -- additive or absent. This is the only thing that changes the arithmetic.
    select pa.scope_level as all_in_at
    from public.pricing_agreements pa join ag on pa.id = ag.id
    where pa.coverage = 'all_in'
  )
  select r.level, r.org_id, r.org_name, r.rate
  from public.partners p
  left join public.branches b on b.id = p_branch
  left join public.agencies a on a.id = b.agency_id
  left join public.agency_groups g on g.id = a.group_id
  left join ag on true
  left join cov on true
  cross join lateral public.commission_split_rule(
    a.id, a.name,
    case cov.all_in_at when 'agency' then ag.agent_rate when 'group' then null
                       else a.agent_rate end,
    b.id, b.name,
    -- Nothing inside an all-in subtree contributes a line of its own.
    case when cov.all_in_at is not null then null else b.agent_rate end,
    g.id, g.name,
    -- A GROUP all-in is the group's whole line. An AGENCY all-in leaves the
    -- group above it untouched: the deal covers branches, not the group.
    case cov.all_in_at when 'group' then ag.agent_rate else g.agent_rate end,
    -- Standard terms, which an additive agreement's rate stands in for. Under
    -- all-in there is no fallback line to award: the agreement is the answer.
    case when cov.all_in_at is not null then null
         else coalesce(ag.agent_rate, p.agent_rate) end
  ) r
  where p.id = p_route_partner
$function$;

revoke all on function public.commission_split(uuid, uuid, int) from public, anon;
grant execute on function public.commission_split(uuid, uuid, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. THE 50% CAP against the worst case OF THE SHAPE AS CONFIGURED.
--    Additive: the agreement's highest rate plus every line above and below.
--    All-in:   the agreement alone, plus the lines above it.
-- ---------------------------------------------------------------------------

-- The highest rate an agreement can ever produce: any band, any volume tier.
create or replace function public.agreement_max_rate(p_agreement uuid)
returns numeric
language sql stable security definer set search_path to ''
as $function$
  select greatest(
    coalesce((select max(bd.agent_rate) from public.pricing_agreement_bands bd where bd.agreement_id = p_agreement), 0),
    coalesce((select max(ti.agent_rate) from public.commission_tiers ti where ti.agreement_id = p_agreement), 0)
  )
$function$;

revoke all on function public.agreement_max_rate(uuid) from public, anon;
grant execute on function public.agreement_max_rate(uuid) to authenticated, service_role;

create or replace function public.assert_agreement_within_cap(p_agreement uuid)
returns numeric
language plpgsql stable security definer set search_path to ''
as $function$
declare v_worst numeric;
begin
  select max(t.total) into v_worst
  from (
    select case
      -- ALL-IN: the agreement is everything under it, so only lines ABOVE add.
      -- Above an agency is its group; above a group there is nothing.
      when pa.coverage = 'all_in' then
        public.agreement_max_rate(pa.id)
        + case when pa.scope_level = 'agency' then coalesce(g2.agent_rate, 0) else 0 end
      -- ADDITIVE: the agreement stands in for the agency's line, and explicit
      -- branch and group lines add on top exactly as they always have.
      else
        coalesce(b2.agent_rate, 0) + coalesce(g2.agent_rate, 0)
        + greatest(public.agreement_max_rate(pa.id), coalesce(a2.agent_rate, 0))
    end as total
    from public.pricing_agreements pa
    join public.branches b2 on true
    join public.agencies a2 on a2.id = b2.agency_id
    left join public.agency_groups g2 on g2.id = a2.group_id
    where pa.id = p_agreement
      and ((pa.scope_level = 'agency'  and a2.id = pa.scope_id)
        or (pa.scope_level = 'group'   and a2.group_id = pa.scope_id)
        or (pa.scope_level = 'partner' and b2.partner_id = pa.scope_id))
  ) t;

  if v_worst is not null and v_worst > 0.50 then
    raise exception 'This agreement could take a branch to % of the guarantee fee. The most a branch may pay out in total is 50%%.',
      to_char(round(v_worst * 100, 2), 'FM999990.00') || '%' using errcode = '22023';
  end if;
  return coalesce(v_worst, 0);
end $function$;

revoke all on function public.assert_agreement_within_cap(uuid) from public, anon;
grant execute on function public.assert_agreement_within_cap(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. DEV DATA. Any party holding both is resolved in favour of the agreement,
--    and says so in the audit trail.
-- ---------------------------------------------------------------------------
do $do$
declare v_n int := 0; c record;
begin
  for c in
    select 'agency' as lvl, a.id, a.name, a.agent_rate as rate from public.agencies a
     where a.agent_rate is not null
       and (public.active_agreement_on('agency', a.id) is not null
         or public.covering_all_in_agreement('agency', a.id) is not null)
    union all
    select 'group', g.id, g.name, g.agent_rate from public.agency_groups g
     where g.agent_rate is not null and public.active_agreement_on('group', g.id) is not null
    union all
    select 'branch', b.id, b.name, b.agent_rate from public.branches b
     where b.agent_rate is not null
       and (public.active_agreement_on('branch', b.id) is not null
         or public.covering_all_in_agreement('branch', b.id) is not null)
  loop
    v_n := v_n + 1;
    insert into public.org_audit (entity_type, entity_id, action, detail, actor)
    values (c.lvl, c.id, 'rate_cleared_for_agreement',
            c.name || ' held both a rate of ' || to_char(round(c.rate * 100, 2), 'FM999990.00') ||
            '% and an agreement; the agreement wins.', 'migration 20261001100000');
    if c.lvl = 'agency'   then update public.agencies      set agent_rate = null where id = c.id;
    elsif c.lvl = 'group' then update public.agency_groups set agent_rate = null where id = c.id;
    else                       update public.branches      set agent_rate = null where id = c.id;
    end if;
    raise notice 'Cleared the % rate on % (%) in favour of its agreement.', c.lvl, c.name, c.id;
  end loop;
  raise notice 'One rate per party: % conflict(s) resolved.', v_n;
end $do$;
