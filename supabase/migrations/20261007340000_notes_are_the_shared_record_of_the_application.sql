-- ===========================================================================
-- NOTES ARE THE SHARED RECORD OF THE APPLICATION.
--
-- Matt, 2026-10-01, verbatim, correcting 20261007330000 which corrected
-- 20261007310000: "Notes: also share them with the agency that referred the
-- application (e.g. Regent's staff), on the same terms as suppliers: anyone
-- who can see the application reads and adds notes, each showing who wrote
-- it. Tenants and other partners never see them."
--
-- ===========================================================================
-- THE RULE IS NOW ONE SENTENCE, AND IT IS THE APPLICATION'S OWN
-- ===========================================================================
--
-- Three versions in one evening, and the third is the simplest: the people
-- who may read an application may read its notes, and may add one. No rail
-- test, no role test, no list of levels. `applications_select` already says
-- who those people are, and it is the sentence every other surface on this
-- page is built from, so the notes stop having a boundary of their own to
-- drift away from.
--
-- WHAT "TENANTS NEVER SEE THEM" RESTS ON, measured rather than assumed:
-- `applications` carries no tenant arm. Its policies admit is_admin(),
-- opndoor_manager, a referrer on their own, and management or developer on
-- their partner through app_may_reach_application_org -- all of which read
-- `public.users`, and a tenant has no row there (45 auth users on dev, 20
-- with a profile; the other 25 are tenants). app_role() returns '' for them
-- and every arm is false. The tenant platform reads through its own definer
-- RPCs, and none of them touches app_notes.
--
-- "OTHER PARTNERS NEVER SEE THEM" is the same sentence from the other side:
-- an application they cannot see has no notes they can read.
--
-- ===========================================================================
-- WHY THE WRITE STOPS BEING A DEFINER FUNCTION
-- ===========================================================================
--
-- add_application_note ran as its owner and re-derived who may write by
-- hand: is_admin(), or management on the partner, or the owning referrer.
-- That list has been wrong twice today, in both directions, because it is a
-- second copy of a rule that already exists.
--
-- So the write is now the same sentence as the read: an INSERT policy with
-- the same test, and the function runs as the CALLER, so resolving the
-- application is itself the permission check. A caller who cannot see it
-- gets "application not found", which is the honest answer and the one RLS
-- gives everywhere else.
--
-- AND THE AUTHOR IS STAMPED BY A TRIGGER, not by the function, because the
-- insert policy makes a direct insert possible and "each showing who wrote
-- it" must be true however the row arrived. The trigger overwrites both
-- author columns from auth.uid() and trims the body, so the function and a
-- hand-written insert produce the same row.
--
-- 20261007330000's is_supplier_partner is dropped with the rule that needed
-- it. It was an hour old and had one caller; leaving a predicate behind for
-- a rule that no longer exists is how the next person finds a sentence that
-- looks load-bearing and is not.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. READING, AND NOW WRITING, ON THE SAME TEST
-- ---------------------------------------------------------------------------
drop policy if exists app_notes_select on public.app_notes;
create policy app_notes_select on public.app_notes
  for select to authenticated
  using (application_id in (select id from public.applications));

drop policy if exists app_notes_insert on public.app_notes;
create policy app_notes_insert on public.app_notes
  for insert to authenticated
  with check (
    application_id in (select id from public.applications)
    /* Belt as well as braces: the trigger below stamps the author, and this
       refuses a row that arrives claiming to be somebody else even if the
       trigger is ever dropped. */
    and author_id = auth.uid()
  );

-- No update and no delete policy, which is how this table has always been
-- append-only. A correction is another note.

comment on table public.app_notes is
  'The working record of an application, shared by everyone who can see it: Opndoor, the supplier that referred it, and the agency that referred it. Readable and writable on exactly the test that admits them to the application itself, so the notes have no boundary of their own to drift from. Tenants have no row in public.users and no arm on applications, so no tenant session reaches a note.';

-- ---------------------------------------------------------------------------
-- 2. WHO WROTE IT IS NOT THE WRITER'S TO SAY
-- ---------------------------------------------------------------------------
create or replace function public.stamp_app_note()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
begin
  new.author_id := auth.uid();
  new.author    := (select u.full_name from public.users u where u.id = auth.uid());
  new.body      := left(btrim(coalesce(new.body, '')), 2000);
  if new.body = '' then
    raise exception 'A note cannot be empty.' using errcode = '22023';
  end if;
  return new;
end $function$;

revoke all on function public.stamp_app_note() from public, anon, authenticated;

drop trigger if exists trg_stamp_app_note on public.app_notes;
create trigger trg_stamp_app_note
  before insert on public.app_notes
  for each row execute function public.stamp_app_note();

comment on function public.stamp_app_note() is
  'Stamp a note with its author and trim its body, whichever door it came through. "Each showing who wrote it" is a promise the display cannot keep on its own: the insert policy allows a direct write, so the name is taken from auth.uid() here rather than from what the caller sent.';

-- ---------------------------------------------------------------------------
-- 3. THE RPC RUNS AS THE CALLER
-- ---------------------------------------------------------------------------
drop function if exists public.add_application_note(text, text);

create or replace function public.add_application_note(p_ref text, p_body text)
returns public.app_notes
language plpgsql
/* INVOKER, which is the change. Resolving the application below is RLS'd to
   the caller, so it IS the permission check, and the insert then meets the
   policy or does not. Nothing here re-states who may write. */
security invoker
set search_path to ''
as $function$
declare v_app uuid; n public.app_notes;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select a.id into v_app from public.applications a where a.guarantee_ref = p_ref;
  if v_app is null then raise exception 'application not found'; end if;
  if btrim(coalesce(p_body, '')) = '' then
    raise exception 'A note cannot be empty.' using errcode = '22023';
  end if;
  /* author and author_id are set by the trigger; sending them here would be
     two places deciding one thing. */
  insert into public.app_notes(application_id, body, author_id)
  values (v_app, p_body, auth.uid())
  returning * into n;
  return n;
end $function$;

revoke all on function public.add_application_note(text, text) from public, anon;
grant execute on function public.add_application_note(text, text) to authenticated, service_role;

comment on function public.add_application_note(text, text) is
  'Add one note to an application''s shared record. Runs as the caller: if they cannot see the application they cannot resolve it, and the insert policy is the same test again. The author is stamped by trg_stamp_app_note, not by the caller.';

-- ---------------------------------------------------------------------------
-- 4. AND THE PREDICATE THAT ONLY THE SUPERSEDED RULE NEEDED
-- ---------------------------------------------------------------------------
drop function if exists public.is_supplier_partner(uuid);
