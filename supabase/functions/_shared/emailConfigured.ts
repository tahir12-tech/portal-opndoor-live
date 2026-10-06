// =====================================================================
// Is email actually configured?
//
// THE DEFECT THIS CLOSES. With RESEND_API_KEY unset, sendEmail returns
// { ok: false, error: "Resend is not configured" } and every caller in
// tenant-auth threw that result away and answered { ok: true, sent: true }.
// So a dev run reported a working email step that had sent nothing: the
// registration code, the sign-in code, the reset link. Somebody then waits for
// an email that was never attempted, and the only honest record is a log line.
//
// That is the Toast failure shape: reporting success for something that did not
// happen. A step that cannot do its job must say so.
//
// WHERE TO CALL assertEmailConfigured(). At the TOP of a handler whose whole
// purpose is to send a message, BEFORE anything is created. Failing at the
// boundary leaves nothing half done. Calling it after a row has been written
// abandons that row and is worse than the silence it replaces.
//
// WHERE NOT TO. A handler whose deliverable is something else, and where the
// message is a side effect, must not throw: create-referral has already made an
// application and a Stripe checkout by the time it emails, and killing the
// request there would strand both. Those report the send truthfully instead,
// which is the same requirement met a different way.
// =====================================================================

export function emailConfigured(): boolean {
  return Boolean(Deno.env.get("RESEND_API_KEY"));
}

export class EmailNotConfigured extends Error {
  constructor() {
    super(
      "Email is not configured on this deployment: RESEND_API_KEY is unset, so " +
        "nothing can be sent. This request has done nothing rather than report " +
        "a message it never attempted.",
    );
    this.name = "EmailNotConfigured";
  }
}

/** Throw unless email can actually be sent. Call before doing any work. */
export function assertEmailConfigured(): void {
  if (!emailConfigured()) throw new EmailNotConfigured();
}
