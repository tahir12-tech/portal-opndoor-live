// Run: deno test supabase/functions/_shared/redact.test.ts
//
// The cases that matter are the ones asserting something is STILL redacted.
// A redactor that over-masks produces a worse Logs tab; one that under-masks
// puts a tenant's date of birth in a table half the company can read.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { redact, redactRawBody } from "./redact.ts";

Deno.test("keys survive, values do not", () => {
  const out = redact({
    tenant: {
      title: "Mr", first_name: "Jo", last_name: "Bloggs",
      date_of_birth: "1990-04-12", email: "jo@example.com", phone: "07700900000",
    },
  }) as Record<string, Record<string, unknown>>;

  // Every field name is still there: this is what tells a developer they sent it.
  assertEquals(Object.keys(out.tenant).sort(), [
    "date_of_birth", "email", "first_name", "last_name", "phone", "title",
  ]);
  for (const v of Object.values(out.tenant)) assertEquals(v, "[redacted]");
});

Deno.test("the whole property address is masked", () => {
  const out = redact({
    property: {
      address_line_1: "1 High Street", address_line_2: "Flat 2",
      city: "London", county: "Greater London", postcode: "SW1A 1AA",
    },
  }) as Record<string, Record<string, unknown>>;
  for (const v of Object.values(out.property)) assertEquals(v, "[redacted]");
});

Deno.test("tenancy terms and ids survive, because they are not personal", () => {
  const out = redact({
    tenancy: { monthly_rent: 1250, start_date: "2026-09-01" },
    org: { agency_id: "a-uuid", branch_id: "b-uuid", agency_name: "Foo Lettings" },
  }) as Record<string, Record<string, unknown>>;
  assertEquals(out.tenancy.monthly_rent, 1250);
  assertEquals(out.tenancy.start_date, "2026-09-01");
  assertEquals(out.org.agency_id, "a-uuid");
  assertEquals(out.org.agency_name, "Foo Lettings");
});

Deno.test("payment_url is redacted despite looking structural", () => {
  const out = redact({
    application: { id: "x", guarantee_ref: "GR-1", payment_url: "https://pay.example/abc" },
  }) as Record<string, Record<string, unknown>>;
  assertEquals(out.application.id, "x");
  assertEquals(out.application.guarantee_ref, "GR-1");
  assertEquals(out.application.payment_url, "[redacted]");
});

Deno.test("token and secret shapes are redacted wherever they appear", () => {
  const out = redact({
    payment_token: "t", token: "t", api_key: "k", signing_secret: "s",
    Authorization: "Bearer x", webhook_signature: "sig",
  }) as Record<string, unknown>;
  for (const v of Object.values(out)) assertEquals(v, "[redacted]");
});

Deno.test("UNKNOWN fields are redacted, which a denylist would have leaked", () => {
  // The case the allowlist exists for: a partner sends something we have never
  // heard of, or we add a field and forget to classify it.
  const out = redact({
    tenant: { nino: "QQ123456C", passport_number: "123456789" },
    their_own_correlation_id: "abc",
  }) as Record<string, unknown>;
  const t = out.tenant as Record<string, unknown>;
  assertEquals(t.nino, "[redacted]");
  assertEquals(t.passport_number, "[redacted]");
  assertEquals(out.their_own_correlation_id, "[redacted]");
});

Deno.test("an unrecognised container name does not flatten what is inside it", () => {
  // Recursing into containers regardless of their own name is what preserves the
  // shape. If `whatever` were masked wholesale, the nested key names would be
  // lost and the tab would stop answering "what did I send".
  const out = redact({ whatever: { monthly_rent: 900, email: "a@b.c" } }) as Record<string, Record<string, unknown>>;
  assertEquals(out.whatever.monthly_rent, 900);
  assertEquals(out.whatever.email, "[redacted]");
});

Deno.test("the error envelope survives intact", () => {
  const out = redact({
    error: { code: "validation_failed", message: "Check the fields.",
             errors: [{ field: "tenant.email", code: "invalid", message: "Not an email." }] },
  }) as Record<string, Record<string, unknown>>;
  assertEquals(out.error.code, "validation_failed");
  const errs = out.error.errors as Record<string, unknown>[];
  assertEquals(errs[0].field, "tenant.email");
  assertEquals(errs[0].message, "Not an email.");
});

Deno.test("arrays and depth are capped rather than unbounded", () => {
  const big = redact({ items: Array.from({ length: 50 }, (_, i) => ({ id: String(i) })) }) as Record<string, unknown[]>;
  assertEquals(big.items.length, 21);            // 20 kept plus the marker
  assertEquals(big.items[20], "[+30 more]");

  let deep: unknown = { email: "leaf@example.com" };
  for (let i = 0; i < 12; i++) deep = { nest: deep };
  // Nothing throws, and nothing beyond the cap is emitted verbatim.
  assertEquals(typeof redact(deep), "object");
});

Deno.test("non-JSON is described, not stored", () => {
  const out = redactRawBody("<html>not json</html>") as Record<string, string>;
  assertEquals(out["[unparsed]"], "not valid JSON, 21 bytes");
  assertEquals(redactRawBody(""), null);
  assertEquals(redactRawBody(null), null);
});

Deno.test("redact never throws on hostile input", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  redact(cyclic);                                // depth cap ends it
  redact(undefined);
  redact(12345);
});
