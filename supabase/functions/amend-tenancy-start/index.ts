// =====================================================================
// amend-tenancy-start (verify_jwt = true)
//
// Single server entry point for amending the tenancy start date. Permission is
// enforced by the amend_tenancy_start RPC (deed-state aware, AAL2, ownership),
// called as the signed-in user. After the date update, the deed lifecycle is
// orchestrated with the service role, keyed on the deed state at amend time:
//   - awaiting_tenant : void the outstanding document and regenerate, so the
//                       corrected tenancy start prints on a fresh deed;
//   - executed        : archive the signed PDF, reopen to Paid, and issue a
//                       replacement deed for signing (Management/admin only, per
//                       the RPC's permission check);
//   - otherwise (Sent, or Paid with no live deed): the date update alone.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { notifyReferrer } from "../_shared/referrerNotify.ts";
import { voidDocument, generateDeed } from "../_shared/pandadoc.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** yyyy-mm-dd (or ISO) -> dd/mm/yyyy for the activity message. */
/* "16 Oct 2026", not "16/10/2026". Matt, 2026-10-04: 'use "16 Oct 2026"
   format'. This is the portal's one date format, and an audit row a human
   reads a year later should not need the reader to know whether we write
   days or months first. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dmy(iso: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return iso ?? "";
  const mi = Number(m[2]) - 1;
  return `${Number(m[3])} ${MONTHS[mi] ?? m[2]} ${m[1]}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ ok: false, error: "Not authenticated." }, 401);

    const { ref, newStart, confirmReissue } = await req.json();
    if (!ref || !newStart) return json({ ok: false, error: "Missing application reference or new start date." }, 400);

    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    let actor = "A user";
    if (userData.user?.id) {
      const { data: prof } = await userClient.from("users").select("full_name").eq("id", userData.user.id).maybeSingle();
      if (prof?.full_name) actor = prof.full_name;
    }

    // RLS-scoped read of the pre-amend state (drives the deed orchestration and
    // gives the OLD tenancy start for the activity message).
    const { data: app, error: readErr } = await userClient
      .from("applications")
      .select("id, guarantee_ref, status, deed_state, pandadoc_document_id, executed_pdf_path, tenancy_start, livemode, "
        // See the same addition in tenancy-correction: the update below
        // moves these aside, so they have to be in hand.
        + "deed_delivered_at, deed_delivered_to, deed_delivery_superseded_at, deed_delivery_superseded_to")
      .eq("guarantee_ref", ref)
      .maybeSingle();
    if (readErr) return json({ ok: false, error: readErr.message }, 400);
    if (!app) return json({ ok: false, error: "Application not found, or you do not have access to it." }, 404);

    const oldDmy = dmy(app.tenancy_start);
    const newDmy = dmy(newStart);
    const dateChange = `from ${oldDmy} to ${newDmy}`;

    /* A DATE THAT IS NOT MOVING IS NOT AN AMENDMENT.

       Matt, 2026-10-04: the activity log said "amended from 17/10/2026 to
       17/10/2026". It was not a read-after-write: `oldDmy` is taken above,
       before the RPC. It was this function running TWICE, and the log on dev
       proves it. Two tenancy_amended rows six seconds apart:

         17:00:21  tenancy_amended  from 17/10/2026 to 17/10/2026
         17:00:21  deed_voided      ... amendment from 16/10/2026 ...
         17:00:27  tenancy_amended  from 16/10/2026 to 17/10/2026

       One call read 16 and moved it, taking six seconds over voiding and
       regenerating the deed. A second call, arriving while the first was
       still working, read the date the first had ALREADY WRITTEN, found
       nothing to do, and logged that it had done it. The correct row is the
       17:00:27 one; the meaningless one was written first and is the one a
       reader sees at the top.

       SO THE GUARD IS THE RULE ITSELF rather than a lock: amending a date to
       the date it already has is a no-op, and a no-op writes no audit row,
       voids no deed and sends no email. That is true whatever caused the
       second call -- a double click, a retry, two tabs -- and it is worth
       saying even with one caller. */
    if (app.tenancy_start === newStart) {
      return json({ ok: true, unchanged: true, message: "That is already the tenancy start date, so nothing was changed." });
    }

    // #82 Amending a SIGNED (executed) deed is destructive: it voids/supersedes the
    // signed deed, reissues it to the tenant, and re-notifies the agent once
    // re-signed. Require an explicit confirmation BEFORE the date is committed.
    if ((app.deed_state === "executed" || app.status === "deed") && confirmReissue !== true) {
      return json({ ok: false, needsConfirm: true, error: "Amending the tenancy start on a signed deed will void it, reissue a corrected deed to the tenant to sign, and re-notify the agent once re-signed. Confirm to proceed." }, 200);
    }

    // 1) Permission + date update, enforced in the database (deed-state aware).
    const { error: rpcErr } = await userClient.rpc("amend_tenancy_start", { p_app: app.id, p_new_start: newStart });
    if (rpcErr) return json({ ok: false, error: rpcErr.message }, 200);

    const service = createClient(SUPABASE_URL, SERVICE);

    // #81 The date is now amended, so any agent-reported tenancy-start corrections
    // for this application are handled; mark them resolved (best-effort).
    await service.from("tenancy_correction_tokens")
      .update({ resolved_at: new Date().toISOString(), resolved_by: userData.user?.id ?? null })
      .eq("application_id", app.id).is("resolved_at", null).not("submitted_at", "is", null);

    // Exactly one BUSINESS activity entry per amend, attributed by name, stating
    // old -> new. "The deed was reissued for signing" is appended ONLY when a
    // regeneration actually ran. Supporting steps (archive / void) are separate:
    // the archive entry references the amend; the void is an internal detail.
    const logAmend = (suffix: string) =>
      service.from("activity_log").insert({
        application_id: app.id, kind: "tenancy_amended",
        message: `Tenancy start amended ${dateChange} by ${actor}.${suffix}`,
        actor, visibility: "business",
      });

    // 2) Deed lifecycle, keyed on the state at amend time.
    if (app.deed_state === "executed" || app.status === "deed") {
      // Archive the signed PDF before replacing it (the entry references the amend).
      // Only claim an archive when there actually was a stored PDF to archive.
      const archived = !!app.executed_pdf_path;
      if (archived) {
        const archivePath = `${app.id}/archive/${app.guarantee_ref}-superseded-${app.pandadoc_document_id ?? "deed"}.pdf`;
        await service.storage.from("deeds").copy(app.executed_pdf_path, archivePath);
        await service.from("activity_log").insert({ application_id: app.id, kind: "deed_archived", message: `Signed deed archived before amending the tenancy start ${dateChange}, by ${actor}.`, actor, visibility: "business" });
      }
      const archivePhrase = archived ? "The signed deed was archived and a" : "A";
      // Reopen to Paid and clear the executed deed, then issue a replacement.
      /* AND THE DELIVERY GOES WITH THE DEED. 20261007640000.
         This update cleared everything about the executed document and
         left `deed_delivered_at` pointing at the delivery of the deed it
         had just archived, so the application went on claiming a
         delivery of a superseded PDF -- and the completion guard, asking
         "has this been delivered", refused the corrected deed as a
         replay. GR-23853: signed 03 Oct 11:28:43, "Completion replayed;
         the signed deed already went to joe", and the agent never got
         it. The earlier delivery is MOVED rather than dropped: it really
         happened, the agent holds that PDF, and the Delivery panel has
         to be able to say it is superseded. */
      await service.from("applications").update({
        status: "paid", deed_state: null, deed_issued_at: null, deed_executed_at: null,
        issue_date: null, executed_pdf_path: null, pandadoc_document_id: null, deed_viewed_at: null,
        deed_delivery_superseded_at: app.deed_delivered_at ?? app.deed_delivery_superseded_at ?? null,
        deed_delivery_superseded_to: app.deed_delivered_to ?? app.deed_delivery_superseded_to ?? null,
        deed_delivered_at: null, deed_delivered_to: null, deed_resent_at: null,
      }).eq("id", app.id);
      const gen = await generateDeed(service, app.id, true);
      if (!gen.ok) {
        // The date change already committed: always leave exactly one amend entry,
        // without a reissue clause (no regeneration ran).
        await logAmend(`${archived ? " The signed deed was archived." : ""} The replacement deed could not be issued automatically; opndoor has been notified.`);
        return json({ ok: false, error: `Tenancy start amended${archived ? " and the signed deed archived" : ""}, but the replacement failed: ${gen.error}` }, 200);
      }
      await logAmend(` ${archivePhrase} replacement was reissued for signing.`);
    /* AND TELL THE PEOPLE ANSWERABLE FOR IT. Matt, 2026-10-04: "email the
       referrer and anyone copied on that referral who has 'Tenancy start
       corrected' on ... GR-25834's change at 18:00 didn't email barb."

       NOTHING EVER SENT THIS. The type has been in the preference matrix
       since 20261006510000, so every agent has had a switch for a
       notification that did not exist. notifyReferrer applies the matrix, so
       who hears is their setting rather than this code's opinion, and it
       refuses to email about a sandbox application.

       AFTER the deed work, so `deedReissued` states what actually happened
       rather than what was about to be attempted. */
      await notifyReferrer(service, app.id, "corrected", { oldDate: oldDmy, newDate: newDmy, by: actor, deedReissued: true });
      return json({ ok: true, message: `Tenancy start amended.${archived ? " The signed deed was archived and a replacement" : " A replacement deed was"} sent to the tenant to sign.` });
    }

    if (app.deed_state === "awaiting_tenant" && app.pandadoc_document_id) {
      // #82 one-live-deed invariant: the outstanding unsigned deed must ALWAYS be
      // replaced with a corrected one so the deed and the amended date can never
      // disagree. The void of the old PandaDoc envelope is BEST-EFFORT: clear the
      // document id first (so any late webhook for the old document is inert), then
      // attempt the void, then regenerate regardless of the void outcome. A failed
      // void never blocks the amend, because the new deed supersedes the old one.
      const oldDocId = app.pandadoc_document_id;
      await service.from("applications").update({ pandadoc_document_id: null, deed_state: null, deed_viewed_at: null }).eq("id", app.id);
      // livemode from the application row, so an amendment on a sandbox deed voids
      // it in the sandbox PandaDoc account rather than 404ing against production.
      const voided = await voidDocument(oldDocId, app.livemode === true);
      await service.from("activity_log").insert({
        application_id: app.id, kind: "deed_voided",
        message: voided.ok
          ? `Outstanding deed voided for a tenancy-start amendment ${dateChange} by ${actor}.`
          : `Outstanding deed could not be voided for a tenancy-start amendment ${dateChange}; it is superseded by the regenerated deed. Detail: ${voided.error}`,
        actor, visibility: "internal",
      });
      const gen = await generateDeed(service, app.id, true);
      if (!gen.ok) {
        // Date change committed; the deed is left in 'error' (not live) so the
        // invariant still holds. Log the amend without a reissue clause.
        await logAmend(" The corrected deed could not be issued automatically; opndoor has been notified.");
        return json({ ok: false, error: `Tenancy start amended, but the corrected deed failed: ${gen.error}` }, 200);
      }
      // Audit line the ruling requires, kept as an INTERNAL supporting step so the
      // single business tenancy_amended entry (below) is the only partner-visible
      // row, matching the executed branch and the one-business-entry-per-amend rule.
      await service.from("activity_log").insert({ application_id: app.id, kind: "deed_regenerated", message: "Deed regenerated after tenancy amendment.", actor, visibility: "internal" });
      await logAmend(" The outstanding deed was replaced with a corrected one for signing.");
      await notifyReferrer(service, app.id, "corrected", { oldDate: oldDmy, newDate: newDmy, by: actor, deedReissued: true });
      return json({ ok: true, message: "Tenancy start amended. The outstanding deed was replaced with a corrected one." });
    }

    // Sent, or Paid with no live deed (error / declined / voided / none): no reissue.
    await logAmend("");
    await notifyReferrer(service, app.id, "corrected", { oldDate: oldDmy, newDate: newDmy, by: actor, deedReissued: false });
    return json({ ok: true, message: "Tenancy start amended." });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Unexpected error." }, 500);
  }
});
