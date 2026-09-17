import { sendMessage, bytesToBase64, type SendResult, type Attachment } from "./mailer.ts";
import { executedDeedAgentEmail, executedDeedLandlordEmail } from "./emailTemplates.ts";
import { managedByFor } from "./managedBy.ts";

/** ISO tenancy start (yyyy-mm-dd) as a readable date for the email, e.g.
    "1 September 2026". Parsed from the parts so a timezone cannot shift the day. */
export function formatTenancyStart(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(d);
}

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
  // The signed deed rides as an ATTACHMENT now, not a download link. The PDF is
  // already in the deeds bucket: the completion webhook uploads it before calling
  // this, and the manual resend reads the stored executed PDF. Fetch and base64 it.
  const attachments: Attachment[] = [];
  if (target.pdfPath) {
    const { data: blob } = await service.storage.from("deeds").download(target.pdfPath);
    if (blob) {
      attachments.push({
        filename: `Deed of Guarantee ${target.ref}.pdf`,
        content: bytesToBase64(new Uint8Array(await blob.arrayBuffer())),
      });
    }
  }
  if (!attachments.length) {
    // The copy says the signed copy is attached, so a missing PDF is worth an
    // internal note. The send still goes: the notification and (for an agent) the
    // portal link carry value, and holding the email helps nobody.
    await service.from("activity_log").insert({
      application_id: target.appId, kind: "deed_attachment_missing",
      message: "Executed-deed email sent without the signed PDF: it could not be read from storage.",
      actor: "System", visibility: "internal",
    });
  }

  const appBase = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");

  // "You can also view it in the portal" is only for a recipient who has a login.
  // A private landlord has none, so the line is omitted for them; a letting agent
  // (and a referral-rail branch contact, whose delivery-contact kind is null here)
  // gets it.
  let portalUrl = "";
  if (appBase) {
    const kind = await managedByFor(service, target.appId);
    if (kind !== "private_landlord") portalUrl = `${appBase}/applications/${encodeURIComponent(target.ref)}`;
  }

  // #81 Mint a tokenised tenancy-correction link (7-day expiry). Submitting it now
  // applies the correction automatically (void + reissue), so the wording invites
  // a change rather than promising a review.
  let correctionUrl = "";
  if (appBase) {
    const { data: tok } = await service.from("tenancy_correction_tokens").insert({
      application_id: target.appId, guarantee_ref: target.ref,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }).select("token").maybeSingle();
    if (tok?.token) correctionUrl = `${appBase}/tenancy-correction?token=${tok.token}`;
  }

  const message = executedDeedAgentEmail({
    guaranteeRef: target.ref,
    tenantName: `${target.tenantTitle ?? ""} ${target.tenantName ?? ""}`.trim() || target.tenantName,
    propertyAddr: [target.addr1, target.postcode].filter(Boolean).join(", "),
    tenancyStartLabel: target.tenancyStartLabel ?? formatTenancyStart(target.tenancyStart),
    portalUrl,
  });
  // The correction link sits in the small print as its own line.
  if (correctionUrl) {
    message.blocks = [...message.blocks, {
      small: `Wrong tenancy start date? <a href="${correctionUrl}">Change it here</a>.`,
    }];
  }
  const res = await sendMessage({ to: recipient.email, message, attachments });

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

export interface LandlordRecipient { email: string; name: string; note?: string; actor?: string }

// Sibling of deliverDeedToAgent for agency staff sending to their landlord. The
// covering line the sender typed opens the email; no portal or correction link (a
// private landlord has no login). The activity entry names who sent it (actor)
// and to whom (message), so the feed reads as an audit line.
export async function deliverDeedToLandlord(service: any, target: DeedTarget, recipient: LandlordRecipient): Promise<SendResult> {
  const attachments: Attachment[] = [];
  if (target.pdfPath) {
    const { data: blob } = await service.storage.from("deeds").download(target.pdfPath);
    if (blob) {
      attachments.push({
        filename: `Deed of Guarantee ${target.ref}.pdf`,
        content: bytesToBase64(new Uint8Array(await blob.arrayBuffer())),
      });
    }
  }
  if (!attachments.length) {
    await service.from("activity_log").insert({
      application_id: target.appId, kind: "deed_attachment_missing",
      message: "Executed-deed email to the landlord sent without the signed PDF: it could not be read from storage.",
      actor: "System", visibility: "internal",
    });
  }

  const message = executedDeedLandlordEmail({
    guaranteeRef: target.ref,
    tenantName: `${target.tenantTitle ?? ""} ${target.tenantName ?? ""}`.trim() || target.tenantName,
    propertyAddr: [target.addr1, target.postcode].filter(Boolean).join(", "),
    tenancyStartLabel: target.tenancyStartLabel ?? formatTenancyStart(target.tenancyStart),
    note: recipient.note,
  });
  const res = await sendMessage({ to: recipient.email, message, attachments });

  const actor = recipient.actor && recipient.actor.trim() ? recipient.actor.trim() : "System";
  await service.from("activity_log").insert({
    application_id: target.appId,
    kind: res.ok ? "deed_delivered_landlord" : "deed_delivery_failed",
    message: res.ok ? `Deed of Guarantee sent to ${recipient.name} (${recipient.email})` : `Deed email to the landlord could not be sent: ${res.error}`,
    actor: res.ok ? actor : "System",
    visibility: res.ok ? "business" : "internal",
  });
  if (res.ok && res.to && res.to !== recipient.email) {
    await service.from("activity_log").insert({
      application_id: target.appId,
      kind: "deed_delivered_landlord",
      message: `Redirected to ${res.to} (test mode).`,
      actor: "System",
      visibility: "internal",
    });
  }
  return { ...res, to: recipient.email };
}
