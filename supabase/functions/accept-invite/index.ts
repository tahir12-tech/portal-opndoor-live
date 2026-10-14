// =====================================================================
// accept-invite (verify_jwt = false, required)
//
// Redeems the portal's OWN seven-day staff invitation token and hands back a
// short-lived Supabase link that signs the invitee in long enough to choose a
// password and enrol their authenticator.
//
// WHY THIS FUNCTION EXISTS AT ALL. A GoTrue action link lives for
// `mailer_otp_exp`, which is ONE project-wide number shared with password
// resets, and the reset copy promises thirty minutes in three places. So the
// link in an invitation email is ours (`public.staff_invites`, seven days) and
// the GoTrue link is minted HERE, at the moment the person clicks, from
// nothing but a token we issued.
//
// AND IT IS A POST, WHICH IS THE OTHER HALF OF THE POINT. The old email
// carried a bare GET on /auth/v1/verify, so a mail gateway that pre-fetches
// links at delivery spent the invitation before the human read it, and they
// then saw "This link is not valid". A scanner fetching our link now loads a
// React page and nothing happens; the token is only spent by the POST this
// function answers.
//
// verify_jwt MUST be false: the caller has no session yet. That is the entire
// situation. The token is the credential, it is checked by
// claim_staff_invite under the service role, and a wrong one is refused with
// its own sentence rather than a generic failure.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { safeOrigin } from "../_shared/safeOrigin.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const b = await req.json().catch(() => ({}));
    const token = String(b.token ?? "").trim();

    /* SHAPE FIRST, so a malformed token is a refusal and not a database
       error. claim_staff_invite takes a uuid, and sending it anything else
       would surface Postgres's own cast message to somebody who is simply
       looking at a mangled link. */
    if (!UUID.test(token)) {
      return json({ ok: false, error: "That invitation link is not one we issued." }, 400);
    }

    const service = createClient(SUPABASE_URL, SERVICE);

    /* ONE CALL, AND IT SPENDS THE TOKEN. Expired, already used, cancelled and
       never issued each come back as their own sentence, which is the whole
       reason the refusals live in SQL: four states, four things to tell
       somebody, and only one of them means "ask for another". */
    const { data: claim, error: claimErr } = await service
      .rpc("claim_staff_invite", { p_token: token });
    if (claimErr) return json({ ok: false, error: claimErr.message }, 400);

    const row = Array.isArray(claim) ? claim[0] : claim;
    const email = String(row?.email ?? "").trim();
    if (!email) return json({ ok: false, error: "That invitation link is not one we issued." }, 400);

    /* THE TAB THIS PERSON SIGNS IN ON, carried exactly as invite-user carries
       it: our own estate and Opndoor's own staff on the Agent tab, a
       supplier's people on the Supplier tab. Read from the user rather than
       sent by the browser, because the browser at this point is a stranger
       holding a token. */
    const { data: who } = await service
      .from("users").select("partner_id").eq("id", row.user_id).maybeSingle();
    const { data: party } = who?.partner_id
      ? await service.from("partners").select("partner_kind").eq("id", who.partner_id).maybeSingle()
      : { data: null };
    const tab = !who?.partner_id || party?.partner_kind === "agency" ? "agent" : "supplier";

    const base = safeOrigin(req.headers.get("origin"));
    if (!base) return json({ ok: false, error: "This environment has no portal address configured." }, 500);
    const landing = `${base}/accept-invite?tab=${tab}`;

    /* THE SHORT-LIVED LINK, minted now. Recovery rather than invite: the
       account already exists, because invite-user created it when it issued
       the seven-day token. The same allow-list fallback invite-user uses, for
       the same reason: GoTrue matches redirectTo against the project's
       Redirect URLs and an entry without a wildcard stops matching once a
       query string is appended, and a cosmetic improvement to a tab must not
       be able to turn into nobody being able to accept an invitation. */
    let { data, error } = await service.auth.admin.generateLink({
      type: "recovery", email, options: { redirectTo: landing },
    });
    if (error) {
      const plain = await service.auth.admin.generateLink({
        type: "recovery", email, options: { redirectTo: `${base}/accept-invite` },
      });
      data = plain.data; error = plain.error;
    }
    if (error) return json({ ok: false, error: error.message }, 400);

    const link = data?.properties?.action_link;
    if (!link) return json({ ok: false, error: "We could not open your invitation. Please ask for a new one." }, 400);

    return json({ ok: true, link });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
