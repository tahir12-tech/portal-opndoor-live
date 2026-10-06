// =====================================================================
// send-deed-to-landlord (verify_jwt = true)
//
// Agency staff (an owning referrer, or a manager in scope) send the executed
// Deed of Guarantee to their landlord. Auth, role rules and the landlord-detail
// store are enforced by the send_deed_to_landlord RPC (caller-scoped); this
// function then emails the signed deed as an attachment with the sender's short
// covering line, redirected to the review address in test mode, and writes the
// activity entry naming who sent it and to whom. Opndoor staff use the separate
// send-deed-to-agent path.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { deliverDeedToLandlord } from "../_shared/deedEmail.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ ok: false, error: "Not authenticated." }, 401);

    const { ref, name, email, note } = await req.json();
    if (!ref) return json({ ok: false, error: "Missing application reference." }, 400);

    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });

    // RLS-scoped read (only someone who can see the application resolves it).
    const { data: app, error: appErr } = await userClient
      .from("applications")
      .select("id, guarantee_ref, tenant_title, tenant_first_name, tenant_last_name, prop_addr1, prop_postcode, tenancy_start, executed_pdf_path")
      .eq("guarantee_ref", ref).maybeSingle();
    if (appErr) return json({ ok: false, error: appErr.message }, 400);
    if (!app) return json({ ok: false, error: "Application not found, or you do not have access to it." }, 404);

    // Auth + role rules; validates and stores the landlord's name/email on the row.
    const { data: resolved, error: rpcErr } = await userClient.rpc("send_deed_to_landlord", {
      p_app: app.id,
      p_name: name ?? null,
      p_email: email ?? null,
    });
    if (rpcErr) return json({ ok: false, error: rpcErr.message }, 400);
    const sentTo = resolved?.sent_to as string | undefined;
    const landlordName = (resolved?.landlord_name as string | undefined) ?? (typeof name === "string" ? name.trim() : "");
    if (!sentTo) return json({ ok: false, error: "Could not resolve the landlord recipient." }, 400);

    // Who sent it, for the activity entry.
    const { data: userData } = await userClient.auth.getUser();
    let actor = "a user";
    if (userData.user?.id) {
      const { data: prof } = await userClient.from("users").select("full_name").eq("id", userData.user.id).maybeSingle();
      if (prof?.full_name) actor = prof.full_name;
    }

    const service = createClient(SUPABASE_URL, SERVICE);
    const out = await deliverDeedToLandlord(service, {
      appId: app.id,
      ref: app.guarantee_ref,
      tenantTitle: app.tenant_title ?? "",
      tenantName: `${app.tenant_first_name} ${app.tenant_last_name}`,
      addr1: app.prop_addr1 ?? "",
      postcode: app.prop_postcode ?? "",
      tenancyStart: app.tenancy_start ?? null,
      agencyName: "",
      pdfPath: app.executed_pdf_path,
    }, { email: sentTo, name: landlordName, note: typeof note === "string" ? note : "", actor });

    return json({ ok: out.ok, sentTo, emailError: out.ok ? null : out.error });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Unexpected error." }, 500);
  }
});
