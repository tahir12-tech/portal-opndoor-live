// =====================================================================
// referencing-callback  (verify_jwt = false)
//
// The other half of rail 4. When an inbound hand-over reaches an executed deed,
// the provider has to be told, or their letting record shows a guarantor still
// required for a tenancy that is guaranteed.
//
// Contract from the integration documents:
//   POST <API_URL>CRMApi/update_gurantor_required_user_detail
//   Authorization: Basic base64(API_EMAIL:API_PASSWORD:API_TOKEN)
//   { TableID, CompanyID, AgencyID, UserID, TenantID,
//     PolicyDocument, PolicyDocument_Base64, PaymentStatus }
//
// The path really is spelled "gurantor". It is theirs, so it is reproduced
// exactly; correcting it here would 404.
//
// SEAM: the credentials and base URL are not set anywhere yet. They are theirs
// to issue. Until REFERENCING_API_URL exists this function refuses cleanly and
// changes nothing, rather than half-sending and marking rows notified.
//
// Triggered like the other ops functions: x-ops-secret, so pg_cron can drive it.
// Batch is small and the work is idempotent per row: notified_at is only set
// after a confirmed success, so an interrupted run simply retries.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/partnerAuth.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-ops-secret" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

/* A failure is COUNTED in the response and DESCRIBED in the log.

   WHY THEY ARE SEPARATED. table_id used to go into summary.errors, and this
   function is driven by a pg_net cron, so its response body is stored in
   net._http_response.content. cron_health returns the first 160 characters of
   that to the Health screen, and cron_health is granted to authenticated. So a
   provider identifier reached the browser through an ops panel, by a route that
   no grep for "table_id" under src/ would ever find.

   Truncating or redacting downstream would be chasing it. The response body
   simply does not carry an identifier: counts and a reason, nothing that names
   a row. The detail a person needs to debug goes to the function log, which is
   server side and is not rendered anywhere. */
function noteFailure(row: { table_id: number | string; application_id?: string }, reason: string) {
  console.log(JSON.stringify({
    event: "referencing_callback_failed",
    table_id: row.table_id,
    application_id: row.application_id,
    reason,
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const service = createClient(SUPABASE_URL, SERVICE);

  // Same auth shape as the other cron-driven functions: the edge secret, or the
  // ops_secrets mirror so a migration-scheduled job can read it from SQL.
  const presented = req.headers.get("x-ops-secret") ?? "";
  const expected = Deno.env.get("REMINDERS_CRON_SECRET") ?? "";
  let authorised = !!expected && timingSafeEqual(presented, expected);
  if (!authorised && presented) {
    // The ops_secrets mirror, read exactly as expiry-reminders and hubspot-sync
    // read it, so a migration-scheduled job that reads the secret from SQL
    // authenticates the same way against every ops function.
    const { data: sec } = await service.from("ops_secrets").select("secret").eq("name", "reminders_cron").maybeSingle();
    authorised = !!sec?.secret && timingSafeEqual(presented, sec.secret);
  }
  if (!authorised) return json({ ok: false, error: "Not authorised." }, 401);

  const API_URL = (Deno.env.get("REFERENCING_API_URL") ?? "").trim();
  const EMAIL = Deno.env.get("REFERENCING_API_EMAIL") ?? "";
  const PASSWORD = Deno.env.get("REFERENCING_API_PASSWORD") ?? "";
  const TOKEN = Deno.env.get("REFERENCING_API_TOKEN") ?? "";

  // Refuse as a whole rather than per row. A partially configured integration
  // that marks some rows notified is worse than one that has not started.
  if (!API_URL || !EMAIL || !PASSWORD || !TOKEN) {
    return json({
      ok: false,
      error: "The referencing provider callback is not configured.",
      missing: [
        !API_URL ? "REFERENCING_API_URL" : null,
        !EMAIL ? "REFERENCING_API_EMAIL" : null,
        !PASSWORD ? "REFERENCING_API_PASSWORD" : null,
        !TOKEN ? "REFERENCING_API_TOKEN" : null,
      ].filter(Boolean),
    }, 503);
  }

  const auth = "Basic " + btoa(`${EMAIL}:${PASSWORD}:${TOKEN}`);
  const { data: due, error } = await service.rpc("provider_callbacks_due");
  if (error) return json({ ok: false, error: `due: ${error.message}` }, 500);

  // No errors array. It existed to carry table_id and there is nothing else it
  // should carry: a count says whether to look, and the log says where.
  const summary = { ok: true, considered: (due ?? []).length, sent: 0, failed: 0 };

  for (const row of (due ?? []) as any[]) {
    try {
      // The executed deed is the payload. Without it there is nothing to send,
      // so the row is left due rather than reported as sent.
      const { data: app } = await service.from("applications")
        .select("executed_pdf_path").eq("id", row.application_id).maybeSingle();
      if (!app?.executed_pdf_path) { summary.failed++; continue; }

      const { data: file, error: dlErr } = await service.storage.from("deeds").download(app.executed_pdf_path);
      if (dlErr || !file) { summary.failed++; noteFailure(row, "deed not readable"); continue; }

      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);

      const res = await fetch(`${API_URL.replace(/\/+$/, "")}/CRMApi/update_gurantor_required_user_detail`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          TableID: row.table_id,
          CompanyID: row.company_id,
          AgencyID: row.agency_id,
          UserID: row.user_id,
          TenantID: row.tenant_id,
          PolicyDocument: `${row.guarantee_ref}.pdf`,
          PolicyDocument_Base64: btoa(bin),
          PaymentStatus: row.payment_status,
        }),
      });

      const text = await res.text();
      // They answer {"response":"SUCCESS"}. Anything else is a failure, including
      // a 200 carrying FAIL, so the HTTP status alone is not trusted.
      let good = false;
      try { good = res.ok && String(JSON.parse(text)?.response ?? "").toUpperCase() === "SUCCESS"; } catch { good = false; }

      if (good) {
        await service.from("application_provider_links")
          .update({ notified_at: new Date().toISOString(), notify_error: null })
          // By the PRIMARY KEY. Round 6, M6: table_id is the provider's row
          // number and is no longer unique on its own -- it is scoped by
          // partner and mode -- so a bare match could stamp another
          // provider's link.
          .eq("application_id", row.application_id);
        summary.sent++;
      } else {
        await service.from("application_provider_links")
          .update({ notify_error: text.slice(0, 500), notify_attempts: (row.notify_attempts ?? 0) + 1 })
          // By the PRIMARY KEY. Round 6, M6: table_id is the provider's row
          // number and is no longer unique on its own -- it is scoped by
          // partner and mode -- so a bare match could stamp another
          // provider's link.
          .eq("application_id", row.application_id);
        summary.failed++;
        noteFailure(row, `provider responded ${res.status}`);
      }
    } catch (e) {
      summary.failed++;
      noteFailure(row, String(e));
    }
  }

  summary.ok = summary.failed === 0;
  return json(summary, summary.ok ? 200 : 207);
});
