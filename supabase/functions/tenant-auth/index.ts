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
import { assertEmailConfigured, EmailNotConfigured } from "../_shared/emailConfigured.ts";
import { sendMessage } from "../_shared/mailer.ts";
import { accountExistsEmail, codeEmail, passwordResetEmail } from "../_shared/emailTemplates.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const VALHALLA = "#271d5f";
const HELIOTROPE = "#d364fb";



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
  return (await limitCheck(service, req, action, email, perAddress, perCaller)).ok;
}

/**
 * The same check, but it also says HOW LONG.
 *
 * "Wait a little" gives somebody nothing to act on, and the number is already
 * sitting in the row: the window is fixed at an hour from the first attempt, so
 * window_start + 1 hour is the exact moment it clears. Reading it costs one
 * select on a path that has already decided to refuse.
 *
 * Only callers that already disclose should use the minutes. A neutral refusal
 * that suddenly reports a countdown has started telling the caller something.
 */
async function limitCheck(
  service: any, req: Request, action: string, email: string,
  perAddress: number, perCaller: number,
): Promise<{ ok: boolean; minutes: number }> {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const keys = [`ta:${action}:e:${email}`, `ta:${action}:i:${ip}`];
  const [a, b] = await Promise.all([
    service.rpc("bump_rate_limit", { p_key: keys[0], p_limit: perAddress, p_window_secs: 3600 }),
    service.rpc("bump_rate_limit", { p_key: keys[1], p_limit: perCaller,  p_window_secs: 3600 }),
  ]);
  const ok = a.data === true && b.data === true;
  if (ok) return { ok: true, minutes: 0 };

  // The longest wait across whichever counters are blocking, rounded up, and
  // never zero: "try again in 0 minutes" is worse than saying nothing.
  const { data: rows } = await service.from("rate_limit").select("window_start").in("key", keys);
  const now = Date.now();
  const mins = (rows ?? []).map((r: { window_start: string }) =>
    Math.ceil((new Date(r.window_start).getTime() + 3600_000 - now) / 60_000));
  return { ok: false, minutes: Math.max(1, ...(mins.length ? mins : [1])) };
}

/** "in 5 minutes", or "in a minute" when that is what it is. */
function inMinutes(m: number): string {
  return m <= 1 ? "in a minute" : `in ${m} minutes`;
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


/**
 * Issue a code and email it. Returns nothing useful on purpose: whether the
 * address exists, whether it was rate limited and whether the mail sent are all
 * invisible to the caller, so this cannot be used to find out who has an account.
 */
async function sendCode(service: any, email: string, purpose: "verify_email" | "sign_in") {
  // Refuse before minting a code. A code issued and never delivered burns one
  // of the caller's five per hour and locks them out of a retry.
  assertEmailConfigured();

  const code = sixDigits();
  const { data: allowed } = await service.rpc("issue_email_code", {
    p_email: email, p_purpose: purpose, p_code_hash: await sha256Hex(code), p_ttl_minutes: 10,
  });
  if (allowed !== true) return;          // rate limited: silently do nothing

  const res = await sendMessage({ to: email, message: codeEmail(code, 10) });
  // The result used to be dropped here and the caller answered ok either way.
  if (!res.ok) {
    console.log(JSON.stringify({ event: "code_email_failed", purpose, message: res.error }));
    throw new Error(res.error ?? "The confirmation code could not be sent.");
  }
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
      // AT THE TOP, before anything is created. The first version of this
      // asserted inside sendCode, which runs AFTER the auth user and the
      // applicant row exist, so a 503 left an account behind that could never
      // be verified and whose error message said it had done nothing. That is
      // the exact "fail at the boundary" rule emailConfigured.ts states, broken
      // in the first place it was used.
      assertEmailConfigured();

      const password = String(body.password ?? "");
      // Same answer whether refused or accepted, so the limiter is not an oracle.
      // THE LIMIT IS NOW THE WHOLE DEFENCE, so it refuses honestly rather than
      // impersonating success. This endpoint discloses whether an address is
      // registered, a deliberate trade for a clearer signup, and that turns the
      // per-caller cap from a nuisance control into the thing standing between
      // a curious person and a list. Ten an hour is enough to sign up, mistype
      // twice and try again; it is useless for testing a list of addresses.
      const regLimit = await limitCheck(service, req, "register", email, 5, 10);
      if (!regLimit.ok) {
        return json({
          ok: false,
          error: `Too many attempts from here. Try again ${inMinutes(regLimit.minutes)}.`,
          code: "rate_limited",
          retry_after_minutes: regLimit.minutes,
        }, 429);
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
        // KNOWN ADDRESS, AND WE SAY SO. This used to answer identically to a
        // successful signup, which kept the address private and left a real
        // person staring at a code box waiting for a code that was never sent.
        // Matt's call: tell them, and accept that it makes registration an
        // enumeration oracle. The rate limit above is what keeps that from
        // being useful in bulk.
        //
        // The email still goes out. It is what tells the real owner that
        // somebody tried, which the on-screen message cannot do.
        if (!origin) {
          console.log(JSON.stringify({ event: "reset_link_suppressed", reason: "no safe origin" }));
          return json({ ok: true, exists: true });
        }
        const { data: link } = await service.auth.admin.generateLink({ type: "recovery", email });
        const href = `${origin}/apply/reset#${(link?.properties as any)?.hashed_token ? `token_hash=${(link!.properties as any).hashed_token}&type=recovery` : ""}`;
        await sendMessage({
          to: email,
          message: { ...accountExistsEmail(), action: { label: "Set a new password", href } },
        });
        return json({ ok: true, exists: true });
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
      //
      // A SEND FAILURE DOES NOT UNDO THE ACCOUNT. The account is real and the
      // address is theirs; only the delivery failed. Deleting it would send them
      // back to a form that then tells them the email is taken, which is the
      // worse outcome and is not recoverable from the outside.
      //
      // So the account stands, the caller is told the code did not go, and the
      // verification screen offers another. Codes expire and mail lands in spam,
      // so that path is needed anyway and this is just its first use.
      let codeSent = true;
      let sendError: string | null = null;
      try {
        await sendCode(service, email, "verify_email");
      } catch (e) {
        codeSent = false;
        sendError = e instanceof Error ? e.message : "The code could not be sent.";
        console.log(JSON.stringify({ event: "register_code_send_failed", message: sendError }));
      }
      return json({
        ok: true,
        sent: codeSent,
        ...(codeSent ? {} : { error: sendError }),
      });
    }

    if (action === "resend_verification") {
      assertEmailConfigured();
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
      // This action's only deliverable is an email. Refuse before minting a
      // recovery token that nobody will ever receive.
      assertEmailConfigured();
      if (email && !(await withinLimits(service, req, "reset", email, 5, 20))) {
        return json({ ok: true, sent: true });
      }
      if (email) {
        const { data: ap } = await service.from("applicants").select("id").eq("email", email).maybeSingle();
        if (ap && origin) {
          const { data: link } = await service.auth.admin.generateLink({ type: "recovery", email });
          const hashed = (link?.properties as any)?.hashed_token ?? "";
          const href = `${origin}/apply/reset#token_hash=${hashed}&type=recovery`;
          await sendMessage({ to: email, message: passwordResetEmail(href) });
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
      const vLimit = await limitCheck(service, req, "verify", email, 20, 100);
      if (!vLimit.ok) {
        return json({
          ok: false,
          error: `Too many attempts. Try again ${inMinutes(vLimit.minutes)}, or ask for a new code.`,
          retry_after_minutes: vLimit.minutes,
        }, 429);
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
    // Named, not swallowed into "Something went wrong". The whole point of the
    // hard error is that a dev run can tell "email is switched off here" from
    // "your code is broken", which a generic 500 cannot.
    if (e instanceof EmailNotConfigured) {
      console.log(JSON.stringify({ event: "email_not_configured" }));
      return json({ ok: false, error: e.message, code: "email_not_configured" }, 503);
    }
    console.log(JSON.stringify({ event: "tenant_auth_error", message: String(e) }));
    return json({ ok: false, error: "Something went wrong." }, 500);
  }
});
