// =====================================================================
// pandadoc-webhook (verify_jwt = false)
//
// PandaDoc cannot send a Supabase JWT, so JWT verification is off and security
// is the PandaDoc HMAC signature (PANDADOC_WEBHOOK_SHARED_KEY). Service-role
// transition via apply_deed_executed (the deed twin of apply_stripe_payment).
//
// Idempotent: a document reaching a given status is processed once
// (pandadoc_events). Document completed -> download + store the executed PDF
// and flip Paid to Deed Issued. Voided / declined set the deed sub-state and
// log for review; no status change. Other statuses are acknowledged.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyWebhook, downloadPdf } from "../_shared/pandadoc.ts";
import { deliverDeedToAgent } from "../_shared/deedEmail.ts";
import { deliverExecutedDeedToTenant } from "../_shared/executedDeedEmail.ts";
import { maySendOpndoorEmail } from "../_shared/livemodeCredentials.ts";
import { titleCaseAddress } from "../_shared/text.ts";

Deno.serve(async (req) => {
  const signature = new URL(req.url).searchParams.get("signature") ?? "";
  const body = await req.text();
  // The shared key that verifies the HMAC is what tells us which PandaDoc account
  // sent this. Nothing in the body is trusted for that: a callback is an
  // unauthenticated request until the signature checks out, so any field inside it
  // is a claim rather than a fact.
  const verified = await verifyWebhook(body, signature);
  if (!verified.ok) return new Response("Invalid signature", { status: 401 });
  const eventLivemode = verified.livemode === true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let events: any[];
  try {
    const parsed = JSON.parse(body);
    events = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return new Response("Bad body", { status: 400 });
  }

  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  for (const ev of events) {
    const docId = ev?.data?.id;
    const status = ev?.data?.status;
    const type = ev?.event ?? ev?.event_type ?? "unknown";
    if (!docId) continue;

    const evId = `${docId}:${status ?? type}`;
    const { error: insErr } = await service.from("pandadoc_events").insert({ id: evId, type });
    if (insErr) continue; // duplicate delivery -> skip

    const { data: app } = await service.from("applications")
      .select("id, guarantee_ref, branch_id, tenant_title, tenant_first_name, tenant_last_name, tenant_email, prop_addr1, prop_postcode, tenancy_start, livemode, agency:agencies(name)")
      .eq("pandadoc_document_id", docId).maybeSingle();

    // Refuse a callback whose mode does not match the application it names. The
    // two can only disagree if a sandbox event is replayed against a live
    // application or the same shared key has been configured for both modes.
    // Neither is recoverable by choosing one, and choosing the event's mode would
    // let a forged sandbox callback mark a real deed executed.
    //
    // The dedup row is deleted so a corrected redelivery is not swallowed, and
    // this returns 500 rather than 401 so PandaDoc keeps retrying and the
    // misconfiguration stays visible instead of being silently dropped.
    if (app && (app.livemode === true) !== eventLivemode) {
      await service.from("ops_alerts").insert({
        alert_type: "pandadoc_livemode_mismatch",
        detail: `PandaDoc event ${evId} verified as ${eventLivemode ? "live" : "sandbox"} but application ${app.id} is ${app.livemode ? "live" : "sandbox"}. Refused.`,
      }).then(() => {}, () => {});
      await service.from("pandadoc_events").delete().eq("id", evId).then(() => {}, () => {});
      return new Response("Event mode does not match the application.", { status: 500 });
    }

    if (status === "document.completed") {
      let path: string | null = null;
      const pdf = await downloadPdf(docId, eventLivemode);
      if (pdf && app) {
        path = `${app.id}/${app.guarantee_ref}.pdf`;
        await service.storage.from("deeds").upload(path, pdf, { contentType: "application/pdf", upsert: true });
      }
      // supabase-js returns a DB error object rather than throwing: check it, or a
      // transient failure would leave the deed un-executed while the "signed and
      // issued" emails below still send. Delete the dedup row (so a PandaDoc retry
      // re-processes rather than being deduped) and throw -> 500 -> retry.
      const { error: execErr } = await service.rpc("apply_deed_executed", { p_document_id: docId, p_pdf_path: path });
      if (execErr) {
        await service.from("pandadoc_events").delete().eq("id", evId);
        throw new Error(`apply_deed_executed failed: ${execErr.message}`);
      }
      if (app) {
        // The signing event. The "Deed Issued" milestone (status/timeline) is
        // driven by apply_deed_executed above; this is the distinct signed entry.
        await service.from("activity_log").insert({ application_id: app.id, kind: "deed_signed", message: "Deed signed by the tenant.", actor: "PandaDoc", visibility: "business" });
        await service.from("pandadoc_events").update({ application_id: app.id }).eq("id", evId);

        // Automatic deed delivery to the resolved claim contact (branch contact ->
        // agency default). Runs exactly once per document: the pandadoc_events
        // insert above dedups a webhook retry, so it cannot double-send. This is
        // the same email the manual "Send deed to agent" button sends; if no
        // contact resolves we record it for the needs-attention surface, never
        // failing silently. The manual button is the recovery/resend path.
        // Sandbox sends neither of the two Opndoor emails below. The agent one is
        // the sharper edge: the agent contact on a sandbox application is a real
        // letting agent's address if a developer used a real one in a test
        // payload, and it would arrive carrying an executed Deed of Guarantee for
        // a tenancy that does not exist.
        const mayEmail = maySendOpndoorEmail(app.livemode === true);
        // Where the executed deed goes, resolved in one place by deed_delivery_target:
        // the tenant-named delivery contact when there is one (the direct rail), else
        // the branch's effective primary contact (the referral rail). We send to the
        // address the tenant gave, on every rail, with no verification gate: if it
        // bounces, that surfaces as a failed delivery on the needs-attention surface,
        // which is enough. Sandbox still sends nothing.
        const { data: target } = await service.rpc("deed_delivery_target", { p_application: app.id });
        const dest = Array.isArray(target) ? target[0] : target;
        // auto_send is false when an AGENT-RAIL deed has no ACTIVE person to receive
        // it — the only manager is still pending, say. A pending account cannot be
        // opened, so emailing it would be a silent loss; it goes to the same
        // needs-attention surface below instead, for a staff send. Supplier and
        // direct rails always set it true, so they are unaffected.
        if (dest?.email && dest?.auto_send !== false && mayEmail) {
          const agencyName = (Array.isArray(app.agency) ? app.agency[0]?.name : (app.agency as { name?: string } | null)?.name) ?? "";
          await deliverDeedToAgent(service, {
            appId: app.id,
            ref: app.guarantee_ref,
            tenantTitle: app.tenant_title ?? "",
            tenantName: `${app.tenant_first_name} ${app.tenant_last_name}`,
            // #8 Title-case the address line for display; postcode left raw.
            addr1: titleCaseAddress(app.prop_addr1 ?? ""),
            postcode: app.prop_postcode ?? "",
            tenancyStart: app.tenancy_start ?? null,
            agencyName,
            pdfPath: path,
          }, { email: dest.email, name: dest.display_name ?? "" }, "automatic");
        } else {
          // Nothing to deliver to, or nobody who may receive it yet: mark delivery
          // as failed so it surfaces on the delivery-failure/needs-attention
          // surfaces (Delivery Failed) for a staff send.
          const heldForPeople = !!dest?.email && dest?.auto_send === false;
          await service.from("activity_log").insert({
            application_id: app.id,
            kind: "deed_delivery_failed",
            message: heldForPeople
              ? "Deed issued; nobody active at this agency can receive it — held for a staff send. Invite or activate a manager, or nominate a recipient."
              : "Deed issued; no agent contact on file — delivery failed.",
            actor: "System",
            visibility: "business",
          });
        }
             // Resend allows 2 req/sec; a short gap keeps the agent + tenant emails
        // (and any review-copy send inside them) from landing in the same window.
        await new Promise((r) => setTimeout(r, 600));
        // #4 Email the tenant their own signed deed (download link), regardless of
        // whether the agent contact resolved. Idempotent via the pandadoc_events
        // dedup above (document.completed runs once).
        if (mayEmail) await deliverExecutedDeedToTenant(service, {
          appId: app.id,
          ref: app.guarantee_ref,
          tenantEmail: app.tenant_email ?? "",
          tenantName: `${app.tenant_first_name ?? ""} ${app.tenant_last_name ?? ""}`.trim(),
          // #8 Title-case the address line for display; postcode left raw.
          propertyAddr: [titleCaseAddress(app.prop_addr1), app.prop_postcode].filter(Boolean).join(", "),
          tenancyStart: app.tenancy_start ?? null,
          pdfPath: path,
        });
      }
    } else if (status === "document.viewed") {
      if (app) {
        // First view only: the event id (docId:document.viewed) is deduplicated
        // above, and the null guard is a second safeguard.
        await service.from("applications").update({ deed_viewed_at: new Date().toISOString() }).eq("id", app.id).is("deed_viewed_at", null);
        await service.from("activity_log").insert({ application_id: app.id, kind: "deed_viewed", message: "Deed viewed by the tenant.", actor: "PandaDoc", visibility: "business" });
        await service.from("pandadoc_events").update({ application_id: app.id }).eq("id", evId);
      }
    } else if (status === "document.voided") {
      await service.rpc("set_deed_state", { p_document_id: docId, p_state: "voided" });
      if (app) await service.from("activity_log").insert({ application_id: app.id, kind: "deed_voided", message: "Deed document voided in PandaDoc. Review required.", actor: "PandaDoc" });
    } else if (status === "document.declined") {
      await service.rpc("set_deed_state", { p_document_id: docId, p_state: "declined" });
      if (app) await service.from("activity_log").insert({ application_id: app.id, kind: "deed_declined", message: "Tenant declined to sign the deed. Review required.", actor: "PandaDoc" });
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });
});
