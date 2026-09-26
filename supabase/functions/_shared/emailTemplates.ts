// =====================================================================
// Every message, as content. No markup anywhere in this file.
//
// These are the templates reviewed at /email-preview.html. A template supplies
// words and facts; emailLayout supplies the logo, the colours, the footer, the
// review banner and the plain-text part. Adding a fourteenth email means adding
// a function here and nothing else.
// =====================================================================

import type { Message } from "./emailLayout.ts";

const money = (n: number) => `£${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

/* ---- how the fee was priced, where an email says it out loud -------------
   These templates used to state, flatly, that the guarantee fee is one month
   of rent. That was true of every application while the fee WAS monthly_rent,
   and it stopped being true when negotiated three and five week bases landed:
   applications.fee_amount is what was actually charged, and a tenant of a
   joint tenancy pays a share of even that. An email that prints a real figure
   and then explains it as a month of rent contradicts itself in front of the
   person about to pay it.

   So the basis is now a fact the caller passes, not an assumption the template
   makes. A caller that cannot work out the basis passes nothing and gets the
   half of the sentence that is true of every fee. */

/** One month is 52/12 weeks. */
const MONTH_WEEKS = 52 / 12;

/**
 * The fee expressed in weeks of rent, or null when it cannot be worked out.
 *
 * Pass the rent this fee was actually a proportion OF: for a joint applicant
 * that is their share of the rent, not the whole tenancy's, because they were
 * charged a share of the tenancy fee. Dividing a share of the fee by the whole
 * rent would report every joint tenant as being on a discount.
 */
export function feeBasisWeeksOf(fee: number | null | undefined, rentBase: number | null | undefined): number | null {
  const f = Number(fee ?? 0);
  const r = Number(rentBase ?? 0);
  if (!(f > 0) || !(r > 0)) return null;
  return (f * 52) / (r * 12);
}

/** Is this basis a month? The tolerance absorbs the rounding a fee carries to
    the penny, not a genuinely different basis. An unknown basis is not a month:
    we say nothing rather than guess the commonest answer. */
function isMonthBasis(weeks: number | null | undefined): boolean {
  return weeks != null && Math.abs(weeks - MONTH_WEEKS) < 0.02;
}

/** The basis in the reader's words, or null when we cannot work it out.

    A month is said as a month because that is how a tenant thinks of it. Anything
    else is said in weeks, which is how the agreements are written. Rounded to a
    whole week only when it IS a whole week: "3 weeks" is a band, "3.33 weeks" is
    an arithmetic artefact of a share and saying it to 2dp is more honest than
    rounding it to something the agreement does not say. */
export function feeBasisPhrase(weeks: number | null | undefined): string | null {
  if (weeks == null || !(weeks > 0)) return null;
  if (isMonthBasis(weeks)) return "one month of rent";
  const whole = Math.abs(weeks - Math.round(weeks)) < 0.02;
  const n = whole ? String(Math.round(weeks)) : weeks.toFixed(2);
  return `${n} weeks of rent`;
}

/** The opening sentence of the small print under a fee. "Payable once" is true
    of every fee, so only the basis clause comes and goes.

    A NON-MONTH BASIS IS NOW NAMED. This used to fall back to "The fee is payable
    once." for anything that was not a month, which is true and says nothing: a
    tenant looking at £692.31 against a £1,000 rent was told only that they would
    not be charged again. The month case is word for word what it was, which is
    every referral on standard terms, so no approved wording moves for them. */
function feeBasisSentence(weeks: number | null | undefined): string {
  const phrase = feeBasisPhrase(weeks);
  return phrase ? `The fee is ${phrase} and is payable once.` : "The fee is payable once.";
}

/* ---- which rail, and therefore which words ------------------------------
   THE RULING. The opening line of a payment email follows the ROUTE and the
   REFERENCING MODE, from one template with variables, and never from per-agency
   copy. Three cases, and the reason each reads differently is about who made the
   decision the tenant is being told about:

     agency referral, PRE-REFERENCED (Regent): the AGENCY decided this tenant
       needed a guarantee and arranged one. So the agency is the subject of the
       sentence, named as the tenant knows them, and the fee and its basis are
       stated in the same breath as the ask. Opndoor has made no decision about
       this person and must not imply one.

     agency referral, OPNDOOR-REFERENCED, and the DIRECT rail: opndoor referenced
       the tenant and decided. The existing approved wording says exactly that and
       is left alone.

     supplier rail (Rightmove): byte-identical to today. Their wording is approved
       and their volume is the reason this service exists; a copy change here is
       not a copy change, it is a renegotiation.

   THE AGENCY NAME IS THE ONE THE TENANT KNOWS: agencies.name, never the group's.
   A tenant who dealt with "Regent's Lettings" has never heard of the holding
   company above it, and a sentence naming it reads like a different company
   asking them for money. */
export type TenantRail = "agency" | "supplier" | "direct";

export interface FeeCopy {
  /** The rail this referral came in on. */
  rail: TenantRail;
  /** The application's own referencing_mode, which an agency can override away
      from its partner's. Regent is pre_referenced_open under a partner that is
      opndoor_referenced, so the PARTNER's mode is the wrong thing to read. */
  referencingMode?: string | null;
  /** agencies.name. Required for the agency-referral pre-referenced line, which
      is the only copy that names anybody. */
  agencyName?: string | null;
}

/** Does this referral get the agency's own arranged-it line? Only an agency
    referral that opndoor did not reference, and only when we actually know the
    agency's name: a sentence with a hole where the name goes is worse than the
    approved wording. */
function isAgencyArranged(c: FeeCopy | undefined): boolean {
  if (!c || c.rail !== "agency") return false;
  if (!c.agencyName || !c.agencyName.trim()) return false;
  return c.referencingMode != null && c.referencingMode !== "opndoor_referenced";
}

/* ---- tenant: identity and access ---------------------------------------- */

export function codeEmail(code: string, minutes: number, superseded = false): Message {
  return {
    audience: "tenant",
    subject: superseded
      ? `${code} is your new opndoor confirmation code`
      : `${code} is your opndoor confirmation code`,
    heading: superseded ? "Your new confirmation code" : "Your confirmation code",
    blocks: [
      // Somebody who tapped resend has two or more of these sitting in one
      // inbox, identical apart from six digits. Say which one is live, in the
      // body rather than only the subject, because the older mail is the one
      // nearer the top on a phone.
      superseded
        ? { p: "Enter this code to confirm your email address and continue your application. This replaces any earlier code we sent you, which no longer works." }
        : { p: "Enter this code to confirm your email address and continue your application." },
      { callout: code },
      { small: `It lasts ${minutes} minutes and can be used once. If you did not ask for this, you can ignore it and nothing happens. We will never ask you for this code.` },
    ],
  };
}

export function passwordResetEmail(link: string, audience: "tenant" | "portal" = "portal"): Message {
  return {
    audience,
    subject: "Reset your opndoor password",
    heading: "Reset your password",
    blocks: [
      { p: "We received a request to reset the password on your opndoor account. Choose a new one using the button below." },
      { small: "For your security this link expires in 30 minutes and can be used once. If you did not ask for it, nothing has changed and you can ignore this email." },
    ],
    action: { label: "Choose a new password", href: link },
  };
}

export function accountExistsEmail(signInUrl: string, resetUrl: string): Message {
  return {
    audience: "tenant",
    subject: "You already have an opndoor account",
    heading: "You already have an account",
    blocks: [
      // Lead with what they can do, not with a "somebody tried" line that puts
      // the reader on the back foot. Someone who just tried to sign up wants in.
      { p: "You already have an opndoor account for this address, so there is nothing to set up. Sign in to pick up your application where you left off." },
      { small: `If it was not you who tried to sign up, nothing has changed and you can ignore this. Forgotten your password? <a href="${resetUrl}">Reset it here</a>.` },
    ],
    // Primary action is signing in. The reset is the quieter, less likely case.
    action: { label: "Sign in", href: signInUrl },
  };
}

/* ---- tenant: the application -------------------------------------------- */

export function tenantInviteEmail(p: {
  referrerName: string | null; propertyAddr: string; monthlyRent?: number | null;
  guaranteeRef?: string | null; inviteUrl: string;
}): Message {
  const rows: [string, string][] = [["Property", p.propertyAddr]];
  if (p.monthlyRent != null) rows.push(["Monthly rent", money(Number(p.monthlyRent))]);
  if (p.guaranteeRef) rows.push(["Reference", p.guaranteeRef]);
  return {
    audience: "tenant",
    // Names the referrer rather than assuming a letting agent. Falls back
    // rather than printing an empty gap.
    subject: "Complete your opndoor guarantee application",
    heading: p.referrerName
      ? `You have been referred to opndoor by ${p.referrerName}`
      : "You have been referred to opndoor",
    blocks: [
      { p: "They have started an application for a guarantee on the property below. The next step is yours: finish the application and we will take it from there." },
      { rows },
      { p: "We need your address history for the last three years, your income, and a couple of documents. <strong>Everything saves as you go</strong>, so you can stop and come back whenever you like." },
    ],
    action: { label: "Continue your application", href: p.inviteUrl },
  };
}

export function submissionReceivedEmail(p: {
  firstName?: string | null; guaranteeRef: string; propertyAddr: string;
  /** Weeks of rent the fee will be, from feeBasisWeeksOf. Omit when unknown. */
  feeBasisWeeks?: number | null;
}): Message {
  const hi = p.firstName && p.firstName.trim() ? `Thanks, ${p.firstName.trim()}.` : "Thanks.";
  return {
    audience: "tenant",
    subject: "Your opndoor application is in",
    heading: "We have your application",
    blocks: [
      { p: `${hi} Your application for an opndoor guarantee on ${p.propertyAddr} is in, and there is nothing for you to do right now.` },
      { rows: [["Reference", p.guaranteeRef], ["Property", p.propertyAddr]] },
      { p: "If anything comes up, just reply to this email. You may also be asked for another document or two before it is finished." },
      { h: "What happens next" },
      { list: [
        "We confirm your eligibility. This usually does not take long.",
        "We email you either way, whatever we decide.",
        // Same correction as the two fee emails below, and here it matters more:
        // this one is sent BEFORE a decision, so the reader takes the figure away
        // as what they will owe. At submission the basis is usually not settled,
        // in which case the step is named without pricing it.
        isMonthBasis(p.feeBasisWeeks)
          ? "If you are approved, you sign back in, pay the guarantee fee of one month's rent, and sign the Deed of Guarantee."
          : "If you are approved, you sign back in, pay the guarantee fee, and sign the Deed of Guarantee.",
      ] },
    ],
  };
}

export function paymentLinkEmail(p: {
  propertyAddr: string; guaranteeRef: string; amount: string;
  tenancyStartLabel?: string | null; payUrl: string;
  /** Weeks of rent this fee is, from feeBasisWeeksOf. Omit when unknown. */
  feeBasisWeeks?: number | null;
  /** Which rail and mode this came in on, which decides the opening line. Omit
      and the email reads exactly as it did before any of this, which is what the
      supplier rail must keep getting. */
  copy?: FeeCopy;
}): Message {
  const rows: [string, string][] = [
    ["Reference", p.guaranteeRef],
    ["Property", p.propertyAddr],
    ["Guarantee fee", p.amount],
  ];
  if (p.tenancyStartLabel) rows.push(["Tenancy starts", p.tenancyStartLabel]);

  /* AN AGENCY ARRANGED THIS, AND SAYS SO. On a pre-referenced agency referral the
     agency made the decision, so the agency is the subject and the fee and its
     basis are in the ask rather than in the small print underneath. Everything
     else, including every supplier referral, keeps the approved sentence. */
  const basis = feeBasisPhrase(p.feeBasisWeeks);
  const opening = isAgencyArranged(p.copy)
    ? `${p.copy!.agencyName!.trim()} has arranged an opndoor guarantee for your tenancy at ${p.propertyAddr}. `
      + `To put it in place, pay the guarantee fee of ${p.amount}${basis ? ` (${basis})` : ""}.`
    : `opndoor is acting as guarantor for your tenancy at ${p.propertyAddr}. The last step is the guarantee fee.`;

  return {
    audience: "tenant",
    subject: "Your opndoor guarantee is ready to pay",
    heading: "Your guarantee is approved",
    blocks: [
      { p: opening },
      { rows },
      { small: `${feeBasisSentence(p.feeBasisWeeks)} The Deed of Guarantee is issued as soon as it clears.` },
    ],
    action: { label: "Pay the guarantee fee", href: p.payUrl },
  };
}

/** The direct rail's approval. Unlike paymentLinkEmail, which sends a referred
    tenant a tokenised /pay link because they have no account, a direct tenant
    already has one, so this brings them back to their own portal to sign in and
    pay the guarantee fee from their status screen. */
export function directApprovalEmail(p: {
  propertyAddr: string; guaranteeRef: string; amount: string;
  tenancyStartLabel?: string | null; portalUrl: string;
  /** Weeks of rent this fee is, from feeBasisWeeksOf. Omit when unknown. */
  feeBasisWeeks?: number | null;
}): Message {
  const rows: [string, string][] = [
    ["Reference", p.guaranteeRef],
    ["Property", p.propertyAddr],
    ["Guarantee fee", p.amount],
  ];
  if (p.tenancyStartLabel) rows.push(["Tenancy starts", p.tenancyStartLabel]);
  return {
    audience: "tenant",
    subject: "You are approved, and the last step is the guarantee fee",
    heading: "Your guarantee is approved",
    blocks: [
      { p: `Good news. opndoor can act as guarantor for your tenancy at ${p.propertyAddr}. The last step is the guarantee fee.` },
      { rows },
      { small: `${feeBasisSentence(p.feeBasisWeeks)} Sign in to your application to pay it, and the Deed of Guarantee is issued as soon as it clears.` },
    ],
    action: { label: "Sign in and pay", href: p.portalUrl },
  };
}

export function paymentReminderEmail(p: {
  propertyAddr: string; guaranteeRef: string; amount: string;
  openUntilLabel?: string | null; payUrl: string; nudge: 1 | 2 | 3;
  /** Weeks of rent this fee is, from feeBasisWeeksOf. Omit when unknown. */
  feeBasisWeeks?: number | null;
  /** Which rail and mode, as for paymentLinkEmail. Omit for today's wording. */
  copy?: FeeCopy;
}): Message {
  const lead = p.nudge === 1
    ? "Just checking this reached you."
    : p.nudge === 2
      ? `Your tenancy at ${p.propertyAddr} is waiting on the guarantee fee.`
      : "To keep your tenancy on track, the guarantee fee needs paying.";
  const rows: [string, string][] = [["Reference", p.guaranteeRef], ["Guarantee fee", p.amount]];
  if (p.openUntilLabel) rows.push(["Open until", p.openUntilLabel]);

  /* THE SAME RULE AS THE FIRST EMAIL, for the same reason: a reminder that tells a
     Regent tenant opndoor is acting as guarantor misattributes the decision just
     as the original did, and a reminder is read by somebody who has already
     hesitated once. It also gained a basis: a reminder naming a figure and not
     what the figure is measured against is the same misstatement of price. */
  const basis = feeBasisPhrase(p.feeBasisWeeks);
  const body = isAgencyArranged(p.copy)
    ? `${lead} ${p.copy!.agencyName!.trim()} has arranged an opndoor guarantee for your tenancy at ${p.propertyAddr}. `
      + `To put it in place, pay the guarantee fee of ${p.amount}${basis ? ` (${basis})` : ""}.`
    // True whoever referred them, and true if nobody did. This used to say
    // they had been referred, which is false for a direct signup.
    : `${lead} opndoor is acting as guarantor for your tenancy at ${p.propertyAddr}.`;

  return {
    audience: "tenant",
    subject: "A reminder about your opndoor guarantee",
    heading: "Your guarantee is still waiting",
    blocks: [
      { p: body },
      { rows },
    ],
    action: { label: "Pay the guarantee fee", href: p.payUrl },
  };
}

export function paymentReceiptEmail(p: {
  propertyAddr: string; guaranteeRef: string; amount: string; managedBy: string;
}): Message {
  return {
    audience: "tenant",
    subject: `Payment received for ${p.guaranteeRef}`,
    heading: "Thank you, your payment has cleared",
    blocks: [
      { p: `We have received your guarantee fee for ${p.propertyAddr}. Your Deed of Guarantee is on its way to you to sign electronically.` },
      { rows: [["Reference", p.guaranteeRef], ["Amount paid", p.amount]] },
      { small: `Once you have signed, ${p.managedBy} receives the executed deed and your tenancy can proceed.` },
    ],
  };
}

export function refundEmail(p: { propertyAddr: string; guaranteeRef: string; amount: string }): Message {
  return {
    audience: "tenant",
    subject: `Refund issued for ${p.guaranteeRef}`,
    heading: "Your guarantee fee has been refunded",
    blocks: [
      { p: `Your guarantee fee for ${p.propertyAddr} has been refunded. The refund is on its way back to the card you paid with.` },
      { rows: [["Reference", p.guaranteeRef], ["Amount refunded", p.amount]] },
      { small: "It usually appears within five to ten working days, depending on your bank." },
    ],
  };
}

/* ---- the deed ------------------------------------------------------------ */

export function deedToSignEmail(p: {
  guaranteeRef: string; tenantName: string; propertyAddr: string;
  tenancyStartLabel?: string | null; signUrl: string;
}): Message {
  const rows: [string, string][] = [
    ["Reference", p.guaranteeRef],
    ["Tenant", p.tenantName],
    ["Property", p.propertyAddr],
  ];
  if (p.tenancyStartLabel) rows.push(["Tenancy starts", p.tenancyStartLabel]);
  return {
    audience: "tenant",
    subject: `Deed of Guarantee issued for ${p.guaranteeRef}`,
    heading: "The Deed of Guarantee is ready to sign",
    blocks: [
      { p: "opndoor has issued a Deed of Guarantee for the tenancy below. It needs signing before it takes effect." },
      { rows },
      { small: "opndoor is a professional guarantor service, not insurance, and is not a party to the tenancy agreement. You remain the claim contact." },
    ],
    action: { label: "Review and sign", href: p.signUrl },
  };
}

/** To the AGENT or a private landlord. Names the tenant, because they are not
    the recipient. The signed deed rides as an attachment (added by the sender),
    so this is now honest about "attached". The portal line is added only when a
    portalUrl is passed: an agent has a login, a private landlord does not. */
export function executedDeedAgentEmail(p: {
  guaranteeRef: string; tenantName: string; propertyAddr: string;
  tenancyStartLabel?: string | null; portalUrl?: string;
}): Message {
  // Tenancy start + the 12-month period first, so "the guarantor for the term
  // above" in the small print has a term above it to point at.
  const rows: [string, string][] = [];
  if (p.tenancyStartLabel) {
    rows.push(["Tenancy start", p.tenancyStartLabel]);
    rows.push(["Guarantee period", "12 months"]);
  }
  rows.push(["Reference", p.guaranteeRef]);
  rows.push(["Tenant", p.tenantName]);
  rows.push(["Property", p.propertyAddr]);
  const portalLine = p.portalUrl
    ? ` You can also view it any time in <a href="${p.portalUrl}">the portal</a>.`
    : "";
  return {
    subject: `Signed Deed of Guarantee for ${p.guaranteeRef}`,
    heading: "The Deed of Guarantee has been signed",
    blocks: [
      { p: `Your signed copy is attached. Keep it with the tenancy paperwork, it is the reference for any claim under the guarantee.${portalLine}` },
      { rows },
      { p: "We will email you a month before the guarantee ends." },
      { small: "opndoor remains the guarantor for the term above. You remain the claim contact." },
    ],
  };
}

/** To a private LANDLORD, sent by their agent. Carries the agent's short
    covering line, names the tenant, and the signed deed rides as an attachment.
    No portal line: a private landlord has no login. */
export function executedDeedLandlordEmail(p: {
  guaranteeRef: string; tenantName: string; propertyAddr: string;
  tenancyStartLabel?: string | null; note?: string;
}): Message {
  const rows: [string, string][] = [];
  if (p.tenancyStartLabel) {
    rows.push(["Tenancy start", p.tenancyStartLabel]);
    rows.push(["Guarantee period", "12 months"]);
  }
  rows.push(["Reference", p.guaranteeRef]);
  rows.push(["Tenant", p.tenantName]);
  rows.push(["Property", p.propertyAddr]);
  const note = (p.note ?? "").trim();
  const blocks: Message["blocks"] = [];
  if (note) blocks.push({ p: note });
  blocks.push({ p: "The signed Deed of Guarantee is attached. Keep it with the tenancy paperwork, it is the reference for any claim under the guarantee." });
  blocks.push({ rows });
  blocks.push({ p: "We will email you a month before the guarantee ends." });
  blocks.push({ small: "opndoor is the guarantor for the term above." });
  return {
    // The landlord is not a portal user, so the header names the document, not
    // the portal.
    brandLabel: "Deed of Guarantee",
    subject: `Signed Deed of Guarantee for ${p.guaranteeRef}`,
    heading: "The Deed of Guarantee has been signed",
    blocks,
  };
}

/** To the TENANT. No Tenant line: they know who they are. The signed deed rides
    as an attachment (added by the sender); no portal line, a tenant has no login. */
export function executedDeedTenantEmail(p: {
  guaranteeRef: string; propertyAddr: string;
  tenancyStartLabel?: string | null;
}): Message {
  const rows: [string, string][] = [];
  if (p.tenancyStartLabel) {
    rows.push(["Tenancy start", p.tenancyStartLabel]);
    rows.push(["Guarantee period", "12 months"]);
  }
  rows.push(["Reference", p.guaranteeRef]);
  rows.push(["Property", p.propertyAddr]);
  return {
    audience: "tenant",
    subject: `Your signed Deed of Guarantee for ${p.guaranteeRef}`,
    heading: "Your Deed of Guarantee has been signed",
    blocks: [
      { p: "The Deed of Guarantee for your tenancy has been signed by all parties. A copy is attached for your records, and you do not need to do anything else." },
      { rows },
      { p: "We will email you a month before the guarantee ends." },
      { small: "opndoor is your guarantor for the term above. opndoor is a professional guarantor service, not insurance, and is not a party to your tenancy agreement. If anything changes, speak to your letting agent first." },
    ],
  };
}

/** The month-before-expiry renewal notice, sent to the tenant, the agent or
    landlord, and the referrer. Names the tenant and property because not every
    recipient is the tenant; invites a reply to continue cover. */
export function renewalNoticeEmail(p: { tenantName: string; propertyAddr: string; endDate: string }): Message {
  return {
    subject: `The opndoor guarantee for ${p.tenantName} ends on ${p.endDate}`,
    heading: "The guarantee is ending soon",
    blocks: [
      { p: `The guarantee for ${p.tenantName} at ${p.propertyAddr} ends on ${p.endDate}. If the tenancy is continuing and you would like cover to continue, reply to this email.` },
    ],
  };
}

/* ---- referrer (agent) lifecycle notices ---------------------------------- */

// Short portal-audience notes to the agent who made the referral, at each
// lifecycle point. Each names the tenant and property and links to the
// application in the portal.
function referrerRows(guaranteeRef: string, tenantName: string, propertyAddr: string): [string, string][] {
  return [["Reference", guaranteeRef], ["Tenant", tenantName], ["Property", propertyAddr]];
}
function withAction(m: Message, portalUrl?: string): Message {
  return portalUrl ? { ...m, action: { label: "Open the application", href: portalUrl } } : m;
}

export function referrerSubmittedEmail(p: { guaranteeRef: string; tenantName: string; propertyAddr: string; portalUrl?: string }): Message {
  return withAction({
    subject: `${p.tenantName}'s application is being referenced`,
    heading: "Your referral is being referenced",
    blocks: [
      { p: `${p.tenantName}'s application for ${p.propertyAddr} has been submitted for referencing. We will email you the decision.` },
      { rows: referrerRows(p.guaranteeRef, p.tenantName, p.propertyAddr) },
    ],
  }, p.portalUrl);
}

export function referrerDecisionEmail(p: { guaranteeRef: string; tenantName: string; propertyAddr: string; approved: boolean; portalUrl?: string }): Message {
  return withAction({
    subject: p.approved ? `${p.tenantName} has been approved` : `A decision on ${p.tenantName}`,
    heading: p.approved ? "Your referral has been approved" : "A decision on your referral",
    blocks: [
      { p: p.approved
          ? `${p.tenantName}'s application for ${p.propertyAddr} has been approved. The tenant pays the guarantee fee next.`
          : `The decision on ${p.tenantName}'s application for ${p.propertyAddr} has come back declined.` },
      { rows: referrerRows(p.guaranteeRef, p.tenantName, p.propertyAddr) },
    ],
  }, p.portalUrl);
}

export function referrerPaidEmail(p: { guaranteeRef: string; tenantName: string; propertyAddr: string; portalUrl?: string }): Message {
  return withAction({
    subject: `Guarantee fee paid for ${p.tenantName}`,
    heading: "The guarantee fee has been paid",
    blocks: [
      { p: `${p.tenantName} has paid the guarantee fee for ${p.propertyAddr}. The Deed of Guarantee will be issued for signing.` },
      { rows: referrerRows(p.guaranteeRef, p.tenantName, p.propertyAddr) },
    ],
  }, p.portalUrl);
}

/* ---- partner and staff --------------------------------------------------- */

/* Google Authenticator's own store pages. Mirrored in src/pages/Login/Login.tsx,
   which this file cannot import (different runtime). Free on both stores, which is
   why it is the one we name. */
const APP_STORE_GA = "https://apps.apple.com/app/google-authenticator/id388497605";
const GOOGLE_PLAY_GA = "https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2";

export function staffInviteEmail(p: { inviterName: string; partnerName: string; link: string }): Message {
  return {
    subject: "You have been invited to the opndoor portal",
    heading: "Set up your portal account",
    blocks: [
      { p: `${p.inviterName} has invited you to the opndoor Guarantee Referral Portal for ${p.partnerName}. Choose a password and set up two-factor authentication to get started.` },
      { small: "Two-factor authentication is required on every sign in. You will need an authenticator app." },
      /* WHERE TO GET ONE, in the invite rather than only on the screen, so the
         invitee can install it before they start rather than stopping halfway
         through enrolment to go to a store.

         ONLY FREE APPS ARE NAMED, and this is the rule, not a preference: a
         required security step must never be gated behind somebody buying
         software. Google Authenticator is free on both stores and an iPhone has
         one built in, so nobody has to spend anything.

         THE URL IS THE LINK TEXT ON PURPOSE. renderText strips tags to build the
         plain-text part of every email, substituting nothing, so an anchor reading
         "App Store" would leave a text-only reader the words and not the address.
         A list block gives each one its own line in both parts.

         The same copy is on the enrolment screen in src/pages/Login/Login.tsx,
         which cannot be imported here (this runs on Deno). If one changes, change
         both. */
      { small: "You need an authenticator app. Google Authenticator is free:" },
      { list: [
        `App Store: <a href="${APP_STORE_GA}" style="color:#5b3fd9;">${APP_STORE_GA}</a>`,
        `Google Play: <a href="${GOOGLE_PLAY_GA}" style="color:#5b3fd9;">${GOOGLE_PLAY_GA}</a>`,
      ] },
      { small: "On an iPhone, the built-in Passwords app works too." },
    ],
    action: { label: "Set up your account", href: p.link },
  };
}

export function expiryReminderEmail(p: {
  guaranteeRef: string; propertyAddr: string; expiryLabel: string;
  branch?: string | null; agency?: string | null; link?: string;
}): Message {
  const rows: [string, string][] = [
    ["Reference", p.guaranteeRef],
    ["Property", p.propertyAddr],
    ["Expires", p.expiryLabel],
  ];
  if (p.agency) rows.push(["Agency", p.agency]);
  if (p.branch) rows.push(["Branch", p.branch]);
  return {
    subject: "A guarantee you referred is approaching expiry",
    heading: "A guarantee is coming to an end",
    blocks: [
      { p: "The Deed of Guarantee below expires shortly." },
      { rows },
      { p: "If the tenancy is continuing, arrange a renewal or send a fresh referral so cover stays in place." },
    ],
    ...(p.link ? { action: { label: "Open the portal", href: p.link } } : {}),
  };
}

export function weeklyDigestEmail(p: {
  sent: number; paid: number; deeds: number; fees: string; commission?: string | null;
  climber?: string | null; link: string;
}): Message {
  const rows: [string, string][] = [
    ["Referrals sent", String(p.sent)],
    ["Paid", String(p.paid)],
    ["Deeds issued", String(p.deeds)],
    ["Fees collected", p.fees],
  ];
  if (p.commission) rows.push(["Commission earned", p.commission]);
  return {
    subject: `Your opndoor week: ${p.sent} referrals, ${p.fees} in fees`,
    heading: "Your week at a glance",
    blocks: [
      { rows },
      ...(p.climber ? [{ h: "Climber of the week" }, { p: p.climber }] : []),
    ],
    action: { label: "Open the portal", href: p.link },
  };
}

export function opsAlertEmail(p: {
  type: string; label: string; ref?: string | null; message: string; link?: string | null;
}): Message {
  const rows: [string, string][] = [["Alert", p.type]];
  if (p.ref) rows.push(["Reference", p.ref]);
  return {
    subject: `[opndoor] ${p.label}`,
    heading: "Something needs a look",
    blocks: [{ p: p.label }, { rows }, { small: p.message }],
    ...(p.link ? { action: { label: "Open the application", href: p.link } } : {}),
  };
}
