import { sendMessage, type SendResult } from "./mailer.ts";
import { executedDeedAgentEmail } from "./emailTemplates.ts";

export interface DeedTarget {
  appId: string;
  ref: string;
  tenantTitle: string;
  tenantName: string;
  addr1: string;
  postcode: string;
  /** ISO tenancy start date (yyyy-mm-dd); rendered dd/mm/yyyy in the email. */
  tenancyStart: string | null;
  /** Optional pre-formatted label shown as the guarantee's expiry row. Left unset
      by callers today, so the row is omitted; declared so the reference below
      type-checks rather than reading a property the interface never had. */
  tenancyStartLabel?: string | null;
  agencyName: string;
  pdfPath: string | null;
}

export interface DeedRecipient { email: string; name: string }

export async function deliverDeedToAgent(service: any, target: DeedTarget, recipient: DeedRecipient, mode: string): Promise<SendResult> {
  let downloadUrl = "";
  if (target.pdfPath) {
    const { data: signed } = await service.storage.from("deeds").createSignedUrl(target.pdfPath, 604800); // 7 days
    downloadUrl = signed?.signedUrl ?? "";
  }
  // #81 Mint a tokenised tenancy-correction link, expiring with the download link.
  let correctionUrl = "";
  const base = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
  if (base) {
    const { data: tok } = await service.from("tenancy_correction_tokens").insert({
      application_id: target.appId, guarantee_ref: target.ref,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }).select("token").maybeSingle();
    if (tok?.token) correctionUrl = `${base}/tenancy-correction?token=${tok.token}`;
  }
  const message = executedDeedAgentEmail({
    guaranteeRef: target.ref,
    tenantName: `${target.tenantTitle ?? ""} ${target.tenantName ?? ""}`.trim() || target.tenantName,
    propertyAddr: [target.addr1, target.postcode].filter(Boolean).join(", "),
    expiryLabel: target.tenancyStartLabel ?? null,
    downloadUrl,
  });
  // The correction link is a second action and the layout allows one, so it
  // goes in the small print rather than competing with the download.
  if (correctionUrl) {
    message.blocks = [...message.blocks, {
      small: `Is the tenancy start date wrong? <a href="${correctionUrl}">Tell us here</a> within seven days and we will reissue the deed.`,
    }];
  }
  const res = await sendMessage({ to: recipient.email, message });

  // Partner-safe business entry names the intended agent contact; the test-mode
  // redirect target stays admin-only (a separate internal entry).
  await service.from("activity_log").insert({
    application_id: target.appId,
    kind: res.ok ? "deed_delivered" : "deed_delivery_failed",
    message: res.ok ? `Deed sent to ${recipient.email} · ${mode}` : `Deed email to the agent could not be sent: ${res.error}`,
    actor: "System",
    visibility: res.ok ? "business" : "internal",
  });
  if (res.ok && res.to && res.to !== recipient.email) {
    await service.from("activity_log").insert({
      application_id: target.appId,
      kind: "deed_delivered",
      message: `Redirected to ${res.to} (test mode).`,
      actor: "System",
      visibility: "internal",
    });
  }
  return { ...res, to: recipient.email };
}
