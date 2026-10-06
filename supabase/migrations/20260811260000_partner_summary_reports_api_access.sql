-- ===========================================================================
-- Let the Dev Centre REPORT api_access_enabled instead of being hidden by it.
--
-- WHY THIS EXISTS
-- The sidebar used to hide the Dev Centre when the caller's partner had
-- api_access_enabled = false. That flag defaults FALSE and is deliberately
-- never backfilled (20260811100000), so the condition was true for every
-- partner, and the developer role lost the only screen it exists for. The gate
-- also hid the door without locking it: the route guard is role-based, so
-- /dev-centre still rendered if you typed the URL.
--
-- The fix is to show the screen and tell the truth on it. That needs the flag
-- readable by the person looking at the screen, which is what this adds.
--
-- WHY NOT JUST READ public.partners FROM THE CLIENT
-- A developer can now select their own partner row (20260811190000), so this is
-- not about permission. It is about source: every other value on that screen
-- arrives through a dev_ RPC or this summary, and reading one field a second way
-- means two things that can disagree about the same partner. my_partner_summary
-- already exists for "the caller's partner, safe columns only" and was, until
-- now, never called by anything. This gives it the job it was written for.
--
-- IS api_access_enabled A SAFE COLUMN
-- Yes. The reason this function has an explicit column list is partner_rate and
-- agent_rate, which are commission and must never reach a developer. A boolean
-- saying whether your own employer may hold API keys is a fact about your own
-- integration. It is also already visible to this caller through partners_select.
--
-- RETURN TYPE CHANGES, SO DROP FIRST
-- create or replace refuses a changed return type with SQLSTATE 42P13. Adding a
-- column to a returns table() signature is a changed return type.
-- ===========================================================================

drop function if exists public.my_partner_summary();

create function public.my_partner_summary()
returns table (
  id                 uuid,
  slug               text,
  name               text,
  status             text,
  referencing_mode   text,
  api_access_enabled boolean
)
language sql stable security definer set search_path to '' as $$
  select p.id, p.slug, p.name, p.status, p.referencing_mode, p.api_access_enabled
  from public.partners p
  where p.id = public.app_partner() and public.is_aal2()
$$;

comment on function public.my_partner_summary() is
  'The caller partner, safe columns only. Never add partner_rate or agent_rate here: this is reachable by developers, and commission is not. api_access_enabled is included so the Dev Centre can report that API access is off rather than being hidden when it is, which is what the sidebar used to do to every developer.';

revoke all on function public.my_partner_summary() from public, anon;
grant execute on function public.my_partner_summary() to authenticated;

-- ---------------------------------------------------------------------------
-- The admin-side equivalent, so the same notice works on the same screen when
-- an opndoor admin has a partner selected. Without this the notice would appear
-- for a developer and silently not for an admin looking at the same partner,
-- which is the kind of difference that gets read as a bug in the flag.
-- ---------------------------------------------------------------------------
drop function if exists public.dev_partner_options();

create function public.dev_partner_options()
returns table (
  id                 uuid,
  slug               text,
  name               text,
  referencing_mode   text,
  api_access_enabled boolean
)
language sql stable security definer set search_path to '' as $$
  select p.id, p.slug, p.name, p.referencing_mode, p.api_access_enabled
  from public.partners p
  where public.is_aal2() and public.is_admin()
  order by p.name;
$$;

revoke all on function public.dev_partner_options() from public, anon;
grant execute on function public.dev_partner_options() to authenticated;

-- ---------------------------------------------------------------------------
-- Assert the contract the client renders against. A dropped or renamed column
-- here is invisible at run time: PostgREST returns whatever the function
-- declares and React renders undefined as empty, so a mistake looks like a
-- partner with API access rather than an error. This is the same failure that
-- dev_webhook_deliveries hit earlier in this branch.
-- ---------------------------------------------------------------------------
do $$
declare
  missing text;
begin
  select string_agg(want.fn || '.' || want.col, ', ')
    into missing
  from (
    values
      ('my_partner_summary', 'api_access_enabled'),
      ('my_partner_summary', 'referencing_mode'),
      ('dev_partner_options', 'api_access_enabled'),
      ('dev_partner_options', 'slug')
  ) as want(fn, col)
  where not exists (
    select 1
    from information_schema.routines r
    join information_schema.parameters pm
      on pm.specific_name = r.specific_name
    where r.routine_schema = 'public'
      and r.routine_name = want.fn
      and pm.parameter_mode = 'OUT'
      and pm.parameter_name = want.col
  );

  if missing is not null then
    raise exception 'Dev Centre partner contract is missing: %', missing;
  end if;
end $$;
