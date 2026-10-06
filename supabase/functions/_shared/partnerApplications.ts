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
  /* THE ADDRESS IS MATCHED EXACTLY, NOT AS A PATTERN. Backlog B4.
     `.ilike()` takes a SQL LIKE pattern, and `email` is the request body
     verbatim -- so `a%@rightmove.co.uk` matched, and the refusal below
     answered yes or no about it. That is a cross-partner existence oracle for
     other suppliers' staff addresses, binary-searchable at the API's own rate
     limit, creating nothing. The lookup wants equality, case-insensitively,
     which is what lower() gives without a pattern language. */
  const key = email.trim().toLowerCase();

  const { data: mine } = await service
    .from("users")
    .select("id")
    .eq("partner_id", partnerId)
    .eq("email", key)
    .maybeSingle();

  if (mine) return { id: mine.id };

  /* Is the address known under a DIFFERENT partner? If so, refuse. The message
     deliberately does not say which partner, or even confirm one exists.

     NOT `.neq("partner_id", …)`. Backlog B5: SQL `<>` is never true for NULL,
     and users_partner_by_role REQUIRES partner_id to be NULL for every
     superadmin and opndoor_manager -- so this guard was blind to exactly the
     accounts that matter most. Asked as "known to somebody who is not us",
     which includes them.

     And `.limit(2)` rather than maybeSingle: maybeSingle ERRORS on two rows
     and the error was discarded, so two matches read as "not known" -- the
     opposite of the intended answer. */
  const { data: others } = await service
    .from("users")
    .select("id, partner_id")
    .eq("email", key)
    .limit(2);
  const elsewhere = (others ?? []).some((u: { partner_id: string | null }) => u.partner_id !== partnerId);

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
 * Resolve the org to a branch id. RESOLVE ONLY: this never creates anything.
 *
 * Partners create the agency and branch in the portal first, with a contact
 * email, and only then send applications against it. The API previously created
 * orgs by name on the fly, which meant a typo in a partner's CRM produced a real
 * agency in our reconciliation queue that a human then had to merge by hand.
 *
 * Two accepted forms, and names are the expected one:
 *   { agency_name, branch_name }   resolved by normalised name
 *   { agency_id, branch_id }       our ids, from GET /v1/orgs
 */
async function resolveOrg(
  // deno-lint-ignore no-explicit-any
  service: any,
  partnerId: string,
  org: Record<string, unknown>,
  /* THE KEY THAT ASKED, for the audit trail on anything created below. An API
     key is not a person, so what goes on the org_audit row is the key's own
     NAME: "Rightmove production" rather than a uuid nobody can read. */
  apiKeyId: string | null,
): Promise<{ branchId: string; agencyId: string; created?: string[] } | { error: FieldError }> {
  const agencyId = str(org.agency_id);
  const branchId = str(org.branch_id);
  const agencyName = str(org.agency_name);
  const branchName = str(org.branch_name);

  // ---- by id -------------------------------------------------------------
  if (agencyId || branchId) {
    if (!agencyId || !branchId) {
      return {
        error: {
          field: !agencyId ? "org.agency_id" : "org.branch_id",
          code: "required",
          message: "Send both agency_id and branch_id, or send agency_name and branch_name instead.",
        },
      };
    }

    const { data: branch } = await service
      .from("branches")
      .select("id, agency_id, partner_id")
      .eq("id", branchId)
      .maybeSingle();

    // Same error whether the branch does not exist or belongs to another
    // partner, so the API cannot be used to probe for another partner's orgs.
    //
    // livemode is NOT checked. Orgs are no longer per mode: a sandbox
    // application references the partner's real branch, because the org is not
    // the thing being rehearsed.
    if (!branch || branch.partner_id !== partnerId || branch.agency_id !== agencyId) {
      // A branch that exists and belongs to somebody else is a different event
      // from one that does not exist, and the caller must not be able to tell
      // them apart. The response below is identical either way; this only
      // decides whether we hear about it. Fire and forget.
      if (branch && branch.partner_id !== partnerId) {
        service.rpc("record_security_event", {
          p_kind: "cross_partner_access",
          p_severity: "warn",
          p_partner: partnerId,
          p_detail: "A key for this partner referenced a branch belonging to another partner when creating an application. Refused with the standard not-found response.",
        }).then(() => {}, () => {});
      }
      return {
        error: { field: "org.branch_id", code: "not_found", message: "Unknown branch for this partner." },
      };
    }

    return await withContact(service, branchId, agencyId, "org.branch_id");
  }

  // ---- by name -----------------------------------------------------------
  // A missing agency_name is NOT rejected here any more. For a partner that
  // owns its stock and has exactly one agency, the key already identifies it,
  // and partner_api_resolve_org resolves it. For a supplier, and for a group
  // with several brands, that same function still answers agency_required, and
  // the case below turns it into the identical error this used to return.
  //
  // The decision moved to SQL rather than being duplicated here, because two
  // implementations of "may this caller omit the agency" would drift, and the
  // one that drifts open attaches real money to an arbitrary agency.
  if (!agencyName && !branchName) {
    return {
      error: {
        field: "org.agency_name",
        code: "required",
        message: "Send agency_name and branch_name, or agency_id and branch_id from GET /v1/orgs.",
      },
    };
  }

  const { data: rows, error: resolveErr } = await service.rpc("partner_api_resolve_org", {
    p_partner: partnerId,
    p_agency_name: agencyName,
    p_branch_name: branchName,
  });
  if (resolveErr) {
    return { error: { field: "org.agency_name", code: "not_found", message: "Could not resolve the organisation." } };
  }
  const r = Array.isArray(rows) ? rows[0] : rows;

  // Each outcome gets its own message. Collapsing them into "not found" is what
  // makes a partner spend an hour checking their spelling when the real problem
  // is that we hold two branches with the same name.
  switch (r?.outcome) {
    case "ok":
      return await withContact(service, r.branch_id, r.agency_id, "org.branch_name");

    case "agency_required":
      return {
        error: {
          field: "org.agency_name",
          code: "required",
          // detail carries the brand names when the caller owns several, so a
          // group integrator can fix the call without opening a ticket.
          message: r.detail
            ? `An agency name is required. Your account holds: ${r.detail}.`
            : "An agency name is required.",
        },
      };

    /* =====================================================================
       AN UNKNOWN AGENCY IS NOT NECESSARILY AN ERROR ANY MORE.

       Matt, 2026-10-03, approving the design: "the API can create the agency
       (name, address, agency email) and office for that supplier, checked
       against existing ones for duplicates, landing in Reconciliation."

       OPT IN, SO MOST PARTNERS SEE NO CHANGE AT ALL.
       `partner_api_create_org` reads `api_may_create_agencies` off the
       partner, which defaults to false, and answers `creation_not_enabled`.
       That is turned back into the message below, word for word, so a partner
       without the flag gets exactly the response they got yesterday.

       THE DECISION IS IN SQL, not here, which is the same reasoning the
       `agency_required` comment above records: two implementations of "may
       this caller create an agency" would drift, and the one that drifts open
       writes rows into somebody's book.
       ===================================================================== */
    case "agency_not_found":
    case "branch_not_found": {
      const made = await tryCreateOrg(service, partnerId, org, apiKeyId, r?.outcome, r?.detail);
      if (made) return made;
      return r?.outcome === "agency_not_found"
        ? {
          error: {
            field: "org.agency_name",
            code: "not_found",
            message: "No agency of that name exists for your account. Create it in the opndoor portal first, with a contact email, then send applications against it. Names are matched ignoring case, surrounding spaces and a trailing Ltd or Limited.",
          },
        }
        : {
          error: {
            field: "org.branch_name",
            code: "not_found",
            message: `No branch of that name exists under that agency. Create it in the opndoor portal first. Branches we hold: ${r.detail || "none"}.`,
          },
        };
    }

    case "branch_required":
      return {
        error: {
          field: "org.branch_name",
          code: "required",
          message: `That agency has more than one branch, so name the one you mean: ${r.detail || ""}.`,
        },
      };

    case "agency_ambiguous":
      return {
        error: {
          field: "org.agency_name",
          code: "ambiguous",
          // Our data problem, not theirs, and said so. Picking one would attach
          // real money to an arbitrary record.
          message: `That name matches more than one agency on your account (${r.detail}), so it is not clear which you mean. Send agency_id and branch_id from GET /v1/orgs, or contact opndoor to have the duplicates merged.`,
        },
      };

    case "branch_ambiguous":
      return {
        error: {
          field: "org.branch_name",
          code: "ambiguous",
          message: "That agency has more than one branch with that name, so it is not clear which you mean. Send branch_id from GET /v1/orgs, or contact opndoor to have the duplicates merged.",
        },
      };

    default:
      return { error: { field: "org.agency_name", code: "not_found", message: "Could not resolve the organisation." } };
  }
}

/**
 * A branch that cannot resolve a primary agent contact cannot produce a deed.
 *
 * Checked at POST rather than at deed generation, because the alternative is
 * accepting the application, taking the tenant's money, and failing afterwards.
 * GET /v1/orgs exposes the same condition as has_agent_contact so a partner can
 * fix their data before sending any traffic.
 */
// deno-lint-ignore no-explicit-any
/* =====================================================================
   CREATE THE AGENCY AND THE OFFICE, IF THIS SUPPLIER HAS ASKED FOR THAT.

   Matt's approved design, in his own order: "opt-in flag defaulting to false,
   suppliers only, agency email required, reuse on an exact (normalised)
   match, refuse on ambiguous, land in Reconciliation, response says what was
   created, audited with the key name."

   RETURNS null TO MEAN "NOT MY CASE", which is what lets the caller fall
   through to the message it has always returned. Every refusal that is about
   the CREATION rather than about the lookup gets its own field error instead,
   because "no agency of that name, create it in the portal" is actively
   misleading to a partner who has the flag on and simply left the email out.

   EVERY OUTCOME IS NAMED. The default arm exists for a future outcome the SQL
   grows and this file has not heard of: it falls through to the old message
   rather than inventing a response, which is the safe direction.
   ===================================================================== */
async function tryCreateOrg(
  // deno-lint-ignore no-explicit-any
  service: any,
  partnerId: string,
  org: Record<string, unknown>,
  apiKeyId: string | null,
  lookup: string | undefined,
  lookupDetail: string | undefined,
): Promise<{ branchId: string; agencyId: string; created?: string[] } | { error: FieldError } | null> {
  const { data: rows, error } = await service.rpc("partner_api_create_org", {
    p_partner: partnerId,
    p_api_key: apiKeyId,
    p_agency_name: str(org.agency_name),
    p_agency_email: str(org.agency_email),
    p_agency_address: str(org.agency_address),
    p_branch_name: str(org.branch_name),
    p_branch_address: str(org.branch_address),
    p_branch_email: str(org.branch_email),
  });
  // A failed call is not a refusal. Fall through to the lookup's own message
  // rather than telling a partner their agency could not be created when we
  // do not know that it could not.
  if (error) return null;
  const c = Array.isArray(rows) ? rows[0] : rows;

  switch (c?.outcome) {
    case "ok":
      /* THE CONTACT CHECK STILL RUNS. An agency created here has the email
         that was sent, so it passes; one that already existed with no contact
         does not, and must be refused for the same reason it always was. */
      return await withContactCreated(service, c.branch_id, c.agency_id, c.created ?? []);

    /* NOT ENABLED, OR NOT A SUPPLIER: this is not our case. The caller
       returns the message it has always returned, so a partner without the
       flag cannot tell from the response that the feature exists. */
    case "creation_not_enabled":
    case "creation_not_available":
    case "unknown_partner":
      return null;

    case "agency_email_required":
      return {
        error: {
          field: "org.agency_email",
          code: "required",
          message: "We do not hold an agency of that name. Send agency_email as well and we will create it: signed deeds for its offices go to that address.",
        },
      };

    case "agency_email_invalid":
      return {
        error: { field: "org.agency_email", code: "invalid", message: "That is not a valid email address." },
      };

    case "agency_required":
      return {
        error: { field: "org.agency_name", code: "required", message: "An agency name is required." },
      };

    /* AMBIGUOUS IS OUR DATA PROBLEM, and it is reported as one: picking one of
       two agencies that normalise the same would attach real money to a
       guess. The names are ours and this key can already read them from GET
       /v1/orgs, so naming them turns a mystery into a correction. */
    case "agency_ambiguous":
      return {
        error: {
          field: "org.agency_name",
          code: "ambiguous",
          message: `We hold more than one agency with that name: ${c.detail || ""}. Send agency_id and branch_id from GET /v1/orgs instead.`,
        },
      };

    case "branch_ambiguous":
      return {
        error: {
          field: "org.branch_name",
          code: "ambiguous",
          message: `That agency has more than one office with that name: ${c.detail || ""}. Send agency_id and branch_id from GET /v1/orgs instead.`,
        },
      };

    default:
      // An outcome this file has not heard of. The lookup's own message is
      // the safe answer; `lookup` and `lookupDetail` are what produced it.
      console.log(JSON.stringify({
        event: "create_org_unknown_outcome", outcome: c?.outcome, lookup, lookupDetail,
      }));
      return null;
  }
}

/** withContact, carrying what was created so the response can say. */
async function withContactCreated(
  // deno-lint-ignore no-explicit-any
  service: any, branchId: string, agencyId: string, created: string[],
): Promise<{ branchId: string; agencyId: string; created?: string[] } | { error: FieldError }> {
  const r = await withContact(service, branchId, agencyId, "org.agency_name");
  if ("error" in r) return r;
  return { ...r, created };
}

async function withContact(
  service: any, branchId: string, agencyId: string, field: string,
): Promise<{ branchId: string; agencyId: string } | { error: FieldError }> {
  const { data: contactOk } = await service.rpc("effective_primary_contact", { p_branch: branchId });
  const contact = Array.isArray(contactOk) ? contactOk[0] : contactOk;
  if (!contact?.email) {
    return {
      error: {
        field,
        code: "no_agent_contact",
        message: "That branch has no primary agent contact, so a deed could not be issued. Add one in the opndoor portal.",
      },
    };
  }
  return { branchId, agencyId };
}

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
  /* THE KEY THAT ASKED. Optional so every existing caller and test compiles
     unchanged; without it an org created through this path is audited as "an
     API key", which is true and is all we would know. */
  apiKeyId: string | null = null,
): Promise<CreateOutcome> {
  const fields: FieldError[] = [];
  /* WHAT THIS CALL CREATED, for the response. Matt: "response says what was
     created." Empty on every ordinary call, which is most of them. */
  let createdOrg: string[] = [];

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
  if (referrerId) {
    const o = await resolveOrg(service, partnerId, org, apiKeyId);
    if ("error" in o) fields.push(o.error);
    else {
      branchId = o.branchId;
      agencyId = o.agencyId;
      createdOrg = o.created ?? [];
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
    // ONLY OUR OWN MESSAGES REACH THE PARTNER.
    //
    // This used to return createErr.message unconditionally. create_referral_api
    // raises its own refusals with SQLSTATE 22023 and those messages are written
    // for a partner to read, so passing those through is right. Anything else is
    // Postgres talking: a constraint violation naming a table and a column, a
    // type error naming a function, a permission error naming a role. That is
    // exactly what section 10.2 of the spec promises is never returned, and it
    // was being returned on the one path most likely to hit an unexpected error.
    //
    // Unknown codes get a flat message and the detail goes to the server log,
    // where the request id ties it back.
    const ours = createErr?.code === "22023";
    if (!ours && createErr) {
      console.log(JSON.stringify({ event: "create_failed_internal", code: createErr.code, message: createErr.message }));
    }
    return {
      status: 422,
      body: {
        error: {
          code: "validation_failed",
          message: "The application was not created.",
          fields: [{
            field: "",
            code: "rejected",
            message: ours && createErr?.message
              ? createErr.message
              : "The application could not be created. Quote the request id if this persists.",
          }],
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
        /* THE IDS, so a partner who sent NAMES can store them against their
           own records and send ids from then on.

           AND WHAT THIS CALL CREATED, which is Matt's own requirement:
           "response says what was created". It is an ARRAY of what was made,
           not a boolean: a call can create an agency and an office, or just
           an office under an agency that already existed, and those are
           different facts to a partner reconciling their own records.

           OMITTED ENTIRELY WHEN NOTHING WAS CREATED, which is almost every
           call. A `created: []` on every response is a field integrators
           would start branching on, and the earlier version of this object
           carried exactly that mistake: a `created` flag that was always
           false. Absent means nothing happened. */
        org: {
          agency_id: agencyId,
          branch_id: branchId,
          ...(createdOrg.length ? { created: createdOrg } : {}),
        },
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
