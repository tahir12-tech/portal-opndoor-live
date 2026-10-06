-- Rendering and enqueueing outbound webhook deliveries. See PARTNER-API.md §13.5.
--
-- WHY A TRIGGER AND NOT APPLICATION CODE. An application's status is changed
-- from at least five places: the portal, stripe-webhook on settlement, the deed
-- path, the expiry sweep, and now the partner API. If enqueueing lived in the
-- API, a partner would be told about applications they created and about nothing
-- else, which is the opposite of useful: the events that matter most, payment
-- and deed issue, all happen elsewhere.
--
-- Putting it on the table means every path emits, including paths written later
-- by someone who has never read this file.
--
-- STATUS IS NOT MONOTONIC, and the trigger must not assume it is. A later
-- payment reinstates an expired application or a tenant-declined withdrawal back
-- to paid ("late money wins", 20260705115059). So application.lapsed followed by
-- application.paid for the same application is correct, not a bug. The unique
-- index on (endpoint, application, event_type) means each event type is
-- delivered at most once per application, which keeps a reinstate from
-- re-emitting an event the partner has already seen.

-- ---------- the partner-safe payload ----------
-- DEFAULT DENY, BY CONSTRUCTION. Every field is named explicitly. There is no
-- select * and no row passthrough anywhere in this function, so a column added
-- to applications later cannot leak into a partner's payload by accident.
--
-- Deliberately absent, and each for a reason:
--   partner_rate, agent_rate   commission terms. NOTE these are snapshotted onto
--                              applications, so excluding the partners table is
--                              not enough on its own.
--   partner_id, referrer_id    internal identifiers, and cross-tenant handles
--   deed_state, executed_pdf_path   internal state and a storage object key
--   any Stripe or PandaDoc id  enables direct correlation with our accounts
--   activity_log               carries visibility = 'internal' rows
create or replace function public.partner_webhook_payload(p_application uuid, p_event text)
returns jsonb
language sql security definer set search_path to '' stable
as $function$
  select jsonb_build_object(
    'event_type', p_event,
    'application', jsonb_build_object(
      'id',             a.id,
      'guarantee_ref',  a.guarantee_ref,
      'status',         a.status,
      'created_at',     a.created_at,
      'sent_at',        a.sent_at,
      'paid_at',        a.paid_at,
      'deed_issued_at', a.deed_issued_at,
      'expiry_date',    a.expiry_date,
      'tenant', jsonb_build_object(
        'title',         a.tenant_title,
        'first_name',    a.tenant_first_name,
        'last_name',     a.tenant_last_name,
        'date_of_birth', a.tenant_dob,
        'email',         a.tenant_email,
        'phone',         a.tenant_phone
      ),
      'property', jsonb_build_object(
        'address_line_1', a.prop_addr1,
        'address_line_2', a.prop_addr2,
        'city',           a.prop_city,
        'county',         a.prop_county,
        'postcode',       a.prop_postcode
      ),
      'tenancy', jsonb_build_object(
        'monthly_rent', a.monthly_rent,
        'start_date',   a.tenancy_start
      ),
      'org', jsonb_build_object(
        'agency_id',   a.agency_id,
        'agency_name', ag.name,
        'branch_id',   a.branch_id,
        'branch_name', br.name
      )
    )
  )
  from public.applications a
  join public.agencies ag on ag.id = a.agency_id
  join public.branches br on br.id = a.branch_id
  where a.id = p_application;
$function$;

comment on function public.partner_webhook_payload(uuid, text) is
  'Partner-safe application payload. Every field named explicitly, so a column added to applications later cannot leak into a webhook by accident. Excludes commission rates (including the snapshots on applications), Stripe and PandaDoc identifiers, storage paths and internal state.';

revoke all on function public.partner_webhook_payload(uuid, text) from public, anon, authenticated;
grant execute on function public.partner_webhook_payload(uuid, text) to service_role;

-- ---------- fan out to this partner's endpoints ----------
create or replace function public.enqueue_partner_webhook(p_application uuid, p_event text)
returns integer
language plpgsql security definer set search_path to ''
as $function$
declare v_partner uuid; v_payload jsonb; n int := 0;
begin
  select partner_id into v_partner from public.applications where id = p_application;
  if v_partner is null then return 0; end if;

  -- Render once, store per endpoint. Rendering here rather than at delivery is
  -- what makes a retry deliver the past, not the present.
  v_payload := public.partner_webhook_payload(p_application, p_event);
  if v_payload is null then return 0; end if;

  insert into public.partner_webhook_deliveries (endpoint_id, event_type, application_id, payload)
  select e.id, p_event, p_application, v_payload
  from public.partner_webhook_endpoints e
  where e.partner_id = v_partner
    and e.active
    and (cardinality(e.events) = 0 or p_event = any(e.events))
  on conflict do nothing;   -- the once-per-endpoint-per-event index

  get diagnostics n = row_count;
  return n;
end $function$;

revoke all on function public.enqueue_partner_webhook(uuid, text) from public, anon, authenticated;
grant execute on function public.enqueue_partner_webhook(uuid, text) to service_role;

-- ---------- the trigger ----------
create or replace function public.applications_emit_partner_webhook()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
declare v_event text;
begin
  if tg_op = 'INSERT' then
    v_event := 'application.created';
  elsif new.status is distinct from old.status then
    v_event := case new.status
      when 'paid'      then 'application.paid'
      when 'deed'      then 'application.deed_issued'
      -- 'lapsed', not 'expired'. This codebase uses "expiry" for two unrelated
      -- things: an unpaid application lapsing after 14 days (status), and the
      -- guarantee expiring 12 months after tenancy start (expiry_date). A
      -- partner-facing name must not inherit that ambiguity.
      when 'expired'   then 'application.lapsed'
      when 'withdrawn' then 'application.withdrawn'
      else null
    end;
  end if;

  if v_event is null then return null; end if;

  -- Never let a webhook failure break the write that caused it. An application
  -- must still be created, paid or issued even if the queue is unavailable.
  -- Unlike the ops-alert pattern this mirrors, the failure is recorded rather
  -- than swallowed into silence.
  begin
    perform public.enqueue_partner_webhook(new.id, v_event);
  exception when others then
    insert into public.activity_log (application_id, kind, message, actor, visibility)
    values (new.id, 'webhook_enqueue_failed',
            'Could not queue the ' || v_event || ' webhook: ' || sqlerrm,
            'System', 'internal');
  end;

  return null;
end $function$;

drop trigger if exists applications_emit_partner_webhook on public.applications;
create trigger applications_emit_partner_webhook
  after insert or update of status on public.applications
  for each row execute function public.applications_emit_partner_webhook();

comment on function public.applications_emit_partner_webhook() is
  'Emits partner webhooks on status change from any path: portal, stripe-webhook, deed, expiry sweep or the partner API. A queue failure is logged to activity_log rather than failing the write that caused it.';
