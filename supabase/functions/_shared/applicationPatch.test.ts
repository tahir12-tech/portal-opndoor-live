// Run: deno test supabase/functions/_shared/applicationPatch.test.ts
//
// The bug these guard against was silent: a migration moved identity columns
// off application_profiles and the deployed function kept writing there, so
// every keystroke of the details step reported "Could not save" with no error
// anyone could see. A rename cannot fail a compile; only a test that knows the
// new home catches it.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { splitProfilePatch, deliveryContactReady, resolveDeclaredAt } from "./applicationPatch.ts";

Deno.test("identity is routed to applications.tenant_*, not the profile table", () => {
  const { identity, declarations } = splitProfilePatch({
    title: "Mr", first_name: "Sam", last_name: "Oakley", dob: "1990-01-01", phone: "07700900123",
  });
  assertEquals(identity, {
    tenant_title: "Mr", tenant_first_name: "Sam", tenant_last_name: "Oakley",
    tenant_dob: "1990-01-01", tenant_phone: "07700900123",
  });
  assertEquals(declarations, {});
});

Deno.test("declarations stay on the profile table", () => {
  const { identity, declarations } = splitProfilePatch({
    nationality: "British", adverse_credit: true, marital_status: "single",
  });
  assertEquals(identity, {});
  assertEquals(declarations, { nationality: "British", adverse_credit: true, marital_status: "single" });
});

Deno.test("a mixed patch is split, not sent whole to one table", () => {
  // The exact shape the details step sends: name and a declaration together.
  const { identity, declarations } = splitProfilePatch({ last_name: "Oakley", marital_status: "single" });
  assertEquals(identity, { tenant_last_name: "Oakley" });
  assertEquals(declarations, { marital_status: "single" });
});

Deno.test("an identity blank becomes null, because a date column rejects empty string", () => {
  const { identity } = splitProfilePatch({ dob: "", title: "" });
  assertEquals(identity, { tenant_dob: null, tenant_title: null });
});

Deno.test("a declaration blank is left as the client sent it", () => {
  // "" is the client's own value here; only identity blanks are normalised.
  const { declarations } = splitProfilePatch({ maiden_name: "" });
  assertEquals(declarations, { maiden_name: "" });
});

Deno.test("a letting agent is not written until agency name, surname and phone arrive", () => {
  assertEquals(deliveryContactReady({ kind: "letting_agent", email: "a@b.co" }), false);
  assertEquals(deliveryContactReady({ kind: "letting_agent", email: "a@b.co", agency_name: "Meridian" }), false);
  assertEquals(deliveryContactReady({ kind: "letting_agent", email: "a@b.co", agency_name: "Meridian", last_name: "Oakley" }), false);
  assertEquals(deliveryContactReady({ kind: "letting_agent", email: "a@b.co", agency_name: "Meridian", last_name: "Oakley", phone: "07700900123" }), true);
});

Deno.test("a private landlord is not written until the surname and phone arrive", () => {
  assertEquals(deliveryContactReady({ kind: "private_landlord", email: "a@b.co" }), false);
  assertEquals(deliveryContactReady({ kind: "private_landlord", email: "a@b.co", last_name: "Oakley" }), false);
  assertEquals(deliveryContactReady({ kind: "private_landlord", email: "a@b.co", last_name: "Oakley", phone: "07700900123" }), true);
});

Deno.test("kind or email missing is always held, whatever else is present", () => {
  assertEquals(deliveryContactReady({ kind: "letting_agent", agency_name: "Meridian" }), false);
  assertEquals(deliveryContactReady({ email: "a@b.co", agency_name: "Meridian" }), false);
  assertEquals(deliveryContactReady({}), false);
});

Deno.test("an unknown kind is never written, since no check would pass it", () => {
  assertEquals(deliveryContactReady({ kind: "something_else", email: "a@b.co", agency_name: "X" }), false);
});

const NOW = "2026-08-25T12:00:00.000Z";

Deno.test("the declaration name routes to the profile table, not identity", () => {
  const { identity, declarations } = splitProfilePatch({ declared_name: "Sam Okafor" });
  assertEquals(identity, {});
  assertEquals(declarations, { declared_name: "Sam Okafor" });
});

Deno.test("a ticked declaration becomes declared_at with the server time", () => {
  assertEquals(resolveDeclaredAt({ declared_true: true }, NOW), { declared_at: NOW });
});

Deno.test("an unticked declaration clears declared_at", () => {
  assertEquals(resolveDeclaredAt({ declared_true: false }, NOW), { declared_at: null });
});

Deno.test("declared_true never survives to the table, whatever else is in the patch", () => {
  const out = resolveDeclaredAt({ declared_true: true, declaration_note: "hi" }, NOW);
  assertEquals("declared_true" in out, false);
  assertEquals(out, { declaration_note: "hi", declared_at: NOW });
});

Deno.test("a patch without a tick is left exactly as it was", () => {
  const decl = { nationality: "British", declaration_note: "" };
  assertEquals(resolveDeclaredAt(decl, NOW), decl);
});
