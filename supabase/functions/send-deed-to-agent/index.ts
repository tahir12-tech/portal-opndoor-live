// =====================================================================
// send-deed-to-agent (verify_jwt = true)
//
// The manual "Send deed to agent" action and the recovery/resend path. Auth,
// role rules and claim-contact resolution are enforced by the send_deed_to_agent
// RPC (caller-scoped); this function then delivers the same deed email the
// automatic path sends on execution (pandadoc-webhook), redirected to the review
// address in test mode, and writes the activity entry.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { deliverDeedToAgent } from "../_shared/deedEmail.ts";

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

    /* `resend` is the caller saying they have read when this deed last went
       and mean to send it again. The RPC refuses a second send without it:
       one delivery per signed deed, and a resend is a decision. */
    const { ref, recipientEmail, saveContact, resend } = await req.json();
    if (!ref) return json({ ok: false, error: "Missing application reference." }, 400);

    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });

    // RLS-scoped read (only someone who can see the application resolves it).
    const { data: app, error: appErr } = await userClient
      .from("applications")
      .select("id, guarantee_ref, tenant_title, tenant_first_name, tenant_last_name, prop_addr1, prop_postcode, tenancy_start, executed_pdf_path, agency:agencies(name)")
      .eq("guarantee_ref", ref).maybeSingle();
    if (appErr) return json({ ok: false, error: appErr.message }, 400);
    if (!app) return json({ ok: false, error: "Application not found, or you do not have access to it." }, 404);

    // Auth + role rules + claim-contact resolution, all enforced server-side.
    const { data: resolved, error: rpcErr } = await userClient.rpc("send_deed_to_agent", {
      p_app: app.id,
      p_recipient_email: recipientEmail ?? null,
      p_save_contact: saveContact ?? false,
      p_resend: resend === true,
    });
    if (rpcErr) return json({ ok: false, error: rpcErr.message }, 400);
    const sentTo = resolved?.sent_to as string | undefined;
    if (!sentTo) {
      // CANNOT DELIVER, not delivery failed (20261005100000): the ladder
      // resolved nothing, so no send was attempted and delivery_failed_at must
      // stay null. It parks in the queue, admin-facing, because there is no
      // address, no error and nothing the agency can act on.
      const service = createClient(SUPABASE_URL, SERVICE);
      await service.from("applications").update({ awaiting_staff_send: true }).eq("id", app.id);
      await service.from("activity_log").insert({ application_id: app.id, kind: "deed_delivery_failed", message: "Deed issued. No agent contact on file, so it could not be delivered.", actor: "System", visibility: "internal" });
      return json({ ok: false, sentTo: null, error: "No agent contact on file for this branch. Add one, then resend." }, 400);
    }
    // Greet by the resolved contact's name only when the recipient IS that
    // contact; a one-off override address is greeted generically, never by the
    // default contact's name.
    const recipientName = sentTo === (resolved?.resolved_contact as string | undefined) ? ((resolved?.resolved_name as string) ?? "") : "";

    const { data: userData } = await userClient.auth.getUser();
    let actor = "a user";
    if (userData.user?.id) {
      const { data: prof } = await userClient.from("users").select("full_name").eq("id", userData.user.id).maybeSingle();
      if (prof?.full_name) actor = prof.full_name;
    }

    const service = createClient(SUPABASE_URL, SERVICE);
    const agencyName = (Array.isArray(app.agency) ? app.agency[0]?.name : (app.agency as { name?: string } | null)?.name) ?? "";
    const out = await deliverDeedToAgent(service, {
      appId: app.id,
      ref: app.guarantee_ref,
      tenantTitle: app.tenant_title ?? "",
      tenantName: `${app.tenant_first_name} ${app.tenant_last_name}`,
      addr1: app.prop_addr1 ?? "",
      postcode: app.prop_postcode ?? "",
      tenancyStart: app.tenancy_start ?? null,
      agencyName,
      pdfPath: app.executed_pdf_path,
      /* The RPC returns the whole ladder in `recipients`, referrer first. An
         override addresses one person and carries no copies; without one, the
         button sends to exactly who the automatic path sends to, which is the
         reason send_deed_to_agent exists at all. */
    }, {
      email: sentTo,
      name: recipientName,
      also: ((resolved?.recipients as string[] | undefined) ?? []).filter((e) => e !== sentTo),
    }, `sent by ${actor}`);

    // WRITE DOWN THE ATTEMPT, both outcomes. record_delivery_attempt is the
    // only thing that sets delivery_failed_at, and nothing in the tree called
    // it, so a manual send that the provider refused left no trace but a return
    // value: the button reported an error to the person pressing it and the
    // record said nothing had gone wrong. On success it stamps where the deed
    // actually went, the question asked far more often than why it did not,
    // and clears awaiting_staff_send itself, which is why the update below is
    // gone rather than kept alongside it.
    const everyone = [sentTo, ...(((resolved?.recipients as string[] | undefined) ?? [])
      .filter((e) => e !== sentTo))].filter(Boolean);
    await service.rpc("record_delivery_attempt", {
      p_app: app.id, p_ok: out.ok, p_to: sentTo,
      // EVERYONE THE EMAIL ADDRESSED, not just the first of them: the deed
      // goes to the referrer and their copies in one message.
      p_recipients: everyone.join(", "),
      // The rung is only knowable here when the sender overrode it. Null leaves
      // whatever the automatic path last recorded, rather than inventing a rung.
      p_source: recipientEmail ? "explicit" : null,
      p_reason: out.ok ? null : (out.error ?? "The email provider refused the send."),
    }).then(() => {}, () => {});

    return json({ ok: out.ok, sentTo, emailError: out.ok ? null : out.error });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Unexpected error." }, 500);
  }
});
