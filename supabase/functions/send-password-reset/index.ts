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

    const b = await req.json().catch(() => ({}));
    const email = String(b.email ?? "").trim().toLowerCase();
    // Build the recovery redirect from the SERVER-configured APP_URL, not the
    // unauthenticated client-supplied origin, so a caller cannot point the
    // recovery link (and its token) at an address they control. GoTrue's own
    // redirect allowlist is the ultimate gate; this is defence in depth.
    const base = String(Deno.env.get("APP_URL") ?? b.origin ?? "").replace(/\/$/, "");

    // The response body is IDENTICAL in every non-error case, so it never
    // reveals whether an account exists (no enumeration). We still attempt the
    // send when the address is valid and known; the outcome is not disclosed.
    if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      const service = createClient(SUPABASE_URL, SERVICE);
      const { data, error } = await service.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo: `${base}/reset-password` },
      });
      const link = data?.properties?.action_link as string | undefined;

      // generateLink IS the existence check on this path, so a failure here is
      // usually "no such account" and must stay neutral. Logged, not disclosed.
      if (error || !link) {
        console.log(JSON.stringify({
          event: "reset_link_unavailable", message: error?.message ?? "no action_link returned",
        }));
        return json({ ok: true });
      }

      const result = await sendMessage({ to: email, message: passwordResetEmail(link) });
      if (!result.ok) {
        // Was logged and then ignored, which answered ok on a send that failed.
        console.log(JSON.stringify({ event: "reset_send_failed", message: result.error }));
        return json({ ok: false, error: "We could not send that just now. Try again in a moment." }, 503);
      }
      console.log(JSON.stringify({ event: "reset_sent", redirected: result.redirected === true }));
    }
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Unexpected error." }, 500);
  }
});
