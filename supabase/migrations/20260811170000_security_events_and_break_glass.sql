-- security_events, and the break-glass revoke that is its first writer.
--
-- ===========================================================================
-- WHAT THIS TABLE IS, AND WHAT KEEPS IT FROM BECOMING A SECOND REQUEST LOG
-- ===========================================================================
-- partner_api_request_log already records every request. It is high volume, it
-- is read by developers debugging their own integration, and nobody reads it
-- looking for trouble. A security log with those properties is one nobody reads
-- at all.
--
-- So this one is defined by a rule: A ROW HERE MEANS SOMEBODY SHOULD LOOK. Not
-- "something happened", not "something failed", but "this is either an attack, a
-- misconfiguration, or a person doing something exceptional". If a row does not
-- justify a human glancing at it, it does not belong here and belongs in the
-- request log instead.
--
-- Three consequences of that rule, all deliberate:
--
--   VOLUME IS THE HEALTH METRIC. An empty table is the expected state. If this
--   table is busy, either something is wrong or we have started recording
--   routine events, and both need fixing.
--
--   NOT ONE ROW PER OCCURRENCE for repeated events. Sixty failed authentications
--   from one origin is ONE row with a count, not sixty rows. Sixty rows is how a
--   log becomes noise, and it also lets an attacker flood the table.
--
--   NO BODIES, NO CREDENTIALS, NO PII. It records that a thing happened and
--   enough to act on it: which partner, which key by id, which origin. Never a
--   key, never a secret, never a tenant. A security table that accumulates
--   secrets is a worse problem than the one it solves.
--
-- WHO READS IT. opndoor admin only. Not management, not developers: a partner
-- seeing "a cross-partner access attempt was made against you" learns that
-- somebody tried, which is a fact about a third party. Admin-only also means the
-- table can name partners without leaking one partner's existence to another.

create table if not exists public.security_events (
  id           uuid primary key default gen_random_uuid(),

  -- What kind of thing. A short stable slug, because these get filtered on and
  -- alerted on, and a free-text summary is not filterable.
  kind         text not null,

  -- How worried to be, decided at write time by the code that knows the context.
  -- Deliberately three values and not five: a scale nobody can apply
  -- consistently is a scale that gets ignored.
  severity     text not null default 'warn'
                 check (severity in ('info', 'warn', 'critical')),

  -- Who or what it concerns. All nullable: an unauthenticated attempt has no
  -- partner, an admin action has no key.
  partner_id   uuid references public.partners(id) on delete set null,
  actor_id     uuid references public.users(id) on delete set null,
  api_key_id   uuid references public.partner_api_keys(id) on delete set null,

  -- Origin, for the repeated-failure case. Stored as text rather than inet
  -- because it arrives from a header and may be a list or malformed.
  origin       text,

  -- The count, for aggregated kinds. 1 for a singular event.
  occurrences  int not null default 1,

  -- One sentence, for a human. Never a body, never a credential.
  detail       text,

  first_at     timestamptz not null default now(),
  last_at      timestamptz not null default now(),

  -- The aggregation window, as a stored generated column.
  --
  -- It cannot be an expression in the index: date_trunc over timestamptz is
  -- STABLE rather than IMMUTABLE, because the result depends on the session
  -- timezone, and Postgres refuses a non-immutable function in an index. Pinning
  -- to UTC makes it immutable, and pinning it here rather than at each call site
  -- means the window cannot shift because somebody's session had a different
  -- timezone.
  window_hour  timestamp generated always as (date_trunc('hour', first_at at time zone 'UTC')) stored
);

-- The aggregation key. A repeated event updates the existing row within its
-- window rather than inserting, which is what keeps sixty failures at one row.
create unique index if not exists security_events_window_idx
  on public.security_events (kind, coalesce(origin, ''), coalesce(partner_id, '00000000-0000-0000-0000-000000000000'::uuid), window_hour);

create index if not exists security_events_recent_idx
  on public.security_events (last_at desc);

alter table public.security_events enable row level security;
revoke all on table public.security_events from anon, authenticated;

comment on table public.security_events is
  'Things somebody should look at: cross-partner access attempts, repeated authentication failures, admin break-glass actions. Deliberately low volume; an empty table is the expected state. Never contains credentials, bodies or tenant data. Read by opndoor admin only.';

/**
 * Record a security event, aggregating repeats within the hour.
 *
 * Never raises. This is called from paths that are already handling a failure,
 * and a logging error must not become the thing that breaks them.
 */
create or replace function public.record_security_event(
  p_kind text,
  p_severity text default 'warn',
  p_partner uuid default null,
  p_actor uuid default null,
  p_api_key uuid default null,
  p_origin text default null,
  p_detail text default null
) returns void
language plpgsql security definer set search_path to '' as $$
begin
  insert into public.security_events (kind, severity, partner_id, actor_id, api_key_id, origin, detail)
  values (p_kind, coalesce(p_severity,'warn'), p_partner, p_actor, p_api_key, left(p_origin, 100), left(p_detail, 500))
  on conflict (kind, coalesce(origin, ''), coalesce(partner_id, '00000000-0000-0000-0000-000000000000'::uuid), window_hour)
  do update set
    occurrences = public.security_events.occurrences + 1,
    last_at = now(),
    -- Escalates but never de-escalates within a window: one critical among a
    -- hundred warnings is the one that matters.
    severity = case when excluded.severity = 'critical' then 'critical'
                    else public.security_events.severity end,
    detail = coalesce(excluded.detail, public.security_events.detail);
exception when others then
  null;  -- deliberately swallowed; see the header
end $$;

revoke all on function public.record_security_event(text, text, uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.record_security_event(text, text, uuid, uuid, uuid, text, text)
  to service_role;

/** The admin read. No partner or developer arm, deliberately. */
create or replace function public.security_events_recent(p_days int default 30, p_limit int default 200)
returns table (
  id uuid, kind text, severity text, partner_name text, actor_name text,
  origin text, occurrences int, detail text, first_at timestamptz, last_at timestamptz
)
language sql stable security definer set search_path to '' as $$
  select e.id, e.kind, e.severity, p.name, u.full_name,
         e.origin, e.occurrences, e.detail, e.first_at, e.last_at
  from public.security_events e
  left join public.partners p on p.id = e.partner_id
  left join public.users u on u.id = e.actor_id
  where public.is_aal2() and public.is_admin()
    and e.last_at >= now() - make_interval(days => greatest(coalesce(p_days, 30), 1))
  order by e.last_at desc
  limit least(coalesce(p_limit, 200), 1000);
$$;

revoke all on function public.security_events_recent(int, int) from public, anon;
grant execute on function public.security_events_recent(int, int) to authenticated;

-- ===========================================================================
-- BREAK-GLASS REVOKE
-- ===========================================================================
-- An opndoor admin can no longer see a partner's keys. They can still kill one,
-- because an exposed credential at 2am cannot wait for the partner's developer
-- to wake up.
--
-- THE SHAPE IS THE SAFEGUARD. It takes a KEY PREFIX, typed in. An admin has to
-- already know which credential they are killing, which means they got it from
-- an incident: a key pasted into a ticket, a partner emailing to say it leaked,
-- a scanner alert. There is no browse, no list, no search, and no way to get a
-- prefix out of this function that you did not already have.
--
-- That is what "least exposing" means here. Revocation is a targeted act on a
-- credential somebody has told you about, not the last step of an inventory.
--
-- A REASON IS MANDATORY. Break-glass with no reason is a button.
create or replace function public.admin_break_glass_revoke_key(
  p_key_prefix text,
  p_reason text
) returns table (revoked boolean, partner_name text, key_name text)
language plpgsql security definer set search_path to '' as $$
declare k record; v_actor uuid := auth.uid(); v_who text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;

  if btrim(coalesce(p_reason,'')) = '' or length(btrim(p_reason)) < 10 then
    raise exception 'Give a reason. It is recorded against your name and read during an incident review.'
      using errcode = '22023';
  end if;

  select key.id, key.name, key.partner_id, key.revoked_at, p.name as pname
    into k
  from public.partner_api_keys key
  join public.partners p on p.id = key.partner_id
  where key.key_prefix = btrim(p_key_prefix);

  v_who := coalesce((select full_name from public.users where id = v_actor), 'an opndoor admin');

  if k.id is null then
    -- Recorded too. An admin fishing for valid prefixes is exactly the thing
    -- this table exists to surface, and a miss is as interesting as a hit.
    perform public.record_security_event(
      'break_glass_revoke_miss', 'warn', null, v_actor, null, null,
      format('%s attempted a break-glass revoke on prefix %s, which matched no key. Reason given: %s',
             v_who, left(btrim(p_key_prefix), 18), left(btrim(p_reason), 200)));
    return query select false, null::text, null::text;
    return;
  end if;

  if k.revoked_at is not null then
    return query select false, k.pname, k.name;
    return;
  end if;

  update public.partner_api_keys set revoked_at = now() where id = k.id;

  -- Named, deliberately and permanently. "Who could have done this" should have
  -- a one-name answer, and the whole reason admin lost the panels is that it
  -- previously did not.
  perform public.record_security_event(
    'break_glass_revoke', 'critical', k.partner_id, v_actor, k.id, null,
    format('%s revoked key "%s" (%s) for %s. Reason: %s',
           v_who, k.name, left(btrim(p_key_prefix), 18), k.pname, left(btrim(p_reason), 300)));

  return query select true, k.pname, k.name;
end $$;

revoke all on function public.admin_break_glass_revoke_key(text, text) from public, anon;
grant execute on function public.admin_break_glass_revoke_key(text, text) to authenticated;

-- The ordinary revoke loses its admin arm: an admin who wants to revoke uses
-- break-glass, which is deliberately a different, heavier act.
create or replace function public.dev_revoke_api_key(p_id uuid)
returns void
language plpgsql security definer set search_path to '' as $$
declare v_partner uuid;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select k.partner_id into v_partner from public.partner_api_keys k where k.id = p_id;
  if v_partner is null then raise exception 'Key not found.' using errcode = '22023'; end if;

  if not (public.app_role() in ('developer','management') and v_partner = public.app_partner()) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  update public.partner_api_keys set revoked_at = now() where id = p_id and revoked_at is null;
end $$;

revoke all on function public.dev_revoke_api_key(uuid) from public, anon;
grant execute on function public.dev_revoke_api_key(uuid) to authenticated;
