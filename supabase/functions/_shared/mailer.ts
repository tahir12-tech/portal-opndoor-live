// =====================================================================
// THE sender. One place that talks to Resend.
//
// There were ten copies of sendEmail, each with its own markup, its own
// EMAIL_FROM default and its own idea of what a failure looked like. Four had
// drifted. The review banner was exported once and called by none of them.
//
// A caller now supplies a Message (subject, heading, blocks) and an address.
// Everything else, the chrome, the banner, the plain-text part, the redirect
// rule and the failure shape, happens here.
// =====================================================================

import { resolveRecipients, type Recipients } from "./emailRecipients.ts";
import { renderHtml, renderText, type Message } from "./emailLayout.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
/* =====================================================================
   WHO EVERY EMAIL COMES FROM, AND WHY IT IS A SETTING.

   Matt, 2026-10-01: "Every email is sent from no-reply@opndoor.co
   (display name 'opndoor'), with no Reply-To ... The sender address is
   a setting, not hardcoded."

   THREE SOURCES, IN THIS ORDER, each a fallback for the one before
   being ABSENT and never for it being wrong:

     app_settings.email_from   what an admin can change, from Health,
                               without a deploy and with an audit row.
     EMAIL_FROM                the environment, for a deployment that
                               must send before anybody can sign in to
                               set the setting.
     the literal below         so an email is never unsendable for
                               want of configuration.

   An env var alone was not a setting: changing it means a secret
   change and a redeploy of every edge function, by somebody with
   Supabase access. Nobody running the business could do it, or even
   see what it was.

   THE HYPHEN IS NOT A TYPO. The old default was noreply@opndoor.co;
   Matt's is no-reply@opndoor.co. Different mailbox.
   ===================================================================== */
const EMAIL_FROM_ENV = Deno.env.get("EMAIL_FROM");
const EMAIL_FROM_FALLBACK = "opndoor <no-reply@opndoor.co>";

/* READ ONCE PER COLD START, not per email: a statement run sends
   hundreds in a loop and each would otherwise cost a round trip to
   answer a question whose answer changes about once a year. A setting
   change reaches the functions at their next cold start, which is the
   same latency every other app setting has. */
let cachedFrom: string | null = null;
async function senderAddress(): Promise<string> {
  if (cachedFrom) return cachedFrom;
  if (EMAIL_FROM_ENV) { cachedFrom = EMAIL_FROM_ENV; return cachedFrom; }
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (url && key) {
      const res = await fetch(`${url}/rest/v1/rpc/email_from`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: "{}",
      });
      if (res.ok) {
        const v = await res.json();
        if (typeof v === "string" && v.trim()) { cachedFrom = v.trim(); return cachedFrom; }
      }
    }
  } catch { /* the fallback below is the point of having one */ }
  cachedFrom = EMAIL_FROM_FALLBACK;
  return cachedFrom;
}

/* NO REPLY-TO AT ALL. Matt, 2026-10-01, revising his own instruction of
   the same day: the footer carries a mailto to support@opndoor.co and
   the sender is a no-reply mailbox, so a Reply-To would be a third
   answer to "where does a reply go" and a contradiction of the address
   it was sent from. A reader who presses Reply should be stopped by
   their own mail client, not quietly redirected. */

export interface SendResult {
  ok: boolean;
  error?: string;
  to?: string;
  redirected?: boolean;
  intended?: string;
}

/** An attachment, already fetched. Resend wants base64. */
export interface Attachment { filename: string; content: string }

/** Base64 of raw bytes, for a Resend Attachment. Chunked, because
    String.fromCharCode(...wholeArray) overflows the argument stack on a file of
    any size, and the CSV path's btoa(unescape(encodeURIComponent(...))) corrupts
    binary. A PDF is bytes, so this is the one correct encoder. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export async function sendMessage(opts: {
  to: string | string[];
  message: Message;
  attachments?: Attachment[];
}): Promise<SendResult> {
  if (!RESEND_API_KEY) return { ok: false, error: "Resend is not configured (RESEND_API_KEY not set)." };

  const routed: Recipients = resolveRecipients(opts.to);
  if (!routed.to.length) return { ok: false, error: "No recipient email provided." };

  const body: Record<string, unknown> = {
    from: await senderAddress(),
    to: routed.to,
    subject: opts.message.subject,
    // BOTH parts, always. A message with no text/plain scores as spam and is
    // unreadable on a watch, and the text is derived from the same blocks so it
    // cannot drift from the HTML.
    html: renderHtml(opts.message, routed),
    text: renderText(opts.message, routed),
  };
  if (opts.attachments?.length) body.attachments = opts.attachments;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text();
      return { ok: false, error: `Resend responded ${res.status}: ${detail.slice(0, 200)}`,
               to: routed.to.join(", "), redirected: routed.redirected, intended: routed.intended.join(", ") };
    }
    return { ok: true, to: routed.to.join(", "), redirected: routed.redirected, intended: routed.intended.join(", ") };
  } catch (e) {
    return { ok: false, error: `Resend request failed: ${e instanceof Error ? e.message : String(e)}`,
             to: routed.to.join(", ") };
  }
}
