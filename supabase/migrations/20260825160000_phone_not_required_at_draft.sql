-- ===========================================================================
-- A draft may not have a usable phone yet. applications_phone_present required
-- a non-empty phone containing a digit on EVERY row, so create_direct_application
-- (which seeds tenant_phone from the applicant, and the register phone field is
-- optional and unvalidated) failed at draft creation with a 23514. The tenant
-- had verified their email and could not get past registration.
--
-- Same shape as 20260821020000 for the property: the direct rail creates a draft
-- BEFORE the field is collected. Phone is asked on the About step and required
-- at submission, so the check belongs after draft, not at it. Drafts are exempt;
-- a submitted application still needs a phone with a digit. The referral rail
-- validates the phone in create_referral regardless, so its behaviour is
-- unchanged.
-- ===========================================================================
alter table public.applications drop constraint applications_phone_present;
alter table public.applications add constraint applications_phone_present
  check (status = 'draft' or (btrim(coalesce(tenant_phone, '')) <> '' and tenant_phone ~ '[0-9]'));

-- Prove a draft can now be created for an existing applicant, drafts being
-- exempt from the phone check. Picks whatever applicant exists rather than
-- naming one, rolls back, and no-ops on an empty database.
do $$
declare v_appl uuid; v_id uuid;
begin
  select id into v_appl from public.applicants limit 1;
  if v_appl is null then raise notice 'no applicant to probe with; skipping'; return; end if;
  begin
    select id into v_id from public.create_direct_application(
      p_applicant := v_appl, p_rent := 0, p_addr1 := '', p_city := '', p_postcode := '');
    if v_id is null then raise exception 'create_direct_application returned null'; end if;
    raise exception 'rollback_phone_probe';
  exception when others then
    if SQLERRM <> 'rollback_phone_probe' then raise; end if;
  end;
end $$;
