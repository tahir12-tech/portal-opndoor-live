-- WHO OPNDOOR TELLS.
--
-- Q-04. Today every internal alert of every kind goes to one address, read
-- from an environment variable, and if that variable is unset the alert is
-- dropped and the only trace is the ops_alerts row. See
-- docs/OPS-NOTIFICATIONS.md for the whole inventory.
--
-- This is the routing table, its floor, and its audit. The screen is built on
-- top of it and enforces nothing of its own.
--
-- THE FLOOR IS THE POINT OF THE ITEM. "Critical types can be rerouted but
-- never left with zero recipients: refused in SQL and shown as locked below
-- one." So the refusal is a trigger on the table, not a check in the RPC:
-- there are three ways to empty a route (turn the last one off, delete it,
-- or deactivate the last person holding it) and only a trigger catches all
-- three. Deactivation is the one that matters most, because nobody is
-- looking at this page when it happens.
--
-- AND THE FALLBACK IS NOT THE FLOOR. Even with the trigger, a critical type
-- can end up addressed to nobody: every route can point at people who are all
-- deactivated in one transaction, or the table can be empty before anybody
-- has configured it. So ops_route_recipients falls back to support@opndoor.co
-- AND says it did, which is itself an alert. A silent fallback would mean the
-- floor was never tested in production.

-- ---------------------------------------------------------------------------
-- WHAT CAN BE ROUTED
-- ---------------------------------------------------------------------------
-- The types the platform actually raises, from the inventory. A type that
-- nothing sends is not offered: a switch for something that never fires is
-- worse than no switch, because it reads as coverage.
create or replace function public.ops_notification_types()
returns table(alert_type text, label text, grp text, critical boolean, ord int)
language sql immutable as $$
  select * from (values
    -- CRITICAL: a guarantee is at risk, or money or identity is wrong.
    ('deed_claim_failed',              'Deed could not be claimed after payment', 'Critical', true,  1),
    ('deed_void_failed',               'Deed could not be voided after a refund', 'Critical', true,  2),
    ('deed_executed_after_refund',     'Deed executed after the fee was refunded','Critical', true,  3),
    ('deed_pdf_not_stored',            'Executed deed could not be archived',     'Critical', true,  4),
    ('deed_pdf_unavailable',           'Executed deed could not be fetched',      'Critical', true,  5),
    ('deed_sweep_all_failed',          'The whole deed sweep failed',             'Critical', true,  6),
    ('stripe_refund_not_applied',      'Stripe refunded and the row did not',     'Critical', true,  7),
    -- The closest thing the platform has to a security event.
    ('pandadoc_signature_rejected',    'Webhook signature rejected',              'Critical', true,  8),
    ('stripe_livemode_mismatch',       'Live/sandbox mismatch (payments)',        'Critical', true,  9),
    ('pandadoc_livemode_mismatch',     'Live/sandbox mismatch (deeds)',           'Critical', true, 10),

    -- OPERATIONS: somebody has to do something.
    ('deed_awaiting_staff_send',       'Deed needs a staff send',                 'Operations', false, 20),
    ('deed_no_delivery_contact',       'Deed has nobody to go to',                'Operations', false, 21),
    ('deed_delivery_target_unreadable','Deed recipients could not be resolved',   'Operations', false, 22),
    ('expiry_reminder_unaddressed',    'Expiry reminder reached nobody',          'Operations', false, 23),
    ('renewal_notice_unaddressed',     'Renewal notice reached nobody',           'Operations', false, 24),
    ('deed_sweep_failed',              'One application failed in the sweep',     'Operations', false, 25),
    ('deed_document_unattached',       'Document not attached to its application','Operations', false, 26),
    ('deed_orphan_document',           'Provider document with no application',   'Operations', false, 27),
    ('deed_stamp_partial',             'Deed stamped incompletely',               'Operations', false, 28),
    ('pandadoc_completed_unknown_document','Completion for an unknown document',  'Operations', false, 29),
    ('webhook_error',                  'An inbound webhook threw',                'Operations', false, 30),
    ('cron_error',                     'A scheduled job threw',                   'Operations', false, 31),

    -- COMMERCIAL.
    ('lapse',                          'A guarantee lapsed',                      'Commercial', false, 40),
    ('renewal_notice',                 'A renewal is due',                        'Commercial', false, 41),

    -- INFORMATION.
    ('hubspot_map_drift',              'CRM mapping has drifted',                 'Information', false, 50)
  ) as t(alert_type, label, grp, critical, ord)
$$;

comment on function public.ops_notification_types() is
  'The internal alert kinds the platform actually raises, from '
  'docs/OPS-NOTIFICATIONS.md. cron_error is one row, not five: the five '
  'cron_error:<fn> variants are the same event about different jobs and '
  'routing them apart would be five switches nobody would set differently.';

-- ---------------------------------------------------------------------------
-- WHO CAN BE ROUTED TO
-- ---------------------------------------------------------------------------
-- A named shared inbox. Opndoor team members come from public.users and need
-- no table of their own.
create table if not exists public.ops_inboxes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint ops_inboxes_name_present check (btrim(name) <> ''),
  constraint ops_inboxes_email_valid
    check (email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$')
);
create unique index if not exists ops_inboxes_email_key on public.ops_inboxes (lower(email));
alter table public.ops_inboxes enable row level security;

-- The route itself: one row per (type, recipient), where the recipient is
-- either an Opndoor person or a shared inbox.
create table if not exists public.ops_routes (
  id uuid primary key default gen_random_uuid(),
  alert_type text not null,
  user_id uuid references public.users(id) on delete cascade,
  inbox_id uuid references public.ops_inboxes(id) on delete cascade,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id),
  constraint ops_routes_one_recipient check ((user_id is null) <> (inbox_id is null))
);
create unique index if not exists ops_routes_user_cell
  on public.ops_routes (alert_type, user_id) where user_id is not null;
create unique index if not exists ops_routes_inbox_cell
  on public.ops_routes (alert_type, inbox_id) where inbox_id is not null;
alter table public.ops_routes enable row level security;

-- Reached only through the functions below, like notification_settings.
revoke all on table public.ops_inboxes from public, anon, authenticated;
revoke all on table public.ops_routes from public, anon, authenticated;
grant select, insert, update, delete on table public.ops_inboxes to service_role;
grant select, insert, update, delete on table public.ops_routes to service_role;

-- ---------------------------------------------------------------------------
-- THE FLOOR ON A CRITICAL TYPE
-- ---------------------------------------------------------------------------
-- How many LIVE recipients a type has: a route that is enabled, pointing at
-- somebody who can actually receive it. A deactivated person and an inactive
-- inbox both count for nothing, which is the "a deactivated team member drops
-- off every route" half of the instruction -- they drop off by being counted
-- out, so nothing has to remember to delete their rows.
create or replace function public.ops_route_live_count(p_type text)
returns int
language sql stable security definer set search_path to '' as $$
  select count(*)::int
    from public.ops_routes r
    left join public.users u on u.id = r.user_id
    left join public.ops_inboxes b on b.id = r.inbox_id
   where r.alert_type = p_type
     and r.enabled
     and ((r.user_id is not null and u.status = 'active')
       or (r.inbox_id is not null and b.active))
$$;

create or replace function public.ops_routes_keep_the_floor()
returns trigger language plpgsql security definer set search_path to '' as $function$
declare v_type text; v_critical boolean;
begin
  v_type := coalesce(new.alert_type, old.alert_type);
  select t.critical into v_critical
    from public.ops_notification_types() t where t.alert_type = v_type;
  if not coalesce(v_critical, false) then return coalesce(new, old); end if;

  /* AFTER the write, so the count is the state being committed rather than
     the state before it. A constraint trigger would be tidier still, but this
     fires per statement-row and the table is tiny. */
  if public.ops_route_live_count(v_type) = 0 then
    raise exception 'A critical alert cannot be left with nobody to receive it. Add another recipient before removing this one.'
      using errcode = '23514';
  end if;
  return coalesce(new, old);
end $function$;

drop trigger if exists ops_routes_keep_the_floor on public.ops_routes;
create constraint trigger ops_routes_keep_the_floor
  after insert or update or delete on public.ops_routes
  deferrable initially deferred
  for each row execute function public.ops_routes_keep_the_floor();

-- AND THE SAME FLOOR WHEN SOMEBODY IS DEACTIVATED. This is the one that
-- matters most: nobody is looking at the routing page when a leaver is
-- processed, and without it the floor is only enforced where it is watched.
create or replace function public.ops_routes_floor_on_deactivate()
returns trigger language plpgsql security definer set search_path to '' as $function$
declare r record;
begin
  if new.status = 'active' or old.status <> 'active' then return new; end if;
  for r in select t.alert_type from public.ops_notification_types() t where t.critical loop
    if public.ops_route_live_count(r.alert_type) = 0
       and exists (select 1 from public.ops_routes x
                    where x.alert_type = r.alert_type and x.user_id = new.id and x.enabled) then
      raise exception 'Deactivating % would leave "%" with nobody to receive it. Route it to somebody else first.',
        coalesce(new.full_name, new.email), r.alert_type using errcode = '23514';
    end if;
  end loop;
  return new;
end $function$;

drop trigger if exists ops_routes_floor_on_deactivate on public.users;
create constraint trigger ops_routes_floor_on_deactivate
  after update of status on public.users
  deferrable initially deferred
  for each row execute function public.ops_routes_floor_on_deactivate();

revoke all on function public.ops_route_live_count(text) from public, anon;
grant execute on function public.ops_route_live_count(text) to authenticated, service_role;
revoke all on function public.ops_routes_keep_the_floor() from public, anon, authenticated;
revoke all on function public.ops_routes_floor_on_deactivate() from public, anon, authenticated;
