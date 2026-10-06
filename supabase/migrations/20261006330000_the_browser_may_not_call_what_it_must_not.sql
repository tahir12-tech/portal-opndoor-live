-- THE BROWSER MAY NOT CALL WHAT IT MUST NOT.
--
-- 263 SECURITY DEFINER functions in public. 193 of them were executable by
-- `authenticated`, 35 by `anon`, and almost none of that was ever decided:
-- Postgres grants EXECUTE to PUBLIC on every function by default, and a
-- migration has to say `revoke` to stop it. Most of these never said it.
--
-- So `revoke ... from authenticated` on its own has been giving false
-- comfort. Measured on dev: revoke from authenticated alone and
-- has_function_privilege('authenticated', ...) is still TRUE, because PUBLIC
-- still holds it. Every revoke below names public and anon explicitly, which
-- is also what the CI pattern check in migrationPatterns.test.ts insists on
-- for every future one.
--
-- Four buckets, by what actually calls the function -- computed from
-- pg_policy, pg_proc.prorettype and every `.rpc('...')` literal in src, not
-- from a reading of the names.
--
-- THE ONE THAT SURPRISED ME, and the reason the predicates below keep their
-- grant: an RLS policy expression IS permission-checked against the querying
-- role. The first measurement said otherwise and was wrong, because it
-- revoked from `authenticated` while PUBLIC still held the privilege -- the
-- exact false comfort this migration is about. Revoking from public, anon and
-- authenticated together turns `select from applications` into
-- "permission denied for function app_may_reach_application_org". Revoke the
-- 17 predicates and the estate stops reading its own data.

-- ========================================================================
-- TRIGGER FUNCTIONS -- nobody calls these by name (23)
-- ========================================================================
-- A trigger fires as the table owner and never checks EXECUTE against the
-- caller, so a grant buys nothing, and a PUBLIC grant lets anyone run a guard
-- out of context with whatever NEW they care to construct.
revoke all on function activate_user_on_factor_verify() from public, anon;
revoke all on function activate_user_on_factor_verify() from authenticated, service_role;
revoke all on function alert_ops_on_failure() from public, anon;
revoke all on function alert_ops_on_failure() from authenticated, service_role;
revoke all on function applications_emit_partner_webhook() from public, anon;
revoke all on function applications_emit_partner_webhook() from authenticated, service_role;
revoke all on function applications_sandbox_write_guard() from public, anon;
revoke all on function applications_sandbox_write_guard() from authenticated, service_role;
revoke all on function assert_application_attributed() from public, anon;
revoke all on function assert_application_attributed() from authenticated, service_role;
revoke all on function assert_application_complete() from public, anon;
revoke all on function assert_application_complete() from authenticated, service_role;
revoke all on function assert_not_applicant() from public, anon;
revoke all on function assert_not_applicant() from authenticated, service_role;
revoke all on function assert_not_staff() from public, anon;
revoke all on function assert_not_staff() from authenticated, service_role;
revoke all on function assert_tenancy_shares() from public, anon;
revoke all on function assert_tenancy_shares() from authenticated, service_role;
revoke all on function enforce_agreement_exclusivity() from public, anon;
revoke all on function enforce_agreement_exclusivity() from authenticated, service_role;
revoke all on function enforce_one_rate_per_party() from public, anon;
revoke all on function enforce_one_rate_per_party() from authenticated, service_role;
revoke all on function hubspot_follow_partner_slug() from public, anon;
revoke all on function hubspot_follow_partner_slug() from authenticated, service_role;
revoke all on function hubspot_seed_partner_cursor() from public, anon;
revoke all on function hubspot_seed_partner_cursor() from authenticated, service_role;
revoke all on function hubspot_seed_partner_map() from public, anon;
revoke all on function hubspot_seed_partner_map() from authenticated, service_role;
revoke all on function partner_api_key_rail_guard() from public, anon;
revoke all on function partner_api_key_rail_guard() from authenticated, service_role;
revoke all on function partner_webhook_endpoint_rail_guard() from public, anon;
revoke all on function partner_webhook_endpoint_rail_guard() from authenticated, service_role;
revoke all on function rel_mark_introduced() from public, anon;
revoke all on function rel_mark_introduced() from authenticated, service_role;
revoke all on function rel_mark_transacted() from public, anon;
revoke all on function rel_mark_transacted() from authenticated, service_role;
revoke all on function rel_sync_user_attached() from public, anon;
revoke all on function rel_sync_user_attached() from authenticated, service_role;
revoke all on function sync_contact_partner() from public, anon;
revoke all on function sync_contact_partner() from authenticated, service_role;
revoke all on function user_must_hold_a_position() from public, anon;
revoke all on function user_must_hold_a_position() from authenticated, service_role;
revoke all on function users_commission_tick_guard() from public, anon;
revoke all on function users_commission_tick_guard() from authenticated, service_role;
revoke all on function users_notifications_tick_guard() from public, anon;
revoke all on function users_notifications_tick_guard() from authenticated, service_role;

-- ========================================================================
-- POLICY PREDICATES -- authenticated, and this is load-bearing (17)
-- ========================================================================
-- An RLS policy expression IS permission-checked against the querying role.
-- Revoke these and the estate stops reading its own data.
revoke all on function app_has_scope() from public, anon;
revoke all on function app_has_scope() from authenticated;
grant execute on function app_has_scope() to authenticated, service_role;
revoke all on function app_may_reach_agency(uuid) from public, anon;
revoke all on function app_may_reach_agency(uuid) from authenticated;
grant execute on function app_may_reach_agency(uuid) to authenticated, service_role;
revoke all on function app_may_reach_application_org(uuid,uuid,uuid) from public, anon;
revoke all on function app_may_reach_application_org(uuid,uuid,uuid) from authenticated;
grant execute on function app_may_reach_application_org(uuid,uuid,uuid) to authenticated, service_role;
revoke all on function app_may_reach_branch(uuid) from public, anon;
revoke all on function app_may_reach_branch(uuid) from authenticated;
grant execute on function app_may_reach_branch(uuid) to authenticated, service_role;
revoke all on function app_may_reach_contact(uuid,uuid,uuid) from public, anon;
revoke all on function app_may_reach_contact(uuid,uuid,uuid) from authenticated;
grant execute on function app_may_reach_contact(uuid,uuid,uuid) to authenticated, service_role;
revoke all on function app_may_reach_user(uuid) from public, anon;
revoke all on function app_may_reach_user(uuid) from authenticated;
grant execute on function app_may_reach_user(uuid) to authenticated, service_role;
revoke all on function app_partner() from public, anon;
revoke all on function app_partner() from authenticated;
grant execute on function app_partner() to authenticated, service_role;
revoke all on function app_reachable_agency(uuid) from public, anon;
revoke all on function app_reachable_agency(uuid) from authenticated;
grant execute on function app_reachable_agency(uuid) to authenticated, service_role;
revoke all on function app_reachable_group(uuid,uuid) from public, anon;
revoke all on function app_reachable_group(uuid,uuid) from authenticated;
grant execute on function app_reachable_group(uuid,uuid) to authenticated, service_role;
revoke all on function app_role() from public, anon;
revoke all on function app_role() from authenticated;
grant execute on function app_role() to authenticated, service_role;
revoke all on function app_scope_branches() from public, anon;
revoke all on function app_scope_branches() from authenticated;
grant execute on function app_scope_branches() to authenticated, service_role;
revoke all on function is_admin() from public, anon;
revoke all on function is_admin() from authenticated;
grant execute on function is_admin() to authenticated, service_role;
revoke all on function is_opndoor_staff() from public, anon;
revoke all on function is_opndoor_staff() from authenticated;
grant execute on function is_opndoor_staff() to authenticated, service_role;
revoke all on function is_our_estate_partner(uuid) from public, anon;
revoke all on function is_our_estate_partner(uuid) from authenticated;
grant execute on function is_our_estate_partner(uuid) to authenticated, service_role;
revoke all on function level_rank_of(uuid) from public, anon;
revoke all on function level_rank_of(uuid) from authenticated;
grant execute on function level_rank_of(uuid) to authenticated, service_role;
revoke all on function may_see_commission() from public, anon;
revoke all on function may_see_commission() from authenticated;
grant execute on function may_see_commission() to authenticated, service_role;
revoke all on function user_within_caller_scope(uuid) from public, anon;
revoke all on function user_within_caller_scope(uuid) from authenticated;
grant execute on function user_within_caller_scope(uuid) to authenticated, service_role;

-- ========================================================================
-- CALLED WITH A USER'S JWT -- the browser, and the edge functions that act AS the caller (96)
-- ========================================================================
-- Two sources, not one. Every `.rpc('...')` literal in src, AND every
-- `userClient.rpc("...")` in supabase/functions -- create-referral,
-- send-deed-to-agent and the rest deliberately call as the signed-in user so
-- the function's own reach check applies to them. Classifying from src alone
-- put create_referral_target in the service bucket and broke the referral
-- path; the pgTAP suite caught it, which is the argument for the suite.
revoke all on function add_application_note(text,text) from public, anon;
grant execute on function add_application_note(text,text) to authenticated, service_role;
revoke all on function admin_add_agency(text,text,text,text,text,text) from public, anon;
grant execute on function admin_add_agency(text,text,text,text,text,text) to authenticated, service_role;
revoke all on function admin_add_branch(uuid,text,text,text,text,text) from public, anon;
grant execute on function admin_add_branch(uuid,text,text,text,text,text) to authenticated, service_role;
revoke all on function admin_break_glass_revoke_key(text,text) from public, anon;
grant execute on function admin_break_glass_revoke_key(text,text) to authenticated, service_role;
revoke all on function admin_cancel_invite(uuid) from public, anon;
grant execute on function admin_cancel_invite(uuid) to authenticated, service_role;
revoke all on function admin_create_agency_and_branch(text,text,text,numeric,numeric,text,uuid) from public, anon;
grant execute on function admin_create_agency_and_branch(text,text,text,numeric,numeric,text,uuid) to authenticated, service_role;
revoke all on function admin_delete_org_shape(uuid[],uuid) from public, anon;
grant execute on function admin_delete_org_shape(uuid[],uuid) to authenticated, service_role;
revoke all on function admin_reset_user_mfa(uuid) from public, anon;
grant execute on function admin_reset_user_mfa(uuid) to authenticated, service_role;
revoke all on function admin_set_user_status(uuid,text) from public, anon;
grant execute on function admin_set_user_status(uuid,text) to authenticated, service_role;
revoke all on function admin_update_user_name(uuid,text) from public, anon;
grant execute on function admin_update_user_name(uuid,text) to authenticated, service_role;
revoke all on function admin_update_user_role(uuid,text) from public, anon;
grant execute on function admin_update_user_role(uuid,text) to authenticated, service_role;
revoke all on function agency_branches_for_match(uuid) from public, anon;
grant execute on function agency_branches_for_match(uuid) to authenticated, service_role;
revoke all on function agency_match_queue() from public, anon;
grant execute on function agency_match_queue() to authenticated, service_role;
revoke all on function agent_rail_funnel(text) from public, anon;
grant execute on function agent_rail_funnel(text) to authenticated, service_role;
revoke all on function agreement_for_agency(uuid) from public, anon;
grant execute on function agreement_for_agency(uuid) to authenticated, service_role;
revoke all on function amend_tenancy_start(uuid,date) from public, anon;
grant execute on function amend_tenancy_start(uuid,date) to authenticated, service_role;
revoke all on function application_commission_rates(uuid) from public, anon;
grant execute on function application_commission_rates(uuid) to authenticated, service_role;
revoke all on function application_journey(text) from public, anon;
grant execute on function application_journey(text) to authenticated, service_role;
revoke all on function assert_may_grant_level(text) from public, anon;
grant execute on function assert_may_grant_level(text) to authenticated, service_role;
revoke all on function attach_user_to_agency(uuid,uuid) from public, anon;
grant execute on function attach_user_to_agency(uuid,uuid) to authenticated, service_role;
revoke all on function authorise_password_reset(uuid) from public, anon;
grant execute on function authorise_password_reset(uuid) to authenticated, service_role;
revoke all on function clear_branch_deed_recipient(uuid) from public, anon;
grant execute on function clear_branch_deed_recipient(uuid) to authenticated, service_role;
revoke all on function commission_preview(text,uuid,numeric) from public, anon;
grant execute on function commission_preview(text,uuid,numeric) to authenticated, service_role;
revoke all on function commission_split_batch(uuid[]) from public, anon;
grant execute on function commission_split_batch(uuid[]) to authenticated, service_role;
revoke all on function commission_statement_ref(text,text) from public, anon;
grant execute on function commission_statement_ref(text,text) to authenticated, service_role;
revoke all on function confirm_org_entity(text,uuid) from public, anon;
grant execute on function confirm_org_entity(text,uuid) to authenticated, service_role;
revoke all on function count_pending_tenancy_corrections() from public, anon;
grant execute on function count_pending_tenancy_corrections() to authenticated, service_role;
revoke all on function create_agency_group(text,text) from public, anon;
grant execute on function create_agency_group(text,text) to authenticated, service_role;
revoke all on function create_agreement(text,uuid,text,text,text,jsonb,jsonb,text,boolean,boolean) from public, anon;
grant execute on function create_agreement(text,uuid,text,text,text,jsonb,jsonb,text,boolean,boolean) to authenticated, service_role;
revoke all on function create_joint_referral(uuid,jsonb,text,text,text,text,text,numeric,date) from public, anon;
grant execute on function create_joint_referral(uuid,jsonb,text,text,text,text,text,numeric,date) to authenticated, service_role;
revoke all on function create_partner(text,text,date,numeric,numeric,text,boolean,boolean) from public, anon;
grant execute on function create_partner(text,text,date,numeric,numeric,text,boolean,boolean) to authenticated, service_role;
revoke all on function create_referral(uuid,text,text,text,date,text,text,text,text,text,text,text,numeric,date) from public, anon;
grant execute on function create_referral(uuid,text,text,text,date,text,text,text,text,text,text,text,numeric,date) to authenticated, service_role;
revoke all on function create_referral_target(text,text,text,text,text,text,text,text,text) from public, anon;
grant execute on function create_referral_target(text,text,text,text,text,text,text,text,text) to authenticated, service_role;
revoke all on function create_referral_target(text,text,text,text,text,text,text,text) from public, anon;
grant execute on function create_referral_target(text,text,text,text,text,text,text,text) to authenticated, service_role;
revoke all on function cron_health() from public, anon;
grant execute on function cron_health() to authenticated, service_role;
revoke all on function decline_application(text,text) from public, anon;
grant execute on function decline_application(text,text) to authenticated, service_role;
revoke all on function dev_api_errors_by_method(uuid,integer) from public, anon;
grant execute on function dev_api_errors_by_method(uuid,integer) to authenticated, service_role;
revoke all on function dev_api_keys(uuid) from public, anon;
grant execute on function dev_api_keys(uuid) to authenticated, service_role;
revoke all on function dev_api_logs(uuid,text,integer,integer) from public, anon;
grant execute on function dev_api_logs(uuid,text,integer,integer) to authenticated, service_role;
revoke all on function dev_api_stats(uuid,integer) from public, anon;
grant execute on function dev_api_stats(uuid,integer) to authenticated, service_role;
revoke all on function dev_api_timeseries(uuid,integer) from public, anon;
grant execute on function dev_api_timeseries(uuid,integer) to authenticated, service_role;
revoke all on function dev_delete_api_key(uuid) from public, anon;
grant execute on function dev_delete_api_key(uuid) to authenticated, service_role;
revoke all on function dev_delete_webhook_endpoint(uuid) from public, anon;
grant execute on function dev_delete_webhook_endpoint(uuid) to authenticated, service_role;
revoke all on function dev_live_application_counts(uuid) from public, anon;
grant execute on function dev_live_application_counts(uuid) to authenticated, service_role;
revoke all on function dev_live_applications(uuid,text,integer) from public, anon;
grant execute on function dev_live_applications(uuid,text,integer) to authenticated, service_role;
revoke all on function dev_partner_options() from public, anon;
grant execute on function dev_partner_options() to authenticated, service_role;
revoke all on function dev_purge_sandbox(uuid) from public, anon;
grant execute on function dev_purge_sandbox(uuid) to authenticated, service_role;
revoke all on function dev_replay_webhook_delivery(uuid) from public, anon;
grant execute on function dev_replay_webhook_delivery(uuid) to authenticated, service_role;
revoke all on function dev_revoke_api_key(uuid) from public, anon;
grant execute on function dev_revoke_api_key(uuid) to authenticated, service_role;
revoke all on function dev_sandbox_applications(uuid,text,integer) from public, anon;
grant execute on function dev_sandbox_applications(uuid,text,integer) to authenticated, service_role;
revoke all on function dev_sandbox_counts(uuid) from public, anon;
grant execute on function dev_sandbox_counts(uuid) to authenticated, service_role;
revoke all on function dev_update_webhook_endpoint(uuid,text[],boolean) from public, anon;
grant execute on function dev_update_webhook_endpoint(uuid,text[],boolean) to authenticated, service_role;
revoke all on function dev_webhook_deliveries(uuid,uuid,text,integer) from public, anon;
grant execute on function dev_webhook_deliveries(uuid,uuid,text,integer) to authenticated, service_role;
revoke all on function dev_webhook_endpoint_secret(uuid) from public, anon;
grant execute on function dev_webhook_endpoint_secret(uuid) to authenticated, service_role;
revoke all on function dev_webhook_endpoints(uuid) from public, anon;
grant execute on function dev_webhook_endpoints(uuid) to authenticated, service_role;
revoke all on function dev_webhook_stats(uuid,integer) from public, anon;
grant execute on function dev_webhook_stats(uuid,integer) to authenticated, service_role;
revoke all on function dismiss_agency_match(uuid,text) from public, anon;
grant execute on function dismiss_agency_match(uuid,text) to authenticated, service_role;
revoke all on function end_agreement(uuid) from public, anon;
grant execute on function end_agreement(uuid) to authenticated, service_role;
revoke all on function list_managed_users() from public, anon;
grant execute on function list_managed_users() to authenticated, service_role;
revoke all on function log_view_as(text,text) from public, anon;
grant execute on function log_view_as(text,text) to authenticated, service_role;
revoke all on function mark_withdrawn(text,text,text) from public, anon;
grant execute on function mark_withdrawn(text,text,text) to authenticated, service_role;
revoke all on function my_application_delivery(uuid) from public, anon;
grant execute on function my_application_delivery(uuid) to authenticated, service_role;
revoke all on function my_org_shape(uuid) from public, anon;
grant execute on function my_org_shape(uuid) to authenticated, service_role;
revoke all on function my_partner_rates() from public, anon;
grant execute on function my_partner_rates() to authenticated, service_role;
revoke all on function my_partner_summary() from public, anon;
grant execute on function my_partner_summary() to authenticated, service_role;
revoke all on function org_add_contact(uuid,uuid,text,text,text,text,boolean) from public, anon;
grant execute on function org_add_contact(uuid,uuid,text,text,text,text,boolean) to authenticated, service_role;
revoke all on function org_deed_readiness() from public, anon;
grant execute on function org_deed_readiness() to authenticated, service_role;
revoke all on function org_remove_contact(uuid) from public, anon;
grant execute on function org_remove_contact(uuid) to authenticated, service_role;
revoke all on function org_set_primary_contact(uuid) from public, anon;
grant execute on function org_set_primary_contact(uuid) to authenticated, service_role;
revoke all on function org_update_contact(uuid,text,text,text,text,boolean) from public, anon;
grant execute on function org_update_contact(uuid,text,text,text,text,boolean) to authenticated, service_role;
revoke all on function origin_is_agent_estate(text,text,text) from public, anon;
grant execute on function origin_is_agent_estate(text,text,text) to authenticated, service_role;
revoke all on function origin_referencing_mode(text,text,text) from public, anon;
grant execute on function origin_referencing_mode(text,text,text) to authenticated, service_role;
revoke all on function partner_active_key_count(text) from public, anon;
grant execute on function partner_active_key_count(text) to authenticated, service_role;
revoke all on function reconciliation_queue() from public, anon;
grant execute on function reconciliation_queue() to authenticated, service_role;
revoke all on function referral_fee_preview(text,text,text,numeric,numeric[]) from public, anon;
grant execute on function referral_fee_preview(text,text,text,numeric,numeric[]) to authenticated, service_role;
revoke all on function referrer_league(timestamp with time zone,timestamp with time zone,text) from public, anon;
grant execute on function referrer_league(timestamp with time zone,timestamp with time zone,text) to authenticated, service_role;
revoke all on function resolve_agency_match(uuid,uuid) from public, anon;
grant execute on function resolve_agency_match(uuid,uuid) to authenticated, service_role;
revoke all on function send_deed_to_agent(uuid,text,boolean) from public, anon;
grant execute on function send_deed_to_agent(uuid,text,boolean) to authenticated, service_role;
revoke all on function send_deed_to_landlord(uuid,text,text) from public, anon;
grant execute on function send_deed_to_landlord(uuid,text,text) to authenticated, service_role;
revoke all on function set_agency_group(uuid,uuid) from public, anon;
grant execute on function set_agency_group(uuid,uuid) to authenticated, service_role;
revoke all on function set_agency_level(uuid,text) from public, anon;
grant execute on function set_agency_level(uuid,text) to authenticated, service_role;
revoke all on function set_agency_rates(uuid,numeric,numeric) from public, anon;
grant execute on function set_agency_rates(uuid,numeric,numeric) to authenticated, service_role;
revoke all on function set_agency_referencing_mode(uuid,text) from public, anon;
grant execute on function set_agency_referencing_mode(uuid,text) to authenticated, service_role;
revoke all on function set_app_setting_num(text,numeric) from public, anon;
grant execute on function set_app_setting_num(text,numeric) to authenticated, service_role;
revoke all on function set_application_status(uuid,text) from public, anon;
grant execute on function set_application_status(uuid,text) to authenticated, service_role;
revoke all on function set_branch_deed_recipient(uuid,uuid) from public, anon;
grant execute on function set_branch_deed_recipient(uuid,uuid) to authenticated, service_role;
revoke all on function set_group_rates(uuid,numeric,numeric) from public, anon;
grant execute on function set_group_rates(uuid,numeric,numeric) to authenticated, service_role;
revoke all on function set_node_rate(text,uuid,numeric,boolean) from public, anon;
grant execute on function set_node_rate(text,uuid,numeric,boolean) to authenticated, service_role;
revoke all on function set_receives_commission_statements(uuid,boolean) from public, anon;
grant execute on function set_receives_commission_statements(uuid,boolean) to authenticated, service_role;
revoke all on function set_receives_notifications(uuid,boolean) from public, anon;
grant execute on function set_receives_notifications(uuid,boolean) to authenticated, service_role;
revoke all on function set_referrer_leaderboard_mode(text,text) from public, anon;
grant execute on function set_referrer_leaderboard_mode(text,text) to authenticated, service_role;
revoke all on function set_user_scope(uuid,text,uuid) from public, anon;
grant execute on function set_user_scope(uuid,text,uuid) to authenticated, service_role;
revoke all on function staff_payment_page_token(text) from public, anon;
grant execute on function staff_payment_page_token(text) to authenticated, service_role;
revoke all on function trigger_crm_sync() from public, anon;
grant execute on function trigger_crm_sync() to authenticated, service_role;
revoke all on function update_partner_settings(text,text,text,date,numeric,numeric,text,boolean,boolean) from public, anon;
grant execute on function update_partner_settings(text,text,text,date,numeric,numeric,text,boolean,boolean) to authenticated, service_role;
revoke all on function viewer_runs_eligibility_journey(text) from public, anon;
grant execute on function viewer_runs_eligibility_journey(text) to authenticated, service_role;

-- ========================================================================
-- EVERYTHING ELSE -- service_role only (129)
-- ========================================================================
-- Cron bodies, internal helpers and the machinery behind the RPCs above.
-- Reached only through `service.rpc(...)`, which holds service_role, and the
-- tenant rail only ever arrives through the tenant-portal and payment-page
-- edge functions.
revoke all on function active_agreement_on(text,uuid) from public, anon;
revoke all on function active_agreement_on(text,uuid) from authenticated;
grant execute on function active_agreement_on(text,uuid) to service_role;
revoke all on function address_history_months(uuid) from public, anon;
revoke all on function address_history_months(uuid) from authenticated;
grant execute on function address_history_months(uuid) to service_role;
revoke all on function agency_level_of(uuid) from public, anon;
revoke all on function agency_level_of(uuid) from authenticated;
grant execute on function agency_level_of(uuid) to service_role;
revoke all on function agency_notification_recipients(uuid) from public, anon;
revoke all on function agency_notification_recipients(uuid) from authenticated;
grant execute on function agency_notification_recipients(uuid) to service_role;
revoke all on function agency_weekly_digest(timestamp with time zone,timestamp with time zone) from public, anon;
revoke all on function agency_weekly_digest(timestamp with time zone,timestamp with time zone) from authenticated;
grant execute on function agency_weekly_digest(timestamp with time zone,timestamp with time zone) to service_role;
revoke all on function agreement_conflicts(text,uuid,text) from public, anon;
revoke all on function agreement_conflicts(text,uuid,text) from authenticated;
grant execute on function agreement_conflicts(text,uuid,text) to service_role;
revoke all on function agreement_max_rate(uuid) from public, anon;
revoke all on function agreement_max_rate(uuid) from authenticated;
grant execute on function agreement_max_rate(uuid) to service_role;
revoke all on function agreement_party_name(uuid) from public, anon;
revoke all on function agreement_party_name(uuid) from authenticated;
grant execute on function agreement_party_name(uuid) to service_role;
revoke all on function agreement_period_start(uuid) from public, anon;
revoke all on function agreement_period_start(uuid) from authenticated;
grant execute on function agreement_period_start(uuid) to service_role;
revoke all on function agreement_volume(uuid,uuid) from public, anon;
revoke all on function agreement_volume(uuid,uuid) from authenticated;
grant execute on function agreement_volume(uuid,uuid) to service_role;
revoke all on function all_in_agreement_below(text,uuid) from public, anon;
revoke all on function all_in_agreement_below(text,uuid) from authenticated;
grant execute on function all_in_agreement_below(text,uuid) to service_role;
revoke all on function all_in_agreements_below(text,uuid) from public, anon;
revoke all on function all_in_agreements_below(text,uuid) from authenticated;
grant execute on function all_in_agreements_below(text,uuid) to service_role;
revoke all on function all_in_breach_detail(text,uuid,numeric) from public, anon;
revoke all on function all_in_breach_detail(text,uuid,numeric) from authenticated;
grant execute on function all_in_breach_detail(text,uuid,numeric) to service_role;
revoke all on function app_may_reach_application(uuid) from public, anon;
revoke all on function app_may_reach_application(uuid) from authenticated;
grant execute on function app_may_reach_application(uuid) to service_role;
revoke all on function app_scope_branches_for(uuid) from public, anon;
revoke all on function app_scope_branches_for(uuid) from authenticated;
grant execute on function app_scope_branches_for(uuid) to service_role;
revoke all on function app_scoped_agencies() from public, anon;
revoke all on function app_scoped_agencies() from authenticated;
grant execute on function app_scoped_agencies() to service_role;
revoke all on function app_user_in_scope(uuid) from public, anon;
revoke all on function app_user_in_scope(uuid) from authenticated;
grant execute on function app_user_in_scope(uuid) to service_role;
revoke all on function application_annual_income(uuid) from public, anon;
revoke all on function application_annual_income(uuid) from authenticated;
grant execute on function application_annual_income(uuid) to service_role;
revoke all on function application_attribution(uuid) from public, anon;
revoke all on function application_attribution(uuid) from authenticated;
grant execute on function application_attribution(uuid) to service_role;
revoke all on function application_channel(uuid) from public, anon;
revoke all on function application_channel(uuid) from authenticated;
grant execute on function application_channel(uuid) to service_role;
revoke all on function application_is_agent_estate(uuid) from public, anon;
revoke all on function application_is_agent_estate(uuid) from authenticated;
grant execute on function application_is_agent_estate(uuid) to service_role;
revoke all on function application_rent_basis(uuid) from public, anon;
revoke all on function application_rent_basis(uuid) from authenticated;
grant execute on function application_rent_basis(uuid) to service_role;
revoke all on function apply_deed_executed(text,text) from public, anon;
revoke all on function apply_deed_executed(text,text) from authenticated;
grant execute on function apply_deed_executed(text,text) to service_role;
revoke all on function apply_stripe_payment(uuid,text,numeric,text) from public, anon;
revoke all on function apply_stripe_payment(uuid,text,numeric,text) from authenticated;
grant execute on function apply_stripe_payment(uuid,text,numeric,text) to service_role;
revoke all on function apply_stripe_refund(text,text,numeric) from public, anon;
revoke all on function apply_stripe_refund(text,text,numeric) from authenticated;
grant execute on function apply_stripe_refund(text,text,numeric) to service_role;
revoke all on function assert_agreement_within_cap(uuid) from public, anon;
revoke all on function assert_agreement_within_cap(uuid) from authenticated;
grant execute on function assert_agreement_within_cap(uuid) to service_role;
revoke all on function assert_may_act_on_user(uuid) from public, anon;
revoke all on function assert_may_act_on_user(uuid) from authenticated;
grant execute on function assert_may_act_on_user(uuid) to service_role;
revoke all on function assert_may_create_org_on_the_fly() from public, anon;
revoke all on function assert_may_create_org_on_the_fly() from authenticated;
grant execute on function assert_may_create_org_on_the_fly() to service_role;
revoke all on function branch_notification_fallback_exists(uuid) from public, anon;
revoke all on function branch_notification_fallback_exists(uuid) from authenticated;
grant execute on function branch_notification_fallback_exists(uuid) to service_role;
revoke all on function bump_rate_limit(text,integer,integer) from public, anon;
revoke all on function bump_rate_limit(text,integer,integer) from authenticated;
grant execute on function bump_rate_limit(text,integer,integer) to service_role;
revoke all on function bump_rate_limit_state(text,integer,integer,boolean) from public, anon;
revoke all on function bump_rate_limit_state(text,integer,integer,boolean) from authenticated;
grant execute on function bump_rate_limit_state(text,integer,integer,boolean) to service_role;
revoke all on function claim_partner_webhook_deliveries(integer) from public, anon;
revoke all on function claim_partner_webhook_deliveries(integer) from authenticated;
grant execute on function claim_partner_webhook_deliveries(integer) to service_role;
revoke all on function claim_tenancy_deed(uuid) from public, anon;
revoke all on function claim_tenancy_deed(uuid) from authenticated;
grant execute on function claim_tenancy_deed(uuid) to service_role;
revoke all on function claim_tenant_invite(uuid,uuid) from public, anon;
revoke all on function claim_tenant_invite(uuid,uuid) from authenticated;
grant execute on function claim_tenant_invite(uuid,uuid) to service_role;
revoke all on function clear_awaiting_staff_send(uuid) from public, anon;
revoke all on function clear_awaiting_staff_send(uuid) from authenticated;
grant execute on function clear_awaiting_staff_send(uuid) to service_role;
revoke all on function clear_deed_failures(uuid) from public, anon;
revoke all on function clear_deed_failures(uuid) from authenticated;
grant execute on function clear_deed_failures(uuid) to service_role;
revoke all on function commission_split(uuid,uuid,integer) from public, anon;
revoke all on function commission_split(uuid,uuid,integer) from authenticated;
grant execute on function commission_split(uuid,uuid,integer) to service_role;
revoke all on function commission_split_for(uuid,uuid,uuid,numeric) from public, anon;
revoke all on function commission_split_for(uuid,uuid,uuid,numeric) from authenticated;
grant execute on function commission_split_for(uuid,uuid,uuid,numeric) to service_role;
revoke all on function commission_statement_lines(date) from public, anon;
revoke all on function commission_statement_lines(date) from authenticated;
grant execute on function commission_statement_lines(date) to service_role;
revoke all on function commission_statement_party(uuid) from public, anon;
revoke all on function commission_statement_party(uuid) from authenticated;
grant execute on function commission_statement_party(uuid) to service_role;
revoke all on function commission_statement_payees(date) from public, anon;
revoke all on function commission_statement_payees(date) from authenticated;
grant execute on function commission_statement_payees(date) to service_role;
revoke all on function commission_statement_recipients(text,uuid) from public, anon;
revoke all on function commission_statement_recipients(text,uuid) from authenticated;
grant execute on function commission_statement_recipients(text,uuid) to service_role;
revoke all on function commission_tick_target_within_caller(uuid) from public, anon;
revoke all on function commission_tick_target_within_caller(uuid) from authenticated;
grant execute on function commission_tick_target_within_caller(uuid) to service_role;
revoke all on function commission_total(uuid,uuid,integer) from public, anon;
revoke all on function commission_total(uuid,uuid,integer) from authenticated;
grant execute on function commission_total(uuid,uuid,integer) to service_role;
revoke all on function covering_all_in_agreement(text,uuid) from public, anon;
revoke all on function covering_all_in_agreement(text,uuid) from authenticated;
grant execute on function covering_all_in_agreement(text,uuid) to service_role;
revoke all on function create_direct_application(uuid,numeric,date,text,text,text,text,text) from public, anon;
revoke all on function create_direct_application(uuid,numeric,date,text,text,text,text,text) from authenticated;
grant execute on function create_direct_application(uuid,numeric,date,text,text,text,text,text) to service_role;
revoke all on function create_invited_user(uuid,text,text,text,uuid,uuid,boolean,text,uuid) from public, anon;
revoke all on function create_invited_user(uuid,text,text,text,uuid,uuid,boolean,text,uuid) from authenticated;
grant execute on function create_invited_user(uuid,text,text,text,uuid,uuid,boolean,text,uuid) to service_role;
revoke all on function create_referencing_inbound_application(bigint,uuid,text,text,text,date,text,text,text,text,text,numeric,date,text,text,text,text,text,text) from public, anon;
revoke all on function create_referencing_inbound_application(bigint,uuid,text,text,text,date,text,text,text,text,text,numeric,date,text,text,text,text,text,text) from authenticated;
grant execute on function create_referencing_inbound_application(bigint,uuid,text,text,text,date,text,text,text,text,text,numeric,date,text,text,text,text,text,text) to service_role;
revoke all on function create_referral_api(uuid,boolean,uuid,uuid,text,text,text,date,text,text,text,text,text,text,text,numeric,date) from public, anon;
revoke all on function create_referral_api(uuid,boolean,uuid,uuid,text,text,text,date,text,text,text,text,text,text,text,numeric,date) from authenticated;
grant execute on function create_referral_api(uuid,boolean,uuid,uuid,text,text,text,date,text,text,text,text,text,text,text,numeric,date) to service_role;
revoke all on function decline_application_by_token(uuid,text) from public, anon;
revoke all on function decline_application_by_token(uuid,text) from authenticated;
grant execute on function decline_application_by_token(uuid,text) to service_role;
revoke all on function deed_delivery_target(uuid) from public, anon;
revoke all on function deed_delivery_target(uuid) from authenticated;
grant execute on function deed_delivery_target(uuid) to service_role;
revoke all on function deed_people_target(uuid) from public, anon;
revoke all on function deed_people_target(uuid) from authenticated;
grant execute on function deed_people_target(uuid) to service_role;
revoke all on function deed_target(uuid) from public, anon;
revoke all on function deed_target(uuid) from authenticated;
grant execute on function deed_target(uuid) to service_role;
revoke all on function deeds_awaiting_generation(interval,integer) from public, anon;
revoke all on function deeds_awaiting_generation(interval,integer) from authenticated;
grant execute on function deeds_awaiting_generation(interval,integer) to service_role;
revoke all on function detach_user_from_agency(uuid,uuid) from public, anon;
revoke all on function detach_user_from_agency(uuid,uuid) from authenticated;
grant execute on function detach_user_from_agency(uuid,uuid) to service_role;
revoke all on function dev_api_key_deletable(uuid) from public, anon;
revoke all on function dev_api_key_deletable(uuid) from authenticated;
grant execute on function dev_api_key_deletable(uuid) to service_role;
revoke all on function dev_centre_partner() from public, anon;
revoke all on function dev_centre_partner() from authenticated;
grant execute on function dev_centre_partner() to service_role;
revoke all on function dev_endpoint_deletable(uuid) from public, anon;
revoke all on function dev_endpoint_deletable(uuid) from authenticated;
grant execute on function dev_endpoint_deletable(uuid) to service_role;
revoke all on function dev_endpoint_for_test(uuid,uuid) from public, anon;
revoke all on function dev_endpoint_for_test(uuid,uuid) from authenticated;
grant execute on function dev_endpoint_for_test(uuid,uuid) to service_role;
revoke all on function dev_sandbox_application_document(uuid) from public, anon;
revoke all on function dev_sandbox_application_document(uuid) from authenticated;
grant execute on function dev_sandbox_application_document(uuid) to service_role;
revoke all on function duplicate_agency_groups() from public, anon;
revoke all on function duplicate_agency_groups() from authenticated;
grant execute on function duplicate_agency_groups() to service_role;
revoke all on function effective_primary_contact_route(uuid,uuid) from public, anon;
revoke all on function effective_primary_contact_route(uuid,uuid) from authenticated;
grant execute on function effective_primary_contact_route(uuid,uuid) to service_role;
revoke all on function eligibility_fee_paid(uuid) from public, anon;
revoke all on function eligibility_fee_paid(uuid) from authenticated;
grant execute on function eligibility_fee_paid(uuid) to service_role;
revoke all on function enqueue_partner_webhook(uuid,text) from public, anon;
revoke all on function enqueue_partner_webhook(uuid,text) from authenticated;
grant execute on function enqueue_partner_webhook(uuid,text) to service_role;
revoke all on function expire_stale_applications(date) from public, anon;
revoke all on function expire_stale_applications(date) from authenticated;
grant execute on function expire_stale_applications(date) to service_role;
revoke all on function fire_expiry_reminders(date) from public, anon;
revoke all on function fire_expiry_reminders(date) from authenticated;
grant execute on function fire_expiry_reminders(date) to service_role;
revoke all on function fire_payment_reminders(date) from public, anon;
revoke all on function fire_payment_reminders(date) from authenticated;
grant execute on function fire_payment_reminders(date) to service_role;
revoke all on function fire_renewal_notices(date) from public, anon;
revoke all on function fire_renewal_notices(date) from authenticated;
grant execute on function fire_renewal_notices(date) to service_role;
revoke all on function freeze_commission_lines(uuid,uuid,uuid,integer,numeric,numeric,numeric[],integer) from public, anon;
revoke all on function freeze_commission_lines(uuid,uuid,uuid,integer,numeric,numeric,numeric[],integer) from authenticated;
grant execute on function freeze_commission_lines(uuid,uuid,uuid,integer,numeric,numeric,numeric[],integer) to service_role;
revoke all on function hubspot_mark_cursor(uuid,timestamp with time zone,uuid) from public, anon;
revoke all on function hubspot_mark_cursor(uuid,timestamp with time zone,uuid) from authenticated;
grant execute on function hubspot_mark_cursor(uuid,timestamp with time zone,uuid) to service_role;
revoke all on function hubspot_mark_stuck(uuid,text) from public, anon;
revoke all on function hubspot_mark_stuck(uuid,text) from authenticated;
grant execute on function hubspot_mark_stuck(uuid,text) to service_role;
revoke all on function hubspot_org_context(uuid,uuid) from public, anon;
revoke all on function hubspot_org_context(uuid,uuid) from authenticated;
grant execute on function hubspot_org_context(uuid,uuid) to service_role;
revoke all on function hubspot_pending_events(uuid,timestamp with time zone,uuid,text[],integer) from public, anon;
revoke all on function hubspot_pending_events(uuid,timestamp with time zone,uuid,text[],integer) from authenticated;
grant execute on function hubspot_pending_events(uuid,timestamp with time zone,uuid,text[],integer) to service_role;
revoke all on function hubspot_stale_partners(interval) from public, anon;
revoke all on function hubspot_stale_partners(interval) from authenticated;
grant execute on function hubspot_stale_partners(interval) to service_role;
revoke all on function hubspot_sync_partners() from public, anon;
revoke all on function hubspot_sync_partners() from authenticated;
grant execute on function hubspot_sync_partners() to service_role;
revoke all on function is_agent_estate(uuid,uuid) from public, anon;
revoke all on function is_agent_estate(uuid,uuid) from authenticated;
grant execute on function is_agent_estate(uuid,uuid) to service_role;
revoke all on function is_developer() from public, anon;
revoke all on function is_developer() from authenticated;
grant execute on function is_developer() to service_role;
revoke all on function is_tenancy_lead(uuid) from public, anon;
revoke all on function is_tenancy_lead(uuid) from authenticated;
grant execute on function is_tenancy_lead(uuid) to service_role;
revoke all on function issue_email_code(text,text,text,integer) from public, anon;
revoke all on function issue_email_code(text,text,text,integer) from authenticated;
grant execute on function issue_email_code(text,text,text,integer) to service_role;
revoke all on function livemode_audit() from public, anon;
revoke all on function livemode_audit() from authenticated;
grant execute on function livemode_audit() to service_role;
revoke all on function log_partner_api_request(uuid,uuid,text,text,integer,text,integer,jsonb,jsonb) from public, anon;
revoke all on function log_partner_api_request(uuid,uuid,text,text,integer,text,integer,jsonb,jsonb) from authenticated;
grant execute on function log_partner_api_request(uuid,uuid,text,text,integer,text,integer,jsonb,jsonb) to service_role;
revoke all on function match_application_agency(uuid) from public, anon;
revoke all on function match_application_agency(uuid) from authenticated;
grant execute on function match_application_agency(uuid) to service_role;
revoke all on function may_act_on_user(uuid) from public, anon;
revoke all on function may_act_on_user(uuid) from authenticated;
grant execute on function may_act_on_user(uuid) to service_role;
revoke all on function merge_agencies(uuid,uuid,text) from public, anon;
revoke all on function merge_agencies(uuid,uuid,text) from authenticated;
grant execute on function merge_agencies(uuid,uuid,text) to service_role;
revoke all on function migrate_group_rates_to_agency_lines() from public, anon;
revoke all on function migrate_group_rates_to_agency_lines() from authenticated;
grant execute on function migrate_group_rates_to_agency_lines() to service_role;
revoke all on function mint_payment_page_token(text) from public, anon;
revoke all on function mint_payment_page_token(text) from authenticated;
grant execute on function mint_payment_page_token(text) to service_role;
revoke all on function mint_tenant_invite(uuid,integer) from public, anon;
revoke all on function mint_tenant_invite(uuid,integer) from authenticated;
grant execute on function mint_tenant_invite(uuid,integer) to service_role;
revoke all on function ops_functions_base_url() from public, anon;
revoke all on function ops_functions_base_url() from authenticated;
grant execute on function ops_functions_base_url() to service_role;
revoke all on function ops_hubspot_disabled() from public, anon;
revoke all on function ops_hubspot_disabled() from authenticated;
grant execute on function ops_hubspot_disabled() to service_role;
revoke all on function partner_api_applications(uuid,boolean,uuid,text,integer,timestamp with time zone,uuid) from public, anon;
revoke all on function partner_api_applications(uuid,boolean,uuid,text,integer,timestamp with time zone,uuid) from authenticated;
grant execute on function partner_api_applications(uuid,boolean,uuid,text,integer,timestamp with time zone,uuid) to service_role;
revoke all on function partner_api_orgs(uuid) from public, anon;
revoke all on function partner_api_orgs(uuid) from authenticated;
grant execute on function partner_api_orgs(uuid) to service_role;
revoke all on function partner_api_resolve_org(uuid,text,text) from public, anon;
revoke all on function partner_api_resolve_org(uuid,text,text) from authenticated;
grant execute on function partner_api_resolve_org(uuid,text,text) to service_role;
revoke all on function partner_can_reach_agency(uuid) from public, anon;
revoke all on function partner_can_reach_agency(uuid) from authenticated;
grant execute on function partner_can_reach_agency(uuid) to service_role;
revoke all on function partner_reaches_agency(uuid,uuid) from public, anon;
revoke all on function partner_reaches_agency(uuid,uuid) from authenticated;
grant execute on function partner_reaches_agency(uuid,uuid) to service_role;
revoke all on function partner_webhook_payload(uuid,text) from public, anon;
revoke all on function partner_webhook_payload(uuid,text) from authenticated;
grant execute on function partner_webhook_payload(uuid,text) to service_role;
revoke all on function partner_weekly_climbers(timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone) from public, anon;
revoke all on function partner_weekly_climbers(timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone) from authenticated;
grant execute on function partner_weekly_climbers(timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone) to service_role;
revoke all on function partner_weekly_digest(timestamp with time zone,timestamp with time zone) from public, anon;
revoke all on function partner_weekly_digest(timestamp with time zone,timestamp with time zone) from authenticated;
grant execute on function partner_weekly_digest(timestamp with time zone,timestamp with time zone) to service_role;
revoke all on function provider_callbacks_due() from public, anon;
revoke all on function provider_callbacks_due() from authenticated;
grant execute on function provider_callbacks_due() to service_role;
revoke all on function purge_email_codes(interval) from public, anon;
revoke all on function purge_email_codes(interval) from authenticated;
grant execute on function purge_email_codes(interval) to service_role;
revoke all on function rate_above_all_in(text,uuid) from public, anon;
revoke all on function rate_above_all_in(text,uuid) from authenticated;
grant execute on function rate_above_all_in(text,uuid) to service_role;
revoke all on function record_application_document(uuid,text,text,text,text,text,bigint,text,uuid,uuid) from public, anon;
revoke all on function record_application_document(uuid,text,text,text,text,text,bigint,text,uuid,uuid) from authenticated;
grant execute on function record_application_document(uuid,text,text,text,text,text,bigint,text,uuid,uuid) to service_role;
revoke all on function record_deed_failure(uuid,text) from public, anon;
revoke all on function record_deed_failure(uuid,text) from authenticated;
grant execute on function record_deed_failure(uuid,text) to service_role;
revoke all on function record_delivery_attempt(uuid,boolean,text,text,text) from public, anon;
revoke all on function record_delivery_attempt(uuid,boolean,text,text,text) from authenticated;
grant execute on function record_delivery_attempt(uuid,boolean,text,text,text) to service_role;
revoke all on function record_eligibility_payment(uuid,numeric,text,text,boolean) from public, anon;
revoke all on function record_eligibility_payment(uuid,numeric,text,text,boolean) from authenticated;
grant execute on function record_eligibility_payment(uuid,numeric,text,text,boolean) to service_role;
revoke all on function record_provider_verdict(uuid,text,text) from public, anon;
revoke all on function record_provider_verdict(uuid,text,text) from authenticated;
grant execute on function record_provider_verdict(uuid,text,text) to service_role;
revoke all on function record_security_event(text,text,uuid,uuid,uuid,text,text) from public, anon;
revoke all on function record_security_event(text,text,uuid,uuid,uuid,text,text) from authenticated;
grant execute on function record_security_event(text,text,uuid,uuid,uuid,text,text) to service_role;
revoke all on function release_deed_lease(uuid) from public, anon;
revoke all on function release_deed_lease(uuid) from authenticated;
grant execute on function release_deed_lease(uuid) to service_role;
revoke all on function release_tenancy_deed_claim(uuid) from public, anon;
revoke all on function release_tenancy_deed_claim(uuid) from authenticated;
grant execute on function release_tenancy_deed_claim(uuid) to service_role;
revoke all on function report_ops_incident(text,text) from public, anon;
revoke all on function report_ops_incident(text,text) from authenticated;
grant execute on function report_ops_incident(text,text) to service_role;
revoke all on function resolve_fee(uuid,uuid,numeric,integer) from public, anon;
revoke all on function resolve_fee(uuid,uuid,numeric,integer) from authenticated;
grant execute on function resolve_fee(uuid,uuid,numeric,integer) to service_role;
revoke all on function resolve_pricing_agreement(uuid,uuid,integer) from public, anon;
revoke all on function resolve_pricing_agreement(uuid,uuid,integer) from authenticated;
grant execute on function resolve_pricing_agreement(uuid,uuid,integer) to service_role;
revoke all on function resolve_rates(uuid,uuid) from public, anon;
revoke all on function resolve_rates(uuid,uuid) from authenticated;
grant execute on function resolve_rates(uuid,uuid) to service_role;
revoke all on function resolve_referencing_mode(uuid,uuid) from public, anon;
revoke all on function resolve_referencing_mode(uuid,uuid) from authenticated;
grant execute on function resolve_referencing_mode(uuid,uuid) to service_role;
revoke all on function resolve_route_partner(uuid,uuid) from public, anon;
revoke all on function resolve_route_partner(uuid,uuid) from authenticated;
grant execute on function resolve_route_partner(uuid,uuid) to service_role;
revoke all on function security_events_recent(integer,integer) from public, anon;
revoke all on function security_events_recent(integer,integer) from authenticated;
grant execute on function security_events_recent(integer,integer) to service_role;
revoke all on function set_deed_state(text,text) from public, anon;
revoke all on function set_deed_state(text,text) from authenticated;
grant execute on function set_deed_state(text,text) to service_role;
revoke all on function set_home_branch(uuid,uuid) from public, anon;
revoke all on function set_home_branch(uuid,uuid) from authenticated;
grant execute on function set_home_branch(uuid,uuid) to service_role;
revoke all on function settle_partner_webhook_delivery(uuid,boolean,integer,text) from public, anon;
revoke all on function settle_partner_webhook_delivery(uuid,boolean,integer,text) from authenticated;
grant execute on function settle_partner_webhook_delivery(uuid,boolean,integer,text) to service_role;
revoke all on function staff_notification_scopes(uuid) from public, anon;
revoke all on function staff_notification_scopes(uuid) from authenticated;
grant execute on function staff_notification_scopes(uuid) to service_role;
revoke all on function submit_application_for_referencing(uuid) from public, anon;
revoke all on function submit_application_for_referencing(uuid) from authenticated;
grant execute on function submit_application_for_referencing(uuid) to service_role;
revoke all on function take_deed_lease(uuid,interval) from public, anon;
revoke all on function take_deed_lease(uuid,interval) from authenticated;
grant execute on function take_deed_lease(uuid,interval) to service_role;
revoke all on function tenancy_fully_paid(uuid) from public, anon;
revoke all on function tenancy_fully_paid(uuid) from authenticated;
grant execute on function tenancy_fully_paid(uuid) to service_role;
revoke all on function tenancy_group_prequalification(uuid) from public, anon;
revoke all on function tenancy_group_prequalification(uuid) from authenticated;
grant execute on function tenancy_group_prequalification(uuid) to service_role;
revoke all on function tenancy_tenant_names(uuid) from public, anon;
revoke all on function tenancy_tenant_names(uuid) from authenticated;
grant execute on function tenancy_tenant_names(uuid) to service_role;
revoke all on function tenant_applications(uuid) from public, anon;
revoke all on function tenant_applications(uuid) from authenticated;
grant execute on function tenant_applications(uuid) to service_role;
revoke all on function tenant_invite_summary(uuid) from public, anon;
revoke all on function tenant_invite_summary(uuid) from authenticated;
grant execute on function tenant_invite_summary(uuid) to service_role;
revoke all on function trigger_hubspot_sync() from public, anon;
revoke all on function trigger_hubspot_sync() from authenticated;
grant execute on function trigger_hubspot_sync() to service_role;
revoke all on function upsert_applicant(uuid,text,text,text,text,date,text) from public, anon;
revoke all on function upsert_applicant(uuid,text,text,text,text,date,text) from authenticated;
grant execute on function upsert_applicant(uuid,text,text,text,text,date,text) to service_role;
revoke all on function verify_email_code(text,text,text) from public, anon;
revoke all on function verify_email_code(text,text,text) from authenticated;
grant execute on function verify_email_code(text,text,text) to service_role;

-- ===========================================================================
-- AND THE DEFAULT ITSELF, so the next function is not born open
-- ===========================================================================
-- Everything above is a one-off correction. This is the part that stops the
-- class: a function created from here on grants EXECUTE to nobody, and has to
-- say who may call it. The CI check over pg_proc then has something true to
-- assert rather than a list that drifts.
--
-- Default privileges are per-GRANTING-role, so this has to name the role that
-- creates the functions rather than being set once for the schema. All 295
-- functions in public are owned by postgres, and postgres is what both
-- `supabase db push` and the SQL editor run as, so postgres is the only role
-- that needs it -- and the only one it can be set for from here, since
-- postgres is not a member of supabase_admin.
alter default privileges for role postgres in schema public
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- service_role keeps the default, because every edge function and cron body
-- runs as it and a missing grant there is an outage rather than a boundary.
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;
