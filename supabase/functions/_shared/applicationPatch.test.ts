// Run: deno test supabase/functions/_shared/applicationPatch.test.ts
//
// The bug these guard against was silent: a migration moved identity columns
// off application_profiles and the deployed function kept writing there, so
// every keystroke of the details step reported "Could not save" with no error
// anyone could see. A rename cannot fail a compile; only a test that knows the
// new home catches it.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { splitProfilePatch, deliveryContactReady } from "./applicationPatch.ts";

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

Deno.test("a letting agent is not written until the agency name arrives", () => {
  assertEquals(deliveryContactReady({ kind: "letting_agent", email: "a@b.co" }), false);
  assertEquals(deliveryContactReady({ kind: "letting_agent", email: "a@b.co", agency_name: "" }), false);
  assertEquals(deliveryContactReady({ kind: "letting_agent", email: "a@b.co", agency_name: "Meridian" }), true);
});

Deno.test("a private landlord is not written until the surname arrives", () => {
  assertEquals(deliveryContactReady({ kind: "private_landlord", email: "a@b.co" }), false);
  assertEquals(deliveryContactReady({ kind: "private_landlord", email: "a@b.co", last_name: "Oakley" }), true);
});

Deno.test("kind or email missing is always held, whatever else is present", () => {
  assertEquals(deliveryContactReady({ kind: "letting_agent", agency_name: "Meridian" }), false);
  assertEquals(deliveryContactReady({ email: "a@b.co", agency_name: "Meridian" }), false);
  assertEquals(deliveryContactReady({}), false);
});

Deno.test("an unknown kind is never written, since no check would pass it", () => {
  assertEquals(deliveryContactReady({ kind: "something_else", email: "a@b.co", agency_name: "X" }), false);
});
