-- ===========================================================================
-- Agencies and branches become visible by RELATIONSHIP. Contacts do not.
--
-- ---------------------------------------------------------------------------
-- THE LINE, AND IT IS PERMANENT
-- ---------------------------------------------------------------------------
-- Sharing an agency does NOT share a contact book. A contact is scoped to the
-- partner that created it, always, and no amount of shared reach changes that.
--
-- This is the single most important rule in the sharing design, because it is
-- where the actual value sits. An agency row is a name and a postcode. An
-- agent_contacts row is a named human being, their direct email and their phone
-- number, entered by whoever did the work of getting it. Making agencies
-- reachable while leaving contacts_select alone would have quietly handed every
-- partner every other partner's contact book the moment they shared an agency,
-- and it would have looked like a feature.
--
-- So contacts_select is UNCHANGED, byte for byte, and it stays keyed on
-- agent_contacts.partner_id. What DOES change is what that column means when a
-- contact is created: see part 3.
--
-- ---------------------------------------------------------------------------
-- WHAT A PARTNER GAINS AND DOES NOT GAIN BY REACHING AN AGENCY
-- ---------------------------------------------------------------------------
--   gains   the agency and its branches: name, group, area. Enough to select
--           one on a referral form, which is the entire point.
--   does not gain
--           any contact created by another partner
--           any application belonging to another route (applications_select is
--             route-scoped and untouched)
--           any commission figure (off the table grant entirely)
--           knowledge of WHICH other partners reach the agency
--             (partner_agency_relationships is self-scoped)
--
-- The league needs no change and gets none: agency and branch aggregates are
-- built from applications the viewer can already read, so a shared agency shows
-- a partner their own volume and nobody else's, by construction rather than by
-- a filter somebody has to remember.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Agencies. Reachability replaces ownership.
--
-- Reproduced in full from 20260811190000:50-52. The ONLY change is the final
-- predicate: partner_id = app_partner() becomes partner_can_reach_agency(id).
-- The admin arm and the role allowlist are untouched, and the role list stays a
-- positive allowlist rather than a negative test.
-- ---------------------------------------------------------------------------
drop policy if exists agencies_select on public.agencies;
create policy agencies_select on public.agencies for select to authenticated
  using (
    public.is_admin()
    or (public.app_role() in ('management','referrer','developer')
        and public.partner_can_reach_agency(id))
  );

-- ---------------------------------------------------------------------------
-- 2. Branches follow their agency. A branch has no relationship of its own:
--    reaching an agency reaches its branches, because selecting a branch on a
--    referral form is the thing reaching an agency is FOR.
-- ---------------------------------------------------------------------------
drop policy if exists branches_select on public.branches;
create policy branches_select on public.branches for select to authenticated
  using (
    public.is_admin()
    or (public.app_role() in ('management','referrer','developer')
        and public.partner_can_reach_agency(agency_id))
  );

-- ---------------------------------------------------------------------------
-- 3. contacts_select is NOT redefined here. Deliberately absent.
--
-- It remains exactly as 20260811190000:58-60 left it, keyed on
-- agent_contacts.partner_id. Do not "finish the set" by giving it a
-- reachability arm: that is the leak this design exists to prevent.
--
-- What changes is how partner_id gets its value. The trigger used to take it
-- from the AGENCY, which under sharing would file a contact created by partner
-- B at partner A's agency as partner A's contact, handing B's work to A. It now
-- takes it from the CREATOR.
--
-- Same three-step shape as route attribution, and safe for the same reason:
-- every existing caller passes the value the trigger would derive
-- (create_referral_target passes pid, the caller's own partner, at
-- 20260704184047:57-62), and a portal user can only reach their own partner's
-- agencies today, so creator and agency give the same answer on every path that
-- exists. The opndoor-admin case falls back to the agency exactly as before.
-- ---------------------------------------------------------------------------
create or replace function public.sync_contact_partner() returns trigger
language plpgsql security definer set search_path to '' as $function$
declare v_owner uuid;
begin
  -- 1. Stated by the caller. Every existing writer states it.
  if new.partner_id is null then
    -- 2. The creator's partner: whose contact book this belongs in.
    new.partner_id := public.app_partner();
  end if;

  if new.partner_id is null then
    -- 3. No creator partner: an opndoor admin. Fall back to the org, which is
    --    what this function did for everyone before sharing existed.
    if new.agency_id is not null then
      select partner_id into v_owner from public.agencies where id = new.agency_id;
    else
      select partner_id into v_owner from public.branches where id = new.branch_id;
    end if;
    new.partner_id := v_owner;
  end if;

  if new.partner_id is null then raise exception 'contact owner not found'; end if;
  return new;
end $function$;

comment on function public.sync_contact_partner() is
  'Files a contact in the CREATOR''s contact book, not the agency owner''s. Was derived from the agency, which under org sharing would have handed one partner''s contacts to another. Falls back to the agency for an opndoor admin, which is the pre-sharing behaviour.';

-- ---------------------------------------------------------------------------
-- 4. Prove the contact book did not move.
-- ---------------------------------------------------------------------------
do $$
declare v_def text; v_moved int;
begin
  select pg_get_expr(polqual, polrelid) into v_def
  from pg_policy where polrelid = 'public.agent_contacts'::regclass and polname = 'contacts_select';

  if v_def is null then
    raise exception 'contacts_select is missing';
  end if;
  if position('partner_can_reach_agency' in v_def) > 0 then
    raise exception 'contacts_select has gained a reachability arm. Sharing an agency must never share a contact book. See 20260812120000.';
  end if;
  if position('app_partner()' in v_def) = 0 then
    raise exception 'contacts_select is no longer keyed on the owning partner: %', v_def;
  end if;

  -- No existing contact may have changed hands.
  select count(*) into v_moved
  from public.agent_contacts c
  left join public.agencies a on a.id = c.agency_id
  left join public.branches  b on b.id = c.branch_id
  where c.partner_id is distinct from coalesce(a.partner_id, b.partner_id);
  if v_moved > 0 then
    raise exception '% contact(s) are filed against a partner that does not own their org; sharing must not reassign existing contacts', v_moved;
  end if;
end $$;
