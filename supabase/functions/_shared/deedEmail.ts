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

/* ONE SEND, EVERY RECIPIENT. `email` stays for the primary, because the
   activity line and the "sent to" on screen name one person, and `also` is
   everybody else the ladder resolved. On the agency rail that is the referrer
   plus every ticked user whose position covers the referral; on the other two
   rails it is empty, because those rails have one contact. */
export interface DeedRecipient { email: string; name: string; also?: string[] }

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
    /* ONE LIVE CORRECTION LINK PER APPLICATION. Round 6, M4.
       This minted a NEW seven-day token on EVERY call, and it is called by the
       completion webhook, by every manual "Send deed to agent", and by every
       reissue. Round 5 closed the same-token replay; it did not close this
       one, because the claim was scoped to the token presented and the other
       outstanding links stayed live. Submitting the first archived the signed
       PDF, reset the status, nulled the executed PDF and reissued; submitting
       the second did it all again.

       So an unexpired, unsubmitted token for this application is REUSED. The
       link in the second email is the same link as in the first, which is
       also what the recipient would expect. */
    const { data: live } = await service.from("tenancy_correction_tokens")
      .select("token")
      .eq("application_id", target.appId)
      .is("submitted_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    let tokenValue = live?.token as string | undefined;
    if (!tokenValue) {
      const { data: tok } = await service.from("tenancy_correction_tokens").insert({
        application_id: target.appId, guarantee_ref: target.ref,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }).select("token").maybeSingle();
      tokenValue = tok?.token as string | undefined;
    }
    if (tokenValue) correctionUrl = `${appBase}/tenancy-correction?token=${tokenValue}`;
  }

  /* THE TENANCY THIS DEED IS PART OF, so the email can say that another is
     coming. Read here rather than threaded through DeedTarget because both
     callers (the completion webhook and the manual send) would otherwise have to
     fetch and pass it, and one of them would eventually not. */
  /* HOW MANY HAVE SIGNED, NOT WHICH ONE THIS IS.

     Matt, 2026-10-01, on GR-23853/GR-23854: "Joint Two signed first, and the
     agent's signed-deed email said 'deed 2 of 2' and 'This is the last of
     this tenancy's deeds: every tenant has now signed their own', while
     Joint One has not paid or signed."

     This read `tenancy_position`, which is the order the agent typed the
     tenants in. The second tenant's deed was "2 of 2" whoever had signed,
     and the closing sentence followed the same number, so an agent was told
     a tenancy was fully guaranteed when half of it was. An ordinal read as
     a count.

     `deed_state = 'executed'` is the count, and this row is counted whether
     or not its own state has been written yet: the completion webhook sends
     this email in the same breath as recording the signature, and the order
     of those two is not something the sentence should depend on. */
  let joint: { signed: number; count: number; coTenants: string } | null = null;
  const { data: me } = await service.from("applications")
    .select("tenancy_id, tenancy_position").eq("id", target.appId).maybeSingle();
  if (me?.tenancy_id && me?.tenancy_position) {
    const { data: mates } = await service.from("applications")
      .select("id, tenancy_position, tenant_first_name, tenant_last_name, deed_state")
      .eq("tenancy_id", me.tenancy_id)
      .order("tenancy_position");
    if (mates && mates.length > 1) {
      const signed = mates.filter((m: { id: string; deed_state: string | null }) =>
        m.id === target.appId || m.deed_state === "executed").length;
      joint = {
        signed,
        count: mates.length,
        coTenants: mates
          .filter((m: { tenancy_position: number }) => Number(m.tenancy_position) !== Number(me.tenancy_position))
          .map((m: { tenant_first_name: string; tenant_last_name: string }) =>
            `${m.tenant_first_name ?? ""} ${m.tenant_last_name ?? ""}`.trim())
          .filter(Boolean)
          .join(", "),
      };
    }
  }

  const correctedFrom = await correctedFromLabel(service, target.appId);
  const message = executedDeedAgentEmail({
    correctedFrom,
    guaranteeRef: target.ref,
    tenantName: `${target.tenantTitle ?? ""} ${target.tenantName ?? ""}`.trim() || target.tenantName,
    propertyAddr: [target.addr1, target.postcode].filter(Boolean).join(", "),
    tenancyStartLabel: target.tenancyStartLabel ?? formatTenancyStart(target.tenancyStart),
    portalUrl,
    joint,
  });
  // The correction link sits in the small print as its own line.
  if (correctionUrl) {
    message.blocks = [...message.blocks, {
      small: `Wrong tenancy start date? <a href="${correctionUrl}">Change it here</a>.`,
    }];
  }
  // One message with each of them as a recipient, not one message each: the
  // deed is a single event, and the people on it should see who else has it.
  const everyone = [recipient.email, ...(recipient.also ?? [])]
    .map((e) => (e ?? '').trim())
    .filter((e, i, xs) => e.length > 0 && xs.indexOf(e) === i);
  const res = await sendMessage({ to: everyone, message, attachments });

  // Partner-safe business entry names the intended agent contact; the test-mode
  // redirect target stays admin-only (a separate internal entry).
  await service.from("activity_log").insert({
    application_id: target.appId,
    kind: res.ok ? "deed_delivered" : "deed_delivery_failed",
    message: res.ok ? `Deed sent to ${everyone.join(", ")} · ${mode}` : `Deed email to the agent could not be sent: ${res.error}`,
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

/**
 * The date an earlier copy of this deed was sent, when this one replaces it.
 *
 * Matt, 2026-10-01: "Signed deed email after a tenancy start correction:
 * say so at the top ... This corrected deed replaces the one sent on 1 Oct
 * 2026." Null on a first delivery and on a plain resend, which are not
 * corrections and must not say they are.
 *
 * WHICH IS NEWER IS THE WHOLE TEST, the same one the delivery guard uses:
 * a tenancy-start correction voids the document and issues a new one, so
 * its issue stamp lands after the previous delivery's. A resend of the
 * same deed has them the other way round.
 */
export async function correctedFromLabel(service: any, appId: string): Promise<string | null> {
  const { data } = await service.from("applications")
    .select("deed_delivered_at, deed_issued_at").eq("id", appId).maybeSingle();
  const sent = data?.deed_delivered_at ? new Date(data.deed_delivered_at) : null;
  const issued = data?.deed_issued_at ? new Date(data.deed_issued_at) : null;
  if (!sent || !issued || issued <= sent) return null;
  const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", day: "numeric", month: "numeric", year: "numeric",
  }).formatToParts(sent);
  const day = d.find((p) => p.type === "day")?.value ?? "";
  const mon = Number(d.find((p) => p.type === "month")?.value ?? "0");
  const year = d.find((p) => p.type === "year")?.value ?? "";
  return `${day} ${MONTH[mon - 1] ?? mon} ${year}`;
}

export interface LandlordRecipient { email: string; name: string; note?: string; actor?: string }

// Sibling of deliverDeedToAgent for agency staff sending to their landlord. The
// covering line the sender typed opens the email; no portal or correction link (a
// private landlord has no login). The activity entry names who sent it (actor)
// and to whom (message), so the feed reads as an audit line.
export async function deliverDeedToLandlord(service: any, target: DeedTarget, recipient: LandlordRecipient): Promise<SendResult> {
  /* ONE EMAIL, EVERY SIGNED DEED ON THE TENANCY.

     Matt, 2026-10-01: '"Send deed to landlord" on a joint tenancy: send
     all the tenancy's signed deeds in one email, listing each tenant, and
     say if any are still unsigned ("Joint Two has not signed yet; we'll
     send theirs when they do" only if you can, otherwise just list what's
     attached).'

     A landlord does not hold a tenancy in two halves. Sending one deed
     and calling it "the signed Deed of Guarantee" tells them the tenancy
     is covered when half of it is -- the same fault as the agent's "deed
     2 of 2", from the other end.

     Everything executed on this tenancy is attached, named by tenant, and
     anybody still out is named too. A tenancy of one takes the single
     path unchanged: one row, one attachment, no list. */
  const { data: me } = await service.from("applications")
    .select("tenancy_id").eq("id", target.appId).maybeSingle();

  type Mate = {
    id: string; guarantee_ref: string; tenant_first_name: string; tenant_last_name: string;
    deed_state: string | null; executed_pdf_path: string | null; tenancy_position: number;
  };
  let mates: Mate[] = [];
  if (me?.tenancy_id) {
    const { data } = await service.from("applications")
      .select("id, guarantee_ref, tenant_first_name, tenant_last_name, deed_state, executed_pdf_path, tenancy_position")
      .eq("tenancy_id", me.tenancy_id)
      .order("tenancy_position");
    mates = (data ?? []) as Mate[];
  }
  const nameOf = (m: Mate) => `${m.tenant_first_name ?? ""} ${m.tenant_last_name ?? ""}`.trim();
  /* THIS ROW COUNTS AS SIGNED whatever its stored state says, for the
     reason the agent's count does: the send can run in the same breath as
     the signature being recorded. */
  const signed = mates.filter((m) => m.id === target.appId || m.deed_state === "executed");
  const unsigned = mates.filter((m) => !(m.id === target.appId || m.deed_state === "executed"));

  const attachments: Attachment[] = [];
  const pull = async (path: string | null, ref: string, who: string) => {
    if (!path) return;
    const { data: blob } = await service.storage.from("deeds").download(path);
    if (!blob) return;
    attachments.push({
      filename: mates.length > 1
        ? `Deed of Guarantee ${ref} - ${who || "tenant"}.pdf`
        : `Deed of Guarantee ${ref}.pdf`,
      content: bytesToBase64(new Uint8Array(await blob.arrayBuffer())),
    });
  };
  if (signed.length > 1) {
    for (const m of signed) {
      await pull(m.id === target.appId ? (target.pdfPath ?? m.executed_pdf_path) : m.executed_pdf_path,
        m.guarantee_ref, nameOf(m));
    }
  } else {
    await pull(target.pdfPath, target.ref, nameOf(signed[0] ?? ({} as Mate)));
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
    joint: mates.length > 1
      ? { signedNames: signed.map(nameOf).filter(Boolean), unsignedNames: unsigned.map(nameOf).filter(Boolean) }
      : null,
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
