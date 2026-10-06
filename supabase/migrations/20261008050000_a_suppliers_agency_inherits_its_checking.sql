-- AN AGENCY IN A SUPPLIER'S ESTATE INHERITS THE SUPPLIER'S CHECKING SETTING.
--
-- Matt, 2026-10-04, after being shown the cause: "Agencies inside a supplier's
-- estate inherit the supplier's checking setting (allow null, stop defaulting
-- on all creation paths). Correct dev's five Kestrel agencies to inherit. The
-- migration must do the same on live: every agency in a supplier's estate set
-- to inherit, unless a deliberate per-agency setting is recorded in the audit
-- trail (list any such exceptions for me rather than overwriting them). ...
-- Your own agencies keep their own settings."
--
-- Test: supabase/tests/a_suppliers_agency_inherits_its_checking.test.sql
--
-- =========================================================================
-- THE BLOCKER THIS FIXES, AND WHY NOBODY HAD SEEN IT
-- =========================================================================
--
-- A Kestrel referral (GR-25831) sent its tenant opndoor's FULL APPLICATION
-- email, asking for three years of address history, their income and
-- documents, under an arrangement where opndoor checks nothing and accepts
-- the supplier's word. Not a mislabelled screen: a person asked for personal
-- data we had no basis to ask for.
--
-- `resolve_referencing_mode` reads "the agency's own mode if it has said,
-- else the route partner's":
--
--     coalesce(agency.referencing_mode, partner.referencing_mode)
--
-- and `agencies.referencing_mode` is NOT NULL DEFAULT 'opndoor_referenced'.
-- So every agency has ALWAYS "said", the coalesce can never reach its second
-- arm, and a supplier's setting has never once been inherited. The fallback
-- was unreachable code.
--
-- MEASURED: all five agencies in Kestrel's estate read 'opndoor_referenced'
-- while Kestrel reads 'pre_referenced_open'. Every new Kestrel referral
-- through any of them got the wrong journey, not only the new agency.
--
-- NOT CAUSED BY refers_own_stock, which was the natural suspicion and was
-- checked first because that change was mine, made today. That flag feeds
-- my_org_shape; the mode comes from this column. The two Kestrel referrals
-- sent before today, GR-22162 and GR-FROST-KES, were both frozen
-- 'pre_referenced_open' under the same flag value, which is the proof.
--
-- =========================================================================
-- SAFE TO MAKE NULLABLE, CHECKED RATHER THAN ASSUMED
-- =========================================================================
--
-- Ten functions read a referencing_mode. Two of them are AUTHORISATION
-- predicates, `app_reachable_agency` and `app_may_reach_contact`, and a
-- column going nullable underneath an authorisation test is how a fail-open
-- happens. Both read `p.referencing_mode`, the PARTNER's, not the agency's.
-- So nothing that decides reach is affected by this change.
--
-- The client already copes: hydrate maps this column with `?? null` and
-- `?? undefined` in three places, because an agency with no opinion was
-- always the shape the TYPE described even while the column forbade it.

-- ---------------------------------------------------------------------------
-- 1. THE SCHEMA. The default is what made every creation path set a mode:
--    none of admin_add_agency, admin_create_agency_and_branch,
--    create_referral_target or partner_api_create_org mentions the column, so
--    dropping the default IS "stop defaulting on all creation paths".
-- ---------------------------------------------------------------------------
alter table public.agencies alter column referencing_mode drop default;
alter table public.agencies alter column referencing_mode drop not null;

comment on column public.agencies.referencing_mode is
  'This agency''s OWN checking setting, or NULL to inherit its partner''s. Null is the normal state for an agency in a supplier''s estate: the supplier decides how its tenants are checked. Deliberately has no default, because a default here is an opinion every agency is given without anybody forming it, and it made resolve_referencing_mode''s inheritance arm unreachable.';

-- ---------------------------------------------------------------------------
-- 2. THE DATA, ON DEV AND ON LIVE. Scoped to supplier estates, and sparing
--    anything set on purpose.
-- ---------------------------------------------------------------------------
/* THE EXCEPTION RULE IS MATT'S AND IS WHY THIS IS NOT A BLANKET UPDATE: "every
   agency in a supplier's estate set to inherit, unless a deliberate per-agency
   setting is recorded in the audit trail (list any such exceptions for me
   rather than overwriting them)."

   `tenant_check_changed` is the action set_agency_referencing_mode writes, so
   its presence is the record of somebody having decided. An agency with one is
   left exactly as it is and reported, never overwritten.

   ON DEV THERE ARE NONE. The only tenant_check_changed row belongs to New
   Independent, which is on opndoor-agents, our own estate, and is therefore
   outside this statement's scope twice over. So all five Kestrel agencies
   inherit and no exception is being skipped silently.

   ON LIVE THIS IS THE RULE RATHER THAN THE ANSWER, which is the point of
   encoding it: whatever live holds, a deliberate setting survives. */
update public.agencies a
   set referencing_mode = null
 where exists (select 1 from public.partners p
                where p.id = a.partner_id and p.partner_kind = 'supplier')
   and a.referencing_mode is not null
   and not exists (select 1 from public.org_audit o
                    where o.entity_type = 'agency'
                      and o.entity_id = a.id
                      and o.action = 'tenant_check_changed');

/* AND WHAT IT SPARED, RAISED RATHER THAN BURIED. A NOTICE, not an exception:
   refusing to migrate would be worse than proceeding, and Matt asked to be
   told rather than protected. Appears in the apply output. */
do $$
declare r record; v_n int := 0;
begin
  for r in
    select a.name as agency, p.name as supplier, a.referencing_mode
      from public.agencies a
      join public.partners p on p.id = a.partner_id
     where p.partner_kind = 'supplier' and a.referencing_mode is not null
     order by p.name, a.name
  loop
    v_n := v_n + 1;
    raise notice 'KEPT ITS OWN SETTING: % (under %) stays on %, because its audit trail records a deliberate change.',
      r.agency, r.supplier, r.referencing_mode;
  end loop;
  if v_n = 0 then
    raise notice 'Every agency in every supplier estate now inherits. No deliberate per-agency setting was found, so none was skipped.';
  end if;
end $$;
