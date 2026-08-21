import { sendMessage } from "./mailer.ts";
import { paymentReceiptEmail } from "./emailTemplates.ts";
import { managedByFor, managedByLabel } from "./managedBy.ts";

export async function deliverPaymentReceipt(service: any, p: { appId: string; tenantEmail: string; title: string; lastName: string; propertyAddr: string; amount: string; guaranteeRef: string }): Promise<void> {
  if (!p.tenantEmail) return;
  const tpl = receiptTemplate({ title: p.title, lastName: p.lastName, propertyAddr: p.propertyAddr, amount: p.amount, guaranteeRef: p.guaranteeRef });
  // Says "your letting agent" or "your landlord" from what the tenant told us,
  // rather than assuming. managedByFor never throws: a copy decision must not
  // fail a send.
  const res = await sendMessage({
    to: p.tenantEmail,
    message: paymentReceiptEmail({
      propertyAddr: p.propertyAddr, guaranteeRef: p.guaranteeRef, amount: p.amount,
      managedBy: managedByLabel(await managedByFor(service, p.appId)),
    }),
  });
  await service.from("activity_log").insert({
    application_id: p.appId,
    kind: res.ok ? "payment_receipt_sent" : "payment_receipt_failed",
    message: res.ok ? "Payment receipt sent to the tenant." : `Payment receipt not sent: ${res.error}`,
    actor: "System",
    visibility: res.ok ? "business" : "internal",
  });
  if (res.ok && res.to && res.to !== p.tenantEmail) {
    await service.from("activity_log").insert({
      application_id: p.appId, kind: "payment_receipt_sent",
      message: `Redirected to ${res.to} (test mode).`, actor: "System", visibility: "internal",
    });
  }
}
