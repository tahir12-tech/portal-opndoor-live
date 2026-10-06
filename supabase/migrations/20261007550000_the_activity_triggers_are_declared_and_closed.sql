-- ===========================================================================
-- TWO THINGS 20261007490000 GOT WRONG, BOTH FOUND BY `npm run drift`.
--
-- 1. THE TRIGGER FUNCTIONS WERE BORN OPEN. Postgres grants EXECUTE to
--    PUBLIC on every new function, and neither touch_draft_activity nor
--    touch_parent_draft_activity said `revoke`. Both are SECURITY DEFINER,
--    so anon and authenticated could call them directly -- which is
--    exactly the fault definer_grants.test.sql exists to catch, and its
--    first assertion (zero definer functions executable by anon) would
--    have failed on the next run. The drift check got there first.
--
--    A trigger function needs no EXECUTE grant to anybody: the trigger
--    fires it, not the caller. service_role is granted for symmetry with
--    every other function in this schema and because a migration running
--    as postgres must be able to replace it.
--
-- 2. THE FIVE CHILD TRIGGERS WERE CREATED IN A LOOP. A `do $$ ... execute
--    format('create trigger ...') $$` block creates them perfectly well
--    and leaves nothing for a reader -- or for the drift check, which
--    parses the migration files -- to see. Five triggers appeared "on
--    dev, not in the files", which is precisely the state the drift check
--    exists to stop, however correct the database happened to be.
--
--    Written out one per table here. The loop in 20261007490000 is left
--    where it is: a clean filename-order run creates them there and this
--    file replaces them with identical ones, so the end state is the same
--    either way, and deleting history to tidy a mistake is how the reason
--    for a thing gets lost.
-- ===========================================================================
revoke all on function public.touch_draft_activity() from public, anon, authenticated;
grant execute on function public.touch_draft_activity() to service_role;
revoke all on function public.touch_parent_draft_activity() from public, anon, authenticated;
grant execute on function public.touch_parent_draft_activity() to service_role;

drop trigger if exists application_profiles_touch_draft on public.application_profiles;
create trigger application_profiles_touch_draft
  after insert or update or delete on public.application_profiles
  for each row execute function public.touch_parent_draft_activity();

drop trigger if exists application_addresses_touch_draft on public.application_addresses;
create trigger application_addresses_touch_draft
  after insert or update or delete on public.application_addresses
  for each row execute function public.touch_parent_draft_activity();

drop trigger if exists application_incomes_touch_draft on public.application_incomes;
create trigger application_incomes_touch_draft
  after insert or update or delete on public.application_incomes
  for each row execute function public.touch_parent_draft_activity();

drop trigger if exists application_documents_touch_draft on public.application_documents;
create trigger application_documents_touch_draft
  after insert or update or delete on public.application_documents
  for each row execute function public.touch_parent_draft_activity();

drop trigger if exists application_delivery_contacts_touch_draft on public.application_delivery_contacts;
create trigger application_delivery_contacts_touch_draft
  after insert or update or delete on public.application_delivery_contacts
  for each row execute function public.touch_parent_draft_activity();
