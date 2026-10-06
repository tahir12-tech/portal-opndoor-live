// Run: deno test supabase/functions/_shared/placeOrRollback.test.ts
//
// The regression these guard: a user invited WITH a position must never survive a
// refused grant as an unscoped account. The old code kept the account and
// reported a soft error; the fix rolls the creation back. These pin the three
// outcomes that matter — refused-new rolls back, refused-reinvite does not, and a
// success touches nothing — so the fatal behaviour cannot silently revert to
// best-effort.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { placeOrRollback } from "./placeOrRollback.ts";

const refusal = { error: { message: "You do not hold a position that can grant this." } };
const granted = { error: null };

Deno.test("a refused grant on a NEW account rolls the account back and fails", async () => {
  let deleted = 0;
  const err = await placeOrRollback(
    () => Promise.resolve(refusal),
    () => { deleted++; return Promise.resolve(); },
    true, // createdNewUser
  );
  // The whole invite fails (a message is returned)...
  assertEquals(err, refusal.error.message);
  // ...and the just-created account is deleted, so no unscoped user is left.
  assertEquals(deleted, 1);
});

Deno.test("a refused grant on a RE-INVITE does not delete the pre-existing account", async () => {
  let deleted = 0;
  const err = await placeOrRollback(
    () => Promise.resolve(refusal),
    () => { deleted++; return Promise.resolve(); },
    false, // createdNewUser — the account already existed before this call
  );
  // The operation still fails...
  assertEquals(err, refusal.error.message);
  // ...but nothing this call did not create is deleted.
  assertEquals(deleted, 0);
});

Deno.test("a successful grant deletes nothing and reports no error", async () => {
  let deleted = 0;
  const err = await placeOrRollback(
    () => Promise.resolve(granted),
    () => { deleted++; return Promise.resolve(); },
    true,
  );
  assertEquals(err, null);
  assertEquals(deleted, 0);
});

Deno.test("the rollback is awaited before the failure is reported", async () => {
  // Ordering guard: if deleteCreatedUser were fired-and-forgotten, the email and
  // audit (which run only after placeOrRollback returns null) could still fire on
  // a half-rolled-back account. Prove the delete has resolved by the time we
  // learn of the failure.
  const events: string[] = [];
  const err = await placeOrRollback(
    () => Promise.resolve(refusal),
    async () => { await Promise.resolve(); events.push("deleted"); },
    true,
  );
  events.push("returned");
  assertEquals(err, refusal.error.message);
  assertEquals(events, ["deleted", "returned"]);
});
