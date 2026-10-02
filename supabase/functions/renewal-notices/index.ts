// =====================================================================
// renewal-notices (verify_jwt = false)
//
// The scheduled daily job (pg_cron -> net.http_post, twice at 07:00 and 08:00
// UTC to cover BST/GMT; this function self-gates to 08:00 Europe/London and the
// off-hour run no-ops). For every in-force guarantee ending within 30 days that
// has not been noticed, it emails the tenant, the agent or landlord on the
// application, and the referrer where there is one, inviting a reply to continue
// cover. One notice per application, enforced by the guarantee_renewal_notices
// ledger inside fire_renewal_notices, and logged to the activity feed.
// Redirected to the review address in this test build.
//
// Auth: the cron path presents x-reminders-secret == REMINDERS_CRON_SECRET (or
// the ops_secrets mirror). The manual TEST path presents a signed-in
// opndoor-admin JWT (or the cron secret) and body { test: true }, optionally
// { date: 'YYYY-MM-DD' } to run against a specific day.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendMessage } from "../_shared/mailer.ts";
import { renewalNoticeEmail, tenantRenewalNoticeEmail } from "../_shared/emailTemplates.ts";
import { timingSafeEqual } from "../_shared/partnerAuth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-reminders-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** Current hour and calendar date in Europe/London. */
function londonNow(): { hour: number; date: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour: "2-digit", hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return { hour: Number(g("hour")), date: `${g("year")}-${g("month")}-${g("day")}` };
}

/** yyyy-mm-dd -> "1 September 2027", parsed from the parts so no timezone shifts it. */
function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(d);
}

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

    // Cron auth: x-reminders-secret must match the edge env OR the ops_secrets mirror.
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

    const nowL = londonNow();
    if (!test && nowL.hour !== 8) {
      return json({ ok: true, skipped: `not 08:00 Europe/London (currently ${String(nowL.hour).padStart(2, "0")}:00)` });
    }
    const pToday = (test && typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) ? body.date : nowL.date;

    // Claims each due application into the ledger as it returns it, so this is
    // idempotent: the off-hour run and any re-run send nothing.
    const { data: fired, error: rpcErr } = await service.rpc("fire_renewal_notices", { p_today: pToday });
    if (rpcErr) return json({ ok: false, error: rpcErr.message }, 500);
    const due = (fired ?? []) as Array<{
      application_id: string; guarantee_ref: string; tenant_name: string | null; property_addr: string | null;
      end_date: string; tenant_email: string | null; contact_name: string | null; contact_email: string | null;
      referrer_name: string | null; referrer_email: string | null; channel: string | null;
    }>;

    // parked: an agency renewal with nobody to send it to, counted and returned.
    let emailed = 0, emailFailed = 0, parkedCount = 0;
    for (const r of due) {
      const endLabel = fmtDate(String(r.end_date));
      const message = renewalNoticeEmail({
        tenantName: r.tenant_name || "the tenant",
        propertyAddr: r.property_addr || "",
        endDate: endLabel,
      });
      /* WHO IS TOLD A GUARANTEE IS ENDING, BY RAIL.

         This was the tenant, the referrer, and
         effective_primary_contact(branch_id) -- with no rail test anywhere. A
         DIRECT tenant's branch_id is pointed at a real agency branch by the
         auto-matcher, so their name, property and end date went to an agency
         person nobody chose. That is the fault 20261006160000 fixed for the
         deed a year earlier in the lifecycle; this job was not in that fix.

         The SQL now resolves the contact per rail and says which rail it is.
         The agency rail has no single contact -- it has the ladder -- so it is
         asked here, the way expiry-reminders asks it, and parks with an alert
         rather than falling back to anything wider. */
      /* ONE DOOR, FOR EVERY RAIL. Q-02 and Q-03. The ladder was asked on the
         agency rail and the other two fell through to the row's own
         contact_email and referrer_email, which is a third way of resolving
         the same question. notification_recipients answers for all three and
         applies the party's matrix. The tenant is NOT in it -- Q-03 locks
         every email to the tenant out of the matrix -- so the tenant is added
         separately below, exactly as before. */
      let agents: string[] = [];
      let parked: string | null = null;
      {
        const { data: scoped, error: ladderErr } = await service.rpc(
          "notification_recipients", { p_application: r.application_id, p_type: "renewal_notice" });
        if (ladderErr) {
          parked = `the recipient list could not be read: ${ladderErr.message}`;
        } else {
          agents = ((scoped ?? []) as Array<{ email: string }>).map((x) => x.email).filter(Boolean);
          /* Parked only where somebody was EXPECTED. A direct tenant has no
             agent-facing party at all -- notification_recipients returns
             nothing for them by design -- so an empty list there is the right
             answer and not an incident. The tenant is still told. */
          if (agents.length === 0 && r.channel !== "Direct" && !r.tenant_email) {
            parked = "nobody is addressed for a renewal on this party: no active referrer, nobody ticked in scope, no branch contact, or the matrix has it switched off";
          }
        }
      }
      if (parked) {
        parkedCount += 1;
        await service.rpc("report_ops_incident", {
          p_type: "renewal_notice_unaddressed",
          p_detail: `${r.guarantee_ref}: ${parked}`,
        }).then(() => {}, () => {});
        await service.from("activity_log").insert({
          application_id: r.application_id, kind: "renewal_notice_parked",
          message: `Renewal notice not sent: ${parked}.`, actor: "System", visibility: "internal",
        });
        continue;
      }

      /* TWO SENDS, BY AUDIENCE. Matt, 2026-10-02: "send the tenant their
         own email, worded for them ... and the agent theirs, as two
         separate sends."

         The tenant used to be one more address on the agent's email, so
         they read a third-person report about their own tenancy. They
         get `tenantRenewalNoticeEmail` now, which is the same facts in
         the second person.

         THE AGENT SIDE KEEPS ITS SINGLE SEND, and the comment that was
         here still explains why: one notification to a list rather than
         a loop per address is the shape every other job uses and the
         shape the deed rule specified. What changes is that the list no
         longer has the tenant in it. `emailed` still counts
         notifications and not addresses -- there are simply up to two of
         them now, which is what was asked for. */
      const agentList = Array.from(new Set(
        agents.filter((e): e is string => typeof e === "string" && e.length > 0),
      ));
      let anySent = false, anyFailed = false;
      if (r.tenant_email) {
        const res = await sendMessage({
          to: r.tenant_email,
          message: tenantRenewalNoticeEmail({
            propertyAddr: r.property_addr || "your property",
            endDate: endLabel,
            guaranteeRef: r.guarantee_ref,
          }),
        });
        if (res.ok) { emailed++; anySent = true; } else { emailFailed++; anyFailed = true; }
      }
      if (agentList.length) {
        const res = await sendMessage({ to: agentList, message });
        if (res.ok) { emailed++; anySent = true; } else { emailFailed++; anyFailed = true; }
      }
      // Names the rail's own vocabulary rather than "agent/landlord" for all
      // three, so the activity row on a direct guarantee stops implying an
      // agency was involved.
      const who = [
        r.tenant_email ? "tenant" : null,
        agentList.length ? `${agentList.length} on the referring side` : null,
      ].filter(Boolean).join(", ");
      // One activity entry per application. Partner-safe: names who and when.
      await service.from("activity_log").insert({
        application_id: r.application_id,
        kind: anySent ? "renewal_notice_sent" : "renewal_notice_failed",
        message: anySent
          ? `Renewal notice sent to the ${who}. Guarantee ends ${endLabel}.`
          : `Renewal notice could not be sent. Guarantee ends ${endLabel}.`,
        actor: "System",
        visibility: anySent ? "business" : "internal",
      });
      if (anyFailed && anySent) {
        await service.from("activity_log").insert({
          application_id: r.application_id, kind: "renewal_notice_failed",
          message: "One or more renewal-notice recipients could not be emailed.",
          actor: "System", visibility: "internal",
        });
      }
    }

    return json({ ok: true, test, date: pToday, due: due.length, emailed, emailFailed, parked: parkedCount });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Unexpected error." }, 500);
  }
});
