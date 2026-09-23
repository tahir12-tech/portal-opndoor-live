// Placing an invited user at their org position, with the grant made FATAL.
//
// THE HAZARD. invite-user creates the auth user + public.users row, then grants
// the requested position with set_user_scope (the positions ladder, run AS THE
// INVITER). If that grant is refused — a branch-only manager reaching above their
// branch, a target outside their scope — the older code kept the freshly-created
// account and reported a soft "positionError". The result was a user who exists
// but holds NO position: the silent, wrong-permissions state the ladder exists to
// prevent, and one an admin would then have to notice and repair by hand.
//
// THE RULE. A refused grant fails the whole invite. When THIS call created the
// account (createdNewUser), the creation is undone — delete the auth user, and
// public.users cascades on delete — so no unscoped account is left behind. A
// re-invite (an account that already existed) created nothing here, so nothing is
// deleted; the refusal is still returned so the operation as a whole fails.
//
// The effects are injected rather than a Supabase client imported, so the
// ordering this guards — grant first, roll back only a new account, before any
// email or audit — is unit-testable without a live database. Returns null on a
// successful grant, or the refusal message.
export async function placeOrRollback(
  grant: () => PromiseLike<{ error: { message: string } | null }>,
  deleteCreatedUser: () => PromiseLike<unknown>,
  createdNewUser: boolean,
): Promise<string | null> {
  const { error } = await grant();
  if (!error) return null;
  if (createdNewUser) await deleteCreatedUser();
  return error.message;
}
