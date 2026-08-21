import { sendMessage } from "./mailer.ts";
import { executedDeedTenantEmail } from "./emailTemplates.ts";

export async function deliverExecutedDeedToTenant(service: any, p: { appId: string; ref: string; tenantEmail: string; tenantName: string; propertyAddr: string; tenancyStart: string | null; pdfPath: string | null }): Promise<void> {
  if (!p.tenantEmail) return;
  let downloadUrl = "";
  if (p.pdfPath) {
    const { data: signed } = await service.storage.from("deeds").createSignedUrl(p.pdfPath, 604800); // 7 days
    downloadUrl = signed?.signedUrl ?? "";
  }
  const res = await sendMessage({
    to: p.tenantEmail,
    message: executedDeedTenantEmail({
      guaranteeRef: p.ref, propertyAddr: p.propertyAddr,
      expiryLabel: null, downloadUrl,
    }),
  });
  await service.from("activity_log").insert({
    application_id: p.appId,
    kind: res.ok ? "tenant_deed_email_sent" : "tenant_deed_email_failed",
    message: res.ok ? "Signed deed emailed to the tenant." : `Tenant deed email not sent: ${res.error}`,
    actor: "System",
    visibility: res.ok ? "business" : "internal",
  });
  if (res.ok && res.to && res.to !== p.tenantEmail) {
    await service.from("activity_log").insert({
      application_id: p.appId, kind: "tenant_deed_email_sent",
      message: `Redirected to ${res.to} (test mode).`, actor: "System", visibility: "internal",
    });
  }
}
