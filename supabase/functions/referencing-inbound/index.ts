// =====================================================================
// referencing-inbound  (verify_jwt = false)
//
// Rail 4. The referencing provider has referenced somebody for one of their own
// agency customers, the result needs a guarantor, and they hand the tenant to
// us. Contract in the integration documents: POST with
// `Authorization: Basic base64(agency_secret_token)`.
//
// WHY THIS IS NOT SHAPED LIKE stripe-webhook OR pandadoc-webhook
// Those verify an HMAC over the raw body, so the request proves both WHO sent
// it and THAT THE BODY IS UNCHANGED, and they derive livemode from which
// signing secret verified. This contract offers none of that: a bearer secret
// in a header authenticates the caller and says nothing about the body. That is
// weaker and it is the provider's contract, not ours, so the shape here
// compensates where it can:
//
//   - the token is compared by HASH, never stored or logged in the clear
//   - the whole payload is recorded verbatim before anything acts on it
//   - table_id is the idempotency key and the ledger claims it FIRST, so a
//     redelivery cannot create a second application even if it arrives while
//     the first is still running
//   - livemode comes from the TOKEN, never from the payload, which is the one
//     place this can match the existing receivers' discipline
//
// THE NAMED SEAM: is agency_secret_token per agency or global?
// Unanswered, and it decides whether this is multi-tenant. Both are implemented.
// A token row with agency_number set identifies the agency by itself, which is
// the strong form. A token row with agency_number null authenticates the
// provider globally and the agency is taken from the payload, which is weaker
// because the payload is then trusted for something the token should have
// established. Every event records which happened in `agency_from_token`, so
// the answer can be read off production rather than asked for twice.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// The provider's own success/failure envelope, from the documents. Deliberately
// not our error contract: this endpoint answers in their vocabulary.
function ok(message: string) {
  return new Response(JSON.stringify({ status: "success", message }), {
    status: 200, headers: { ...cors, "Content-Type": "application/json" },
  });
}
function fail(message: string, status = 400) {
  return new Response(JSON.stringify({ status: "error", message }), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** "11-08-2026" (their format) or "2026-08-11". Returns null rather than guessing. */
function parseDate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function num(v: unknown): number | null {
  const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** base64 -> bytes, tolerating data: prefixes and whitespace. */
function b64(input: string): Uint8Array | null {
  try {
    const clean = input.replace(/^data:[^;]*;base64,/, "").replace(/\s/g, "");
    if (!clean) return null;
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Use POST.", 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const service = createClient(SUPABASE_URL, SERVICE);

  try {
    // ---- authenticate ------------------------------------------------------
    const header = req.headers.get("Authorization") ?? "";
    const m = header.match(/^Basic\s+(.+)$/i);
    if (!m) return fail("Missing or malformed Authorization header.", 401);

    let presented: string;
    try { presented = atob(m[1].trim()); } catch { return fail("Malformed credentials.", 401); }
    // Their base64 may wrap a bare token or "token:" style padding; the secret
    // is whatever is left after trimming a trailing colon.
    presented = presented.replace(/:+$/, "").trim();
    if (!presented) return fail("Missing credentials.", 401);

    const { data: token } = await service
      .from("referencing_inbound_tokens")
      .select("id, agency_number, partner_id, livemode, active")
      .eq("token_hash", await sha256Hex(presented))
      .maybeSingle();

    // Same message whether the token is unknown or deactivated: a caller must
    // not be able to tell a wrong secret from a revoked one.
    if (!token || !token.active) return fail("Not authorised.", 401);

    // ---- read the payload --------------------------------------------------
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return fail("Body must be valid JSON."); }

    const tableId = Number(body.table_id);
    if (!Number.isFinite(tableId)) return fail("table_id is required.");

    // ---- claim the ledger BEFORE acting ------------------------------------
    // The unique primary key on table_id is what makes this a claim rather than
    // a check-then-act. Two concurrent redeliveries race here and exactly one
    // wins; the loser sees the row and replays the first outcome.
    const { error: claimErr } = await service.from("referencing_inbound_events").insert({
      table_id: tableId,
      token_id: token.id,
      agency_from_token: !!token.agency_number,
      tenant_reference_number: String(body.tenant_reference_number ?? "") || null,
      overall_status: String(body.overall_status ?? "") || null,
      raw_payload: body,
    });

    if (claimErr) {
      if (claimErr.code === "23505") {
        const { data: prior } = await service
          .from("referencing_inbound_events")
          .select("status_code, error, application_id, completed_at")
          .eq("table_id", tableId).maybeSingle();
        if (prior?.completed_at && prior.status_code === 200) {
          return ok("User already sent to guarantor.");
        }
        if (!prior?.completed_at) return fail("This hand-over is still being processed.", 409);
        return fail(prior?.error ?? "This hand-over previously failed.", 422);
      }
      console.log(JSON.stringify({ event: "inbound_claim_failed", message: claimErr.message }));
      return fail("Could not record the request.", 500);
    }

    const finish = async (status: number, error: string | null, appId: string | null) => {
      await service.from("referencing_inbound_events")
        .update({ status_code: status, error, application_id: appId, completed_at: new Date().toISOString() })
        .eq("table_id", tableId);
    };

    // ---- the one status we act on -----------------------------------------
    // Anything else is recorded and refused rather than interpreted. A status we
    // have not seen must not be treated as a hand-over.
    const overall = String(body.overall_status ?? "").trim().toLowerCase();
    if (overall !== "pass with guarantor") {
      await finish(422, `Unsupported overall_status "${body.overall_status}"`, null);
      return fail(`This endpoint accepts "Pass with guarantor" only.`, 422);
    }

    // ---- which agency ------------------------------------------------------
    // From the token when the token is scoped; from the payload when it is not.
    // Recorded either way; see the seam note in the header.
    const agencyNumber = token.agency_number ?? (String(body.agency_number ?? "") || null);
    if (!agencyNumber) {
      await finish(400, "No agency could be established", null);
      return fail("No agency could be established for this request.");
    }

    const rent = num(body.share_amount) ?? num(body.rental_amount);
    const start = parseDate(body.tenant_start_date);
    const missing: string[] = [];
    if (!String(body.email ?? "").trim()) missing.push("email");
    if (!String(body.last_name ?? "").trim()) missing.push("last_name");
    if (rent === null) missing.push("rental_amount");
    if (!start) missing.push("tenant_start_date");
    if (missing.length) {
      await finish(400, `Missing: ${missing.join(", ")}`, null);
      return fail(`Missing or unreadable: ${missing.join(", ")}.`);
    }

    // ---- create ------------------------------------------------------------
    const { data: app, error: createErr } = await service.rpc("create_referencing_inbound_application", {
      p_table_id: tableId,
      p_partner: token.partner_id,
      p_title: String(body.title ?? "") || null,
      p_first: String(body.first_name ?? ""),
      p_last: String(body.last_name ?? ""),
      p_dob: parseDate(body.dob),
      p_email: String(body.email ?? ""),
      p_phone: String(body.contact ?? "") || null,
      p_addr1: String(body.address ?? ""),
      p_city: String(body.city ?? "") || null,
      p_postcode: String(body.postcode ?? ""),
      p_rent: rent,
      p_tenancy_start: start,
      p_company: String(body.company_id ?? "") || null,
      p_agency: String(body.agency_id ?? "") || null,
      p_user: String(body.user_id ?? "") || null,
      p_tenant: String(body.tenant_id ?? "") || null,
      p_agency_number: agencyNumber,
      p_tenant_ref: String(body.tenant_reference_number ?? "") || null,
      /* THE TOKEN SAYS WHETHER THIS IS REAL. It always did -- livemode is
         selected above -- and it was never passed, so the create wrote the
         literal `true` and a partner testing against their sandbox token
         minted live applications on our estate. Round 5, M6. Never from the
         payload: the sender does not get to say that their test is real. */
      p_livemode: !!token.livemode,
    });

    if (createErr) {
      // Their vocabulary out, ours in the log. Postgres error text has reached
      // an API caller once in this codebase already (defect 18).
      console.log(JSON.stringify({ event: "inbound_create_failed", tableId, message: createErr.message }));
      await finish(500, createErr.message, null);
      return fail("Could not create the application.", 500);
    }

    const appId = (app as any)?.id as string;

    // ---- the reports -------------------------------------------------------
    // Best effort, deliberately. The hand-over has already succeeded by this
    // point and the tenant needs their payment link; failing the whole request
    // because a PDF did not decode would make the provider retry a hand-over
    // that already happened. Failures are logged and the documents can be
    // re-fetched, because raw_payload keeps the base64.
    const docs: [string, string, string][] = [
      ["transunion_pdf_base64", "reference_report", String(body.transunion_pdf ?? "reference-report.pdf")],
      ["summary_report_base64", "summary_report", String(body.summary_report ?? "summary-report.pdf")],
      ["review_summay_report_base64", "review_summary_report", String(body.review_summay_report ?? "review-summary-report.pdf")],
      ["signature_base64", "provider_signature", String(body.signature ?? "signature.png")],
    ];
    for (const [field, kind, filename] of docs) {
      const raw = body[field];
      if (typeof raw !== "string" || !raw) continue;
      const bytes = b64(raw);
      if (!bytes) { console.log(JSON.stringify({ event: "inbound_doc_undecodable", tableId, field })); continue; }
      const path = `${appId}/${kind}-${filename}`;
      const { error: upErr } = await service.storage.from("reference-reports")
        .upload(path, bytes, {
          contentType: filename.toLowerCase().endsWith(".png") ? "image/png" : "application/pdf",
          upsert: true,
        });
      if (upErr) { console.log(JSON.stringify({ event: "inbound_doc_upload_failed", tableId, field, message: upErr.message })); continue; }
      await service.rpc("record_application_document", {
        p_application: appId, p_kind: kind, p_bucket: "reference-reports", p_path: path,
        p_filename: filename, p_content_type: null, p_bytes: bytes.length, p_source: "provider",
        p_income: null, p_address: null,
      });
    }

    await finish(200, null, appId);
    return ok("User sent to guarantor successfully.");
  } catch (e) {
    console.log(JSON.stringify({ event: "referencing_inbound_error", message: String(e) }));
    return fail("Something went wrong.", 500);
  }
});
