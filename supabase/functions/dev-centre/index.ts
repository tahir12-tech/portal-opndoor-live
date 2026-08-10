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
import { generateEndpointSecret } from "../_shared/webhookSigning.ts";

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
  "applications:write", "applications:read", "orgs:read", "orgs:write", "webhooks:manage",
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

      // Which environment this portal is. A key minted in sandbox must never be
      // a live key, and the prefix is what a partner reads to tell them apart.
      const env = (Deno.env.get("PORTAL_ENV") ?? "test") === "live" ? "live" : "test";

      const key = generateApiKey(env);
      const { data, error } = await service.from("partner_api_keys").insert({
        partner_id: partnerId,
        name,
        key_prefix: key.slice(0, 18),
        key_hash: await sha256Hex(key),
        scopes,
        created_by: me.id,
        expires_at: body.expires_at ? new Date(String(body.expires_at)).toISOString() : null,
      }).select("id, name, key_prefix, scopes, created_at, expires_at").maybeSingle();

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

      const secret = generateEndpointSecret();
      const { data, error } = await service.from("partner_webhook_endpoints").insert({
        partner_id: partnerId,
        url,
        secret,
        events,
        description: String(body.description ?? "").trim() || null,
      }).select("id, url, events, active, created_at").maybeSingle();

      if (error) return json({ ok: false, error: error.message }, 400);
      return json({ ok: true, secret, record: data }, 201);
    }

    return json({ ok: false, error: "Unknown action." }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
