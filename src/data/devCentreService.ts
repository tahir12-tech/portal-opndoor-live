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
}

export interface DevPartnerOption {
  id: string;
  slug: string;
  name: string;
  referencing_mode: string;
}

/** The scopes a key may carry. Kept in step with the Edge Function's allowlist. */
export const API_SCOPES: { id: string; label: string; desc: string }[] = [
  { id: 'applications:write', label: 'Create applications', desc: 'POST /v1/applications' },
  { id: 'applications:read', label: 'Read applications', desc: 'GET /v1/applications and /v1/applications/{id}' },
  { id: 'orgs:read', label: 'Read organisations', desc: 'GET /v1/orgs, to look up agency and branch ids' },
  { id: 'orgs:write', label: 'Create organisations', desc: 'Allows POSTing an application with agency and branch NAMES instead of ids, creating them on the fly' },
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
  partnerId: string; name: string; scopes: string[]; expiresAt?: string | null;
}): Promise<{ key: string; record: Partial<DevApiKey> }> {
  const { data, error } = await sb().functions.invoke('dev-centre', {
    body: {
      action: 'mint_key',
      partner_id: input.partnerId,
      name: input.name,
      scopes: input.scopes,
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
  partnerId: string; url: string; events: string[]; description?: string;
}): Promise<{ secret: string; record: Partial<DevWebhookEndpoint> }> {
  const { data, error } = await sb().functions.invoke('dev-centre', {
    body: {
      action: 'create_endpoint',
      partner_id: input.partnerId,
      url: input.url,
      events: input.events,
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
 * UNRECOGNISED MEANS LIVE. Same direction as the Stripe guard: an unknown
 * project, a missing URL or a malformed one all resolve to live. Being wrongly
 * warned that you are in production is a moment's confusion; being wrongly
 * reassured that you are in sandbox is how somebody mints a live key believing
 * it is a test one.
 *
 * The earlier version keyed on the Stripe publishable key. That was one config
 * value away from lying: a project with no VITE_STRIPE_PUBLISHABLE_KEY set would
 * have shown "Sandbox" whatever it actually was.
 */
export function portalEnvironment(): { id: 'live' | 'sandbox'; label: string; ref: string } {
  const url = String(import.meta.env.VITE_SUPABASE_URL ?? '');
  const ref = /https:\/\/([a-z]{20})\./.exec(url)?.[1] ?? '';
  return NON_PRODUCTION_REFS.includes(ref)
    ? { id: 'sandbox', label: 'Sandbox', ref }
    : { id: 'live', label: 'Live', ref };
}

/** A delivery's state, for display. */
export function deliveryState(d: DevDelivery): { label: string; tone: 'ok' | 'pending' | 'retry' | 'dead' } {
  if (d.delivered_at) return { label: 'Delivered', tone: 'ok' };
  if (d.dead_at) return { label: 'Dead lettered', tone: 'dead' };
  if (d.attempts > 0) return { label: `Retrying (${d.attempts})`, tone: 'retry' };
  return { label: 'Queued', tone: 'pending' };
}
