/* =====================================================================
   Dev Centre data access.

   Every read is a SECURITY DEFINER RPC that scopes itself (20260810220000);
   nothing here reaches a table directly, so the scoping cannot be forgotten at
   the call site. The two writes that need a CSPRNG and SHA-256, minting a key
   and creating a webhook endpoint, go through the dev-centre Edge Function
   because Postgres has no digest() without pgcrypto and this schema does not
   enable it.

   NOTHING HERE EVER RECEIVES A SECRET back from a listing. A key and a signing
   secret are returned exactly once, by the mint and create calls, and are not
   recoverable afterwards.
   ===================================================================== */
import { SUPABASE_ENABLED, supabase } from '@/lib/supabase';
import { NON_PRODUCTION_REFS } from '@/config/environment.generated';
import { plural } from '@/lib/plural';

function sb() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export interface DevApiKey {
  id: string;
  partner_id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  livemode: boolean;
  /** Requests this key has made. Zero plus a null last_used_at is what makes it deletable. */
  request_count: number;
}

export interface DevWebhookEndpoint {
  id: string;
  partner_id: string;
  url: string;
  events: string[];
  active: boolean;
  description: string | null;
  created_at: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: number;
  livemode: boolean;
  /** Deliveries recorded against this endpoint. Zero is what makes it deletable. */
  delivery_count: number;
}

export interface PriorAttempt {
  attempts: number; last_status: number | null; last_error: string | null;
  dead_at: string | null; ended_at: string;
}

export interface TestEventResult {
  request: { url: string; headers: Record<string, string>; body: unknown };
  response: { status: number; ok: boolean; duration_ms: number; body: string };
}

export interface DevDelivery {
  id: string;
  endpoint_id: string;
  endpoint_url: string;
  event_id: string;
  event_type: string;
  guarantee_ref: string | null;
  attempts: number;
  last_status: number | null;
  last_error: string | null;
  next_attempt_at: string | null;
  delivered_at: string | null;
  dead_at: string | null;
  created_at: string;
  payload: unknown;
  /** Replay history. prior_attempts is append-only: one entry per replayed round. */
  replay_count: number;
  last_replay_at: string | null;
  prior_attempts: PriorAttempt[];
}

export interface DevPartnerOption {
  id: string;
  slug: string;
  name: string;
  referencing_mode: string;
  api_access_enabled: boolean;
}

/**
 * The caller's own partner, for the roles that do not get a partner picker.
 *
 * dev_partner_options is admin-only, so a developer and a management user get
 * an empty list from it and their partner is implicit in every other call. This
 * is the one thing the screen needs to state rather than imply: whether API
 * access is on.
 */
export interface DevMyPartner {
  id: string;
  slug: string;
  name: string;
  status: string;
  referencing_mode: string;
  api_access_enabled: boolean;
}

/** The scopes a key may carry. Kept in step with the Edge Function's allowlist. */
export const API_SCOPES: { id: string; label: string; desc: string }[] = [
  { id: 'applications:write', label: 'Create applications', desc: 'POST /v1/applications' },
  { id: 'applications:read', label: 'Read applications', desc: 'GET /v1/applications and /v1/applications/{id}' },
  // orgs:write was removed with API org creation. Existing keys that still
  // carry it are harmless: nothing checks for it any more.
  { id: 'orgs:read', label: 'Read organisations', desc: 'GET /v1/orgs, to look up agency and branch ids' },
  { id: 'webhooks:manage', label: 'Manage webhooks', desc: 'Register and remove webhook endpoints over the API' },
];

/** The events an endpoint may subscribe to. Matches the enqueue trigger. */
export const WEBHOOK_EVENTS: { id: string; desc: string }[] = [
  { id: 'application.created', desc: 'An application was created' },
  { id: 'application.paid', desc: 'The guarantor fee was paid' },
  { id: 'application.deed_issued', desc: 'The Deed of Guarantee was signed and issued' },
  { id: 'application.lapsed', desc: 'An unpaid application lapsed. NOT the guarantee expiring' },
  { id: 'application.withdrawn', desc: 'The application was withdrawn' },
  { id: 'application.reinstated', desc: 'A lapsed or declined application was paid late. Sent INSTEAD of application.paid, so it is not double counted' },
];

export async function getApiKeys(partnerId?: string | null): Promise<DevApiKey[]> {
  if (!SUPABASE_ENABLED) return [];
  const { data, error } = await sb().rpc('dev_api_keys', { p_partner: partnerId ?? null });
  if (error) throw new Error(error.message);
  return (data ?? []) as DevApiKey[];
}

export async function revokeApiKey(id: string): Promise<void> {
  const { error } = await sb().rpc('dev_revoke_api_key', { p_id: id });
  if (error) throw new Error(error.message);
}

/** Returns the plaintext key. It is shown once and is not recoverable. */
export async function mintApiKey(input: {
  partnerId: string; name: string; scopes: string[]; livemode: boolean; expiresAt?: string | null;
}): Promise<{ key: string; record: Partial<DevApiKey> }> {
  const { data, error } = await sb().functions.invoke('dev-centre', {
    body: {
      action: 'mint_key',
      partner_id: input.partnerId,
      name: input.name,
      scopes: input.scopes,
      // Required, not defaulted. The server rejects a missing value rather than
      // guessing, and this type makes the caller state it.
      livemode: input.livemode,
      expires_at: input.expiresAt ?? null,
    },
  });
  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(data?.error ?? 'Could not mint the key.');
  return { key: data.key, record: data.record };
}

export async function getWebhookEndpoints(partnerId?: string | null): Promise<DevWebhookEndpoint[]> {
  if (!SUPABASE_ENABLED) return [];
  const { data, error } = await sb().rpc('dev_webhook_endpoints', { p_partner: partnerId ?? null });
  if (error) throw new Error(error.message);
  return (data ?? []) as DevWebhookEndpoint[];
}

/** Returns the signing secret. Shown once, not recoverable. */
export async function createWebhookEndpoint(input: {
  partnerId: string; url: string; events: string[]; livemode: boolean; description?: string;
}): Promise<{ secret: string; record: Partial<DevWebhookEndpoint> }> {
  const { data, error } = await sb().functions.invoke('dev-centre', {
    body: {
      action: 'create_endpoint',
      partner_id: input.partnerId,
      url: input.url,
      events: input.events,
      livemode: input.livemode,
      description: input.description ?? '',
    },
  });
  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(data?.error ?? 'Could not create the endpoint.');
  return { secret: data.secret, record: data.record };
}

export async function updateWebhookEndpoint(
  id: string, patch: { events?: string[]; active?: boolean },
): Promise<void> {
  const { error } = await sb().rpc('dev_update_webhook_endpoint', {
    p_id: id,
    p_events: patch.events ?? null,
    p_active: patch.active ?? null,
  });
  if (error) throw new Error(error.message);
}

/**
 * Reveal one endpoint's signing secret.
 *
 * Deliberately a separate call rather than a field on the listing, so opening
 * the endpoints page never puts secrets on the wire. There is no equivalent for
 * an API key: only its hash is stored, so the key does not exist to return.
 */
export async function revealEndpointSecret(id: string): Promise<string> {
  const { data, error } = await sb().rpc('dev_webhook_endpoint_secret', { p_id: id });
  if (error) throw new Error(error.message);
  return String(data ?? '');
}

export async function getDeliveries(opts: {
  partnerId?: string | null; endpointId?: string | null; eventType?: string | null; limit?: number;
} = {}): Promise<DevDelivery[]> {
  if (!SUPABASE_ENABLED) return [];
  const { data, error } = await sb().rpc('dev_webhook_deliveries', {
    p_partner: opts.partnerId ?? null,
    p_endpoint: opts.endpointId ?? null,
    p_event: opts.eventType ?? null,
    p_limit: opts.limit ?? 100,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as DevDelivery[];
}

export interface ApiStats {
  total_requests: number; failed_requests: number; success_requests: number;
  distinct_paths: number; avg_duration_ms: number | null;
}
export interface TimePoint { bucket: string; succeeded: number; failed: number }
export interface ErrorSlice { method: string; error_code: string; errors: number }
export interface WebhookStats {
  sent: number; delivered: number; failed: number; dead: number;
  min_ms: number | null; avg_ms: number | null; max_ms: number | null;
}
export interface ApiLogRow {
  id: string; method: string; path: string; status_code: number;
  error_code: string | null; duration_ms: number | null; created_at: string; key_name: string | null;
  /**
   * Redacted at WRITE time by the Edge Function, not here. Field names are
   * preserved and values are masked unless allowlisted, so the shape of what was
   * sent survives while the tenant's details never entered the table.
   */
  request_body: unknown; response_body: unknown;
}

/** Period options for the monitoring counters. Days, because the log is per-request. */
export const PERIODS = [
  { id: 1, label: 'Last 24 hours' },
  { id: 7, label: 'Last 7 days' },
  { id: 30, label: 'Last 30 days' },
  { id: 90, label: 'Last 90 days' },
];

export async function getApiStats(partnerId: string | null, days: number): Promise<ApiStats | null> {
  if (!SUPABASE_ENABLED) return null;
  const { data, error } = await sb().rpc('dev_api_stats', { p_partner: partnerId, p_days: days });
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data[0] : data) ?? null;
}

export async function getApiTimeseries(partnerId: string | null, days: number): Promise<TimePoint[]> {
  if (!SUPABASE_ENABLED) return [];
  const { data, error } = await sb().rpc('dev_api_timeseries', { p_partner: partnerId, p_days: days });
  if (error) throw new Error(error.message);
  return (data ?? []) as TimePoint[];
}

export async function getErrorsByMethod(partnerId: string | null, days: number): Promise<ErrorSlice[]> {
  if (!SUPABASE_ENABLED) return [];
  const { data, error } = await sb().rpc('dev_api_errors_by_method', { p_partner: partnerId, p_days: days });
  if (error) throw new Error(error.message);
  return (data ?? []) as ErrorSlice[];
}

export async function getWebhookStats(partnerId: string | null, days: number): Promise<WebhookStats | null> {
  if (!SUPABASE_ENABLED) return null;
  const { data, error } = await sb().rpc('dev_webhook_stats', { p_partner: partnerId, p_days: days });
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data[0] : data) ?? null;
}

export async function getApiLogs(opts: {
  partnerId: string | null; search?: string; days?: number; limit?: number;
}): Promise<ApiLogRow[]> {
  if (!SUPABASE_ENABLED) return [];
  const { data, error } = await sb().rpc('dev_api_logs', {
    p_partner: opts.partnerId, p_search: opts.search ?? null,
    p_days: opts.days ?? 7, p_limit: opts.limit ?? 200,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ApiLogRow[];
}

/**
 * Mask a secret for display.
 *
 * An API key can only ever be masked to its prefix, because only a hash is
 * stored and the rest genuinely does not exist anywhere. A webhook signing
 * secret IS stored, because signing needs it, so that one can be revealed.
 * The difference is real and the UI says so rather than implying both work
 * the same way.
 */
/* ---------------------------------------------------------------------------
   Sandbox.

   A developer sees sandbox applications ONLY here. The restrictive policy on
   applications has no developer arm, so PostgREST returns nothing to anybody and
   there is no second route to fall back on. Every field below therefore comes
   from dev_sandbox_applications, which carries the livemode predicate and the
   partner scope in SQL.
   --------------------------------------------------------------------------- */

export interface SandboxApplication {
  id: string;
  guarantee_ref: string;
  status: string;
  deed_state: string | null;
  created_at: string;
  sent_at: string | null;
  paid_at: string | null;
  deed_issued_at: string | null;
  tenant_first_name: string | null;
  tenant_last_name: string | null;
  tenant_email: string | null;
  prop_addr1: string | null;
  prop_postcode: string | null;
  monthly_rent: number | null;
  tenancy_start: string | null;
  agency_name: string | null;
  branch_name: string | null;
  pandadoc_document_id: string | null;
  payment_url: string | null;
  referrer_name: string | null;
}

/* ---------------------------------------------------------------------------
   Live applications, metadata only.

   A developer cannot verify a live integration without seeing whether their POST
   produced an application and what happened to it. This is deliberately NOT an
   RLS arm on applications: RLS grants rows, not columns, so it would hand over
   tenant PII, the rent and the commission snapshots. It is a projection on a
   written-down allowlist, and the allowlist lives in the migration.
   --------------------------------------------------------------------------- */

export interface LiveApplication {
  id: string;
  guarantee_ref: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  paid_at: string | null;
  deed_issued_at: string | null;
  /** The developer's own idempotency string, echoed back. Null if not API-created. */
  idempotency_key: string | null;
  api_key_name: string | null;
  request_at: string | null;
  request_status: number | null;
}

export interface LiveCounts {
  total: number; from_api: number; sent: number; paid: number; deed: number; closed: number;
}

export async function getLiveApplications(opts: {
  partnerId?: string | null; search?: string | null; limit?: number;
} = {}): Promise<LiveApplication[]> {
  if (!SUPABASE_ENABLED) return [];
  const { data, error } = await sb().rpc('dev_live_applications', {
    p_partner: opts.partnerId ?? null,
    p_search: opts.search ?? null,
    p_limit: opts.limit ?? 100,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as LiveApplication[];
}

export async function getLiveCounts(partnerId?: string | null): Promise<LiveCounts | null> {
  if (!SUPABASE_ENABLED) return null;
  const { data, error } = await sb().rpc('dev_live_application_counts', { p_partner: partnerId ?? null });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as LiveCounts | null;
}

export interface SandboxCounts {
  total: number; sent: number; paid: number; deed: number; closed: number;
}

export async function getSandboxApplications(opts: {
  partnerId?: string | null; search?: string | null; limit?: number;
} = {}): Promise<SandboxApplication[]> {
  if (!SUPABASE_ENABLED) return [];
  const { data, error } = await sb().rpc('dev_sandbox_applications', {
    p_partner: opts.partnerId ?? null,
    p_search: opts.search ?? null,
    p_limit: opts.limit ?? 100,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as SandboxApplication[];
}

export async function getSandboxCounts(partnerId?: string | null): Promise<SandboxCounts | null> {
  if (!SUPABASE_ENABLED) return null;
  const { data, error } = await sb().rpc('dev_sandbox_counts', { p_partner: partnerId ?? null });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as SandboxCounts | null;
}

/**
 * A fresh PandaDoc signing session for a sandbox deed.
 *
 * Returns the tenant email alongside the link so the warning can name the exact
 * address that received the document, rather than saying "the address you sent",
 * which a developer running several test payloads cannot resolve from memory.
 */
export async function getSandboxSigningLink(applicationId: string): Promise<{
  link: string; tenantEmail: string | null; guaranteeRef: string | null;
}> {
  const { data, error } = await sb().functions.invoke('dev-centre', {
    body: { action: 'signing_link', application_id: applicationId },
  });
  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(data?.error ?? 'Could not get a signing link.');
  return { link: data.link, tenantEmail: data.tenant_email ?? null, guaranteeRef: data.guarantee_ref ?? null };
}

/**
 * Delete every sandbox row for the partner.
 *
 * Needed because the restrictive policy means not even a superadmin can delete a
 * sandbox application through PostgREST, so without this they accumulate for
 * ever. The function's where clause is `not livemode` and never an id list, so
 * it cannot reach a live row whatever it is passed.
 */
export async function purgeSandbox(partnerId?: string | null): Promise<{
  applications: number; agencies: number; branches: number;
}> {
  const { data, error } = await sb().rpc('dev_purge_sandbox', { p_partner: partnerId ?? null });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    applications: Number(row?.applications_deleted ?? 0),
    agencies: Number(row?.agencies_deleted ?? 0),
    branches: Number(row?.branches_deleted ?? 0),
  };
}

/**
 * Put a failed or dead-lettered delivery back on the queue.
 *
 * Not a new send: the queue, the dispatcher, the rendered payload and the retry
 * schedule all already exist, so this resets the live attempt columns and lets
 * the normal machinery run. The previous round is pushed onto prior_attempts
 * first, because "it 500ed eight times" is the evidence that prompted the
 * replay and erasing it makes the second failure indistinguishable from the
 * first.
 */
/**
 * Delete a key outright.
 *
 * Distinct from revoke, which keeps the row because the audit trail is the
 * point: somebody will ask what a key did months later. Delete is only offered
 * where there is nothing to lose, and the rule is enforced in SQL as well, so a
 * hand-crafted call cannot skip it.
 */
export async function deleteApiKey(id: string): Promise<void> {
  const { error } = await sb().rpc('dev_delete_api_key', { p_id: id });
  if (error) throw new Error(error.message);
}

export async function deleteWebhookEndpoint(id: string): Promise<void> {
  const { error } = await sb().rpc('dev_delete_webhook_endpoint', { p_id: id });
  if (error) throw new Error(error.message);
}

/**
 * Why delete is unavailable, in words a person can act on.
 *
 * Computed from data the listing already carries, so this needs no round trip.
 * Returning a reason rather than hiding the button matters: a missing option
 * sends somebody hunting for a feature that is there, and an explanation tells
 * them what to do instead.
 *
 * WHY "no requests" IS THE TEST. Not because we cannot tell what a key created:
 * partner_api_requests carries api_key_id and application_id in the same row, so
 * we can. It is because both that table and the request log reference the key
 * `on delete set null`, so deleting a key leaves its history in place with the
 * column saying who did it set to null. A key with no requests has no history to
 * anonymise; anything else should be revoked.
 */
export function keyDeleteBlockedReason(k: DevApiKey): string | null {
  if (k.last_used_at || k.request_count > 0) {
    return 'This key has been used, so deleting it would remove the record of what it did. Revoke it instead: it stops working immediately and the history is kept.';
  }
  return null;
}

export function endpointDeleteBlockedReason(e: DevWebhookEndpoint): string | null {
  if (e.delivery_count > 0) {
    return `This endpoint has ${e.delivery_count} ${plural(e.delivery_count, 'delivery')} on record, so deleting it would remove the history of what was sent and whether it arrived. Disable it instead.`;
  }
  return null;
}

/**
 * Break-glass revoke, by key prefix.
 *
 * An opndoor admin cannot see a partner's keys, so there is nothing to browse
 * and no id to pass. They supply a prefix they already have, from wherever the
 * key was exposed. That shape is the safeguard: it is a targeted act on a
 * credential somebody told you about, not the last step of an inventory, and no
 * prefix can be obtained through it that you did not already hold.
 *
 * A reason is mandatory and is recorded against the caller's name in
 * security_events. A miss is recorded too: an admin trying prefixes is exactly
 * what that table exists to surface.
 */
export async function breakGlassRevoke(
  keyPrefix: string, reason: string,
): Promise<{ ok: boolean; partner: string | null; key: string | null }> {
  const { data, error } = await sb().rpc('admin_break_glass_revoke_key', {
    p_key_prefix: keyPrefix,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: row?.revoked === true, partner: row?.partner_name ?? null, key: row?.key_name ?? null };
}

export async function replayDelivery(id: string): Promise<{ replayCount: number }> {
  const { data, error } = await sb().rpc('dev_replay_webhook_delivery', { p_delivery: id });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return { replayCount: Number(row?.replay_count ?? 0) };
}

/**
 * Fire a signed dummy event at an endpoint and return the response inline.
 *
 * Deliberately bypasses the queue. The queue is right for real events but it is
 * asynchronous, and the whole value here is seeing the response next to the
 * payload that produced it. It signs with the same helper the dispatcher uses,
 * because a test signed any other way would prove nothing about the real one.
 */
export async function sendTestEvent(endpointId: string, eventType: string): Promise<TestEventResult> {
  const { data, error } = await sb().functions.invoke('dev-centre', {
    body: { action: 'test_event', endpoint_id: endpointId, event_type: eventType },
  });
  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(data?.error ?? 'Could not send the test event.');
  return { request: data.request, response: data.response };
}

export function maskSecret(value: string, visibleChars = 6): string {
  if (!value) return '';
  return `${value.slice(0, visibleChars)}${'•'.repeat(Math.max(8, Math.min(24, value.length - visibleChars)))}`;
}

export async function getPartnerOptions(): Promise<DevPartnerOption[]> {
  if (!SUPABASE_ENABLED) return [];
  const { data, error } = await sb().rpc('dev_partner_options');
  if (error) throw new Error(error.message);
  return (data ?? []) as DevPartnerOption[];
}

/**
 * The caller's own partner record, or null when there is none to read.
 *
 * Returns null rather than throwing on error: this drives a notice, and a
 * screen that fails to load because it could not decide whether to show an
 * advisory banner is worse than the missing banner.
 */
export async function getMyPartner(): Promise<DevMyPartner | null> {
  if (!SUPABASE_ENABLED) return null;
  const { data, error } = await sb().rpc('my_partner_summary');
  if (error) return null;
  const row = (data ?? [])[0];
  return (row as DevMyPartner) ?? null;
}

/**
 * Which environment this portal is.
 *
 * DERIVED FROM THE PROJECT, NOT CONFIGURED. The Supabase URL contains the
 * project ref, and the ref is checked against the same NON_PRODUCTION_REFS list
 * the Stripe key guard uses (supabase/functions/_shared/stripeMode.ts, extracted
 * into src/config by scripts/generate-environment.mjs). So the banner and the
 * requirement for a live Stripe key can never disagree about which project is
 * production, and deploying this to live shows the live banner with no
 * configuration change at all.
 *
 * WHAT THIS DOES AND DOES NOT MEAN. It answers "which Supabase project is this
 * deployment pointed at", NOT "am I in sandbox mode". Those were the same
 * question when sandbox was going to be a second project; they are unrelated
 * now. Sandbox and live keys, endpoints and applications all live in this one
 * database, side by side, told apart by livemode. A development project holds
 * both too, its own copies of both.
 *
 * The naming is deliberate. It used to return 'sandbox' | 'live', which now
 * collides head-on with the mode of a key, so it returns
 * 'development' | 'production' and nothing reads the word sandbox off it.
 *
 * UNRECOGNISED MEANS PRODUCTION. Same direction as the Stripe guard: an unknown
 * project, a missing URL or a malformed one all resolve to live. Being wrongly
 * warned that you are in production is a moment's confusion; being wrongly
 * reassured that you are in sandbox is how somebody mints a live key believing
 * it is a test one.
 *
 * The earlier version keyed on the Stripe publishable key. That was one config
 * value away from lying: a project with no VITE_STRIPE_PUBLISHABLE_KEY set would
 * have shown "Sandbox" whatever it actually was.
 */
export function portalEnvironment(): { id: 'production' | 'development'; label: string; ref: string } {
  const url = String(import.meta.env.VITE_SUPABASE_URL ?? '');
  const ref = /https:\/\/([a-z]{20})\./.exec(url)?.[1] ?? '';
  return NON_PRODUCTION_REFS.includes(ref)
    ? { id: 'development', label: 'Development project', ref }
    : { id: 'production', label: 'Production', ref };
}

/** A delivery's state, for display. */
export function deliveryState(d: DevDelivery): { label: string; tone: 'ok' | 'pending' | 'retry' | 'dead' } {
  if (d.delivered_at) return { label: 'Delivered', tone: 'ok' };
  if (d.dead_at) return { label: 'Dead lettered', tone: 'dead' };
  if (d.attempts > 0) return { label: `Retrying (${d.attempts})`, tone: 'retry' };
  return { label: 'Queued', tone: 'pending' };
}
