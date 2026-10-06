// =====================================================================
// withdraw-notice (verify_jwt = true)
//
// Tells the tenant their referral was withdrawn.
//
// Matt, 2026-10-03: "after withdrawal, does the tenant's payment link stop
// working, and is the tenant told? It should stop working, and the tenant
// should get a short email that the application was withdrawn by the agency."
//
// ANSWERED BEFORE BUILDING. The link already stops working: getPayPageState
// answers isClosed for a withdrawn application, the page says "This referral
// is closed" and the checkout action refuses. The tenant was not told at all.
// mark_withdrawn writes the row and the activity log and sends nothing, so a
// tenant who had been asked for money found out by opening a dead link.
//
// WHY A SEPARATE FUNCTION RATHER THAN SENDING FROM mark_withdrawn: that is a
// plpgsql RPC and cannot send email. Every other tenant email in the product
// is an edge function for the same reason, and this one is shaped on
// resend-payment-email deliberately: same auth, same caller-scoped read, same
// activity-log pair, so there is one way a staff action emails a tenant.
//
// IT DOES NOT WITHDRAW ANYTHING. The withdrawal is mark_withdrawn's, with its
// own permission rules and its own refusal for anything past Sent. This sends
// a message about a withdrawal that has already happened, and refuses if it
// has not -- so a caller cannot use it to tell a tenant their live referral is
// dead.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendMessage } from "../_shared/mailer.ts";
import { withdrawnNoticeEmail } from "../_shared/emailTemplates.ts";
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

    // RLS decides who may read it, which is the same set that may withdraw it:
    // the owning referrer, management in-partner, opndoor admin.
    const { data: app, error } = await userClient
      .from("applications")
      .select("id, guarantee_ref, status, tenant_email, prop_addr1, prop_postcode, livemode, agency:agencies(name)")
      .eq("guarantee_ref", ref)
      .maybeSingle();
    if (error || !app) return json({ ok: false, error: "Application not found." }, 404);

    // IT HAS TO HAVE BEEN WITHDRAWN. See the header: this says a thing is so,
    // and must not be usable to tell a tenant something that is not.
    if (app.status !== "withdrawn") {
      return json({ ok: false, error: "That application has not been withdrawn." }, 409);
    }
    if (!app.tenant_email) return json({ ok: false, error: "No tenant email on this application." }, 200);

    /* SANDBOX SENDS NOTHING, which `sandboxDoesNotEmailRealPeople` caught me
       leaving out: this function reached the mailer with no livemode gate at
       all. The guard is right and the omission was real -- a sandbox
       withdrawal would have emailed a real address, which is the one thing
       sandbox exists not to do.

       REFUSED RATHER THAN SILENTLY DROPPED, which is resend-payment-email's
       choice and its reasoning: a developer who gets here should be told why
       nothing was sent. The withdrawal itself has already happened and
       stands. */
    if (!maySendOpndoorEmail(app.livemode === true)) {
      return json({ ok: false, error: "This is a sandbox application. Opndoor does not send email for sandbox." }, 400);
    }

    // The same unwrap resend-payment-email does, and for its reason: the embed
    // comes back as a row or a one-row array depending on the shape, and
    // guessing would lose the agency's name silently.
    const embedded = (v: unknown) => (Array.isArray(v) ? v[0] ?? null : v ?? null);
    const agencyRow = embedded(app.agency) as { name?: string | null } | null;
    const propertyAddr = [titleCaseAddress(app.prop_addr1), app.prop_postcode].filter(Boolean).join(", ");

    const emailRes = await sendMessage({
      to: app.tenant_email,
      message: withdrawnNoticeEmail({
        propertyAddr,
        guaranteeRef: app.guarantee_ref,
        agencyName: (agencyRow?.name ?? "").trim() || null,
      }),
    });

    const service = createClient(SUPABASE_URL, SERVICE);
    await service.from("activity_log").insert({
      application_id: app.id,
      kind: emailRes.ok ? "withdrawn_notice_sent" : "withdrawn_notice_failed",
      message: emailRes.ok
        ? "Tenant emailed to say the referral was withdrawn."
        : `Could not email the tenant about the withdrawal: ${emailRes.error}`,
      actor,
      // A failure carries the raw provider error, so it stays opndoor-only.
      visibility: emailRes.ok ? "business" : "internal",
    });
    if (emailRes.ok && emailRes.to) {
      await service.from("activity_log").insert({
        application_id: app.id,
        kind: "withdrawn_notice_sent",
        message: `Redirected to ${emailRes.to} (test mode).`,
        actor,
        visibility: "internal",
      });
    }

    if (!emailRes.ok) return json({ ok: false, error: emailRes.error }, 200);
    return json({ ok: true, to: emailRes.to });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Unexpected error." }, 500);
  }
});
