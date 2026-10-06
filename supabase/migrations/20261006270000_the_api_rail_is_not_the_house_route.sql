-- THE API RAIL IS NOT THE HOUSE ROUTE.
--
-- partner_webhook_endpoints are registered per PARTNER, and
-- enqueue_partner_webhook fans an application's event out to every endpoint on
-- that partner:
--
--   insert into public.partner_webhook_deliveries (...)
--   from public.partner_webhook_endpoints e
--   where e.partner_id = v_partner
--
-- On the supplier rail that is correct and is the whole product: a supplier
-- registers an endpoint and hears about their own applications.
--
-- On the house route it would be a hole. Every agency shares
-- 'opndoor-agents', so one endpoint registered there receives
-- application.sent, .paid and .deed_issued for EVERY agency Opndoor carries,
-- with the tenant, the property and the fee in the payload. The route to it is
-- short: a Manager may invite a developer (invite-user's allowlist), and a
-- developer may register an endpoint (dev-centre).
--
-- IT IS SHUT TODAY BY A TOGGLE, NOT BY A BOUNDARY. dev-centre refuses when
-- partners.api_access_enabled is false, and it is false for 'opndoor-agents'.
-- That is a capability flag: somebody turning it on to test something would
-- open this without meaning to, and nothing would say so.
--
-- So the rule is stated where it belongs. An agency-rail partner has no API
-- integration surface: the agency rail IS the portal. Two guards, because the
-- one that refuses registration and the one that refuses delivery answer
-- different questions and either alone leaves the other reachable -- an
-- endpoint registered before this migration would still be delivered to.

-- ---------------------------------------------------------------------------
-- 1. NOTHING IS DELIVERED to an endpoint on an estate partner.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_partner_webhook(p_application uuid, p_event text)
returns integer
language plpgsql security definer set search_path to ''
as $function$
declare v_partner uuid; v_livemode boolean; v_payload jsonb; n int := 0;
begin
  select partner_id, livemode into v_partner, v_livemode
  from public.applications where id = p_application;
  if v_partner is null then return 0; end if;

  /* THE AGENCY RAIL HAS NO WEBHOOK SURFACE. Its partner is shared by every
     agency, so an endpoint there is an endpoint on all of them. Returning 0
     rather than raising: this is called from the status transitions, and a
     transition must not fail because a rail has no integration. */
  if public.is_our_estate_partner(v_partner) then return 0; end if;

  v_payload := public.partner_webhook_payload(p_application, p_event);

  insert into public.partner_webhook_deliveries (endpoint_id, event_type, application_id, payload)
  select e.id, p_event, p_application, v_payload
  from public.partner_webhook_endpoints e
  where e.partner_id = v_partner
    and e.active
    and e.livemode = v_livemode
    and (cardinality(e.events) = 0 or p_event = any(e.events));

  get diagnostics n = row_count;
  return n;
end $function$;

comment on function public.enqueue_partner_webhook(uuid, text) is
  'Queue an application event to a supplier''s registered endpoints. Returns 0 for an agency-rail partner: that partner is shared by every agency Opndoor carries, so an endpoint on it would receive every agency''s tenants.';

-- ---------------------------------------------------------------------------
-- 2. NOTHING CAN BE REGISTERED there in the first place.
-- ---------------------------------------------------------------------------
create or replace function public.partner_webhook_endpoint_rail_guard()
returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
  if public.is_our_estate_partner(new.partner_id) then
    raise exception 'The agency rail has no API integration: its partner is shared by every agency, so an endpoint on it would receive them all.'
      using errcode = '42501';
  end if;
  return new;
end $function$;

drop trigger if exists partner_webhook_endpoint_rail_guard on public.partner_webhook_endpoints;
create trigger partner_webhook_endpoint_rail_guard
  before insert or update of partner_id on public.partner_webhook_endpoints
  for each row execute function public.partner_webhook_endpoint_rail_guard();

-- ---------------------------------------------------------------------------
-- 3. AND AN API KEY IS THE SAME QUESTION. partner_api_keys authorises the
--    partner API, which reads and writes applications across the partner.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.partner_api_keys') is not null then
    execute $ddl$
      create or replace function public.partner_api_key_rail_guard()
      returns trigger language plpgsql security definer set search_path to ''
      as $fn$
      begin
        if public.is_our_estate_partner(new.partner_id) then
          raise exception 'The agency rail has no API access: its partner is shared by every agency.'
            using errcode = '42501';
        end if;
        return new;
      end $fn$;
    $ddl$;
    execute 'drop trigger if exists partner_api_key_rail_guard on public.partner_api_keys';
    execute 'create trigger partner_api_key_rail_guard before insert or update of partner_id on public.partner_api_keys for each row execute function public.partner_api_key_rail_guard()';
  end if;
end $$;
