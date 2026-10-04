// OPNDOOR SENDS THE SIGNING EMAIL, NOT PANDADOC.
//
// Matt, 2026-10-04 (ai): "Stop PandaDoc emailing tenants: create and send
// deeds silently so PandaDoc sends no email of its own, and make Opndoor's
// 'Payment received' email the one with the 'Sign your Deed of Guarantee'
// button ... 'Resend signature request' on the application must send
// Opndoor's email with a fresh signing link ... Check the corrected-deed flow
// (start-date changes) also uses Opndoor's email."
//
// =============================================================================
// THE COMPLAINT WAS TWO EMAILS FROM TWO SENDERS ABOUT ONE DEED
// =============================================================================
//
// A tenant paid and got our receipt and PandaDoc's own signing email, in
// PandaDoc's voice and branding, within a minute of each other. The second one
// is the one with the button, so the tenant learns that the thing to act on
// comes from a company they have never heard of.
//
// THREE SENDERS HAD TO MOVE, and Matt names all three: the first send, Resend
// signature request, and the corrected deed after a start-date change. Missing
// one leaves PandaDoc emailing on that path only, which is the hardest kind of
// half-fix to notice -- everything looks right until somebody amends a date.
//
// THE LINK IS THE PAY PAGE, NOT A PANDADOC SESSION URL. `/pay?token=` is the
// door the tenant already has from their payment email, it survives in an
// inbox for 90 days, and PayLanding mints a fresh signing session on arrival
// through `payment-page` action 'sign'. A PandaDoc session link embedded in an
// email would be minted at SEND time and dead long before the tenant opened it.
//
// AND IT ALREADY HANDLES "ALREADY SIGNED", which is the case Matt asks the
// button to cover: `requestSigningLinkByToken` answers deedSigned and the page
// says so, rather than opening a signing session on a signed deed.

import { sendMessage } from "./mailer.ts";
import { deedToSignEmail } from "./emailTemplates.ts";
import { spelledDate } from "./text.ts";
import { maySendOpndoorEmail } from "./livemodeCredentials.ts";

export interface SigningInviteResult {
  ok: boolean;
  error?: string;
  /** False where there was no tenant address or no APP_URL: not a failure, and
      not something to alert on, but the caller must not report a send. */
  sent: boolean;
}

/**
 * Email the tenant their own door to the deed.
 *
 * `reissue` changes the words, not the link: a corrected deed replaces one the
 * tenant may already have signed, and an email that does not say so reads as a
 * duplicate and gets ignored. That is the start-date path, and it is the one
 * where a tenant ignoring the email leaves two deeds disagreeing about a date.
 */
export async function deliverSigningInvite(
  service: any,
  appId: string,
  opts: { reissue?: boolean; by?: string } = {},
): Promise<SigningInviteResult> {
  const { data: app } = await service
    .from("applications")
    .select("id, guarantee_ref, tenant_first_name, tenant_last_name, tenant_email, prop_addr1, prop_postcode, tenancy_start, deed_state, livemode")
    .eq("id", appId).maybeSingle();
  if (!app) return { ok: false, sent: false, error: "Application not found." };
  if (!app.tenant_email) return { ok: true, sent: false };

  /* SANDBOX SENDS NO OPNDOOR EMAIL, and this is an Opndoor email. The rule is
     `maySendOpndoorEmail` and it is absolute in terms: "Not a different from
     address, not a redirect to a review mailbox: none."

     THE REHEARSAL IS NOT LOST, which is why this is safe to refuse here:
     `createAndSend` passes `silent: livemode`, so a sandbox document still
     triggers PandaDoc's own signing email. Sandbox keeps exactly the journey
     it had; live is the half that changed. Those two lines have to agree, and
     everyDeedTellsItsTenant.test.ts is where that is checked. */
  if (!maySendOpndoorEmail(app.livemode === true)) return { ok: true, sent: false };

  /* NOTHING TO SIGN IS NOT A FAILURE. A deed already executed, or cancelled
     after a refund, must not be chased. Checked here rather than at each of
     the three call sites, because the one that forgets is the one that emails
     a tenant about a guarantee that has ended. */
  if (app.deed_state === "executed" || app.deed_state === "cancelled") {
    return { ok: true, sent: false };
  }

  const base = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
  if (!base) {
    /* NO LINK MEANS NO EMAIL. A signing invitation whose button goes nowhere
       is worse than silence: the tenant presses it, nothing happens, and they
       conclude the deed is dealt with. Recorded so the absence is findable. */
    await service.from("activity_log").insert({
      application_id: appId, kind: "deed_invite_failed",
      message: "No APP_URL is configured, so the tenant could not be sent a signing link.",
      actor: "System", visibility: "internal",
    });
    return { ok: false, sent: false, error: "APP_URL is not configured." };
  }

  const { data: token, error: tokenErr } = await service
    .rpc("mint_payment_page_token", { p_ref: app.guarantee_ref });
  if (tokenErr || !token) {
    await service.from("activity_log").insert({
      application_id: appId, kind: "deed_invite_failed",
      message: `Could not mint a signing link: ${tokenErr?.message ?? "no token returned"}`,
      actor: "System", visibility: "internal",
    });
    return { ok: false, sent: false, error: "Could not mint a signing link." };
  }

  const res = await sendMessage({
    to: app.tenant_email,
    message: deedToSignEmail({
      guaranteeRef: app.guarantee_ref,
      tenantName: `${app.tenant_first_name ?? ""} ${app.tenant_last_name ?? ""}`.trim(),
      propertyAddr: [app.prop_addr1, app.prop_postcode].filter(Boolean).join(", "),
      tenancyStartLabel: app.tenancy_start ? spelledDate(app.tenancy_start) : null,
      signUrl: `${base}/pay?token=${token}`,
      reissue: opts.reissue === true,
    }),
  });

  await service.from("activity_log").insert({
    application_id: appId,
    kind: res.ok ? "deed_invite_sent" : "deed_invite_failed",
    message: res.ok
      ? `${opts.reissue ? "Corrected deed" : "Deed"} sent to the tenant to sign${opts.by ? ` (by ${opts.by})` : ""}.`
      : `Signing email not sent: ${res.error}`,
    actor: "System",
    visibility: res.ok ? "business" : "internal",
  });
  if (res.ok && res.to && res.to !== app.tenant_email) {
    await service.from("activity_log").insert({
      application_id: appId, kind: "deed_invite_sent",
      message: `Redirected to ${res.to} (test mode).`, actor: "System", visibility: "internal",
    });
  }

  return { ok: res.ok, sent: res.ok, error: res.ok ? undefined : res.error };
}
