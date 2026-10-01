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

/* PROSE BLOCKS CARRY MARKUP, SO THEY CANNOT SIMPLY BE ESCAPED -- AND THEY
   CANNOT SIMPLY BE TRUSTED EITHER.

   `p`, `small` and `list` interpolated their content raw, while `h`,
   `callout`, `rows` and every href went through esc(). That reads like an
   oversight and behaves like one: the `note` on send-deed-to-landlord is
   caller-supplied, never touches the database (send_deed_to_landlord
   validates the name and the email and not the note), and lands as the first
   paragraph of a message sent from Opndoor's verified sender, subject
   "Signed Deed of Guarantee for GR-...", WITH THE GENUINE EXECUTED DEED
   ATTACHED, to an address the caller chose. renderText strips tags rather
   than escaping them, so the text and HTML parts disagreed as well, which is
   the classic phishing shape.

   Escaping everything is not available: templates legitimately write <b>,
   <strong> and <a href> in these blocks. So escape first and then re-permit
   an allowlist, which is the only order that is safe -- re-permitting by
   pattern-matching the RAW string would let `<b onclick=...>` through.

   Anchors are re-permitted only with an http(s) href and only with a style
   of colour-safe characters, because one template colours its links. */
const ALLOWED_INLINE: Array<[RegExp, string]> = [
  [/&lt;(\/?)(b|strong|em|i|u)&gt;/g, "<$1$2>"],
  [/&lt;br\s*\/?&gt;/g, "<br>"],
  [/&lt;\/a&gt;/g, "</a>"],
];

function rich(s: string): string {
  let out = esc(String(s ?? ""));
  for (const [re, to] of ALLOWED_INLINE) out = out.replace(re, to);
  /* <a href="https://..."> with an optional simple style attribute.

     WALK FIX 31. This used to read `[^&quot;\s<>]+` for the href, which
     looks like "anything that is not the escaped quote" and is not: it is a
     CHARACTER CLASS, so it excluded the individual characters & q u o t and
     ; along with whitespace and angle brackets. Nearly every real URL
     contains at least one of those -- both store links contain o, u and t --
     so the pattern never matched, and the escaped markup was printed to the
     reader as words. That was reported as the invite email's store lines
     showing raw code, and it was every anchor in every p, small or list
     block in the product.

     `(?:(?!&quot;)[^\s<>])+` is the rule that was meant: any character that
     is not whitespace or an angle bracket and does not begin the escaped
     quote that ends the attribute. */
  out = out.replace(
    /&lt;a href=&quot;(https?:(?:(?!&quot;)[^\s<>])+)&quot;(?: style=&quot;([a-zA-Z0-9:#;.,\- ]*)&quot;)?&gt;/g,
    (_m, href: string, style?: string) =>
      `<a href="${href}"${style ? ` style="${style}"` : ""}>`,
  );
  return out;
}

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
  if ("p" in b) return `<p style="margin:0 0 14px;font:400 15px/1.65 ${FONT};color:${INK_SOFT};">${rich(b.p)}</p>`;
  if ("small" in b) return `<p style="margin:0 0 12px;font:400 13px/1.6 ${FONT};color:${INK_MUTE};">${rich(b.small)}</p>`;
  if ("callout" in b) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;">
      <tr><td style="background:${WHITE_LILAC};border:1px solid ${LINE};border-radius:10px;padding:16px 18px;
        font:700 22px/1.3 ${FONT};color:${VALHALLA};letter-spacing:.08em;text-align:center;">${esc(b.callout)}</td></tr></table>`;
  }
  if ("list" in b) {
    return `<ul style="margin:0 0 14px;padding-left:20px;font:400 15px/1.7 ${FONT};color:${INK_SOFT};">`
      + b.list.map((i) => `<li style="margin:0 0 4px;">${rich(i)}</li>`).join("") + `</ul>`;
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;">`
    + b.rows.map(([k, v]) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid ${LINE};font:400 13px/1.5 ${FONT};color:${INK_MUTE};">${esc(k)}</td>
        <td style="padding:8px 0;border-bottom:1px solid ${LINE};font:600 14px/1.5 ${FONT};color:${VALHALLA};text-align:right;">${esc(v)}</td>
      </tr>`).join("") + `</table>`;
}

/** The whole message, chrome included. */
export function renderHtml(m: Message, r?: Recipients): string {
  /* THE BUTTON WAS A BLANK GAP, and the cause is one declaration.

     Matt, 2026-10-01: "the 'Open your statement' button doesn't render;
     there's a blank gap above 'If the button does not work'."

     The colour lived in ONE place: `background:` on the <td>, as the
     shorthand. The anchor carried `color:#fff` and no background of its
     own. Mail clients rewrite and drop CSS, and the `background`
     shorthand on a table cell is one of the first things to go in
     Gmail -- and the moment it goes, white text sits on a white cell at
     full height. A button that is invisible but still occupies 43
     points IS a blank gap, which is exactly what he saw and why it
     looked like a rendering fault rather than a missing element.

     THREE DECLARATIONS NOW, SO NO SINGLE STRIP HIDES IT:
       bgcolor      the attribute, which predates CSS in email and is
                    the one thing essentially nothing strips
       background-color  the longhand, on the cell, which survives where
                    the shorthand does not
       background-color  on the ANCHOR as well, so even with the cell
                    stripped bare the button is still a coloured pill

     And `color:#ffffff` in full rather than `#fff`: a handful of clients
     still normalise three-digit hex badly in inline styles, and it costs
     three characters to not find out which. */
  const action = m.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px;">
         <tr><td bgcolor="${HELIOTROPE}" style="border-radius:999px;background-color:${HELIOTROPE};">
           <a href="${esc(m.action.href)}" style="display:inline-block;padding:14px 30px;font:700 15px/1 ${FONT};
              background-color:${HELIOTROPE};color:#ffffff;text-decoration:none;border-radius:999px;">${esc(m.action.label)}</a>
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
  /* WALK FIX 31. An anchor keeps its ADDRESS in the plain-text part.
     Stripping the tag left a text-only reader the words "App Store" and no
     way to get there, which is why the templates had been writing the URL
     out as the link text as well -- and that is what made the same address
     appear twice in the HTML. The text part carries it now, so the HTML
     does not have to. */
  const strip = (s: string) => s
    .replace(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
      (_m, href: string, label: string) => (label.trim() && label.trim() !== href ? `${label.trim()}: ${href}` : href))
    .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").trim();
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
