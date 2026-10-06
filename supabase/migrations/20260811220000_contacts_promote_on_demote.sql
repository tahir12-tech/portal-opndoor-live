-- Defect 6: clearing the last primary contact must promote another.
--
-- The invariant "exactly one primary per owner" is maintained in five places and
-- broken in a sixth. The UPDATE trigger only acts `if new.is_primary`, so
-- SETTING a primary correctly demotes the previous one, but CLEARING the only
-- primary is not repaired by anything.
--
-- The route is real: contacts_update grants direct UPDATE on agent_contacts to
-- any admin, and to management within their own partner. A PATCH straight at
-- PostgREST with {"is_primary": false} bypasses org_update_contact, which would
-- have repaired it, and leaves a branch that can never issue a deed.
--
-- The failure is silent at the point it is caused and expensive where it
-- surfaces: nothing breaks until deed generation, which is AFTER the tenant has
-- paid. The application lands in deed_state='error' and the explanation is
-- written at internal visibility, so the referrer sees a stalled application
-- with no reason.
--
-- MOVING IT INTO THE SCHEMA, where the other four guards already are. This is
-- the same logic the DELETE trigger runs and the same logic org_update_contact
-- runs; it is a third call site rather than new behaviour, which is the argument
-- for putting it in the trigger rather than in a sixth caller.
--
-- Only the function is replaced. The trigger already fires on insert and update.

create or replace function public.contacts_maintain_primary() returns trigger
language plpgsql as $$
declare cnt int; nxt uuid;
begin
  if tg_op = 'INSERT' then
    if new.agency_id is not null then
      select count(*) into cnt from public.agent_contacts where agency_id = new.agency_id;
    else
      select count(*) into cnt from public.agent_contacts where branch_id = new.branch_id;
    end if;
    if cnt = 0 then new.is_primary := true; end if;  -- first contact for an owner is primary
  end if;

  if new.is_primary then  -- unset the previous primary before this row claims it
    if new.agency_id is not null then
      update public.agent_contacts set is_primary = false
        where agency_id = new.agency_id and is_primary and id <> new.id;
    else
      update public.agent_contacts set is_primary = false
        where branch_id = new.branch_id and is_primary and id <> new.id;
    end if;
  end if;

  -- THE FIX. Demoting the last primary promotes the next, mirroring
  -- contacts_promote_on_delete. Ordered by created_at then id, the same rule the
  -- delete path uses, so the two cannot disagree about who is next.
  --
  -- Guarded on tg_op and on the flag actually having changed, so this costs
  -- nothing on an ordinary edit to a name or a phone number.
  if tg_op = 'UPDATE' and old.is_primary and not new.is_primary then
    if new.agency_id is not null then
      select id into nxt from public.agent_contacts
        where agency_id = new.agency_id and id <> new.id
        order by created_at, id limit 1;
    else
      select id into nxt from public.agent_contacts
        where branch_id = new.branch_id and id <> new.id
        order by created_at, id limit 1;
    end if;

    if nxt is not null then
      update public.agent_contacts set is_primary = true where id = nxt;
    else
      -- The ONLY contact, being demoted. There is nobody to promote, so refuse
      -- rather than allow an owner with contacts but no primary.
      --
      -- Deleting the last contact is still allowed: that leaves an owner with no
      -- contacts at all, which is an honest state that GET /orgs reports as
      -- has_agent_contact false. A contact that exists but is primary for nobody
      -- is the dishonest one, because the row looks like coverage.
      raise exception 'This is the only contact for that agency or branch, so it cannot be un-set as primary. Add another contact first, or delete this one.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end $$;
