-- THE ALL-IN GUARD, CLOSED IN THE OTHER DIRECTION.
--
-- covering_all_in_agreement looks UP: it stops a branch or agency setting a rate
-- underneath a deal that already covers it. Nothing looked DOWN. So an agency
-- that signed a 30% all-in could have a 5% group line added above it and its
-- branches would quietly pay 35%:
--
--   set_node_rate('group', G, 0.05)
--     -> agency_groups_one_rate fires: active_agreement_on('group',G) is null,
--        covering_all_in_agreement('group',G) is null  -> allowed
--     -> commission_split_for(B, P, <agency all-in>, 0.30) emits
--          agency 30%  (the agreement)
--          group   5%  (the new line -- lines ABOVE an all-in still add, by ruling)
--     -> 35% total, under the 50% cap, so nothing fires.
--
-- The 50% cap is not the tool here and was never meant to be: 35% is a perfectly
-- legal number that simply is not the number anybody signed. This is a
-- signed-deal breach, and it is refused by name.
--
-- HOW FAR IT REACHES, exactly. An all-in may only sit at group or agency scope
-- (pricing_agreements_all_in_scope_check), and the org tree is three levels deep
-- under a partner: group -> agency -> branch.
--   * An all-in at AGENCY scope has a GROUP above it. That is the breach.
--   * An all-in at GROUP scope has nothing above it inside the tree.
--   * The PARTNER above either cannot breach anything: partners.agent_rate only
--     ever enters the rule through the standard slot, and commission_split_for
--     passes null into that slot whenever the resolved agreement is all-in. A
--     partner-scoped agreement is likewise shadowed, because
--     resolve_pricing_agreement takes the most specific one and stops. So the
--     partner level is deliberately NOT guarded: there is no defect behind it,
--     and refusing it would be symmetry for its own sake.
--
-- ONLY ALL-IN COUNTS. An ADDITIVE agreement is, by the ruling, a party's own line
-- with everything else adding on top -- that is its whole definition, not a
-- breach of it. Widening this guard to additive agreements would contradict the
-- ruling and the assertions that pin it.
--
-- WHY A TRIGGER, AND HOW A CONFIRMATION REACHES ONE. The upward guards are
-- triggers so the rule holds however the row is written -- set_node_rate,
-- set_group_rates, or a raw UPDATE from a future screen that forgets. A trigger
-- cannot take an argument, so the confirmation travels as a TRANSACTION-LOCAL
-- setting, set by the RPC and invisible outside its own transaction. That
-- mechanism is already in this codebase (app.purging_sandbox,
-- 20260810360000_dev_centre_fixes.sql), and it is the only way to keep the
-- enforcement structural while still allowing a deliberate, audited override.

-- ---------------------------------------------------------------------------
-- 1. The mirror of covering_all_in_agreement: what is all-in BELOW this party.
-- ---------------------------------------------------------------------------
create or replace function public.all_in_agreement_below(p_level text, p_id uuid)
returns uuid
language sql stable security definer set search_path to ''
as $function$
  select pa.id
  from public.pricing_agreements pa
  where pa.coverage = 'all_in' and not pa.is_standard and pa.ended_at is null
    and pa.effective_from <= current_date
    and (pa.effective_to is null or pa.effective_to >= current_date)
    and not (pa.scope_level = p_level and pa.scope_id = p_id)   -- below, not itself
    and (
      -- The only descendant that can hold an agreement today is an agency under
      -- a group: branch-scoped agreements are refused by the scope_level CHECK.
      -- Written as a general descendant test so it stays correct if that changes.
      (p_level = 'group' and pa.scope_level = 'agency'
        and pa.scope_id in (select a.id from public.agencies a where a.group_id = p_id))
      or (p_level = 'group' and pa.scope_level = 'group' and false)
    )
  order by pa.effective_from desc
  limit 1
$function$;

comment on function public.all_in_agreement_below(text, uuid) is
  'The live all-in agreement sitting strictly BELOW this party, if any. The mirror of covering_all_in_agreement: that one stops a party pricing itself under a deal that covers it, this one stops a party pricing itself OVER a deal it would breach.';

revoke all on function public.all_in_agreement_below(text, uuid) from public, anon;
grant execute on function public.all_in_agreement_below(text, uuid) to authenticated, service_role;

-- What the breach would cost, in the words an admin needs: both parties, the
-- number that was agreed, and the number the branches would actually pay.
create or replace function public.all_in_breach_detail(p_level text, p_id uuid, p_rate numeric)
returns text
language plpgsql stable security definer set search_path to ''
as $function$
declare v_agr uuid; v_below text; v_above text; v_agreed numeric;
begin
  v_agr := public.all_in_agreement_below(p_level, p_id);
  if v_agr is null then return null; end if;
  v_below := public.agreement_party_name(v_agr);
  v_agreed := public.agreement_max_rate(v_agr);
  select coalesce(g.name, a.name) into v_above
  from (select 1) o
  left join public.agency_groups g on p_level = 'group'  and g.id = p_id
  left join public.agencies      a on p_level = 'agency' and a.id = p_id;

  return coalesce(v_above, 'A party above') || ' at '
      || to_char(round(coalesce(p_rate, 0) * 100, 2), 'FM999990.00') || '% sits above '
      || coalesce(v_below, 'an agency') || ', which holds an all-in agreement at '
      || to_char(round(v_agreed * 100, 2), 'FM999990.00')
      || '%. An all-in agreement is the whole commission for everything under it, so this line takes '
      || coalesce(v_below, 'that agency') || '''s branches to '
      || to_char(round((v_agreed + coalesce(p_rate, 0)) * 100, 2), 'FM999990.00')
      || '% rather than the ' || to_char(round(v_agreed * 100, 2), 'FM999990.00') || '% agreed.';
end $function$;

comment on function public.all_in_breach_detail(text, uuid, numeric) is
  'The sentence an admin is refused with, and the sentence the audit trail keeps: both parties named, the rate that was agreed, and the rate the subtree would actually pay.';

revoke all on function public.all_in_breach_detail(text, uuid, numeric) from public, anon;
grant execute on function public.all_in_breach_detail(text, uuid, numeric) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. THE GUARD, on the rate path. Symmetric with the upward check right above it.
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

  -- UPWARD: a deal above already covers this party.
  v_agr := public.covering_all_in_agreement(v_level, new.id);
  if v_agr is not null then
    raise exception 'An all-in agreement with % covers this %, and an all-in agreement is the whole commission for everything under it. Change that agreement instead.',
      public.agreement_party_name(v_agr), v_level using errcode = '22023';
  end if;

  -- DOWNWARD: a deal below would be breached by a line added above it. Refused
  -- by name, unless the administrator has deliberately confirmed it through
  -- set_node_rate, which audits the override.
  if public.all_in_agreement_below(v_level, new.id) is not null
     and coalesce(current_setting('app.confirm_all_in_breach', true), 'off') <> 'on' then
    raise exception '%', public.all_in_breach_detail(v_level, new.id, new.agent_rate)
      using errcode = '22023';
  end if;

  return new;
end $function$;

-- ---------------------------------------------------------------------------
-- 3. THE GUARD, on the agreement path.
-- ---------------------------------------------------------------------------
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

  -- DOWNWARD, the same breach through the other door: an ADDITIVE agreement
  -- landing above an all-in adds its line just as an explicit rate would.
  --
  -- Deliberately after the all_in block, so converting a group to all-in over an
  -- agency all-in is still refused by the clear-them-first message above rather
  -- than by this one -- that case is a conflict to resolve, not a breach to
  -- confirm. An all-in above an all-in never reaches here.
  if new.coverage = 'additive'
     and public.all_in_agreement_below(new.scope_level, new.scope_id) is not null
     and coalesce(current_setting('app.confirm_all_in_breach', true), 'off') <> 'on' then
    raise exception '%', public.all_in_breach_detail(
      new.scope_level, new.scope_id,
      coalesce((select max(bd.agent_rate) from public.pricing_agreement_bands bd where bd.agreement_id = new.id), 0))
      using errcode = '22023';
  end if;

  return new;
end $function$;

-- ---------------------------------------------------------------------------
-- 4. SETTING A RATE, with the deliberate override.
--
-- The old three-argument signature must GO rather than be superseded: with the
-- fourth argument defaulted, a three-argument call matches both and PostgREST
-- refuses to choose ("function is not unique"). The same move as
-- 20260929110000 (commission_total) and 20260927100000
-- (admin_create_agency_and_branch). src/data/orgService.ts calls this by NAMED
-- arguments and keeps working unchanged: PostgREST fills the default.
-- ---------------------------------------------------------------------------
drop function if exists public.set_node_rate(text, uuid, numeric);

create or replace function public.set_node_rate(
  p_level text, p_id uuid, p_rate numeric, p_confirm_breach boolean default false
)
returns numeric
language plpgsql security definer set search_path to ''
as $function$
declare v_worst numeric; v_breach uuid; v_detail text; v_actor text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_level not in ('group','agency','branch') then
    raise exception 'Unknown level %', p_level using errcode = '22023';
  end if;
  if p_rate is not null and (p_rate < 0 or p_rate > 1) then
    raise exception 'A rate must be between 0%% and 100%%.' using errcode = '22023';
  end if;

  -- Clearing a rate can never breach a deal below: it removes a line.
  v_breach := case when p_rate is null then null
                   else public.all_in_agreement_below(p_level, p_id) end;
  if v_breach is not null then
    v_detail := public.all_in_breach_detail(p_level, p_id, p_rate);
    if p_confirm_breach then
      -- Transaction-local, set here rather than by any caller, so it cannot
      -- reach another statement or another session.
      perform set_config('app.confirm_all_in_breach', 'on', true);
    end if;
  end if;

  -- One rate per party, and the all-in guards both ways, are enforced by trigger,
  -- so this write simply fails when it should.
  if p_level = 'group'  then update public.agency_groups set agent_rate = p_rate where id = p_id;
  elsif p_level = 'agency' then update public.agencies     set agent_rate = p_rate where id = p_id;
  else                          update public.branches      set agent_rate = p_rate where id = p_id;
  end if;

  if v_breach is not null and p_confirm_breach then
    select full_name into v_actor from public.users where id = auth.uid();
    insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
    values (p_level, p_id, 'all_in_breach_confirmed', v_detail,
            coalesce(v_actor, 'an administrator'), auth.uid());
    -- And against the deal that was broken, so it is on ITS record too: the
    -- party who finds out is the one whose agreement moved.
    insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
    select pa.scope_level, pa.scope_id, 'all_in_breach_confirmed', v_detail,
           coalesce(v_actor, 'an administrator'), auth.uid()
    from public.pricing_agreements pa where pa.id = v_breach;
    -- Do not leave the override standing for whatever else runs in this
    -- transaction. One confirmation, one write.
    perform set_config('app.confirm_all_in_breach', 'off', true);
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

comment on function public.set_node_rate(text, uuid, numeric, boolean) is
  'Set or clear one party''s explicit rate. Refused where an agreement already prices the party, where an all-in deal above covers it, and where an all-in deal BELOW it would be breached -- that last one only until an administrator confirms, which audits the override against both parties.';

revoke all on function public.set_node_rate(text, uuid, numeric, boolean) from public, anon;
grant execute on function public.set_node_rate(text, uuid, numeric, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. CREATING AN AGREEMENT, with the same override.
--
-- A distinct flag from p_confirm_replace, deliberately: "clear the rate this
-- replaces" and "break a signed deal below" are two different consents, and one
-- tick must not stand for both. Same drop-and-recreate rule as above -- every
-- argument from the seventh on is defaulted, so a new defaulted tenth would make
-- a nine-argument call ambiguous.
-- ---------------------------------------------------------------------------
drop function if exists public.create_agreement(text, uuid, text, text, text, jsonb, jsonb, text, boolean);

create or replace function public.create_agreement(
  p_level text, p_id uuid, p_coverage text, p_period text, p_counting_scope text,
  p_bands jsonb, p_tiers jsonb default '[]'::jsonb, p_note text default null,
  p_confirm_replace boolean default false, p_confirm_breach boolean default false
)
returns uuid
language plpgsql security definer set search_path to ''
as $function$
declare
  v_id uuid; c record; v_actor text; v_n int; b jsonb; t jsonb; v_worst numeric;
  v_breach uuid; v_detail text; v_mx numeric;
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

  -- The signed-deal breach, checked before anything is written so the refusal
  -- costs nothing. Only an ADDITIVE agreement can breach one below; an all-in
  -- above an all-in is a conflict the exclusivity trigger already refuses.
  v_breach := case when p_coverage = 'additive'
                   then public.all_in_agreement_below(p_level, p_id) end;
  if v_breach is not null then
    select max((x->>'rate')::numeric) into v_mx from jsonb_array_elements(p_bands) x;
    v_detail := public.all_in_breach_detail(p_level, p_id, coalesce(v_mx, 0));
    if not p_confirm_breach then
      raise exception '%', v_detail using errcode = '22023';
    end if;
    perform set_config('app.confirm_all_in_breach', 'on', true);
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

  if v_breach is not null then
    insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
    values (p_level, p_id, 'all_in_breach_confirmed', v_detail,
            coalesce(v_actor,'an administrator'), auth.uid());
    insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
    select pa.scope_level, pa.scope_id, 'all_in_breach_confirmed', v_detail,
           coalesce(v_actor,'an administrator'), auth.uid()
    from public.pricing_agreements pa where pa.id = v_breach;
    perform set_config('app.confirm_all_in_breach', 'off', true);
  end if;

  return v_id;
end $function$;

comment on function public.create_agreement(text, uuid, text, text, text, jsonb, jsonb, text, boolean, boolean) is
  'The only way to put a negotiated agreement on a party. Clears the rate (and, for all-in, every arrangement inside the subtree) it replaces in the same transaction, audited; refuses to sit above an all-in deal it would breach unless that is separately confirmed; then checks the 50% cap against the worst case the new shape allows.';

revoke all on function public.create_agreement(text, uuid, text, text, text, jsonb, jsonb, text, boolean, boolean) from public, anon;
grant execute on function public.create_agreement(text, uuid, text, text, text, jsonb, jsonb, text, boolean, boolean) to authenticated;
