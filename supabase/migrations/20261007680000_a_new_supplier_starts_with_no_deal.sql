/* =====================================================================
   A NEW SUPPLIER STARTS WITH NO DEAL.

   Matt, 2026-10-03: "New suppliers must never get a default commission
   deal. Today 'Add supplier' silently sets 25% of the fee with agencies
   at 10% (e.g. ACME TEST). Change it so a new supplier starts with no
   deal at all."

   THE DEFAULT WAS IN TWO PLACES, which is why nobody had noticed it:
   `create_partner`'s parameters defaulted to 0.25 and 0.10, AND the
   columns themselves carried the same defaults, so an insert that named
   neither still produced a deal.

   AND A DEAL IS REALLY A PRICING AGREEMENT. Measured on dev:
   `pricing_agreements` holds a partner-level `commission` row for
   Kestrel, Letly, Test Supplier and the house partners, and NOTHING for
   ACME TEST, New Suplier, New Supplier 2 or New Supplier 3. Those four
   have never had a deal agreed; the columns were quietly answering for
   them at 25% and 10%. That is the money Matt is objecting to, and it
   is the reason null is the right value rather than zero: "no deal" and
   "a deal of nothing" are different facts, and Letly is already the
   second one.

   WHAT THIS DOES NOT DO. "new referrals for that supplier are refused
   (portal and API)" is the rest of Matt's instruction and he moved it
   to After launch: it is a new way for the referral path to fail, two
   days before go-live. So `resolve_rates` coalesces its answer to 0
   rather than returning null, because `applications.partner_rate` is
   NOT NULL and a null would refuse the referral with a constraint
   error -- the deferred behaviour, arriving by accident and with no
   message. A referral under a dealless supplier is created, earns
   nobody anything, and the three warnings say why.

   NOTHING EXISTING IS CHANGED. Every partner on dev keeps the rates it
   has, including the four that got them this way; Matt asked to be told
   which they are, not to have them altered.
   ===================================================================== */

/* THE COLUMN DEFAULTS GO, and the columns become nullable. Both halves:
   dropping the default alone would leave the NOT NULL, and an insert
   naming no rate would fail instead of meaning "no deal". */
alter table public.partners
  alter column partner_rate drop default,
  alter column agent_rate   drop default,
  alter column partner_rate drop not null,
  alter column agent_rate   drop not null;

comment on column public.partners.partner_rate is
  'The supplier''s flat commission rate, as a fraction of the fee. NULL means no deal has been set, which is different from 0.00 (a deal of nothing, which Letly has). Only the last fallback: resolve_rates prefers a pricing agreement, then the agency''s and group''s overrides, then this.';
comment on column public.partners.agent_rate is
  'The agents'' share, as a fraction of the fee. NULL means no deal has been set. See partner_rate.';

CREATE OR REPLACE FUNCTION public.create_partner(p_name text, p_status text DEFAULT 'onboarding'::text, p_live_from date DEFAULT NULL::date, p_partner_rate numeric DEFAULT NULL, p_agent_rate numeric DEFAULT NULL, p_referencing_mode text DEFAULT 'pre_referenced_screened'::text, p_portal_referrals boolean DEFAULT true, p_api_access boolean DEFAULT false)
 RETURNS partners
language plpgsql security definer set search_path = '' as $$
declare base text; v_slug text; n int := 2; res public.partners; who text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'not permitted' using errcode = '42501'; end if;

  if btrim(coalesce(p_name,'')) = '' then
    raise exception 'Partner name is required' using errcode = '22023';
  end if;
  -- Same validation as update_partner_settings, deliberately identical so a
  -- partner cannot be created in a state the edit screen would refuse to save.
  /* A NEW SUPPLIER STARTS WITH NO DEAL. Matt, 2026-10-03: "New suppliers
     must never get a default commission deal. Today 'Add supplier'
     silently sets 25% of the fee with agencies at 10% (e.g. ACME TEST)."

     THE DEFAULT WAS IN TWO PLACES and both are gone: these parameters,
     and the column defaults on `partners`. A rate given here is still
     validated; none given is null, which reads as "no deal set" on the
     Suppliers list, the Commission tab and the Overview. */
  if p_partner_rate is not null and (p_partner_rate < 0 or p_partner_rate > 1) then
    raise exception 'Partner commission must be between 0 and 100%%' using errcode = '22023';
  end if;
  if p_agent_rate is not null and (p_agent_rate < 0 or p_agent_rate > 1) then
    raise exception 'Agent commission must be between 0 and 100%%' using errcode = '22023';
  end if;
  if coalesce(p_status,'') not in ('active','onboarding','paused') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  if coalesce(p_referencing_mode,'') not in ('pre_referenced_open','pre_referenced_screened','opndoor_referenced') then
    raise exception 'Invalid referencing mode' using errcode = '22023';
  end if;

  -- partners_slug_valid restricts the slug to ^[a-z0-9-]+$, so strip anything
  -- else rather than letting the constraint reject a name a human typed
  -- reasonably.
  base := regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g');
  base := btrim(base, '-');   -- btrim takes the characters as a second arg; `both ... from` is trim() syntax
  base := left(nullif(base, ''), 40);
  if base is null then base := 'partner'; end if;

  v_slug := base;
  while exists (select 1 from public.partners where slug = v_slug) loop
    v_slug := base || '-' || n::text;
    n := n + 1;
  end loop;

  insert into public.partners(
    slug, name, status, live_from, partner_rate, agent_rate,
    referencing_mode, portal_referrals_enabled, api_access_enabled, partner_kind
  ) values (
    v_slug, btrim(p_name), p_status, p_live_from, p_partner_rate, p_agent_rate,
    p_referencing_mode, coalesce(p_portal_referrals, true), coalesce(p_api_access, false),
    -- SAID RATHER THAN DEFAULTED. This is the "Add supplier" button; the
    -- column's default says the same thing, and a reader of this insert
    -- should not have to go and look it up to know what is being made.
    'supplier'
  ) returning * into res;

  who := coalesce((select full_name from public.users where id = auth.uid()), 'opndoor admin');

  -- A creation row, so the audit trail starts at the beginning rather than at
  -- the first edit. Without it a partner's history begins mid-story.
  insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
  values (res.id, 'created', null,
          format('%s (%s), %s, %s, partner %s%%, agent %s%%, mode %s, portal %s, api %s',
                 res.name, res.slug, res.status, res.partner_kind,
                 coalesce(to_char(res.partner_rate*100, 'FM990.0'), 'no deal set'),
                 coalesce(to_char(res.agent_rate*100, 'FM990.0'), 'no deal set'),
                 res.referencing_mode,
                 case when res.portal_referrals_enabled then 'on' else 'off' end,
                 case when res.api_access_enabled then 'on' else 'off' end),
          who);

  return res;
end $$;

CREATE OR REPLACE FUNCTION public.update_partner_settings(p_slug text, p_name text, p_status text, p_live_from date, p_partner_rate numeric, p_agent_rate numeric, p_referencing_mode text, p_portal_referrals boolean, p_api_access boolean)
 RETURNS partners
language plpgsql security definer set search_path = '' as $$
declare cur public.partners; res public.partners; who text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'not permitted' using errcode = '42501'; end if;

  select * into cur from public.partners where slug = p_slug;
  if cur.id is null then raise exception 'Partner not found' using errcode = '22023'; end if;

  if btrim(coalesce(p_name,'')) = '' then raise exception 'Partner name is required' using errcode = '22023'; end if;
  /* NULL IS "NO DEAL", AND IT IS ALLOWED. 20261007680000. These refused a
     null outright, which was right while the columns were NOT NULL and
     every partner had a rate whether anybody had agreed one or not. A
     supplier created without a deal now has null rates, and its Settings
     tab -- name, status, live-from, referencing mode, capabilities --
     must be savable without the act of saving it inventing a commission
     agreement nobody struck. A number that IS supplied is validated
     exactly as before. */
  if p_partner_rate is not null and (p_partner_rate < 0 or p_partner_rate > 1) then raise exception 'Partner commission must be between 0 and 100%%' using errcode = '22023'; end if;
  if p_agent_rate is not null and (p_agent_rate < 0 or p_agent_rate > 1) then raise exception 'Agent commission must be between 0 and 100%%' using errcode = '22023'; end if;
  if coalesce(p_status,'') not in ('active','onboarding','paused') then raise exception 'Invalid status' using errcode = '22023'; end if;
  if coalesce(p_referencing_mode,'') not in ('pre_referenced_open','pre_referenced_screened','opndoor_referenced') then
    raise exception 'Invalid referencing mode' using errcode = '22023';
  end if;

  who := coalesce((select full_name from public.users where id = auth.uid()), 'opndoor admin');

  -- One audit row per changed field (old -> new). Rates recorded to ONE DECIMAL
  -- (never rounded to whole %) so 9.5% can never be mistaken for 10%.
  if cur.partner_rate is distinct from p_partner_rate then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'partner_rate', coalesce(to_char(cur.partner_rate*100, 'FM990.0') || '%', 'no deal set'), coalesce(to_char(p_partner_rate*100, 'FM990.0') || '%', 'no deal set'), who);
  end if;
  if cur.agent_rate is distinct from p_agent_rate then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'agent_rate', coalesce(to_char(cur.agent_rate*100, 'FM990.0') || '%', 'no deal set'), coalesce(to_char(p_agent_rate*100, 'FM990.0') || '%', 'no deal set'), who);
  end if;
  if cur.status is distinct from p_status then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'status', cur.status, p_status, who);
  end if;
  /* COMPARED AT THE PRECISION IT IS EDITED AT, which is the whole of
     "only record a change when a value actually changed".

     `live_from` is a DATE and the screen edits it as a MONTH: the client
     sends `${since}-01`, so saving a supplier whose stored date is the
     20th of the month wrote a row reading "2026-08 -> 2026-08". Found on
     dev, where kestrel-lettings has exactly that row and every other
     supplier still holds a non-first day, so the next save of any of them
     would write another.

     The row was not wrong about the column; it was wrong about the
     question, which is what a person changed. Comparing the months makes
     the record agree with the sentence it prints. */
  if date_trunc('month', cur.live_from) is distinct from date_trunc('month', p_live_from) then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'live_from', coalesce(to_char(cur.live_from,'YYYY-MM'),'—'), coalesce(to_char(p_live_from,'YYYY-MM'),'—'), who);
  end if;
  if cur.name is distinct from p_name then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'name', cur.name, p_name, who);
  end if;

  -- The three new ones. referencing_mode is recorded with its raw value rather
  -- than a friendly label: this trail is read when somebody asks what changed
  -- and when, and a label that gets reworded later makes old rows unreadable.
  if cur.referencing_mode is distinct from p_referencing_mode then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'referencing_mode', cur.referencing_mode, p_referencing_mode, who);
  end if;
  if cur.portal_referrals_enabled is distinct from p_portal_referrals then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'portal_referrals_enabled',
            case when cur.portal_referrals_enabled then 'on' else 'off' end,
            case when p_portal_referrals then 'on' else 'off' end, who);
  end if;
  if cur.api_access_enabled is distinct from p_api_access then
    -- Worth its own note in the trail: turning this off stops EXISTING keys
    -- working, not just new ones, so this row explains an outage somebody will
    -- be investigating later.
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'api_access_enabled',
            case when cur.api_access_enabled then 'on' else 'off' end,
            case when p_api_access then 'on (existing keys work again)' else 'off (all existing keys stop working)' end,
            who);
  end if;

  update public.partners
    set name = p_name, status = p_status, live_from = p_live_from,
        partner_rate = p_partner_rate, agent_rate = p_agent_rate,
        referencing_mode = p_referencing_mode,
        portal_referrals_enabled = p_portal_referrals,
        api_access_enabled = p_api_access
    where id = cur.id
    returning * into res;

  return res;
end $$;

/* =====================================================================
   AND A REFERRAL UNDER A DEALLESS SUPPLIER IS STILL CREATED.

   `resolve_rates` coalesces down to the partner's flat rate, which can
   now be null. `applications.partner_rate` is NOT NULL, so a null here
   would refuse the referral with a constraint error -- which is the
   refusal Matt deferred to After launch, arriving by the back door and
   with no message a person could act on.

   SO THE LAST COALESCE IS 0, and it says what it means: nothing has been
   agreed, so nothing is owed, and the referral is recorded rather than
   lost. When the refusal is built it replaces this with a sentence.

   THE PRECEDENCE ABOVE IS UNTOUCHED -- agreement, agency, group, partner
   -- and resolve_rates_precedence.test.sql asserts it.
   ===================================================================== */
create or replace function public.resolve_rates(p_branch uuid, p_route_partner uuid, p_tenant_count integer default 1)
returns table(partner_rate numeric, agent_rate numeric)
language sql stable security definer set search_path = '' as $$
  select
    coalesce(
      (select r.agent_rate from public.resolve_pricing_agreement(
         p_branch, p_route_partner, p_tenant_count, 'commission') r
        where r.scope_level = 'partner'),
      a.partner_rate, g.partner_rate, p.partner_rate, 0),
    coalesce(
      (select r.agent_rate from public.resolve_pricing_agreement(
         p_branch, p_route_partner, p_tenant_count, 'agent_share') r),
      a.agent_rate, g.agent_rate, p.agent_rate, 0)
  from public.partners p
  left join public.branches b on b.id = p_branch
  left join public.agencies a on a.id = b.agency_id
  left join public.agency_groups g on g.id = a.group_id
  where p.id = p_route_partner
$$;
