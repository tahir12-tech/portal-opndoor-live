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

    A month is said as a month because that is how a tenant thinks of it, and
    as "one month's rent", which is what the other thirty-odd places in this
    codebase that name this basis already say. The phrase is the SAME on every
    surface by ruling: the Stripe line item a tenant reads at the card screen,
    this email, the pay page and the agency screens. One basis, one wording. Anything
    else is said in weeks, which is how the agreements are written. Rounded to a
    whole week only when it IS a whole week: "3 weeks" is a band, "3.33 weeks" is
    an arithmetic artefact of a share and saying it to 2dp is more honest than
    rounding it to something the agreement does not say. */
export function feeBasisPhrase(weeks: number | null | undefined): string | null {
  if (weeks == null || !(weeks > 0)) return null;
  if (isMonthBasis(weeks)) return "one month's rent";
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
function feeBasisSentence(weeks: number | null | undefined, tenantCount?: number | null): string {
  const phrase = feeBasisPhrase(weeks);
  const split = tenantCount != null && tenantCount > 1 ? `, split between ${tenantCount} tenants,` : "";
  return phrase ? `The fee is ${phrase}${split} and is payable once.` : "The fee is payable once.";
}

/* ---- ONE TENANCY, A SHARE EACH ------------------------------------------
   A joint tenancy is priced ONCE and charged by share. So every figure a joint
   tenant reads is a share, and the basis beside it is a fact about the whole
   tenancy: GR-20846 is a £2,000 tenancy priced at five weeks, £2,307.69, of which
   this tenant's 46% is £1,061.54.

   Naming the share as though it were the whole fee is the defect this closes. A
   tenant who reads "the guarantee fee of £1,061.54, 5 weeks of rent" can divide
   one by the other, get nothing like five weeks of anything they recognise, and
   conclude we have made a mistake. The sentence has to say all three things: that
   this is their share, what the tenancy's fee is measured against, and how many
   ways it is split.

   Single tenants are untouched: tenantCount absent or 1 produces exactly the
   wording that shipped before this. */
function isJoint(tenantCount?: number | null): boolean {
  return tenantCount != null && tenantCount > 1;
}

/** What the fee row is called. A share is not the fee. */
function feeRowLabel(tenantCount?: number | null): string {
  return isJoint(tenantCount) ? "Your share of the guarantee fee" : "Guarantee fee";
}

/* THE HEADING FOLLOWS THE SAME RULE AS THE BODY.
   "Your guarantee is approved" asserts a decision. On a pre-referenced referral
   opndoor approved nothing: the agency referenced the tenant and arranged a
   guarantee, and there is nothing for us to have approved. Fixing the opening
   sentence and leaving the heading saying "approved" left the contradiction in the
   largest type on the page. */
function readyHeading(c: FeeCopy | undefined): string {
  return isAgencyArranged(c) ? "Your guarantee is ready to put in place" : "Your guarantee is approved";
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

/* =====================================================================
   SOMEBODY RESET YOUR TWO-FACTOR.

   Matt, 2026-10-01: 'Two-factor reset email: add "Delete the old
   opndoor entry from your authenticator app before scanning the new
   code."'

   THE SENTENCE IS THE WHOLE REASON THIS EXISTS, and it is the answer to
   a real failure. An authenticator entry is labelled issuer + account,
   and after a reset both halves are identical to the old entry's -- so
   the app shows two "opndoor (you@example.com)" lines, six digits
   each, and nothing to tell them apart. Scanning the new code without
   deleting the old one leaves a trap the person falls into at their
   next sign-in. Labelling dev separately (2026-10-01) fixes dev
   against live; nothing in a QR code can fix old against new, so the
   person has to be told.

   AND THE EMAIL ITSELF HAD TO EXIST. A reset destroys the factor and
   every session, and sent nothing: from the person's side that is
   indistinguishable from being attacked. The first block is there for
   them, not for the instruction.

   NO LINK AND NO BUTTON, deliberately. There is nothing to click: they
   sign in as usual and the portal asks them to set up an authenticator.
   A button here would have to be a sign-in link, which is one more
   thing for a phisher to imitate on the one email most likely to make
   somebody anxious.
   ===================================================================== */
export function twoFactorResetEmail(p: { actorName: string | null }): Message {
  const who = (p.actorName ?? "").trim();
  return {
    audience: "portal",
    subject: "Your opndoor two-factor has been reset",
    heading: "Set up your authenticator again",
    blocks: [
      { p: who
        ? `${who} at opndoor has reset the two-factor authentication on your account. You have been signed out everywhere, and your old authenticator code will no longer work.`
        : "The two-factor authentication on your opndoor account has been reset. You have been signed out everywhere, and your old authenticator code will no longer work." },
      { p: "Next time you sign in you will be shown a new QR code to scan." },
      /* MATT'S SENTENCE, ON ITS OWN AND BEFORE THE REASSURANCE, because
         it is an instruction to carry out rather than something to
         read. It is the only thing in here the reader has to DO. */
      { p: "<strong>Delete the old opndoor entry from your authenticator app before scanning the new code.</strong> Two entries with the same name are impossible to tell apart, and the old one will not work." },
      { small: "If you did not expect this, contact your opndoor administrator before signing in." },
    ],
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
      // The sentence above already names the property. See the sweep note.
      { rows: [["Reference", p.guaranteeRef]] },
      /* NOT "reply to this email": since 2026-10-01 every email is sent
         from no-reply@opndoor.co, so a reply goes nowhere. The footer
         carries the support address; the body now points at it too,
         because this sentence is the one inviting a reply. */
      { p: "If anything comes up, email support@opndoor.co. You may also be asked for another document or two before it is finished." },
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
  /** How many tenants share this tenancy's fee. 1 or omitted is a sole tenant and
      produces the wording that shipped before joint tenancies. */
  tenantCount?: number | null;
}): Message {
  const joint = isJoint(p.tenantCount);
/* THE ADDRESS ONCE, IN THE SENTENCE. Matt, 2026-10-01: "don't repeat the
   property address ... Check the other tenant emails for the same
   repetition."

   THE SWEEP, and what it found. Three of these emails spelled the address
   in their opening line and then again in the table two lines below it.
   Three others -- the invite, the deed to sign and the executed deed --
   look like the same fault and are not: their prose says "the property
   below" and "the tenancy below" and defers to the table, so the address
   appears exactly once and the ROW is the one place it lives. Those are
   left alone.

   WHERE THE SENTENCE NAMES IT, THE ROW GOES, because the sentence is the
   wording Matt specified and the table exists for the facts the prose
   does not carry: the reference, the fee, the dates. */
  /* AND THIS ONE IS NOT CHANGED, which is the sweep stopping where it
     should. paymentLinkEmail repeats the address exactly as the two above
     did: the opening sentence names it and the row below names it again.

     IT IS ALSO APPROVED COPY. tenantFeeEmails.test.ts pins the supplier
     rail's version byte for byte -- "Rightmove's wording is approved and
     their volume is the reason this service exists" -- and the row cannot
     be dropped for the agency rail and kept for the supplier rail without
     giving one email two different tables for no reason a reader could
     state. Changing an email a partner signed off is Matt's call, not
     one to make overnight, so it is listed for him instead. */
  const rows: [string, string][] = [
    ["Reference", p.guaranteeRef],
    ["Property", p.propertyAddr],
    [feeRowLabel(p.tenantCount), p.amount],
  ];
  if (p.tenancyStartLabel) rows.push(["Tenancy starts", p.tenancyStartLabel]);

  /* AN AGENCY ARRANGED THIS, AND SAYS SO. On a pre-referenced agency referral the
     agency made the decision, so the agency is the subject and the fee and its
     basis are in the ask rather than in the small print underneath. Everything
     else, including every supplier referral, keeps the approved sentence.

     THE JOINT ASK NAMES THE SHARE AS A SHARE. "pay the guarantee fee of £1,061.54
     (5 weeks of rent)" invites a tenant to divide one by the other and conclude we
     have miscounted: £1,061.54 is their 46% of a £2,307.69 tenancy fee, and it is
     the TENANCY that is priced at five weeks. So the sentence says all three
     things, their share, the tenancy's basis, and how many ways it splits. */
  const basis = feeBasisPhrase(p.feeBasisWeeks);
  const ask = joint
    ? `pay your share of the guarantee fee, ${p.amount}`
      + (basis ? ` (the fee is ${basis}, split between ${p.tenantCount} tenants)` : "")
    : `pay the guarantee fee of ${p.amount}${basis ? ` (${basis})` : ""}`;
  const opening = isAgencyArranged(p.copy)
    ? `${p.copy!.agencyName!.trim()} has arranged an opndoor guarantee for your tenancy at ${p.propertyAddr}. `
      + `To put it in place, ${ask}.`
    : `opndoor is acting as guarantor for your tenancy at ${p.propertyAddr}. The last step is the guarantee fee.`;

  return {
    audience: "tenant",
    subject: "Your opndoor guarantee is ready to pay",
    heading: readyHeading(p.copy),
    blocks: [
      { p: opening },
      { rows },
      { small: `${feeBasisSentence(p.feeBasisWeeks, p.tenantCount)} The Deed of Guarantee is issued as soon as it clears.` },
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
    // The opening sentence names the property. See the sweep note above.
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
  /** Tenants sharing this tenancy's fee. 1 or omitted is a sole tenant. */
  tenantCount?: number | null;
}): Message {
  /* THE NUDGE SAYS NOTHING THE OPENING SAYS. Matt, 2026-10-01: "don't
     repeat the property address."

     Nudge 2 used to read "Your tenancy at 12 Example Street is waiting on
     the guarantee fee." and the sentence straight after it said "...for
     your tenancy at 12 Example Street" again: the address twice in two
     lines, and "your tenancy" twice with it. Nudge 3 named the fee and
     then the ask named it again.

     So the lead is now ONLY the escalation -- how overdue this is -- and
     every fact lives in the one sentence below it. */
  const lead = p.nudge === 1
    ? "Just checking this reached you."
    : p.nudge === 2
      ? "This one is still outstanding."
      : "This is now holding your tenancy up.";
  const rows: [string, string][] = [["Reference", p.guaranteeRef], [feeRowLabel(p.tenantCount), p.amount]];
  if (p.openUntilLabel) rows.push(["Open until", p.openUntilLabel]);

  /* THE SAME RULE AS THE FIRST EMAIL, for the same reason: a reminder that tells a
     Regent tenant opndoor is acting as guarantor misattributes the decision just
     as the original did, and a reminder is read by somebody who has already
     hesitated once. It also gained a basis: a reminder naming a figure and not
     what the figure is measured against is the same misstatement of price. */
  const basis = feeBasisPhrase(p.feeBasisWeeks);
  // Same joint framing as the first email: a share named as a share, the basis
  // stated as the tenancy's, and the number of ways it splits.
  const ask = isJoint(p.tenantCount)
    ? `pay your share of the guarantee fee, ${p.amount}`
      + (basis ? ` (the fee is ${basis}, split between ${p.tenantCount} tenants)` : "")
    : `pay the guarantee fee of ${p.amount}${basis ? ` (${basis})` : ""}`;
  /* MATT'S SENTENCE, 2026-10-01, verbatim: "[agency name] has arranged an
     opndoor guarantee for your tenancy at [property address]. To put it in
     place, pay the guarantee fee of [fee] ([fee basis, e.g. 3 weeks of rent
     or one month's rent])." Every bracketed part is read off the
     application: the agency from the copy, the address from the row, the
     amount as formatted, and the basis from feeBasisWeeks, which is
     fee_basis_weeks on the application and not an assumption that a fee is
     a month.

     "Where there's no agency (a direct signup), leave out the '[agency
     name] has arranged' part." Dropping the clause alone leaves a fragment,
     so the direct rail keeps the sentence it already had -- which is the
     same sentence with the agency taken out of it -- and GAINS the ask.
     Until now a direct tenant's reminder named no fee in its prose at all:
     the figure was in the table and the sentence stopped after the address,
     so the one thing the email exists to ask for was the one thing it did
     not say. */
  const body = isAgencyArranged(p.copy)
    ? `${lead} ${p.copy!.agencyName!.trim()} has arranged an opndoor guarantee for your tenancy at ${p.propertyAddr}. `
      + `To put it in place, ${ask}.`
    // True whoever referred them, and true if nobody did. This used to say
    // they had been referred, which is false for a direct signup.
    : `${lead} opndoor is acting as guarantor for your tenancy at ${p.propertyAddr}. `
      + `To put it in place, ${ask}.`;

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

/* AN UNFINISHED APPLICATION IS ABOUT TO CLOSE.
   Matt, 2026-10-02: "At 25 days with no activity, email the tenant: their
   application will close in 5 days, with a link to carry on."

   IT STATES THE REAL NUMBER, not five. Five is what the gap between the
   two thresholds is worth on the day the warning fires; the drafts
   already sitting on dev when this shipped were 28 and 29 days quiet and
   had two days and one. A reminder that says five while the thing closes
   tomorrow is worse than no reminder.

   AND IT SAYS WHAT CLOSING COSTS, which is nothing. That is Matt's own
   rule for the expiry -- "Expiry loses nothing: if the tenant signs in
   again, it reopens where they left off" -- and leaving it out would
   make the email a threat about something that is not a loss. It is the
   small print rather than the lead, because the ask is still to finish.

   THE PROPERTY IS OPTIONAL because a draft may not have one yet: the
   address is a later step, and two of dev's unfinished applications have
   nothing but an email address on them. */
export function draftClosingEmail(p: {
  guaranteeRef: string; daysLeft: number; closesOnLabel: string;
  propertyAddr?: string | null; applyUrl: string;
}): Message {
  const where = p.propertyAddr ? ` for ${p.propertyAddr}` : "";
  const when = p.daysLeft <= 1 ? "tomorrow" : `in ${p.daysLeft} days`;
  const rows: [string, string][] = [["Reference", p.guaranteeRef], ["Closes", p.closesOnLabel]];
  return {
    audience: "tenant",
    subject: p.daysLeft <= 1
      ? "Your opndoor application closes tomorrow"
      : `Your opndoor application closes in ${p.daysLeft} days`,
    heading: "Your application is still unfinished",
    blocks: [
      { p: `You started an application${where} and have not finished it. It closes ${when} if nothing more happens on it.` },
      { rows },
      { small: "Closing it loses nothing. Sign in again at any time and it picks up where you left off, with the same reference." },
    ],
    action: { label: "Carry on with your application", href: p.applyUrl },
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
      /* THE FOOTER ALREADY SAYS THE FIRST HALF. Matt, 2026-10-02: "remove
         the duplicate 'not insurance' sentences." Every email built by
         emailLayout carries "opndoor is a professional guarantor service,
         not insurance. opndoor is not a party to, or named on, the
         tenancy agreement", so this printed it twice on one screen. What
         is kept is the half the footer does not say, exactly as on the
         signed-deed email. */
      { small: "You remain the claim contact." },
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
  /** On a joint tenancy: how many deeds are SIGNED, how many tenants there
      are, and the others by name. Absent on a tenancy of one, where the
      email is unchanged.

      `signed`, NOT this deed's position. Matt, 2026-10-01, on GR-23853 and
      GR-23854: "Joint Two signed first, and the agent's signed-deed email
      said 'deed 2 of 2' and 'This is the last of this tenancy's deeds:
      every tenant has now signed their own', while Joint One has not paid
      or signed. The count must be of deeds actually signed ('1 of 2
      signed'), and 'every tenant has now signed' only appears when it's
      true."

      The old field was `position`, which is the order the agent typed the
      tenants in: the second tenant's deed was "2 of 2" however many had
      signed, and the closing sentence followed the same number. An ordinal
      read as a count. */
  joint?: { signed: number; count: number; coTenants: string } | null;
  /** Set when this deed replaces one already sent, after a tenancy-start
      correction: the date the earlier copy went out. */
  correctedFrom?: string | null;
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

  /* SAY THAT ANOTHER DEED IS COMING, on a joint tenancy.

     Each tenant signs their own deed for their own share, generated when THAT
     tenant pays, so the agent receives two emails days apart for one tenancy.
     Without this line the first one reads as the whole thing and the second
     reads as a duplicate, and an agent who files the first and ignores the
     second ends up believing a tenancy is fully guaranteed when half of it is.

     The row names it, and the sentence says what to expect. Both are omitted
     entirely on a tenancy of one, so that email is unchanged. */
  if (p.joint && p.joint.count > 1) {
    rows.push(["This tenancy", `Joint tenancy, ${p.joint.signed} of ${p.joint.count} deeds signed`]);
    if (p.joint.coTenants) rows.push(["Also on this tenancy", p.joint.coTenants]);
  }
  const outstanding = p.joint ? p.joint.count - p.joint.signed : 0;
  const jointLine = p.joint && p.joint.count > 1
    ? (outstanding > 0
      ? ` This is a joint tenancy: each tenant signs their own deed for their own share, so ${outstanding === 1 ? "one more deed follows" : `${outstanding} more deeds follow`} once ${outstanding === 1 ? "the other tenant has" : "the other tenants have"} paid and signed.`
      : " This is the last of this tenancy's deeds: every tenant has now signed their own.")
    : "";

  return {
    subject: p.joint && p.joint.count > 1
      ? `Signed Deed of Guarantee for ${p.guaranteeRef} (${p.joint.signed} of ${p.joint.count} signed)`
      : `Signed Deed of Guarantee for ${p.guaranteeRef}`,
    heading: "The Deed of Guarantee has been signed",
    blocks: [
      /* A CORRECTION SAYS SO FIRST. Matt, 2026-10-01: "Signed deed email
         after a tenancy start correction: say so at the top, e.g. 'This
         corrected deed replaces the one sent on 1 Oct 2026. The tenancy
         start is now 21 November 2026; please discard the earlier copy.'"
         Without it the second email reads as a duplicate of the first,
         and the one with the wrong date is the one already filed. */
      ...(p.correctedFrom
        ? [{ callout: `This corrected deed replaces the one sent on ${p.correctedFrom}.${p.tenancyStartLabel ? ` The tenancy start is now ${p.tenancyStartLabel};` : ''} please discard the earlier copy.` }]
        : []),
      { p: `Your signed copy is attached. Keep it with the tenancy paperwork, it is the reference for any claim under the guarantee.${portalLine}${jointLine}` },
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
  /** On a joint tenancy: who has signed, and who has not. Absent on a
      tenancy of one, where the email is unchanged. */
  joint?: { signedNames: string[]; unsignedNames: string[] } | null;
}): Message {
  const rows: [string, string][] = [];
  if (p.tenancyStartLabel) {
    rows.push(["Tenancy start", p.tenancyStartLabel]);
    rows.push(["Guarantee period", "12 months"]);
  }
  rows.push(["Reference", p.guaranteeRef]);
  /* NAMED, EVERY ONE OF THEM. Matt, 2026-10-01: "send all the tenancy's
     signed deeds in one email, listing each tenant, and say if any are
     still unsigned". The single Tenant row named whoever triggered the
     send, which on a joint tenancy is one of two or three people the
     landlord is being told about. */
  const signedNames = p.joint?.signedNames ?? [];
  const unsignedNames = p.joint?.unsignedNames ?? [];
  if (p.joint) {
    rows.push([signedNames.length === 1 ? "Signed by" : "Signed by", signedNames.join(", ") || "-"]);
    if (unsignedNames.length) rows.push(["Not yet signed", unsignedNames.join(", ")]);
  } else {
    rows.push(["Tenant", p.tenantName]);
  }
  rows.push(["Property", p.propertyAddr]);
  const note = (p.note ?? "").trim();
  const blocks: Message["blocks"] = [];
  if (note) blocks.push({ p: note });
  /* ONE SENTENCE ABOUT THE ATTACHMENT, not two. The covering line the
     agent types usually says "please find attached" in its own words, and
     the body said it again in ours; on a joint tenancy there is more than
     one to describe anyway, so the sentence now says how many and what
     they are for. */
  const whatIsAttached = signedNames.length > 1
    ? `The ${signedNames.length} signed Deeds of Guarantee for this tenancy are attached, one for each tenant who has signed.`
    : "The signed Deed of Guarantee is attached.";
  const stillOut = unsignedNames.length
    ? ` ${unsignedNames.join(" and ")} ${unsignedNames.length === 1 ? "has" : "have"} not signed yet; we will send ${unsignedNames.length === 1 ? "theirs" : "theirs"} when they do.`
    : "";
  blocks.push({ p: `${whatIsAttached} Keep ${signedNames.length > 1 ? "them" : "it"} with the tenancy paperwork, ${signedNames.length > 1 ? "they are" : "it is"} the reference for any claim under the guarantee.${stillOut}` });
  blocks.push({ rows });
  /* AND NOT A REMINDER NOBODY SENDS THEM. Matt, 2026-10-01: "remove 'We
     will email you a month before the guarantee ends' unless the landlord
     really does get that reminder."

     They do not. expiry-reminders addresses notification_recipients(...,
     'lapse'), which resolves portal users and the branch's agent contact.
     A private landlord emailed once by their agent is on no list at all,
     so this promised a letter that was never going to arrive. */
  blocks.push({ small: "opndoor is the guarantor for the term above." });
  return {
    // The landlord is not a portal user, so the header names the document, not
    // the portal.
    brandLabel: "Deed of Guarantee",
    subject: signedNames.length > 1
      ? `Signed Deeds of Guarantee for ${p.propertyAddr}`
      : `Signed Deed of Guarantee for ${p.guaranteeRef}`,
    heading: signedNames.length > 1
      ? "The Deeds of Guarantee have been signed"
      : "The Deed of Guarantee has been signed",
    blocks,
  };
}

/** To the TENANT. No Tenant line: they know who they are. The signed deed rides
    as an attachment (added by the sender); no portal line, a tenant has no login. */
export function executedDeedTenantEmail(p: {
  guaranteeRef: string; propertyAddr: string;
  tenancyStartLabel?: string | null;
  /** The same correction notice as the agent's copy: "Same for the
      tenant's copy", Matt, 2026-10-01. */
  correctedFrom?: string | null;
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
      ...(p.correctedFrom
        ? [{ callout: `This corrected deed replaces the one sent on ${p.correctedFrom}.${p.tenancyStartLabel ? ` The tenancy start is now ${p.tenancyStartLabel};` : ''} please discard the earlier copy.` }]
        : []),
      { p: "The Deed of Guarantee for your tenancy has been signed by all parties. A copy is attached for your records, and you do not need to do anything else." },
      { rows },
      { p: "We will email you a month before the guarantee ends." },
      /* THE FOOTER ALREADY SAYS THE REST. Matt, 2026-10-01: "remove the
         duplicate 'not insurance, not a party to your tenancy' sentence
         from the body; the footer already says it." Every email built by
         emailLayout carries it, so this line printed it twice, eight
         words apart. What is kept is the half the footer does not say. */
      { small: "opndoor is your guarantor for the term above. If anything changes, speak to your letting agent first." },
    ],
  };
}

/** The month-before-expiry renewal notice, sent to the tenant, the agent or
    landlord, and the referrer. Names the tenant and property because not every
    recipient is the tenant; invites a reply to continue cover. */
/* =====================================================================
   TWO EMAILS, BECAUSE THERE ARE TWO READERS.

   Matt, 2026-10-02: "Renewal notice: send the tenant their own email,
   worded for them ('Your guarantee for [property] ends on [date]…'),
   and the agent theirs, as two separate sends."

   WHAT IT WAS. One send carrying the tenant AND the agent AND the
   referrer, so there was one wording and it was the agent's: a tenant
   received "The guarantee for Amara Okonjo at 14 Chalcot Square ends on
   1 September 2027", which is a third-person email about themselves,
   with the only action being to email support.

   THE SINGLE SEND WAS DELIBERATE and its reason still holds for the
   agent side: one notification to a list, not a loop per address, which
   is the shape every other job uses and the shape the deed rule
   specified. That is why the agent arm keeps it and only the tenant is
   lifted out -- the split is by AUDIENCE, which is what differs, and not
   by address.
   ===================================================================== */

/** The agent's, referrer's or landlord's copy. Third person, because the
    subject is somebody else's tenancy. */
export function renewalNoticeEmail(p: { tenantName: string; propertyAddr: string; endDate: string }): Message {
  return {
    subject: `The opndoor guarantee for ${p.tenantName} ends on ${p.endDate}`,
    heading: "The guarantee is ending soon",
    blocks: [
      { p: `The guarantee for ${p.tenantName} at ${p.propertyAddr} ends on ${p.endDate}. If the tenancy is continuing and you would like cover to continue, email support@opndoor.co.` },
    ],
  };
}

/** The tenant's own copy. Second person, and it says what it means for
    them rather than reporting them to themselves. */
export function tenantRenewalNoticeEmail(p: { propertyAddr: string; endDate: string; guaranteeRef: string }): Message {
  return {
    audience: "tenant",
    subject: `Your opndoor guarantee ends on ${p.endDate}`,
    heading: "Your guarantee is ending soon",
    blocks: [
      { p: `Your guarantee for ${p.propertyAddr} ends on ${p.endDate}. Nothing happens automatically: if your tenancy is continuing and you would like the cover to continue, email support@opndoor.co and we will tell you what is needed.` },
      { rows: [["Reference", p.guaranteeRef], ["Cover ends", p.endDate]] },
      /* NO ACTION BUTTON. There is nothing for them to press: renewal is
         a conversation, and a button that only opens a mail client reads
         as a form they have failed to fill in. */
      { small: "If the tenancy has already ended, you do not need to do anything." },
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

export function referrerPaidEmail(p: {
  guaranteeRef: string; tenantName: string; propertyAddr: string; portalUrl?: string;
  /** On a joint tenancy, how many of the tenants have paid and how many
      there are. Absent on a tenancy of one, where the email is unchanged. */
  joint?: { paid: number; count: number } | null;
}): Message {
  /* HOW MANY HAVE PAID. Matt, 2026-10-01: 'Agent "fee paid" email for a
     joint tenancy: add how many have paid, e.g. "1 of 2 tenants have
     paid."'

     Each tenant pays their own share, so an agent gets one of these per
     tenant, days apart, each naming a different person and none of them
     saying where the tenancy has got to. "1 of 2" is the sentence that
     tells them whether to expect another. A tenancy of one says nothing:
     "1 of 1 tenants have paid" is noise. */
  const tally = p.joint && p.joint.count > 1
    ? ` ${p.joint.paid} of ${p.joint.count} tenants ${p.joint.paid === 1 ? "has" : "have"} paid.`
    : "";
  return withAction({
    subject: `Guarantee fee paid for ${p.tenantName}`,
    heading: "The guarantee fee has been paid",
    blocks: [
      { p: `${p.tenantName} has paid the guarantee fee for ${p.propertyAddr}. The Deed of Guarantee will be issued for signing.${tally}` },
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
      /* WALK FIX 33. THE CLAUSE IS DROPPED WHEN THERE IS NO PARTY TO NAME.
         Somebody joining the Opndoor team is joining opndoor, which the
         sentence already says, and "the opndoor Portal for opndoor" is not
         a sentence. An empty name used to print "for ." here.

         WHAT GOES IN IT is decided by invitePartyName, not by the caller
         reading `partners.name`: on the agency rail that name is the house
         partner "Opndoor Agents", which is the leak Matt reported. */
      { p: `${p.inviterName} has invited you to the opndoor Guarantee Referral Portal${p.partnerName ? ` for ${p.partnerName}` : ""}. Choose a password and set up two-factor authentication to get started.` },
      /* WALK FIX 32. This said "You will need an authenticator app" and then,
         four lines down, "You need an authenticator app". One short line. */
      { small: "Two-factor authentication is required on every sign in, so you will need an authenticator app. Google Authenticator is free:" },
      /* WHERE TO GET ONE, in the invite rather than only on the screen, so the
         invitee can install it before they start rather than stopping halfway
         through enrolment to go to a store.

         ONLY FREE APPS ARE NAMED, and this is the rule, not a preference: a
         required security step must never be gated behind somebody buying
         software. Google Authenticator is free on both stores and an iPhone has
         one built in, so nobody has to spend anything.

         WALK FIX 31: ONE CLEAN LINK EACH. The URL used to be the link text as
         well as the href, because renderText stripped tags and an anchor
         reading "App Store" would have left a text-only reader the words and
         not the address. Two things were wrong with that. The address appeared
         twice in the HTML, which Matt reported; and it did not even work,
         because rich()'s href pattern could not match a URL containing o, u or
         t, so the whole tag arrived as escaped text. Both are fixed in
         emailLayout: the pattern is right, and renderText now prints
         "label: address" for an anchor, so the plain-text reader keeps the URL
         without the HTML reader seeing it twice.

         The same copy is on the enrolment screen in src/pages/Login/Login.tsx,
         which cannot be imported here (this runs on Deno). If one changes, change
         both. */
      { list: [
        `<a href="${APP_STORE_GA}" style="color:#5b3fd9;">App Store</a>`,
        `<a href="${GOOGLE_PLAY_GA}" style="color:#5b3fd9;">Google Play</a>`,
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
