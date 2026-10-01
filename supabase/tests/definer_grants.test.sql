-- WHO MAY CALL A SECURITY DEFINER FUNCTION, ASSERTED AS A WHOLE.
--
-- A definer function runs as its owner, so RLS does not apply inside it and
-- the only boundary is the check it makes for itself. Two things therefore
-- have to be true, and only the first of them was:
--
--   the function checks reach
--   the function is callable by somebody who needs it, and nobody else
--
-- Measured on dev before 20261006330000: 263 SECURITY DEFINER functions in
-- public, 193 executable by `authenticated`, 35 by `anon`. Almost none of
-- that was a decision. Postgres grants EXECUTE to PUBLIC on every new
-- function, and a migration has to say `revoke` to stop it -- so a
-- `revoke ... from authenticated` written in good faith left
-- has_function_privilege answering TRUE, because PUBLIC still held it.
--
-- This file is the standing version of that measurement. It runs against a
-- freshly-migrated database in CI, so a function added next month with no
-- grant line fails here by name rather than being found by the next review.
--
-- THE ALLOWLIST IS TWO KINDS OF FUNCTION AND NOTHING ELSE:
--
--   POLICY PREDICATES  an RLS policy expression IS permission-checked against
--                      the querying role, so these must stay callable. Revoke
--                      app_may_reach_application_org and `select from
--                      applications` stops with "permission denied for
--                      function" rather than returning zero rows.
--
--   CALLED WITH A USER'S JWT  every `.rpc('...')` in src, plus every
--                      `userClient.rpc("...")` in supabase/functions, where an
--                      edge function deliberately calls AS the caller so the
--                      function's own reach check applies. Classifying from
--                      src alone missed nine of those and broke the referral
--                      path; the pgTAP suite is what caught it.
--
-- Everything else -- trigger functions, cron bodies, internal helpers, the
-- machinery behind these RPCs -- is service_role only.
--
-- THE ASSERTION IS SET EQUALITY, in both directions, deliberately. A
-- one-directional check ("nothing outside the list is exposed") passes
-- forever once somebody revokes half the list and breaks the product, and a
-- security test that cannot fail on an outage is not carrying its weight.

begin;
select plan(4);

create temp table allowed(name text) on commit drop;
insert into allowed(name) values
  ('add_application_note'),
  /* The two admin doors onto a supplier's named statement addresses
     (20261007040000). Browser-called from the admin screens, guarded
     inside by is_aal2 + is_admin, so granted to `authenticated` and
     therefore on the list. Covered by
     a_supplier_gets_its_own_statement.test.sql. */
  ('add_partner_statement_recipient'),
  ('admin_add_agency'),
  ('admin_add_branch'),
  ('admin_break_glass_revoke_key'),
  ('admin_cancel_invite'),
  ('admin_create_agency_and_branch'),
  ('admin_delete_org_shape'),
  ('admin_reset_user_mfa'),
  ('admin_set_user_status'),
  ('admin_update_user_name'),
  ('admin_update_user_role'),
  ('agency_branches_for_match'),
  ('agency_changes'),
  ('agency_match_queue'),
  ('agent_rail_funnel'),
  ('agreement_for_agency'),
  ('amend_tenancy_start'),
  ('app_has_scope'),
  ('app_may_reach_agency'),
  ('app_may_reach_application_org'),
  ('app_may_reach_branch'),
  ('app_may_reach_contact'),
  ('app_may_reach_user'),
  ('app_partner'),
  ('app_reachable_agency'),
  ('app_reachable_group'),
  ('app_role'),
  ('app_scope_branches'),
  ('application_commission_rates'),
  ('application_journey'),
  ('assert_may_grant_level'),
  ('assert_may_grant_position'),
  ('attach_user_to_agency'),
  ('authorise_password_reset'),
  /* The two ladder questions the three notification setters share
     (20261006920000). Both read only the CALLER and grant nothing on their
     own: caller_is_director is the Director capability test, and
     caller_may_set_for is at-or-below within the caller's own POSITION --
     never partner_id, because every agency shares the house partner.
     Covered by who_may_change_a_notification.test.sql. */
  ('caller_is_director'),
  ('caller_leads_their_party'),
  ('caller_may_set_for'),
  ('clear_agency_share_deal'),
  ('clear_branch_deed_recipient'),
  ('commission_preview'),
  ('commission_split_batch'),
  ('commission_statement_ref'),
  ('confirm_org_entity'),
  ('count_pending_tenancy_corrections'),
  ('create_agency_group'),
  ('create_agreement'),
  ('create_invited_user'),
  ('create_joint_referral'),
  ('create_partner'),
  ('create_referral'),
  ('create_referral_target'),
  ('cron_health'),
  ('decide_not_in_network'),
  /* A refund that landed on commission already sent on a statement. Staff
     only, and MFA, because answering it either sends a payee a corrected
     document or changes what their next one says. Covered by
     a_refund_after_a_statement_is_a_question.test.sql. */
  ('decide_refund_question'),
  ('decline_application'),
  ('dev_api_errors_by_method'),
  ('dev_api_keys'),
  ('dev_api_logs'),
  ('dev_api_stats'),
  ('dev_api_timeseries'),
  ('dev_delete_api_key'),
  ('dev_delete_webhook_endpoint'),
  ('dev_live_application_counts'),
  ('dev_live_applications'),
  ('dev_partner_options'),
  ('dev_purge_sandbox'),
  ('dev_replay_webhook_delivery'),
  ('dev_revoke_api_key'),
  ('dev_sandbox_application_document'),
  ('dev_sandbox_applications'),
  ('dev_sandbox_counts'),
  ('dev_update_webhook_endpoint'),
  ('dev_webhook_deliveries'),
  ('dev_webhook_endpoint_secret'),
  ('dev_webhook_endpoints'),
  ('dev_webhook_stats'),
  ('dismiss_agency_match'),
  ('end_agreement'),
  ('is_admin'),
  ('is_house_partner_id'),
  ('is_opndoor_staff'),
  ('is_our_estate_partner'),
  ('level_rank_of'),
  ('list_managed_users'),
  ('log_view_as'),
  ('mark_withdrawn'),
  ('may_act_on_user'),
  ('may_edit_notification_matrix'),
  ('may_see_commission'),
  ('my_application_delivery'),
  ('my_org_shape'),
  ('my_partner_rates'),
  ('my_partner_summary'),
  ('not_in_network_agencies'),
  ('notification_matrix'),
  ('ops_route_live_count'),
  ('ops_routing_matrix'),
  ('org_add_contact'),
  ('org_deed_readiness'),
  ('org_rate_tiers'),
  ('org_remove_contact'),
  ('org_set_primary_contact'),
  ('org_update_contact'),
  ('origin_is_agent_estate'),
  ('origin_referencing_mode'),
  ('partner_active_key_count'),
  ('partner_statement_recipient_list'),
  /* The whole panel in one round trip, including a flag PER SECTION saying
     whether the caller may change that section -- so the screen can only
     ever offer what the server will accept. Bounded by the same ladder as
     the setters. Covered by
     a_person_panel_says_what_you_may_change.test.sql. */
  ('person_notification_panel'),
  ('reconciliation_queue'),
  ('referral_fee_preview'),
  ('referrer_league'),
  /* The open questions themselves. Opndoor staff only: they are other
     companies' commission figures on documents already sent. */
  ('refund_questions_open'),
  ('remove_partner_statement_recipient'),
  ('resolve_agency_match'),
  ('send_deed_to_agent'),
  ('send_deed_to_landlord'),
  ('set_agency_group'),
  ('set_agency_level'),
  ('set_agency_rates'),
  ('set_agency_referencing_mode'),
  ('set_agency_share_deal'),
  ('set_app_setting_num'),
  /* The invoice address agencies and suppliers send their commission
     invoices to, and the predicate Home and Health read to say when it
     is unset (20261007150000). Covered by where_to_send_the_invoice. */
  ('set_app_setting_text'),
  ('set_application_status'),
  ('set_branch_deed_recipient'),
  ('set_group_rates'),
  ('set_home_branch'),
  /* Notifications became per person (20261006900000). set_my_notification
     writes only auth.uid()'s own row and refuses a locked type by name;
     user_notification_enabled is the read the send path makes. Both are
     covered by notifications_are_per_person.test.sql. Placed in sort order
     rather than appended, because the list is asserted sorted so that two
     people adding to it cannot collide. */
  ('set_my_notification'),
  ('set_node_rate'),
  ('set_notification_for'),
  ('set_notification_setting'),
  ('set_ops_route'),
  ('set_receives_commission_statements'),
  ('set_receives_notifications'),
  ('set_referrer_leaderboard_mode'),
  /* The one way a supplier's commission changes, and the reader the
     same tab uses for its tiers (20261007090000). Both are called
     from the supplier Commission tab and guarded inside with
     is_admin + is_aal2. Covered by commission_is_set_in_one_place. */
  ('set_supplier_commission'),
  ('set_user_scope'),
  ('staff_payment_page_token'),
  ('statement_invoice_email'),
  ('statements_can_be_posted'),
  ('supplier_commission_tiers'),
  /* A supplier's own live deal of one kind, for its Commission tab. Admin
     only and MFA'd inside the function: what each agency under a supplier
     keeps is that supplier's commercial business, not something Opndoor
     publishes to its staff. Covered by a_supplier_has_two_deals.test.sql. */
  ('supplier_deal'),
  ('supplier_share_deals'),
  ('trigger_crm_sync'),
  ('update_partner_settings'),
  ('user_notification_enabled'),
  ('user_within_caller_scope'),
  ('viewer_runs_eligibility_journey');

-- ---------------------------------------------------------------------------
-- 1. ANON REACHES NOTHING.
-- ---------------------------------------------------------------------------
-- anon arrives at this database through exactly two edge functions --
-- tenant-portal and payment-page -- and both hold service_role. There is no
-- definer function anon needs, so the correct number is zero and any other
-- number is a question rather than a judgement call.
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and has_function_privilege('anon', p.oid, 'execute')),
  '',
  'no SECURITY DEFINER function in public is executable by anon');

-- ---------------------------------------------------------------------------
-- 2. NOTHING OUTSIDE THE ALLOWLIST IS EXPOSED TO authenticated.
-- ---------------------------------------------------------------------------
-- This is the direction that catches the new function nobody wrote a revoke
-- for. It names the functions, so the failure is actionable.
select is(
  (select coalesce(string_agg(distinct p.proname, ', ' order by p.proname), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and has_function_privilege('authenticated', p.oid, 'execute')
      and p.proname not in (select name from allowed)),
  '',
  'every definer function authenticated may execute is on the allowlist');

-- ---------------------------------------------------------------------------
-- 3. AND THE ALLOWLIST IS NOT STALE.
-- ---------------------------------------------------------------------------
-- The other direction. A name left here after its function is revoked or
-- deleted is a list drifting away from the thing it describes, and the next
-- person to read it trusts it.
select is(
  (select coalesce(string_agg(a.name, ', ' order by a.name), '')
     from allowed a
    where not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = a.name and p.prosecdef
         and has_function_privilege('authenticated', p.oid, 'execute'))),
  '',
  'and every name on the allowlist is a definer function authenticated can still execute');

-- ---------------------------------------------------------------------------
-- 4. THE DEFAULT ITSELF.
-- ---------------------------------------------------------------------------
-- Everything above is a snapshot of today. This is what stops the NEXT
-- function being born open, and it is per-granting-role rather than per
-- schema: the entry that matters is the one for `postgres`, which owns all
-- 295 functions in public and is what `supabase db push` and the SQL editor
-- both run as.
--
-- There is a second entry, for supabase_admin, which still grants anon and
-- authenticated. It is Supabase's own platform default, it cannot be altered
-- from a migration (postgres is not a member of supabase_admin), and nothing
-- in this repository creates functions as supabase_admin -- so it governs
-- nothing here. Asserting only the postgres entry is the honest statement of
-- what this repository actually controls; assertion 2 above is what would
-- catch it if that ever stopped being true.
select is(
  (select array_to_string(d.defaclacl, ' ')
     from pg_default_acl d
     join pg_namespace n on n.oid = d.defaclnamespace
     join pg_roles r on r.oid = d.defaclrole
    where n.nspname = 'public' and d.defaclobjtype = 'f' and r.rolname = 'postgres'),
  'postgres=X/postgres service_role=X/postgres',
  'a function created by a migration grants EXECUTE to service_role and nobody else');

select * from finish();
rollback;
