import { sendMessage } from "./mailer.ts";
import { referrerSubmittedEmail, referrerDecisionEmail, referrerPaidEmail } from "./emailTemplates.ts";

export type ReferrerEvent = "submitted" | "approved" | "declined" | "paid";

/* The lifecycle event, as the matrix names it. One map, so a send path and a
   switch on a screen cannot mean different things by the same word. */
const NOTIFICATION_TYPE: Record<ReferrerEvent, string> = {
  submitted: "sent",
  approved: "approved",
  declined: "decline",
  paid: "paid",
};

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
      .select("guarantee_ref, livemode, tenant_first_name, tenant_last_name, prop_addr1, prop_postcode, tenancy_id")
      .eq("id", appId).maybeSingle();
    if (!app) return;
    /* A SANDBOX APPLICATION DOES NOT EMAIL A REAL AGENT. Round 5, M7. This had
       no livemode test at all, so a partner working through their sandbox put
       "your tenant has been approved" in the inbox of a real negotiator about
       a tenant who does not exist. Every other per-application sender already
       filters: fire_payment_reminders has `where a.livemode`, expiry-reminders
       has `.eq("livemode", true)`. The gate belongs here rather than at the
       four call sites (stripe-webhook, tenant-portal, approve-application,
       decline-application) so that adding a fifth cannot forget it.

       The activity_log line is written either way further down only when a
       send is attempted; a sandbox application simply has no notification,
       which is what sandbox means. */
    if (app.livemode !== true) return;
    /* WHO IS TOLD IS THE MATRIX'S ANSWER, NOT THIS FILE'S. Q-02 and Q-03.
       This read one column -- the referrer's own address -- so on the supplier
       rail the branch desk was never told, and a referral made by an API key
       with no live person behind it reached nobody at all. Both are in
       docs/NOTIFICATIONS.md as gaps 2 and 3.

       notification_recipients answers for every rail and applies that party's
       matrix, so the defaults decide the change rather than this code: on a
       supplier everything is on for the referrer and only deed_issued for the
       desk, so nothing new is sent until somebody turns it on. */
    const type = NOTIFICATION_TYPE[event];
    const { data: rows } = await service.rpc("notification_recipients", {
      p_application: appId, p_type: type,
    });
    const recipients = ((rows ?? []) as Array<{ email: string }>)
      .map((r) => (r.email ?? "").trim())
      .filter((e) => e.length > 0);
    if (!recipients.length) return;
    const tenantName = `${app.tenant_first_name ?? ""} ${app.tenant_last_name ?? ""}`.trim() || "your tenant";
    const propertyAddr = [app.prop_addr1, app.prop_postcode].filter(Boolean).join(", ");
    const appBase = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
    const portalUrl = appBase ? `${appBase}/applications/${encodeURIComponent(app.guarantee_ref)}` : "";
    const common = { guaranteeRef: app.guarantee_ref, tenantName, propertyAddr, portalUrl };
    /* WHERE THE TENANCY HAS GOT TO, on a "paid" notice. Read only for that
       event: the other three say nothing about the tenancy's progress, and
       a query per notification that nothing uses is a query per
       notification. `paid_at` is the test, not payment_state, because that
       is the column every other tally on this tenancy counts. */
    let joint: { paid: number; count: number } | null = null;
    if (event === "paid" && app.tenancy_id) {
      const { data: mates } = await service.from("applications")
        .select("id, paid_at").eq("tenancy_id", app.tenancy_id);
      if (mates && mates.length > 1) {
        joint = {
          paid: mates.filter((m: { id: string; paid_at: string | null }) =>
            m.id === appId || !!m.paid_at).length,
          count: mates.length,
        };
      }
    }
    const message = event === "submitted" ? referrerSubmittedEmail(common)
      : event === "paid" ? referrerPaidEmail({ ...common, joint })
      : referrerDecisionEmail({ ...common, approved: event === "approved" });
    // ONE SEND WITH EACH AS A RECIPIENT, the shape every other
    // per-application notification uses and the one the deed rule specified.
    const res = await sendMessage({ to: recipients, message });
    await service.from("activity_log").insert({
      application_id: appId,
      kind: res.ok ? "referrer_notified" : "referrer_notify_failed",
      message: res.ok
        ? `Notified (${event}): ${recipients.join(", ")}.`
        : `Notification (${event}) failed: ${res.error}`,
      actor: "System",
      visibility: "internal",
    });
  } catch (_e) {
    // Non-blocking: the lifecycle transition has already committed.
  }
}
