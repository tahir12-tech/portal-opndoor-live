-- EACH PARTY SAYS WHO IT TELLS.
--
-- Q-03. "Each supplier and each agency has a matrix: notification types (sent,
-- paid, signed, deed issued, tenancy start correction, renewal notice, lapse,
-- decline) against recipients (referrer, branch agent contact, ticked users),
-- each on or off."
--
-- WHICH CELLS EXIST DEPENDS ON THE RAIL, and this is the one judgement in the
-- whole file. "Defaults: everything on for agencies" cannot mean that the
-- branch mailbox is copied on every agency notification, because the deed rule
-- settled two instructions earlier says the opposite in terms:
--
--     "with the referrer deactivated the deed goes to the ticked user in
--      scope, and not to the branch mailbox"
--
-- -- which is asserted in the_ticked_user_gets_the_deed.test.sql. On the agency
-- rail the branch contact is a FALLBACK for an empty ladder, not a standing
-- recipient. So the classes that exist are:
--
--   AGENCY    referrer, ticked_users          (positions are the model there)
--   SUPPLIER  referrer, agent_contact         (no positions; the partner IS
--                                              the company, and the branch
--                                              contact is a real desk)
--
-- and "everything on for agencies" means every cell an agency HAS is on. A
-- cell that does not exist for a party is not off, it is absent, and asking
-- about it is refused rather than answered false -- otherwise the UI would
-- draw a switch that does nothing.
--
-- DEFAULTS ARE COMPUTED, NOT SEEDED. A party with no rows behaves correctly,
-- so a supplier onboarded next month needs no backfill and there is no window
-- in which a new agency sends nothing. A row exists only where somebody has
-- actually changed something, which also makes "what has this party changed?"
-- a query rather than a diff against a remembered default.
--
-- LOCKED CELLS. "Not switchable, and shown as locked with the reason: delivery
-- of the executed deed to its recipient, every email to the tenant, and ops
-- alerts." Its RECIPIENT, singular: the deed's resolved primary target, which
-- is the referrer on the agency rail and the agent contact on the supplier
-- rail. Copies to the other class stay switchable, which is what makes the
-- matrix worth having. Tenant email and ops alerts are not cells at all --
-- they are not agent-facing -- so they are unswitchable by construction rather
-- than by a flag.

create table if not exists public.notification_settings (
  id uuid primary key default gen_random_uuid(),
  -- Exactly one party. A supplier is a partner; an agency is an agency. The
  -- house partner is never a party: on the agency rail the agency is.
  partner_id uuid references public.partners(id) on delete cascade,
  agency_id  uuid references public.agencies(id) on delete cascade,
  notification_type text not null,
  recipient text not null,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id),
  constraint notification_settings_one_party
    check ((partner_id is null) <> (agency_id is null)),
  constraint notification_settings_type
    check (notification_type in ('sent','paid','signed','deed_issued',
                                 'tenancy_correction','renewal_notice','lapse','decline')),
  constraint notification_settings_recipient
    check (recipient in ('referrer','agent_contact','ticked_users'))
);

-- NULLs are distinct in a unique constraint, so one index per party shape.
create unique index if not exists notification_settings_partner_cell
  on public.notification_settings (partner_id, notification_type, recipient)
  where partner_id is not null;
create unique index if not exists notification_settings_agency_cell
  on public.notification_settings (agency_id, notification_type, recipient)
  where agency_id is not null;

alter table public.notification_settings enable row level security;

-- ===========================================================================
-- THE CANONICAL LISTS, so the UI and the send path cannot disagree about what
-- a type or a recipient class is.
-- ===========================================================================
create or replace function public.notification_types()
returns table(notification_type text, label text, ord int)
language sql immutable as $$
  select * from (values
    ('sent',               'Sent for referencing', 1),
    ('signed',             'Deed signed',          2),
    ('paid',               'Fee paid',             3),
    ('deed_issued',        'Deed issued',          4),
    ('decline',            'Declined',             5),
    ('tenancy_correction', 'Tenancy start corrected', 6),
    ('renewal_notice',     'Renewal notice',       7),
    ('lapse',              'Lapse (expiry reminder)', 8)
  ) as t(notification_type, label, ord)
$$;

-- Which recipient classes a party of this kind actually has. See the header:
-- an absent class is not an "off" switch.
create or replace function public.notification_recipient_classes(p_kind text)
returns table(recipient text, label text, ord int)
language sql immutable as $$
  select * from (values
    ('referrer',     'The referrer',          1),
    ('agent_contact','The branch agent contact', 2),
    ('ticked_users', 'Users ticked "Receives notifications"', 3)
  ) as t(recipient, label, ord)
  where (p_kind = 'agency'   and t.recipient in ('referrer','ticked_users'))
     or (p_kind = 'supplier' and t.recipient in ('referrer','agent_contact'))
$$;

-- ===========================================================================
-- DEFAULTS AND LOCKS
-- ===========================================================================
create or replace function public.notification_default(p_kind text, p_type text, p_recipient text)
returns boolean
language sql immutable as $$
  select case
    -- Everything on for agencies, for every class an agency has.
    when p_kind = 'agency' then true
    -- On suppliers, everything on for the referrer and deed issued only for
    -- the agent contact.
    when p_kind = 'supplier' and p_recipient = 'referrer' then true
    when p_kind = 'supplier' and p_recipient = 'agent_contact' then p_type = 'deed_issued'
    else false
  end
$$;

create or replace function public.notification_locked(p_kind text, p_type text, p_recipient text)
returns boolean
language sql immutable as $$
  -- The executed deed to ITS recipient: the resolved primary target of that
  -- rail. Copies to the other class remain switchable.
  select p_type = 'deed_issued'
     and ((p_kind = 'agency'   and p_recipient = 'referrer')
       or (p_kind = 'supplier' and p_recipient = 'agent_contact'))
$$;

-- ===========================================================================
-- WHICH PARTY AN APPLICATION BELONGS TO
-- ===========================================================================
-- The agency rail's party is the AGENCY, not the house partner every agency
-- shares. The supplier rail's party is the partner, because there the partner
-- is the company. Direct has no agent-facing party at all.
create or replace function public.notification_party(p_application uuid)
returns table(kind text, partner_id uuid, agency_id uuid)
language sql stable security definer set search_path to '' as $$
  -- application_channel is the one place that decides which rail a row is on,
  -- and it takes the APPLICATION because the answer depends on the partner's
  -- slug and its house-route flag together, not on partner_id alone.
  select
    case ch.c when 'Agent referral' then 'agency'
              when 'Direct' then 'direct'
              else 'supplier' end,
    case when ch.c in ('Agent referral','Direct') then null else a.partner_id end,
    case when ch.c = 'Agent referral' then a.agency_id else null end
  from public.applications a
  cross join lateral (select public.application_channel(a.id) as c) ch
  where a.id = p_application
$$;

create or replace function public.notification_enabled(
  p_kind text, p_partner uuid, p_agency uuid, p_type text, p_recipient text)
returns boolean
language sql stable security definer set search_path to '' as $$
  select case
    -- A class this kind of party does not have is never a recipient.
    when not exists (select 1 from public.notification_recipient_classes(p_kind) c
                      where c.recipient = p_recipient) then false
    -- Locked on, whatever any row says.
    when public.notification_locked(p_kind, p_type, p_recipient) then true
    else coalesce(
      (select s.enabled from public.notification_settings s
        where s.notification_type = p_type and s.recipient = p_recipient
          and ((p_agency is not null and s.agency_id = p_agency)
            or (p_agency is null and p_partner is not null and s.partner_id = p_partner))),
      public.notification_default(p_kind, p_type, p_recipient))
  end
$$;

comment on function public.notification_enabled(text, uuid, uuid, text, text) is
  'The one place a send path asks whether a class of recipient is told about a '
  'type of event for a party. Locked cells answer true whatever the stored row '
  'says; an absent row answers the default, so a party that has changed nothing '
  'needs no rows.';

-- ===========================================================================
-- READING THE MATRIX, for the screen
-- ===========================================================================
-- Returns every cell a party HAS, with its current value, whether that value
-- is a default or a stored choice, and whether it is locked. The screen draws
-- from this rather than from a list of its own, so a class that does not exist
-- for this kind of party cannot be drawn as a switch that does nothing.
create or replace function public.notification_matrix(p_partner uuid, p_agency uuid)
returns table(notification_type text, type_label text, type_ord int,
              recipient text, recipient_label text, recipient_ord int,
              enabled boolean, is_default boolean, locked boolean)
language plpgsql stable security definer set search_path to '' as $function$
declare v_kind text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if coalesce((p_partner is null) = (p_agency is null), true) then
    raise exception 'Name exactly one party: a supplier partner or an agency.' using errcode = '22023';
  end if;
  v_kind := case when p_agency is not null then 'agency' else 'supplier' end;

  if not coalesce(public.may_edit_notification_matrix(p_partner, p_agency), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  return query
  select t.notification_type, t.label, t.ord,
         c.recipient, c.label, c.ord,
         public.notification_enabled(v_kind, p_partner, p_agency, t.notification_type, c.recipient),
         not exists (select 1 from public.notification_settings s
                      where s.notification_type = t.notification_type
                        and s.recipient = c.recipient
                        and ((p_agency is not null and s.agency_id = p_agency)
                          or (p_agency is null and s.partner_id = p_partner))),
         public.notification_locked(v_kind, t.notification_type, c.recipient)
    from public.notification_types() t
    cross join public.notification_recipient_classes(v_kind) c
   order by t.ord, c.ord;
end $function$;

-- ===========================================================================
-- WHO MAY EDIT A PARTY'S MATRIX
-- ===========================================================================
-- "Opndoor admin can edit any party's matrix... an agency's directors can edit
-- their own agency's, no one else's." A Manager may not: the matrix decides who
-- is told what a referral earned, and rule 3 puts that at Director level.
create or replace function public.may_edit_notification_matrix(p_partner uuid, p_agency uuid)
returns boolean
language sql stable security definer set search_path to '' as $$
  select case
    when public.is_admin() then true
    -- A supplier's own people do not edit their matrix: the supplier rail has
    -- no Director level to hold the decision, so it stays with Opndoor.
    when p_agency is null then false
    else coalesce(public.may_see_commission(), false)
         and coalesce(public.app_may_reach_agency(p_agency), false)
  end
$$;

-- ===========================================================================
-- WRITING ONE CELL
-- ===========================================================================
create or replace function public.set_notification_setting(
  p_partner uuid, p_agency uuid, p_type text, p_recipient text, p_enabled boolean)
returns void
language plpgsql security definer set search_path to '' as $function$
declare v_kind text; v_old boolean; v_label text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if coalesce((p_partner is null) = (p_agency is null), true) then
    raise exception 'Name exactly one party: a supplier partner or an agency.' using errcode = '22023';
  end if;
  v_kind := case when p_agency is not null then 'agency' else 'supplier' end;

  if not coalesce(public.may_edit_notification_matrix(p_partner, p_agency), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  if not exists (select 1 from public.notification_types() t where t.notification_type = p_type) then
    raise exception 'There is no such notification.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.notification_recipient_classes(v_kind) c where c.recipient = p_recipient) then
    raise exception 'That recipient does not exist for this kind of party.' using errcode = '22023';
  end if;

  -- REFUSED, NOT IGNORED. A locked switch that silently accepts the write and
  -- keeps sending is worse than one that says no.
  if coalesce(public.notification_locked(v_kind, p_type, p_recipient), false) and p_enabled is distinct from true then
    raise exception 'Delivery of the executed deed to its recipient cannot be turned off.' using errcode = '42501';
  end if;

  v_old := public.notification_enabled(v_kind, p_partner, p_agency, p_type, p_recipient);

  insert into public.notification_settings (partner_id, agency_id, notification_type, recipient, enabled, updated_by)
  values (p_partner, p_agency, p_type, p_recipient, p_enabled, auth.uid())
  on conflict (coalesce(partner_id, agency_id), notification_type, recipient) do nothing;

  -- The two partial indexes cannot both be an ON CONFLICT target, so the
  -- upsert is done as an explicit update after the insert misses.
  update public.notification_settings
     set enabled = p_enabled, updated_at = now(), updated_by = auth.uid()
   where notification_type = p_type and recipient = p_recipient
     and ((p_agency is not null and agency_id = p_agency)
       or (p_agency is null and partner_id = p_partner));

  if v_old is distinct from p_enabled then
    select t.label into v_label from public.notification_types() t where t.notification_type = p_type;
    insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
    values (case when p_agency is not null then 'agency' else 'partner' end,
            coalesce(p_agency, p_partner),
            'notification_setting',
            coalesce(v_label, p_type) || ' to ' || p_recipient || ': '
              || case when p_enabled then 'on' else 'off' end,
            (select full_name from public.users where id = auth.uid()),
            auth.uid());
  end if;
end $function$;

-- ===========================================================================
-- GRANTS. Definer functions are service_role only unless the browser calls
-- them; these two are called from the screen, and the readers are called from
-- inside other functions and from the send path.
-- ===========================================================================
revoke all on function public.notification_types() from public, anon;
grant execute on function public.notification_types() to authenticated, service_role;
revoke all on function public.notification_recipient_classes(text) from public, anon;
grant execute on function public.notification_recipient_classes(text) to authenticated, service_role;
revoke all on function public.notification_default(text, text, text) from public, anon;
grant execute on function public.notification_default(text, text, text) to authenticated, service_role;
revoke all on function public.notification_locked(text, text, text) from public, anon;
grant execute on function public.notification_locked(text, text, text) to authenticated, service_role;
revoke all on function public.notification_party(uuid) from public, anon, authenticated;
grant execute on function public.notification_party(uuid) to service_role;
revoke all on function public.notification_enabled(text, uuid, uuid, text, text) from public, anon;
grant execute on function public.notification_enabled(text, uuid, uuid, text, text) to authenticated, service_role;
revoke all on function public.may_edit_notification_matrix(uuid, uuid) from public, anon;
grant execute on function public.may_edit_notification_matrix(uuid, uuid) to authenticated, service_role;
revoke all on function public.notification_matrix(uuid, uuid) from public, anon;
grant execute on function public.notification_matrix(uuid, uuid) to authenticated, service_role;
revoke all on function public.set_notification_setting(uuid, uuid, text, text, boolean) from public, anon;
grant execute on function public.set_notification_setting(uuid, uuid, text, text, boolean) to authenticated, service_role;

-- The table itself is reached only through those functions. No policy admits a
-- direct read or write, so the matrix cannot be edited around its own rules.
revoke all on table public.notification_settings from public, anon, authenticated;
grant select, insert, update, delete on table public.notification_settings to service_role;
