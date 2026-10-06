/* =====================================================================
   THE SCREEN READS EVERY SHARE DEAL, AND MOVES AN AGENCY IN ONE CLICK.

   20261007240000 made several agents'-share deals possible and gave them
   members. Nothing can see them: `supplier_deal` returns ONE agreement,
   by `active_agreement_of_kind`, which is now the wrong question --
   it answers "the supplier's share deal" where there are several, and
   which one it returns depends on effective_from.

   Matt, 2026-10-01: "Show which agencies are on which deal, and every
   agency not picked uses the default. An agency can only be on one deal
   at a time; moving it is one click."

   So: one reader that returns them all with their members, and one
   writer that moves an agency. Both admin-only and both behind MFA, the
   same as `supplier_deal` beside them.

   Tests: supabase/tests/several_agents_share_deals.test.sql
   ===================================================================== */

-- ---------------------------------------------------------------------------
-- 1. EVERY SHARE DEAL A SUPPLIER HAS, WITH WHO IS ON IT.
-- ---------------------------------------------------------------------------
create or replace function public.supplier_share_deals(p_slug text)
returns table(
  agreement_id uuid, is_default boolean, coverage text, period text,
  counting_scope text, note text, effective_from date, period_start date,
  volume integer, bands jsonb, tiers jsonb, members jsonb
)
language plpgsql stable security definer set search_path to ''
as $function$
declare v_partner uuid;
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  if not coalesce(public.is_admin(), false) then
    raise exception 'Only Opndoor reads a supplier''s deals.' using errcode = '42501';
  end if;

  select p.id into v_partner from public.partners p where p.slug = p_slug;
  if v_partner is null then
    raise exception 'Supplier not found' using errcode = '22023';
  end if;

  return query
  select pa.id,
         /* THE DEAL THE SCREEN CALLS THE DEFAULT is the marked one OR an
            unmarked one with nobody on it -- the same rule the resolver
            uses, written once more here rather than inferred differently,
            because a screen that disagrees with the resolver about which
            deal is the default is worse than no screen. */
         pa.is_default_share or not exists (
           select 1 from public.pricing_agreement_members m where m.agreement_id = pa.id
         ),
         pa.coverage, pa.period, pa.counting_scope, pa.note, pa.effective_from,
         public.agreement_period_start(pa.id),
         public.agreement_volume(pa.id, null, v_partner),
         (select coalesce(jsonb_agg(jsonb_build_object(
             'min', bd.min_tenants, 'max', bd.max_tenants,
             'weeks', bd.fee_basis_weeks, 'unit', bd.fee_basis_unit, 'rate', bd.agent_rate)
             order by bd.min_tenants), '[]'::jsonb)
            from public.pricing_agreement_bands bd where bd.agreement_id = pa.id),
         (select coalesce(jsonb_agg(jsonb_build_object(
             'from', t.from_count, 'to', t.to_count, 'rate', t.agent_rate)
             order by t.from_count), '[]'::jsonb)
            from public.commission_tiers t where t.agreement_id = pa.id),
         /* WHO IS ON IT, with WHEN AND BY WHOM, which is the audit Matt
            asked for: the deal's terms are versioned by its dates, and
            what changes afterwards is the membership. */
         (select coalesce(jsonb_agg(jsonb_build_object(
             'agencyId', m.agency_id, 'name', ag.name,
             'addedAt', m.added_at, 'addedBy', u.full_name)
             order by ag.name), '[]'::jsonb)
            from public.pricing_agreement_members m
            join public.agencies ag on ag.id = m.agency_id
            left join public.users u on u.id = m.added_by
           where m.agreement_id = pa.id)
  from public.pricing_agreements pa
  where pa.scope_level = 'partner'
    and pa.scope_id = v_partner
    and pa.kind = 'agent_share'
    and not pa.is_standard
    and pa.ended_at is null
    and pa.effective_from <= current_date
    and (pa.effective_to is null or pa.effective_to >= current_date)
  /* THE DEFAULT FIRST, because it is the one that applies to everybody and
     the extra deals are read as exceptions to it. Then by name-stable
     order so the list does not reshuffle between loads. */
  order by pa.is_default_share desc, pa.effective_from desc, pa.id;
end $function$;

revoke all on function public.supplier_share_deals(text) from public, anon;
grant execute on function public.supplier_share_deals(text) to authenticated, service_role;

comment on function public.supplier_share_deals(text) is
  'Every live agents'' share deal a supplier holds, default first, each with its bands, tiers and the agencies named on it. The default is the marked deal or an unmarked one with no members, which is the same rule resolve_pricing_agreement applies.';

-- ---------------------------------------------------------------------------
-- 2. MOVING AN AGENCY, WHICH IS ONE WRITE.
-- ---------------------------------------------------------------------------
-- "An agency can only be on one deal at a time; moving it is one click."
--
-- ONE UPSERT, not a delete and an insert. The unique index makes the second
-- shape impossible to get right: remove-then-add leaves the agency on NO
-- deal if the add fails, and add-then-remove is refused by the index. The
-- upsert cannot half-happen.

create or replace function public.set_agency_share_deal(p_agreement uuid, p_agency uuid)
returns void
language plpgsql security definer set search_path to ''
as $function$
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
end $function$;

revoke all on function public.set_agency_share_deal(uuid, uuid) from public, anon;
grant execute on function public.set_agency_share_deal(uuid, uuid) to authenticated, service_role;

comment on function public.set_agency_share_deal(uuid, uuid) is
  'Put an agency on one of its supplier''s agents'' share deals, moving it off whichever it was on. One upsert, so it cannot leave the agency on neither. The trigger refuses the default deal, a commission deal and another supplier''s agency.';

-- Taking it off every named deal, which returns it to the default.
create or replace function public.clear_agency_share_deal(p_agency uuid)
returns void
language plpgsql security definer set search_path to ''
as $function$
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  if not coalesce(public.is_admin(), false) then
    raise exception 'Only Opndoor moves an agency between deals.' using errcode = '42501';
  end if;
  delete from public.pricing_agreement_members where agency_id = p_agency;
end $function$;

revoke all on function public.clear_agency_share_deal(uuid) from public, anon;
grant execute on function public.clear_agency_share_deal(uuid) to authenticated, service_role;

comment on function public.clear_agency_share_deal(uuid) is
  'Take an agency off whichever named agents'' share deal it is on, which returns it to its supplier''s default. Deleting the membership IS the move: the default is what applies to an agency named on nothing.';

-- ---------------------------------------------------------------------------
-- 3. AND THE TWO NEW GUARDS ARE WRAPPED, as every raising guard here is.
-- ---------------------------------------------------------------------------
-- `guardsAreNullSafe.test.ts` requires every `if not X then raise` to read
-- `if not coalesce(X, false)`, and caught three of mine.
--
-- ONE OF THE THREE WAS A REAL HAZARD and two were not, which is exactly why
-- the rule is syntactic rather than clever:
--
--   `not (new.kind = ... and new.scope_level = ...)` is NULL if either column
--   is, and a NULL there means the branch is skipped -- so a row with a null
--   kind would have slipped past the exclusivity check entirely.
--
--   The two `not exists (...)` cannot be NULL; `exists` is always true or
--   false. Wrapping them buys nothing but the next reader not having to work
--   that out, which is the point: a rule nobody has to reason about is one
--   nobody gets wrong at 6pm.
--
-- Corrected HERE rather than by editing 20261007240000, which is committed
-- and applied: a correction to an earlier migration goes in a new one.

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
  /* WRAPPED WHOLE, not around the operand: `not` binds tighter than `and`,
     so `not coalesce(A and B, false)` is the right answer only by luck and
     the next edit to the condition loses it. `coalesce(not (A and B), true)`
     says what is meant -- run the check unless this is definitely a
     partner-scope agents' share deal -- and NULL falls to the safe side. */
  if coalesce(not (new.kind = 'agent_share' and new.scope_level = 'partner'), true) then
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
  if not coalesce(exists (
    select 1 from public.pricing_agreements pa
    where pa.id = new.agreement_id
      and pa.kind = 'agent_share' and pa.scope_level = 'partner'
  ), false) then
    raise exception 'Only a supplier''s agents'' share deal takes agencies. A commission deal applies to the party it is written for.'
      using errcode = '22023';
  end if;
  /* AND THE AGENCY HAS TO BE UNDER THAT SUPPLIER. Without this an admin
     could put another supplier's agency on this deal, and the resolver --
     which reaches the deal through the agency, not the other way -- would
     never notice, so the row would sit there pricing nothing and reading
     as though it did. */
  if not coalesce(exists (
    select 1
    from public.pricing_agreements pa
    join public.agencies a on a.id = new.agency_id
    where pa.id = new.agreement_id and a.partner_id = pa.scope_id
  ), false) then
    raise exception 'That agency is not under this supplier.' using errcode = '22023';
  end if;
  return new;
end $function$;
