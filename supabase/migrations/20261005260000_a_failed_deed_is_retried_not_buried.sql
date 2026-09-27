-- A FAILED DEED IS RETRIED, NOT BURIED.
--
-- RULING. deed_state = 'error' does not block a retry. The next automatic pass
-- retries it, and Generate on the application retries it for any user who can see
-- the card. After three consecutive failures the application parks as
-- needs-attention for staff with the last error shown. Voided and declined stay
-- terminal. Neither rail's recovery may require an admin void or a database edit.
--
-- WHAT IT WAS. claim_tenancy_deed refused on ANY non-null deed_state:
--
--   if v_doc is not null or v_state is not null then return false; end if;
--
-- and the error branches set deed_state = 'error'. So a transient RPC blip, which
-- is exactly what the recent error handling was added to catch, put the row in a
-- state no automatic pass could ever claim again. The only thing that clears
-- deed_state is pandadoc-void-regenerate, which is admin only. A blip became a
-- permanent dead end, and the message it wrote said "retry once the database is
-- answering" to a reader for whom retrying was impossible.
--
-- THE TWO SEQUENCES THIS HAS TO MAKE WORK, from the live portal, neither of which
-- may need an admin or SQL:
--
--   SUPPLIER: the branch has no agent contact, payment lands, generation fails.
--   Staff add the contact email and click Generate. The deed generates and
--   delivers to that email.
--
--   AGENCY: the agency has no active person, generation parks. A manager accepts
--   their invite. Generate delivers to them.
--
-- Both are "the recipient did not exist yet, and now does". The failure is a fact
-- about the world at one moment, not a property of the application, so nothing
-- about it should be permanent.
--
-- THREE ATTEMPTS, AND PARKING IS VISIBILITY, NOT A LOCK. At three consecutive
-- failures the row sets awaiting_staff_send, which is what the needs-attention
-- surface reads, and keeps the last error for the card to show. It does NOT stop
-- Generate: the whole point of the two sequences above is that fixing the cause
-- and pressing the button works, and a lock at three would send exactly those
-- cases to an admin for a void. Parking says "a person should look at this", which
-- after three failures is true.

alter table public.applications
  add column if not exists deed_attempts integer not null default 0,
  add column if not exists deed_last_error text;

comment on column public.applications.deed_attempts is
  'Consecutive failed deed generation attempts. Reset to 0 the moment a document is produced. At 3 the application parks as needs-attention; it is never a lock on retrying.';
comment on column public.applications.deed_last_error is
  'Why the last generation attempt failed, for the card and the needs-attention queue. Cleared when a document is produced.';

-- The client reads both on the application detail card.
grant select (deed_attempts, deed_last_error) on public.applications to authenticated;

-- ---------------------------------------------------------------------------
-- THE CLAIM, WHICH IS STILL ONE DOCUMENT PER APPLICATION.
--
-- Lifted verbatim from 20261005110000 and changed in exactly one place: the
-- refusal. A document that EXISTS still refuses, which is the guarantee that a
-- transient failure followed by a healthy pass produces exactly one document.
-- Voided and declined still refuse, because those are decisions rather than
-- failures and a human has to say what happens next. 'error' no longer refuses.
--
-- The claim ROW is the other half of the one-shot guard and is unchanged: a
-- second concurrent delivery of the same event still loses the insert race. The
-- caller releases it on failure (stripe-webhook does), which is what lets the
-- next pass claim at all.
-- ---------------------------------------------------------------------------
create or replace function public.claim_tenancy_deed(p_application uuid)
returns boolean
language plpgsql security definer set search_path to ''
as $function$
declare v_doc text; v_state text;
begin
  select pandadoc_document_id, deed_state into v_doc, v_state
    from public.applications where id = p_application;
  if not found then return false; end if;
  -- A deed already exists: never make a second one.
  if v_doc is not null then return false; end if;
  -- Terminal states a human must resolve. 'error' is deliberately NOT here:
  -- a failure is retried, and after three the row parks for staff.
  if v_state in ('voided', 'declined', 'executed') then return false; end if;

  insert into public.tenancy_deed_claims (lead_application_id) values (p_application)
  on conflict (lead_application_id) do nothing;
  return found;
end $function$;

comment on function public.claim_tenancy_deed(uuid) is
  'Claim the right to generate THIS application''s deed. Refuses when a document already exists, which is the one-document guarantee, and on the terminal states voided, declined and executed. A previous failure (deed_state error) does NOT refuse: it is retried by the next pass and by Generate.';

-- ---------------------------------------------------------------------------
-- RECORDING AN ATTEMPT, so the count is kept in one place rather than by each
-- caller remembering to increment it.
-- ---------------------------------------------------------------------------
create or replace function public.record_deed_failure(p_application uuid, p_error text)
returns integer
language plpgsql security definer set search_path to ''
as $function$
declare v_attempts integer;
begin
  update public.applications
     set deed_state = 'error',
         deed_attempts = coalesce(deed_attempts, 0) + 1,
         deed_last_error = left(coalesce(p_error, ''), 500),
         -- Parking is visibility. At three consecutive failures a person should
         -- look at this, and the needs-attention surface reads this flag.
         awaiting_staff_send = (coalesce(deed_attempts, 0) + 1) >= 3
     where id = p_application
     returning deed_attempts into v_attempts;
  return coalesce(v_attempts, 0);
end $function$;

comment on function public.record_deed_failure(uuid, text) is
  'Record one failed deed generation: error state, the reason, and the consecutive count. Parks the application as needs-attention at three. Never blocks a retry.';

-- And the other side: a document exists, so the run of failures is over.
create or replace function public.clear_deed_failures(p_application uuid)
returns void
language plpgsql security definer set search_path to ''
as $function$
begin
  update public.applications
     set deed_attempts = 0, deed_last_error = null, awaiting_staff_send = false
   where id = p_application;
end $function$;

comment on function public.clear_deed_failures(uuid) is
  'A deed was produced, so the consecutive-failure run ends and the row leaves the needs-attention queue.';

revoke all on function public.record_deed_failure(uuid, text) from public, anon, authenticated;
revoke all on function public.clear_deed_failures(uuid) from public, anon, authenticated;
grant execute on function public.record_deed_failure(uuid, text) to service_role;
grant execute on function public.clear_deed_failures(uuid) to service_role;
