// =====================================================================
// Third-party credentials, resolved per application rather than per project.
//
// Sandbox lives inside the live system, so one deployment now holds two sets of
// Stripe and PandaDoc credentials and has to pick between them per row. This is
// the only file that knows which is which. Scattering `livemode ? a : b` across
// stripe-webhook, payment-page, create-referral, pandadoc.ts and
// payment-confirmation would work and would be impossible to audit; here the
// whole credential set for each mode is one screen of code.
//
// ---------------------------------------------------------------------------
// THE RULE THAT MATTERS: A MISSING SANDBOX SECRET IS AN ERROR, NEVER A FALLBACK
// ---------------------------------------------------------------------------
// The obvious shape is `Deno.env.get("STRIPE_SECRET_KEY_TEST") ?? Deno.env.get("STRIPE_SECRET_KEY")`.
// It reads as a sensible default and it is the single worst line that could be
// written in this file. On production, an unset sandbox secret would silently
// resolve to the LIVE key, and the first thing a developer rehearsing a payment
// does is charge a real card with a real settlement, against an application
// nobody can see in the portal because livemode is false.
//
// So the fallback exists in exactly one direction, and only where it cannot
// cause that: on a NON-PRODUCTION project there is only ever one credential set,
// all of it test, and there is no live key to fall back to. On production a
// missing sandbox secret is a hard, loud configuration error.
//
// ---------------------------------------------------------------------------
// WHY THE _TEST SUFFIX
// ---------------------------------------------------------------------------
// It matches the opnd_test_ API key prefix already used in this codebase and
// Stripe's own "test mode" language, so an operator setting secrets in the
// dashboard does not have to learn a third vocabulary. See HANDOVER.md for the
// list Balal has to set on production before sandbox works there.
// =====================================================================

import { requiredStripePrefix, isNonProductionProject } from "./stripeMode.ts";

/** A resolved credential, or the reason it could not be resolved. */
export type CredResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * Read a secret for the given mode.
 *
 * Live reads the base name. Sandbox reads NAME_TEST, and falls back to the base
 * name ONLY on a non-production project, where the base name is itself a test
 * credential and there is nothing dangerous to fall back to.
 */
function secretFor(name: string, livemode: boolean): string {
  if (livemode) return (Deno.env.get(name) ?? "").trim();

  const test = (Deno.env.get(`${name}_TEST`) ?? "").trim();
  if (test) return test;

  // The one permitted fallback, and only here.
  if (isNonProductionProject()) return (Deno.env.get(name) ?? "").trim();

  return "";
}

/** The message an operator needs, naming the exact secret to set. */
function missing(name: string, livemode: boolean): string {
  return livemode
    ? `${name} is not configured.`
    : `${name}_TEST is not configured. Sandbox requires its own credentials and will never fall back to the live ones.`;
}

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------

/**
 * The Stripe secret key for an application.
 *
 * The prefix check is the composition of two independent rules, and both have to
 * hold:
 *
 *   a LIVE application    must use whatever the PROJECT requires, which is
 *                         sk_live_ on production and sk_test_ on a dev project
 *   a SANDBOX application must use sk_test_, on every project without exception
 *
 * Keeping the project rule for live applications is what stops this change
 * breaking dev, where there is no sk_live_ key at all and never should be.
 */
export function stripeSecretFor(livemode: boolean): CredResult<string> {
  const secret = secretFor("STRIPE_SECRET_KEY", livemode);
  if (!secret) return { ok: false, error: missing("STRIPE_SECRET_KEY", livemode) };

  const want = livemode ? requiredStripePrefix() : "sk_test_";
  if (!secret.startsWith(want)) {
    return {
      ok: false,
      error: livemode
        ? `The configured Stripe key is the wrong mode for this project: ${want} is required.`
        : `Sandbox requires an sk_test_ Stripe key. STRIPE_SECRET_KEY_TEST is set to a ${secret.slice(0, 8)} key.`,
    };
  }
  return { ok: true, value: secret };
}

/**
 * The Stripe PUBLISHABLE key for an application, resolved in the SAME mode as its
 * secret key so an embedded checkout mounts with a key matching the session
 * Stripe created: pk_live_ where the secret is sk_live_, pk_test_ where it is
 * sk_test_. Reads STRIPE_PUBLISHABLE_KEY (live / base) or STRIPE_PUBLISHABLE_KEY_TEST.
 */
export function stripePublishableFor(livemode: boolean): CredResult<string> {
  const key = secretFor("STRIPE_PUBLISHABLE_KEY", livemode);
  if (!key) return { ok: false, error: missing("STRIPE_PUBLISHABLE_KEY", livemode) };
  const want = livemode ? (requiredStripePrefix() === "sk_live_" ? "pk_live_" : "pk_test_") : "pk_test_";
  if (!key.startsWith(want)) {
    return { ok: false, error: `The configured Stripe publishable key is the wrong mode for this project: ${want} is required.` };
  }
  return { ok: true, value: key };
}

/**
 * Both Stripe webhook signing secrets, live first.
 *
 * Returned as a list rather than a choice because an INBOUND webhook has no
 * application yet: the mode is discovered by finding which secret verifies the
 * signature. See stripe-webhook/index.ts. An empty entry is dropped rather than
 * attempted, so an unconfigured sandbox on production simply never matches
 * instead of erroring on every live event.
 */
export function stripeWebhookSecrets(): Array<{ livemode: boolean; secret: string }> {
  const out: Array<{ livemode: boolean; secret: string }> = [];
  const live = secretFor("STRIPE_WEBHOOK_SECRET", true);
  const test = secretFor("STRIPE_WEBHOOK_SECRET", false);
  if (live) out.push({ livemode: true, secret: live });
  // Only if it is genuinely distinct. On a dev project both resolve to the same
  // string via the permitted fallback, and trying it twice would report a live
  // event as ambiguous.
  if (test && test !== live) out.push({ livemode: false, secret: test });
  return out;
}

// ---------------------------------------------------------------------------
// PandaDoc
// ---------------------------------------------------------------------------

export type PandadocConfig = { key: string; templateId: string };

/**
 * PandaDoc API key and template for an application.
 *
 * The sandbox key is a real PandaDoc credential that produces real documents,
 * watermarked with a developer prefix, and it sends them. That is deliberate and
 * it is why the Dev Centre surfaces the signing link with a warning: whatever
 * address is POSTed as tenant_email genuinely receives one.
 *
 * The template is per mode too, not just the key. A PandaDoc sandbox key cannot
 * see a production template, so sharing one id would fail at document creation
 * with a 404 that reads like a broken integration rather than a missing secret.
 */
export function pandadocConfigFor(livemode: boolean): CredResult<PandadocConfig> {
  const key = secretFor("PANDADOC_API_KEY", livemode);
  if (!key) return { ok: false, error: missing("PANDADOC_API_KEY", livemode) };

  const templateId = secretFor("PANDADOC_TEMPLATE_ID", livemode);
  if (!templateId) return { ok: false, error: missing("PANDADOC_TEMPLATE_ID", livemode) };

  return { ok: true, value: { key, templateId } };
}

/** Whether PandaDoc is usable at all for this mode. Replaces pandadocConfigured(). */
export function pandadocConfiguredFor(livemode: boolean): boolean {
  return pandadocConfigFor(livemode).ok;
}

/**
 * Both PandaDoc webhook shared keys, live first. Same reasoning as
 * stripeWebhookSecrets: an inbound callback has no application yet.
 */
export function pandadocWebhookKeys(): Array<{ livemode: boolean; secret: string }> {
  const out: Array<{ livemode: boolean; secret: string }> = [];
  const live = secretFor("PANDADOC_WEBHOOK_SHARED_KEY", true);
  const test = secretFor("PANDADOC_WEBHOOK_SHARED_KEY", false);
  if (live) out.push({ livemode: true, secret: live });
  if (test && test !== live) out.push({ livemode: false, secret: test });
  return out;
}

// ---------------------------------------------------------------------------
// The two integrations sandbox does not touch at all
// ---------------------------------------------------------------------------

/**
 * Whether Opndoor may send its own email about this application.
 *
 * Sandbox sends none. Not a different from address, not a redirect to a review
 * mailbox: none. A redirect would still be an email leaving our infrastructure
 * on behalf of a test row, and the review-mailbox pattern already in this
 * codebase (EMAIL_REVIEW_ADDRESS, now commented out in several files) is exactly
 * the kind of half-measure that gets switched off and forgotten.
 *
 * This deliberately does NOT cover PandaDoc's own signing email, which sandbox
 * does send, because that is PandaDoc's watermarked document rather than ours
 * and rehearsing the tenant's signing journey is most of the point.
 */
export function maySendOpndoorEmail(livemode: boolean): boolean {
  return livemode;
}

/**
 * Whether this application may reach HubSpot. Never, for sandbox.
 *
 * Enforced in SQL as well: hubspot_pending_events carries a livemode predicate,
 * so a sandbox row never enters the sync cursor in the first place. This exists
 * so a future caller that queries activity_log directly cannot bypass that.
 */
export function maySyncToHubspot(livemode: boolean): boolean {
  return livemode;
}
