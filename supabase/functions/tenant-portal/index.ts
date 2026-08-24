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
import { splitProfilePatch, deliveryContactReady } from "../_shared/applicationPatch.ts";
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

    /* -----------------------------------------------------------------------
       Ownership, checked ONCE per request and never assumed afterwards.

       Every action below that names an application passes through here first.
       The applicant id comes from the verified token, so this cannot be
       satisfied by sending somebody else's application id: the row simply will
       not match. Returns the row so callers do not fetch it twice.
       --------------------------------------------------------------------- */
    async function ownedApplication(id: unknown) {
      const appId = String(id ?? "");
      if (!appId) return null;
      const { data } = await service
        .from("applications")
        .select("id, status, guarantee_ref, monthly_rent, tenancy_start, prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode, tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_phone, tenant_email")
        .eq("id", appId).eq("applicant_id", callerId).maybeSingle();
      return data ?? null;
    }

    // Nothing may be edited once it has left the applicant's hands. Submitting
    // is the boundary: after that the answers are what the reference was
    // requested on, and letting them drift would change the basis of a decision
    // already in flight.
    function editable(status: string) {
      return status === "draft" || status === "referencing";
    }

    /* ---- claiming an agent's invite --------------------------------------
       The only thing that attaches an existing application to this account.
       The address check lives in SQL, so a forwarded email cannot hand over
       somebody else's application even if this function is wrong. */
    if (action === "claim_invite") {
      const { data, error } = await service.rpc("claim_tenant_invite", {
        p_token: String(body.token ?? ""), p_applicant: callerId,
      });
      if (error) {
        // These messages are written for a tenant to read and say nothing about
        // whose application it is.
        const msg = /different email|already been used|expired|not valid/i.test(error.message)
          ? error.message : "This link cannot be used.";
        return json({ ok: false, error: msg }, 403);
      }
      const app = Array.isArray(data) ? data[0] : data;
      return json({ ok: true, application_id: (app as any)?.id ?? null });
    }

    /* ---- starting a direct application ------------------------------------
       Carries the prequalification answers straight in, so the first thing the
       form does is NOT ask again for the four things they just typed. */
    if (action === "start_application") {
      const { data: existing } = await service
        .from("applications").select("id").eq("applicant_id", callerId)
        .in("status", ["draft", "referencing"]).limit(1).maybeSingle();
      // One live application per account. Somebody who reloads the start page
      // should land back in the one they have, not collect drafts.
      if (existing) return json({ ok: true, application_id: existing.id, resumed: true });

      const { data: app, error } = await service.rpc("create_direct_application", {
        p_applicant: callerId,
        p_rent: Number(body.monthly_rent) || 0,
        p_tenancy_start: body.tenancy_start ?? null,
        p_addr1: String(body.prop_addr1 ?? "").trim(),
        p_addr2: String(body.prop_addr2 ?? "") || null,
        p_city: String(body.prop_city ?? "").trim(),
        p_county: String(body.prop_county ?? "") || null,
        p_postcode: String(body.prop_postcode ?? "").trim(),
      });
      if (error) {
        console.log(JSON.stringify({ event: "tenant_start_failed", message: error.message }));
        return json({ ok: false, error: "Could not start your application." }, 500);
      }
      const appId = (app as any)?.id as string;

      // Identity is already on applications.tenant_* from
      // create_direct_application; application_profiles holds declarations only.
      // Writing a name here was the same 42703 as save_profile, silently
      // swallowed because this upsert's result was never checked.
      if (body.adverse_credit !== undefined) {
        await service.from("application_profiles").upsert({
          application_id: appId, updated_at: new Date().toISOString(),
          adverse_credit: body.adverse_credit === true || body.adverse_credit === "yes",
        }, { onConflict: "application_id" });
      }

      if (Number(body.annual_income) > 0) {
        await service.from("application_incomes").upsert({
          application_id: appId, seq: 0, is_additional: false,
          income_type: body.is_student === true || body.is_student === "yes" ? "student" : "permanent",
          pay_basis: "annual_salary", annual_salary: Number(body.annual_income),
        }, { onConflict: "application_id,seq" });
      }
      return json({ ok: true, application_id: appId, resumed: false });
    }

    if (action === "list_applications") {
      const { data, error } = await service.rpc("tenant_applications", { p_applicant: callerId });
      if (error) {
        console.log(JSON.stringify({ event: "tenant_list_failed", message: error.message }));
        return json({ ok: false, error: "Could not load your applications." }, 500);
      }
      return json({
        ok: true,
        applicant: { email: applicant.email, first_name: applicant.first_name, last_name: applicant.last_name },
        applications: data ?? [],
      });
    }

    if (action === "me") {
      return json({ ok: true, applicant: { email: applicant.email, first_name: applicant.first_name, last_name: applicant.last_name } });
    }

    /* ----- the whole form, in one round trip -------------------------------
       Resume is the requirement, so the client asks once and gets everything:
       profile, property, agent, every address and every income. A form that
       fetched a tab at a time would show empty fields for a second on every
       tab change, which reads as lost work. */
    if (action === "get_application") {
      const app = await ownedApplication(body.application_id);
      if (!app) return json({ ok: false, error: "Not found." }, 404);

      const [profile, addresses, incomes, docs, agent] = await Promise.all([
        service.from("application_profiles").select("*").eq("application_id", app.id).maybeSingle(),
        service.from("application_addresses").select("*").eq("application_id", app.id).order("seq"),
        service.from("application_incomes").select("*").eq("application_id", app.id).order("seq"),
        service.from("application_documents").select("id, kind, filename, bytes, income_id, address_id, created_at").eq("application_id", app.id),
        service.from("application_delivery_contacts").select("*").eq("application_id", app.id).maybeSingle(),
      ]);

      const { data: feePaid } = await service.rpc("eligibility_fee_paid", { p_application: app.id });

      return json({
        ok: true,
        application: app,
        editable: editable(app.status),
        fee_paid: feePaid === true,
        // Identity read back from where it is written, so the details step
        // shows filled fields on resume instead of blanks it cannot save.
        profile: {
          ...(profile.data ?? {}),
          title: app.tenant_title ?? null,
          first_name: app.tenant_first_name ?? null,
          last_name: app.tenant_last_name ?? null,
          dob: app.tenant_dob ?? null,
          phone: app.tenant_phone ?? null,
        },
        addresses: addresses.data ?? [],
        incomes: incomes.data ?? [],
        documents: docs.data ?? [],
        agent: agent.data ?? null,
      });
    }

    /* ----- partial saves, which is what makes resume work -------------------
       Every one of these is an upsert of a PATCH, not a whole record. The form
       autosaves a field at a time, so a save must never null a column the
       client did not send. */
    if (action === "save_profile") {
      const app = await ownedApplication(body.application_id);
      if (!app) return json({ ok: false, error: "Not found." }, 404);
      if (!editable(app.status)) return json({ ok: false, error: "This application can no longer be edited." }, 409);

      /* IDENTITY LIVES ON applications.tenant_*, DECLARATIONS ON
         application_profiles. The 2026-08-12 identity split moved
         title/name/dob/phone off this table, but the details step still sends
         them here in one patch, so they are routed by key. Writing an identity
         field into application_profiles is the 42703 ("column does not exist")
         that had every keystroke of that step answering "Could not save". */
      const { identity: idPatch, declarations: profPatch } =
        splitProfilePatch((body.patch ?? {}) as Record<string, unknown>);

      if (Object.keys(idPatch).length) {
        const { error } = await service.from("applications").update(idPatch).eq("id", app.id);
        if (error) {
          console.log(JSON.stringify({ event: "tenant_save_identity_failed", message: error.message }));
          return json({ ok: false, error: "Could not save." }, 500);
        }
      }
      if (Object.keys(profPatch).length) {
        const { error } = await service.from("application_profiles")
          .upsert({ ...profPatch, application_id: app.id, updated_at: new Date().toISOString() },
                  { onConflict: "application_id" });
        if (error) {
          console.log(JSON.stringify({ event: "tenant_save_profile_failed", message: error.message }));
          return json({ ok: false, error: "Could not save." }, 500);
        }
      }
      return json({ ok: true });
    }

    if (action === "save_property") {
      const app = await ownedApplication(body.application_id);
      if (!app) return json({ ok: false, error: "Not found." }, 404);
      if (!editable(app.status)) return json({ ok: false, error: "This application can no longer be edited." }, 409);
      // An explicit allowlist. The applications table carries commission, route
      // and status columns, and an unfiltered patch from a browser would reach
      // all of them.
      const allowed = ["monthly_rent", "tenancy_start", "prop_addr1", "prop_addr2", "prop_city", "prop_county", "prop_postcode"];
      const patch: Record<string, unknown> = {};
      for (const k of allowed) if (k in (body.patch ?? {})) patch[k] = (body.patch as any)[k];
      if (!Object.keys(patch).length) return json({ ok: true });
      const { error } = await service.from("applications").update(patch).eq("id", app.id);
      if (error) return json({ ok: false, error: "Could not save." }, 500);
      return json({ ok: true });
    }

    if (action === "save_agent") {
      const app = await ownedApplication(body.application_id);
      if (!app) return json({ ok: false, error: "Not found." }, 404);
      if (!editable(app.status)) return json({ ok: false, error: "This application can no longer be edited." }, 409);
      const p = (body.patch ?? {}) as Record<string, unknown>;
      // Held until kind, email AND the naming field the delivery_contact_named
      // check wants are all present, or the upsert is a 23514/NOT NULL failure.
      if (!deliveryContactReady(p)) return json({ ok: true, deferred: true });
      const { error } = await service.from("application_delivery_contacts")
        .upsert({ ...p, application_id: app.id }, { onConflict: "application_id" });
      if (error) {
        console.log(JSON.stringify({ event: "tenant_save_agent_failed", message: error.message }));
        return json({ ok: false, error: "Could not save those details." }, 500);
      }
      return json({ ok: true });
    }

    if (action === "save_row") {
      // Addresses and incomes share a shape: a list keyed by (application, seq).
      const app = await ownedApplication(body.application_id);
      if (!app) return json({ ok: false, error: "Not found." }, 404);
      if (!editable(app.status)) return json({ ok: false, error: "This application can no longer be edited." }, 409);
      const table = body.table === "addresses" ? "application_addresses"
                  : body.table === "incomes"   ? "application_incomes" : null;
      if (!table) return json({ ok: false, error: "Unknown table." }, 400);
      const seq = Number(body.seq);
      if (!Number.isFinite(seq)) return json({ ok: false, error: "seq is required." }, 400);
      const { data, error } = await service.from(table)
        .upsert({ ...(body.patch ?? {}), application_id: app.id, seq }, { onConflict: "application_id,seq" })
        .select("id").maybeSingle();
      if (error) {
        console.log(JSON.stringify({ event: "tenant_save_row_failed", table, message: error.message }));
        return json({ ok: false, error: "Could not save." }, 500);
      }
      return json({ ok: true, id: data?.id ?? null });
    }

    if (action === "delete_row") {
      const app = await ownedApplication(body.application_id);
      if (!app) return json({ ok: false, error: "Not found." }, 404);
      if (!editable(app.status)) return json({ ok: false, error: "This application can no longer be edited." }, 409);
      const table = body.table === "addresses" ? "application_addresses"
                  : body.table === "incomes"   ? "application_incomes" : null;
      if (!table) return json({ ok: false, error: "Unknown table." }, 400);
      await service.from(table).delete().eq("application_id", app.id).eq("seq", Number(body.seq));
      return json({ ok: true });
    }

    /* ----- uploads ---------------------------------------------------------
       A signed upload URL, so the bytes go straight to Storage and never
       through this function. An Edge Function is not a good file pipe, and
       base64 through JSON triples the size of a bank statement. */
    if (action === "upload_url") {
      const app = await ownedApplication(body.application_id);
      if (!app) return json({ ok: false, error: "Not found." }, 404);
      if (!editable(app.status)) return json({ ok: false, error: "This application can no longer be edited." }, 409);
      const kind = String(body.kind ?? "");
      const ALLOWED = ["bank_statement", "proof_of_address", "p60_or_pension_award", "tax_return", "other_upload"];
      if (!ALLOWED.includes(kind)) return json({ ok: false, error: "Unknown document type." }, 400);

      const safe = String(body.filename ?? "upload").replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
      const path = `${app.id}/${kind}-${Date.now()}-${safe}`;
      const { data, error } = await service.storage.from("applicant-docs").createSignedUploadUrl(path);
      if (error || !data) return json({ ok: false, error: "Could not start the upload." }, 500);
      return json({ ok: true, path, token: data.token, bucket: "applicant-docs" });
    }

    if (action === "confirm_upload") {
      const app = await ownedApplication(body.application_id);
      if (!app) return json({ ok: false, error: "Not found." }, 404);
      const { error } = await service.rpc("record_application_document", {
        p_application: app.id, p_kind: String(body.kind ?? ""), p_bucket: "applicant-docs",
        p_path: String(body.path ?? ""), p_filename: String(body.filename ?? ""),
        p_content_type: String(body.content_type ?? "") || null,
        p_bytes: Number(body.bytes ?? 0) || null, p_source: "applicant",
        p_income: body.income_id ?? null, p_address: body.address_id ?? null,
      });
      if (error) {
        console.log(JSON.stringify({ event: "tenant_confirm_upload_failed", message: error.message }));
        return json({ ok: false, error: "Could not record the upload." }, 500);
      }
      return json({ ok: true });
    }

    if (action === "delete_document") {
      const app = await ownedApplication(body.application_id);
      if (!app) return json({ ok: false, error: "Not found." }, 404);
      const { data: doc } = await service.from("application_documents")
        .select("id, bucket, path").eq("id", String(body.document_id ?? "")).eq("application_id", app.id).maybeSingle();
      if (!doc) return json({ ok: false, error: "Not found." }, 404);
      // Applicant uploads only. A provider report is evidence and is not the
      // applicant's to remove.
      if (doc.bucket !== "applicant-docs") return json({ ok: false, error: "Not permitted." }, 403);
      await service.storage.from(doc.bucket).remove([doc.path]);
      await service.from("application_documents").delete().eq("id", doc.id);
      return json({ ok: true });
    }

    /* ----- the prequalification, and submission ---------------------------- */
    if (action === "prequalify") {
      const app = await ownedApplication(body.application_id);
      if (!app) return json({ ok: false, error: "Not found." }, 404);
      const { data: income } = await service.rpc("application_annual_income", { p_application: app.id });
      const { data: prof } = await service.from("application_profiles")
        .select("*").eq("application_id", app.id).maybeSingle();
      const { data: inc } = await service.from("application_incomes")
        .select("income_type").eq("application_id", app.id);
      const isStudent = (inc ?? []).some((r: any) => r.income_type === "student");
      const { data: rows } = await service.rpc("assess_eligibility", {
        p_monthly_rent: app.monthly_rent, p_share_amount: null,
        p_credit_score: null, p_annual_income: income ?? 0, p_is_student: isStudent,
      });
      const r = Array.isArray(rows) ? rows[0] : rows;
      const { data: months } = await service.rpc("address_history_months", { p_application: app.id });
      return json({
        ok: true,
        // Never "you qualify". We cannot see a credit file, which is the most
        // common reason a marginal applicant actually fails.
        outcome: r?.outcome ?? null, reason: r?.reason ?? null,
        annual_income: income ?? 0, income_needed_monthly: r?.income_needed ?? null,
        history_months: months ?? 0,
        adverse_credit: prof?.adverse_credit ?? null,
      });
    }

    /* ----- the application fee ---------------------------------------------
       Sits between the basic details and the rest of the form. The sections
       after it are locked until Stripe confirms it, and the lock that matters
       is in SQL: submit_application_for_referencing refuses without it, so a
       browser that ignores the lock still cannot send anything to the partner. */
    if (action === "start_eligibility_payment") {
      const app = await ownedApplication(body.application_id);
      if (!app) return json({ ok: false, error: "Not found." }, 404);
      if (!editable(app.status)) return json({ ok: false, error: "This application can no longer be edited." }, 409);

      const { data: already } = await service.rpc("eligibility_fee_paid", { p_application: app.id });
      if (already === true) return json({ ok: true, already_paid: true });

      const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
      if (!STRIPE_SECRET) return json({ ok: false, error: "Payments are not configured." }, 503);

      // The fee, in pence. A constant rather than a setting because it is a
      // commercial decision that should not be changeable by accident, and it
      // is recorded in HANDOVER so changing it is deliberate.
      const FEE_PENCE = 2000;
      const origin = String(body.origin ?? "").replace(/\/+$/, "");

      const form = new URLSearchParams();
      form.set("mode", "payment");
      form.set("client_reference_id", app.id);
      // PURPOSE IS WHAT KEEPS THIS OFF THE GUARANTEE PATH. Without it the
      // webhook treats a payment as the guarantee fee, sets status paid and
      // generates a Deed of Guarantee on a twenty pound payment.
      form.set("metadata[application_id]", app.id);
      form.set("metadata[purpose]", "eligibility");
      form.set("line_items[0][quantity]", "1");
      form.set("line_items[0][price_data][currency]", "gbp");
      form.set("line_items[0][price_data][unit_amount]", String(FEE_PENCE));
      form.set("line_items[0][price_data][product_data][name]", `Application fee - ${app.guarantee_ref}`);
      form.set("line_items[0][price_data][product_data][description]",
               "Covers referencing your application. Not the guarantee fee.");
      form.set("success_url", `${origin}/apply?fee=paid`);
      form.set("cancel_url", `${origin}/apply?fee=cancelled`);

      const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${STRIPE_SECRET}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      });
      const session = await res.json();
      if (!res.ok || !session?.url) {
        console.log(JSON.stringify({ event: "eligibility_session_failed", status: res.status }));
        return json({ ok: false, error: "Could not start the payment." }, 500);
      }
      return json({ ok: true, url: session.url });
    }

    /* ----- the guarantee fee -----------------------------------------------
       Returns the application's OWN payment-page token rather than minting a
       second Checkout session here.

       There is already one implementation of the guarantee payment: the
       tokenised /pay page, which the referral path has used since it was
       written and which handles the reissue, the decline path and the 30-minute
       session expiry. A signed-in tenant should reach that page, not a parallel
       copy of it that would drift on all three.

       mint_payment_page_token is idempotent: one token per application,
       refreshed rather than duplicated. */
    if (action === "guarantee_payment_link") {
      const app = await ownedApplication(body.application_id);
      if (!app) return json({ ok: false, error: "Not found." }, 404);

      // Only when there is actually something to pay. 'sent' is the state an
      // approved application sits in; offering this earlier would be asking for
      // the guarantee fee before anybody has been approved.
      if (app.status !== "sent") {
        return json({ ok: false, error: "There is nothing to pay yet." }, 409);
      }

      const { data: token, error } = await service.rpc("mint_payment_page_token", {
        p_ref: app.guarantee_ref,
      });
      if (error || !token) {
        console.log(JSON.stringify({ event: "guarantee_link_failed", message: error?.message }));
        return json({ ok: false, error: "Could not open the payment page." }, 500);
      }
      return json({ ok: true, url: `/pay?token=${token}&utm_source=tenant_portal` });
    }

    if (action === "submit") {
      const app = await ownedApplication(body.application_id);
      if (!app) return json({ ok: false, error: "Not found." }, 404);
      const { error } = await service.rpc("submit_application_for_referencing", { p_application: app.id });
      if (error) {
        // These are written for a tenant to read and each names what is still
        // needed, so the message is passed through rather than flattened.
        return json({ ok: false, error: error.message }, 422);
      }
      return json({ ok: true });
    }

    return json({ ok: false, error: "Unknown action." }, 400);
  } catch (e) {
    console.log(JSON.stringify({ event: "tenant_portal_error", message: String(e) }));
    return json({ ok: false, error: "Something went wrong." }, 500);
  }
});
