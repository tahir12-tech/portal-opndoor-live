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

/* ---- tenant: identity and access ---------------------------------------- */

export function codeEmail(code: string, minutes: number): Message {
  return {
    subject: `${code} is your opndoor confirmation code`,
    heading: "Your confirmation code",
    blocks: [
      { p: "Enter this code to confirm your email address and continue your application." },
      { callout: code },
      { small: `It lasts ${minutes} minutes and can be used once. If you did not ask for this, you can ignore it and nothing happens. We will never ask you for this code.` },
    ],
  };
}

export function passwordResetEmail(link: string): Message {
  return {
    subject: "Reset your opndoor password",
    heading: "Reset your password",
    blocks: [
      { p: "We received a request to reset the password on your opndoor account. Choose a new one using the button below." },
      { small: "For your security this link expires in 30 minutes and can be used once. If you did not ask for it, nothing has changed and you can ignore this email." },
    ],
    action: { label: "Choose a new password", href: link },
  };
}

export function accountExistsEmail(): Message {
  return {
    subject: "You already have an opndoor account",
    heading: "You already have an account",
    blocks: [
      { p: "Somebody, probably you, tried to create an opndoor account with this address. You already have one, so nothing has changed." },
      { small: "If that was not you, reset your password to be sure." },
    ],
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

export function paymentLinkEmail(p: {
  propertyAddr: string; guaranteeRef: string; amount: string;
  tenancyStartLabel?: string | null; payUrl: string;
}): Message {
  const rows: [string, string][] = [
    ["Reference", p.guaranteeRef],
    ["Property", p.propertyAddr],
    ["Guarantee fee", p.amount],
  ];
  if (p.tenancyStartLabel) rows.push(["Tenancy starts", p.tenancyStartLabel]);
  return {
    subject: "Your opndoor guarantee is ready to pay",
    heading: "Your guarantee is approved",
    blocks: [
      { p: `opndoor is acting as guarantor for your tenancy at ${p.propertyAddr}. The last step is the guarantee fee.` },
      { rows },
      { small: "The fee is one month of rent and is payable once. The Deed of Guarantee is issued as soon as it clears." },
    ],
    action: { label: "Pay the guarantee fee", href: p.payUrl },
  };
}

export function paymentReminderEmail(p: {
  propertyAddr: string; guaranteeRef: string; amount: string;
  openUntilLabel?: string | null; payUrl: string; nudge: 1 | 2 | 3;
}): Message {
  const lead = p.nudge === 1
    ? "Just checking this reached you."
    : p.nudge === 2
      ? `Your tenancy at ${p.propertyAddr} is waiting on the guarantee fee.`
      : "To keep your tenancy on track, the guarantee fee needs paying.";
  const rows: [string, string][] = [["Reference", p.guaranteeRef], ["Guarantee fee", p.amount]];
  if (p.openUntilLabel) rows.push(["Open until", p.openUntilLabel]);
  return {
    subject: "A reminder about your opndoor guarantee",
    heading: "Your guarantee is still waiting",
    blocks: [
      // True whoever referred them, and true if nobody did. This used to say
      // they had been referred, which is false for a direct signup.
      { p: `${lead} opndoor is acting as guarantor for your tenancy at ${p.propertyAddr}.` },
      { rows },
    ],
    action: { label: "Pay the guarantee fee", href: p.payUrl },
  };
}

export function paymentReceiptEmail(p: {
  propertyAddr: string; guaranteeRef: string; amount: string; managedBy: string;
}): Message {
  return {
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

/** To the AGENT. Names the tenant, because they are not the recipient. */
export function executedDeedAgentEmail(p: {
  guaranteeRef: string; tenantName: string; propertyAddr: string;
  expiryLabel?: string | null; downloadUrl?: string;
}): Message {
  const rows: [string, string][] = [
    ["Reference", p.guaranteeRef],
    ["Tenant", p.tenantName],
    ["Property", p.propertyAddr],
  ];
  if (p.expiryLabel) rows.push(["Guarantee expires", p.expiryLabel]);
  return {
    subject: `Signed Deed of Guarantee for ${p.guaranteeRef}`,
    heading: "The Deed of Guarantee has been signed",
    blocks: [
      { p: "The Deed of Guarantee for the tenancy below has been signed by all parties. A copy is attached for your records." },
      { rows },
      { small: "opndoor remains the guarantor for the term above. You remain the claim contact." },
    ],
    ...(p.downloadUrl ? { action: { label: "Download the deed", href: p.downloadUrl } } : {}),
  };
}

/** To the TENANT. No Tenant line: they know who they are. */
export function executedDeedTenantEmail(p: {
  guaranteeRef: string; propertyAddr: string;
  expiryLabel?: string | null; downloadUrl?: string;
}): Message {
  const rows: [string, string][] = [["Reference", p.guaranteeRef], ["Property", p.propertyAddr]];
  if (p.expiryLabel) rows.push(["Guarantee expires", p.expiryLabel]);
  return {
    subject: `Your signed Deed of Guarantee for ${p.guaranteeRef}`,
    heading: "Your Deed of Guarantee has been signed",
    blocks: [
      { p: "The Deed of Guarantee for your tenancy has been signed by all parties. A copy is attached for your records, and you do not need to do anything else." },
      { rows },
      { small: "opndoor is your guarantor for the term above. opndoor is a professional guarantor service, not insurance, and is not a party to your tenancy agreement. If anything changes, speak to your letting agent first." },
    ],
    ...(p.downloadUrl ? { action: { label: "Download your deed", href: p.downloadUrl } } : {}),
  };
}

/* ---- partner and staff --------------------------------------------------- */

export function staffInviteEmail(p: { inviterName: string; partnerName: string; link: string }): Message {
  return {
    subject: "You have been invited to the opndoor portal",
    heading: "Set up your portal account",
    blocks: [
      { p: `${p.inviterName} has invited you to the opndoor Guarantee Referral Portal for ${p.partnerName}. Choose a password and set up two-factor authentication to get started.` },
      { small: "Two-factor authentication is required on every sign in. You will need an authenticator app." },
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
