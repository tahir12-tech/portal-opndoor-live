// =====================================================================
// tenancy-correction (verify_jwt = false)
//
// Public token exchange for #81. An agent opens the tokenised link from the
// executed-deed email, sees the guarantee reference and the current tenancy
// start, and enters the correct date. Submitting APPLIES the correction
// automatically: the corrected date is written, the outstanding or executed deed
// is voided (a signed PDF is archived first), a corrected deed is regenerated and
// sent to the tenant to sign again, and once they sign the agent receives the new
// executed deed automatically (the completion webhook re-fires for the new
// document id). It is logged as an agent correction. There is no opndoor review.
//
// The deed lifecycle mirrors amend-tenancy-start's (the staff path), keyed on the
// deed state, and reuses the same shared primitives (voidDocument / generateDeed).
// It runs with the SERVICE ROLE because the agent has no login: amend_tenancy_start
// is gated on AAL2 + ownership and cannot be reached from here.
//
// The token is a random uuid scoped to one deed, expiring 7 days after delivery.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { voidDocument, generateDeed } from "../_shared/pandadoc.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** yyyy-mm-dd (or ISO) -> dd/mm/yyyy for display. */
function dmy(iso: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso ?? "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const b = await req.json().catch(() => ({}));
    const token = String(b.token ?? "").trim();
    if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return json({ ok: false, error: "This link is not valid." }, 200);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tok } = await service.from("tenancy_correction_tokens")
      .select("token, application_id, guarantee_ref, expires_at, submitted_at, applications(tenancy_start, prop_addr1, prop_postcode)")
      .eq("token", token).maybeSingle() as { data: any };
    if (!tok) return json({ ok: false, error: "This link is not valid." }, 200);
    if (new Date(tok.expires_at).getTime() < Date.now()) return json({ ok: false, expired: true, error: "This link has expired." }, 200);

    const app = Array.isArray(tok.applications) ? tok.applications[0] : tok.applications;
    const property = [app?.prop_addr1, app?.prop_postcode].filter(Boolean).join(", ");

    if (b.action === "load") {
      return json({ ok: true, guaranteeRef: tok.guarantee_ref, currentStart: dmy(app?.tenancy_start ?? null), property, alreadySubmitted: !!tok.submitted_at });
    }

    if (b.action === "submit") {
      const proposed = String(b.proposedStart ?? "").trim(); // yyyy-mm-dd
      if (!/^\d{4}-\d{2}-\d{2}$/.test(proposed)) return json({ ok: false, error: "Enter a valid date." }, 200);
      // Range check mirrors amend_tenancy_start's (2000-01-01 .. today + 5 years):
      // the service-role write below bypasses that RPC, so its guard is repeated here.
      const proposedMs = Date.parse(`${proposed}T00:00:00Z`);
      const minMs = Date.parse("2000-01-01T00:00:00Z");
      const maxMs = Date.now() + 5 * 365 * 24 * 60 * 60 * 1000;
      if (Number.isNaN(proposedMs) || proposedMs < minMs || proposedMs > maxMs) {
        return json({ ok: false, error: "That date is out of range." }, 200);
      }
      const note = String(b.note ?? "").trim().slice(0, 500) || null;

      // Full deed state for the lifecycle decision. Read with the service role:
      // the token is the authorisation here, there is no signed-in user.
      const { data: full } = await service.from("applications")
        .select("id, guarantee_ref, status, deed_state, pandadoc_document_id, executed_pdf_path, tenancy_start, livemode, withdrawn_at")
        .eq("id", tok.application_id).maybeSingle();
      if (!full) return json({ ok: false, error: "This link is not valid." }, 200);
      if (full.withdrawn_at) return json({ ok: false, error: "This guarantee has been withdrawn, so its date cannot be changed here. Reply to the deed email if you need help." }, 200);

      const dateChange = `from ${dmy(full.tenancy_start)} to ${dmy(proposed)}`;

      /* 1) CLAIM THE TOKEN FIRST, and claim it conditionally.

         submitted_at was written at step 2, AFTER the date change and the deed
         lifecycle below, and nothing ever refused a token that already had it.
         The "load" action reported alreadySubmitted and the screen hid the
         form; the POST behind it did not care. So the link -- which needs no
         sign-in, because the token IS the authorisation, and which sits in an
         agent's inbox for seven days -- could be replayed. Each replay moved
         the tenancy start again and, for an executed guarantee, archived the
         signed PDF and reissued the deed for signing. A forwarded email or a
         double-click on a slow connection was enough.

         Claiming first also closes the race that ordering alone would not: the
         `.is("submitted_at", null)` filter makes the claim the atomic step, so
         of two simultaneous submits exactly one proceeds. */
      const nowIso = new Date().toISOString();
      const { data: claimed } = await service.from("tenancy_correction_tokens")
        .update({ proposed_start: proposed, note, submitted_at: nowIso, resolved_at: nowIso, resolved_by: null })
        .eq("token", token)
        .is("submitted_at", null)
        .select("token")
        .maybeSingle();
      if (!claimed) {
        return json({
          ok: false, alreadySubmitted: true,
          error: "This correction has already been submitted. If the date still looks wrong, reply to the deed email and we will sort it out.",
        }, 200);
      }

      // 2) Apply the corrected date (expiry_date is a generated column and follows).
      await service.from("applications").update({ tenancy_start: proposed }).eq("id", full.id);

      // 3) Deed lifecycle, keyed on the state at correction time. Mirrors
      //    amend-tenancy-start (its executed / awaiting_tenant branches); the
      //    dangerous primitives (void, regenerate + state reset) are shared in
      //    pandadoc.ts, so only the branch choice lives in both places.
      let reissued = false;
      let archived = false;
      if (full.deed_state === "executed" || full.status === "deed") {
        // Destructive: archive the signed PDF, reopen to Paid, reissue for signing.
        archived = !!full.executed_pdf_path;
        if (archived) {
          const archivePath = `${full.id}/archive/${full.guarantee_ref}-superseded-${full.pandadoc_document_id ?? "deed"}.pdf`;
          await service.storage.from("deeds").copy(full.executed_pdf_path, archivePath);
          await service.from("activity_log").insert({ application_id: full.id, kind: "deed_archived", message: `Signed deed archived before an agent correction of the tenancy start ${dateChange}.`, actor: "Agent", visibility: "business" });
        }
        await service.from("applications").update({
          status: "paid", deed_state: null, deed_issued_at: null, deed_executed_at: null,
          issue_date: null, executed_pdf_path: null, pandadoc_document_id: null, deed_viewed_at: null,
        }).eq("id", full.id);
        const gen = await generateDeed(service, full.id, true);
        reissued = gen.ok;
      } else if (full.deed_state === "awaiting_tenant" && full.pandadoc_document_id) {
        // One-live-deed invariant: clear the id first (a late webhook for the old
        // document is then inert), void best-effort, regenerate regardless.
        const oldDocId = full.pandadoc_document_id;
        await service.from("applications").update({ pandadoc_document_id: null, deed_state: null, deed_viewed_at: null }).eq("id", full.id);
        const voided = await voidDocument(oldDocId, full.livemode === true);
        await service.from("activity_log").insert({ application_id: full.id, kind: "deed_voided", message: voided.ok ? `Outstanding deed voided for an agent correction of the tenancy start ${dateChange}.` : `Outstanding deed could not be voided for an agent correction ${dateChange}; it is superseded by the reissued deed. Detail: ${voided.error}`, actor: "Agent", visibility: "internal" });
        const gen = await generateDeed(service, full.id, true);
        reissued = gen.ok;
      }
      // else: Sent, or Paid with no live deed (error / declined / voided / none):
      // the date change alone, no reissue.

      // 4) Log it as an agent correction: the single business entry.
      const hadLiveDeed = full.deed_state === "executed" || full.status === "deed" || full.deed_state === "awaiting_tenant";
      const suffix = reissued
        ? (archived ? " The signed deed was archived and a corrected deed reissued to the tenant to sign." : " A corrected deed was reissued to the tenant to sign.")
        : (hadLiveDeed ? " The corrected deed could not be reissued automatically; opndoor has been notified." : "");
      await service.from("activity_log").insert({
        application_id: full.id,
        kind: "tenancy_correction_applied",
        message: `${full.guarantee_ref}: tenancy start corrected ${dateChange} by the agent.${suffix}${note ? ` Note: ${note}` : ""}`,
        actor: "Agent",
        visibility: "business",
      });
      return json({ ok: true, newStart: dmy(proposed), reissued });
    }

    return json({ ok: false, error: "Unknown action." }, 400);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Unexpected error." }, 500);
  }
});
