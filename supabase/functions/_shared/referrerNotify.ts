import { sendMessage } from "./mailer.ts";
import { referrerSubmittedEmail, referrerDecisionEmail, referrerPaidEmail } from "./emailTemplates.ts";

export type ReferrerEvent = "submitted" | "approved" | "declined" | "paid";

// Email the referrer (the agent who made the referral) at a lifecycle point:
// submitted for referencing, the decision either way, and the guarantee fee
// paid. (The executed-deed email to the agent already exists on its own path.)
// Self-contained: resolves the referrer's live email from the application, builds
// the short portal note that names the tenant and property and links to the
// application, and sends through the shared mailer (redirected to the review
// address in test mode). Never throws into the caller: the lifecycle transition
// has already committed, so a notification failure is logged, not propagated.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function notifyReferrer(service: any, appId: string, event: ReferrerEvent): Promise<void> {
  try {
    const { data: app } = await service.from("applications")
      .select("guarantee_ref, tenant_first_name, tenant_last_name, prop_addr1, prop_postcode, referrer:users!referrer_id(email)")
      .eq("id", appId).maybeSingle();
    if (!app) return;
    const email = (Array.isArray(app.referrer) ? app.referrer[0]?.email : app.referrer?.email) ?? null;
    if (!email) return;
    const tenantName = `${app.tenant_first_name ?? ""} ${app.tenant_last_name ?? ""}`.trim() || "your tenant";
    const propertyAddr = [app.prop_addr1, app.prop_postcode].filter(Boolean).join(", ");
    const appBase = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
    const portalUrl = appBase ? `${appBase}/applications/${encodeURIComponent(app.guarantee_ref)}` : "";
    const common = { guaranteeRef: app.guarantee_ref, tenantName, propertyAddr, portalUrl };
    const message = event === "submitted" ? referrerSubmittedEmail(common)
      : event === "paid" ? referrerPaidEmail(common)
      : referrerDecisionEmail({ ...common, approved: event === "approved" });
    const res = await sendMessage({ to: email, message });
    await service.from("activity_log").insert({
      application_id: appId,
      kind: res.ok ? "referrer_notified" : "referrer_notify_failed",
      message: res.ok ? `Referrer notified: ${event}.` : `Referrer notification (${event}) failed: ${res.error}`,
      actor: "System",
      visibility: "internal",
    });
  } catch (_e) {
    // Non-blocking: the lifecycle transition has already committed.
  }
}
