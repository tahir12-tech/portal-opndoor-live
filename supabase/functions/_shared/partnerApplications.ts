// =====================================================================
// POST /applications. See PARTNER-API.md sections 6 to 12.
//
// Kept out of index.ts because the create path is where most of the API's
// behaviour lives: idempotency, org resolution, referrer provisioning, field
// validation and mode dispatch. index.ts stays a router plus authentication.
//
// THE ORDER OF OPERATIONS IS LOAD BEARING:
//
//   1. idempotency claim   before any work, so a retry cannot double-create
//   2. referrer            before validation, because it can fail with a field error
//   3. org                 before validation, because branch_id is a validated field
//   4. field validation    via referral_field_errors, the same rules the portal uses
//   5. create              via create_referral_api
//   6. payment link        minted after the row exists
//   7. record the response so a retry replays it
//
// Steps 2 and 3 come before 4 so that a payload with both a bad postcode and an
// unknown branch reports both, rather than making the partner fix one per round
// trip.
// =====================================================================

/** Canonical JSON for hashing: keys sorted at every level, so key order in the request does not matter. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return "{" + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ":" + canonical(obj[k])).join(",") + "}";
}

async function sha256Hex(input: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type FieldError = { field: string; code: string; message: string };

export type CreateOutcome = {
  status: number;
  body: unknown;
  applicationId?: string;
};

function validationFailure(fields: FieldError[]): CreateOutcome {
  return {
    status: 422,
    body: { error: { code: "validation_failed", message: "The application was not created.", fields } },
  };
}

/** Trim a string field, returning null for absent or blank. */
function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * Resolve the referrer by email, WITHIN this partner only.
 *
 * Never matches globally. A user under a different partner is a field error and
 * is never linked across partners, because doing so would attribute one
 * partner's application to another partner's user and leak that the address is
 * known.
 */
async function resolveReferrer(
  // deno-lint-ignore no-explicit-any
  service: any,
  partnerId: string,
  email: string,
): Promise<{ id: string } | { error: FieldError }> {
  const { data: mine } = await service
    .from("users")
    .select("id")
    .eq("partner_id", partnerId)
    .ilike("email", email)
    .maybeSingle();

  if (mine) return { id: mine.id };

  // Is the address known under a DIFFERENT partner? If so, refuse. The message
  // deliberately does not say which partner, or even confirm one exists.
  const { data: elsewhere } = await service
    .from("users")
    .select("id")
    .neq("partner_id", partnerId)
    .ilike("email", email)
    .maybeSingle();

  if (elsewhere) {
    return {
      error: {
        field: "referrer.email",
        code: "not_available",
        message: "This email address is not available as a referrer for this partner.",
      },
    };
  }

  // Auto-provision. public.users.id is a foreign key to auth.users, so the auth
  // user has to exist first. generateLink({type:'invite'}) creates it and returns
  // the id; the link is deliberately discarded, since this is provisioning and
  // not an invitation. The partner has not asked for anyone to be emailed.
  const { data: created, error: linkErr } = await service.auth.admin.generateLink({
    type: "invite",
    email,
  });

  if (linkErr || !created?.user?.id) {
    return {
      error: {
        field: "referrer.email",
        code: "could_not_provision",
        message: "Could not create a referrer for this email address.",
      },
    };
  }

  // full_name is seeded with the email rather than a generic placeholder,
  // because applications.referrer_name is SNAPSHOTTED at creation
  // (20260705140347) and never backfilled. Naming the user later fixes only
  // applications created after that point, so whatever is here is what appears
  // in the portal, the league table and every export, permanently, for the
  // applications created before someone gets round to it. An email address at
  // least identifies a person; "Partner user" repeated two hundred times does
  // not. Pre-creating known partner users with proper names before go-live
  // avoids this entirely.
  const { error: insErr } = await service.from("users").insert({
    id: created.user.id,
    email,
    full_name: email,
    role: "referrer",
    partner_id: partnerId,
    status: "pending",
  });

  if (insErr) {
    return {
      error: {
        field: "referrer.email",
        code: "could_not_provision",
        message: "Could not create a referrer for this email address.",
      },
    };
  }

  return { id: created.user.id };
}

/**
 * Resolve the org to a branch id.
 *
 * By ID is the intended form. By name is for first contact only, needs the
 * orgs:write scope, and requires a contact email because an org without one
 * produces applications that fail at the deed after the tenant has paid.
 */
async function resolveOrg(
  // deno-lint-ignore no-explicit-any
  service: any,
  partnerId: string,
  livemode: boolean,
  referrerId: string,
  org: Record<string, unknown>,
  scopes: string[],
): Promise<{ branchId: string; agencyId: string; created: boolean } | { error: FieldError }> {
  const agencyId = str(org.agency_id);
  const branchId = str(org.branch_id);
  const agencyName = str(org.agency_name);
  const branchName = str(org.branch_name);

  if (agencyId || branchId) {
    if (!agencyId || !branchId) {
      return {
        error: {
          field: !agencyId ? "org.agency_id" : "org.branch_id",
          code: "required",
          message: "Send both agency_id and branch_id, or send names instead.",
        },
      };
    }

    const { data: branch } = await service
      .from("branches")
      .select("id, agency_id, partner_id, livemode")
      .eq("id", branchId)
      .maybeSingle();

    // Same error whether the branch does not exist or belongs to another
    // partner, so the API cannot be used to probe for another partner's orgs.
    // livemode is checked here alongside partner and agency, and reported with
    // the same message, so a sandbox key naming a live branch cannot tell the two
    // apart. create_referral_api repeats this check; this copy exists so the
    // caller gets a field error rather than a 500 from a raised exception.
    if (
      !branch || branch.partner_id !== partnerId || branch.agency_id !== agencyId ||
      (branch.livemode === true) !== livemode
    ) {
      return {
        error: { field: "org.branch_id", code: "not_found", message: "Unknown branch for this partner." },
      };
    }

    // A branch that cannot resolve a primary contact cannot produce a deed. Fail
    // here rather than after the tenant has paid. GET /orgs exposes exactly this
    // as has_agent_contact so a partner can fix it before sending traffic.
    const { data: contactOk } = await service.rpc("effective_primary_contact", { p_branch: branchId });
    const contact = Array.isArray(contactOk) ? contactOk[0] : contactOk;
    if (!contact?.email) {
      return {
        error: {
          field: "org.branch_id",
          code: "no_agent_contact",
          message: "This branch has no primary agent contact, so a deed could not be issued.",
        },
      };
    }

    return { branchId, agencyId, created: false };
  }

  if (!agencyName) {
    return {
      error: {
        field: "org.agency_id",
        code: "required",
        message: "Send agency_id and branch_id, or agency_name with a contact email.",
      },
    };
  }

  if (!scopes.includes("orgs:write")) {
    return {
      error: {
        field: "org.agency_name",
        code: "insufficient_scope",
        message: "This key may only reference existing organisations by id.",
      },
    };
  }

  const contactEmail = str(org.agent_contact_email);
  if (!contactEmail) {
    return {
      error: {
        field: "org.agent_contact_email",
        code: "required",
        message: "A contact email is required when creating an organisation.",
      },
    };
  }

  const { data: newBranchId, error } = await service.rpc("create_referral_target_api", {
    p_partner: partnerId,
    p_livemode: livemode,
    p_actor: referrerId,
    p_agency: agencyName,
    p_branch: branchName,
    p_contact_email: contactEmail,
    p_contact_name: str(org.agent_contact_name),
    p_contact_phone: str(org.agent_contact_phone),
  });

  if (error || !newBranchId) {
    return {
      error: {
        field: "org.agency_name",
        code: "could_not_create",
        message: error?.message ?? "Could not resolve the organisation.",
      },
    };
  }

  const { data: b } = await service
    .from("branches").select("id, agency_id").eq("id", newBranchId).maybeSingle();

  return { branchId: newBranchId, agencyId: b?.agency_id ?? "", created: true };
}

/**
 * The create path.
 *
 * Returns the outcome rather than a Response so the caller can record it in the
 * idempotency ledger before sending it. A replayed request must return the same
 * body, which means the body has to be a value first and a Response second.
 */
export async function createApplication(
  // deno-lint-ignore no-explicit-any
  service: any,
  partnerId: string,
  // Live or sandbox, from the authenticated key. Threaded rather than read from
  // the body anywhere below: a partner cannot opt into sandbox by sending a
  // flag, and cannot escape it either.
  livemode: boolean,
  scopes: string[],
  mode: string,
  body: Record<string, unknown>,
): Promise<CreateOutcome> {
  const fields: FieldError[] = [];

  // ---- mode dispatch --------------------------------------------------------
  // A single switch on the partner's mode, deliberately in one place rather than
  // scattered as conditionals, so a fourth mode is one branch here.
  if (mode === "opndoor_referenced") {
    return {
      status: 501,
      body: {
        error: {
          code: "not_implemented",
          message: "This partner's referencing mode is not yet available.",
        },
      },
    };
  }
  if (mode === "pre_referenced_screened") {
    // Refusing is deliberate. There is no criteria engine, so this partner would
    // otherwise be silently accepted on every application, which is
    // indistinguishable from working and would be discovered commercially.
    return {
      status: 501,
      body: {
        error: {
          code: "not_implemented",
          message: "This partner's referencing mode is not yet available.",
        },
      },
    };
  }
  if (mode !== "pre_referenced_open") {
    return {
      status: 501,
      body: { error: { code: "not_implemented", message: "This partner's referencing mode is not yet available." } },
    };
  }

  const tenant = (body.tenant ?? {}) as Record<string, unknown>;
  const property = (body.property ?? {}) as Record<string, unknown>;
  const tenancy = (body.tenancy ?? {}) as Record<string, unknown>;
  const org = (body.org ?? {}) as Record<string, unknown>;
  const referrer = (body.referrer ?? {}) as Record<string, unknown>;

  // ---- referrer -------------------------------------------------------------
  const referrerEmail = str(referrer.email);
  let referrerId = "";
  if (!referrerEmail) {
    fields.push({ field: "referrer.email", code: "required", message: "A referrer email is required." });
  } else {
    const r = await resolveReferrer(service, partnerId, referrerEmail);
    if ("error" in r) fields.push(r.error);
    else referrerId = r.id;
  }

  // ---- org ------------------------------------------------------------------
  let branchId = "";
  let agencyId = "";
  let orgCreated = false;
  if (referrerId) {
    const o = await resolveOrg(service, partnerId, livemode, referrerId, org, scopes);
    if ("error" in o) fields.push(o.error);
    else {
      branchId = o.branchId;
      agencyId = o.agencyId;
      orgCreated = o.created;
    }
  }

  // ---- field validation -----------------------------------------------------
  // Same rules as the portal, from the same function, returned as codes rather
  // than the prose create_referral raises.
  const rent = typeof tenancy.monthly_rent === "number"
    ? tenancy.monthly_rent
    : Number(str(tenancy.monthly_rent) ?? NaN);

  const { data: ruleErrors, error: ruleErr } = await service.rpc("referral_field_errors", {
    p_branch: branchId || null,
    p_tenant_title: str(tenant.title),
    p_first: str(tenant.first_name),
    p_last: str(tenant.last_name),
    p_dob: str(tenant.date_of_birth),
    p_email: str(tenant.email),
    p_phone: str(tenant.phone),
    p_addr1: str(property.address_line_1),
    p_addr2: str(property.address_line_2),
    p_city: str(property.city),
    p_county: str(property.county),
    p_postcode: str(property.postcode),
    p_rent: Number.isFinite(rent) ? rent : null,
    p_tenancy_start: str(tenancy.start_date),
  });

  if (ruleErr) {
    return { status: 500, body: { error: { code: "internal_error", message: "Something went wrong." } } };
  }

  for (const e of (ruleErrors ?? []) as { field: string; code: string; message: string }[]) {
    // branchId is empty in two cases: org resolution failed, or it never ran
    // because the referrer failed first. Either way the real reason is already
    // in `fields`, and the rules function can only report the generic "a branch
    // is required". Reporting that too would tell a partner who sent a perfectly
    // good branch_id that they did not send one, which sends them looking in the
    // wrong place.
    if (e.field === "org.branch_id" && fields.length > 0) continue;
    fields.push({ field: e.field, code: e.code, message: e.message });
  }

  if (fields.length > 0) return validationFailure(fields);

  // ---- create ---------------------------------------------------------------
  const { data: app, error: createErr } = await service.rpc("create_referral_api", {
    p_partner: partnerId,
    p_livemode: livemode,
    p_referrer: referrerId,
    p_branch: branchId,
    p_tenant_title: str(tenant.title),
    p_first: str(tenant.first_name),
    p_last: str(tenant.last_name),
    p_dob: str(tenant.date_of_birth),
    p_email: str(tenant.email),
    p_phone: str(tenant.phone),
    p_addr1: str(property.address_line_1),
    p_addr2: str(property.address_line_2),
    p_city: str(property.city),
    p_county: str(property.county),
    p_postcode: str(property.postcode),
    p_rent: rent,
    p_tenancy_start: str(tenancy.start_date),
  });

  if (createErr || !app) {
    return {
      status: 422,
      body: {
        error: {
          code: "validation_failed",
          message: "The application was not created.",
          fields: [{ field: "", code: "rejected", message: createErr?.message ?? "Could not create the application." }],
        },
      },
    };
  }

  const created = Array.isArray(app) ? app[0] : app;

  // ---- payment link ---------------------------------------------------------
  // Idempotent mint, the same RPC the portal and the reminder jobs use. No
  // Stripe call happens here: the Checkout Session is created when the tenant
  // opens the page, which keeps this endpoint independent of Stripe being
  // configured.
  const { data: token } = await service.rpc("mint_payment_page_token", { p_ref: created.guarantee_ref });
  const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
  const paymentUrl = token && appUrl ? `${appUrl}/pay?token=${token}` : null;

  // ---- response -------------------------------------------------------------
  // Explicit field list. Section 10 of the spec is default-deny: commission
  // rates, Stripe and PandaDoc identifiers, storage paths, partner_id and
  // referrer_id are excluded by construction, not by remembering to strip them.
  return {
    status: 201,
    applicationId: created.id,
    body: {
      application: {
        id: created.id,
        guarantee_ref: created.guarantee_ref,
        status: created.status,
        created_at: created.created_at,
        sent_at: created.sent_at,
        expiry_date: created.expiry_date,
        tenant: {
          title: created.tenant_title,
          first_name: created.tenant_first_name,
          last_name: created.tenant_last_name,
          date_of_birth: created.tenant_dob,
          email: created.tenant_email,
          phone: created.tenant_phone,
        },
        property: {
          address_line_1: created.prop_addr1,
          address_line_2: created.prop_addr2,
          city: created.prop_city,
          county: created.prop_county,
          postcode: created.prop_postcode,
        },
        tenancy: {
          monthly_rent: created.monthly_rent,
          start_date: created.tenancy_start,
        },
        org: { agency_id: agencyId, branch_id: branchId, created: orgCreated },
        referrer: { email: referrerEmail },
      },
      payment_url: paymentUrl,
    },
  };
}

/** Exposed for the router: hash of the canonicalised body, minus the idempotency key itself. */
export async function requestHash(body: Record<string, unknown>): Promise<string> {
  const copy: Record<string, unknown> = { ...body };
  delete copy.idempotency_key;
  return await sha256Hex(canonical(copy));
}
