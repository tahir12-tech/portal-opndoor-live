// =====================================================================
// Stripe key mode guard, shared by payment-page, stripe-webhook and
// create-referral.
//
// The problem this solves: those three functions previously hardcoded
// `startsWith("sk_live_")`, so a test key was rejected everywhere. That made the
// payment path impossible to exercise on any non-production project, and the
// only way to make a dev project work was to install live Stripe credentials on
// it, which risks real cards being charged from a disposable environment.
//
// The rule here is symmetric: the key mode must MATCH the project it is running
// on. A non-production project requires sk_test_, and everything else requires
// sk_live_. That blocks both accidents, not just the one.
//
// Why the project ref and not an env var: SUPABASE_URL is injected by the
// platform, and Supabase reserves the SUPABASE_ prefix so it cannot be set or
// overridden with `supabase secrets set`. An operator therefore cannot relax
// production from the dashboard. A plain ALLOW_TEST_STRIPE flag would put
// production's safety behind a value anyone with dashboard access could change.
//
// Fail closed: an unrecognised ref (including a missing or malformed
// SUPABASE_URL) falls through to requiring sk_live_. A new environment must be
// added to NON_PRODUCTION_REFS in a reviewed change before it can use test keys,
// rather than defaulting to permissive.
//
// Production needs no configuration change for this: its behaviour is identical
// to the previous hardcoded guard.
// =====================================================================

// Non-production projects, which must use test keys.
// xogpsaoyprgmxdkmcype (portal.opndoor.Live) is deliberately absent.
const NON_PRODUCTION_REFS = new Set<string>([
  "nfufwcpgrhfgwtphegca", // opndoor-matt-dev
]);

/** The project ref this function is running on, or "" if it cannot be determined. */
function projectRef(): string {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  return /https:\/\/([a-z]{20})\./.exec(url)?.[1] ?? "";
}

/** Which Stripe key prefix this project requires. */
export function requiredStripePrefix(): "sk_test_" | "sk_live_" {
  return NON_PRODUCTION_REFS.has(projectRef()) ? "sk_test_" : "sk_live_";
}

/**
 * Returns an error message when the configured Stripe key is the wrong mode for
 * this project, or null when it is correct. Callers keep their own response
 * shape; this only decides the message.
 */
export function stripeKeyModeError(secret: string): string | null {
  const want = requiredStripePrefix();
  if (secret.startsWith(want)) return null;
  return want === "sk_test_"
    ? "This is a non-production project and requires an sk_test_ key."
    : "Stripe is not configured for live mode. An sk_live_ key is required.";
}
