-- TWO DIFFERENT THINGS WERE CALLED "DELIVERY FAILED".
--
-- Rosa opened the Delivery failed filter on her own book and it showed her a
-- deed that had delivered perfectly well. Three separate faults met on that one
-- row, and they are worth naming because only the third is a UI bug.
--
-- ONE. The filter never read a delivery state. It is a client-side proxy:
--
--     status = 'deed' AND contactForApplication(agency, branch) has no contact
--
-- which asks the SUPPLIER rail's question. An agency of ours delivers to the
-- org's active PEOPLE through deed_people_target, not to an agent_contacts
-- mailbox, and Regent has no mailbox at all, so every Regent deed answered
-- "failed" whatever actually happened. awaiting_staff_send — the real,
-- filterable flag, added by 20260925150000 precisely because the activity row
-- was not queryable — is granted to authenticated and has never been selected by
-- the client. Not once, anywhere in src.
--
-- TWO. "Cannot deliver" and "delivery failed" are not the same event and cannot
-- share a flag:
--
--   CANNOT DELIVER  no resolvable recipient on the rail's own ladder. Nothing
--                   was sent, nothing errored, and there is nothing for the
--                   agency to do about it. It parks for a staff send, and it is
--                   an OPS state: admin-facing only.
--   DELIVERY FAILED a send was ATTEMPTED and errored or bounced. There is an
--                   address it went to and a reason it did not arrive. The
--                   agency sees this one, because the agency is who is waiting
--                   for it and who can press Resend.
--
-- awaiting_staff_send already means the first. This adds the second, alongside
-- rather than inside it, for the same reason that one is not part of deed_state:
-- the deed really is executed, and an attempt that errored is not the same fact
-- as a queue.
--
-- THREE. Nothing recorded WHERE delivery was attempted. The success path writes
-- the address into free text ("Deed sent to {email}"); the failure path records
-- no address, no ladder rung and no error. A panel that says where it went had
-- nothing to read, which is why there was no panel.
--
-- BOUNCES ARE STILL NOT DETECTED, and this migration does not pretend otherwise.
-- The only occurrence of the word "bounce" in the whole tree is an aspirational
-- comment in the PandaDoc webhook; there is no provider bounce webhook and
-- nothing consumes one. These columns are shaped to receive a bounce the day one
-- is wired up — delivery_failed_at with a reason of 'bounced' — and until then
-- "failed" means the provider refused the send.

alter table public.applications
  add column if not exists delivery_failed_at    timestamptz,
  add column if not exists delivery_attempted_to text,
  add column if not exists delivery_source       text,
  add column if not exists delivery_reason       text;

comment on column public.applications.delivery_failed_at is
  'When a delivery ATTEMPT last errored. Null means no attempt has ever failed, which is not the same as never attempted (deed_sent_at) or nobody to attempt to (awaiting_staff_send).';
comment on column public.applications.delivery_attempted_to is
  'The address the last attempt went to, successful or not, so a screen can say where the deed went without re-resolving a ladder that may since have changed.';
comment on column public.applications.delivery_source is
  'Which rung of the ladder supplied that address: org_person, delivery_contact, route_contact, branch_contact, or explicit for a one-off staff send.';
comment on column public.applications.delivery_reason is
  'Why the last attempt failed, in the provider''s terms. Distinct from awaiting_staff_send, which means there was nobody to attempt to.';

create index if not exists applications_delivery_failed_idx
  on public.applications (delivery_failed_at)
  where delivery_failed_at is not null;

-- applications is COLUMN-GRANTED to authenticated: partner_rate and agent_rate
-- were taken off the grant entirely (20260815030000) because narrowing a select
-- string is not enforcement. A new column therefore has to be granted
-- explicitly, or the screen that needs it silently reads null.
-- applications_column_grants.test.sql is what catches the omission.
grant select (delivery_failed_at, delivery_attempted_to, delivery_source, delivery_reason)
  on public.applications to authenticated;

-- ---------------------------------------------------------------------------
-- RECORDING AN ATTEMPT. Service-role: this is the delivery path writing down
-- what it just did, not a user action.
-- ---------------------------------------------------------------------------
create or replace function public.record_delivery_attempt(
  p_app uuid, p_ok boolean, p_to text, p_source text, p_reason text default null
)
returns void
language plpgsql security definer set search_path to ''
as $function$
begin
  if p_ok then
    -- A success CLEARS the failure and the queue both. The address is kept: it
    -- is the answer to "where did it go", which is asked far more often than
    -- "why did it not".
    update public.applications
       set delivery_attempted_to = p_to,
           delivery_source       = p_source,
           delivery_failed_at    = null,
           delivery_reason       = null,
           awaiting_staff_send   = false
     where id = p_app;
  else
    update public.applications
       set delivery_attempted_to = coalesce(p_to, delivery_attempted_to),
           delivery_source       = coalesce(p_source, delivery_source),
           delivery_failed_at    = now(),
           delivery_reason       = p_reason
     where id = p_app;
  end if;
end $function$;

comment on function public.record_delivery_attempt(uuid, boolean, text, text, text) is
  'Write down a delivery attempt and its outcome. Success clears the failure and the staff-send queue; failure stamps the time and the reason and keeps the address. Called by the delivery path, never by a screen.';

revoke all on function public.record_delivery_attempt(uuid, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.record_delivery_attempt(uuid, boolean, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- WHERE WOULD IT GO, AND WHERE DID IT GO. For the screen.
--
-- deed_delivery_target is service_role only and must stay that way: it resolves
-- an address for any application it is handed. This is the caller-scoped
-- wrapper, which answers only for an application the caller can already see —
-- the same permission rule send_deed_to_agent enforces, so anybody who can read
-- the panel can press the button on it, and nobody else.
-- ---------------------------------------------------------------------------
create or replace function public.my_application_delivery(p_app uuid)
returns table (
  state text, to_email text, to_name text, source text, auto_send boolean,
  attempted_to text, attempted_source text, failed_at timestamptz, reason text,
  sent_at timestamptz, held boolean
)
language plpgsql stable security definer set search_path to ''
as $function$
declare a public.applications; r text; owned boolean;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where id = p_app;
  if not found then return; end if;
  r := public.app_role();
  owned := a.referrer_id = auth.uid();
  if not (public.is_admin()
          or r = 'opndoor_manager'
          or (r in ('management','referrer','developer') and a.partner_id = public.app_partner()
              and (not public.app_has_scope() or a.branch_id in (select public.app_scope_branches())))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  -- `owned` is read so a referrer's own application is reachable even where a
  -- scope would not otherwise admit it; the branch test above already covers
  -- the common case.
  if r = 'referrer' and not owned and not public.is_admin() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  return query
  select
    case
      -- Order matters and is the whole point of the migration. A row that
      -- errored is FAILED even though it is also queued; a row with nobody to
      -- send to is HELD and was never attempted; a row with neither is simply
      -- not attempted yet, which is not a problem.
      when a.delivery_failed_at is not null then 'failed'
      when a.awaiting_staff_send            then 'cannot_deliver'
      when a.deed_sent_at is not null       then 'delivered'
      else 'not_attempted'
    end,
    t.email, t.display_name, t.source, t.auto_send,
    a.delivery_attempted_to, a.delivery_source, a.delivery_failed_at, a.delivery_reason,
    a.deed_sent_at, a.awaiting_staff_send
  from (select 1) one
  left join lateral public.deed_delivery_target(p_app) t on true;
end $function$;

comment on function public.my_application_delivery(uuid) is
  'Where this application''s deed would be delivered and what happened to the last attempt, for an application the caller can already see. The caller-scoped face of deed_delivery_target, which stays service-role because it resolves an address for anything it is handed.';

revoke all on function public.my_application_delivery(uuid) from public, anon;
grant execute on function public.my_application_delivery(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- NO BACKFILL, DELIBERATELY.
--
-- Every existing deed_delivery_failed activity row was written by the path that
-- ALSO sets awaiting_staff_send, i.e. it is a "cannot deliver", not an errored
-- send. Stamping delivery_failed_at from those rows would relabel a queue of
-- undeliverable deeds as a list of failures and put a Resend button in front of
-- an agency for a send that was never attempted. The new column starts empty and
-- fills from real attempts.
-- ---------------------------------------------------------------------------
