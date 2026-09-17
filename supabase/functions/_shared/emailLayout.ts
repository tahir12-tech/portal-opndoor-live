// =====================================================================
// ONE layout. Every email wraps in it; no email writes its own chrome.
//
// WHY. Branding lived in ten copies of sendEmail and thirteen modules, so a
// colour change meant thirteen edits and four of them drifted. Worse, the
// review banner was written once, exported, and called by nobody: the function
// existed, looked like a safety feature, and rendered on zero emails.
//
// THE CONTRACT. A template supplies a subject, a heading, some blocks, and
// optionally one button. It never supplies a logo, a colour, a footer or a
// banner, and it never builds the plain-text version by hand. Adding a
// fourteenth email means writing its words.
//
// PLAIN TEXT IS NOT OPTIONAL. A message with no text/plain part scores as spam
// and is unreadable on a watch. It is derived from the same blocks, so it
// cannot drift from the HTML the way a hand-written second copy would.
// =====================================================================

import type { Recipients } from "./emailRecipients.ts";

// The app's own palette, from src/styles/portal.css. Hex, not CSS variables:
// no mail client resolves a custom property.
const VALHALLA = "#271d5f";
const VALHALLA_DEEP = "#1a1240";
const HELIOTROPE = "#d364fb";
const HELIOTROPE_DEEP = "#b54de0";
const INK_SOFT = "#5b4d86";
const INK_MUTE = "#8676ab";
const WHITE_LILAC = "#f8eff9";
const LINE = "#e7e0ef";
const CANVAS = "#f6f3fa";

// The app uses a display face for headings and a body face for prose. Mail
// clients will not load a webfont, so this is the stack that degrades closest.
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

/** A paragraph. */
export type Block =
  | { p: string }
  | { h: string }
  | { list: string[] }
  /** Label and value pairs, for a summary of an application or a payment. */
  | { rows: [string, string][] }
  /** Set apart, for a code or a reference. */
  | { callout: string }
  /** Quieter than a paragraph, for the sentence nobody needs to read twice. */
  | { small: string };

export interface Message {
  subject: string;
  /** The line at the top of the message, inside the card. */
  heading: string;
  blocks: Block[];
  /** At most one. Two calls to action in one email means neither is the action. */
  action?: { label: string; href: string };
  /** Shown under the action, for people who cannot click a button. */
  actionFallbackNote?: boolean;
  /** Which product this email is from. Tenant emails brand as the guarantor
      application; everything else as the referral portal. Defaults to portal so
      an unmarked template keeps today's branding. */
  audience?: "tenant" | "portal";
  /** Overrides the audience-based brand line in the header, for a recipient who
      is not a portal user (e.g. the executed deed emailed to a private
      landlord). */
  brandLabel?: string;
}

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ---------------------------------------------------------------------------
   The banner. Rendered by the LAYOUT, so it cannot be forgotten by a template.
   --------------------------------------------------------------------------- */
function banner(r?: Recipients): string {
  if (!r?.redirected) return "";
  const intended = r.intended.join(", ") || "an unknown recipient";
  return `
  <tr><td style="padding:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border-bottom:2px solid #f59e0b;">
      <tr><td style="padding:14px 28px;font:600 13px/1.5 ${FONT};color:#78350f;">
        <span style="display:inline-block;background:#f59e0b;color:#fff;border-radius:4px;padding:2px 8px;font-size:11px;letter-spacing:.04em;margin-right:8px;">REVIEW COPY</span>
        This was addressed to <strong>${esc(intended)}</strong> and redirected here.
        Nobody real received it.
      </td></tr>
    </table>
  </td></tr>`;
}

function blockHtml(b: Block): string {
  if ("h" in b) return `<h2 style="margin:26px 0 10px;font:700 16px/1.4 ${FONT};color:${VALHALLA};">${esc(b.h)}</h2>`;
  if ("p" in b) return `<p style="margin:0 0 14px;font:400 15px/1.65 ${FONT};color:${INK_SOFT};">${b.p}</p>`;
  if ("small" in b) return `<p style="margin:0 0 12px;font:400 13px/1.6 ${FONT};color:${INK_MUTE};">${b.small}</p>`;
  if ("callout" in b) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;">
      <tr><td style="background:${WHITE_LILAC};border:1px solid ${LINE};border-radius:10px;padding:16px 18px;
        font:700 22px/1.3 ${FONT};color:${VALHALLA};letter-spacing:.08em;text-align:center;">${esc(b.callout)}</td></tr></table>`;
  }
  if ("list" in b) {
    return `<ul style="margin:0 0 14px;padding-left:20px;font:400 15px/1.7 ${FONT};color:${INK_SOFT};">`
      + b.list.map((i) => `<li style="margin:0 0 4px;">${i}</li>`).join("") + `</ul>`;
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;">`
    + b.rows.map(([k, v]) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid ${LINE};font:400 13px/1.5 ${FONT};color:${INK_MUTE};">${esc(k)}</td>
        <td style="padding:8px 0;border-bottom:1px solid ${LINE};font:600 14px/1.5 ${FONT};color:${VALHALLA};text-align:right;">${esc(v)}</td>
      </tr>`).join("") + `</table>`;
}

/** The whole message, chrome included. */
export function renderHtml(m: Message, r?: Recipients): string {
  const action = m.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px;">
         <tr><td style="border-radius:999px;background:${HELIOTROPE};">
           <a href="${esc(m.action.href)}" style="display:inline-block;padding:14px 30px;font:700 15px/1 ${FONT};
              color:#fff;text-decoration:none;border-radius:999px;">${esc(m.action.label)}</a>
         </td></tr>
       </table>`
    : "";
  const fallback = m.action && m.actionFallbackNote !== false
    ? `<p style="margin:12px 0 0;font:400 12px/1.6 ${FONT};color:${INK_MUTE};word-break:break-all;">
         If the button does not work, paste this into your browser:<br>
         <span style="color:${HELIOTROPE_DEEP};">${esc(m.action.href)}</span></p>`
    : "";

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(m.subject)}</title></head>
<body style="margin:0;padding:0;background:${CANVAS};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CANVAS};">
  ${banner(r)}
  <tr><td align="center" style="padding:28px 16px 40px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

      <tr><td style="padding:0 0 18px;">
        <span style="font:800 24px/1 ${FONT};color:${VALHALLA};letter-spacing:-.02em;">opndoor</span>
        <span style="display:inline-block;margin-left:10px;padding-left:10px;border-left:1px solid ${LINE};
              font:600 10px/1.35 ${FONT};color:${INK_MUTE};letter-spacing:.08em;vertical-align:middle;">
          ${m.brandLabel ? esc(m.brandLabel).toUpperCase() : (m.audience === "tenant" ? "GUARANTOR<br>APPLICATION" : "GUARANTEE<br>REFERRAL PORTAL")}</span>
      </td></tr>

      <tr><td style="background:#fff;border:1px solid ${LINE};border-radius:14px;padding:32px 28px;">
        <h1 style="margin:0 0 16px;font:800 24px/1.25 ${FONT};color:${VALHALLA};letter-spacing:-.02em;">${esc(m.heading)}</h1>
        ${m.blocks.map(blockHtml).join("")}
        ${action}
        ${fallback}
      </td></tr>

      <tr><td style="padding:22px 4px 0;">
        <p style="margin:0 0 6px;font:400 12px/1.6 ${FONT};color:${INK_MUTE};">
          opndoor is a professional guarantor service, not insurance. opndoor is not a party to,
          or named on, the tenancy agreement.</p>
        <p style="margin:0;font:400 12px/1.6 ${FONT};color:${INK_MUTE};">
          Sent by opndoor. Questions? Reply to this email.</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}

/** The same message as text, derived from the same blocks so it cannot drift. */
export function renderText(m: Message, r?: Recipients): string {
  const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").trim();
  const out: string[] = [];
  if (r?.redirected) {
    out.push("[REVIEW COPY] This was addressed to " + (r.intended.join(", ") || "an unknown recipient")
      + " and redirected here. Nobody real received it.", "");
  }
  out.push(`opndoor | ${m.brandLabel ?? (m.audience === "tenant" ? "Guarantor application" : "Guarantee Referral Portal")}`, "", m.heading.toUpperCase(), "");
  for (const b of m.blocks) {
    if ("h" in b) out.push("", strip(b.h).toUpperCase(), "");
    else if ("p" in b) out.push(strip(b.p), "");
    else if ("small" in b) out.push(strip(b.small), "");
    else if ("callout" in b) out.push("    " + strip(b.callout), "");
    else if ("list" in b) { for (const i of b.list) out.push("  - " + strip(i)); out.push(""); }
    else for (const [k, v] of b.rows) out.push(`  ${strip(k)}: ${strip(v)}`);
  }
  if (m.action) out.push("", `${m.action.label}: ${m.action.href}`, "");
  out.push("", "opndoor is a professional guarantor service, not insurance.",
    "opndoor is not a party to, or named on, the tenancy agreement.",
    "Sent by opndoor. Questions? Reply to this email.");
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}
