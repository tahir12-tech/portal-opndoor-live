-- ONE DEED GENERATION AT A TIME.
--
-- Two presses of Generate inside the generation window created TWO live, signable
-- Deeds of Guarantee for one application. The second stamped its id over the
-- first, leaving the first live in PandaDoc with nothing in the portal pointing at
-- it: a signable guarantee nobody is tracking.
--
-- The document-exists check added in 20261005260000 closes the SEQUENTIAL case,
-- where a document is already stamped when the second press arrives. It cannot
-- close the CONCURRENT one: both presses read "no document" before either has
-- created one. PandaDoc creation takes seconds, which is exactly the window a
-- person double-clicking a button occupies.
--
-- claim_tenancy_deed is not this guard. Only stripe-webhook claims, and the claim
-- is released on failure precisely so the next pass can retry, so it is a
-- one-deed-per-payment record rather than a mutual exclusion over the generation
-- call. The manual paths (pandadoc-resend, pandadoc-void-regenerate,
-- amend-tenancy-start) take nothing at all.
--
-- A LEASE, NOT A LOCK, and the difference is the failure mode. A lock held by a
-- crashed or timed-out run never releases and the application can never generate
-- again, which is the class of bug 20261005260000 exists to undo. This expires:
-- a lease older than the stale-after window is simply taken over.
--
-- Taken with a conditional UPDATE, which is atomic in one statement, so two
-- concurrent callers cannot both see it free. The loser is told no and stops.

alter table public.applications
  add column if not exists deed_generating_since timestamptz;

comment on column public.applications.deed_generating_since is
  'When a deed generation run took the lease on this application. Null when free. A lease older than the stale-after window is taken over, so a crashed run cannot lock an application out of ever generating.';

/* THE GRANT IS NOT OPTIONAL HERE. 20260811180000 took partner_rate and agent_rate
   off the applications table grant and re-granted every other column BY NAME, so
   the grant is a denylist and a column added later is unreadable by
   `authenticated` until a migration says otherwise. Skipping this step once
   already broke every staff dashboard with "permission denied for table
   applications", and applications_column_grants.test.sql exists to catch it. It
   caught this one.

   Granted rather than withheld because the denylist is a boundary that means
   exactly one thing: commission is not on the row, it is read through
   application_commission_rates. Adding an unrelated operational timestamp to that
   list would blur the only rule it states. There is nothing sensitive in knowing
   that a deed is being generated right now, and the deed card has a legitimate
   use for it: "preparing" is a truthful state that the card currently has to
   infer. */
grant select (deed_generating_since) on public.applications to authenticated;

create or replace function public.take_deed_lease(p_application uuid, p_stale_after interval default interval '5 minutes')
returns boolean
language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid;
begin
  /* One statement, so the read and the write cannot be separated by another
     caller. Postgres takes a row lock for the UPDATE, evaluates the WHERE against
     the committed row, and only one of two concurrent callers can match a NULL or
     stale lease. The loser matches nothing and gets false. */
  update public.applications
     set deed_generating_since = now()
   where id = p_application
     and (deed_generating_since is null
          or deed_generating_since < now() - p_stale_after)
   returning id into v_id;
  return v_id is not null;
end $function$;

comment on function public.take_deed_lease(uuid, interval) is
  'Take the exclusive right to run a deed generation for this application, for the stale-after window. False means another run holds it and this caller must stop: two presses of Generate inside the generation window otherwise create two live signable deeds.';

create or replace function public.release_deed_lease(p_application uuid)
returns void
language plpgsql security definer set search_path to ''
as $function$
begin
  update public.applications set deed_generating_since = null where id = p_application;
end $function$;

comment on function public.release_deed_lease(uuid) is
  'Release the deed generation lease, whether the run succeeded or failed. A failed run must release: a failure is retried (20261005260000), and holding the lease would make the retry wait out the stale-after window for nothing.';

revoke all on function public.take_deed_lease(uuid, interval) from public, anon, authenticated;
revoke all on function public.release_deed_lease(uuid) from public, anon, authenticated;
grant execute on function public.take_deed_lease(uuid, interval) to service_role;
grant execute on function public.release_deed_lease(uuid) to service_role;
