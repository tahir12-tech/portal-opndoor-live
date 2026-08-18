// =====================================================================
// tenant-auth  (verify_jwt = false)
//
// The front door. Everything here is callable WITHOUT a session, because that
// is the point: prequalifying, registering, verifying an address, asking for a
// reset and reading an invite all happen before anybody is signed in.
//
// WHY AN EDGE FUNCTION AND NOT supabase.auth.signUp FROM THE BROWSER
// Three reasons, and the third is the one that decides it.
//   1. An applicant row has to exist alongside the auth user, and a browser
//      cannot write one: applicants has no RLS policies by design.
//   2. Verification email has to be the branded one this system already sends
//      through its own provider, not the platform default, or a tenant gets a
//      differently-branded email from an unfamiliar sender at the one moment
//      they are deciding whether to trust us.
//   3. signUp leaks whether an address is already registered. The register
//      action below answers identically whether it created an account or not,
//      and sends a different email in each case.
//
// EVERYTHING IS DELIBERATELY NON-ENUMERATING. register, request_reset and
// resend_verification all return the same shape for a known and an unknown
// address. The user is told to check their email either way.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail } from "../create-referral/email.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const VALHALLA = "#271d5f";
const HELIOTROPE = "#d364fb";

function shell(inner: string): string {
  return `<div style="font:400 15px/1.6 system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:${VALHALLA};max-width:560px;">${inner}</div>`;
}
function button(href: string, label: string): string {
  return `<p style="margin:22px 0;"><a href="${href}" style="display:inline-block;background:${HELIOTROPE};color:#fff;text-decoration:none;font-weight:700;padding:13px 28px;border-radius:999px;">${label}</a></p>
  <p style="font-size:12px;color:#5b4d86;">If the button does not work, copy this into your browser:<br><span style="word-break:break-all;">${href}</span></p>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Use POST." }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const service = createClient(SUPABASE_URL, SERVICE);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const origin = String(body.origin ?? "").replace(/\/+$/, "");
    const email = String(body.email ?? "").trim().toLowerCase();

    /* ---- the free prequalification, before any account ------------------
       No session, no payment, no record kept. It answers from what somebody
       typed into four boxes and cannot see a credit file, which is why the
       outcome is never "you qualify". */
    if (action === "prequalify") {
      const rent = Number(body.monthly_rent);
      const income = Number(body.annual_income);
      const isStudent = body.is_student === true || body.is_student === "yes";
      if (!Number.isFinite(rent) || rent <= 0) return json({ ok: false, error: "Tell us the monthly rent." }, 400);

      const { data, error } = await service.rpc("assess_eligibility", {
        p_monthly_rent: rent,
        p_share_amount: Number.isFinite(Number(body.share_amount)) && Number(body.share_amount) > 0
          ? Number(body.share_amount) : null,
        p_credit_score: null,                     // we have none, and never will at this point
        p_annual_income: Number.isFinite(income) ? income : null,
        p_is_student: isStudent,
      });
      if (error) return json({ ok: false, error: "Could not check that." }, 500);
      const r = Array.isArray(data) ? data[0] : data;
      return json({
        ok: true,
        outcome: r?.outcome ?? null,
        reason: r?.reason ?? null,
        rent_basis: r?.rent_basis ?? null,
        income_needed_monthly: r?.income_needed ?? null,
        // Passed straight through so the copy can say what was and was not
        // considered. Adverse credit is recorded and does NOT rule anybody out.
        declared_adverse_credit: body.adverse_credit === true || body.adverse_credit === "yes",
      });
    }

    /* ---- register ------------------------------------------------------- */
    if (action === "register") {
      const password = String(body.password ?? "");
      if (!email || !email.includes("@")) return json({ ok: false, error: "Enter a valid email address." }, 400);
      if (password.length < 10) return json({ ok: false, error: "Use at least 10 characters." }, 400);

      // A staff address must never become a tenant account. The database would
      // refuse it anyway, via the mutual-exclusion triggers, but refusing here
      // gives a sentence a person can act on instead of a constraint violation.
      const { data: staff } = await service.from("users").select("id").ilike("email", email).maybeSingle();
      if (staff) {
        return json({ ok: true, sent: true });   // same shape as success: no enumeration
      }

      const { data: existing } = await service.from("applicants").select("id").ilike("email", email).maybeSingle();

      if (existing) {
        // Known address. Say nothing different, but send a "you already have an
        // account" email so a real person is not left confused by silence.
        const { data: link } = await service.auth.admin.generateLink({ type: "recovery", email });
        const href = `${origin}/apply/reset#${(link?.properties as any)?.hashed_token ? `token_hash=${(link!.properties as any).hashed_token}&type=recovery` : ""}`;
        await sendEmail({
          to: email,
          subject: "You already have an opndoor account",
          html: shell(`<p>Somebody, probably you, tried to create an opndoor account with this address. You already have one.</p>
            <p>If you have forgotten your password, you can set a new one:</p>${button(href, "Set a new password")}
            <p style="font-size:13px;color:#5b4d86;">If this was not you, you can ignore this email. Nothing has changed.</p>`),
        });
        return json({ ok: true, sent: true });
      }

      const { data: created, error: cErr } = await service.auth.admin.createUser({
        email, password, email_confirm: false,
      });
      if (cErr || !created?.user) {
        console.log(JSON.stringify({ event: "tenant_register_failed", message: cErr?.message }));
        return json({ ok: false, error: "Could not create the account." }, 500);
      }

      const { error: aErr } = await service.rpc("upsert_applicant", {
        p_id: created.user.id, p_email: email,
        p_title: String(body.title ?? "") || null,
        p_first: String(body.first_name ?? "").trim(),
        p_last: String(body.last_name ?? "").trim(),
        p_dob: body.dob ?? null,
        p_phone: String(body.phone ?? "") || null,
      });
      if (aErr) {
        // Roll the auth user back. An auth identity with no applicant row is a
        // login that reaches nothing and cannot be recovered from the outside.
        await service.auth.admin.deleteUser(created.user.id);
        console.log(JSON.stringify({ event: "tenant_applicant_failed", message: aErr.message }));
        return json({ ok: false, error: "Could not create the account." }, 500);
      }

      const { data: link } = await service.auth.admin.generateLink({ type: "signup", email, password });
      const hashed = (link?.properties as any)?.hashed_token ?? "";
      const href = `${origin}/apply/verify#token_hash=${hashed}&type=signup${body.invite ? `&invite=${encodeURIComponent(String(body.invite))}` : ""}`;
      await sendEmail({
        to: email,
        subject: "Confirm your email address",
        html: shell(`<p>Thanks for starting an opndoor guarantor application.</p>
          <p>Confirm this address and we will take you straight to your application.</p>${button(href, "Confirm my email")}
          <p style="font-size:13px;color:#5b4d86;">This link lasts 24 hours. If you did not start an application you can ignore this email.</p>`),
      });
      return json({ ok: true, sent: true });
    }

    if (action === "resend_verification" || action === "request_reset") {
      if (!email) return json({ ok: true, sent: true });
      const { data: ap } = await service.from("applicants").select("id").ilike("email", email).maybeSingle();
      if (ap) {
        const type = action === "request_reset" ? "recovery" : "signup";
        const { data: link } = await service.auth.admin.generateLink({ type: type as "recovery" | "signup", email });
        const hashed = (link?.properties as any)?.hashed_token ?? "";
        const path = action === "request_reset" ? "reset" : "verify";
        const href = `${origin}/apply/${path}#token_hash=${hashed}&type=${type}`;
        await sendEmail({
          to: email,
          subject: action === "request_reset" ? "Set a new opndoor password" : "Confirm your email address",
          html: shell(action === "request_reset"
            ? `<p>Set a new password for your opndoor account.</p>${button(href, "Set a new password")}<p style="font-size:13px;color:#5b4d86;">If you did not ask for this, ignore it. Your password has not changed.</p>`
            : `<p>Confirm your email address to continue your application.</p>${button(href, "Confirm my email")}`),
        });
      }
      // Identical answer whether or not the address is known.
      return json({ ok: true, sent: true });
    }

    /* ---- invites -------------------------------------------------------- */
    if (action === "invite_info") {
      const { data } = await service.rpc("tenant_invite_summary", { p_token: String(body.token ?? "") });
      const r = Array.isArray(data) ? data[0] : data;
      if (!r) return json({ ok: false, error: "This link is not valid." }, 404);
      return json({ ok: true, ...r });
    }

    return json({ ok: false, error: "Unknown action." }, 400);
  } catch (e) {
    console.log(JSON.stringify({ event: "tenant_auth_error", message: String(e) }));
    return json({ ok: false, error: "Something went wrong." }, 500);
  }
});
