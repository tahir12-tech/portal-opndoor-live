// =====================================================================
// Which table a tenant's edit belongs to, and when a delivery contact is
// safe to write.
//
// This is here, pure and tested, because getting it wrong is INVISIBLE. The
// 2026-08-12 identity split moved title/name/dob/phone from application_profiles
// onto applications.tenant_*, but the form still sends a whole "details" patch
// to one save. tenant-portal routed the lot to application_profiles, so every
// identity keystroke hit a column that no longer existed and the save 500'd,
// which the client shows as "Could not save. We will try again as you type."
// A tenant mid-form watched their typing fail to stick with no way to know why.
//
// A column rename in a migration cannot fail a deployed function's compile, so
// nothing catches this except a test that knows where each field now lives.
// =====================================================================

/** Form field -> applications column. Everything else is a declaration and
    belongs on application_profiles. Keep in step with BASIC_FIELDS on the
    client and the applications.tenant_* columns. */
export const IDENTITY_TO_COLUMN: Record<string, string> = {
  title: "tenant_title",
  first_name: "tenant_first_name",
  last_name: "tenant_last_name",
  dob: "tenant_dob",
  phone: "tenant_phone",
};

export interface SplitPatch {
  /** Goes to applications.tenant_*. */
  identity: Record<string, unknown>;
  /** Goes to application_profiles. */
  declarations: Record<string, unknown>;
}

/**
 * Split one "details" patch into the two tables it now spans.
 *
 * An empty string clears a field, but a date column rejects "" where it takes
 * null, so identity blanks are normalised to null. Declarations pass through
 * untouched: null is a real "cleared" there and "" is the client's own.
 */
export function splitProfilePatch(raw: Record<string, unknown>): SplitPatch {
  const identity: Record<string, unknown> = {};
  const declarations: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    const col = IDENTITY_TO_COLUMN[key];
    if (col) identity[col] = value === "" ? null : value;
    else declarations[key] = value;
  }
  return { identity, declarations };
}

/**
 * Whether a delivery contact patch is complete enough to write.
 *
 * The delivery_contact_named check requires the naming field for the chosen
 * kind: an agency name for a letting agent, a surname for a private landlord.
 * kind and email are NOT NULL. Writing before all three are present is a
 * constraint violation, so the partial is held client side instead, exactly as
 * the form does while a section is half filled.
 */
export function deliveryContactReady(p: Record<string, unknown>): boolean {
  const has = (k: string) => String(p?.[k] ?? "").trim() !== "";
  if (!has("kind") || !has("email")) return false;
  if (p.kind === "letting_agent") return has("agency_name");
  if (p.kind === "private_landlord") return has("last_name");
  return false;
}


/**
 * The declaration tick, translated to a timestamp.
 *
 * The form's confirmation is a checkbox, but the schema stores the signing as
 * declared_at (Option A: no boolean, "confirmed" is a time). So a patch that
 * carries declared_true is rewritten: ticked stamps declared_at, unticked
 * clears it, and declared_true itself never reaches the table (it has no
 * column, and writing it is the 42703 this whole area kept producing).
 *
 * Pure: the caller passes the timestamp, so the signing time is the server's,
 * not the browser's clock.
 */
export function resolveDeclaredAt(
  declarations: Record<string, unknown>, nowIso: string,
): Record<string, unknown> {
  if (!('declared_true' in (declarations ?? {}))) return declarations;
  const { declared_true, ...rest } = declarations;
  const ticked = declared_true === true || declared_true === 'true';
  return { ...rest, declared_at: ticked ? nowIso : null };
}
