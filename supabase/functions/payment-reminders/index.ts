// =====================================================================
// payment-reminders (verify_jwt = false)
//
// The scheduled daily job that chases UNPAID guarantor fees (stuck-at-Sent
// applications). pg_cron -> net.http_post, twice at 07:00 and 08:00 UTC to cover
// BST/GMT; this function self-gates to 08:00 Europe/London so the off-hour run
// no-ops. It reminds the tenant at 2, 5 and 9 days after the application was Sent
// while still unpaid, exactly once per threshold (fire_payment_reminders is
// idempotent), reusing the branded payment email + existing Checkout link. Each
// reminder is a business activity entry (written by the RPC); send failures are
// logged internal (never a raw provider error to partners). Redirected to the
// review address in this test build.
//
// Auth: the cron path presents x-reminders-secret == REMINDERS_CRON_SECRET. The
// manual TEST path presents a signed-in opndoor-admin JWT and body {test:true}
// (optional {date:'YYYY-MM-DD'}) so the job can be verified without waiting.
//
// Background: this cron did not exist before (only deed-EXPIRY reminders and a
// manual resend), which is why the "8am payment reminder" never delivered.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendMessage } from "../_shared/mailer.ts";
import { draftClosingEmail, feeBasisWeeksOf, paymentReminderEmail, type FeeCopy } from "../_shared/emailTemplates.ts";
import { titleCaseAddress } from "../_shared/text.ts";
import { timingSafeEqual } from "../_shared/partnerAuth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-reminders-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** 'YYYY-MM-DD' -> '4 October 2026', built from the parts so no timezone
    moves the day. The same shape renewal-notices uses for the same reason. */
function dmyLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(d);
}

function londonNow(): { hour: number; date: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour: "2-digit", hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { hour: Number(g("hour")), date: `${g("year")}-${g("month")}-${g("day")}` };
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

    // Cron auth: the presented x-reminders-secret must match the edge env OR the
    // ops_secrets mirror (resilient to a drifted/unset edge env; the crons pass the
    // Vault secret, which the mirror holds).
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

    // #13 Auto-expire unpaid Sent applications older than 14 days FIRST, so an
    // expired application is never also reminded. (fire_payment_reminders already
    // filters status='sent', so this only needs to run before it.)
    const { data: expiredCount } = await service.rpc("expire_stale_applications", { p_today: pToday });

    // Fire due reminders (idempotent). Returns only the NEW ones to email.
    const { data: fired, error: rpcErr } = await service.rpc("fire_payment_reminders", { p_today: pToday });
    if (rpcErr) {
      return json({ ok: false, error: "Could not run payment reminders." }, 500);
    }
    const due = (fired ?? []) as Array<{
      application_id: string; guarantee_ref: string; days: number;
      tenant_title: string | null; tenant_last_name: string | null; tenant_email: string | null;
      prop_addr1: string | null; prop_postcode: string | null; monthly_rent: number | null;
      // agency is agencies.name, joined on the application's agency_id: the name
      // the tenant actually dealt with, which is the only name the opening line
      // is allowed to use.
      fee_amount: number | null; payment_url: string | null; agency: string | null;
    }>;

    /* WHAT THE FEE IS MEASURED AGAINST, AND WHO DECIDED IT. Three facts the RPC
       does not return, fetched once for the whole batch rather than per nudge:
       they are properties of the application, and the loop below already spends a
       round trip each on the token and the send.

         referencing_mode  the APPLICATION's own snapshot, never its partner's.
                           Regent is pre_referenced_open under a partner that is
                           opndoor_referenced, so the partner's answer would have
                           a reminder tell a Regent tenant that opndoor decided
                           about them.
         share_amount      the share of RENT a joint applicant was assessed on.
                           Their fee is a share too, so the basis is only honest
                           measured share against share.
         refers_own_stock  the estate: true means one of our own agencies typed
                           this referral in, which is the agency-referral rail.

       The agency NAME is not selected again: the RPC row already carries it. */
    // The partner embed arrives as an object or as a one-element array depending
    // on how PostgREST resolves the relationship (payment-page unwraps both for
    // the same embed), so neither shape is assumed here.
    type PartnerEmbed = { refers_own_stock?: boolean | null };
    type CopyFacts = {
      id: string;
      referencing_mode: string | null;
      share_amount: number | null;
      agency_id: string | null;
      partner: PartnerEmbed | PartnerEmbed[] | null;
    };
    const ownStock = (p: CopyFacts["partner"]) =>
      (Array.isArray(p) ? p[0] : p)?.refers_own_stock === true;
    const facts = new Map<string, CopyFacts>();
    if (due.length) {
      const { data: factRows } = await service
        .from("applications")
        .select("id, referencing_mode, share_amount, agency_id, partner:partners(refers_own_stock)")
        .in("id", due.map((r) => r.application_id));
      for (const row of (factRows ?? []) as CopyFacts[]) facts.set(row.id, row);
    }

    const APP_URL = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
    let emailed = 0, emailFailed = 0;
    for (const r of due) {
      // WAS: monthly_rent, printed in a row labelled "Guarantee fee".
      //
      // The reminder chases a specific unpaid amount, so it has to name the
      // amount that is actually owed. fee_amount is what was charged, which is
      // no longer the rent wherever a three or five week basis was agreed, or
      // where this applicant is one of a joint tenancy paying a share. The rent
      // remains the fallback for rows predating the fee snapshot only.
      // fire_payment_reminders now returns fee_amount for exactly this.
      const fee = Number(r.fee_amount ?? r.monthly_rent ?? 0);
      const f = facts.get(r.application_id);
      // WAS: a figure and nothing to measure it against. The reminder printed
      // £692.31 in a row labelled "Guarantee fee" and said no more, so a Regent
      // tenant chased for three weeks of rent could not tell whether they were
      // being asked for a month, a share or the wrong number altogether. The basis
      // goes against the rent this fee was a proportion OF: a joint applicant's
      // own share, the whole rent for a sole tenant. Dividing a share of the fee
      // by the whole tenancy rent would report every joint tenant as discounted.
      const feeBasisWeeks = feeBasisWeeksOf(fee, f?.share_amount ?? r.monthly_rent);
      // WAS: "opndoor is acting as guarantor", to every tenant on every rail. On a
      // pre-referenced agency referral the AGENCY decided and arranged this, so the
      // agency is the subject and is named as the tenant knows it. Nudge 2 and 3
      // are read by somebody who has already hesitated once, which is the worst
      // place to misattribute the decision. Omitted entirely when the facts did not
      // come back, because today's approved wording is the safe answer: opndoor
      // referenced and the supplier rail both keep it anyway.
      const copy: FeeCopy | undefined = f
        ? {
            rail: !f.agency_id ? "direct" : ownStock(f.partner) ? "agency" : "supplier",
            referencingMode: f.referencing_mode,
            agencyName: (r.agency ?? "").trim() || null,
          }
        : undefined;
      // #1/#2 Point the reminder at the confirmation page with a per-touch utm_source.
      const { data: pageToken } = await service.rpc("mint_payment_page_token", { p_ref: r.guarantee_ref });
      // Never send a stale Stripe URL: if a fresh durable link cannot be minted,
      // skip this nudge and let the next run try again, rather than fall back to
      // the stored raw session URL that may be long expired.
      if (!pageToken || !APP_URL) {
        emailFailed += 1;
        console.log(JSON.stringify({ event: "reminder_skipped_no_token", ref: r.guarantee_ref }));
        continue;
      }
      const payUrl = `${APP_URL}/pay?token=${pageToken}&utm_source=reminder_${r.days}`;
      const res = await sendMessage({
        to: r.tenant_email ?? "",
        message: paymentReminderEmail({
          propertyAddr: [titleCaseAddress(r.prop_addr1), r.prop_postcode].filter(Boolean).join(", "),
          guaranteeRef: r.guarantee_ref,
          amount: `£${fee.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`,
          openUntilLabel: null, payUrl,
          nudge: (Number(r.days) <= 3 ? 1 : Number(r.days) <= 7 ? 2 : 3) as 1 | 2 | 3,
          feeBasisWeeks, copy,
        }),
      });
      if (res.ok) {
        emailed += 1;
      } else {
        emailFailed += 1;
        await service.from("activity_log").insert({
          application_id: r.application_id, kind: "payment_reminder_email_failed",
          message: `Payment reminder email not sent: ${res.error}`, actor: "System", visibility: "internal",
        });
      }
    }

    /* =====================================================================
       AND THE UNFINISHED APPLICATIONS NOBODY EVER CHASED.

       Matt, 2026-10-02: an unfinished DIRECT application closes after 30
       quiet days, and at 25 the tenant is told it will. It belongs in this
       job and not a new one: this is the daily "chase the tenant, then
       lapse what nobody answered" pass, it already runs expire ->
       remind in that order, and a second cron would be a second schedule
       and a second secret for the same subject.

       CLOSE FIRST, WARN SECOND, for the reason the line above gives about
       the fifteen-day sweep: a draft quiet for 40 days is past both
       thresholds, and warning first would email "this closes in 5 days"
       about something the same run is closing. Closed, it is no longer a
       draft and earns no warning.
       ===================================================================== */
    const { data: closedCount } = await service.rpc("expire_stale_drafts", { p_today: pToday });
    const { data: warnRows, error: warnErr } = await service.rpc("fire_draft_closing_notices", { p_today: pToday });
    if (warnErr) {
      // Never fails the run: the payment reminders above have already been
      // sent, and a broken warning must not make the cron look like it did
      // nothing. Logged where ops sees it.
      console.log(JSON.stringify({ event: "draft_closing_notices_failed", message: warnErr.message }));
    }
    const warnings = (warnRows ?? []) as Array<{
      application_id: string; guarantee_ref: string; tenant_email: string | null;
      prop_addr1: string | null; prop_postcode: string | null;
      days_quiet: number; closes_on: string;
    }>;
    let warned = 0, warnFailed = 0;
    for (const w of warnings) {
      const addr = [titleCaseAddress(w.prop_addr1), w.prop_postcode].filter(Boolean).join(", ");
      const res = await sendMessage({
        to: w.tenant_email ?? "",
        message: draftClosingEmail({
          guaranteeRef: w.guarantee_ref,
          // From the stored close date rather than 30 minus the threshold:
          // the first run after this ships meets drafts already quieter than
          // 25 days, whose real answer is one or two.
          daysLeft: Math.max(0, Math.round(
            (Date.parse(`${w.closes_on}T00:00:00Z`) - Date.parse(`${pToday}T00:00:00Z`)) / 86400000)),
          closesOnLabel: dmyLabel(w.closes_on),
          propertyAddr: addr || null,
          applyUrl: `${APP_URL}/apply?utm_source=closing_notice`,
        }),
      });
      if (res.ok) {
        warned += 1;
      } else {
        warnFailed += 1;
        await service.from("activity_log").insert({
          application_id: w.application_id, kind: "draft_closing_email_failed",
          message: `Closing notice not sent: ${res.error}`, actor: "System", visibility: "internal",
        });
      }
    }

    return json({
      ok: true, test, date: pToday, expired: expiredCount ?? 0, due: due.length, emailed, emailFailed,
      draftsClosed: closedCount ?? 0, draftsWarned: warned, draftWarnFailed: warnFailed,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error.";
    // #3 A total cron failure (a crash before it could log anything) still alerts
    // ops via report_ops_incident; deduped to one per hour in the database.
    try {
      const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await svc.rpc("report_ops_incident", { p_type: "cron_error:payment-reminders", p_detail: `payment-reminders: ${msg}` });
    } catch { /* never mask the original failure */ }
    return json({ ok: false, error: "Payment reminders could not be completed." }, 500);
  }
});
