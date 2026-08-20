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


/**
 * Where a link in an email is allowed to point.
 *
 * NEVER the caller's `origin`. This function is unauthenticated, so `origin`
 * is whatever the request body says, and every link built from it carries a
 * LIVE token. Trusting it means one unauthenticated request causes a genuine
 * opndoor email, from opndoor's own verified sender, to deliver a working
 * password-reset token to a host the attacker chose. That is account takeover
 * with a phishing page attached, and it needs no account and no secret.
 *
 * send-password-reset already got this right and says so in a comment
 * (send-password-reset/index.ts:35-38). I reintroduced the bug it warned about.
 *
 * APP_URL is server configuration and wins. Localhost is allowed so the journey
 * can be walked on a dev machine. Anything else returns null and the caller
 * sends nothing, because a reset email nobody can use is better than one
 * somebody else can.
 */
function safeOrigin(supplied: unknown): string | null {
  const configured = (Deno.env.get("APP_URL") ?? "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  const raw = String(supplied ?? "").trim().replace(/\/+$/, "");
  try {
    const u = new URL(raw);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return `${u.protocol}//${u.host}`;
  } catch { /* not a URL: refuse */ }
  return null;
}

/**
 * Per-address and per-caller throttling.
 *
 * The whole file was unauthenticated and unthrottled, which is what turned two
 * check-then-act races into practical attacks and left request_reset able to
 * mail a victim without limit. bump_rate_limit is the repo's own limiter
 * (20260703150645) and is a single atomic upsert, so it does not have the
 * problem the code table had.
 *
 * Returns false when the caller should be refused. The caller answers with its
 * NORMAL response in that case, never a distinct one, or the limiter becomes
 * the oracle the rest of this file is careful not to be.
 */
async function withinLimits(
  service: any, req: Request, action: string, email: string,
  perAddress: number, perCaller: number,
): Promise<boolean> {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const [a, b] = await Promise.all([
    service.rpc("bump_rate_limit", { p_key: `ta:${action}:e:${email}`, p_limit: perAddress, p_window_secs: 3600 }),
    service.rpc("bump_rate_limit", { p_key: `ta:${action}:i:${ip}`,    p_limit: perCaller,  p_window_secs: 3600 }),
  ]);
  return a.data === true && b.data === true;
}

/** Six digits, from the CSPRNG. Math.random here would be a guessable code. */
function sixDigits(): string {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return String(b[0] % 1_000_000).padStart(6, "0");
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function codeEmail(code: string, mins: number): string {
  return shell(
    `<p>Your opndoor confirmation code is:</p>
     <p style="margin:22px 0;font:800 34px/1 system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;letter-spacing:0.22em;color:${VALHALLA};">${code}</p>
     <p style="font-size:13px;color:#5b4d86;">It lasts ${mins} minutes and can be used once. If you did not ask for it, ignore this email and nothing happens.</p>
     <p style="font-size:13px;color:#5b4d86;"><strong>We will never ask you for this code.</strong> Not by phone, not by email, not by text.</p>`,
  );
}

/**
 * Issue a code and email it. Returns nothing useful on purpose: whether the
 * address exists, whether it was rate limited and whether the mail sent are all
 * invisible to the caller, so this cannot be used to find out who has an account.
 */
async function sendCode(service: any, email: string, purpose: "verify_email" | "sign_in") {
  const code = sixDigits();
  const { data: allowed } = await service.rpc("issue_email_code", {
    p_email: email, p_purpose: purpose, p_code_hash: await sha256Hex(code), p_ttl_minutes: 10,
  });
  if (allowed !== true) return;          // rate limited: silently do nothing
  await sendEmail({
    to: email,
    subject: `${code} is your opndoor confirmation code`,
    html: codeEmail(code, 10),
  });
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
    const origin = safeOrigin(body.origin);
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
      // Same answer whether refused or accepted, so the limiter is not an oracle.
      if (!(await withinLimits(service, req, "register", email, 5, 20))) {
        return json({ ok: true, sent: true });
      }
      if (!email || !email.includes("@")) return json({ ok: false, error: "Enter a valid email address." }, 400);
      if (password.length < 10) return json({ ok: false, error: "Use at least 10 characters." }, 400);

      // A staff address must never become a tenant account. The database would
      // refuse it anyway, via the mutual-exclusion triggers, but refusing here
      // gives a sentence a person can act on instead of a constraint violation.
      const { data: staff } = await service.from("users").select("id").eq("email", email).maybeSingle();
      if (staff) {
        return json({ ok: true, sent: true });   // same shape as success: no enumeration
      }

      const { data: existing } = await service.from("applicants").select("id").eq("email", email).maybeSingle();

      if (existing) {
        // Known address. Say nothing different, but send a "you already have an
        // account" email so a real person is not left confused by silence.
        if (!origin) {
          console.log(JSON.stringify({ event: "reset_link_suppressed", reason: "no safe origin" }));
          return json({ ok: true, sent: true });
        }
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

      // A CODE, not a link. A tenant applying on a laptop reads their email on a
      // phone, and a link then strands them on the wrong device. A code crosses
      // devices by being typed, which is the whole point of it.
      await sendCode(service, email, "verify_email");
      return json({ ok: true, sent: true });
    }

    if (action === "resend_verification") {
      if (email && !(await withinLimits(service, req, "resend", email, 5, 20))) {
        return json({ ok: true, sent: true });
      }
      // Answers identically whether or not the address is known, and whether or
      // not it was rate limited.
      if (email) {
        // Resending a SIGN-IN code must not mint one that could confirm an
        // unconfirmed address, so the purpose travels with the request and is
        // checked again at verify.
        const purpose = body.purpose === "sign_in" ? "sign_in" : "verify_email";
        const { data: ap } = await service.from("applicants").select("id").eq("email", email).maybeSingle();
        if (ap) await sendCode(service, email, purpose);
      }
      return json({ ok: true, sent: true });
    }

    if (action === "request_reset") {
      if (email && !(await withinLimits(service, req, "reset", email, 5, 20))) {
        return json({ ok: true, sent: true });
      }
      if (email) {
        const { data: ap } = await service.from("applicants").select("id").eq("email", email).maybeSingle();
        if (ap && origin) {
          const { data: link } = await service.auth.admin.generateLink({ type: "recovery", email });
          const hashed = (link?.properties as any)?.hashed_token ?? "";
          const href = `${origin}/apply/reset#token_hash=${hashed}&type=recovery`;
          await sendEmail({
            to: email,
            subject: "Set a new opndoor password",
            html: shell(`<p>Set a new password for your opndoor account.</p>${button(href, "Set a new password")}
              <p style="font-size:13px;color:#5b4d86;">If you did not ask for this, ignore it. Your password has not changed.</p>`),
          });
        }
      }
      return json({ ok: true, sent: true });
    }

    /* ---- exchanging a correct code for a session --------------------------
       The code proves the ADDRESS. It does not issue the session: that still
       comes from Supabase Auth, via a one-time token the browser redeems. So
       this table never becomes a second, weaker way of being logged in, and a
       leaked code cannot be replayed into a session by anything but the person
       holding the browser that asked for it. */
    /* ---- sign in, step one of two --------------------------------------
       THE PASSWORD IS CHECKED HERE, ON THE SERVER, and the session it produces
       is thrown away. That is the whole point: if the browser were handed a
       session first and then asked for a code, the code would be decoration,
       because the session already works. The only thing that reaches the client
       is { ok: true }, and a session exists only after verify_code.

       A tenant gets an emailed code rather than an authenticator app. Staff
       enrol TOTP because they sign in daily; a tenant signs in a handful of
       times and would be locked out by a lost phone. */
    if (action === "signin_start") {
      const password = String(body.password ?? "");
      if (!email || !password) {
        return json({ ok: false, error: "That email address and password do not match." }, 401);
      }

      if (!(await withinLimits(service, req, "signin", email, 10, 60))) {
        // A refusal reads as the normal outcome, so a caller cannot use the
        // rate limiter to learn that an address exists.
        return json({ ok: true });
      }

      const anon = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!);
      const { data: signed, error: pwErr } = await anon.auth.signInWithPassword({ email, password });

      // One message for a wrong password and an unknown address, exactly as the
      // single-step version had, so this adds no oracle.
      if (pwErr || !signed?.user) {
        return json({ ok: false, error: "That email address and password do not match." }, 401);
      }

      // Discard it. Nothing may survive this request that could be replayed.
      await anon.auth.signOut();

      // Staff must not be able to sign in through the tenant door. A tenant is
      // an applicant; a users row is staff and belongs on /login with TOTP.
      const { data: ap } = await service.from("applicants").select("id").eq("id", signed.user.id).maybeSingle();
      if (!ap) {
        return json({ ok: false, error: "That email address and password do not match." }, 401);
      }

      await sendCode(service, email, "sign_in");
      return json({ ok: true });
    }

    if (action === "verify_code") {
      const code = String(body.code ?? "").replace(/\D/g, "");
      if (!email || code.length !== 6) {
        return json({ ok: false, error: "That code is not right. Check it and try again." }, 400);
      }

      // The address-scoped cap the code row enforces is per code; this is the
      // ceiling across codes, and the per-caller tier is what stops one attacker
      // spreading guesses over many addresses.
      if (!(await withinLimits(service, req, "verify", email, 20, 100))) {
        return json({ ok: false, error: "Too many attempts. Wait a little and ask for a new code." }, 429);
      }

      // Which code this is. A registration code must not sign somebody in and a
      // sign-in code must not confirm an address, so the purpose is part of what
      // is verified rather than assumed.
      const purpose = body.purpose === "sign_in" ? "sign_in" : "verify_email";

      const { data: ok } = await service.rpc("verify_email_code", {
        p_email: email, p_purpose: purpose, p_code_hash: await sha256Hex(code),
      });
      // One message for wrong, expired, exhausted and never-issued. Telling the
      // difference is telling an attacker where they are.
      if (ok !== true) {
        return json({ ok: false, error: "That code is not right, or it has expired. Ask for a new one." }, 401);
      }

      const { data: ap } = await service.from("applicants").select("id").eq("email", email).maybeSingle();
      if (!ap) return json({ ok: false, error: "That code is not right, or it has expired. Ask for a new one." }, 401);

      // Registration only: the address is proven, so confirm it. A sign-in code
      // proves possession of an address that was already confirmed, and using it
      // to confirm one would let an unconfirmed account slip through.
      if (purpose === "verify_email") {
        await service.auth.admin.updateUserById(ap.id, { email_confirm: true });
      }

      const { data: link, error: linkErr } = await service.auth.admin.generateLink({ type: "magiclink", email });
      const hashed = (link?.properties as any)?.hashed_token ?? "";
      if (linkErr || !hashed) {
        console.log(JSON.stringify({ event: "verify_code_session_failed", message: linkErr?.message }));
        return json({ ok: false, error: "Could not sign you in. Try signing in with your password." }, 500);
      }
      return json({ ok: true, token_hash: hashed });
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
