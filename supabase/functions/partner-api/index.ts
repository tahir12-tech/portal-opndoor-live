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
import { createApplication, requestHash } from "../_shared/partnerApplications.ts";
import { redactRawBody } from "../_shared/redact.ts";
import { generateEndpointSecret } from "../_shared/webhookSigning.ts";
import { applicationView, decodeCursor, encodeCursor, type ApplicationRow } from "../_shared/partnerViews.ts";

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

/**
 * Observability log, one row per request.
 *
 * Deliberately NOT partner_api_requests: that is the idempotency ledger, keyed
 * on an idempotency key that reads do not have, so every GET would be invisible.
 * Monitoring built on it would under-report by however many reads a partner
 * makes, which is worse than no monitoring because it looks authoritative.
 *
 * Fire and forget, and never awaited: an observability write must not be able to
 * slow down or fail the request it is observing. The RPC swallows its own errors
 * for the same reason.
 */
// deno-lint-ignore no-explicit-any
function logRequest(service: any, fields: {
  partnerId: string | null; apiKeyId: string | null; method: string; path: string;
  status: number; errorCode: string | null; startedAt: number;
  requestBody: unknown; responseBody: unknown;
}): void {
  service.rpc("log_partner_api_request", {
    p_partner: fields.partnerId,
    p_api_key: fields.apiKeyId,
    p_method: fields.method,
    p_path: fields.path,
    p_status: fields.status,
    p_error_code: fields.errorCode,
    p_duration_ms: Math.round(performance.now() - fields.startedAt),
    p_request_body: fields.requestBody ?? null,
    p_response_body: fields.responseBody ?? null,
  }).then(() => {}).catch(() => {});
}

/**
 * Bodies are capped before they are parsed, not after.
 *
 * A 10MB body redacts to a small object, so capping afterwards would still mean
 * parsing it, holding it, and doing it on the logging path of a request that has
 * already been answered. The cap is generous next to a real application payload,
 * which is around 700 bytes.
 */
const MAX_LOGGED_BODY = 64 * 1024;

async function bodyForLog(source: Request | Response): Promise<unknown> {
  try {
    const raw = await source.text();
    if (!raw) return null;
    if (raw.length > MAX_LOGGED_BODY) {
      return { "[oversized]": `${raw.length} bytes, not logged` };
    }
    return redactRawBody(raw);
  } catch {
    return null;
  }
}

/** The error code out of a response envelope, for the error distribution chart. */
function codeOf(body: unknown): string | null {
  const e = (body as { error?: { code?: string } } | null)?.error;
  return e?.code ?? null;
}

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  const reqUrl = new URL(req.url);
  // The path as the partner sees it, with the function mount stripped.
  const logPath = reqUrl.pathname.replace(/^.*\/partner-api/, "") || "/";

  // Set inside run() once known. Logging happens at ONE exit point below rather
  // than at each of the dozen returns, so a new endpoint cannot forget to log.
  let logPartnerId: string | null = null;
  let logKeyId: string | null = null;
  // deno-lint-ignore no-explicit-any
  let logService: any = null;

  // Cloned BEFORE run(), which consumes the body. Cloning afterwards returns a
  // request whose stream is already drained and yields an empty string rather
  // than an error, so every POST would quietly log as having sent nothing.
  // Only methods that carry a body: cloning a GET is work on every read.
  const reqForLog = (req.method === "POST" || req.method === "PATCH" || req.method === "PUT")
    ? req.clone()
    : null;

  const run = async (): Promise<Response> => {
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const service = createClient(SUPABASE_URL, SERVICE);
    logService = service;

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
    logPartnerId = auth.partnerId;
    logKeyId = auth.apiKeyId;

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
      .select("id, status, referencing_mode")
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
    // Path is /functions/v1/partner-api/<api version>/<endpoint>. Segments are
    // taken relative to the function name so it can be renamed or remounted
    // without breaking this.
    //
    // NOTE THE TWO DIFFERENT v1s. The first is Supabase's Edge Function API
    // version and is not ours to change. The second is THIS API's version, and
    // it exists so a breaking change can ship without breaking every partner at
    // once.
    //
    // THE VERSION IS REQUIRED, not defaulted. Treating a missing segment as v1
    // would be friendlier today and useless later: the clients that never sent a
    // version are exactly the ones a v2 would break, which is the problem the
    // segment exists to solve. Nobody has integrated yet, so there is no
    // compatibility to preserve and every client is explicit from the first call.
    const segments = new URL(req.url).pathname.split("/").filter(Boolean);
    const idx = segments.indexOf("partner-api");
    const rest = idx >= 0 ? segments.slice(idx + 1) : [];
    const apiVersion = rest[0] ?? "";
    const endpoint = rest.slice(1).join("/");

    // Adding v2 means adding it here and branching per endpoint. Versions are
    // public API surface, so naming the supported ones in the error is helpful
    // to an integrator and discloses nothing.
    const SUPPORTED_VERSIONS = ["v1"];
    if (!SUPPORTED_VERSIONS.includes(apiVersion)) {
      return json(
        errorBody(
          "unsupported_version",
          `Prefix the path with an API version. Supported: ${SUPPORTED_VERSIONS.join(", ")}.`,
        ),
        404,
        requestId,
      );
    }

    if (endpoint === "orgs") {
      if (req.method !== "GET") {
        return json(errorBody("method_not_allowed", "Use GET."), 405, requestId, { Allow: "GET" });
      }
      if (!hasScope(auth, "orgs:read")) {
        return json(errorBody("insufficient_scope", "This key lacks the orgs:read scope."), 403, requestId);
      }
      return await getOrgs(service, auth.partnerId, auth.livemode, requestId);
    }

    if (endpoint === "applications") {
      if (req.method === "GET") {
        if (!hasScope(auth, "applications:read")) {
          return json(errorBody("insufficient_scope", "This key lacks the applications:read scope."), 403, requestId);
        }
        return await listApplications(service, req, auth.partnerId, auth.livemode, requestId);
      }
      if (req.method !== "POST") {
        return json(errorBody("method_not_allowed", "Use GET or POST."), 405, requestId, { Allow: "GET, POST" });
      }
      if (!hasScope(auth, "applications:write")) {
        return json(errorBody("insufficient_scope", "This key lacks the applications:write scope."), 403, requestId);
      }
      return await postApplication(
        service, req, auth.partnerId, auth.livemode, auth.apiKeyId, auth.scopes, partner.referencing_mode, requestId,
      );
    }

    if (endpoint.startsWith("applications/")) {
      if (req.method !== "GET") {
        return json(errorBody("method_not_allowed", "Use GET."), 405, requestId, { Allow: "GET" });
      }
      if (!hasScope(auth, "applications:read")) {
        return json(errorBody("insufficient_scope", "This key lacks the applications:read scope."), 403, requestId);
      }
      return await getApplication(
        service, auth.partnerId, auth.livemode, endpoint.slice("applications/".length), requestId,
      );
    }

    if (endpoint === "webhook-endpoints") {
      if (!hasScope(auth, "webhooks:manage")) {
        return json(errorBody("insufficient_scope", "This key lacks the webhooks:manage scope."), 403, requestId);
      }
      if (req.method === "GET") return await listWebhookEndpoints(service, auth.partnerId, auth.livemode, requestId);
      if (req.method === "POST") return await createWebhookEndpoint(service, req, auth.partnerId, auth.livemode, requestId);
      return json(errorBody("method_not_allowed", "Use GET or POST."), 405, requestId, { Allow: "GET, POST" });
    }

    if (endpoint.startsWith("webhook-endpoints/")) {
      if (!hasScope(auth, "webhooks:manage")) {
        return json(errorBody("insufficient_scope", "This key lacks the webhooks:manage scope."), 403, requestId);
      }
      if (req.method !== "DELETE") {
        return json(errorBody("method_not_allowed", "Use DELETE."), 405, requestId, { Allow: "DELETE" });
      }
      return await deleteWebhookEndpoint(service, auth.partnerId, auth.livemode, endpoint.slice("webhook-endpoints/".length), requestId);
    }

    return json(errorBody("not_found", "Unknown endpoint."), 404, requestId);
  } catch (e) {
    // Never leak internals. The request id is the only handle, and it ties to
    // the server-side log line.
    console.log(JSON.stringify({ requestId, event: "unhandled_error", message: String(e) }));
    return json(errorBody("internal_error", "Something went wrong."), 500, requestId);
  }
  };

  // Cloned BEFORE run(), because run() consumes the body. Cloning afterwards
  // returns a request whose stream is already drained, which yields an empty
  // string rather than an error, so the log would quietly show every POST as
  // having sent nothing.
  const res = await run();

  // One log per request, whatever route it took. The body is cloned rather than
  // read, so consuming it here cannot starve the response the caller receives.
  if (logService) {
    let errorCode: string | null = null;
    if (res.status >= 400) {
      try { errorCode = codeOf(await res.clone().json()); } catch { /* not JSON */ }
    }

    // Redacted here, before the insert, so the unredacted value never reaches
    // Postgres, the WAL or a backup. See _shared/redact.ts.
    const [requestBody, responseBody] = await Promise.all([
      reqForLog ? bodyForLog(reqForLog) : Promise.resolve(null),
      bodyForLog(res.clone()),
    ]);

    logRequest(logService, {
      partnerId: logPartnerId, apiKeyId: logKeyId,
      method: req.method, path: logPath,
      status: res.status, errorCode, startedAt,
      requestBody, responseBody,
    });
  }

  return res;
});

/**
 * GET /orgs
 *
 * Agencies and branches for this partner, so the partner can store IDs and stop
 * sending names. has_agent_contact means a deed can be issued: see the migration
 * header for why that is not the same as a contact row existing.
 */
// deno-lint-ignore no-explicit-any
async function getOrgs(service: any, partnerId: string, livemode: boolean, requestId: string): Promise<Response> {
  const { data: rows, error } = await service.rpc("partner_api_orgs", { p_partner: partnerId, p_livemode: livemode });

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

/**
 * POST /applications
 *
 * The idempotency claim is the first thing that happens and the recorded
 * response is the last, so a retry can never double-create. See
 * PARTNER-API.md section 11 for why this matters more here than on the form:
 * retrying after a timeout is normal client behaviour, and without this a
 * network blip bills a tenant twice.
 */
// deno-lint-ignore no-explicit-any
async function postApplication(
  // deno-lint-ignore no-explicit-any
  service: any,
  req: Request,
  partnerId: string,
  livemode: boolean,
  apiKeyId: string,
  scopes: string[],
  mode: string,
  requestId: string,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(errorBody("malformed_request", "Body must be valid JSON."), 400, requestId);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json(errorBody("malformed_request", "Body must be a JSON object."), 400, requestId);
  }

  const idemKey = req.headers.get("Idempotency-Key")?.trim() ||
    (typeof body.idempotency_key === "string" ? body.idempotency_key.trim() : "");

  if (!idemKey) {
    return json(
      errorBody("malformed_request", "An Idempotency-Key header or idempotency_key field is required."),
      400,
      requestId,
    );
  }

  const hash = await requestHash(body);

  // ---- claim the key ------------------------------------------------------
  // The unique index on (partner_id, endpoint, idempotency_key) is what makes
  // this a claim rather than a check-then-act: two concurrent retries race here
  // and exactly one wins.
  const { data: claim, error: claimErr } = await service
    .from("partner_api_requests")
    .insert({
      partner_id: partnerId,
      api_key_id: apiKeyId,
      idempotency_key: idemKey,
      endpoint: "POST /applications",
      // Part of the unique key, so a sandbox rehearsal and a live request can
      // share an Idempotency-Key without either replaying the other.
      livemode,
      request_hash: hash,
    })
    .select("id")
    .maybeSingle();

  if (claimErr) {
    // 23505 is the unique violation: this key has been seen before.
    if (claimErr.code !== "23505") {
      console.log(JSON.stringify({ requestId, event: "idem_claim_failed", message: claimErr.message }));
      return json(errorBody("internal_error", "Something went wrong."), 500, requestId);
    }

    const { data: prior } = await service
      .from("partner_api_requests")
      .select("request_hash, status_code, response_body")
      .eq("partner_id", partnerId)
      .eq("livemode", livemode)
      .eq("endpoint", "POST /applications")
      .eq("idempotency_key", idemKey)
      .maybeSingle();

    if (!prior) return json(errorBody("internal_error", "Something went wrong."), 500, requestId);

    // Same key, different body. Almost always a client bug: a key reused for a
    // genuinely different application. Returning the first application's details
    // would be worse than an error, because it would look like success.
    if (prior.request_hash !== hash) {
      return json(
        errorBody("idempotency_key_reused", "This idempotency key was used for a different request."),
        409,
        requestId,
      );
    }

    // Same key, same body, still running.
    if (prior.status_code === null) {
      return json(errorBody("request_in_progress", "This request is still being processed."), 409, requestId, {
        "Retry-After": "2",
      });
    }

    // Genuine retry: replay the stored response verbatim.
    return json(prior.response_body, prior.status_code, requestId, { "Idempotent-Replay": "true" });
  }

  // ---- do the work --------------------------------------------------------
  let outcome;
  try {
    outcome = await createApplication(service, partnerId, livemode, scopes, mode, body);
  } catch (e) {
    console.log(JSON.stringify({ requestId, event: "create_failed", message: String(e) }));
    outcome = { status: 500, body: errorBody("internal_error", "Something went wrong.") };
  }

  // ---- record it ----------------------------------------------------------
  // Failures are recorded too. A retry of a request that failed validation must
  // replay that failure rather than re-running it, or the key means nothing.
  await service
    .from("partner_api_requests")
    .update({
      status_code: outcome.status,
      response_body: outcome.body,
      application_id: outcome.applicationId ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", claim!.id);

  return json(outcome.body, outcome.status, requestId);
}

/**
 * GET /webhook-endpoints
 *
 * The secret is NEVER returned. It is shown once at registration and is not
 * retrievable, the same posture as an API key: a listing endpoint that returns
 * signing secrets turns any read-scoped leak into a forgery capability.
 */
// deno-lint-ignore no-explicit-any
async function listWebhookEndpoints(service: any, partnerId: string, livemode: boolean, requestId: string): Promise<Response> {
  const { data, error } = await service
    .from("partner_webhook_endpoints")
    .select("id, url, events, active, description, created_at, last_success_at, last_failure_at, consecutive_failures")
    .eq("partner_id", partnerId)
    // A sandbox key lists sandbox endpoints and a live key lists live ones. Two
    // separate registries, deliberately: a partner rehearsing retries by pointing
    // an endpoint at a broken URL must not be able to do that to their live one.
    .eq("livemode", livemode)
    .order("created_at", { ascending: false });

  if (error) {
    console.log(JSON.stringify({ requestId, event: "webhook_list_failed", message: error.message }));
    return json(errorBody("internal_error", "Something went wrong."), 500, requestId);
  }

  return json({ endpoints: data ?? [] }, 200, requestId);
}

/**
 * POST /webhook-endpoints
 *
 * Returns the signing secret exactly once. Partners must store it at this point
 * or register a new endpoint.
 */
// deno-lint-ignore no-explicit-any
async function createWebhookEndpoint(service: any, req: Request, partnerId: string, livemode: boolean, requestId: string): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(errorBody("malformed_request", "Body must be valid JSON."), 400, requestId);
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  const fields: { field: string; code: string; message: string }[] = [];

  // https only. The payload carries tenant PII and the signature; over plain
  // http both are readable in transit. The database enforces this too, but a
  // field error is a better answer than a constraint violation.
  if (!url) {
    fields.push({ field: "url", code: "required", message: "A url is required." });
  } else if (!url.startsWith("https://")) {
    fields.push({ field: "url", code: "must_be_https", message: "The url must use https." });
  }

  const events = Array.isArray(body.events) ? body.events.filter((e) => typeof e === "string") as string[] : [];
  const KNOWN = [
    "application.created", "application.paid", "application.deed_issued",
    "application.lapsed", "application.withdrawn", "application.reinstated",
  ];
  for (const e of events) {
    if (!KNOWN.includes(e)) {
      fields.push({ field: "events", code: "unknown_event", message: `Unknown event type: ${e}` });
    }
  }

  if (fields.length > 0) {
    return json(
      { error: { code: "validation_failed", message: "The endpoint was not created.", fields } },
      422,
      requestId,
    );
  }

  const secret = generateEndpointSecret();

  const { data, error } = await service
    .from("partner_webhook_endpoints")
    .insert({
      partner_id: partnerId,
      // From the key, never from the body. The request has no say in this.
      livemode,
      url,
      secret,
      events,
      description: typeof body.description === "string" ? body.description.trim() : null,
    })
    .select("id, url, events, active, created_at")
    .maybeSingle();

  if (error) {
    console.log(JSON.stringify({ requestId, event: "webhook_create_failed", message: error.message }));
    return json(errorBody("internal_error", "Something went wrong."), 500, requestId);
  }

  return json({ endpoint: data, secret }, 201, requestId);
}

/** DELETE /webhook-endpoints/{id}. Scoped to the caller's partner. */
// deno-lint-ignore no-explicit-any
async function deleteWebhookEndpoint(service: any, partnerId: string, livemode: boolean, id: string, requestId: string): Promise<Response> {
  const { data, error } = await service
    .from("partner_webhook_endpoints")
    .delete()
    .eq("id", id)
    .eq("partner_id", partnerId)   // never delete another partner's endpoint
    .eq("livemode", livemode)      // and a sandbox key never deletes a live one
    .select("id")
    .maybeSingle();

  if (error) {
    console.log(JSON.stringify({ requestId, event: "webhook_delete_failed", message: error.message }));
    return json(errorBody("internal_error", "Something went wrong."), 500, requestId);
  }
  // Same answer whether it does not exist or belongs to another partner.
  if (!data) return json(errorBody("not_found", "Unknown endpoint."), 404, requestId);

  return new Response(null, { status: 204, headers: { ...cors, "X-Request-Id": requestId } });
}

/**
 * GET /applications/{id}
 *
 * Includes payment_url, because a partner fetching one application is acting on
 * it. The list endpoint deliberately does not: see partnerViews.ts.
 */
// deno-lint-ignore no-explicit-any
async function getApplication(service: any, partnerId: string, livemode: boolean, id: string, requestId: string): Promise<Response> {
  // A malformed id must not reach the RPC as a cast error. Same answer as a
  // genuine miss, so the shape of an id is not a probe either.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return json(errorBody("not_found", "Unknown application."), 404, requestId);
  }

  const { data, error } = await service.rpc("partner_api_applications", {
    p_partner: partnerId,
    p_livemode: livemode,
    p_id: id,
    p_status: null,
    p_limit: 1,
    p_cursor_created_at: null,
    p_cursor_id: null,
  });

  if (error) {
    console.log(JSON.stringify({ requestId, event: "application_read_failed", message: error.message }));
    return json(errorBody("internal_error", "Something went wrong."), 500, requestId);
  }

  const rows = (data ?? []) as ApplicationRow[];
  // The RPC filters on partner_id, so another partner's application returns no
  // rows and is indistinguishable from one that does not exist.
  if (rows.length === 0) return json(errorBody("not_found", "Unknown application."), 404, requestId);

  return json(
    { application: applicationView(rows[0], { appUrl: Deno.env.get("APP_URL") ?? "", includePaymentUrl: true }) },
    200,
    requestId,
  );
}

/**
 * GET /applications
 *
 * Keyset paginated, newest first. `next_cursor` is null on the last page, which
 * is the termination signal: a client loops until it is null rather than
 * counting pages.
 */
// deno-lint-ignore no-explicit-any
async function listApplications(service: any, req: Request, partnerId: string, livemode: boolean, requestId: string): Promise<Response> {
  const url = new URL(req.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100) : 50;

  // Filter by the PARTNER-FACING status, so a caller filters with the same
  // vocabulary the responses use. 'lapsed' in, 'expired' to the query.
  const partnerStatus = url.searchParams.get("status");
  const INTERNAL: Record<string, string> = {
    sent: "sent", paid: "paid", deed_issued: "deed", withdrawn: "withdrawn", lapsed: "expired",
  };
  let status: string | null = null;
  if (partnerStatus) {
    if (!(partnerStatus in INTERNAL)) {
      return json(
        {
          error: {
            code: "validation_failed",
            message: "Unknown status filter.",
            fields: [{
              field: "status",
              code: "unknown_value",
              message: `status must be one of ${Object.keys(INTERNAL).join(", ")}`,
            }],
          },
        },
        422,
        requestId,
      );
    }
    status = INTERNAL[partnerStatus];
  }

  const rawCursor = url.searchParams.get("cursor");
  let cursor: { createdAt: string; id: string } | null = null;
  if (rawCursor) {
    cursor = decodeCursor(rawCursor);
    if (!cursor) {
      return json(errorBody("malformed_request", "The cursor is not valid."), 400, requestId);
    }
  }

  // Ask for one more than requested. If it comes back there is another page,
  // which avoids a second count query purely to decide whether to paginate.
  const { data, error } = await service.rpc("partner_api_applications", {
    p_partner: partnerId,
    p_livemode: livemode,
    p_id: null,
    p_status: status,
    p_limit: limit + 1,
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_id: cursor?.id ?? null,
  });

  if (error) {
    console.log(JSON.stringify({ requestId, event: "application_list_failed", message: error.message }));
    return json(errorBody("internal_error", "Something went wrong."), 500, requestId);
  }

  const rows = (data ?? []) as ApplicationRow[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return json(
    {
      applications: page.map((r) => applicationView(r)),
      next_cursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
    },
    200,
    requestId,
  );
}
