// =====================================================================
// Where outbound email actually goes.
//
// ONE PLACE, DELIBERATELY. This logic used to be copied into thirteen sending
// modules. That is why removing it took thirteen separate edits, why four of
// them ended up subtly different from each other, and why every one of the
// thirteen file headers went on claiming a safety property that had stopped
// being true. A rule enforced in thirteen places is thirteen chances to be
// wrong about it.
//
// ---------------------------------------------------------------------------
// THE RULE
// ---------------------------------------------------------------------------
//   EMAIL_REVIEW_ADDRESS set    every recipient is replaced by it. Nobody real
//                               is contacted, whatever the caller passes.
//   EMAIL_REVIEW_ADDRESS unset  mail goes to the real recipient.
//
// PRODUCTION LEAVES IT UNSET and behaves exactly as it does today. This is not
// a change to live behaviour; it is a switch that non-production environments
// can turn on, which is what was missing.
//
// The direction matters. The safe behaviour is the one you get by CONFIGURING
// something, and the live behaviour is the default. The alternative, a flag that
// must be set to be safe, fails open on a fresh environment: somebody stands up
// a staging project, copies the secrets except one, and emails real tenants.
//
// ---------------------------------------------------------------------------
// WHY NOT KEEP THE ORIGINAL SHAPE
// ---------------------------------------------------------------------------
// The version that was commented out sent to the review address AND the real
// recipient:
//
//     const recipients = [REVIEW_ADDRESS];
//     if (opts.to && opts.to !== REVIEW_ADDRESS) recipients.push(opts.to);
//
// That is not a redirect, it is a copy. A test build using it still emailed the
// real tenant. Restoring it as written would have restored a safety property
// that never existed. This replaces, and it is worth knowing that the difference
// is deliberate rather than an oversight in the port.
// =====================================================================

/** The review inbox, when one is configured. Trimmed: a trailing space in a
    dashboard secret is otherwise an address that silently fails to parse. */
const REVIEW_ADDRESS = (Deno.env.get("EMAIL_REVIEW_ADDRESS") ?? "").trim();

/** True when this deployment redirects all mail. Cheap enough to call per send. */
export function isRedirecting(): boolean {
  return REVIEW_ADDRESS.length > 0;
}

export interface Recipients {
  /** Who the message will actually be delivered to. */
  to: string[];
  /** True when `to` is the review inbox rather than the intended recipient. */
  redirected: boolean;
  /** Who it was addressed to before any redirect. For the audit trail. */
  intended: string[];
}

/**
 * Resolve the delivery addresses for a send.
 *
 * Accepts one address or several, because expiry-reminders fans out over a
 * comma-separated list and passing it through the same function is how that path
 * stays covered by the same rule.
 */
export function resolveRecipients(intended: string | string[]): Recipients {
  const list = (Array.isArray(intended) ? intended : String(intended ?? "").split(","))
    .map((a) => a.trim())
    .filter(Boolean);

  if (!isRedirecting()) return { to: list, redirected: false, intended: list };

  // ONE address, not the list plus the review inbox. See the header.
  return { to: [REVIEW_ADDRESS], redirected: true, intended: list };
}

/**
 * The line to put in an activity log entry, or null when there is nothing to
 * say.
 *
 * Returning null when nothing was redirected is the point. The previous code
 * wrote "Redirected to <address> (test mode)" unconditionally, so once the
 * redirect was removed every application carried an audit row asserting a
 * safety property that was not in force, naming the real tenant as the redirect
 * target. See DEFECTS.md 7.
 */
export function redirectNote(r: Recipients): string | null {
  if (!r.redirected) return null;
  return `Redirected to ${r.to.join(", ")} (EMAIL_REVIEW_ADDRESS is set on this environment). `
    + `Intended recipient: ${r.intended.join(", ") || "none"}.`;
}

/**
 * A banner for the top of an email body, when redirecting.
 *
 * weekly-digest passed `redirected: false` as a literal, so its banner was dead
 * code. Callers that support a banner should use this instead of deciding for
 * themselves.
 */
export function redirectBanner(r: Recipients): string {
  if (!r.redirected) return "";
  return `<div style="padding:10px 16px;background:#fffbeb;border-bottom:1px solid #fde68a;`
    + `font:600 12px system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#78350f;">`
    + `Review copy. This would have gone to ${r.intended.join(", ") || "an unknown recipient"}.`
    + `</div>`;
}
