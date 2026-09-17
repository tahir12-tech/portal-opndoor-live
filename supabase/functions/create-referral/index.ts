// =====================================================================
// create-referral (verify_jwt = true)
//
// The "send" is the whole flow: create the application (Sent) via the
// validated create_referral RPC (as the caller, so RLS + field validation
// apply), open a Stripe Checkout Session for the guarantor fee, store the
// payment refs, and email the tenant the branded payment email. Graceful
// degradation: if Resend is not configured the application and checkout still
// succeed and the response reports emailSent = false with a reason.
//
// Stripe key mode must match the project: sk_test_ on a non-production project,
// sk_live_ everywhere else. See _shared/stripeMode.ts.
// =====================================================================
import Stripe from "npm:stripe@^17";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendMessage } from "../_shared/mailer.ts";
import { paymentLinkEmail, tenantInviteEmail } from "../_shared/emailTemplates.ts";
import { titleCaseAddress } from "../_shared/text.ts";
import { stripeSecretFor } from "../_shared/livemodeCredentials.ts";

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
    // The portal only ever creates live applications (create_referral hardcodes
    // livemode true), so this asks for the live key explicitly rather than
    // reading the project. On a dev project that still resolves to sk_test_,
    // because stripeSecretFor composes the project rule for live applications.
    const stripeSecret = stripeSecretFor(true);
    if (!stripeSecret.ok) {
      return json({ ok: false, error: stripeSecret.error }, 400);
    }
    const STRIPE_SECRET = stripeSecret.value;
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ ok: false, error: "Not authenticated." }, 401);

    const b = await req.json();
    const origin = String(b.origin ?? Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");

    // Caller-scoped client: RLS + create_referral field validation + AAL2 all apply.
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });

    const { data: userData } = await userClient.auth.getUser();
    const actorId = userData.user?.id;
    let actor = "A user";
    if (actorId) {
      const { data: prof } = await userClient.from("users").select("full_name").eq("id", actorId).maybeSingle();
      if (prof?.full_name) actor = prof.full_name;
    }

    // Resolve the partner (by slug) the picker chose, so a same-named agency
    // under two partners resolves to the intended one (#66) rather than an
    // arbitrary name match. Partner users are RLS-scoped to their own partner
    // anyway; the extra filter is harmless for them.
    let partnerId: string | null = null;
    if (b.partner) {
      const { data: p } = await userClient.from("partners").select("id").eq("slug", b.partner).maybeSingle();
      partnerId = p?.id ?? null;
    }
    let branchQuery = userClient
      .from("branches").select("id, partner_id, agencies!inner(name)").eq("name", b.branch).eq("agencies.name", b.agency);
    if (partnerId) branchQuery = branchQuery.eq("partner_id", partnerId);
    const { data: branch, error: brErr } = await branchQuery.limit(1).maybeSingle();
    if (brErr) return json({ ok: false, error: brErr.message }, 400);

    // Resolve the target branch; if it does not exist yet, create the agency/branch
    // on the fly and capture the agency-default contact. A partner user's records
    // land pending_review under their own partner; an opndoor admin's land
    // confirmed (the admin creation IS the review) under p_partner_slug - the
    // admin's selected partner scope. The RPC is idempotent (case-insensitive).
    let branchId = branch?.id as string | undefined;
    if (!branchId) {
      const { data: targetId, error: tErr } = await userClient.rpc("create_referral_target", {
        p_agency: b.agency,
        p_branch: b.branch,
        p_agency_email: b.agencyContactEmail ?? null,
        p_agency_contact_name: b.agencyContactName ?? null,
        p_agency_phone: b.agencyContactPhone ?? null,
        p_branch_email: b.branchContactEmail ?? null,
        p_partner_slug: b.partner ?? null,
      });
      if (tErr) return json({ ok: false, error: tErr.message }, 400);
      branchId = targetId as string;
    }

    const { data: appRes, error: rpcErr } = await userClient.rpc("create_referral", {
      p_branch: branchId, p_tenant_title: b.title, p_first: b.firstName, p_last: b.lastName, p_dob: b.dob,
      p_email: b.email, p_phone: b.phone, p_addr1: b.addr1, p_addr2: b.addr2 ?? null, p_city: b.city,
      p_county: b.county ?? null, p_postcode: b.postcode, p_rent: b.rent, p_tenancy_start: b.tenancyStart,
    });
    if (rpcErr) return json({ ok: false, error: rpcErr.message }, 400);
    const app = Array.isArray(appRes) ? appRes[0] : appRes;

    // Fields the create RPC does not take as arguments, written straight after
    // the insert. They are optional and additive: the RPC's signature is shared
    // with the API path and widening it would be a drop-and-recreate on the one
    // function the referral path calls on every referral.
    {
      const extra: Record<string, unknown> = {};
      if (typeof b.middleName === "string" && b.middleName.trim()) extra.tenant_middle_name = b.middleName.trim();
      if (b.sharePercent !== null && b.sharePercent !== undefined) extra.share_percent = Number(b.sharePercent);
      if (b.shareAmount !== null && b.shareAmount !== undefined) extra.share_amount = Number(b.shareAmount);
      if (Object.keys(extra).length) {
        const svc = createClient(SUPABASE_URL, SERVICE);
        await svc.from("applications").update(extra).eq("id", app.id);
      }
    }

    const appId = app.id as string;
    const ref = app.guarantee_ref as string;
    const rent = Number(app.monthly_rent);
    const tenantEmail = app.tenant_email as string;
    const tenantTitle = (app.tenant_title as string) ?? "";
    const tenantLast = app.tenant_last_name as string;
    // #8 Title-case the address line for display in the email; postcode left raw.
    const propertyAddr = [titleCaseAddress(app.prop_addr1), app.prop_postcode].filter(Boolean).join(", ");
    const amountGBP = `£${rent.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

    // ---- THE FORK, and it happens before Stripe is touched ---------------
    //
    // On a rail where OPNDOOR arranges the reference, there is nothing to pay
    // for yet: the tenant has a form to fill first, and a payment link is
    // simply the wrong link. They get an invite into the application journey
    // instead, and no Checkout session is created at all.
    //
    // GATED ON referencing_mode, which is snapshotted onto the row at creation.
    // The referral path is pre_referenced_open and does not enter this branch,
    // so its Stripe session, its payment email, its reminders and its 15-day
    // lapse are all untouched. That is the whole reason the fork is on mode
    // rather than on anything about who created the application.
    if (app.referencing_mode === "opndoor_referenced") {
      const service = createClient(SUPABASE_URL, SERVICE);

      // draft, NOT sent. 'sent' means a payment link is out, and it is what
      // expire_stale_applications selects on: leaving it there would lapse the
      // application on day 15 while the tenant was still filling the form.
      await service.from("applications").update({ status: "draft" }).eq("id", appId);

      const { data: inviteToken, error: invErr } = await service.rpc("mint_tenant_invite", {
        p_application: appId, p_days: 30,
      });
      if (invErr || !inviteToken) {
        console.log(JSON.stringify({ event: "invite_mint_failed", appId, message: invErr?.message }));
        return json({ ok: false, error: "Could not create the tenant's link." }, 500);
      }

      const inviteUrl = `${origin}/apply/invite?token=${inviteToken}`;
      const inviteRes = await sendMessage({
        to: tenantEmail,
        message: tenantInviteEmail({
          // The agency the referral was filed against, not "your letting
          // agent": the referrer may be a supplier.
          referrerName: (branch as { agencies?: { name?: string } } | null)?.agencies?.name ?? b.agency ?? null,
          propertyAddr, monthlyRent: b.rent ?? null, guaranteeRef: ref, inviteUrl,
        }),
      });

      await service.from("activity_log").insert({ application_id: appId, kind: "referral_created", message: "Referral created. The tenant has been invited to complete their application.", actor });
      await service.from("activity_log").insert({
        application_id: appId,
        kind: inviteRes.ok ? "tenant_invited" : "tenant_invite_failed",
        message: inviteRes.ok ? "Application link sent to the tenant." : `Application link not sent: ${inviteRes.error}`,
        actor: "System",
        visibility: inviteRes.ok ? "business" : "internal",
      });

      // emailSent/emailError, the same fields the Stripe branch returns and the
      // client reads: the toast reported "Tenant email not sent" on every invite
      // because this branch used `invited`/`email_error` instead. NOT a hardcoded
      // true: the application and invite token both exist by now, so refusing the
      // request would strand them; what must not happen is claiming the tenant was
      // contacted when nothing was sent. The caller gets the truth and the reason.
      return json({
        ok: true, id: appId, ref,
        emailSent: inviteRes.ok,
        emailError: inviteRes.ok ? null : (inviteRes.error ?? "The invitation was not sent."),
      });
    }

    // Stripe test-mode Checkout Session for the guarantor fee (one month's rent).
    // @ts-expect-error pinned apiVersion, older than the SDK types' latest literal
    const stripe = new Stripe(STRIPE_SECRET, { httpClient: Stripe.createFetchHttpClient(), apiVersion: "2024-06-20" });
    const session = await stripe.checkout.sessions.create({
      // Bounds the window in DEFECTS.md 8. Without it a session stays payable
      // for Stripe's 24 hour default, so an application withdrawn after the
      // tenant opened checkout can still be paid from the open tab. 30 minutes
      // is long enough for a tenant to find their card and short enough that a
      // same-day withdrawal is not racing a live session.
      //
      // Stripe requires between 30 minutes and 24 hours, so this is the floor.
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "gbp",
          unit_amount: Math.round(rent * 100),
          product_data: { name: `Guarantor fee - ${ref}`, description: "One month's rent, for the opndoor Deed of Guarantee." },
        },
        quantity: 1,
      }],
      metadata: { application_id: appId, guarantee_ref: ref },
      client_reference_id: appId,
      // Public, unauthenticated tenant pages (the tenant is not a portal user).
      // {CHECKOUT_SESSION_ID} is substituted by Stripe and keys the confirmation.
      success_url: `${origin}/pay/confirmed?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pay/retry?session_id={CHECKOUT_SESSION_ID}`,
    });

    const service = createClient(SUPABASE_URL, SERVICE);
    await service.from("applications").update({
      stripe_checkout_session_id: session.id, payment_url: session.url, payment_state: "awaiting",
    }).eq("id", appId);
    await service.from("activity_log").insert({ application_id: appId, kind: "referral_created", message: "Referral created and sent to the tenant.", actor });

    // #1 The payment email now points at the opndoor-hosted confirmation page
    // (/pay?token=...), not the raw Stripe URL. The page's Pay button mints a fresh
    // checkout session. utm_source tags the touch (initial send).
    const { data: pageToken } = await service.rpc("mint_payment_page_token", { p_ref: ref });

    // Never email a stale Stripe URL. Without a durable /pay?token link the send
    // is recorded as failed rather than carrying the 30-minute eager session URL;
    // the referral exists and an admin can resend, which mints a fresh link.
    const emailRes = pageToken
      ? await sendMessage({
          to: tenantEmail,
          message: paymentLinkEmail({ propertyAddr, guaranteeRef: ref, amount: amountGBP, payUrl: `${origin}/pay?token=${pageToken}&utm_source=initial` }),
        })
      : { ok: false as const, error: "Could not mint a payment link." };
    // Partner-safe business message; the test-mode redirect target stays admin-only
    // (a separate internal entry), so no partner-facing surface exposes the review
    // address regardless of how it renders the log.
    await service.from("activity_log").insert({
      application_id: appId,
      kind: emailRes.ok ? "payment_email_sent" : "payment_email_failed",
      message: emailRes.ok ? "Payment email sent to the tenant." : `Payment email not sent: ${emailRes.error}`,
      actor: "System",
      visibility: emailRes.ok ? "business" : "internal",
    });
    // GATED ON THE REDIRECT ACTUALLY HAVING HAPPENED. This row used to be written
    // whenever the send succeeded, saying "Redirected to <address> (test mode)".
    // Once the redirect was removed, emailRes.to was the REAL TENANT, so every
    // application carried an audit entry asserting a safety property that was not
    // in force and naming the person who actually received the mail as the
    // redirect target. See DEFECTS.md 7.
    //
    // refundEmail.ts already had this guard, which is why the same row was
    // harmless there. Now they match.
    if (emailRes.ok && emailRes.redirected && emailRes.to) {
      await service.from("activity_log").insert({
        application_id: appId,
        kind: "payment_email_sent",
        message: `Redirected to ${emailRes.to} (EMAIL_REVIEW_ADDRESS is set on this environment). Intended recipient: ${emailRes.intended ?? "unknown"}.`,
        actor: "System",
        visibility: "internal",
      });
    }

    return json({ ok: true, ref, paymentUrl: session.url, emailSent: emailRes.ok, emailError: emailRes.ok ? null : emailRes.error });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Unexpected error creating the referral." }, 500);
  }
});
