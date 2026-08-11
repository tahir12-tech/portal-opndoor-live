// =====================================================================
// dev-centre (verify_jwt = true)
//
// The two Dev Centre operations that cannot happen in Postgres, because both
// need a CSPRNG and SHA-256: minting an API key, and creating a webhook endpoint
// with a signing secret. Everything else in the Dev Centre is a SQL RPC
// (20260810220000).
//
// WHY NOT pgcrypto. Enabling an extension solely to mint credentials is a poor
// trade, and 20260703153500 deliberately enables only pg_cron and pg_net. The
// hashing already lives in TypeScript for the partner API's own verification
// path, so this keeps one implementation rather than two.
//
// AUTHENTICATION IS THE PORTAL USER'S OWN JWT, not an API key. This is a portal
// screen, so verify_jwt stays ON, unlike partner-api. The caller's role and
// partner are read with a CALLER-SCOPED client so RLS and the AAL2 gate apply,
// and only then is the service role used to write. Reading the caller's own row
// with the service role would skip exactly the checks that make this safe.
//
// The secret is returned exactly once, in the creation response, and is never
// recoverable. The listing RPCs do not return it.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { generateEndpointSecret, signedHeaders } from "../_shared/webhookSigning.ts";
import { getSigningLink } from "../_shared/pandadoc.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

/** Same alphabet and length as the keys the partner API verifies. */
function generateApiKey(env: "live" | "test"): string {
  const ab = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  let r = "";
  for (let i = 0; i < 32; i++) r += ab[b[i] % ab.length];
  return `opnd_${env}_${r}`;
}

async function sha256Hex(input: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(d)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

const KNOWN_EVENTS = [
  "application.created", "application.paid", "application.deed_issued",
  "application.lapsed", "application.withdrawn", "application.reinstated",
];

const KNOWN_SCOPES = [
  // orgs:write is GONE. The API no longer creates organisations: partners create
  // them in the portal first. A scope that grants nothing is worse than no scope,
  // because a partner grants it and believes it did something.
  "applications:write", "applications:read", "orgs:read", "webhooks:manage",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Use POST." }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ ok: false, error: "Not authenticated." }, 401);

    // Caller-scoped: RLS and the AAL2 gate apply to this read.
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: auth } = await userClient.auth.getUser();
    if (!auth?.user) return json({ ok: false, error: "Not authenticated." }, 401);

    const { data: me } = await userClient
      .from("users").select("id, role, partner_id").eq("id", auth.user.id).maybeSingle();

    // A null row here means RLS refused, which for users_select means the caller
    // is not entitled to read even themselves. Treat as unauthorised.
    if (!me) return json({ ok: false, error: "Not permitted." }, 403);

    const isAdmin = me.role === "superadmin";
    const isDeveloper = me.role === "developer";
    if (!isAdmin && !isDeveloper) return json({ ok: false, error: "Not permitted." }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    // The partner being acted on. A developer is pinned to their own; an admin
    // must say which, and is never defaulted to one.
    const partnerId = isAdmin ? String(body.partner_id ?? "") : String(me.partner_id ?? "");
    if (!partnerId) return json({ ok: false, error: "A partner is required." }, 400);

    const service = createClient(SUPABASE_URL, SERVICE);

    if (action === "mint_key") {
      const name = String(body.name ?? "").trim();
      if (!name) return json({ ok: false, error: "A label is required." }, 400);

      const scopes = Array.isArray(body.scopes) ? (body.scopes as string[]) : [];
      const bad = scopes.filter((s) => !KNOWN_SCOPES.includes(s));
      if (bad.length) return json({ ok: false, error: `Unknown scope: ${bad.join(", ")}` }, 400);
      if (!scopes.length) return json({ ok: false, error: "Choose at least one scope." }, 400);

      // WAS: const env = (Deno.env.get("PORTAL_ENV") ?? "test") === "live" ? "live" : "test";
      //
      // That read the mode off the DEPLOYMENT, which was correct when sandbox was
      // going to be a second Supabase project. It is wrong now and it was not
      // merely stale: partnerAuth refuses a key whose prefix and livemode column
      // disagree, and PORTAL_ENV=test on a project where livemode defaults to true
      // would have minted a opnd_test_ prefix onto a livemode=true row. Every key
      // it produced would have been rejected at the first request.
      //
      // The mode is now the developer's explicit choice, with no default. A
      // default of live would hand out real credentials to someone who meant to
      // rehearse; a default of sandbox would hand out keys that quietly do
      // nothing real. Neither is a safe guess, so there is no guess.
      if (typeof body.livemode !== "boolean") {
        return json({ ok: false, error: "Specify whether this is a live or a sandbox key." }, 400);
      }
      const livemode = body.livemode as boolean;

      // A partner without the API capability cannot be given keys. Checked with
      // the SERVICE client against the partner row rather than trusting the
      // screen: the button is hidden for such a partner, and a hidden button is
      // a suggestion.
      const { data: cap } = await service
        .from("partners").select("api_access_enabled").eq("id", partnerId).maybeSingle();
      if (cap?.api_access_enabled !== true) {
        return json({ ok: false, error: "This partner does not have API access enabled. Turn it on in Partner settings first." }, 403);
      }

      const key = generateApiKey(livemode ? "live" : "test");
      const { data, error } = await service.from("partner_api_keys").insert({
        partner_id: partnerId,
        name,
        key_prefix: key.slice(0, 18),
        key_hash: await sha256Hex(key),
        scopes,
        // Written in the same statement as the prefix, from the same variable, so
        // the two cannot drift. partnerAuth cross-checks them on every request.
        livemode,
        created_by: me.id,
        expires_at: body.expires_at ? new Date(String(body.expires_at)).toISOString() : null,
      }).select("id, name, key_prefix, scopes, created_at, expires_at, livemode").maybeSingle();

      if (error) return json({ ok: false, error: error.message }, 400);
      // The one and only time the key exists outside the caller's hands.
      return json({ ok: true, key, record: data }, 201);
    }

    if (action === "create_endpoint") {
      if (!isAdmin && !isDeveloper) return json({ ok: false, error: "Not permitted." }, 403);
      const url = String(body.url ?? "").trim();
      if (!url.startsWith("https://")) return json({ ok: false, error: "The url must use https." }, 400);

      const events = Array.isArray(body.events) ? (body.events as string[]) : [];
      const bad = events.filter((e) => !KNOWN_EVENTS.includes(e));
      if (bad.length) return json({ ok: false, error: `Unknown event: ${bad.join(", ")}` }, 400);

      // Sandbox and live are two separate endpoint registries. Same explicit
      // choice, same reasoning: a partner rehearsing retry behaviour by pointing
      // an endpoint at a deliberately broken URL must not be able to do that to
      // their live one by forgetting a toggle.
      if (typeof body.livemode !== "boolean") {
        return json({ ok: false, error: "Specify whether this endpoint is live or sandbox." }, 400);
      }

      const secret = generateEndpointSecret();
      const { data, error } = await service.from("partner_webhook_endpoints").insert({
        partner_id: partnerId,
        url,
        secret,
        events,
        livemode: body.livemode as boolean,
        description: String(body.description ?? "").trim() || null,
      }).select("id, url, events, active, created_at, livemode").maybeSingle();

      if (error) return json({ ok: false, error: error.message }, 400);
      return json({ ok: true, secret, record: data }, 201);
    }

    // ---- the sandbox deed signing link -------------------------------------
    //
    // A developer cannot open a sandbox application anywhere else in the portal,
    // so without this there is no way to reach the deed their own rehearsal
    // produced and the signing half of the integration cannot be exercised.
    //
    // The document id is NOT taken from the request. It is looked up from the
    // application id through dev_sandbox_application_document, which carries the
    // livemode predicate and the partner scope. A developer who could pass a raw
    // document id could mint a signing session for somebody else's deed,
    // including a live one, and a PandaDoc session link is a bearer credential:
    // whoever holds it can sign.
    if (action === "signing_link") {
      if (!isAdmin && !isDeveloper) return json({ ok: false, error: "Not permitted." }, 403);

      const appId = String(body.application_id ?? "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appId)) {
        return json({ ok: false, error: "An application is required." }, 400);
      }

      // Caller-scoped client, not the service role: this is where the developer's
      // own role, partner and AAL2 are enforced, and using the service role here
      // would skip exactly those checks.
      const { data: rows, error: lookErr } = await userClient
        .rpc("dev_sandbox_application_document", { p_application: appId });
      if (lookErr) return json({ ok: false, error: lookErr.message }, 400);

      const row = Array.isArray(rows) ? rows[0] : rows;
      if (!row) return json({ ok: false, error: "Not a sandbox application you can access." }, 404);
      if (!row.document_id) {
        return json({ ok: false, error: "No deed has been generated for this application yet. Pay it with a test card first." }, 409);
      }

      // livemode false, hardcoded. The lookup already guaranteed the row is
      // sandbox, so passing a variable here would only create the possibility of
      // it being wrong.
      const link = await getSigningLink(row.document_id, row.tenant_email, false);
      if (!link.link) {
        return json({ ok: false, error: link.detail ?? "PandaDoc did not return a signing session." }, 502);
      }

      return json({
        ok: true,
        link: link.link,
        // Returned so the warning in the UI can name the exact address rather
        // than saying "the address you sent", which a developer running several
        // test payloads cannot resolve from memory.
        tenant_email: row.tenant_email,
        guarantee_ref: row.guarantee_ref,
      });
    }

    // ---- send a test event to an endpoint -----------------------------------
    //
    // A newly registered endpoint should be verifiable before real traffic
    // arrives, and the thing a developer most needs to prove is that their
    // signature verification works. Getting that wrong is silent: their handler
    // rejects everything, we see 401s and retry, and they see nothing at all.
    //
    // This does NOT go through the queue. The queue is the right mechanism for
    // real events, but it is asynchronous, and the whole value here is seeing the
    // response inline: status, headers, body, in front of you, next to the
    // payload that produced it. So this signs and posts directly, with the SAME
    // signedHeaders the dispatcher uses, because a test signed any other way
    // would prove nothing about the real one.
    if (action === "test_event") {
      if (!isAdmin && !isDeveloper) return json({ ok: false, error: "Not permitted." }, 403);

      const endpointId = String(body.endpoint_id ?? "");
      const eventType = String(body.event_type ?? "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(endpointId)) {
        return json({ ok: false, error: "An endpoint is required." }, 400);
      }
      if (!KNOWN_EVENTS.includes(eventType)) {
        return json({ ok: false, error: `Unknown event type: ${eventType}` }, 400);
      }

      // Secret fetched server side and never returned. Revealing it is a
      // different action with a different purpose, and a test-send is not a
      // reason for the signing secret to travel to a browser.
      const { data: eps, error: epErr } = await service
        .rpc("dev_endpoint_for_test", { p_endpoint: endpointId, p_actor: me.id });
      if (epErr) return json({ ok: false, error: epErr.message }, 400);
      const ep = Array.isArray(eps) ? eps[0] : eps;
      if (!ep) return json({ ok: false, error: "Endpoint not found." }, 404);

      // The payload is shaped exactly like a real one, with obviously fake
      // values. A test event carrying realistic-looking data is how a partner
      // ends up with a fictional tenant in their CRM, so every string says so.
      const eventId = crypto.randomUUID();
      const payload = {
        event_type: eventType,
        livemode: ep.livemode === true,
        // The one field a real payload does not have. A handler that writes to a
        // database should be able to drop these without a human deciding which
        // rows were tests, and it is additive so it cannot break a strict parser
        // that ignores unknown fields.
        test: true,
        application: {
          id: "00000000-0000-0000-0000-000000000000",
          guarantee_ref: "GR-TEST-EVENT",
          status: eventType === "application.deed_issued" ? "deed_issued"
                : eventType === "application.paid" ? "paid"
                : eventType === "application.withdrawn" ? "withdrawn"
                : eventType === "application.lapsed" ? "lapsed"
                : "awaiting_payment",
          created_at: new Date().toISOString(),
          sent_at: new Date().toISOString(),
          paid_at: null, deed_issued_at: null, expiry_date: null,
          tenant: {
            title: "Mr", first_name: "Test", last_name: "Event",
            date_of_birth: "1990-01-01",
            email: "test.event@example.invalid",   // .invalid is reserved and undeliverable
            phone: "00000000000",
          },
          property: {
            address_line_1: "1 Test Street", address_line_2: null,
            city: "Testville", county: null, postcode: "TE5 T1N",
          },
          tenancy: { monthly_rent: 1000, start_date: "2026-01-01" },
          org: {
            agency_id: "00000000-0000-0000-0000-000000000000",
            agency_name: "Test Agency",
            branch_id: "00000000-0000-0000-0000-000000000000",
            branch_name: "Test Branch",
          },
        },
      };

      const raw = JSON.stringify(payload);
      const headers = await signedHeaders(ep.secret, raw, eventId, eventType);

      // Timeout, so a partner endpoint that accepts the connection and never
      // answers does not hold this function open until the platform kills it.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      const startedAt = Date.now();
      try {
        const res = await fetch(ep.url, { method: "POST", headers, body: raw, signal: ctrl.signal });
        const text = await res.text().catch(() => "");
        return json({
          ok: true,
          request: {
            url: ep.url,
            // Returned so a developer can see the exact signature header their
            // code has to verify, which is the thing being tested.
            headers,
            body: payload,
          },
          response: {
            status: res.status,
            // 2xx is what the dispatcher treats as delivered, so the verdict
            // shown here is the same judgement a real delivery would make.
            ok: res.status >= 200 && res.status < 300,
            duration_ms: Date.now() - startedAt,
            body: text.slice(0, 4000),
          },
        });
      } catch (e) {
        const aborted = (e as Error)?.name === "AbortError";
        return json({
          ok: true,
          request: { url: ep.url, headers, body: payload },
          response: {
            status: 0,
            ok: false,
            duration_ms: Date.now() - startedAt,
            body: aborted
              ? "No response within 10 seconds. The connection was accepted but nothing came back."
              : `Could not reach the endpoint: ${e instanceof Error ? e.message : String(e)}`,
          },
        });
      } finally {
        clearTimeout(timer);
      }
    }

    return json({ ok: false, error: "Unknown action." }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
