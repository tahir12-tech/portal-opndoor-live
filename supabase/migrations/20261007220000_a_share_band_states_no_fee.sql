-- AN AGENTS'-SHARE BAND STATES NO FEE, BECAUSE IT DOES NOT SET ONE.
--
-- A band carries two things: the fee the TENANT pays at that tenant count, and
-- the rate the party is paid. On a supplier's agents'-share deal only the
-- second is meaningful -- the tenant's price is set once, by the supplier's
-- commission deal -- and `fee_basis_weeks` was NOT NULL, so a share band had
-- to store a number nothing would ever read.
--
-- THIS CODEBASE ALREADY REFUSED THAT ONCE, in the same table. A volume-tiered
-- agreement stores NULL on the band's rate rather than a figure the tiers then
-- override, with the reason written next to it: "a stored-but-ignored rate is
-- the thing that makes an agreement unreadable a year later: the row says 20%
-- and every referral was priced at 25%". A share band storing "one month's
-- rent" when the commission deal says five weeks is the same fault.
--
-- Tests: supabase/tests/a_supplier_has_two_deals.test.sql
--
-- THE COLUMN BECOMES NULLABLE AND create_agreement BECOMES THE GUARD, which
-- is where it belongs: a CHECK on the band cannot see the parent agreement's
-- kind, and a trigger to tell it would be a second place for the rule to live.

alter table public.pricing_agreement_bands
  alter column fee_basis_weeks drop not null;

comment on column public.pricing_agreement_bands.fee_basis_weeks is
  'What the tenant pays at this tenant count, in fee_basis_unit. NULL on an agents''-share band, which sets no fee: the tenant''s price comes from the supplier''s commission deal. create_agreement requires it on a commission band and stores NULL on a share one.';

-- The body is 20261007190000's, with the fee required where it means
-- something and refused where it does not.
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

  insert into public.pricing_agreements
    (scope_level, scope_id, coverage, period, counting_scope, note, created_by, effective_from, is_standard, kind)
  values (p_level, p_id, p_coverage, p_period, p_counting_scope, p_note, auth.uid(), current_date, false, p_kind)
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
