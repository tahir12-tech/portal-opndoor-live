-- Creating a partner, and editing everything about one.
--
-- THE BLOCKER THIS FIXES. addPartner in the client wrote to localStorage and
-- nothing else: no Supabase branch, a client-minted id, and there was no
-- create_partner RPC anywhere in the schema for it to call. Creating a partner
-- through the product has never worked. Worse, the screen toasted "Partner X
-- created at 25% partner / 10% agent. Add users, agencies and branches under it
-- next", so an admin followed those instructions and found nothing to add them
-- to.

-- ---------------------------------------------------------------------------
-- create_partner
-- ---------------------------------------------------------------------------
-- Slug is DERIVED HERE, not supplied. The client used to mint an id, which is
-- how you get two partners racing for the same slug and one of them failing on a
-- unique violation the user cannot interpret. Deriving it server side inside the
-- same transaction as the insert makes the uniqueness check and the insert
-- atomic.
create or replace function public.create_partner(
  p_name         text,
  p_status       text    default 'onboarding',
  p_live_from    date    default null,
  p_partner_rate numeric default 0.25,
  p_agent_rate   numeric default 0.10,
  p_referencing_mode text default 'pre_referenced_screened',
  p_portal_referrals boolean default true,
  p_api_access       boolean default false
) returns public.partners
language plpgsql security definer set search_path to ''
as $function$
declare base text; v_slug text; n int := 2; res public.partners; who text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;

  if btrim(coalesce(p_name,'')) = '' then
    raise exception 'Partner name is required' using errcode = '22023';
  end if;
  -- Same validation as update_partner_settings, deliberately identical so a
  -- partner cannot be created in a state the edit screen would refuse to save.
  if p_partner_rate is null or p_partner_rate < 0 or p_partner_rate > 1 then
    raise exception 'Partner commission must be between 0 and 100%%' using errcode = '22023';
  end if;
  if p_agent_rate is null or p_agent_rate < 0 or p_agent_rate > 1 then
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
    referencing_mode, portal_referrals_enabled, api_access_enabled
  ) values (
    v_slug, btrim(p_name), p_status, p_live_from, p_partner_rate, p_agent_rate,
    p_referencing_mode, coalesce(p_portal_referrals, true), coalesce(p_api_access, false)
  ) returning * into res;

  who := coalesce((select full_name from public.users where id = auth.uid()), 'opndoor admin');

  -- A creation row, so the audit trail starts at the beginning rather than at
  -- the first edit. Without it a partner's history begins mid-story.
  insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
  values (res.id, 'created', null,
          format('%s (%s), %s, partner %s%%, agent %s%%, mode %s, portal %s, api %s',
                 res.name, res.slug, res.status,
                 to_char(res.partner_rate*100, 'FM990.0'), to_char(res.agent_rate*100, 'FM990.0'),
                 res.referencing_mode,
                 case when res.portal_referrals_enabled then 'on' else 'off' end,
                 case when res.api_access_enabled then 'on' else 'off' end),
          who);

  return res;
end $function$;

revoke all on function public.create_partner(text, text, date, numeric, numeric, text, boolean, boolean)
  from public, anon;
grant execute on function public.create_partner(text, text, date, numeric, numeric, text, boolean, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- update_partner_settings, extended
-- ---------------------------------------------------------------------------
-- Everything is editable after creation, not set once, because some of these
-- will be wrong the first time and a setting that can only be chosen at creation
-- is a setting that gets fixed with a hand-written UPDATE and no audit row.
--
-- Dropped and recreated rather than replaced. Adding the three arguments with
-- defaults would leave the 6-argument signature callable, and an un-updated
-- caller would resolve to it and silently save nothing while reporting success:
-- exactly the failure the localStorage addPartner already produced once.
drop function if exists public.update_partner_settings(text, text, text, date, numeric, numeric);

create function public.update_partner_settings(
  p_slug text,
  p_name text,
  p_status text,
  p_live_from date,
  p_partner_rate numeric,
  p_agent_rate numeric,
  p_referencing_mode text,
  p_portal_referrals boolean,
  p_api_access boolean
) returns public.partners
language plpgsql
security definer
set search_path to ''
as $function$
declare cur public.partners; res public.partners; who text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;

  select * into cur from public.partners where slug = p_slug;
  if cur.id is null then raise exception 'Partner not found' using errcode = '22023'; end if;

  if btrim(coalesce(p_name,'')) = '' then raise exception 'Partner name is required' using errcode = '22023'; end if;
  if p_partner_rate is null or p_partner_rate < 0 or p_partner_rate > 1 then raise exception 'Partner commission must be between 0 and 100%%' using errcode = '22023'; end if;
  if p_agent_rate is null or p_agent_rate < 0 or p_agent_rate > 1 then raise exception 'Agent commission must be between 0 and 100%%' using errcode = '22023'; end if;
  if coalesce(p_status,'') not in ('active','onboarding','paused') then raise exception 'Invalid status' using errcode = '22023'; end if;
  if coalesce(p_referencing_mode,'') not in ('pre_referenced_open','pre_referenced_screened','opndoor_referenced') then
    raise exception 'Invalid referencing mode' using errcode = '22023';
  end if;

  who := coalesce((select full_name from public.users where id = auth.uid()), 'opndoor admin');

  -- One audit row per changed field (old -> new). Rates recorded to ONE DECIMAL
  -- (never rounded to whole %) so 9.5% can never be mistaken for 10%.
  if cur.partner_rate is distinct from p_partner_rate then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'partner_rate', to_char(cur.partner_rate*100, 'FM990.0') || '%', to_char(p_partner_rate*100, 'FM990.0') || '%', who);
  end if;
  if cur.agent_rate is distinct from p_agent_rate then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'agent_rate', to_char(cur.agent_rate*100, 'FM990.0') || '%', to_char(p_agent_rate*100, 'FM990.0') || '%', who);
  end if;
  if cur.status is distinct from p_status then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'status', cur.status, p_status, who);
  end if;
  if cur.live_from is distinct from p_live_from then
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
end $function$;

revoke all on function public.update_partner_settings(text, text, text, date, numeric, numeric, text, boolean, boolean)
  from public, anon;
grant execute on function public.update_partner_settings(text, text, text, date, numeric, numeric, text, boolean, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- How many live keys a partner has, for the confirmation before disabling
-- ---------------------------------------------------------------------------
-- Turning api_access_enabled off is instant and takes production integrations
-- down. That is the correct behaviour for a capability switch and a nasty
-- surprise for whoever unticks it by accident, so the screen names the number
-- first.
create or replace function public.partner_active_key_count(p_slug text)
returns integer
language sql stable security definer set search_path to '' as $$
  select count(*)::int
  from public.partner_api_keys k
  join public.partners p on p.id = k.partner_id
  where p.slug = p_slug
    and k.revoked_at is null
    and (k.expires_at is null or k.expires_at > now())
    and public.is_aal2() and public.is_admin();
$$;

revoke all on function public.partner_active_key_count(text) from public, anon;
grant execute on function public.partner_active_key_count(text) to authenticated;
