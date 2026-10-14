/* =====================================================================
   THE INCIDENT THAT WAS SUPPOSED TO SAY WHY, AND NEVER FIRED.

   Matt, 2026-10-05, item 3: "(cp) draft-month 'Reference couldn't be
   loaded' and the export filename; find the real error, don't hide it."

   THE REAL ERROR IS THAT THE REPORT ITSELF WAS BROKEN. (cp) was built
   on 2026-10-04 with a Health report attached, exactly so that a real
   load failure could be told apart from an imaginary one. Two hours
   later 20261008080000 added export failures to the same function, and
   to do it renamed the second argument from `p_month` to `p_context`.
   It updated the export call site. It did not update the statement one,
   which still sends `p_month`.

   PostgREST resolves an RPC by its ARGUMENT NAMES, so since that
   migration the call has resolved to no function at all: every
   unreadable reference since has reported PGRST202 to the browser
   console and NOTHING to Health. The one mechanism built to find this
   error has been unable to report it for as long as it has existed.
   The client fix is in the same commit.

   AND NOW IT CARRIES THE CODE. Knowing a read failed in October is not
   knowing why. The caller may pass the error code it was handed, which
   is what separates a dropped connection (PGRST301, a 5xx) from a
   refusal (42501) from a bad argument (22023) -- three very different
   faults rendering as one sentence today.

   THE CODE IS NOT FREE TEXT, which is the rule this function already
   lives by: nothing from a browser reaches a human-read operational
   alert. A code is at most twelve characters of letters, digits and
   underscores, so it can carry 'PGRST202' or '42501' and cannot carry
   a sentence, a name or an address. Anything else is refused outright
   rather than sanitised, because a caller sending something unexpected
   is itself news.
   ===================================================================== */

/* DROPPED FIRST: a default cannot be added to an existing signature with
   CREATE OR REPLACE, and leaving the two-argument form in place as an
   overload would make every PostgREST call ambiguous. One function. */
drop function if exists public.report_portal_incident(text, text);

create or replace function public.report_portal_incident(
  p_type text, p_context text, p_code text default null)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare v_detail text; v_why text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  if p_type is null or p_type not in (
       'portal_statement_reference_unreadable',
       'portal_export_failed') then
    raise exception 'Unknown portal incident type.' using errcode = '22023';
  end if;

  /* THE CODE, OR NOTHING. An empty string is treated as absent, because
     that is what a client with no code to hand will send. */
  if p_code is not null and p_code <> '' then
    if p_code !~ '^[A-Za-z0-9_]{1,12}$' then
      raise exception 'An error code is up to twelve letters, digits or underscores.'
        using errcode = '22023';
    end if;
    v_why := ' The error was ' || p_code || '.';
  else
    v_why := ' No error code reached the report.';
  end if;

  if p_type = 'portal_statement_reference_unreadable' then
    if p_context is null or p_context !~ '^[0-9]{4}-[0-9]{2}$' then
      raise exception 'A month is YYYY-MM.' using errcode = '22023';
    end if;
    v_detail := 'The portal could not read the statement reference for ' || p_context
      || '. Shown to the reader as unavailable rather than as a draft.' || v_why;
  else
    /* THE EXPORT'S NAME FROM A FIXED LIST, so Health says WHICH download is
       failing without the browser choosing the words. */
    if p_context is null or p_context not in
       ('application', 'performance', 'expiries', 'statement', 'league') then
      raise exception 'Unknown export.' using errcode = '22023';
    end if;
    v_detail := 'The portal could not build the ' || p_context
      || ' export for a reader. They were shown a message and no file.' || v_why;
  end if;

  perform public.report_ops_incident(p_type, v_detail, null);
end $function$;

revoke all on function public.report_portal_incident(text, text, text) from public, anon;
grant execute on function public.report_portal_incident(text, text, text) to authenticated, service_role;

comment on function public.report_portal_incident(text, text, text) is
  'The browser reporting that it could not do something it needed to. The type and the context come from fixed lists and the alert text is built here, never passed in. The optional code is the error the browser was handed, up to twelve characters of letters, digits and underscores, so a dropped connection can be told from a refusal without any browser text reaching the alert.';
