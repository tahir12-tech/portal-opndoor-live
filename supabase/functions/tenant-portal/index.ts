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
import { splitProfilePatch, deliveryContactReady, resolveDeclaredAt } from "../_shared/applicationPatch.ts";
import { stripeSecretFor } from "../_shared/livemodeCredentials.ts";
import { safeOrigin } from "../_shared/safeOrigin.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendMessage } from "../_shared/mailer.ts";
import { submissionReceivedEmail, feeBasisWeeksOf } from "../_shared/emailTemplates.ts";
import { notifyReferrer } from "../_shared/referrerNotify.ts";
import { getSigningLink } from "../_shared/pandadoc.ts";

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

    /* -----------------------------------------------------------------------
       AND IF THEY LEFT ONE UNFINISHED LONG ENOUGH FOR IT TO CLOSE, IT OPENS
       AGAIN. Matt, 2026-10-02: "Expiry loses nothing: if the tenant signs in
       again, it reopens where they left off, back to In progress, same
       reference."

       HERE, AND NOT IN ONE OF THE ACTIONS BELOW, because "signs in again" is
       the whole of the condition: every tenant request arrives through this
       block with a verified token, so one call covers listing, resuming and
       starting, and a new action added next month cannot forget it. The RPC
       is a no-op for an applicant with nothing closed, which is almost every
       request, and it only ever touches an application that expired WITHOUT
       having been sent -- a lapsed unpaid fee is finished business and
       reinstating that is somebody's decision, not a side effect of signing
       in.

       IT MUST RUN BEFORE start_application, whose "one live application"
       lookup deliberately excludes terminal states so somebody whose
       application closed can begin again. With the reopen first, there is
       nothing closed left to skip and they get their own application back
       rather than a fresh empty one with a new reference.
       --------------------------------------------------------------------- */
    const { error: reopenErr } = await service.rpc("reopen_expired_draft", { p_applicant: callerId });
    if (reopenErr) {
      // Never refuse the request over this: the worst case is that they see
      // the application as closed and start another, which is what happened
      // before it existed.
      console.log(JSON.stringify({ event: "tenant_reopen_failed", message: reopenErr.message }));
    }

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
      /* fee_amount AND fee_basis_weeks, because this row IS the tenant's status
         screen: everything it knows about the price, it knows from here, and what
         it had was monthly_rent. On GR-20837 that is £1,000 where £692.31 was
         charged, three weeks of rent under Regent's agreement, so the one screen
         the payer looks at could only quote them the rent and call it the fee.
         fee_amount is what was charged and fee_basis_weeks is the recorded reason
         it was that. monthly_rent stays: the form edits it and affordability is
         judged on it. */
      const { data } = await service
        .from("applications")
        .select("id, status, deed_state, payment_state, pandadoc_document_id, executed_pdf_path, livemode, guarantee_ref, monthly_rent, fee_amount, fee_basis_weeks, tenancy_start, prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode, share_percent, share_amount, tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_phone, tenant_email")
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
        .in("status", ["draft", "referencing", "sent", "paid", "deed"])
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      // One live application per account, at ANY stage. This guard only looked for
      // draft/referencing, so a tenant whose application had advanced to sent/paid/
      // deed found no draft and collected a fresh empty one on the next sign-in.
      // Terminal states (withdrawn/expired/declined) are excluded, so someone whose
      // application closed can still start again.
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

      // Agent-invited applications carry a tenant_invites row: the agent set the
      // email, property, rent and share, so the form locks those four.
      const { data: inviteRow } = await service.from("tenant_invites").select("id").eq("application_id", app.id).limit(1).maybeSingle();

      return json({
        ok: true,
        application: app,
        invited: !!inviteRow,
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
      const { identity: idPatch, declarations: rawDecl } =
        splitProfilePatch((body.patch ?? {}) as Record<string, unknown>);
      // The declaration tick becomes declared_at, stamped with the server's time.
      const profPatch = resolveDeclaredAt(rawDecl, new Date().toISOString());

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

    if (action === "set_step") {
      // Progress only, never content: record which form step the tenant is on, so
      // a scoped manager can see how far a mid-way tenant has got. Only while the
      // application is still a draft; a no-op once it has left the tenant's hands.
      const app = await ownedApplication(body.application_id);
      if (!app) return json({ ok: false, error: "Not permitted." }, 403);
      const step = String(body.step ?? "");
      const ALLOWED = ["property", "about", "fee", "address", "income", "nationality", "declaration"];
      if (!ALLOWED.includes(step)) return json({ ok: false, error: "Unknown step." }, 400);
      if (app.status === "draft") {
        await service.from("applications").update({ current_step: step }).eq("id", app.id);
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
      // On an agent-invited application the property address and monthly rent are
      // the agent's, and locked. Reject a client that sends a changed value, and
      // never rewrite them (an unchanged echo from the form is dropped). The
      // tenancy start is not locked. Email and share have no tenant write path.
      const { data: inviteRow } = await service.from("tenant_invites").select("id").eq("application_id", app.id).limit(1).maybeSingle();
      if (inviteRow) {
        for (const k of ["monthly_rent", "prop_addr1", "prop_addr2", "prop_city", "prop_county", "prop_postcode"]) {
          if (!(k in patch)) continue;
          const same = k === "monthly_rent"
            ? Number(patch[k]) === Number((app as Record<string, unknown>)[k])
            : String(patch[k] ?? "") === String((app as Record<string, unknown>)[k] ?? "");
          if (!same) return json({ ok: false, error: "Your agent set the property address and rent; they can't be changed." }, 403);
          delete patch[k];
        }
      }
      if (!Object.keys(patch).length) return json({ ok: true });
      const { error } = await service.from("applications").update(patch).eq("id", app.id);
      if (error) return json({ ok: false, error: "Could not save." }, 500);
      return json({ ok: true });
    }

    if (action === "save_agent") {
      const app = await ownedApplication(body.application_id);
      if (!app) return json({ ok: false, error: "Not found." }, 404);
      if (!editable(app.status)) return json({ ok: false, error: "This application can no longer be edited." }, 409);
      /* AN EXPLICIT ALLOWLIST, the same way save_property twelve lines above
         has one and for the same reason. This spread body.patch straight into
         a SERVICE-ROLE upsert, and this table carries verified_at and
         verified_by -- the column whose own comment reads "anything that
         sends a legal instrument here must read this". A tenant could mark
         their own delivery contact verified and stamp a real staff member's
         uuid as the person who verified it. Nothing reads the flag on the
         send path today, so it was a falsifiable audit field and an armed
         escalation rather than a live leak; neither is a reason to leave an
         unfiltered patch behind a service-role client. */
      const raw = (body.patch ?? {}) as Record<string, unknown>;
      const ALLOWED = ["kind", "agency_name", "title", "first_name", "last_name", "email", "phone"];
      const p: Record<string, unknown> = {};
      for (const k of ALLOWED) if (k in raw) p[k] = raw[k];
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
      /* THE THIRD UNFILTERED PATCH, and the last. save_property has an
         allowlist and save_agent was given one; this one spread body.patch
         into a service-role upsert too. Neither of these tables carries a
         verification flag today, so there was nothing to escalate to, but
         "no column worth writing yet" is a fact about this week's schema and
         not a guard. Columns are listed per table rather than shared, so a
         column added to one does not silently become writable on both. */
      const ALLOWED: Record<string, string[]> = {
        application_addresses: ["in_uk", "flat_number", "house_number", "house_name",
          "address_1", "address_2", "city", "county", "postcode", "residency_type",
          "residency_other_detail", "moved_in_month", "moved_in_year", "proof_type",
          "rental_arrears", "rental_arrears_detail"],
        application_incomes: ["income_type", "is_additional", "start_date", "end_date",
          "employer_name", "employer_in_uk", "employer_address", "employer_postcode",
          "job_title", "referee_name", "referee_email", "referee_phone", "pay_basis",
          "annual_salary", "hourly_rate", "weekly_hours", "has_accountant",
          "accountant_name", "accountant_email", "pension_income", "probation",
          "probation_months", "disciplinary", "foreseeable_future", "guaranteed",
          "amount", "amount_frequency", "savings_amount", "maintenance_loan",
          "family_support"],
      };
      const raw = (body.patch ?? {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const k of ALLOWED[table]) if (k in raw) patch[k] = raw[k];

      const { data, error } = await service.from(table)
        .upsert({ ...patch, application_id: app.id, seq }, { onConflict: "application_id,seq" })
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
      /* THE PATH MUST BE UNDER THIS APPLICATION. It was taken from the body
         and passed to a service-role RPC that does not validate it either, so
         a tenant who knew another application's object path could register it
         against their own -- after which staff get a signed URL for it
         through application-document-url, and delete_document below will
         remove it from storage. Paths embed a random uuid so they are not
         guessable, which made this latent rather than live; the check is one
         line and the guess is somebody else's problem to be wrong about. */
      const path = String(body.path ?? "");
      if (!path.startsWith(`${app.id}/`)) {
        return json({ ok: false, error: "That upload does not belong to this application." }, 400);
      }
      const { error } = await service.rpc("record_application_document", {
        p_application: app.id, p_kind: String(body.kind ?? ""), p_bucket: "applicant-docs",
        p_path: path, p_filename: String(body.filename ?? ""),
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
      // THE SHARE, NOT THE WHOLE RENT. assess_eligibility has always preferred a
      // share when given one (rule 1) and this caller passed null, so an
      // applicant on a joint tenancy was being asked to afford the whole
      // property on their own: a 50% share of £3,000 demanded £54,000 a year
      // rather than £27,000, and the group capacity test was the only place the
      // apportionment was honoured.
      //
      // SINGLE TENANT IS BYTE-IDENTICAL: share_amount is the whole rent on a solo
      // referral, and application_rent_basis falls back to monthly_rent for the
      // historic rows that never carried one.
      const { data: basis } = await service.rpc("application_rent_basis", { p_application: app.id });
      const { data: rows } = await service.rpc("assess_eligibility", {
        p_monthly_rent: app.monthly_rent, p_share_amount: basis ?? null,
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
        // What affordability was actually judged against, so a sharer can see
        // that it was their share and not the whole property.
        rent_basis: r?.rent_basis ?? null,
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

      /* THE KEY FOLLOWS THE APPLICATION, NOT THE ENVIRONMENT. Round 5's lows.
         This read STRIPE_SECRET_KEY directly, so a SANDBOX application's tenant
         was charged against the live Stripe account. _shared/livemodeCredentials
         exists for exactly this and is the only file that knows which key is
         which; it also checks the prefix, so a live key configured as the test
         one is refused rather than used. */
      const cred = stripeSecretFor(app.livemode === true);
      if (!cred.ok) return json({ ok: false, error: cred.error }, 503);
      const STRIPE_SECRET = cred.value;

      // The fee, in pence. A constant rather than a setting because it is a
      // commercial decision that should not be changeable by accident, and it
      // is recorded in HANDOVER so changing it is deliberate.
      const FEE_PENCE = 2000;
      /* Backlog B6. This took the caller's origin OUTRIGHT, with no APP_URL
         anywhere -- so the Stripe success and cancel URLs below pointed
         wherever the request said. safeOrigin allows APP_URL, or localhost
         when APP_URL is unset, and otherwise refuses. */
      const origin = safeOrigin(body.origin);
      if (!origin) return json({ ok: false, error: "Payments are not configured." }, 503);

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
      return json({ ok: true, url: `/pay?token=${token}&utm_source=tenant_portal`, token });
    }

    if (action === "sign_deed") {
      const app = await ownedApplication(body.application_id);
      if (!app) return json({ ok: false, error: "Not found." }, 404);
      // Only once the deed has been generated and is awaiting the tenant. Before
      // that there is nothing to sign; after execution it is already done.
      if (app.status !== "paid" || app.deed_state !== "awaiting_tenant" || !app.pandadoc_document_id) {
        return json({ ok: false, error: "Your deed is not ready to sign yet." }, 409);
      }
      const { link, detail } = await getSigningLink(String(app.pandadoc_document_id), String(app.tenant_email ?? ""), app.livemode === true);
      if (!link) {
        console.log(JSON.stringify({ event: "sign_deed_session_failed", detail: detail ?? null }));
        return json({ ok: false, error: "We could not open the signing session. We will email your signing link shortly." }, 502);
      }
      return json({ ok: true, url: link });
    }

    if (action === "deed_url") {
      const app = await ownedApplication(body.application_id);
      if (!app) return json({ ok: false, error: "Not found." }, 404);
      // The tenant reaches only their OWN executed deed: ownedApplication has
      // scoped to applicant_id, and the bytes come from the private deeds bucket
      // via a short-lived signed URL, the same pattern as staff deed-download.
      if (!app.executed_pdf_path) return json({ ok: false, error: "The deed is not ready to download yet." }, 409);
      const { data: signed, error } = await service.storage.from("deeds").createSignedUrl(String(app.executed_pdf_path), 300);
      if (error || !signed) return json({ ok: false, error: "Could not open the deed." }, 500);
      return json({ ok: true, url: signed.signedUrl });
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

      // Attribution match: back-office, and STRICTLY non-blocking. It runs after
      // the submit has already succeeded and its failure is logged, never
      // returned. A tenant is not held up, and never sees, the reconciliation.
      const { error: matchErr } = await service.rpc("match_application_agency", { p_application: app.id });
      if (matchErr) {
        console.log(JSON.stringify({ event: "agency_match_failed", message: matchErr.message }));
      }

      // Tell the referring agent their tenant's application is being referenced.
      await notifyReferrer(service, app.id, "submitted");

      // Confirmation that we have it, so a tenant does not press Send and hear
      // nothing. Non-blocking: a mail failure is logged, never returned, so it
      // cannot fail a submission that already succeeded. Dev mail is redirected
      // to the review address by resolveRecipients inside the mailer.
      try {
        const propertyAddr = [app.prop_addr1, app.prop_city, app.prop_postcode]
          .filter((x) => x && String(x).trim()).join(", ");
        const mail = await sendMessage({
          to: app.tenant_email,
          message: submissionReceivedEmail({
            firstName: app.tenant_first_name,
            guaranteeRef: app.guarantee_ref,
            propertyAddr,
            /* The basis, so the one line here that can quote a price quotes the
               right one. This passed nothing, so the template took the basis as
               unknown and named the step without pricing it; on a referral whose
               fee is already snapshotted the price IS known, and stating it here
               is what stops the £1,000-for-a-£692.31-fee reading arriving at the
               first email instead of the last.

               Measured against this applicant's OWN share of the rent, which is
               coalesce(share_amount, monthly_rent), the same definition
               application_rent_basis gives the prequalification above and the
               referencing submission. Divide a joint tenant's share of the fee by
               the whole tenancy rent and every sharer is told they are on a
               discount.

               fee_amount ALONE, with no fall back to monthly_rent: this email
               goes out before anybody has priced or decided anything, so a null
               fee is genuinely "not settled yet" rather than "a month". Assuming
               the month is the defect, and the template is built to say the true
               half of the sentence when we pass nothing. */
            feeBasisWeeks: feeBasisWeeksOf(app.fee_amount, app.share_amount ?? app.monthly_rent),
          }),
        });
        if (!mail.ok) console.log(JSON.stringify({ event: "submission_email_failed", message: mail.error }));
      } catch (e) {
        console.log(JSON.stringify({ event: "submission_email_error", message: String(e) }));
      }

      return json({ ok: true });
    }

    return json({ ok: false, error: "Unknown action." }, 400);
  } catch (e) {
    console.log(JSON.stringify({ event: "tenant_portal_error", message: String(e) }));
    return json({ ok: false, error: "Something went wrong." }, 500);
  }
});
