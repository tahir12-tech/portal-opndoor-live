# Production divergence: what is in the tree and not on live

> **A SECOND, DIFFERENT DIVERGENCE, found 2026-09-29.** This document is about
> which MIGRATIONS are applied on production. There is also a divergence in
> the GIT history, and they are not the same thing:
>
> the local branch `main` (`f2816a7`) and the live repository's `origin/main`
> (`3520a26`) have diverged — **neither contains the other**. `origin/main`
> carries eight commits from 27 August to 18 September that the local copy
> does not: deed email fixes, a PandaDoc wait, a refund timeout, toast fixes.
>
> Their `supabase/migrations` trees are byte-identical, 65 files each, so
> nothing below changes. But anyone reading local `main` to answer "what does
> production DO" is reading a September answer for the screens and emails and
> an August one underneath, and any fix written against it must be written
> against `origin/main` instead. See `docs/HANDOVER-BALAL.md` section 0a.

`applications.partner_rate` is still selectable by `authenticated` on production,
which proves `20260811180000` was never applied there. That is one known gap.
This document is how to find the rest **without inferring it**, because
inference is exactly what that finding disproves.

## Step 1: get production's applied list

Run [PRODUCTION-MIGRATION-DIFF.sql](PRODUCTION-MIGRATION-DIFF.sql) in the
dashboard SQL editor. It returns one value: a comma separated list of version
stamps from `supabase_migrations.schema_migrations`. No schema, no rows.

Dev returns 160 applied, matching 160 in the tree, so the query reports
truthfully.

## Step 2: subtract

Every version below that is **not** in production's list is in the tree and not
on live. The classification is what turns that list into a decision.

## The 16 that decide urgency

If any of these is missing from production, somebody is exposed **today**, not
latently. This is the list to check first.

| Migration | What it closes |
| --------- | -------------- |
| `20260702134358_access_rls_rpc.sql` | installs RLS policies, AAL2 gates and lifecycle RPCs on otherwise unprotected tables |
| `20260702134957_harden_functions.sql` | pins search_path and removes blanket PUBLIC execute on SECURITY DEFINER functions |
| `20260702135800_revoke_anon_function_execute.sql` | removes anon EXECUTE on every public function, closing the pre-login definer surface |
| `20260703143224_tighten_set_application_status_admin_only.sql` | stops management hand-flipping status and bypassing payment and deed generation |
| `20260704133749_fix_create_referral_target_contact_guard.sql` | blocks injecting a primary branch contact that redirects deed delivery on existing branches |
| `20260810210000_developer_role_and_fail_open_guards.sql` | closes fail-open gates exposing commission, league and org data to developers |
| `20260810270000_livemode_definer_predicates.sql` | definer functions bypass RLS; adds livemode predicates and a write guard |
| `20260810280000_livemode_create_path_and_webhooks.sql` | livemode comes only from the key; stops cross-mode rows and deliveries |
| `20260810290000_livemode_partner_api_orgs.sql` | stops a sandbox key reading the partner's real agencies and branches |
| `20260811160000_admin_loses_credential_access.sql` | Removes admin access to partner API keys and webhook signing secrets |
| `20260811180000_revoke_commission_columns.sql` | Removes partner_rate and agent_rate from the authenticated table grant, blocking direct PostgREST reads |
| `20260812240000_email_code_races.sql` | Attempt and issue caps were raceable, so brute-force limits did not bind |
| `20260814080000_agency_groups_rls.sql` | agency_groups shipped without RLS, so anon could read group rates |
| `20260815010000_provider_link_grants_and_aal2.sql` | Any authenticated caller could execute provider_callbacks_due; links table lacked AAL2 |
| `20260815020000_revoke_definer_helpers.sql` | Seventeen ungated definer helpers were executable by any signed-in principal |
| `20260815030000_revoke_partner_rate_columns.sql` | partners.partner_rate and agent_rate were still selectable by authenticated |

**Known missing already:** `20260811180000`, from the rate column result.

Three of the last four, `20260815010000` through `20260815030000`, were written
today and have never been applied anywhere but dev, so their absence from
production is expected rather than alarming. `20260814080000` is the same. The
ones worth checking hardest are the six from **2 July to 11 August**: if any of
those is absent, production has been exposed for weeks.

## What the other classes mean here

| Class | Count | If absent from production |
| ----- | ----- | ------------------------- |
| SECURITY | 16 | Someone is exposed today. Fix first |
| HARDENING | 9 | A correct control is easier to break later. Not urgent |
| FIX | 38 | Wrong behaviour, no security consequence |
| FEATURE | 93 | A capability is missing. Expected if live predates this work |
| DATA | 4 | Seeds and backfills. Check before applying to a live database |

**FEATURE absences are not a defect.** Production is Balal's live platform and
was never meant to carry this branch. The question this answers is narrower:
whether anything that closes a hole was written, merged and never deployed.

## The full classification

Sorted by version. `SECURITY` rows repeated here for completeness.

| Migration | Class | What it does |
| --------- | ----- | ------------ |
| `20260702134239_core_schema.sql` | FEATURE | creates the base tables, sequences and shared date and permission helper functions |
| `20260702134358_access_rls_rpc.sql` | SECURITY | installs RLS policies, AAL2 gates and lifecycle RPCs on otherwise unprotected tables |
| `20260702134957_harden_functions.sql` | SECURITY | pins search_path and removes blanket PUBLIC execute on SECURITY DEFINER functions |
| `20260702135800_revoke_anon_function_execute.sql` | SECURITY | removes anon EXECUTE on every public function, closing the pre-login definer surface |
| `20260702143332_add_beneficiary.sql` | FEATURE | adds the beneficiary column to applications |
| `20260702171309_tighten_application_required_fields.sql` | HARDENING | backfills seed rows then enforces required tenant and property fields in schema |
| `20260702171432_fix_create_referral_error_list.sql` | FIX | corrects the missing-field error list returned by create_referral |
| `20260702171551_tighten_related_writes.sql` | HARDENING | validates amend and deed-send inputs, adds non-empty and format constraints |
| `20260702173941_stripe_payment_schema.sql` | FEATURE | adds Stripe payment columns, event log and the service-role payment RPC |
| `20260702174141_activity_log.sql` | FEATURE | adds the activity log table with read-scoped RLS |
| `20260702190747_refund_amount_and_age_rules.sql` | HARDENING | records refunded amount and enforces tenant age bounds as schema constraints |
| `20260702192702_refund_policy_anomaly.sql` | FEATURE | flags refunds made on or after tenancy start for human review |
| `20260703075024_pandadoc_deed_schema.sql` | FEATURE | adds deed document columns, event log and service-role deed completion RPCs |
| `20260703095652_activity_log_visibility.sql` | FEATURE | adds business versus internal visibility to activity log entries |
| `20260703101635_deed_executed_leave_issue_date.sql` | FIX | completion webhook no longer overwrites the issue date printed on the deed |
| `20260703102624_deed_viewed_at.sql` | FEATURE | adds the deed_viewed_at timestamp column |
| `20260703103841_amend_deed_state_aware.sql` | FEATURE | makes the amend permission boundary deed-state aware rather than status only |
| `20260703122741_expiry_reminder_schema.sql` | FEATURE | adds the exactly-once expiry reminder ledger and firing function |
| `20260703143224_tighten_set_application_status_admin_only.sql` | SECURITY | stops management hand-flipping status and bypassing payment and deed generation |
| `20260703150645_public_rate_limit.sql` | FEATURE | adds the rate limit table and atomic bump RPC for public endpoints |
| `20260703153500_enable_pg_cron_pg_net.sql` | FIX | enables pg_cron and pg_net so a clean project can apply migrations |
| `20260703153600_rate_limit_cleanup.sql` | HARDENING | bounds the rate limit table with an hourly eviction job |
| `20260704100425_application_rate_snapshot.sql` | FEATURE | freezes each application's partner and agent commission rates at creation |
| `20260704100519_partner_audit_and_update_rpc.sql` | FEATURE | adds partner change audit and the single governed settings update RPC |
| `20260704104758_user_lifecycle_schema_and_rpcs.sql` | FEATURE | adds deactivation, session revocation, MFA reset and audited role changes |
| `20260704123353_app_settings_bordereau_rate.sql` | FEATURE | persists the bordereau insurance rate with an audit of every change |
| `20260704130732_org_review_state_and_reconciliation.sql` | FEATURE | adds review_state, org audit and the reconciliation queue for fly-created entities |
| `20260704133749_fix_create_referral_target_contact_guard.sql` | SECURITY | blocks injecting a primary branch contact that redirects deed delivery on existing branches |
| `20260704145218_entity_consistency_org_rpcs.sql` | FEATURE | lets admins fly-create entities and gives the Agencies forms real persistence |
| `20260704163705_fix_contact_primary_and_head_office_default.sql` | FIX | makes contact RPCs trigger-aware and defaults a blank branch to Head office |
| `20260704174727_org_remove_contact_last_agency_guard.sql` | HARDENING | refuses server-side deletion of an agency's only contact, matching the UI block |
| `20260704184001_contact_name_optional_email_loadbearing.sql` | FIX | allows email-only contacts and stops copying the email into the name |
| `20260704184047_create_referral_target_name_not_email.sql` | FIX | on-the-fly path stores the given contact name instead of the email |
| `20260704185754_activate_user_on_factor_verify.sql` | FIX | promotes a pending user to active when their first TOTP factor verifies |
| `20260704193339_referrer_leaderboard_mode.sql` | FEATURE | adds a per-partner leaderboard visibility setting with a governed writer |
| `20260704204046_referrer_league_include_self.sql` | FIX | leaderboard now always includes the viewing referrer's own row |
| `20260704205648_tenancy_correction_schema.sql` | FEATURE | adds tokenised agent-reported tenancy start corrections for admin review |
| `20260704210953_expiry_cohort_schema.sql` | FEATURE | adds the monthly expiry cohort send ledger for exactly-once emails |
| `20260705090637_payment_reminder_schema.sql` | FEATURE | adds the never-built payment reminder ledger and firing function |
| `20260705091511_ops_secrets_cron_auth.sql` | FIX | mirrors the cron secret so reminder functions stop returning 401 |
| `20260705092634_fix_referrer_league_ambiguous_column.sql` | FIX | aliases colliding column names so the leaderboard stops raising and returning empty |
| `20260705094808_confirm_org_entity_sweep_head_office.sql` | FEATURE | confirming an agency now also confirms its auto-created head office branch |
| `20260705095120_application_withdrawal_schema.sql` | FEATURE | adds the withdrawn terminal status with reason, note and audit columns |
| `20260705095955_mark_withdrawn_by_ref.sql` | FIX | mark_withdrawn now takes the guarantee ref instead of the uuid |
| `20260705102238_ops_failure_alerting.sql` | FEATURE | emails deduped ops alerts for failures already written to activity log |
| `20260705103046_partner_weekly_digest_schema.sql` | FEATURE | adds the weekly partner digest ledger and aggregate RPC |
| `20260705110146_partner_weekly_digest_cohort_conversion.sql` | FIX | digest conversion now uses one cohort so it cannot exceed 100 percent |
| `20260705110300_ops_alert_trigger_defensive_guard.sql` | HARDENING | wraps alert side-effects so they can never roll back the business transaction |
| `20260705115059_application_expiry_and_reinstate.sql` | FEATURE | adds auto-expiry at fourteen days plus reinstatement on late payment |
| `20260705115145_referrer_league_rank_by_fees.sql` | FIX | leaderboard ranks by fees collected rather than referral count |
| `20260705115345_payment_page_tokens_and_decline.sql` | FEATURE | adds application-scoped tokens for the public payment page and tenant decline |
| `20260705124804_application_notes.sql` | FEATURE | adds append-only internal notes on applications behind a definer writer |
| `20260705125214_cron_health_rpc.sql` | FEATURE | adds an admin-gated RPC exposing real cron and HTTP outcomes |
| `20260705125347_partner_weekly_climbers.sql` | FEATURE | adds climber of the week ranking to the partner digest |
| `20260705130926_decline_accepts_expired.sql` | FIX | tenant decline now records on expired applications instead of silently doing nothing |
| `20260705130959_partner_weekly_climbers_deterministic.sql` | FIX | gives both windows the same tiebreak so no climber is fabricated |
| `20260705140347_snapshot_referrer_name.sql` | FEATURE | snapshots referrer display name so attribution survives deactivation and RLS hiding |
| `20260705140827_management_org_adds_apply_instantly.sql` | FIX | management org additions apply confirmed instead of wrongly queueing for reconciliation |
| `20260705150000_hubspot_sync_schema.sql` | FEATURE | adds the config-driven one-way HubSpot sync tables and reader functions |
| `20260705150500_hubspot_sync_seed.sql` | DATA | seeds the sandbox active and production dormant HubSpot config blocks |
| `20260705151000_hubspot_sync_assoc_roles.sql` | FEATURE | maps partner, agency and branch onto three distinct association types |
| `20260705152000_hubspot_sync_two_edge_associations.sql` | FEATURE | replaces three company edges with two and scopes branch lookup to agency |
| `20260705153000_hubspot_sync_cron_and_trigger.sql` | FEATURE | adds the two-minute sync cron and the admin on-demand trigger |
| `20260705160000_partner_rate_audit_one_decimal.sql` | FIX | audit prints rates to one decimal so 9.5 percent never reads 10 |
| `20260705170000_hubspot_commission_rate.sql` | DATA | seeds commission rate field mappings, the applicant one shipped inactive |
| `20260705170500_drop_reconciliation_queue_for_signature_change.sql` | FIX | drops the function so the next migration can widen its return type |
| `20260705171000_reconciliation_fold_head_office.sql` | FEATURE | folds a single-office head office branch into its agency queue card |
| `20260807120000_extract_referral_validation.sql` | HARDENING | extracts shared field validator so portal and partner API rules cannot drift |
| `20260807130000_partner_api_keys.sql` | FEATURE | adds hashed partner API keys for machine callers with no session |
| `20260807140000_partner_api_orgs.sql` | FEATURE | adds the GET /orgs read model exposing stable org ids |
| `20260810100000_partner_referencing_mode.sql` | FEATURE | adds partners.referencing_mode, defaulting to the criteria-applying value |
| `20260810110000_partner_api_requests.sql` | FEATURE | new idempotency ledger table stopping duplicate API applications and double charges |
| `20260810120000_referral_field_errors.sql` | FEATURE | returns structured per-field validation errors from one shared rule set |
| `20260810130000_create_referral_api.sql` | FEATURE | machine-callable create path with partner and referrer scoping checks |
| `20260810140000_create_referral_target_api.sql` | FEATURE | API org resolution refusing branches that cannot issue a deed |
| `20260810150000_partner_webhook_schema.sql` | FEATURE | outbound webhook endpoint registry and per-delivery queue tables |
| `20260810160000_partner_webhook_enqueue.sql` | FEATURE | trigger renders and enqueues partner-safe webhook payloads on status change |
| `20260810170000_partner_webhook_claim.sql` | FEATURE | claim and settle functions with backoff, jitter and dead lettering |
| `20260810180000_admin_update_user_name.sql` | FEATURE | new RPC to rename a user, same gate as role changes |
| `20260810190000_partner_webhook_reinstated_event.sql` | FIX | emits application.reinstated so late payments are not missed or double counted |
| `20260810200000_partner_api_applications.sql` | FEATURE | partner-facing read model with an explicit, commission-free column list |
| `20260810210000_developer_role_and_fail_open_guards.sql` | SECURITY | closes fail-open gates exposing commission, league and org data to developers |
| `20260810220000_dev_centre_rpcs.sql` | FEATURE | Dev Centre listings and key or endpoint lifecycle RPCs |
| `20260810230000_partner_api_request_log.sql` | FEATURE | metadata-only request log plus Dev Centre monitoring queries |
| `20260810240000_dev_reveal_webhook_secret.sql` | FEATURE | reveals one endpoint signing secret on explicit developer request |
| `20260810250000_dev_centre_stable_ordering.sql` | FIX | deterministic tiebreak stops listing rows jumping when toggled or revoked |
| `20260810260000_livemode_foundation.sql` | FEATURE | introduces livemode columns, restrictive policy, sandbox purge and audit harness |
| `20260810270000_livemode_definer_predicates.sql` | SECURITY | definer functions bypass RLS; adds livemode predicates and a write guard |
| `20260810280000_livemode_create_path_and_webhooks.sql` | SECURITY | livemode comes only from the key; stops cross-mode rows and deliveries |
| `20260810290000_livemode_partner_api_orgs.sql` | SECURITY | stops a sandbox key reading the partner's real agencies and branches |
| `20260810300000_livemode_idempotency_ledger.sql` | FIX | puts livemode in the idempotency key so sandbox replays cannot answer live |
| `20260810310000_dev_centre_sandbox.sql` | FEATURE | the only door for a developer to see sandbox applications |
| `20260810320000_dev_centre_livemode_columns.sql` | FEATURE | shows livemode on the key and endpoint listings |
| `20260810330000_request_log_bodies.sql` | FEATURE | adds redacted request and response bodies to the observability log |
| `20260810340000_webhook_replay.sql` | FEATURE | requeue a settled delivery while appending, not erasing, its history |
| `20260810350000_fix_deliveries_column_names.sql` | FIX | restores endpoint_url and guarantee_ref that the replay migration silently renamed |
| `20260810360000_dev_centre_fixes.sql` | FIX | repairs ambiguous replay, blocked sandbox purge, and adds key deletion |
| `20260811090000_rightmove_referencing_mode.sql` | DATA | Sets Rightmove's partner row to pre_referenced_open so the API stops returning 501 |
| `20260811100000_partner_capabilities_and_mode_snapshot.sql` | FEATURE | Adds portal and API capability flags plus per-application referencing_mode snapshot |
| `20260811110000_create_partner_and_settings.sql` | FEATURE | Adds create_partner RPC and extends partner settings editing with audit rows |
| `20260811120000_rate_limit_headers.sql` | FEATURE | Adds rate limit state function so the API can emit rate headers |
| `20260811130000_org_resolution_by_name.sql` | FEATURE | Resolves orgs by name, drops API org creation and cross-mode branch guard |
| `20260811140000_rate_limit_peek.sql` | FEATURE | Adds peek mode so checking a limit does not consume budget |
| `20260811150000_dev_live_application_metadata.sql` | FEATURE | Gives developers a metadata-only allowlist view of live applications |
| `20260811160000_admin_loses_credential_access.sql` | SECURITY | Removes admin access to partner API keys and webhook signing secrets |
| `20260811170000_security_events_and_break_glass.sql` | FEATURE | Adds security event log and audited break-glass key revocation for admins |
| `20260811180000_revoke_commission_columns.sql` | SECURITY | Removes partner_rate and agent_rate from the authenticated table grant, blocking direct PostgREST reads |
| `20260811190000_developer_reads_partner_data.sql` | FEATURE | Widens developer read policies to their partner's applications, orgs and colleagues |
| `20260811200000_refuse_deed_execution_when_refunded.sql` | HARDENING | Fail-closed guard refusing deed execution on refunded applications, behind an already-closed route |
| `20260811210000_ops_functions_read_base_url.sql` | FIX | Ops alerting and cron read a configured base URL, not a foreign project |
| `20260811220000_contacts_promote_on_demote.sql` | FIX | Demoting the last primary contact now promotes another or is refused |
| `20260811230000_reinstate_clears_stale_markers.sql` | FIX | Reinstated payments clear expired and withdrawn markers that skewed later reporting |
| `20260811240000_backfill_reinstated_markers.sql` | DATA | Backfills stale closure markers on historical rows and adds the blocking constraint |
| `20260811250000_lapse_message_says_fifteen.sql` | FIX | Expiry activity log message now says fifteen days, matching unchanged behaviour |
| `20260811260000_partner_summary_reports_api_access.sql` | FEATURE | Exposes api_access_enabled so the Dev Centre reports API status instead of hiding |
| `20260812010000_route_based_attribution.sql` | FEATURE | partner_id becomes the route, letting one agency be reached several ways |
| `20260812020000_create_referral_states_route.sql` | FEATURE | create_referral states its route explicitly; commission follows the route partner |
| `20260812030000_hubspot_cursor_per_partner.sql` | FIX | CRM cursor per partner, so one poisoned event stops only itself |
| `20260812040000_house_routes_and_delivery_contact.sql` | FEATURE | Adds house route partners and the tenant-named deed delivery contact |
| `20260812050000_widen_status_for_referenced_rails.sql` | FEATURE | Adds draft, referencing and declined statuses for the referenced rails |
| `20260812060000_eligibility_payments.sql` | FEATURE | Separate eligibility fee ledger so it cannot trigger deed issue |
| `20260812070000_eligibility_criteria.sql` | FEATURE | Encodes versioned eligibility rules in SQL for both calling surfaces |
| `20260812080000_tenant_identity.sql` | FEATURE | Adds the applicant principal, mutually exclusive with staff user rows |
| `20260812090000_referrer_optional.sql` | FEATURE | referrer_id nullable for direct signups, with a replacement attribution CHECK |
| `20260812100000_agency_identity_and_duplicates.sql` | FEATURE | Placeholder flag, normalised names and cross-partner duplicate detection |
| `20260812110000_partner_agency_relationships.sql` | FEATURE | Relationship table making agency reach a recorded fact per partner |
| `20260812120000_org_visibility_by_relationship.sql` | FEATURE | Agency and branch reads move from ownership to relationship reach |
| `20260812130000_contact_resolution_by_route.sql` | HARDENING | Partner-scoped primary contact, so a shared agency cannot misroute deeds |
| `20260812140000_merge_agencies.sql` | FEATURE | Admin-only audited agency merge that unions relationships and keeps contact ownership |
| `20260812150000_applicant_profile_schema.sql` | FEATURE | Per-application profile, address history and income tables for tenant forms |
| `20260812160000_document_storage.sql` | FEATURE | Two private buckets and an index table for uploaded documents |
| `20260812170000_referencing_inbound.sql` | FEATURE | Rail 4 receiver: hashed provider tokens, links and callback queue |
| `20260812180000_house_route_attribution_guard.sql` | FIX | Attribution guard becomes a trigger admitting house routes with neither party |
| `20260812190000_tenancies.sql` | FEATURE | Joint tenancies: one tenancy, one deed, apportioned shares, group eligibility |
| `20260812200000_tenant_invites.sql` | FEATURE | Single-use invite tokens letting a referred tenant claim their application |
| `20260812210000_draft_completeness.sql` | FIX | Title, date of birth and phone required past draft, not at insert |
| `20260812220000_fee_before_the_form.sql` | FIX | Paying the eligibility fee no longer moves status to referencing |
| `20260812230000_email_codes.sql` | FEATURE | Six-digit hashed email codes for tenant verification and sign-in |
| `20260812240000_email_code_races.sql` | SECURITY | Attempt and issue caps were raceable, so brute-force limits did not bind |
| `20260813010000_agency_groups.sql` | FEATURE | Adds a group level above agency plus rate resolution order |
| `20260813020000_user_scopes.sql` | FEATURE | Position vocabulary, role plus scope rows, changing no policy yet |
| `20260813030000_applications_scope_arm.sql` | FEATURE | applications_select gains a position arm, inert until someone holds scope |
| `20260813040000_org_scope_arms.sql` | FEATURE | Agency and branch policies narrow to a position holder's own branches |
| `20260813050000_role_ladder_admits_developer.sql` | FIX | admin_update_user_role accepts developer, matching what the screen already offered |
| `20260813060000_api_reaches_by_relationship.sql` | FEATURE | Partner API org listing uses relationship reach like the portal |
| `20260813070000_referral_form_fields.sql` | FEATURE | Middle name column and the missing writer for user agency attachments |
| `20260813080000_hubspot_channel_and_group.sql` | FEATURE | Derives CRM channel and group attribution from the route partner |
| `20260813090000_crm_sync_alias.sql` | FIX | Neutral RPC alias so the bundle stops naming the CRM vendor |
| `20260814010000_partner_refers_own_stock.sql` | FEATURE | Records whether a partner refers into stock it owns |
| `20260814020000_my_org_shape.sql` | FEATURE | Returns the org tree shape the signed-in person can reach |
| `20260814030000_collapse_needs_ownership.sql` | FIX | Suppliers never collapse the agency step; only agents may |
| `20260814040000_org_shape_without_temp_table.sql` | FIX | Removes a temp table write that fails inside a STABLE function |
| `20260814050000_api_agency_optional_for_agents.sql` | FEATURE | Agents owning their stock may omit agency_name on API creates |
| `20260814060000_fix_min_uuid_in_org_resolution.sql` | FIX | Inert no-op placeholder; the real fix moved to the next number |
| `20260814070000_fix_min_uuid_in_org_resolution.sql` | FIX | Removes min(uuid), which made every by-name org resolution raise 42883 |
| `20260814080000_agency_groups_rls.sql` | SECURITY | agency_groups shipped without RLS, so anon could read group rates |
| `20260815010000_provider_link_grants_and_aal2.sql` | SECURITY | Any authenticated caller could execute provider_callbacks_due; links table lacked AAL2 |
| `20260815020000_revoke_definer_helpers.sql` | SECURITY | Seventeen ungated definer helpers were executable by any signed-in principal |
| `20260815030000_revoke_partner_rate_columns.sql` | SECURITY | partners.partner_rate and agent_rate were still selectable by authenticated |
| `20260815040000_fix_tenancies_select.sql` | FIX | Uncorrelated subquery in tenancies_select denied every row to everyone |
