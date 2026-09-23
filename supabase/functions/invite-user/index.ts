// =====================================================================
// invite-user (verify_jwt = true)
//
// Creates (or re-invites) a portal user and sends a BRANDED invite email via
// Resend, redirected to the review address in this test build. Same pattern as
// send-password-reset: the recovery/invite link is generated server-side (admin
// API, service role, so GoTrue's own mailer is NOT used) and delivered by our
// template. The link lands on /accept-invite, where the invitee sets a password
// and is handed into TOTP enrolment.
//
// Authorisation mirrors the Add-user UI: opndoor admins may invite any role
// (superadmins land under opndoor, everyone else under a named partner);
// management may invite referrers/managers into THEIR OWN partner only.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendMessage } from "../_shared/mailer.ts";
import { staffInviteEmail } from "../_shared/emailTemplates.ts";
import { placeOrRollback } from "../_shared/placeOrRollback.ts";

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
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ ok: false, error: "Not authenticated." }, 401);

    const b = await req.json().catch(() => ({}));
    const email = String(b.email ?? "").trim().toLowerCase();
    const role = String(b.role ?? "");
    const firstName = String(b.firstName ?? "").trim();
    const lastName = String(b.lastName ?? "").trim();
    const partnerSlug = String(b.partner ?? "").trim();
    const branchId = String(b.branch ?? "").trim();
    // Optional org position to grant on creation, so a brand/group manager (or a
    // branch manager) is placed the moment they are invited rather than in a second
    // step on the Users screen. '' = none (e.g. a negotiator, placed by home branch).
    const scopeKind = String(b.scopeKind ?? "").trim();
    const scopeTarget = String(b.scopeTarget ?? "").trim();
    const base = String(Deno.env.get("APP_URL") ?? b.origin ?? "").replace(/\/$/, "");

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: "A valid email address is required." }, 400);
    // 'developer' was missing here while the User Management screen offered it
    // as a full option with a written description. The screen and the server
    // disagreed, so every agency wanting an API key needed opndoor to run SQL.
    if (!["superadmin", "management", "referrer", "developer", "opndoor_manager"].includes(role)) {
      return json({ ok: false, error: "Invalid role." }, 400);
    }

    // Caller-scoped client: identify + authorise the inviter.
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    const callerId = userData.user?.id;
    if (!callerId) return json({ ok: false, error: "Not authenticated." }, 401);
    const { data: caller } = await userClient.from("users").select("role, partner_id, full_name").eq("id", callerId).maybeSingle();
    if (!caller) return json({ ok: false, error: "Not permitted." }, 403);

    const service = createClient(SUPABASE_URL, SERVICE);

    // Resolve the invitee's partner + enforce who may invite whom.
    let inviteePartnerId: string | null = null;
    let callerScoped = false;   // set for a management caller who holds a position
    if (caller.role === "superadmin") {
      // superadmin and opndoor_manager are Opndoor staff: no partner (the
      // users_partner_by_role CHECK requires their partner_id to be null). Only a
      // superadmin can create an opndoor_manager; a management caller's allowlist
      // below excludes it.
      if (role !== "superadmin" && role !== "opndoor_manager") {
        const { data: p } = await service.from("partners").select("id").eq("slug", partnerSlug).maybeSingle();
        if (!p?.id) return json({ ok: false, error: "Select a valid partner for this user." }, 400);
        inviteePartnerId = p.id;
      }
    } else if (caller.role === "management") {
      // ---- the agency's own ladder ------------------------------------------
      //
      // An agency manages its own people: a director invites a branch manager,
      // a branch manager invites a negotiator, without opndoor doing it. What
      // somebody may grant follows their POSITION, not just their role, because
      // "management" covers a head office and a single branch manager and those
      // are not the same authority.
      //
      // Read through the caller-scoped client on purpose: user_scopes' own
      // policy decides what they can see of their scope, so this cannot be used
      // to discover somebody else's.
      const { data: scopes } = await userClient
        .from("user_scopes").select("kind").eq("user_id", callerId);
      const kinds = new Set((scopes ?? []).map((r: { kind: string }) => r.kind));
      callerScoped = kinds.size > 0;

      // No position at all is the pre-existing case: a partner-wide manager,
      // which is what management has always meant. They keep exactly what they
      // had, plus developer, which the screen already claimed they could grant.
      const isBranchOnly = kinds.size > 0 && !kinds.has("group") && !kinds.has("agency");

      const allowed = isBranchOnly
        // A branch manager staffs their branches. They cannot create another
        // manager, and they certainly cannot create a key-minting developer:
        // both would be a way to climb out of the branch they were given.
        ? ["referrer"]
        : ["referrer", "management", "developer"];

      if (!allowed.includes(role)) {
        return json({
          ok: false,
          error: isBranchOnly
            ? "Branch managers may invite negotiators only."
            : "Managers may invite negotiators, managers or developers.",
        }, 403);
      }
      inviteePartnerId = caller.partner_id ?? null;
    } else {
      return json({ ok: false, error: "Not permitted." }, 403);
    }

    const fullName = `${firstName} ${lastName}`.trim() || email;

    // Record the negotiator's home branch, so the scoped manager who invited them
    // sees them from day one (before any referral). branches_select is already
    // narrowed to the caller's position, so a row returned through the caller-scoped
    // client is proof the caller may place a negotiator at that branch. A scoped
    // manager MUST place them, or the new user would vanish from their Users screen
    // until they refer.
    let homeBranchId: string | null = null;
    if (role === "referrer") {
      if (branchId) {
        const { data: br } = await userClient.from("branches").select("id, partner_id").eq("id", branchId).maybeSingle();
        if (!br || br.partner_id !== inviteePartnerId) {
          return json({ ok: false, error: "Choose a branch within your remit for this negotiator." }, 400);
        }
        homeBranchId = br.id;
      } else if (callerScoped) {
        return json({ ok: false, error: "Choose the branch this negotiator will work at." }, 400);
      }
    }

    // A position to grant on creation must sit within the invitee's own partner.
    // The grant itself is authorised by set_user_scope (the positions ladder),
    // called as the inviter after the account exists; here we only fail fast on a
    // malformed level or a cross-partner target before creating anything.
    if (scopeKind) {
      if (!["group", "agency", "branch"].includes(scopeKind)) return json({ ok: false, error: "Invalid position level." }, 400);
      if (!scopeTarget) return json({ ok: false, error: "Choose the group, brand or branch for this position." }, 400);
      const tbl = scopeKind === "group" ? "agency_groups" : scopeKind === "agency" ? "agencies" : "branches";
      const { data: node } = await service.from(tbl).select("partner_id").eq("id", scopeTarget).maybeSingle();
      if (!node || node.partner_id !== inviteePartnerId) {
        return json({ ok: false, error: "That group, brand or branch is not within this partner." }, 400);
      }
    }

    // New vs re-invite: an existing portal user gets a recovery (set-password)
    // link; a new one is created by the invite link.
    const { data: existing } = await service.from("users").select("id, role, partner_id").ilike("email", email).maybeSingle();
    let link: string | undefined;
    let targetUserId: string | undefined = existing?.id;

    // Re-inviting must respect the SAME scope as inviting: management may only
    // re-invite referrers/managers in their own partner. Without this, the
    // service-role lookup would let management trigger a set-password link and an
    // audit row for any account (a superadmin's, or another partner's).
    if (existing && caller.role !== "superadmin") {
      const outOfScope = existing.partner_id !== inviteePartnerId || !["referrer", "management"].includes(existing.role);
      if (outOfScope) return json({ ok: false, error: "Not permitted." }, 403);
    }

    if (existing) {
      const { data, error } = await service.auth.admin.generateLink({
        type: "recovery", email, options: { redirectTo: `${base}/accept-invite` },
      });
      if (error) return json({ ok: false, error: error.message }, 400);
      link = data?.properties?.action_link;
    } else {
      const { data, error } = await service.auth.admin.generateLink({
        type: "invite", email, options: { redirectTo: `${base}/accept-invite`, data: { full_name: fullName } },
      });
      if (error) return json({ ok: false, error: error.message }, 400);
      link = data?.properties?.action_link;
      targetUserId = data?.user?.id;
      if (targetUserId) {
        const { error: insErr } = await service.from("users").insert({
          id: targetUserId, email, full_name: fullName, role, partner_id: inviteePartnerId, status: "pending",
          home_branch_id: homeBranchId,
        });
        if (insErr) return json({ ok: false, error: insErr.message }, 400);
      }
    }
    if (!link) return json({ ok: false, error: "Could not generate the invitation link." }, 400);

    // Grant the org position AS THE INVITER, so set_user_scope's ladder decides
    // (an admin or a group/agency manager may; a branch-only manager may not) and
    // the target is checked against their own scope. The account now exists, so the
    // scope lands on it immediately. FATAL, not best-effort: a refusal rolls back a
    // just-created account (placeOrRollback) rather than leaving it unscoped, and
    // fails the whole call. Ordered before the email and audit below.
    if (scopeKind && targetUserId) {
      const grantErr = await placeOrRollback(
        () => userClient.rpc("set_user_scope", { p_user: targetUserId, p_kind: scopeKind, p_target: scopeTarget }),
        () => service.auth.admin.deleteUser(targetUserId!),
        !existing,
      );
      if (grantErr) return json({ ok: false, error: `Could not grant the position, so the invitation was cancelled: ${grantErr}` }, 400);
    }

    // Branded invite email (redirected to the review address in test mode).
    const partnerName = inviteePartnerId
      ? (await service.from("partners").select("name").eq("id", inviteePartnerId).maybeSingle()).data?.name ?? ""
      : "";
    // #69: never expose a contact email as a display name. A name-less user's
    // full_name falls back to their email (see fullName above), so if such a user
    // is the inviter, drop it and let the template say "Your team".
    const inviterName = caller.full_name && !caller.full_name.includes("@") ? caller.full_name : "";
    const emailRes = await sendMessage({ to: email, message: staffInviteEmail({ inviterName, partnerName, link }) });

    // const emailRes = await sendEmail({
    //     subject: tpl.subject,
    //     html: tpl.html,
    //     to: email,
    //     from: "opndoor <invites@opndoor.co>",  // yahi is email ka apna "from" hai
    //   });
    // Audit the invite (best-effort).
    if (targetUserId) {
      await service.from("user_audit").insert({
        target_user: targetUserId, partner_id: inviteePartnerId, action: "invited",
        old_value: null, new_value: role, actor: caller.full_name ?? "an administrator", actor_id: callerId,
      });
    }

    // A refused grant returned above, so if we are here the position (when one was
    // requested) is placed; positionError is retired.
    return json({ ok: true, emailSent: emailRes.ok, emailError: emailRes.ok ? null : emailRes.error, positioned: !!scopeKind });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Unexpected error." }, 500);
  }
});
