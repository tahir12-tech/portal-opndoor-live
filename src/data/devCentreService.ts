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

export async function getPartnerOptions(): Promise<DevPartnerOption[]> {
  if (!SUPABASE_ENABLED) return [];
  const { data, error } = await sb().rpc('dev_partner_options');
  if (error) throw new Error(error.message);
  return (data ?? []) as DevPartnerOption[];
}

/**
 * Which environment this portal is.
 *
 * Sandbox and live are separate projects with separate Dev Centres and separate
 * keys, so the banner has to be unmistakable: a partner reading sandbox delivery
 * history while debugging live is a long and confusing afternoon.
 *
 * Derived from the Stripe publishable key rather than a dedicated flag, because
 * that key is already the thing that decides whether real money moves, so the two
 * can never disagree.
 */
export function portalEnvironment(): { id: 'live' | 'sandbox'; label: string } {
  const k = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? '';
  return String(k).startsWith('pk_live_')
    ? { id: 'live', label: 'Live' }
    : { id: 'sandbox', label: 'Sandbox' };
}

/** A delivery's state, for display. */
export function deliveryState(d: DevDelivery): { label: string; tone: 'ok' | 'pending' | 'retry' | 'dead' } {
  if (d.delivered_at) return { label: 'Delivered', tone: 'ok' };
  if (d.dead_at) return { label: 'Dead lettered', tone: 'dead' };
  if (d.attempts > 0) return { label: `Retrying (${d.attempts})`, tone: 'retry' };
  return { label: 'Queued', tone: 'pending' };
}
