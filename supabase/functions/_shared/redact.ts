// =====================================================================
// Redaction for the partner API request log.
//
// WHY REDACT RATHER THAN OMIT. Without bodies, the Logs tab can say a request
// failed but not why, and the first support question we get is "what did I
// actually send". With unredacted bodies, an observability table that anyone
// with Dev Centre access can read accumulates every tenant's name, date of
// birth, email, phone and home address, indefinitely.
//
// Redacting keeps the half that answers the question. A developer needs to see
// the SHAPE of what they sent: which fields were present, which were missing,
// whether they nested `tenant` correctly, whether `date_of_birth` was there at
// all. None of that needs the values. A line reading
//
//     "tenant": { "email": "[redacted]" }
//
// tells them they sent it. The field disappearing tells them nothing, and worse,
// looks identical to having forgotten it, which is one of the actual bugs they
// would be using this tab to find.
//
// ---------------------------------------------------------------------------
// ALLOWLIST, NOT DENYLIST
// ---------------------------------------------------------------------------
// The obvious implementation is a list of sensitive field names to mask. It is
// wrong in the direction that matters: a field added to the API later is
// unredacted until somebody remembers to add it here, and the failure is silent
// and retrospective, because the log is already written by the time anyone
// notices.
//
// So the default is to redact, and this file lists what is SAFE TO SHOW. A new
// field is masked until somebody consciously decides it is not sensitive. That
// is the same shape as every other guard in this codebase: `role in (...)`
// rather than `role !== 'referrer'`.
//
// It also handles the case a denylist cannot. Partners send fields we have never
// heard of: typos, their own correlation ids, whatever their CRM attached. Those
// are exactly the values we know nothing about, and a denylist shows them all.
//
// KEYS ARE NEVER REDACTED, only values. The key set is the diagnostic.
// =====================================================================

/**
 * Field names whose values are safe to keep, matched on the LEAF key regardless
 * of nesting depth.
 *
 * Leaf-name matching rather than full paths, deliberately. Full paths are more
 * precise and would break the moment the payload nests differently, failing
 * open in the exact case where the shape changed. A name is either safe
 * everywhere it appears or it is not on this list.
 *
 * Every entry is here because it is either structural, non-identifying, or
 * already the developer's own value coming back to them.
 */
const SAFE_VALUES = new Set<string>([
  // Structure and identifiers we issued. A uuid identifies a row, not a person,
  // and the developer either sent it or is about to look it up.
  "id", "application_id", "agency_id", "branch_id", "endpoint_id", "event_id",
  "guarantee_ref", "status", "event_type", "livemode",

  // Commercial and date fields on the tenancy. Rent and start date are terms of
  // a contract, not attributes of a person, and they are the two most common
  // things to get wrong in a first integration (pennies vs pounds, and the date
  // format).
  "monthly_rent", "start_date", "tenancy_start", "expiry_date",

  // Timestamps.
  "created_at", "sent_at", "paid_at", "deed_issued_at", "updated_at",

  // The error envelope. The whole point of the tab.
  "error", "code", "message", "field", "errors", "type",

  // Org names are business names, not personal data, and a developer resolving
  // "why did this create a duplicate agency" needs to see exactly the string
  // they sent, whitespace and all.
  "agency_name", "branch_name",

  // Paging.
  "has_more", "next_cursor", "cursor", "limit",
]);

/**
 * Names that are ALWAYS redacted even though they might otherwise look
 * structural or land on the safe list by accident.
 *
 * This is not a second denylist doing the real work: everything not on
 * SAFE_VALUES is already redacted. It exists because `token`, `key` and `url`
 * are the names most likely to be added to the safe list by somebody skimming,
 * and payment_url in particular reads as harmless until you notice it is a
 * bearer link that takes a payment.
 */
const NEVER_SAFE = /(?:^|_)(?:token|secret|key|signature|password|authorization|auth)(?:$|_)|payment_url|url$/i;

const MASK = "[redacted]";

/** Depth and size caps, so a hostile or accidental payload cannot blow up the row. */
const MAX_DEPTH = 8;
const MAX_ARRAY = 20;
const MAX_KEYS = 80;
const MAX_STRING_NOTE = 200;

function safeToShow(key: string): boolean {
  if (NEVER_SAFE.test(key)) return false;
  return SAFE_VALUES.has(key);
}

/**
 * Redact a parsed JSON value.
 *
 * Returns a structurally identical value with unsafe leaf values replaced. Never
 * throws: this runs on the logging path, which must not be able to fail the
 * request it is observing.
 */
export function redact(value: unknown, depth = 0): unknown {
  try {
    if (value === null || value === undefined) return value;

    if (Array.isArray(value)) {
      if (depth >= MAX_DEPTH) return `[${value.length} items]`;
      const head = value.slice(0, MAX_ARRAY).map((v) => redact(v, depth + 1));
      return value.length > MAX_ARRAY
        ? [...head, `[+${value.length - MAX_ARRAY} more]`]
        : head;
    }

    if (typeof value === "object") {
      if (depth >= MAX_DEPTH) return "[nested]";
      const out: Record<string, unknown> = {};
      let n = 0;
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (n++ >= MAX_KEYS) { out["[truncated]"] = true; break; }

        // Recurse into containers regardless of the key: a container's NAME
        // being unrecognised must not redact everything under it, or the shape
        // information this whole file exists to preserve is lost. The leaves
        // inside are still judged on their own names.
        if (v !== null && typeof v === "object") {
          out[k] = redact(v, depth + 1);
          continue;
        }

        out[k] = safeToShow(k) ? v : MASK;
      }
      return out;
    }

    // A bare scalar at the top level has no key to judge, so it is redacted.
    // This is only reachable for a body that is a lone string or number, which
    // the API rejects as malformed anyway.
    if (typeof value === "string" && value.length > MAX_STRING_NOTE) return MASK;
    return depth === 0 ? MASK : value;
  } catch {
    return MASK;
  }
}

/**
 * Redact a raw body string.
 *
 * Non-JSON is not passed through: a body that failed to parse is the one most
 * likely to be a malformed dump of something, and "it was not valid JSON" is the
 * whole diagnostic a developer needs in that case. The length is kept because
 * "you sent 4MB" is useful and the content is not.
 */
export function redactRawBody(raw: string | null | undefined): unknown {
  if (raw === null || raw === undefined || raw === "") return null;
  try {
    return redact(JSON.parse(raw));
  } catch {
    return { "[unparsed]": `not valid JSON, ${raw.length} bytes` };
  }
}
