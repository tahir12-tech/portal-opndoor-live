/* =====================================================================
   SEVERAL AGENTS'-SHARE DEALS, AND WHICH AGENCIES ARE ON EACH.

   Matt, 2026-10-01, verbatim: "Supplier Commission tab: under 'What the
   agencies underneath keep', allow several deals. One default deal for
   all agencies, plus extra deals that each apply to agencies picked from
   a searchable list of that supplier's agencies (several agencies can
   share one deal). Show which agencies are on which deal, and every
   agency not picked uses the default. An agency can only be on one deal
   at a time; moving it is one click. Changes apply to new referrals only
   and are recorded with who and when."

   =====================================================================
   WHY THE EXISTING "PER-AGENCY OVERRIDE" DOES NOT ANSWER THIS
   =====================================================================

   An override as built is an AGENCY-SCOPE agreement: one agreement, one
   agency, and resolve_pricing_agreement already prefers it. That gives
   one deal per agency and cannot express "several agencies can share one
   deal" except as N identical copies -- which is not one deal. Changing
   it would mean editing N of them, and "show which agencies are on which
   deal" would have nothing to show, because nothing would record that
   the N were ever the same arrangement.

   So a deal needs MEMBERS. The shape that fits what is already here:
   keep the deal at partner scope and kind 'agent_share', and give it a
   membership set.

   =====================================================================
   THE DEFAULT IS MARKED, NOT INFERRED, AND THAT IS THE WHOLE DESIGN
   =====================================================================

   The obvious reading of "one default deal ... plus extra deals" is that
   the default is the one with no members. I started there and it cannot
   be enforced: a new agreement is inserted BEFORE its members are, so at
   the moment the exclusivity trigger runs every deal looks like the
   default, and "at most one default" would refuse every extra deal or
   none of them depending on when you asked.

   Marking it instead makes the invariant a unique INDEX rather than a
   rule somebody has to remember:

     exactly one default per supplier   partial unique index below
     an agency is on one deal at a time partial unique index below
     the default takes no members       trigger, one line

   None of the three can be got round by a writer that does not know
   about them, which is the property the agency-scope trigger was written
   for and the reason not to settle for enforcing this in
   create_agreement alone.

   =====================================================================
   RESOLUTION, WHICH GAINS ONE RUNG AND BREAKS NONE
   =====================================================================

     1. agency scope   the existing per-agency override. UNCHANGED, and
                       still the most specific thing there is.
     2. group scope    unchanged.
     3. partner scope, this agency is a MEMBER   <- new
     4. partner scope, the default               <- "every agency not
                                                    picked uses the
                                                    default"

   Inserted between the old rungs rather than replacing any, so every
   existing deal resolves exactly as it did: a supplier with one share
   deal and no members has that deal marked default by the backfill
   below, and lands on rung 4 where it used to land on rung 3.

   "CHANGES APPLY TO NEW REFERRALS ONLY" needs nothing here, as before:
   create_referral freezes the resolved rates onto the application and
   every money surface reads the frozen numbers. Moving an agency between
   deals cannot reprice a referral that already exists.

   Tests: supabase/tests/several_agents_share_deals.test.sql
   ===================================================================== */

-- ---------------------------------------------------------------------------
-- 1. WHICH DEAL IS THE DEFAULT.
-- ---------------------------------------------------------------------------
alter table public.pricing_agreements
  add column if not exists is_default_share boolean not null default false;

comment on column public.pricing_agreements.is_default_share is
  'Marks the one agents''-share deal a supplier applies to every agency not named on another. Only meaningful for kind = ''agent_share'' at partner scope. Marked rather than inferred from having no members, because an agreement is inserted before its members are and "the one with no members" is therefore not a question that can be asked at write time.';

/* EVERY SHARE DEAL THAT EXISTS TODAY IS A DEFAULT, because until now a
   supplier had at most one and it applied to all of its agencies. Marking
   them is what makes rung 4 behave exactly as rung 3 did. */
update public.pricing_agreements
   set is_default_share = true
 where kind = 'agent_share'
   and scope_level = 'partner'
   and ended_at is null
   and not is_default_share;

-- Only a partner-scope agents' share deal may be a default at all.
alter table public.pricing_agreements
  drop constraint if exists pricing_agreements_default_share_is_a_share;
alter table public.pricing_agreements
  add constraint pricing_agreements_default_share_is_a_share
  check (not is_default_share or (kind = 'agent_share' and scope_level = 'partner'));

-- ONE DEFAULT PER SUPPLIER, as an index: ended deals do not count, so a
-- supplier can replace its default by ending the old one.
drop index if exists public.pricing_agreements_one_default_share;
create unique index pricing_agreements_one_default_share
  on public.pricing_agreements (scope_id)
  where is_default_share and ended_at is null;

-- ---------------------------------------------------------------------------
-- 2. WHO IS ON WHICH DEAL.
-- ---------------------------------------------------------------------------
create table if not exists public.pricing_agreement_members (
  agreement_id uuid not null references public.pricing_agreements(id) on delete cascade,
  agency_id    uuid not null references public.agencies(id) on delete cascade,
  /* "RECORDED WITH WHO AND WHEN", which for a membership is the whole
     audit: the deal's own terms are already versioned by its effective
     dates, and what changes afterwards is who is on it. */
  added_by     uuid references public.users(id),
  added_at     timestamptz not null default now(),
  primary key (agreement_id, agency_id)
);

comment on table public.pricing_agreement_members is
  'Which agencies an agents''-share deal applies to. A deal with members applies to exactly those; the supplier''s default deal applies to every agency not named on another. Membership is what makes "several agencies can share one deal" one deal rather than N copies of it.';

/* AN AGENCY IS ON ONE DEAL AT A TIME, which Matt states as a rule and is
   cheaper as an index: "moving it is one click" is then an upsert that
   cannot half-succeed, and no caller has to remember to remove it from
   the old deal first.

   ON agency_id ALONE, not (partner, agency). An agency has exactly one
   partner_id, so the narrower key would be the same key with a column
   nobody can vary -- and if that ever stops being true, this index
   failing loudly is the right way to find out. */
drop index if exists public.pricing_agreement_members_one_deal_per_agency;
create unique index pricing_agreement_members_one_deal_per_agency
  on public.pricing_agreement_members (agency_id);

create index if not exists pricing_agreement_members_by_agreement
  on public.pricing_agreement_members (agreement_id);

-- THE DEFAULT TAKES NO MEMBERS. It is defined by applying to everyone not
-- named elsewhere, so naming somebody on it is a contradiction rather than
-- a harmless redundancy: it would make the agency's rate depend on which
-- row the resolver read first.
create or replace function public.enforce_default_share_has_no_members()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
begin
  if exists (
    select 1 from public.pricing_agreements pa
    where pa.id = new.agreement_id and pa.is_default_share
  ) then
    raise exception 'That is the default deal: it already applies to every agency not named on another, so an agency cannot be added to it. Take the agency off its current deal instead.'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.pricing_agreements pa
    where pa.id = new.agreement_id
      and pa.kind = 'agent_share' and pa.scope_level = 'partner'
  ) then
    raise exception 'Only a supplier''s agents'' share deal takes agencies. A commission deal applies to the party it is written for.'
      using errcode = '22023';
  end if;
  /* AND THE AGENCY HAS TO BE UNDER THAT SUPPLIER. Without this an admin
     could put another supplier's agency on this deal, and the resolver --
     which reaches the deal through the agency, not the other way -- would
     never notice, so the row would sit there pricing nothing and reading
     as though it did. */
  if not exists (
    select 1
    from public.pricing_agreements pa
    join public.agencies a on a.id = new.agency_id
    where pa.id = new.agreement_id and a.partner_id = pa.scope_id
  ) then
    raise exception 'That agency is not under this supplier.' using errcode = '22023';
  end if;
  return new;
end $function$;

/* REVOKED LIKE EVERY OTHER DEFINER FUNCTION HERE. A trigger function needs
   no EXECUTE grant to fire -- the trigger runs it as the table's owner -- so
   the default PUBLIC grant is pure surface, and `npm run drift` counts it as
   a difference between dev and the files, which is how it was caught. */
revoke all on function public.enforce_default_share_has_no_members() from public, anon, authenticated;

drop trigger if exists trg_default_share_has_no_members on public.pricing_agreement_members;
create trigger trg_default_share_has_no_members
  before insert or update on public.pricing_agreement_members
  for each row execute function public.enforce_default_share_has_no_members();

-- ---------------------------------------------------------------------------
-- 3. RLS, THE SAME SHAPE AS THE BANDS ABOVE IT.
-- ---------------------------------------------------------------------------
alter table public.pricing_agreement_members enable row level security;

drop policy if exists pam_select on public.pricing_agreement_members;
create policy pam_select on public.pricing_agreement_members
  for select using (
    public.is_aal2() and exists (
      select 1 from public.pricing_agreements pa
      where pa.id = pricing_agreement_members.agreement_id
    )
  );

drop policy if exists pam_commission_readers_only on public.pricing_agreement_members;
create policy pam_commission_readers_only on public.pricing_agreement_members
  for select using (public.may_see_commission());

drop policy if exists pam_admin_write on public.pricing_agreement_members;
create policy pam_admin_write on public.pricing_agreement_members
  for all using (public.is_admin()) with check (public.is_admin());

/* AS RESTRICTIVE, which is the whole point of this policy and which I got
   wrong first: a PERMISSIVE require_aal2 is OR-ed with the others, so instead
   of requiring the second factor it would have GRANTED everything that
   passes it. `round_sixs_remaining_lows.test.sql` asserts that every
   require_aal2 in the schema is restrictive and caught it immediately --
   which is what that assertion is for, and it is the second time that round
   has paid for itself. */
drop policy if exists require_aal2 on public.pricing_agreement_members;
create policy require_aal2 on public.pricing_agreement_members
  as restrictive for all using (public.is_aal2()) with check (public.is_aal2());

-- ---------------------------------------------------------------------------
-- 4. THE RESOLVER GAINS THE MEMBERSHIP RUNG.
-- ---------------------------------------------------------------------------
-- Regenerated from 20261007190000 with the scope test and the ordering
-- extended. Everything else is that definition unchanged.

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

comment on function public.resolve_pricing_agreement(uuid, uuid, integer, text) is
  'The live deal that prices this referral: most specific scope wins (agency, then group, then partner), and within partner scope an agents'' share deal this agency is named on beats the supplier''s default. Then the band by tenant count and the tier by volume. p_kind picks which of a supplier''s two deals is being asked about; everything on the agency rail is ''commission''.';

-- ---------------------------------------------------------------------------
-- 5. EXCLUSIVITY STOPS APPLYING TO THE SHARE DEALS THAT ARE NOW PLURAL.
-- ---------------------------------------------------------------------------
-- "A party holds one of each, never two" is still right for every other
-- combination, and still right for the DEFAULT share deal -- which the unique
-- index now enforces more cheaply than this trigger could. What it must stop
-- refusing is the second, third and fourth membered deal, which is the
-- instruction.

create or replace function public.enforce_agreement_exclusivity()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
declare v_rate numeric; v_agr uuid; v_n int; r record;
begin
  if new.is_standard then return new; end if;
  if new.ended_at is not null then return new; end if;
  if new.effective_to is not null and new.effective_to < current_date then return new; end if;

  /* A SUPPLIER MAY HOLD SEVERAL AGENTS'-SHARE DEALS. Matt, 2026-10-01:
     "allow several deals. One default deal for all agencies, plus extra
     deals that each apply to agencies picked from a searchable list."

     The one-of-each rule is kept for every other combination and for the
     default, which `pricing_agreements_one_default_share` enforces as an
     index -- so nothing is loosened that was holding anything. */
  if not (new.kind = 'agent_share' and new.scope_level = 'partner') then
    v_agr := public.active_agreement_of_kind(new.scope_level, new.scope_id, new.kind);
    if v_agr is not null and v_agr is distinct from new.id then
      raise exception 'That % already has a live % deal. End it first: a party holds one of each, never two.',
        new.scope_level,
        case new.kind when 'agent_share' then 'agents'' share' else 'commission' end
        using errcode = '22023';
    end if;
  end if;

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
-- 6. THE GUARD HAS TO CHECK EVERY SHARE DEAL, NOT "THE" ONE.
-- ---------------------------------------------------------------------------
-- `active_agreement_of_kind` returns one row, which was the right question
-- while a supplier had one share deal. With several, checking only the one it
-- happens to return would leave the others unchecked -- and the one it returns
-- is ordered by effective_from, so WHICH one went unchecked would change as
-- deals were added. Every live share deal is now compared against the total.

create or replace function public.supplier_share_breaches(p_partner uuid)
returns table(tenants integer, volume integer, total_rate numeric, share_rate numeric)
language sql stable security definer set search_path to ''
as $function$
  with total as (
    select public.active_agreement_of_kind('partner', p_partner, 'commission') as total_id
  ),
  shares as (
    select pa.id as share_id
    from public.pricing_agreements pa
    where pa.scope_level = 'partner'
      and pa.scope_id = p_partner
      and pa.kind = 'agent_share'
      and not pa.is_standard
      and pa.ended_at is null
      and pa.effective_from <= current_date
      and (pa.effective_to is null or pa.effective_to >= current_date)
  ),
  tenant_points as (
    select distinct b.min_tenants as n
    from public.pricing_agreement_bands b
    where b.agreement_id in (select total_id from total)
       or b.agreement_id in (select share_id from shares)
    union select 1
  ),
  volume_points as (
    select distinct t.from_count as v
    from public.commission_tiers t
    where t.agreement_id in (select total_id from total)
       or t.agreement_id in (select share_id from shares)
    union select 0
  )
  select tp.n, vp.v,
         public.agreement_rate_at((select total_id from total), tp.n, vp.v),
         public.agreement_rate_at(s.share_id, tp.n, vp.v)
  from tenant_points tp, volume_points vp, shares s, total t
  /* Siblings do not bound each other: see 20261007230000. */
  where public.supplier_settles_its_own_agents(p_partner)
    and t.total_id is not null
    and public.agreement_rate_at(s.share_id, tp.n, vp.v) is not null
    and public.agreement_rate_at(t.total_id, tp.n, vp.v) is not null
    and public.agreement_rate_at(s.share_id, tp.n, vp.v)
      > public.agreement_rate_at(t.total_id, tp.n, vp.v)
  order by tp.n, vp.v
$function$;

comment on function public.supplier_share_breaches(uuid) is
  'Every tenant count and volume at which ANY of a supplier''s agents'' share deals would be more than the supplier''s own commission. Empty is the healthy answer, and it is always empty where Opndoor pays the agents directly, because there the deals are siblings and the total is their sum.';

-- ---------------------------------------------------------------------------
-- 7. AND THE DOOR MARKS THE FIRST SHARE DEAL AS THE DEFAULT.
-- ---------------------------------------------------------------------------
-- Regenerated from 20261007220000 -- the LATEST definition, not 20261007190000
-- which created the function -- by script, with two substitutions each
-- asserted to match exactly once: the declaration and the insert.
--
-- I regenerated it from 190000 first and silently reverted 220000's work:
-- the fee-basis rules for share bands went back to what they were and two
-- assertions in a_supplier_has_two_deals failed within the minute. "Latest"
-- is the word that matters, and `scripts/extract-latest-definition.mjs`
-- exists to answer it rather than leaving it to whoever is reading.

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

comment on function public.create_agreement(text, uuid, text, text, text, jsonb, jsonb, text, boolean, boolean, text) is
  'Write a deal and its bands and tiers, with every rule checked first. A supplier''s FIRST agents'' share deal is marked as its default, which is what every agency not named on a later deal is then priced by.';
