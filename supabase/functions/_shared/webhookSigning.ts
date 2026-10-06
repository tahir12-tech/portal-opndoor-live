// =====================================================================
// Outbound webhook signing. See PARTNER-API.md section 13.4.
//
// Header format:
//   X-Opndoor-Signature: t=<unix seconds>,v1=<hex hmac-sha256>
//
// The signed value is "<t>.<raw body>", NOT the body alone. Signing the
// timestamp with the body is what makes replay detectable: a partner rejects a
// timestamp outside their tolerance, and an attacker cannot move a captured
// request forward in time without invalidating the signature.
//
// THE EXISTING INBOUND VERIFICATION IS NOT A MODEL TO COPY. The PandaDoc webhook
// check at _shared/pandadoc.ts:392 compares with `===`, and has no timestamp, no
// nonce and no tolerance, so a captured call can be replayed against it
// indefinitely. Worth fixing separately; not worth reproducing here.
//
// The v1 prefix is there so a future scheme can be added alongside rather than
// replacing it, letting partners migrate on their own schedule.
// =====================================================================

const enc = new TextEncoder();

/** HMAC-SHA256 of `${timestamp}.${body}`, lowercase hex. */
export async function signPayload(secret: string, body: string, timestampSecs: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestampSecs}.${body}`));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type SignedHeaders = Record<string, string>;

export async function signedHeaders(
  secret: string,
  body: string,
  eventId: string,
  eventType: string,
): Promise<SignedHeaders> {
  const t = Math.floor(Date.now() / 1000);
  const v1 = await signPayload(secret, body, t);
  return {
    "Content-Type": "application/json",
    "X-Opndoor-Signature": `t=${t},v1=${v1}`,
    "X-Opndoor-Event-Id": eventId,
    "X-Opndoor-Event-Type": eventType,
    "User-Agent": "Opndoor-Webhooks/1",
  };
}

/**
 * Generate an endpoint signing secret.
 *
 * 32 bytes from the CSPRNG, hex encoded. Shown once at registration and not
 * retrievable afterwards, the same posture as an API key.
 */
export function generateEndpointSecret(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return "whsec_" + Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}
