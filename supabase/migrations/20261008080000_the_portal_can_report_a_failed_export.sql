-- THE PORTAL CAN REPORT A FAILED EXPORT.
--
-- Matt, 2026-10-04: "Find the actual error (log it to the console and
-- Health's portal errors), fix it".
--
-- Test: supabase/tests/the_portal_can_report_an_incident.test.sql (extended)
--
-- 20261008020000 gave the browser ONE door with a fixed allowlist of one
-- type, deliberately: the alert text is built in the function so a signed-in
-- caller cannot put their own words in front of whoever reads an operational
-- alert. A second kind of incident is therefore a migration and a review,
-- which is the design working rather than friction.
--
-- THE SECOND ARGUMENT STOPS BEING A MONTH, AND IS STILL NOT FREE TEXT. A
-- failed export has no month; what it has is WHICH export. Both are
-- validated per type and neither reaches the alert as the caller sent it:
--
--   portal_statement_reference_unreadable   p_context is YYYY-MM
--   portal_export_failed                    p_context is one of a fixed
--                                           list of export names
--
-- SO THE SAFETY PROPERTY IS UNCHANGED: a caller picks from two closed sets
-- and the sentence is written here.

/* DROPPED FIRST: the parameter is renamed from p_month to p_context, and
   Postgres will not rename an argument through CREATE OR REPLACE. */
drop function if exists public.report_portal_incident(text, text);

create or replace function public.report_portal_incident(p_type text, p_context text)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare v_detail text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  if p_type is null or p_type not in (
       'portal_statement_reference_unreadable',
       'portal_export_failed') then
    raise exception 'Unknown portal incident type.' using errcode = '22023';
  end if;

  if p_type = 'portal_statement_reference_unreadable' then
    if p_context is null or p_context !~ '^[0-9]{4}-[0-9]{2}$' then
      raise exception 'A month is YYYY-MM.' using errcode = '22023';
    end if;
    v_detail := 'The portal could not read the statement reference for ' || p_context
      || '. Shown to the reader as unavailable rather than as a draft.';
  else
    /* THE EXPORT'S NAME FROM A FIXED LIST, so Health says WHICH download is
       failing without the browser choosing the words. */
    if p_context is null or p_context not in
       ('application', 'performance', 'expiries', 'statement', 'league') then
      raise exception 'Unknown export.' using errcode = '22023';
    end if;
    v_detail := 'The portal could not build the ' || p_context
      || ' export for a reader. They were shown a message and no file. The'
      || ' browser console carries the error.';
  end if;

  perform public.report_ops_incident(p_type, v_detail, null);
end $function$;

revoke all on function public.report_portal_incident(text, text) from public, anon;
grant execute on function public.report_portal_incident(text, text) to authenticated, service_role;

comment on function public.report_portal_incident(text, text) is
  'The browser reporting that it could not do something it needed to. Both the type and the context come from fixed lists and the alert text is built here, never passed in, so a signed-in caller cannot invent a type or put their own words into an operational alert.';
