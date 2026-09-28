// =====================================================================
// deed-sweep (verify_jwt = false)
//
// THE AUTOMATIC PASS THAT DID NOT EXIST. 20261005260000 ruled that a failed deed
// is retried and that "the next automatic pass" picks it up. Nothing did: of the
// eight cron-invoked functions, none called generateDeed, so the only automatic
// generation in the system was inside stripe-webhook at the moment of payment.
// Past Stripe's own redelivery window a paid application with no deed stayed that
// way until a person opened it and pressed Generate. On dev eleven paid
// applications carry no document, two of them with deed_attempts 0, meaning
// generation was never attempted rather than having failed.
//
// WHICH applications is public.deeds_awaiting_generation, deliberately in SQL.
// This function only does the calling, and it calls the SAME sequence
// stripe-webhook does (claim, generate, release on failure) so there is one
// generation path in the product and not a second one that drifts.
//
// Auth: the cron path presents x-reminders-secret == REMINDERS_CRON_SECRET (or the
// ops_secrets mirror, as payment-reminders does). A manual run presents a
// signed-in opndoor-admin JWT and body { test: true }.
//
// TARGETED RUNS. A manual run may pass { refs: ["GR-1234", ...] } to sweep exactly
// those. That exists because the cost of this function is not CPU: every success
// creates a real PandaDoc document and sends a real email, and on a non-production
// environment those all land in one review inbox. Sweeping a backlog of eleven to
// prove that two work is not a rehearsal, it is a mess someone has to clear.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { generateDeed } from "../_shared/pandadoc.ts";
import { timingSafeEqual } from "../_shared/partnerAuth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-reminders-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

interface Candidate { application_id: string; guarantee_ref: string; paid_at: string; deed_attempts: number }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const CRON_SECRET = Deno.env.get("REMINDERS_CRON_SECRET") ?? "";

    const body = await req.json().catch(() => ({}));
    const test = !!body.test;
    const service = createClient(SUPABASE_URL, SERVICE);

    // Same two doors as payment-reminders, including the ops_secrets mirror, which
    // is what keeps the cron working when the edge env has drifted.
    const presented = req.headers.get("x-reminders-secret") ?? "";
    // Constant time: a cron secret is a bearer credential, and `===` leaks a
    // matching prefix through timing the way a password compare does. The
    // helper already existed for the partner API and the webhook verifier.
    let cronAuthed = Boolean(presented) && Boolean(CRON_SECRET) && timingSafeEqual(presented, CRON_SECRET);
    if (!cronAuthed && presented) {
      const { data: sec } = await service.from("ops_secrets").select("secret").eq("name", "reminders_cron").maybeSingle();
      if (sec?.secret && timingSafeEqual(presented, sec.secret)) cronAuthed = true;
    }
    let adminAuthed = false;
    if (!cronAuthed) {
      const authHeader = req.headers.get("Authorization") ?? "";
      if (authHeader) {
        const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
        const { data: u } = await userClient.auth.getUser();
        if (u.user?.id) {
          const { data: prof } = await userClient.from("users").select("role").eq("id", u.user.id).maybeSingle();
          adminAuthed = prof?.role === "superadmin";
        }
      }
    }
    if (!cronAuthed && !adminAuthed) return json({ ok: false, error: "Not authorised." }, 401);
    if (!cronAuthed && !test) return json({ ok: false, error: "Manual runs must set { test: true }." }, 400);

    const olderThanMin = Number.isFinite(Number(body.olderThanMinutes)) ? Number(body.olderThanMinutes) : 30;
    const limit = Number.isFinite(Number(body.limit)) ? Math.max(0, Math.min(Number(body.limit), 100)) : 25;
    const refs: string[] = Array.isArray(body.refs) ? body.refs.map((r: unknown) => String(r)) : [];

    const { data, error } = await service.rpc("deeds_awaiting_generation", {
      p_older_than: `${olderThanMin} minutes`,
      // A targeted run still goes through the same selection rule and then filters,
      // rather than reaching past it: naming a ref must not generate a deed for an
      // application the rule would have refused (refunded, voided, already parked).
      p_limit: refs.length ? 100 : limit,
    });
    if (error) {
      await service.rpc("report_ops_incident", {
        p_type: "deed_sweep_failed",
        p_detail: `deed-sweep could not read the candidate list: ${error.message}`,
      }).then(() => {}, () => {});
      return json({ ok: false, error: error.message }, 500);
    }

    let due = (data ?? []) as Candidate[];
    const askedFor = refs.length;
    if (refs.length) due = due.filter((c) => refs.includes(c.guarantee_ref));

    const generated: string[] = [];
    const failed: { ref: string; error: string }[] = [];
    const skipped: { ref: string; why: string }[] = [];

    for (const c of due) {
      // THE SAME GATE stripe-webhook uses. Two of these running at once (the cron
      // and a person pressing Generate) must not both produce a document, and the
      // claim plus the lease inside generateDeed are what settle that.
      const claim = await service.rpc("claim_tenancy_deed", { p_application: c.application_id });
      if (claim.error) {
        failed.push({ ref: c.guarantee_ref, error: `claim failed: ${claim.error.message}` });
        continue;
      }
      if (claim.data !== true) {
        // Not a fault: something legitimate changed between the select and here.
        skipped.push({ ref: c.guarantee_ref, why: "already claimed or no longer eligible" });
        continue;
      }
      const gen = await generateDeed(service, c.application_id);
      if (!gen.ok) {
        // Release, so the next pass can try again. generateDeed has already
        // recorded the failure and raised its own incident where one is warranted.
        await service.rpc("release_tenancy_deed_claim", { p_application: c.application_id })
          .then(() => {}, () => {});
        failed.push({ ref: c.guarantee_ref, error: gen.error ?? "unknown" });
        continue;
      }
      generated.push(c.guarantee_ref);
    }

    /* ONE ALERT FOR THE RUN, not one per application. A sweep that fails for
       everything it touched is almost always one cause (an unset PANDADOC_API_KEY,
       the template id, the database refusing), and the per-application incidents
       generateDeed raises are deduped hourly by type. This says the sweep itself
       is not working, which is the thing nobody would otherwise notice: a cron
       whose every attempt fails looks exactly like a cron with nothing to do. */
    if (failed.length && !generated.length) {
      await service.rpc("report_ops_incident", {
        p_type: "deed_sweep_all_failed",
        p_detail: `deed-sweep tried ${failed.length} application(s) and generated none. First error: ${failed[0].error}`,
      }).then(() => {}, () => {});
    }

    return json({
      ok: true,
      mode: cronAuthed ? "cron" : "manual",
      olderThanMinutes: olderThanMin,
      ...(askedFor ? { askedFor: refs, matched: due.length } : {}),
      candidates: due.length,
      generated,
      failed,
      skipped,
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Unexpected error." }, 500);
  }
});
