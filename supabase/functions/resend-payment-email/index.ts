// =====================================================================
// resend-payment-email (verify_jwt = true)
//
// Resends the branded payment email for an existing Sent application, reusing
// its existing Checkout link. Allowed for anyone who can see the application
// (owning Referrer, Management in-partner, opndoor admin) - enforced by RLS on
// the caller-scoped read. Redirected to the review address in test mode. Each
// resend is written to the activity log.
//
// email.ts is the same shared module used by create-referral.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendMessage } from "../_shared/mailer.ts";
import { feeBasisWeeksOf, paymentLinkEmail, type FeeCopy } from "../_shared/emailTemplates.ts";
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

    // RLS ensures only the owning Referrer / Management in-partner / admin can read it.
    const { data: app, error } = await userClient
      .from("applications")
      // referencing_mode, agency_id and the two embeds are here for the OPENING
      // LINE, not for anything this function decides: see the copy block below.
      // Both embedded rows are ones this caller already reads all over the portal
      // (the applications list renders the agency name off the same policy), and
      // a null from either degrades to the approved wording rather than failing.
      .select("id, guarantee_ref, tenant_title, tenant_first_name, tenant_last_name, tenant_email, prop_addr1, prop_postcode, monthly_rent, fee_amount, share_amount, status, livemode, referencing_mode, agency_id, agency:agencies(name), partner:partners(refers_own_stock)")
      .eq("guarantee_ref", ref).maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 400);
    if (!app) return json({ ok: false, error: "Application not found, or you do not have access to it." }, 404);
    if (app.status !== "sent") return json({ ok: false, error: "This application has already been paid; there is nothing to resend." }, 400);
    // Belt and braces. The restrictive policy already means no portal user can
    // load a sandbox application to press this button, but this function runs as
    // service_role and resolves the row itself, so the policy is not what protects
    // it. Refuse rather than silently no-op: a developer who somehow gets here
    // should be told why nothing was sent.
    if (!maySendOpndoorEmail(app.livemode === true)) {
      return json({ ok: false, error: "This is a sandbox application. Opndoor does not send email for sandbox." }, 400);
    }
    /* THERE WAS A GATE HERE ON app.payment_url EXISTING, and it refused exactly the
       case this button exists for.

       payment_url is the URL of the EAGER Stripe session create-referral opens
       when the referral is made. That session can fail: create-referral handles
       "Could not mint a payment link", records the send as failed and creates the
       referral anyway, precisely so an admin can resend. Such a row is status
       'sent' with payment_url null, and this function answered "No payment link
       exists for this application yet" and refused, which is both wrong (one can
       be minted, and is, twelve lines below) and the opposite of the remedy.

       Nothing here needs payment_url: a resend never sends a Stripe URL. The only
       question is whether the application is still payable, and the status check
       above is what answers it. The link is minted fresh below and the mint's own
       failure is what returns an error. */

    // WAS: the email quoted monthly_rent in a row labelled "Guarantee fee".
    //
    // That read correctly only while the fee WAS one month's rent. fee_amount is
    // what this application was actually charged (a negotiated three or five week
    // basis, and for a joint tenant their share of the tenancy fee), so quoting
    // the rent sent the tenant to a Checkout that asks for a different number
    // from the one in the email. Fall back to the rent only for a row created
    // before fee_amount existed, where the two are provably equal.
    const fee = Number(app.fee_amount ?? app.monthly_rent);
    // The basis is worked out against the rent this fee was a proportion of:
    // their share of it if they are one of a joint tenancy, the whole rent if not.
    const feeBasisWeeks = feeBasisWeeksOf(fee, app.share_amount ?? app.monthly_rent);

    // WHICH WORDS THIS TENANT GETS, and it is the route plus the referencing mode
    // that decide, never who the agency is. An agency that referenced its own
    // tenant made the decision this email announces, so it is the subject of the
    // opening line and is named as the tenant knows it: agencies.name, never the
    // group above it. Where opndoor referenced, and on the supplier rail, opndoor
    // decided, the approved wording already says so, and passing copy changes not
    // one character of it.
    //
    // The mode read here is the APPLICATION's own snapshot. Regent is
    // pre_referenced_open under a partner that is opndoor_referenced, so asking
    // the partner would tell a Regent tenant opndoor took a view on them when it
    // never saw them.
    //
    // refers_own_stock is the estate: true means one of our own agencies typed
    // this referral in. agency_id is NOT NULL on this table, the direct rail
    // included (it carries the house "Unattached" agency under opndoor-direct,
    // whose refers_own_stock is false), so a direct application resolves here as
    // "supplier". That is copy-identical: a direct application's mode is always
    // opndoor_referenced, and every rail's opndoor-referenced arm is the approved
    // wording. The direct arm is kept because the ruling is written in terms of
    // whether an agency is attached at all.
    //
    // An embedded to-one comes back as an object or as a one-element array
    // depending on how PostgREST resolves the relationship, and payment-page
    // unwraps both for these same two embeds. Guessing the shape here would lose
    // the agency's name silently, which is exactly the failure that reads as
    // approved copy and is not.
    const embedded = (v: unknown) => (Array.isArray(v) ? v[0] ?? null : v ?? null);
    const partnerRow = embedded(app.partner) as { refers_own_stock?: boolean | null } | null;
    const agencyRow = embedded(app.agency) as { name?: string | null } | null;
    const copy: FeeCopy = {
      rail: !app.agency_id ? "direct" : partnerRow?.refers_own_stock === true ? "agency" : "supplier",
      referencingMode: app.referencing_mode,
      // Null when RLS did not hand this caller the agency row, in which case the
      // template uses the approved wording rather than printing a sentence with a
      // hole where the name goes.
      agencyName: (agencyRow?.name ?? "").trim() || null,
    };
    // #8 Title-case the address line for display in the email; postcode left raw.
    const propertyAddr = [titleCaseAddress(app.prop_addr1), app.prop_postcode].filter(Boolean).join(", ");
    const service = createClient(SUPABASE_URL, SERVICE);

    // #1 Point the resend at the opndoor confirmation page (/pay?token=...), not the
    // raw Stripe link; the page mints a fresh checkout session on demand.
    const origin = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
    const { data: pageToken } = await service.rpc("mint_payment_page_token", { p_ref: app.guarantee_ref });
    // Never resend a stale Stripe URL: a fresh durable link is required, or the
    // resend fails and the admin retries rather than the tenant getting a dead link.
    if (!pageToken || !origin) return json({ ok: false, error: "Could not create a fresh payment link. Please try again." }, 502);
    const payUrl = `${origin}/pay?token=${pageToken}&utm_source=resend`;

    const emailRes = await sendMessage({
      to: app.tenant_email,
      message: paymentLinkEmail({
        propertyAddr, guaranteeRef: app.guarantee_ref,
        amount: `£${fee.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`,
        payUrl, feeBasisWeeks, copy,
      }),
    });
    // Partner-safe business message; test-mode redirect target stays admin-only.
    await service.from("activity_log").insert({
      application_id: app.id,
      kind: emailRes.ok ? "payment_email_resent" : "payment_email_failed",
      message: emailRes.ok ? `Payment email resent to the tenant by ${actor}.` : `Payment email resend failed: ${emailRes.error}`,
      actor,
      // A failure carries the raw provider error, so keep it opndoor-admin-only
      // (the partner-safe copy is shown on the payment card). Success is business.
      visibility: emailRes.ok ? "business" : "internal",
    });
    if (emailRes.ok && emailRes.to) {
      await service.from("activity_log").insert({
        application_id: app.id,
        kind: "payment_email_resent",
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
