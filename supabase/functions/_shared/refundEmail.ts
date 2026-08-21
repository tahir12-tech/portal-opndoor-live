import { sendMessage } from "./mailer.ts";
import { refundEmail } from "./emailTemplates.ts";

export async function deliverRefund(service: any, p: { appId: string; tenantEmail: string; title: string; lastName: string; propertyAddr: string; amount: string; guaranteeRef: string }): Promise<void> {
  if (!p.tenantEmail) return;
  const tpl = refundEmailTemplate({ title: p.title, lastName: p.lastName, propertyAddr: p.propertyAddr, amount: p.amount, guaranteeRef: p.guaranteeRef });
  const res = await sendMessage({
    to: p.tenantEmail,
    message: refundEmail({ propertyAddr: p.propertyAddr, guaranteeRef: p.guaranteeRef, amount: p.amount }),
  });
  await service.from("activity_log").insert({
    application_id: p.appId,
    kind: res.ok ? "refund_email_sent" : "refund_email_failed",
    message: res.ok ? "Refund confirmation email sent to the tenant." : `Refund confirmation email not sent: ${res.error}`,
    actor: "System",
    visibility: res.ok ? "business" : "internal",
  });
  if (res.ok && res.to && res.to !== p.tenantEmail) {
    await service.from("activity_log").insert({
      application_id: p.appId, kind: "refund_email_sent",
      message: `Redirected to ${res.to} (test mode).`, actor: "System", visibility: "internal",
    });
  }
}
