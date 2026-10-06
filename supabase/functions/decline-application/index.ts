// =====================================================================
// decline-application (verify_jwt = true)
//
// The staff decline, companion to approve-application. It calls decline_application
// (which enforces AAL2 + opndoor admin on the caller and flips 'referencing' ->
// 'declined', stamping decided_by_kind = 'staff'), records it, and emails the
// referring agent that the decision came back declined. A staff decision is
// authoritative: a later provider verdict is logged but never overwrites it.
// Refuses anything not awaiting a decision.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { notifyReferrer } from "../_shared/referrerNotify.ts";

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

    const { ref, reason } = await req.json();
    if (!ref) return json({ ok: false, error: "Missing application reference." }, 400);

    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    let actor = "A user";
    if (userData.user?.id) {
      const { data: prof } = await userClient.from("users").select("full_name").eq("id", userData.user.id).maybeSingle();
      if (prof?.full_name) actor = prof.full_name;
    }

    // RLS-scoped read: only someone who can see the application resolves it.
    const { data: app, error } = await userClient
      .from("applications").select("id, guarantee_ref, status").eq("guarantee_ref", ref).maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 400);
    if (!app) return json({ ok: false, error: "Application not found, or you do not have access to it." }, 404);
    if (app.status !== "referencing") {
      return json({ ok: false, error: "This application is not awaiting a decision." }, 409);
    }

    // The decline itself, through the caller-scoped RPC so its AAL2 + admin checks
    // apply to whoever pressed the button.
    const { error: declErr } = await userClient.rpc("decline_application", { p_ref: ref, p_reason: reason ? String(reason) : null });
    if (declErr) {
      const msg = /MFA/i.test(declErr.message)
        ? "This needs a second factor. Sign in with MFA and try again."
        : /not permitted|permission/i.test(declErr.message)
          ? "You do not have permission to decline this application."
          : declErr.message;
      return json({ ok: false, error: msg }, 403);
    }

    const service = createClient(SUPABASE_URL, SERVICE);
    await service.from("activity_log").insert({
      application_id: app.id,
      kind: "application_declined",
      message: `Application declined by ${actor}.${reason ? ` Reason: ${String(reason)}` : ""}`,
      actor,
      visibility: "business",
    });

    // Tell the referring agent the decision came back declined.
    await notifyReferrer(service, app.id, "declined");

    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Unexpected error." }, 500);
  }
});
