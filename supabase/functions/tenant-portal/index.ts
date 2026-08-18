// =====================================================================
// The tenant's own view of their own applications.
//
// WHY THIS IS AN EDGE FUNCTION AND NOT POSTGREST
//
// A tenant is authenticated and is NOT staff. They have a row in
// public.applicants and none in public.users, which means that for every policy
// in this database:
//
//   app_role()    is null  -> every `app_role() in (...)` arm is false
//   app_partner() is null  -> every `partner_id = app_partner()` arm is false
//   is_admin()    is false
//   is_aal2()     is false, and require_aal2 on applications is RESTRICTIVE, so
//                 it ANDs with every permissive policy and refuses regardless
//
// So a tenant JWT sent straight to PostgREST reads nothing at all, on every
// table, for four independent reasons. That is the design, not an obstacle to
// it. The alternative, adding a tenant arm to those policies, would mean
// editing the exact expressions every referral-path read and write passes
// through, and relaxing require_aal2 would change the security posture of the
// whole portal to serve a screen a tenant looks at twice.
//
// So the tenant's data comes from here: a service-role function that verifies
// who is calling BEFORE it uses that privilege, which is the same posture
// payment-page has had since it was written.
//
// WHAT PROTECTS IT
//   1. The caller is resolved from their JWT with an ANON client. This function
//      never trusts an id from the request body.
//   2. A caller who turns out to be STAFF is refused outright. Staff have the
//      portal, and a staff member reaching tenant endpoints is either a mistake
//      or an attempt.
//   3. Every read is scoped by the resolved applicant id inside SQL
//      (tenant_applications takes it as an argument and never reads auth.uid()),
//      so this function cannot ask for somebody else's data even by accident.
//   4. The read model is an explicit column list in SQL. Commission is off the
//      applications table grant entirely and must never reappear there.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Use POST." }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ ok: false, error: "Not authenticated." }, 401);

    // Resolved from the token, never from the body. This is the only place the
    // caller's identity is decided.
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: auth } = await userClient.auth.getUser();
    if (!auth?.user) return json({ ok: false, error: "Not authenticated." }, 401);

    const callerId = auth.user.id;
    const service = createClient(SUPABASE_URL, SERVICE);

    // Staff are refused before anything else happens. The mutual-exclusion
    // triggers make being both impossible, so this can only fire for a genuine
    // staff member calling a tenant endpoint. They have the portal.
    const { data: staff } = await service
      .from("users").select("id").eq("id", callerId).maybeSingle();
    if (staff) return json({ ok: false, error: "Not permitted." }, 403);

    const { data: applicant } = await service
      .from("applicants").select("id, email, first_name, last_name, closed_at")
      .eq("id", callerId).maybeSingle();

    // Authenticated but not an applicant: an identity that exists in auth and
    // has never completed signup. Deliberately the same 403 a staff caller
    // gets, so neither response tells the caller which case they are in.
    if (!applicant) return json({ ok: false, error: "Not permitted." }, 403);
    if (applicant.closed_at) return json({ ok: false, error: "This account is closed." }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "list_applications");

    if (action === "list_applications") {
      const { data, error } = await service.rpc("tenant_applications", { p_applicant: callerId });
      if (error) {
        console.log(JSON.stringify({ event: "tenant_list_failed", message: error.message }));
        // The tenant is told nothing about why. Postgres error text has leaked
        // schema to an API caller once already in this codebase (defect 18).
        return json({ ok: false, error: "Could not load your applications." }, 500);
      }
      return json({
        ok: true,
        applicant: {
          email: applicant.email,
          first_name: applicant.first_name,
          last_name: applicant.last_name,
        },
        applications: data ?? [],
      });
    }

    if (action === "me") {
      return json({
        ok: true,
        applicant: {
          email: applicant.email,
          first_name: applicant.first_name,
          last_name: applicant.last_name,
        },
      });
    }

    return json({ ok: false, error: "Unknown action." }, 400);
  } catch (e) {
    console.log(JSON.stringify({ event: "tenant_portal_error", message: String(e) }));
    return json({ ok: false, error: "Something went wrong." }, 500);
  }
});
