// Run: deno test supabase/functions/_shared/rateLimit.test.ts
//
// The case that matters is "the limiter could not answer". It used to be
// indistinguishable from "refused", and the caller's contract on a refusal was
// to reply with its NORMAL response. So a transient RPC failure made a password
// reset answer "a reset link is on its way" and send nothing, with no log line
// and nothing in the database except one counter row written and its pair
// missing. That is the shape these tests exist to keep out.
import { assertEquals, assertRejects, assertStringIncludes } from
  "https://deno.land/std@0.224.0/assert/mod.ts";
import { limitCheck, LimiterUnavailable } from "./rateLimit.ts";

const req = (ip = "1.2.3.4") =>
  new Request("https://example.invalid/", { headers: { "x-forwarded-for": ip } });

/** A stand-in for the supabase client. `answer` decides what each key returns. */
function fake(answer: (key: string) => unknown, rows: { window_start: string }[] = []) {
  return {
    rpc(_fn: string, args: { p_key: string }) {
      const out = answer(args.p_key);
      return out instanceof Error ? Promise.reject(out) : Promise.resolve(out);
    },
    from() {
      return { select: () => ({ in: () => Promise.resolve({ data: rows }) }) };
    },
  };
}

const ALLOW = () => ({ data: true, error: null });

Deno.test("both counters under the cap is a pass", async () => {
  const v = await limitCheck(fake(ALLOW), req(), "reset", "a@example.invalid", 5, 20);
  assertEquals(v, { ok: true, minutes: 0 });
});

Deno.test("a genuine refusal returns, and carries the wait", async () => {
  const startedMinsAgo = 20;
  const rows = [{
    window_start: new Date(Date.now() - startedMinsAgo * 60_000).toISOString(),
  }];
  const v = await limitCheck(
    fake((k) => (k.includes(":e:") ? { data: false, error: null } : { data: true, error: null }), rows),
    req(), "reset", "a@example.invalid", 5, 20,
  );
  assertEquals(v.ok, false);
  // An hour from the first attempt, so 40 minutes left, not "wait a little".
  assertEquals(v.minutes, 60 - startedMinsAgo);
});

Deno.test("an RPC that ERRORS throws, and is never scored as over the limit", async () => {
  // THE DEFECT. { data: null, error } and { data: false } used to be one thing.
  await assertRejects(
    () => limitCheck(
      fake((k) => (k.includes(":i:")
        ? { data: null, error: { message: "connection reset" } }
        : { data: true, error: null })),
      req(), "reset", "a@example.invalid", 5, 20,
    ),
    LimiterUnavailable,
  );
});

Deno.test("an RPC that REJECTS throws too, not just one that returns an error", async () => {
  // Promise.all would have surfaced only the first failure. allSettled sees both.
  await assertRejects(
    () => limitCheck(
      fake(() => new Error("socket hang up")),
      req(), "reset", "a@example.invalid", 5, 20,
    ),
    LimiterUnavailable,
  );
});

Deno.test("the fault names the bucket and never the address", async () => {
  // detail reaches the logs. One of the two keys is the tenant's email address.
  const email = "someone.private@example.invalid";
  let err: LimiterUnavailable | null = null;
  try {
    await limitCheck(
      fake((k) => (k.includes(":e:")
        ? { data: null, error: { message: "boom" } }
        : { data: true, error: null })),
      req(), "reset", email, 5, 20,
    );
  } catch (e) {
    err = e as LimiterUnavailable;
  }
  if (err === null) throw new Error("expected LimiterUnavailable, got a verdict");
  assertStringIncludes(err.detail, "address");
  assertEquals(err.detail.includes(email), false);
  // And the message a user sees says nothing about limits, because none applied.
  assertEquals(err.message, "We could not process that just now. Try again in a moment.");
});

Deno.test("a refusal with no rows still gives a usable number", async () => {
  const v = await limitCheck(
    fake(() => ({ data: false, error: null }), []),
    req(), "reset", "a@example.invalid", 5, 20,
  );
  assertEquals(v.ok, false);
  assertEquals(v.minutes, 1);   // never "try again in 0 minutes"
});
