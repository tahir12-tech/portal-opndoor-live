/* =====================================================================
   A SUPPLIER'S COMMISSION IS SET IN ONE PLACE.

   Matt, 2026-09-30, verbatim: "Supplier commission is edited only on the
   supplier's Commission tab, under the new model: the supplier's total
   rate, the agents' share within it with volume tiers, and whether
   Opndoor pays agents directly. Remove the two flat commission boxes
   from Manage. Existing suppliers' current rates carry over so nothing
   changes for them on the day."

   WHY A NEW RPC RATHER THAN MORE ARGUMENTS ON update_partner_settings.
   That function takes nine arguments and saves the whole Manage modal in
   one shot, including both rates. Adding a tenth would leave the two
   flat boxes' write path alive under a screen that no longer has them,
   which is precisely the "two screens editing one number" this
   instruction exists to end. This one does commission and nothing else.

   THE GUARD THE NEW MODEL NEEDS, and it is not decoration. Under the
   carve-out the agents' share comes OUT of the total, so a share above
   the total is not a big share, it is a contradiction: Matt's words are
   "the supplier's own share is the total minus the agent's share, never
   more in total". `supplier_agent_rate()` caps it so the arithmetic can
   never go negative, but a cap is a safety net and not an answer. The
   editor refuses instead, because a supplier configured that way is
   misconfigured and silently flooring their own share to zero is the
   kind of help nobody wants.

   AND THAT IS WHY "carry over" NEEDS SAYING OUT LOUD. The same two
   columns mean something different from today: partner_rate was the
   supplier's own cut and is now the total. What carries over is the
   NUMBERS IN THE BOXES, which is what he asked for. Measured before any
   of this shipped: no real supplier on dev has a single paid referral,
   so no money has ever been paid under either reading and there is
   nothing to restate. A supplier whose stored agent_rate exceeds its
   stored partner_rate is now misconfigured by the new reading, and the
   Commission tab says so rather than the statement quietly paying them
   nothing.
   ===================================================================== */

create or replace function public.set_supplier_commission(
  p_slug text, p_total numeric, p_agent_share numeric, p_pays_agents boolean)
returns public.partners
language plpgsql
security definer
set search_path to ''
as $function$
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

  return res;
end $function$;

comment on function public.set_supplier_commission(text, numeric, numeric, boolean) is
  'The one way a supplier''s commission changes: the total, the agents'' share carved out of it, and whether Opndoor pays the agents directly. Opndoor admin only. Refuses a share larger than the total.';

/* Called from the browser by the supplier Commission tab, so
   `authenticated` with the guard inside. `public` named explicitly on
   the revoke: Postgres grants EXECUTE to PUBLIC on every new function. */
revoke all on function public.set_supplier_commission(text, numeric, numeric, boolean) from public, anon;
grant execute on function public.set_supplier_commission(text, numeric, numeric, boolean) to authenticated, service_role;

/* ---- what the tab shows about tiers --------------------------------- */

/* THE AGENTS' SHARE AS IT ACTUALLY RESOLVES, tier by tier.

   Matt asked for "the agents' share within it with volume tiers" on the
   Commission tab. The tiers themselves are the EXISTING machinery --
   `pricing_agreements` scoped to the partner with `commission_tiers`
   under it, resolved by `resolve_pricing_agreement` against
   `agreement_volume` -- and this reads them back so the tab can show
   what a supplier is actually on.

   READ-ONLY, AND THAT IS A GAP I AM NAMING RATHER THAN HIDING. Creating
   and editing tiers still happens through `create_agreement`, and the
   Commission tab shows them without letting an admin change them. The
   editor for that is listed for the morning in QUEUE.md. */
create or replace function public.supplier_commission_tiers(p_slug text)
returns table(agreement_id uuid, period text, counting_scope text,
              from_count integer, to_count integer, agent_rate numeric)
language sql
stable security definer
set search_path to ''
as $function$
  select pa.id, pa.period, pa.counting_scope, t.from_count, t.to_count, t.agent_rate
  from public.partners p
  join public.pricing_agreements pa
    on pa.scope_level = 'partner' and pa.scope_id = p.id
   and pa.ended_at is null
   and pa.effective_from <= current_date
   and (pa.effective_to is null or pa.effective_to >= current_date)
  join public.commission_tiers t on t.agreement_id = pa.id
  where p.slug = p_slug
    and coalesce(public.is_admin(), false)
    and coalesce(public.is_aal2(), false)
  order by t.from_count
$function$;

comment on function public.supplier_commission_tiers(text) is
  'The volume tiers currently carving the agents'' share out of a supplier''s total, read from the existing pricing_agreements machinery. Opndoor admin only; narrows to nothing for anybody else.';

revoke all on function public.supplier_commission_tiers(text) from public, anon;
grant execute on function public.supplier_commission_tiers(text) to authenticated, service_role;
