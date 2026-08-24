// =====================================================================
// The limiter, and the difference between a NO and a SHRUG.
//
// This lived inside tenant-auth. It is here because the bug it used to carry
// is invisible from the outside and needs a test, and a function that runs
// inside Deno.serve cannot be imported by one.
//
// THE BUG. Two counters are bumped, one keyed on the address and one on the
// caller. The old code scored them:
//
//     const ok = a.data === true && b.data === true;
//
// which is correct only if data is ever false for one reason. It is not.
// supabase-js returns { data: null, error } when the call FAILED, so an outage
// arrived looking exactly like a refusal, and the caller, whose contract was
// "on refusal, answer with your normal response", answered a password reset
// with "a reset link is on its way" and sent nothing. No log, no trace. The
// only evidence was one counter row written and the other missing.
//
// A refusal is an answer, and it is quiet. A limiter that cannot answer is not
// a refusal, and it throws.
// =====================================================================

/** Thrown when the limiter could not answer. Never confuse this with a refusal. */
export class LimiterUnavailable extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super("We could not process that just now. Try again in a moment.");
    this.name = "LimiterUnavailable";
    this.detail = detail;
  }
}

export interface LimitVerdict {
  /** False means REFUSED. An unavailable limiter throws instead of returning. */
  ok: boolean;
  /** Whole minutes until the window clears. Zero only when ok. */
  minutes: number;
}

/**
 * Bump the per-address and per-caller counters and say what happened.
 *
 * The window is fixed at an hour from the first attempt, so window_start plus
 * an hour is the exact moment it clears, and the number is already in the row.
 */
export async function limitCheck(
  service: any, req: Request, action: string, email: string,
  perAddress: number, perCaller: number,
): Promise<LimitVerdict> {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const keys = [`ta:${action}:e:${email}`, `ta:${action}:i:${ip}`];

  // allSettled, not all. A thrown RPC and a returned error are the same event
  // to us, and Promise.all reports only whichever failed first while the other
  // outcome is lost. Both are needed to say what actually broke.
  const settled = await Promise.allSettled([
    service.rpc("bump_rate_limit", { p_key: keys[0], p_limit: perAddress, p_window_secs: 3600 }),
    service.rpc("bump_rate_limit", { p_key: keys[1], p_limit: perCaller,  p_window_secs: 3600 }),
  ]);

  // The bucket is named, never the key: one of the two keys IS the address, and
  // this string reaches the logs.
  const faults = settled
    .map((r, i) => {
      const bucket = i === 0 ? "address" : "caller";
      if (r.status === "rejected") return `${bucket}: ${String(r.reason)}`;
      const err = (r.value ?? {}).error;
      return err ? `${bucket}: ${err.message ?? String(err)}` : null;
    })
    .filter(Boolean) as string[];
  if (faults.length) {
    console.log(JSON.stringify({ event: "rate_limit_unavailable", action, faults }));
    throw new LimiterUnavailable(faults.join("; "));
  }

  const [a, b] = settled.map((r) => (r as PromiseFulfilledResult<any>).value);
  if (a.data === true && b.data === true) return { ok: true, minutes: 0 };

  // The longest wait across whichever counters are blocking, rounded up, and
  // never zero: "try again in 0 minutes" is worse than saying nothing.
  const { data: rows } = await service.from("rate_limit").select("window_start").in("key", keys);
  const now = Date.now();
  const mins = (rows ?? []).map((r: { window_start: string }) =>
    Math.ceil((new Date(r.window_start).getTime() + 3600_000 - now) / 60_000));
  return { ok: false, minutes: Math.max(1, ...(mins.length ? mins : [1])) };
}
