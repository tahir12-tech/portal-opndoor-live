-- ===========================================================================
-- NOTES ARE OPNDOOR'S, AND SO ARE THE TENANT'S OWN FILES.
--
-- Matt, 2026-10-01, verbatim: "Notes are Opndoor-only: hide the Notes section
-- entirely from agency and supplier users, and check they can't read notes
-- through any other route."
--
-- ===========================================================================
-- THE OTHER ROUTE IS THE TABLE, AND IT WAS OPEN
-- ===========================================================================
--
-- The screen's rule was `role === 'superadmin' || role === 'management' ||
-- (role === 'referrer' && owner)`, and `management` is the role an agency
-- Director, an agency Manager and a supplier Management user all hold: the
-- level vocabulary is shared across the rails. So the section was not hidden
-- from them at all, which is what Matt saw.
--
-- Behind it, `app_notes_select` read:
--
--   application_id in (select id from applications)
--
-- which is "any note on any application you can see". The browser reads the
-- TABLE -- notesService selects from app_notes directly -- so that policy was
-- the whole boundary, and a role check on the page is not a boundary at all.
-- The answer to "can they read notes through any other route" was yes: any
-- client holding their own session could.
--
-- And `add_application_note` let the same people WRITE one, so an agency
-- Manager could add to Opndoor's internal record of their own referral.
--
-- ===========================================================================
-- THE TENANT'S UPLOADS WERE THE SAME POLICY, ONE TABLE OVER
-- ===========================================================================
--
-- Found while checking the first: `application_documents_select` is the same
-- sentence, and the Application detail page reads it one line below the notes
-- with `role === 'superadmin' || role === 'management'`. Those rows are the
-- tenant's bank statements, proof of address, P60 and tax return, collected
-- for the guarantee decision Opndoor makes -- the page's own comment says so.
--
-- It is not only the index row. `application-document-url` signs the file
-- with the service key and says in terms that "the user-scoped read IS the
-- authorisation", so whoever the policy admits can download the PDF. Closing
-- the policy closes the endpoint with it, and the function needs no change.
--
-- BY BUCKET, NOT BY TABLE. Only the tenant's own uploads are Opndoor's: a
-- deed or a statement landing in this table later must not be locked away
-- from the agency that is owed it. `applicant-docs` is the bucket the
-- applicant's files go in and the only one in the column today, so the rule
-- names it rather than taking the whole table.
--
-- NO DATA MOVES. dev holds no notes at all, and every application_documents
-- row is an applicant upload in applicant-docs.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. READING A NOTE
-- ---------------------------------------------------------------------------
drop policy if exists app_notes_select on public.app_notes;
create policy app_notes_select on public.app_notes
  for select to authenticated
  using (coalesce(public.is_opndoor_staff(), false));

comment on table public.app_notes is
  'Opndoor''s own operational notes on an application. Readable and writable by Opndoor staff only: the level words "management" and "referrer" are held by agency and supplier users too, so a role test is not a boundary here and the policy names the estate instead.';

-- ---------------------------------------------------------------------------
-- 2. WRITING ONE
-- ---------------------------------------------------------------------------
-- Regenerated from 20261006470000, the latest definition, by hand and in full,
-- with ONE change: who may call it. The MFA check, the lookup, the trim, the
-- 2000-character cap and the author stamp are unchanged.
create or replace function public.add_application_note(p_ref text, p_body text)
returns public.app_notes
language plpgsql
security definer
set search_path to ''
as $function$
declare a public.applications; b text; n public.app_notes;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where guarantee_ref = p_ref;
  if not coalesce(found, false) then raise exception 'application not found'; end if;
  /* OPNDOOR'S OWN RECORD. It used to admit an agency Management user on the
     application's own branch, and the referrer who owned it, which is the
     rest of the product's rule and the wrong one for this table. */
  if not coalesce(public.is_opndoor_staff(), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  b := btrim(coalesce(p_body, ''));
  if b = '' then raise exception 'A note cannot be empty.' using errcode = '22023'; end if;
  insert into public.app_notes(application_id, body, author, author_id)
  values (a.id, left(b, 2000), (select full_name from public.users where id = auth.uid()), auth.uid())
  returning * into n;
  return n;
end $function$;

revoke all on function public.add_application_note(text, text) from public, anon;
grant execute on function public.add_application_note(text, text) to authenticated, service_role;

comment on function public.add_application_note(text, text) is
  'Append one note to Opndoor''s internal record of an application. Opndoor staff only, behind MFA: the notes are not shared with the agency, the supplier or the tenant, and nothing outside this function writes the table.';

-- ---------------------------------------------------------------------------
-- 3. THE TENANT'S UPLOADED FILES
-- ---------------------------------------------------------------------------
drop policy if exists application_documents_select on public.application_documents;
create policy application_documents_select on public.application_documents
  for select to authenticated
  using (
    case
      when bucket = 'applicant-docs' then coalesce(public.is_opndoor_staff(), false)
      else exists (select 1 from public.applications a where a.id = application_documents.application_id)
    end
  );

comment on table public.application_documents is
  'Files attached to an application. Anything in applicant-docs is the tenant''s own upload, collected for the guarantee decision Opndoor makes, and is readable by Opndoor staff only -- which is also what stops application-document-url signing it for anybody else, since that endpoint treats the user-scoped read as the authorisation. Rows in any other bucket keep the application''s own reach.';
