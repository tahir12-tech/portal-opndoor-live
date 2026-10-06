-- THE ALL-IN GUARD, CORRECTED IN FOUR PLACES.
--
-- Adversarial review of 20261003100000 found four things, and one of them makes
-- the guard bypassable by doing the two writes in the other order.
--
-- 1. IT WAS ONE-DIRECTIONAL IN TIME. The guard fires when a line is added ABOVE
--    an existing all-in. Nothing fired when the all-in was signed UNDERNEATH an
--    existing line. Same breach, same 35%, reached by reversing two steps:
--      set_node_rate('group', G, 0.05)        -- nothing below yet, allowed
--      create_agreement('agency', A, 'all_in', 30%)  -- nothing above looks for
--                                                       a RATE, so allowed
--    and A's branches pay 35% against a signed 30%, unrefused and unaudited.
--    Closed here: an all-in landing under a rated ancestor is the same breach
--    and takes the same confirmation.
--
-- 2. RE-PARENTING WAS A FOURTH DOOR. set_agency_group moves an agency between
--    groups and touches no rate at all, so no rate trigger fires. Moving an
--    all-in agency under a group that already charges 5% is the breach again,
--    with nothing in its way. Closed.
--
-- 3. THE AGREEMENT-ABOVE REFUSAL WAS A FALSE POSITIVE, and this is the one the
--    requirement's premise got wrong. A group ADDITIVE agreement above an all-in
--    agency never reaches that agency's branches: resolve_pricing_agreement
--    takes the single most specific agreement and stops, and 'agency' sorts
--    before 'group', so the all-in wins and the group's deal is never consulted.
--    The group slot then reads g.agent_rate, which is null because the group
--    holds an agreement rather than a rate. A's branches keep paying exactly 30%.
--    So the old check refused a legitimate deal and, if overridden, wrote an
--    audit row onto the aggrieved agency's record asserting a 35% it does not
--    pay. Removed. What IS true about that case is reported, not enforced: the
--    group's agreement is silently inert for the all-in agency's branches.
--
-- 4. THE MESSAGE NAMED ONE BREACHED AGREEMENT AND GUESSED A RATE. A group over
--    two all-in agencies breached both and told the admin about one. And on the
--    agreement path the rate was read from bands that a BEFORE INSERT trigger
--    cannot see yet, so it rendered "at 0.00%". Both fixed: every breached deal
--    is named and audited, and no sentence states a number it does not have.

-- ---------------------------------------------------------------------------
-- 1. EVERY all-in below, not just the first.
-- ---------------------------------------------------------------------------
create or replace function public.all_in_agreements_below(p_level text, p_id uuid)
returns table (agreement_id uuid, party_name text, agreed_rate numeric)
language sql stable security definer set search_path to ''
as $function$
  select pa.id, a.name, public.agreement_max_rate(pa.id)
  from public.pricing_agreements pa
  join public.agencies a on a.id = pa.scope_id
  where pa.coverage = 'all_in' and not pa.is_standard and pa.ended_at is null
    and pa.effective_from <= current_date
    and (pa.effective_to is null or pa.effective_to >= current_date)
    -- The ONLY descendant that can hold an agreement is an agency under a group.
    and p_level = 'group' and pa.scope_level = 'agency' and a.group_id = p_id
  order by a.name
$function$;

comment on function public.all_in_agreements_below(text, uuid) is
  'Every live all-in agreement sitting strictly below this party. Plural because a group can sit over several, and telling an administrator about one of three is telling them the wrong thing.';

revoke all on function public.all_in_agreements_below(text, uuid) from public, anon;
grant execute on function public.all_in_agreements_below(text, uuid) to authenticated, service_role;

-- The scalar stays as the guard's predicate: cheap, and "is there one" is the
-- question a trigger asks.
create or replace function public.all_in_agreement_below(p_level text, p_id uuid)
returns uuid
language sql stable security definer set search_path to ''
as $function$
  select agreement_id from public.all_in_agreements_below(p_level, p_id) limit 1
$function$;

-- ---------------------------------------------------------------------------
-- 2. The sentence, built once, used by both directions and by the audit trail.
-- ---------------------------------------------------------------------------
create or replace function public.all_in_breach_sentence(
  p_above text, p_above_rate numeric, p_below text, p_agreed numeric
)
returns text
language sql immutable set search_path to ''
as $function$
  select
    -- A rate the caller does not yet know (an agreement's bands do not exist
    -- when its BEFORE INSERT trigger runs) is left out rather than printed as
    -- zero, which is how this came to say "at 0.00%".
    coalesce(p_above, 'A party above')
    || case when p_above_rate is null then ' '
            else ' at ' || to_char(round(p_above_rate * 100, 2), 'FM999990.00') || '% ' end
    || 'sits above ' || coalesce(p_below, 'an agency')
    || ', which holds an all-in agreement at '
    || to_char(round(coalesce(p_agreed, 0) * 100, 2), 'FM999990.00')
    || '%. An all-in agreement is the whole commission for everything under it, so this line takes '
    || coalesce(p_below, 'that agency') || '''s branches to '
    || case when p_above_rate is null then 'more'
            else to_char(round((coalesce(p_agreed,0) + p_above_rate) * 100, 2), 'FM999990.00') || '%' end
    || ' rather than the ' || to_char(round(coalesce(p_agreed,0) * 100, 2), 'FM999990.00') || '% agreed.'
$function$;

revoke all on function public.all_in_breach_sentence(text, numeric, text, numeric) from public, anon;
grant execute on function public.all_in_breach_sentence(text, numeric, text, numeric) to authenticated, service_role;

-- Every breached deal, in one message.
--
-- ADMIN ONLY. It states a negotiated rate, which is somebody's commercial terms;
-- the old version was granted to every authenticated user for any party id.
create or replace function public.all_in_breach_detail(p_level text, p_id uuid, p_rate numeric)
returns text
language plpgsql stable security definer set search_path to ''
as $function$
declare v_above text;
begin
  if not public.is_admin() then return null; end if;
  if not exists (select 1 from public.all_in_agreements_below(p_level, p_id)) then return null; end if;

  select coalesce(g.name, a.name) into v_above
  from (select 1) o
  left join public.agency_groups g on p_level = 'group'  and g.id = p_id
  left join public.agencies      a on p_level = 'agency' and a.id = p_id;

  return (select string_agg(
            public.all_in_breach_sentence(v_above, p_rate, b.party_name, b.agreed_rate), ' ')
          from public.all_in_agreements_below(p_level, p_id) b);
end $function$;

revoke all on function public.all_in_breach_detail(text, uuid, numeric) from public, anon;
grant execute on function public.all_in_breach_detail(text, uuid, numeric) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. THE MIRROR: an all-in signed UNDERNEATH a line that already exists.
-- ---------------------------------------------------------------------------
create or replace function public.rate_above_all_in(p_level text, p_id uuid)
returns table (party_name text, rate numeric)
language sql stable security definer set search_path to ''
as $function$
  -- Only an agency has anything above it that can add a line. Above a group is
  -- the partner, whose rate reaches only the standard slot, which
  -- commission_split_for nulls under all-in.
  select g.name, g.agent_rate
  from public.agencies a join public.agency_groups g on g.id = a.group_id
  where p_level = 'agency' and a.id = p_id and g.agent_rate is not null
$function$;

comment on function public.rate_above_all_in(text, uuid) is
  'The explicit line already sitting above this party, which an all-in agreement landing here would be breached by. The mirror of all_in_agreements_below, so the guard holds whichever of the two writes happens second.';

revoke all on function public.rate_above_all_in(text, uuid) from public, anon;
grant execute on function public.rate_above_all_in(text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. THE TRIGGERS.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_agreement_exclusivity()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
declare v_rate numeric; v_agr uuid; v_n int; r record;
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
    select count(*) into v_n
    from public.agreement_conflicts(new.scope_level, new.scope_id, 'all_in') c
    where not (c.kind = 'agreement' and c.level = new.scope_level and c.node_id = new.scope_id);
    if v_n > 0 then
      raise exception 'An all-in agreement is the whole commission for everything under this %, but % arrangement(s) inside it are still set. Clear them first.',
        new.scope_level, v_n using errcode = '22023';
    end if;

    -- THE MIRROR BREACH. A line already above this party adds to the all-in the
    -- same way one added later would, so signing the deal second is refused the
    -- same way as adding the line second.
    for r in select * from public.rate_above_all_in(new.scope_level, new.scope_id) loop
      if coalesce(current_setting('app.confirm_all_in_breach', true), 'off') <> 'on' then
        raise exception '%', public.all_in_breach_sentence(
          r.party_name, r.rate,
          coalesce((select a.name from public.agencies a where a.id = new.scope_id), 'this agency'),
          -- The bands do not exist yet on an INSERT; the sentence leaves the
          -- number out rather than printing a zero it made up.
          (select max(bd.agent_rate) from public.pricing_agreement_bands bd where bd.agreement_id = new.id))
          using errcode = '22023';
      end if;
    end loop;
  end if;

  -- NOTE: there is deliberately no downward check for an ADDITIVE agreement
  -- landing above an all-in. It reaches nothing: resolve_pricing_agreement takes
  -- the single most specific agreement, 'agency' sorts before 'group', so the
  -- all-in wins for that agency's branches and the group's deal never applies to
  -- them. Refusing it refused a legitimate deal and, when overridden, wrote an
  -- audit row asserting an increase that never happened.
  return new;
end $function$;

-- ---------------------------------------------------------------------------
-- 5. RE-PARENTING, the fourth door.
-- ---------------------------------------------------------------------------
create or replace function public.set_agency_group(p_agency uuid, p_group uuid)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare me uuid := auth.uid(); a_pid uuid; g_pid uuid; v_rate numeric; v_name text; v_agr uuid;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select partner_id into a_pid from public.agencies where id = p_agency;
  if a_pid is null then raise exception 'Agency not found' using errcode = '22023'; end if;
  if not (public.is_admin() or (public.app_role() = 'management' and a_pid = public.app_partner())) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_group is not null then
    select partner_id into g_pid from public.agency_groups where id = p_group;
    if g_pid is null then raise exception 'Group not found' using errcode = '22023'; end if;
    if g_pid <> a_pid then raise exception 'The group and the agency are under different partners.' using errcode = '22023'; end if;

    -- Moving an all-in agency under a group that already charges is the same
    -- breach as adding the charge above it, and touches no rate, so no rate
    -- trigger would see it.
    v_agr := public.active_agreement_on('agency', p_agency);
    if v_agr is not null and (select coverage from public.pricing_agreements where id = v_agr) = 'all_in' then
      select g.agent_rate, g.name into v_rate, v_name from public.agency_groups g where g.id = p_group;
      if v_rate is not null then
        raise exception '%', public.all_in_breach_sentence(
          v_name, v_rate,
          (select name from public.agencies where id = p_agency),
          public.agreement_max_rate(v_agr)) using errcode = '22023';
      end if;
    end if;
  end if;

  update public.agencies set group_id = p_group where id = p_agency;
  insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
  values ('agency', p_agency, 'group_set', coalesce((select name from public.agency_groups where id = p_group), 'detached'),
    coalesce((select full_name from public.users where id = me), 'an administrator'), me);
end $function$;

revoke all on function public.set_agency_group(uuid, uuid) from public, anon;
grant execute on function public.set_agency_group(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. create_agreement: drop the false-positive check, add the mirror, and audit
--    EVERY breached deal rather than the first.
-- ---------------------------------------------------------------------------
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
  v_detail text; v_mx numeric; r record; v_breached boolean := false;
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

  -- THE MIRROR BREACH, checked before anything is written so the refusal costs
  -- nothing. An ADDITIVE agreement above an all-in is NOT a breach and is no
  -- longer checked: it never reaches that agency's branches.
  select max((x->>'rate')::numeric) into v_mx from jsonb_array_elements(p_bands) x;
  if p_coverage = 'all_in' then
    for r in select * from public.rate_above_all_in(p_level, p_id) loop
      v_breached := true;
      v_detail := public.all_in_breach_sentence(
        r.party_name, r.rate,
        (select name from public.agencies where id = p_id), v_mx);
      if not p_confirm_breach then
        raise exception '%', v_detail using errcode = '22023';
      end if;
    end loop;
    if v_breached then perform set_config('app.confirm_all_in_breach', 'on', true); end if;
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

  if v_breached then
    -- Against the party that signed, and against the group whose line breaches
    -- it: the ones who need to find out are both of them.
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

revoke all on function public.create_agreement(text, uuid, text, text, text, jsonb, jsonb, text, boolean, boolean) from public, anon;
grant execute on function public.create_agreement(text, uuid, text, text, text, jsonb, jsonb, text, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. set_node_rate audits EVERY breached deal, not the first.
-- ---------------------------------------------------------------------------
create or replace function public.set_node_rate(
  p_level text, p_id uuid, p_rate numeric, p_confirm_breach boolean default false
)
returns numeric
language plpgsql security definer set search_path to ''
as $function$
declare v_worst numeric; v_detail text; v_actor text; v_any boolean; b record;
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
  v_any := p_rate is not null
       and exists (select 1 from public.all_in_agreements_below(p_level, p_id));
  if v_any then
    v_detail := public.all_in_breach_detail(p_level, p_id, p_rate);
    if p_confirm_breach then
      -- Transaction-local, set here rather than by any caller.
      perform set_config('app.confirm_all_in_breach', 'on', true);
    end if;
  end if;

  if p_level = 'group'  then update public.agency_groups set agent_rate = p_rate where id = p_id;
  elsif p_level = 'agency' then update public.agencies     set agent_rate = p_rate where id = p_id;
  else                          update public.branches      set agent_rate = p_rate where id = p_id;
  end if;

  if v_any and p_confirm_breach then
    select full_name into v_actor from public.users where id = auth.uid();
    insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
    values (p_level, p_id, 'all_in_breach_confirmed', v_detail,
            coalesce(v_actor, 'an administrator'), auth.uid());
    -- EVERY deal that was broken, on its own record. A group over three all-in
    -- agencies breaches three agreements, and each of those agencies is entitled
    -- to find it on theirs.
    for b in select * from public.all_in_agreements_below(p_level, p_id) loop
      insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
      select pa.scope_level, pa.scope_id, 'all_in_breach_confirmed',
             public.all_in_breach_sentence(
               (select coalesce(g.name, a.name) from (select 1) o
                  left join public.agency_groups g on p_level = 'group'  and g.id = p_id
                  left join public.agencies      a on p_level = 'agency' and a.id = p_id),
               p_rate, b.party_name, b.agreed_rate),
             coalesce(v_actor, 'an administrator'), auth.uid()
      from public.pricing_agreements pa where pa.id = b.agreement_id;
    end loop;
    perform set_config('app.confirm_all_in_breach', 'off', true);
  end if;

  select max(t.total) into v_worst
  from (
    select public.commission_total(b2.id, b2.partner_id) as total
    from public.branches b2
    left join public.agencies a on a.id = b2.agency_id
    where (p_level = 'branch' and b2.id = p_id)
       or (p_level = 'agency' and b2.agency_id = p_id)
       or (p_level = 'group'  and a.group_id = p_id)
  ) t;

  if v_worst is not null and v_worst > 0.50 then
    raise exception 'That rate would take a branch to % of the guarantee fee. The most a branch may pay out in total is 50%%.',
      to_char(round(v_worst * 100, 2), 'FM999990.00') || '%' using errcode = '22023';
  end if;
  return coalesce(v_worst, 0);
end $function$;

revoke all on function public.set_node_rate(text, uuid, numeric, boolean) from public, anon;
grant execute on function public.set_node_rate(text, uuid, numeric, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The shares message printed its percent sign in front of the number.
--
-- In a RAISE format '%%' is a literal percent and '%' is a placeholder, so
-- '%%%' reads as literal-then-placeholder: "The shares total %85.00, not 100%."
-- The sign has to travel inside the argument instead.
-- ---------------------------------------------------------------------------
create or replace function public.create_joint_referral(
  p_branch uuid, p_tenants jsonb,
  p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text,
  p_rent numeric, p_tenancy_start date
)
returns setof public.applications
language plpgsql security definer set search_path to ''
as $function$
declare
  ag uuid; pid uuid; v_route uuid; v_mode text; v_portal_ok boolean;
  v_n int; v_pct numeric; v_fee numeric; v_basis numeric; v_agreement uuid;
  v_tenancy uuid; t jsonb; v_share_pct numeric; v_share_rent numeric;
  v_app public.applications; v_i int := 0; v_emails text[];
  v_pcts numeric[]; v_fees numeric[];
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  v_n := jsonb_array_length(p_tenants);
  if v_n is null or v_n < 1 then raise exception 'At least one tenant is required.' using errcode = '22023'; end if;

  select b.agency_id, b.partner_id into ag, pid from public.branches b where b.id = p_branch;
  if ag is null then raise exception 'Selected branch not found' using errcode = '22023'; end if;

  if not (public.is_admin()
          or (public.app_role() in ('management','referrer') and pid = public.app_partner())) then
    raise exception 'not permitted for this partner' using errcode = '42501';
  end if;

  v_route := public.resolve_route_partner(p_branch, null);
  select p.portal_referrals_enabled into v_portal_ok from public.partners p where p.id = v_route;
  if not found then raise exception 'Route partner not found' using errcode = '22023'; end if;
  v_mode := public.resolve_referencing_mode(p_branch, v_route);

  if v_mode <> 'opndoor_referenced' then
    raise exception 'This agent''s references are already done before the referral reaches us, and a pre-referenced referral covers one tenant. Refer each tenant separately.'
      using errcode = '22023';
  end if;

  if not public.is_admin() then
    if not (case when public.app_has_scope()
                 then p_branch in (select public.app_scope_branches())
                 else p_branch = (select u.home_branch_id from public.users u where u.id = auth.uid())
            end) then
      raise exception 'You can only refer against a branch within your own scope.' using errcode = '42501';
    end if;
  end if;
  if not coalesce(v_portal_ok, true) then
    raise exception 'This partner does not create referrals in the portal.' using errcode = '42501';
  end if;

  select array_agg((x->>'share_percent')::numeric order by ord) into v_pcts
  from jsonb_array_elements(p_tenants) with ordinality as e(x, ord);
  select coalesce(sum(s), 0) into v_pct from unnest(v_pcts) s;
  if abs(v_pct - 100) > 0.01 then
    raise exception 'The tenants'' shares total %, not 100%%. Adjust them by %.',
      to_char(v_pct,'FM999990.00') || '%', to_char(100 - v_pct,'FM999990.00') || '%'
      using errcode = '22023';
  end if;

  select array_agg(lower(btrim(x->>'email'))) into v_emails from jsonb_array_elements(p_tenants) x;
  if (select count(distinct e) from unnest(v_emails) e) <> v_n then
    raise exception 'Two tenants have the same email address.' using errcode = '22023';
  end if;

  select f.fee_amount, f.fee_basis_weeks, f.agreement_id
    into v_fee, v_basis, v_agreement
  from public.resolve_fee(p_branch, v_route, p_rent, v_n) f;
  v_fees := public.apportion(v_fee, v_pcts);

  insert into public.tenancies (monthly_rent, tenancy_start, prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode)
  values (p_rent, p_tenancy_start, btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')),''),
          btrim(p_city), nullif(btrim(coalesce(p_county,'')),''), upper(btrim(p_postcode)))
  returning id into v_tenancy;

  for t in select value from jsonb_array_elements(p_tenants) with ordinality as e(value, ord) order by ord loop
    v_i := v_i + 1;
    v_share_pct := (t->>'share_percent')::numeric;
    v_share_rent := round(p_rent * v_share_pct / 100.0, 2);

    perform public.assert_referral_valid(
      p_branch, t->>'title', t->>'first', t->>'last', (t->>'dob')::date, t->>'email', t->>'phone',
      p_addr1, p_addr2, p_city, p_county, p_postcode, p_rent, p_tenancy_start);

    insert into public.applications(
      guarantee_ref, fee_amount, fee_basis_weeks, pricing_agreement_id,
      tenancy_id, tenancy_position, share_percent, share_amount,
      branch_id, agency_id, partner_id, referrer_id, referrer_name,
      tenant_title, tenant_first_name, tenant_middle_name, tenant_last_name,
      tenant_dob, tenant_email, tenant_phone,
      prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
      monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate, livemode, referencing_mode
    ) values (
      'GR-' || nextval('public.guarantee_ref_seq')::text,
      v_fees[v_i], v_basis, v_agreement,
      v_tenancy, v_i, v_share_pct, v_share_rent,
      p_branch, ag, v_route, auth.uid(),
      (select full_name from public.users where id = auth.uid()),
      t->>'title', btrim(t->>'first'), nullif(btrim(coalesce(t->>'middle','')),''), btrim(t->>'last'),
      (t->>'dob')::date, btrim(t->>'email'), btrim(t->>'phone'),
      btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')),''), btrim(p_city),
      nullif(btrim(coalesce(p_county,'')),''), upper(btrim(p_postcode)),
      p_rent, p_tenancy_start, 'sent', now(),
      (select r.partner_rate from public.resolve_rates(p_branch, v_route) r),
      public.commission_total(p_branch, v_route, v_n),
      true, v_mode
    ) returning * into v_app;

    insert into public.application_commission_lines (application_id, level, org_id, org_name, rate, basis_amount)
    select v_app.id, s.level, s.org_id, s.org_name, s.rate, v_fees[v_i]
    from public.commission_split(p_branch, v_route, v_n) s;

    return next v_app;
  end loop;
end $function$;

revoke all on function public.create_joint_referral(uuid, jsonb, text, text, text, text, text, numeric, date) from public, anon;
grant execute on function public.create_joint_referral(uuid, jsonb, text, text, text, text, text, numeric, date) to authenticated;
