// =====================================================================
// approve-application (verify_jwt = true)
//
// The staff approval for a DIRECT-rail application. A direct tenant applies,
// pays the eligibility fee and submits, which leaves the application at
// 'referencing' awaiting opndoor's decision. There is no automated producer of
// 'sent' for this rail yet (that is the Lettings verdict handover, tracked in
// ASK-THE-DEVELOPER.md item 1), so approval is a staff act: this flips the status
// to 'sent' through set_application_status, which enforces AAL2 and, today,
// superadmin (opndoor admin) on the CALLER, then sends the tenant the portal
// approval email that brings them back to sign in and pay the guarantee fee.
// (Approving an eligibility decision is opndoor's call, not the agency's, so
// management is deliberately not admitted; widening that is a separate decision.)
//
// It does NOT touch the referral path: that rail is created at 'sent' already and
// never sits at 'referencing', so this refuses anything not at 'referencing'.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendMessage } from "../_shared/mailer.ts";
import { directApprovalEmail } from "../_shared/emailTemplates.ts";
import { titleCaseAddress } from "../_shared/text.ts";
import { maySendOpndoorEmail } from "../_shared/livemodeCredentials.ts";

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

    const { ref } = await req.json();
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
      .from("applications")
      .select("id, guarantee_ref, tenant_first_name, tenant_email, prop_addr1, prop_postcode, monthly_rent, tenancy_start, status, livemode")
      .eq("guarantee_ref", ref).maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 400);
    if (!app) return json({ ok: false, error: "Application not found, or you do not have access to it." }, 404);
    // Only an application awaiting the decision can be approved. This is the direct
    // rail's pre-approval state; the referral and inbound rails are never here.
    if (app.status !== "referencing") {
      return json({ ok: false, error: "This application is not awaiting a decision." }, 409);
    }

    // The status change itself, through the caller-scoped RPC so its AAL2 and
    // superadmin checks apply to whoever pressed the button. A caller without the
    // role or second factor is refused here, not by this function trusting a claim.
    const { error: statusErr } = await userClient.rpc("set_application_status", { p_app: app.id, p_status: "sent" });
    if (statusErr) {
      const msg = /MFA/i.test(statusErr.message)
        ? "This needs a second factor. Sign in with MFA and try again."
        : /not permitted|permission/i.test(statusErr.message)
          ? "You do not have permission to approve this application."
          : statusErr.message;
      return json({ ok: false, error: msg }, 403);
    }

    const service = createClient(SUPABASE_URL, SERVICE);
    await service.from("activity_log").insert({
      application_id: app.id,
      kind: "application_approved",
      message: `Application approved by ${actor}. Ready for the guarantee fee.`,
      actor,
      visibility: "business",
    });

    // The tenant's approval email points at the portal, not a tokenised /pay link:
    // a direct tenant has an account and pays from their own status screen. Sending
    // never blocks the approval, which has already happened; a failure is logged and
    // returned so staff can resend.
    const rent = Number(app.monthly_rent);
    const propertyAddr = [titleCaseAddress(app.prop_addr1), app.prop_postcode].filter(Boolean).join(", ");
    const origin = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
    let emailError: string | null = null;
    if (!maySendOpndoorEmail(app.livemode === true)) {
      // Sandbox: approved so the journey can be walked, but opndoor sends no mail
      // about a sandbox application.
      await service.from("activity_log").insert({ application_id: app.id, kind: "approval_email_skipped", message: "Sandbox application: approval email not sent.", actor: "System", visibility: "internal" });
    } else {
      const emailRes = await sendMessage({
        to: app.tenant_email,
        message: directApprovalEmail({
          propertyAddr,
          guaranteeRef: app.guarantee_ref,
          amount: `£${rent.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`,
          tenancyStartLabel: null,
          portalUrl: origin ? `${origin}/apply` : "",
        }),
      });
      emailError = emailRes.ok ? null : (emailRes.error ?? "unknown");
      await service.from("activity_log").insert({
        application_id: app.id,
        kind: emailRes.ok ? "approval_email_sent" : "approval_email_failed",
        message: emailRes.ok ? "Approval email sent to the tenant." : `Approval email failed: ${emailRes.error}`,
        actor: "System",
        visibility: emailRes.ok ? "business" : "internal",
      });
      if (emailRes.ok && emailRes.to && emailRes.to !== app.tenant_email) {
        await service.from("activity_log").insert({ application_id: app.id, kind: "approval_email_sent", message: `Redirected to ${emailRes.to} (test mode).`, actor: "System", visibility: "internal" });
      }
    }

    return json({ ok: true, emailError });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Unexpected error." }, 500);
  }
});
