// =====================================================================
// send-mfa-reset-notice (verify_jwt = true, which is the default)
//
// Tells somebody that an administrator has reset their two-factor.
//
// Matt, 2026-10-01: 'Two-factor reset email: add "Delete the old opndoor
// entry from your authenticator app before scanning the new code."'
//
// THERE WAS NO SUCH EMAIL. admin_reset_user_mfa destroys every factor and
// every session and writes an audit row; nothing told the person. From
// their side a reset was indistinguishable from being attacked: signed out
// everywhere, authenticator dead, no explanation.
//
// THE BROWSER NEVER NOMINATES THE ADDRESS. It sends a USER ID;
// authorise_mfa_reset_notice judges the caller against the same ladder
// admin_reset_user_mfa does and hands back the address it holds. An
// endpoint that emails whoever it is handed is a spam relay with
// opndoor.co on it. Same shape as send-password-reset's admin arm, and
// for the same reason.
//
// verify_jwt STAYS ON, unlike send-password-reset: that one is anonymous
// because a signed-out person must be able to reset their own password.
// This one is only ever called by a signed-in administrator who has just
// pressed a button, so there is nothing to make anonymous.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertEmailConfigured, EmailNotConfigured } from "../_shared/emailConfigured.ts";
import { sendMessage } from "../_shared/mailer.ts";
import { twoFactorResetEmail } from "../_shared/emailTemplates.ts";

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
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Before anything address-specific, as send-password-reset does.
    assertEmailConfigured();

    const auth = req.headers.get("Authorization") ?? "";
    if (!auth) return json({ ok: false, error: "Not signed in." }, 401);

    const body = await req.json().catch(() => ({}));
    const user = String(body?.user ?? "").trim();
    if (!user) return json({ ok: false, error: "No user given." }, 400);

    /* AS THE CALLER, NOT AS THE SERVICE. The whole point of the authoriser
       is that it reads auth.uid(); calling it with the service key would
       make it answer for nobody and admit everybody. */
    const asCaller = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const { data: address, error: authErr } = await asCaller.rpc("authorise_mfa_reset_notice", { p_user: user });
    if (authErr) return json({ ok: false, error: authErr.message }, 403);
    if (!address) return json({ ok: false, error: "No address for that user." }, 400);

    /* WHO DID IT, FOR THE SENTENCE. Read with the service key because the
       caller may not be able to read their own row through RLS on every
       rail, and a missing name only costs the email a clause. */
    let actorName: string | null = null;
    /* (bm) AND WHETHER IT WAS US. The authoriser admits an admin OR the
       party's own management, so this email is as often from a reader's
       own Director as from opndoor -- and it used to tell them their
       Director was "at opndoor". Asked of is_opndoor_staff() as the
       CALLER, because that is the question it answers. */
    let byOpndoor = false;
    try {
      const service = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
      const { data: me } = await asCaller.auth.getUser();
      if (me?.user?.id) {
        const { data: row } = await service.from("users").select("full_name").eq("id", me.user.id).maybeSingle();
        actorName = (row?.full_name as string) ?? null;
      }
      const { data: staff } = await asCaller.rpc("is_opndoor_staff");
      byOpndoor = staff === true;
    } catch { /* the template has a line for when nobody is named */ }

    const res = await sendMessage({ to: String(address), message: twoFactorResetEmail({ actorName, byOpndoor }) });
    /* A FAILED SEND IS REPORTED, not swallowed. The RESET already happened
       and is not undone by this: the caller treats a failure here as "the
       reset worked, the email did not", which is what the toast says. */
    if (!res.ok) return json({ ok: false, error: res.error ?? "Could not send the email." }, 502);
    return json({ ok: true, to: res.to, redirected: res.redirected });
  } catch (e) {
    if (e instanceof EmailNotConfigured) return json({ ok: false, error: e.message }, 503);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
