// =====================================================================
// partner-api (verify_jwt = FALSE, required)
//
// The partner-facing API surface. See PARTNER-API.md. Stage B implements one
// endpoint, GET /orgs. The router exists so later endpoints slot in without
// each one re-implementing authentication.
//
// DEPLOYMENT: this function MUST be deployed with verify_jwt = false. It
// authenticates with a partner API key in the Authorization header, not a
// Supabase JWT, so leaving JWT verification on rejects every legitimate request
// before this code runs. There is no config.toml in this repo, so verify_jwt is
// a dashboard setting and is not versioned. Same posture as stripe-webhook and
// payment-page.
//
// WHY ONE FUNCTION WITH A ROUTER, rather than one Edge Function per endpoint as
// the other twenty functions here do. This is a deliberate departure. The
// partner API is a multi-endpoint surface that shares authentication, scope
// checks, rate limiting and an error contract. Splitting it per endpoint would
// duplicate the key-verification path, which is the one piece of this that most
// needs to exist exactly once. The URL is /functions/v1/partner-api/orgs; the
// /v1/orgs form in the spec assumes a gateway rewrite that does not exist yet.
//
// SCOPING: RLS DOES NOT PROTECT THIS PATH. Every table carries a restrictive
// AAL2 policy an API-key request can never satisfy, so this runs as service
// role. Partner isolation is entirely this file's responsibility. Every query
// must filter on auth.partnerId, which is derived from the verified key and
// never from a payload.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  AUTH_FAILURE_BODY,
  authenticatePartner,
  hasScope,
  touchKey,
} from "../_shared/partnerAuth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

/** Rate limits. Reuses bump_rate_limit (20260703150645), as payment-confirmation does. */
const LIMITS = {
  // Applied BEFORE key verification. Without this the auth path is itself the
  // attack surface: every attempt costs a hash and a database lookup.
  anonPerIp: { limit: 60, windowSecs: 60 },
  perKey: { limit: 600, windowSecs: 60 },
};

function json(body: unknown, status: number, requestId: string, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, ...extra, "Content-Type": "application/json", "X-Request-Id": requestId },
  });
}

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const requestId = crypto.randomUUID();

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const service = createClient(SUPABASE_URL, SERVICE);

    // ---- rate limit: unauthenticated tier, before any key work -------------
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const { data: ipOk } = await service.rpc("bump_rate_limit", {
      p_key: `papi:anon:${ip}`,
      p_limit: LIMITS.anonPerIp.limit,
      p_window_secs: LIMITS.anonPerIp.windowSecs,
    });
    if (ipOk === false) {
      return json(errorBody("rate_limited", "Too many requests."), 429, requestId, { "Retry-After": "60" });
    }

    // ---- authenticate ------------------------------------------------------
    const result = await authenticatePartner(req, service);
    if (!result.ok) {
      // The reason is logged and never returned. Every failure looks the same.
      console.log(JSON.stringify({ requestId, event: "auth_failed", reason: result.reason }));
      return json(AUTH_FAILURE_BODY, 401, requestId);
    }
    const auth = result.auth;

    // ---- rate limit: per key ----------------------------------------------
    const { data: keyOk } = await service.rpc("bump_rate_limit", {
      p_key: `papi:key:${auth.apiKeyId}`,
      p_limit: LIMITS.perKey.limit,
      p_window_secs: LIMITS.perKey.windowSecs,
    });
    if (keyOk === false) {
      return json(errorBody("rate_limited", "Too many requests."), 429, requestId, { "Retry-After": "60" });
    }

    touchKey(service, auth.apiKeyId);

    // ---- partner must be active -------------------------------------------
    // Safe to disclose: the caller has already proved which partner they are.
    const { data: partner } = await service
      .from("partners")
      .select("id, status")
      .eq("id", auth.partnerId)
      .maybeSingle();

    if (!partner || partner.status !== "active") {
      return json(
        errorBody("partner_inactive", "This partner account is not active."),
        403,
        requestId,
      );
    }

    // ---- route -------------------------------------------------------------
    // Path is /functions/v1/partner-api/<endpoint>. Take the segment after the
    // function name so the function can be renamed or remounted without this
    // breaking.
    const segments = new URL(req.url).pathname.split("/").filter(Boolean);
    const idx = segments.indexOf("partner-api");
    const endpoint = idx >= 0 ? segments.slice(idx + 1).join("/") : "";

    if (endpoint === "orgs") {
      if (req.method !== "GET") {
        return json(errorBody("method_not_allowed", "Use GET."), 405, requestId, { Allow: "GET" });
      }
      if (!hasScope(auth, "orgs:read")) {
        return json(errorBody("insufficient_scope", "This key lacks the orgs:read scope."), 403, requestId);
      }
      return await getOrgs(service, auth.partnerId, requestId);
    }

    return json(errorBody("not_found", "Unknown endpoint."), 404, requestId);
  } catch (e) {
    // Never leak internals. The request id is the only handle, and it ties to
    // the server-side log line.
    console.log(JSON.stringify({ requestId, event: "unhandled_error", message: String(e) }));
    return json(errorBody("internal_error", "Something went wrong."), 500, requestId);
  }
});

/**
 * GET /orgs
 *
 * Agencies and branches for this partner, so the partner can store IDs and stop
 * sending names. has_agent_contact means a deed can be issued: see the migration
 * header for why that is not the same as a contact row existing.
 */
// deno-lint-ignore no-explicit-any
async function getOrgs(service: any, partnerId: string, requestId: string): Promise<Response> {
  const { data: rows, error } = await service.rpc("partner_api_orgs", { p_partner: partnerId });

  if (error) {
    console.log(JSON.stringify({ requestId, event: "orgs_query_failed", message: error.message }));
    return json(errorBody("internal_error", "Something went wrong."), 500, requestId);
  }

  // Flat rows to nested agencies. An agency with no branches arrives as a single
  // row with a null branch_id.
  const byAgency = new Map<string, {
    id: string;
    name: string;
    has_agent_contact: boolean;
    branches: { id: string; name: string; has_agent_contact: boolean }[];
  }>();

  for (const r of rows ?? []) {
    let agency = byAgency.get(r.agency_id);
    if (!agency) {
      agency = {
        id: r.agency_id,
        name: r.agency_name,
        has_agent_contact: r.agency_has_agent_contact === true,
        branches: [],
      };
      byAgency.set(r.agency_id, agency);
    }
    if (r.branch_id) {
      agency.branches.push({
        id: r.branch_id,
        name: r.branch_name,
        has_agent_contact: r.branch_has_agent_contact === true,
      });
    }
  }

  // Explicit field list, never a row passthrough. Section 10 of the spec is
  // default-deny: partner_id, review_state, created_by and every other internal
  // column stay out by construction rather than by remembering to strip them.
  return json({ agencies: Array.from(byAgency.values()) }, 200, requestId);
}
