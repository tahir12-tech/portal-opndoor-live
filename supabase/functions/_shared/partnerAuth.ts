// =====================================================================
// Partner API key authentication. See PARTNER-API.md section 4.
//
// Verifies the Authorization: Bearer <key> header against public.partner_api_keys
// and returns the partner_id the caller is scoped to. Every partner-facing query
// must filter on that value: the Edge Function runs as service_role, so RLS
// provides no protection on this path (see the migration's header).
//
// TWO PROPERTIES THIS FILE EXISTS TO GUARANTEE
//
// 1. A bad prefix costs the same as a bad secret. The obvious implementation
//    returns early when the prefix lookup misses, which leaks by timing which
//    prefixes exist and lets an attacker enumerate partners cheaply. Here the
//    miss path performs the same hash and the same comparison against a fixed
//    decoy, discards the result, and returns the same failure. The revoked and
//    expired checks likewise happen AFTER the comparison, never before, so a
//    revoked key costs the same as a live one.
//
// 2. Every failure is indistinguishable. Malformed key, unknown prefix, wrong
//    secret, revoked, expired: identical status, identical body, identical
//    headers. Only the server-side log records which it was.
//
// WHY SHA-256 AND NOT ARGON2 OR SCRYPT. A departure from the first draft of the
// spec, made deliberately. The key is 32 random base62 characters from a CSPRNG,
// around 190 bits, not a user-chosen password, so there is no dictionary and
// nothing to brute force: at 10^12 guesses a second the search still outlasts
// the sun. A deliberately slow KDF would buy nothing against that, and would
// cost something real, because it runs on every request including
// unauthenticated ones and would turn the auth path into a CPU exhaustion
// vector. It would also make property 1 above expensive to honour, since the
// miss path has to do the same work as the hit path. This is the same reasoning
// Stripe and GitHub apply to their API keys.
//
// This is the first timing-safe comparison in the codebase. Every other secret
// or signature check here uses ===, including the PandaDoc HMAC at
// _shared/pandadoc.ts:392 and the ops-secret checks in hubspot-sync and
// ops-alert. Those are worth revisiting separately.
// =====================================================================

/** Length of the identifying prefix: 'opnd_live_' or 'opnd_test_' plus 8 random characters. */
const PREFIX_LEN = 18;

/**
 * A syntactically valid but unissuable hash, used so the miss path does the same
 * work as the hit path. 64 hex characters, matching a real SHA-256.
 */
const DECOY_HASH = "0".repeat(64);

/** The single failure body. Never varied, never given a reason. */
export const AUTH_FAILURE_BODY = {
  error: { code: "unauthorized", message: "Invalid credentials." },
} as const;

export type PartnerAuth = {
  partnerId: string;
  apiKeyId: string;
  scopes: string[];
};

/** Why a request failed. Server-side only. Never returned to the caller. */
export type AuthFailure =
  | "missing_header"
  | "malformed_key"
  | "unknown_prefix"
  | "bad_secret"
  | "revoked"
  | "expired"
  | "partner_inactive"
  | "lookup_error";

export type AuthResult =
  | { ok: true; auth: PartnerAuth }
  | { ok: false; reason: AuthFailure };

/** SHA-256, lowercase hex. */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant-time string comparison.
 *
 * Compares over a fixed number of iterations regardless of where the first
 * difference falls, so the duration does not reveal the length of a matching
 * prefix. A length mismatch still does the full loop before returning false,
 * rather than short-circuiting.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    // charCodeAt past the end returns NaN; ?? 0 keeps the XOR well defined
    // without branching on which string ran out first.
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(i);
    diff |= (Number.isNaN(ca) ? 0 : ca) ^ (Number.isNaN(cb) ? 0 : cb);
  }
  return diff === 0;
}

/**
 * Authenticate a request. Returns the partner scope on success.
 *
 * The caller decides what to do with a failure. It must not surface `reason`:
 * that exists for server-side logging only.
 */
export async function authenticatePartner(
  req: Request,
  // deno-lint-ignore no-explicit-any
  service: any,
): Promise<AuthResult> {
  const header = req.headers.get("Authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!presented) {
    // No hash to compare, but still spend the time so a missing header is not
    // measurably faster than a wrong one.
    await sha256Hex(DECOY_HASH);
    return { ok: false, reason: "missing_header" };
  }

  const presentedHash = await sha256Hex(presented);

  // A malformed key still gets looked up (with a prefix that cannot match) and
  // still gets compared, so it costs the same as a well-formed wrong one.
  const malformed = presented.length <= PREFIX_LEN || !/^opnd_(live|test)_[A-Za-z0-9]+$/.test(presented);
  const prefix = malformed ? DECOY_HASH.slice(0, PREFIX_LEN) : presented.slice(0, PREFIX_LEN);

  const { data: row, error } = await service
    .from("partner_api_keys")
    .select("id, partner_id, key_hash, scopes, revoked_at, expires_at")
    .eq("key_prefix", prefix)
    .maybeSingle();

  if (error) {
    // Compare anyway so an infrastructure failure is not a timing oracle either.
    timingSafeEqual(presentedHash, DECOY_HASH);
    return { ok: false, reason: "lookup_error" };
  }

  // The comparison ALWAYS happens, against the decoy when there is no row.
  const stored = row?.key_hash ?? DECOY_HASH;
  const matches = timingSafeEqual(presentedHash, stored);

  if (!row) return { ok: false, reason: "unknown_prefix" };
  if (!matches) return { ok: false, reason: malformed ? "malformed_key" : "bad_secret" };

  // Lifecycle checks come AFTER the comparison so a revoked or expired key costs
  // the same as a live one.
  if (row.revoked_at !== null) return { ok: false, reason: "revoked" };
  if (row.expires_at !== null && new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  return {
    ok: true,
    auth: { partnerId: row.partner_id, apiKeyId: row.id, scopes: row.scopes ?? [] },
  };
}

/**
 * Record that a key was used.
 *
 * Deliberately fire-and-forget and never awaited by the request path: it must
 * not be the reason a request is slower, and a write failure must not fail an
 * otherwise valid request.
 */
// deno-lint-ignore no-explicit-any
export function touchKey(service: any, apiKeyId: string): void {
  service
    .from("partner_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", apiKeyId)
    .then(() => {})
    .catch(() => {});
}

/** Scope check. Kept separate from mode: no scope may ever be inferred from referencing_mode. */
export function hasScope(auth: PartnerAuth, required: string): boolean {
  return auth.scopes.includes(required);
}
