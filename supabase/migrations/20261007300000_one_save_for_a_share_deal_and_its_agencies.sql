-- ===========================================================================
-- ONE SAVE WRITES A SHARE DEAL AND THE AGENCIES IT APPLIES TO.
--
-- Matt, 2026-10-01, rebuilding the supplier Commission tab: "'Add' opens one
-- dialog that asks which agencies first (searchable list of this supplier's
-- agencies, pick one or several), titled with them, e.g. 'Deal for Frost
-- Partnership and 2 others', then the agencies' % editor below, one Save."
--
-- ===========================================================================
-- WHAT I FOUND WHILE BUILDING THAT DIALOG, WHICH IS WHY THIS IS A MIGRATION
-- ===========================================================================
--
-- The second bespoke deal could not be written AT ALL. 20261007240000 made
-- the table, the index, the membership trigger, the resolver and the
-- exclusivity trigger all understand several share deals per supplier, and
-- it left the door they are written through believing there is one:
--
--   agreement_conflicts() reports 'already has a live agents'' share deal'
--   for a partner-scope agent_share whenever active_agreement_of_kind finds
--   one, so a second deal is refused unless p_confirm_replace is passed, and
--
--   create_agreement's conflict loop then ends EVERY live agreement of that
--   kind at that scope:
--
--     update public.pricing_agreements set ended_at = now()
--      where scope_level = c.level and scope_id = c.node_id
--        and not is_standard and kind = p_kind and ended_at is null;
--
--   so confirming it wipes the default AND every other bespoke deal, and the
--   new row is then marked is_default_share because no default is left live.
--
-- Proved on dev before writing a line of this: agreement_conflicts('partner',
-- <Kestrel>, 'additive', 'agent_share') returns one row today, with Kestrel
-- holding exactly one share deal. Every pgTAP assertion about several deals
-- in several_agents_share_deals.test.sql inserts its rows DIRECTLY, so none
-- of them went through the door, and none of them could have caught this.
-- That is the lesson worth keeping: a feature tested only through the table
-- is a feature with an untested way in.
--
-- ===========================================================================
-- WHY A NEW FUNCTION RATHER THAN A FOURTH PATCH TO create_agreement
-- ===========================================================================
--
-- create_agreement is asked one question it cannot answer: is this deal the
-- supplier's default, or one for named agencies? It takes no agencies, so it
-- cannot know, and the answer decides what it may end. 20261007240000
-- derived it from "does a default already exist", which is right for the
-- FIRST deal and wrong for the second.
--
-- The agencies and the terms arriving together is what makes the answer
-- knowable, and that is exactly what Matt's one dialog sends. So the share
-- deal gets a door shaped like the thing being saved:
--
--   no agencies named            -> this is the default deal, and it
--                                   supersedes the live default and NOTHING
--                                   else
--   agencies named               -> a bespoke deal, which leaves the default
--                                   and the other bespoke deals alone
--   p_agreement given            -> change that one deal, carrying its
--                                   agencies across
--
-- create_agreement is untouched. It keeps writing a supplier's first share
-- deal exactly as it does today, which is what a_supplier_has_two_deals and
-- two_deal_shapes_not_one asserts, and the Commission tab stops calling it
-- for shares. One screen, one door, and the door knows what it is writing.
--
-- NOT A SECOND WAY TO SET A RATE. Every rule still lives where it did: the
-- bands and tiers are inserted in the same shape, fee_basis_weeks is null on
-- a share band because 20261007220000 says so, and the share-against-total
-- check is assert_supplier_share_within_total, called here as create_agreement
-- calls it. What is new is the membership, which create_agreement has never
-- had anything to say about.
-- ===========================================================================

create or replace function public.save_share_deal(
  p_partner uuid,
  p_bands jsonb,
  p_tiers jsonb default '[]'::jsonb,
  p_note text default null,
  p_period text default 'month',
  p_counting_scope text default 'agency',
  /* The agencies this deal applies to, and the whole set of them: an agency
     named that was not on it moves onto it, and one on it that is not named
     goes back to the default. An empty array means the deal names nobody,
     which is what the default deal is. */
  p_agencies uuid[] default '{}'::uuid[],
  /* The live deal being changed. Null writes a new one. */
  p_agreement uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid; v_actor text; b jsonb; t jsonb;
  v_default boolean; v_old_default boolean; v_bad int; v_named int;
  v_what text; v_who text;
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  if not coalesce(public.is_admin(), false) then
    raise exception 'Only Opndoor agrees what the agencies are paid.' using errcode = '42501';
  end if;

  /* coalesce, like every other raising guard in here: `exists` cannot be
     NULL today, and `guardsAreNullSafe` is deliberately crude about that
     so the next condition somebody puts in its place is safe too. */
  if not coalesce((select exists (
    select 1 from public.partners p where p.id = p_partner
  )), false) then
    raise exception 'No such supplier.' using errcode = '22023';
  end if;
  if p_period not in ('week','month','year','lifetime') then
    raise exception 'A deal is counted per week, month, year or since it started.' using errcode = '22023';
  end if;
  if p_counting_scope not in ('agency','group','branch') then
    raise exception 'Referrals are counted per agency, per group or per branch.' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_bands, '[]'::jsonb)) < 1 then
    raise exception 'A deal needs at least one tenant-count band.' using errcode = '22023';
  end if;

  v_named := coalesce(array_length(p_agencies, 1), 0);

  /* AN AGENCY OF SOMEBODY ELSE'S IS NOT A TYPO, it is one supplier setting
     another supplier's agency's pay, so it is refused here rather than left
     to the screen's picker to avoid offering. */
  if v_named > 0 then
    select count(*) into v_bad from unnest(p_agencies) as a(id)
     where not exists (
       select 1 from public.agencies ag
        where ag.id = a.id and ag.partner_id = p_partner
     );
    if v_bad > 0 then
      raise exception 'A deal can only name agencies of this supplier.' using errcode = '22023';
    end if;
  end if;

  if p_agreement is not null then
    select pa.is_default_share into v_old_default
      from public.pricing_agreements pa
     where pa.id = p_agreement
       and pa.scope_level = 'partner' and pa.scope_id = p_partner
       and pa.kind = 'agent_share' and not pa.is_standard
       and pa.ended_at is null;
    if v_old_default is null then
      raise exception 'That is not a live agents'' share deal of this supplier.' using errcode = '22023';
    end if;
    /* A DEAL DOES NOT CHANGE SIDES. The default stays the default and a
       bespoke deal stays bespoke, because the alternative is a save that
       silently leaves a supplier with no terms for the agencies nobody
       named. */
    v_default := v_old_default;
  else
    v_default := v_named = 0;
  end if;

  if v_default and v_named > 0 then
    raise exception 'The default deal is what every agency not named on another is paid, so it cannot name any.'
      using errcode = '22023';
  end if;

  select u.full_name into v_actor from public.users u where u.id = auth.uid();

  /* SUPERSEDE EXACTLY ONE DEAL, which is the whole correction. Changing a
     deal ends that deal. Writing a new default ends the old default. Neither
     touches a deal that was not being replaced. */
  if p_agreement is not null then
    update public.pricing_agreements set ended_at = now() where id = p_agreement;
    insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
    values ('partner', p_partner, 'agreement_superseded',
            case when v_default
                 then 'The default agents'' share deal was ended, because a new one replaces it'
                 else 'An agents'' share deal for named agencies was ended, because a new one replaces it' end,
            coalesce(v_actor, 'an administrator'), auth.uid());
  elsif v_default then
    update public.pricing_agreements set ended_at = now()
     where scope_level = 'partner' and scope_id = p_partner
       and kind = 'agent_share' and is_default_share
       and not is_standard and ended_at is null;
  end if;

  insert into public.pricing_agreements
    (scope_level, scope_id, coverage, period, counting_scope, note,
     created_by, effective_from, is_standard, kind, is_default_share)
  values ('partner', p_partner, 'additive', p_period, p_counting_scope, p_note,
          auth.uid(), current_date, false, 'agent_share', v_default)
  returning id into v_id;

  /* NO FEE ON A SHARE BAND, whatever the caller sent: 20261007220000 made
     that the function's rule rather than the screen's, and this door holds
     to it for the same reason. A share says what proportion of the fee goes
     on, never what the fee is. */
  for b in select * from jsonb_array_elements(p_bands) loop
    insert into public.pricing_agreement_bands
      (agreement_id, min_tenants, max_tenants, fee_basis_weeks, fee_basis_unit, agent_rate)
    values (v_id, coalesce((b->>'min')::int, 1), nullif(b->>'max','')::int,
            null, 'weeks', nullif(b->>'rate','')::numeric);
  end loop;

  for t in select * from jsonb_array_elements(coalesce(p_tiers, '[]'::jsonb)) loop
    insert into public.commission_tiers (agreement_id, from_count, to_count, agent_rate)
    values (v_id, (t->>'from')::int, nullif(t->>'to','')::int, (t->>'rate')::numeric);
  end loop;

  /* THE AGENCIES COME ACROSS WITH THE TERMS, and added_at is NOT re-stamped
     doing it. set_agency_share_deal re-stamps because there the question is
     "since when has this agency been on THIS deal" and a move is a new
     answer to it. Here the agency has not moved: its deal was re-cut under
     it, and re-dating the membership would say an administrator moved
     fourteen agencies on the day they changed one percentage. */
  if p_agreement is not null then
    update public.pricing_agreement_members
       set agreement_id = v_id
     where agreement_id = p_agreement;
  end if;

  if not v_default then
    /* Named is the whole set: anybody dropped from it goes back to the
       default, which is what taking an agency off a bespoke deal means. */
    delete from public.pricing_agreement_members m
     where m.agreement_id = v_id
       and not (m.agency_id = any (p_agencies));

    insert into public.pricing_agreement_members (agreement_id, agency_id, added_by)
    select v_id, a.id, auth.uid()
      from unnest(p_agencies) as a(id)
     where not exists (
       select 1 from public.pricing_agreement_members m
        where m.agency_id = a.id and m.agreement_id = v_id
     )
    on conflict (agency_id) do update
      set agreement_id = excluded.agreement_id,
          added_by     = excluded.added_by,
          added_at     = now();
  end if;

  /* THE SAME CHECK create_agreement MAKES, and it reads every live share
     deal rather than the one just written, so a bespoke deal that crosses
     the supplier's own total is refused here exactly as the default would
     be. Where opndoor pays the agencies itself the deals are siblings and
     this is always empty: 20261007230000. */
  perform public.assert_supplier_share_within_total(p_partner);

  if v_default then
    v_who := 'every agency not named on another deal';
  else
    select string_agg(ag.name, ', ' order by ag.name) into v_who
      from public.agencies ag where ag.id = any (p_agencies);
    v_who := coalesce(v_who, 'no agency yet');
  end if;
  v_what := case when p_agreement is null then 'agreed' else 'changed' end;

  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values ('partner', p_partner,
          case when p_agreement is null then 'agent_share_created' else 'agent_share_changed' end,
          'Agents'' share deal ' || v_what || ' for ' || v_who
            || ', counted per ' || p_counting_scope || ' per ' || p_period,
          coalesce(v_actor, 'an administrator'), auth.uid());

  return v_id;
end $function$;

revoke all on function public.save_share_deal(uuid, jsonb, jsonb, text, text, text, uuid[], uuid) from public, anon;
grant execute on function public.save_share_deal(uuid, jsonb, jsonb, text, text, text, uuid[], uuid) to authenticated, service_role;

comment on function public.save_share_deal(uuid, jsonb, jsonb, text, text, text, uuid[], uuid) is
  'Write one of a supplier''s agents'' share deals together with the agencies it applies to, in one call. No agencies named means the supplier''s default deal, which every agency not named on another is paid by, and writing it supersedes the live default and nothing else. Agencies named means a bespoke deal, which leaves the default and the other bespoke deals alone. p_agreement changes a live deal, carrying its agencies across without re-dating them. create_agreement cannot do this: it takes no agencies, so it cannot tell a default from a bespoke deal, and its conflict loop ends every share deal at the scope.';
