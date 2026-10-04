-- A SUPPLIER MAY CORRECT ITS OWN AGENCIES AND OFFICES.
--
-- Matt: "Supplier Management (not Referrers) can edit their own agencies'
-- and offices' name, address and email, from the agency's Overview: an
-- 'Edit' button, the same duplicate-name check as adding, a confirmation
-- for email changes ('Signed deeds will go to...'), recorded in Recent
-- changes with who did it. Opndoor admins can edit them too."
--
-- Test: supabase/tests/a_supplier_may_correct_its_own_agencies.test.sql
--
-- =========================================================================
-- THERE WAS NO WAY TO EDIT ANY OF THE THREE, AND NO ADDRESS TO EDIT
-- =========================================================================
--
-- Checked before writing anything. Dev has `set_agency_group`,
-- `set_agency_level`, `set_agency_rates`, `set_agency_referencing_mode` and
-- `set_agency_share_deal` -- every one of them a setting -- and nothing
-- that changes a name, an address or an email. An agency created with a
-- typo stayed that way.
--
-- AND `address` DID NOT EXIST on either table. `branches.area` is the
-- nearest thing and is a locality rather than a postal address; agencies
-- had nothing at all. So this adds the column rather than bending `area`
-- into a field it was not named for. Additive: no existing row changes and
-- the referral path passes through none of it.
--
-- =========================================================================
-- WHO MAY, AND THE TWO WORDS THAT DECIDE IT
-- =========================================================================
--
-- "THEIR OWN", and "not Referrers". A supplier's Management may correct the
-- agencies in THEIR estate; an opndoor admin may correct anybody's. A
-- Referrer may not, which matters because a Referrer is exactly who adds
-- most of these agencies in the first place, from the referral form -- the
-- act of creating one is not the right to rename it afterwards.
--
-- NOT ON OUR OWN ESTATE, for the same reason admin_add_agency refuses a
-- Manager there: the house partner is shared, so "their own agencies" is
-- every agency Opndoor has onboarded, and a Manager renaming one would be
-- renaming a stranger's.

alter table public.agencies add column if not exists address text;
alter table public.branches add column if not exists address text;

comment on column public.agencies.address is
  'The agency''s postal address, as its own people maintain it. Free text: this is shown to staff and printed on nothing, so it is not parsed.';
comment on column public.branches.address is
  'The office''s postal address. Distinct from `area`, which is a locality used for grouping.';

-- AND GRANTED, because both tables grant SELECT column by column: agencies
-- carries 15 columns and 13 grants. A column added without one is invisible
-- to every signed-in reader, which on these two tables means the Agencies
-- screen stops loading rather than showing a blank cell.
grant select (address) on public.agencies to authenticated;
grant select (address) on public.branches to authenticated;

-- =========================================================================
-- ONE FUNCTION PER THING, because they are different rows with different
-- duplicate rules: an agency name is unique within a PARTNER, an office
-- name within its AGENCY.
-- =========================================================================

create or replace function public.set_agency_details(
  p_agency uuid, p_name text, p_address text, p_email text
) returns void language plpgsql security definer set search_path to '' as $function$
declare
  me uuid := auth.uid(); who text; v_pid uuid; v_old_name text; v_old_email text;
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := btrim(coalesce(p_email, ''));
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  select partner_id, name into v_pid, v_old_name from public.agencies where id = p_agency;
  if v_pid is null then raise exception 'Agency not found.' using errcode = '22023'; end if;

  /* THE SAME TEST admin_add_agency USES, deliberately: whoever may add an
     agency to an estate may correct one in it. Management only -- a
     Referrer adds agencies from the referral form and that is not the same
     right as renaming one afterwards. */
  if not coalesce((public.is_admin()
        or (public.app_role() = 'management'
            and v_pid = public.app_partner()
            and not public.is_our_estate_partner(v_pid))), false) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  if v_name = '' then raise exception 'Agency name is required.' using errcode = '22023'; end if;
  if v_email <> '' and v_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Enter a valid agency contact email.' using errcode = '22023';
  end if;
  /* THE SAME DUPLICATE CHECK AS ADDING, which is what Matt asked for, and
     excluding this row: renaming an agency to the name it already has is
     not a clash. */
  if exists (select 1 from public.agencies a
              where a.partner_id = v_pid and a.id <> p_agency
                and lower(a.name) = lower(v_name)) then
    raise exception 'An agency with that name already exists for this partner.' using errcode = '23505';
  end if;
  /* AN AGENCY IN A SUPPLIER'S ESTATE MUST KEEP AN EMAIL. admin_add_agency
     requires one at creation because signed deeds for its branches go
     there; clearing it afterwards would leave the same gap by a different
     door. */
  if v_email = '' and coalesce(public.is_supplier_estate(v_pid), false)
     and exists (select 1 from public.agent_contacts c where c.agency_id = p_agency and c.is_primary) then
    raise exception 'An agency that comes through a supplier must keep an email. Signed deeds for its branches go there.'
      using errcode = '22023';
  end if;

  who := coalesce((select full_name from public.users where id = me), 'somebody');
  select c.email into v_old_email from public.agent_contacts c
   where c.agency_id = p_agency and c.is_primary limit 1;

  update public.agencies
     set name = v_name, address = nullif(btrim(coalesce(p_address, '')), '')
   where id = p_agency;

  if v_email <> '' then
    if v_old_email is null then
      insert into public.agent_contacts(agency_id, partner_id, name, email, is_primary, created_by)
      values (p_agency, v_pid, v_name, v_email, true, me);
    else
      update public.agent_contacts set email = v_email
       where agency_id = p_agency and is_primary;
    end if;
  end if;

  /* RECORDED WITH WHO DID IT, which Matt asked for, and SAYING WHAT
     CHANGED rather than that something did. A Recent changes line reading
     "the agency was edited" is the entry somebody has to open the row to
     understand. */
  /* CASE-SENSITIVE FOR THE AUDIT, case-insensitive for the duplicate check,
     and the difference is the point. "Test Lettings asda" -> "Test Lettings
     ASDA" is not a clash with itself, so the check above must ignore case;
     but it IS the correction this function largely exists for, so recording
     nothing would leave the commonest edit invisible in Recent changes. */
  if v_old_name is distinct from v_name then
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('agency', p_agency, 'renamed', v_old_name || ' renamed to ' || v_name, who, me);
  end if;
  if v_email <> '' and lower(coalesce(v_old_email, '')) is distinct from lower(v_email) then
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('agency', p_agency, 'email_changed',
            'Agency email set to ' || v_email || ', so signed deeds now go there', who, me);
  end if;
end $function$;

revoke all on function public.set_agency_details(uuid, text, text, text) from public, anon;
grant execute on function public.set_agency_details(uuid, text, text, text) to authenticated, service_role;

create or replace function public.set_branch_details(
  p_branch uuid, p_name text, p_address text, p_email text
) returns void language plpgsql security definer set search_path to '' as $function$
declare
  me uuid := auth.uid(); who text; v_pid uuid; v_ag uuid; v_old_name text; v_old_email text;
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := btrim(coalesce(p_email, ''));
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  select partner_id, agency_id, name into v_pid, v_ag, v_old_name
    from public.branches where id = p_branch;
  if v_pid is null then raise exception 'Office not found.' using errcode = '22023'; end if;

  if not coalesce((public.is_admin()
        or (public.app_role() = 'management'
            and v_pid = public.app_partner()
            and not public.is_our_estate_partner(v_pid))), false) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  if v_name = '' then raise exception 'Office name is required.' using errcode = '22023'; end if;
  if v_email <> '' and v_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Enter a valid office email.' using errcode = '22023';
  end if;
  -- WITHIN ITS AGENCY, not within the partner: two agencies may each have a
  -- "Mayfair" office and neither is a duplicate of the other.
  if exists (select 1 from public.branches b
              where b.agency_id = v_ag and b.id <> p_branch
                and lower(b.name) = lower(v_name)) then
    raise exception 'An office with that name already exists for this agency.' using errcode = '23505';
  end if;

  who := coalesce((select full_name from public.users where id = me), 'somebody');
  select c.email into v_old_email from public.agent_contacts c
   where c.branch_id = p_branch and c.is_primary limit 1;

  update public.branches
     set name = v_name, address = nullif(btrim(coalesce(p_address, '')), '')
   where id = p_branch;

  /* AN OFFICE EMAIL IS AN OVERRIDE OF ITS AGENCY'S, which Matt established
     on 2026-10-02, so clearing it is a real act and not a mistake: it means
     "use the agency's". Deleting the row rather than storing an empty one
     is what makes effective_primary_contact fall back correctly. */
  if v_email = '' then
    delete from public.agent_contacts where branch_id = p_branch and is_primary;
  elsif v_old_email is null then
    insert into public.agent_contacts(branch_id, partner_id, name, email, is_primary, created_by)
    values (p_branch, v_pid, v_name, v_email, true, me);
  else
    update public.agent_contacts set email = v_email where branch_id = p_branch and is_primary;
  end if;

  -- Case-sensitive here too: see the agency function above.
  if v_old_name is distinct from v_name then
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('branch', p_branch, 'renamed', v_old_name || ' renamed to ' || v_name, who, me);
  end if;
  if lower(coalesce(v_old_email, '')) is distinct from lower(v_email) then
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('branch', p_branch, 'email_changed',
            case when v_email = '' then 'Office email removed, so signed deeds go to the agency''s'
                 else 'Office email set to ' || v_email || ', so signed deeds now go there' end,
            who, me);
  end if;
end $function$;

revoke all on function public.set_branch_details(uuid, text, text, text) from public, anon;
grant execute on function public.set_branch_details(uuid, text, text, text) to authenticated, service_role;
