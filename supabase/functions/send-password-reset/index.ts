// =====================================================================
// send-password-reset (verify_jwt = false)
//
// One endpoint for BOTH the self-service Forgot-password flow and the admin
// Reset-password action. It generates a Supabase recovery link (admin API,
// service role, so GoTrue's own email is NOT sent) and delivers a branded
// Resend email carrying that link - redirected to the review address in this
// test build. The link lands on the app's /reset-password screen, which
// consumes the recovery token and sets the new password.
//
// Anonymous by design (password reset must work for a signed-out user). It
// responds ok whether or not the address belongs to a real account, so it never
// enumerates. It does NOT respond ok when the send itself failed: that is not a
// fact about the account, it is a fact about us, and hiding it behind the
// neutral answer is how a reset disappears with nothing to chase.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertEmailConfigured, EmailNotConfigured } from "../_shared/emailConfigured.ts";
import { safeOrigin } from "../_shared/safeOrigin.ts";
import { sendMessage } from "../_shared/mailer.ts";
import { passwordResetEmail } from "../_shared/emailTemplates.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    /* BEFORE ANYTHING ADDRESS-SPECIFIC. Without this, an unset RESEND_API_KEY
       makes sendMessage return ok:false with no network call, so the new 503
       would fire for real accounts and 200 for the rest, permanently and at
       whatever rate the caller likes: this endpoint has no limiter. Refusing
       up front makes a missing key one answer for every address. */
    assertEmailConfigured();

    const b = await req.json().catch(() => ({}));
    const email = String(b.email ?? "").trim().toLowerCase();
    // Allowlisted, not trusted: this value is appended to a URL that GoTrue
    // will redirect to, and it arrives from an unauthenticated caller.
    const audience = b.audience === "supplier" ? "supplier" : "agent";
    // Build the recovery redirect from the SERVER-configured APP_URL, not the
    // unauthenticated client-supplied origin, so a caller cannot point the
    // recovery link (and its token) at an address they control. GoTrue's own
    // redirect allowlist is the ultimate gate; this is defence in depth.
    /* Backlog B6. This preferred APP_URL and then fell back to the CALLER's
       origin, which its own comment three lines above said it did not do.
       verify_jwt is false on this function, so that fallback was reachable by
       anyone. safeOrigin allows APP_URL, or localhost when APP_URL is unset,
       and otherwise refuses -- a reset email nobody can use is better than
       one somebody else can. */
    const base = safeOrigin(b.origin);
    if (!base) return json({ ok: false, error: "Password reset is not configured." }, 503);

    // The response body is IDENTICAL in every non-error case, so it never
    // reveals whether an account exists (no enumeration). We still attempt the
    // send when the address is valid and known; the outcome is not disclosed.
    if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      const service = createClient(SUPABASE_URL, SERVICE);

      /* THE HASHED TOKEN, NOT THE ACTION LINK. THIS IS THE WHOLE FIX.
         Matt, 2026-10-13, after fourteen Regent invites died in twelve
         minutes: "our links verify the one-time token on page load
         (auth.opndoor.co/auth/v1/verify?token=...&type=invite), so the token
         is used up before the person clicks."

         `action_link` IS that verify URL. Anything that fetches it spends the
         token: a corporate mail scanner, a link preview, an antivirus proxy,
         a user's own browser prefetching. It is a GET that changes state,
         which is the oldest mistake on the web, and it is GoTrue's shape
         rather than ours.

         `hashed_token` is the same credential WITHOUT the endpoint. We put it
         in a URL of our own that does nothing when it is loaded, and the
         portal calls verifyOtp on a click. A scanner then fetches a React
         page and spends nothing.

         AND redirectTo IS GONE, which removes a live fragility rather than
         adding one. It existed only so GoTrue's own redirect would land on the
         right tab, and the allowlist does not match an entry once a query
         string is appended -- so this function carried a whole fallback, and
         a log line, for the case where asking for the tab made generateLink
         error and NO reset email went out at all. The tab now rides in our own
         URL, which no allowlist governs, so there is nothing left to be
         rejected. */
      const { data, error } = await service.auth.admin.generateLink({ type: "recovery", email });
      const hashed = (data?.properties as { hashed_token?: string } | undefined)?.hashed_token;

      // generateLink IS the existence check on this path, so a failure here is
      // usually "no such account" and must stay neutral. Logged, not disclosed.
      if (error || !hashed) {
        console.log(JSON.stringify({
          event: "reset_link_unavailable", message: error?.message ?? "no hashed_token returned",
        }));
        return json({ ok: true });
      }

      /* THE AUDIENCE STILL RIDES IN THE LINK, so an expired one returns
         somebody to the tab they started from rather than guessing Agent for
         every member of staff. Only the two staff audiences reach this
         endpoint; a tenant reset goes through tenant-auth and lands on
         /apply/reset. */
      const link = `${base}/auth/confirm?token_hash=${encodeURIComponent(hashed)}`
        + `&type=recovery&tab=${audience}`;

      const result = await sendMessage({ to: email, message: passwordResetEmail(link, "portal") });
      if (!result.ok) {
        // Was logged and then ignored, which answered ok on a send that failed.
        console.log(JSON.stringify({ event: "reset_send_failed", message: result.error }));
        return json({ ok: false, error: "We could not send that just now. Try again in a moment." }, 503);
      }
      console.log(JSON.stringify({ event: "reset_sent", redirected: result.redirected === true }));
    }
    return json({ ok: true });
  } catch (e) {
    // Named rather than folded into a 500, so a dev run can tell "email is
    // switched off here" from "the code is broken", same as tenant-auth.
    if (e instanceof EmailNotConfigured) {
      console.log(JSON.stringify({ event: "email_not_configured" }));
      return json({ ok: false, error: e.message, code: "email_not_configured" }, 503);
    }
    console.log(JSON.stringify({ event: "send_password_reset_error", message: String(e) }));
    return json({ ok: false, error: e instanceof Error ? e.message : "Unexpected error." }, 500);
  }
});
