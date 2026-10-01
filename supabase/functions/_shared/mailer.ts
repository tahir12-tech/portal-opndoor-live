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
// One default, not fourteen. Nine modules said noreply and six said payments,
// so an unset EMAIL_FROM sent from two addresses depending on the email.
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "opndoor <noreply@opndoor.co>";
/* REPLY GOES WHERE THE FOOTER SAYS. Matt, 2026-10-01: "Set the
   Reply-To header on every email to support@opndoor.co, so pressing
   Reply also reaches support."

   The default was hello@opndoor.co, the general contact address, so
   the footer told a reader one thing and the Reply button did
   another the moment EMAIL_REPLY_TO was unset -- which it is. The
   env var still wins, because a live environment may route support
   somewhere else, but the fallback is now the address the email
   itself prints. */
const REPLY_TO = Deno.env.get("EMAIL_REPLY_TO") ?? "support@opndoor.co";

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
    from: EMAIL_FROM,
    to: routed.to,
    reply_to: REPLY_TO,
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
