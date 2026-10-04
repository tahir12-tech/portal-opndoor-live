-- A DEAL PRICES EVERY TENANT COUNT, OR IT IS NOT SAVED.
--
-- Matt, 2026-10-04, verbatim: "Deal dialog: switching to 'One price for
-- everything' keeps the first tenant band ('1 to 1'), so the deal only prices
-- single tenancies. ... Check every switch between deal types for leftover
-- rows from the previous type, and refuse to save a deal that leaves any
-- tenant count or volume unpriced."
--
-- Test: supabase/tests/a_deal_prices_every_tenant_count.test.sql
--
-- =========================================================================
-- WHY AN UNPRICED COUNT IS A MONEY DEFECT AND NOT A TIDINESS ONE
-- =========================================================================
--
-- resolve_pricing_agreement picks a band with
--
--     min_tenants <= n and (max_tenants is null or max_tenants >= n)
--
-- and returns nothing when none matches. The caller then has no fee basis and
-- no rate, so resolve_fee falls back to the rent and resolve_rates to the flat
-- pair: the referral is charged OUR USUAL TERMS under a deal that says
-- otherwise, with nothing raised anywhere. A joint tenancy under a deal whose
-- only band is "1 to 1" is exactly that.
--
-- MEASURED ON DEV BEFORE WRITING THIS, which is what Matt asked for first.
-- One live agreement has a gap: 6881d7f9, a PARTNER-scope agent_share deal
-- for Kestrel with bands 1-5 and 6-10 and nothing above, so it prices nothing
-- at 11 tenants. Two things make that the mild version of the fault rather
-- than the dangerous one, and both are worth stating so the finding is not
-- oversold: 11 tenants is not a tenancy anybody has, and a SHARE deal that
-- resolves nothing falls back to partners.agent_rate rather than to standard
-- terms, because resolve_rates coalesces. No COMMISSION deal on dev has a
-- gap, and a commission gap is the one that loses the fee basis.
--
-- NOTHING IS CHANGED ON DEV BY THIS MIGRATION. The guard refuses a deal being
-- SAVED; 6881d7f9 stays exactly as it is until somebody edits it, which is
-- the same rule every pricing change follows.
--
-- =========================================================================
-- VOLUME NEEDS NO EQUIVALENT, AND THAT IS A FINDING RATHER THAN AN OMISSION
-- =========================================================================
--
-- Matt's sentence says "any tenant count or volume". A tier that matches
-- nothing falls back to the BAND's rate, through the coalesce in both
-- resolve_pricing_agreement and agreement_rate_at. So a hole in the tiers
-- changes which rate applies and a hole in the bands means there is no price
-- at all. Only the second can abandon a referral, so only the second is
-- refused. Said here because the asymmetry looks like a missing check.

create or replace function public.agreement_tenant_gap(p_agreement uuid)
returns integer
language sql stable security definer set search_path to ''
as $function$
  /* THE LOWEST TENANT COUNT THIS DEAL PRICES NOTHING FOR, or null when it
     prices every count.

     resolve_pricing_agreement picks a band with

         min_tenants <= n and (max_tenants is null or max_tenants >= n)

     so a deal is complete when some band matches 1, the bands leave no hole
     between them, and the topmost band is OPEN-ENDED. A closed top band is
     the common way to get this wrong and the hardest to see: "1 to 1" reads
     like a deal and prices exactly one tenancy shape, and every joint
     tenancy under it falls through to standard terms in silence.

     THREE CANDIDATES, SMALLEST WINS, and `least` ignores nulls:

       1. a deal with no bands at all prices nothing, so the answer is 1;
       2. the first hole in 1..12, which covers every real tenancy and every
          gap between bands;
       3. one past a CLOSED top band, which the series misses when that band
          ends at or beyond the ceiling.

     A ceiling rather than algebra because above the highest min_tenants
     nothing changes: if the top band is open the counts beyond are covered,
     and if it is closed candidate 3 is the answer. */
  select least(
    (select 1 where not exists (
       select 1 from public.pricing_agreement_bands b where b.agreement_id = p_agreement)),
    (select min(n) from generate_series(1, 12) n
      where not exists (
        select 1 from public.pricing_agreement_bands b
         where b.agreement_id = p_agreement
           and b.min_tenants <= n
           and (b.max_tenants is null or b.max_tenants >= n))),
    (select 1 + max(b.max_tenants) from public.pricing_agreement_bands b
      where b.agreement_id = p_agreement
        and not exists (
          select 1 from public.pricing_agreement_bands b3
           where b3.agreement_id = p_agreement and b3.max_tenants is null))
  )
$function$;

revoke all on function public.agreement_tenant_gap(uuid) from public, anon, authenticated;
grant execute on function public.agreement_tenant_gap(uuid) to service_role;

comment on function public.agreement_tenant_gap(uuid) is
  'The lowest tenant count an agreement prices nothing for, or null when it prices every count. A closed top band is the usual cause: it reads like a deal and silently abandons every tenancy above it.';

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
