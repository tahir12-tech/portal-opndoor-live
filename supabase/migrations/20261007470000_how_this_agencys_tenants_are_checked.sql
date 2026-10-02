-- =========================================================================
-- HOW AN AGENCY'S TENANTS ARE CHECKED IS A TWO-WAY CHOICE.
--
-- Matt, 2026-10-02: "Agency page, the 'Referrals from this agency'
-- dropdown: replace it with a clear choice titled 'How are this
-- agency's tenants checked?' with two options: 'Opndoor checks
-- eligibility' (the tenant completes eligibility before paying) and
-- 'Agency has already referenced them' (the tenant goes straight to
-- payment). Remove the separate 'Follow the default' option; new
-- agencies start on 'Opndoor checks eligibility'."
--
-- And, when I flagged what that does to the data: "Yes to defaulting
-- agencies on 'Follow the default' to 'Opndoor checks eligibility'.
-- There are no real agencies yet, only dev test data."
--
-- WHAT "REMOVE FOLLOW THE DEFAULT" MEANS IN THE TABLE.
-- `agencies.referencing_mode` is nullable, and null means "inherit the
-- partner's". Two options means the column always holds one of them, so
-- three things have to change together or the screen and the data
-- disagree:
--
--   1. every existing null becomes 'opndoor_referenced'
--   2. the column stops being nullable, with that default
--   3. the setter refuses null
--
-- DOING 1 WITHOUT 2 would leave the next inserted row null and the
-- screen unable to say what it is. Doing 2 without 3 would leave a
-- function whose signature still offers a value the column refuses, and
-- the refusal would arrive as a constraint error rather than a sentence.
--
-- THE BACKFILL IS A DECISION AND NOT A MIGRATION DETAIL. An agency
-- inheriting from a PRE-REFERENCED partner was going straight to
-- payment, and is now going through eligibility. Matt chose that
-- knowing it, and said why it is safe: dev test data only.
--
-- NOT TOUCHED: `partners.referencing_mode`, which is the supplier rail's
-- own question and a different one. And the two pre_referenced VALUES
-- stay in the check constraint: an agency already on
-- 'pre_referenced_screened' keeps it, and the screen reads anything
-- that is not 'opndoor_referenced' as "already referenced".
-- =========================================================================

-- 1. THE BACKFILL, before the constraint that would refuse the nulls.
do $$
declare v_moved int;
begin
  update public.agencies
     set referencing_mode = 'opndoor_referenced'
   where referencing_mode is null;
  get diagnostics v_moved = row_count;
  raise notice 'referencing_mode: % agencies moved off inherit', v_moved;
end $$;

-- 2. ALWAYS ONE OF THE TWO, from here on.
alter table public.agencies
  alter column referencing_mode set default 'opndoor_referenced';
alter table public.agencies
  alter column referencing_mode set not null;

comment on column public.agencies.referencing_mode is
  'How this agency''s tenants are checked: opndoor_referenced (the tenant completes eligibility before paying) or a pre_referenced value (straight to payment). NOT NULL since 2026-10-02: "Remove the separate Follow the default option" (Matt), so an agency always states its own answer rather than inheriting its partner''s.';

-- 3. AND THE SETTER REFUSES THE OPTION THAT NO LONGER EXISTS, with a
--    sentence rather than a constraint error.
create or replace function public.set_agency_referencing_mode(p_agency uuid, p_mode text)
returns void
language plpgsql security definer set search_path to ''
as $function$
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_mode is null then
    raise exception 'Choose how this agency''s tenants are checked. There is no "follow the default" any more.'
      using errcode = '22023';
  end if;
  if p_mode not in ('pre_referenced_open','pre_referenced_screened','opndoor_referenced') then
    raise exception 'Unknown referencing mode %', p_mode using errcode = '22023';
  end if;

  /* RECORDED IN RECENT CHANGES. Matt: "Changing it asks for
     confirmation and applies to new referrals only, and is recorded in
     Recent changes." The confirmation is the screen's; the record is
     this, and it is written here so every caller gets it.

     ONLY WHEN IT MOVES, like the contact email: a save that changes
     nothing is not a change, and a list of them is what he asked to
     have hidden on the Settings tab the same day. */
  if exists (select 1 from public.agencies
              where id = p_agency and referencing_mode::text is distinct from p_mode) then
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    select 'agency', p_agency, 'tenant_check_changed',
           (case when a.referencing_mode::text = 'opndoor_referenced' then 'Opndoor checks eligibility'
                 else 'Agency has already referenced them' end)
           || ' -> ' ||
           (case when p_mode = 'opndoor_referenced' then 'Opndoor checks eligibility'
                 else 'Agency has already referenced them' end),
           coalesce((select full_name from public.users where id = auth.uid()), 'an administrator'),
           auth.uid()
    from public.agencies a where a.id = p_agency;
  end if;

  update public.agencies set referencing_mode = p_mode where id = p_agency;
end $function$;

-- 4. AND NOTHING IS LEFT INHERITING.
do $$
declare v_null int;
begin
  select count(*) into v_null from public.agencies where referencing_mode is null;
  if v_null > 0 then
    raise exception '% agencies still have no answer to how their tenants are checked', v_null;
  end if;
end $$;
