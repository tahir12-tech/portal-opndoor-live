/* WHICH POSITION AN INVITE GRANTS, AND WHETHER IT HAS TO.
 *
 * Everybody on our estate holds a position: 20261006300000 makes an
 * unpositioned active person a constraint violation, because "no position"
 * was the state that made `not app_has_scope() or ...` hand somebody every
 * agency on the house route. invite-user therefore refuses to create anybody
 * on the estate without one.
 *
 * That rule was applied to RE-INVITES too, and a re-invite grants no position:
 * the person already holds one. `resendInvite` sends only a name, an email and
 * a role, so `scopeKind` was empty, the requirement fired, and "Resend invite"
 * answered "Choose the group, brand or branch this person will hold" for every
 * user on the estate. A rule about creating people was enforced on a path that
 * creates nobody.
 *
 * The decision lives here rather than inline so it can be tested. The edge
 * functions are Deno and `npm test` cannot collect them (see vitest.config.ts),
 * but this file imports nothing, so a vitest test in src/ can import it
 * directly and assert the real logic instead of grepping the source for it.
 */

export type PositionAsk = {
  /** The invitee's partner is one of ours, so the position rule applies. */
  inviteeOnOurEstate: boolean;
  /** The level the dialog asked for, if it asked for one. */
  scopeKind: string | null;
  scopeTarget: string | null;
  /** 'referrer' | 'management' | 'developer' | ... */
  role: string;
  /** Set for a negotiator placed at a branch the caller reaches. */
  homeBranchId: string | null;
  /** This email already has a portal user AND that user already holds a
   *  position. Only then is the requirement already satisfied. */
  alreadyPositioned: boolean;
};

export type PositionOutcome =
  | { ok: true; scopeKind: string | null; scopeTarget: string | null }
  | { ok: false; error: string };

export const NEEDS_A_POSITION =
  'Choose the group, brand or branch this person will hold. Everybody on our estate holds a position.';

export function resolveInvitePosition(ask: PositionAsk): PositionOutcome {
  let scopeKind = ask.scopeKind || null;
  let scopeTarget = ask.scopeTarget || null;

  /* `alreadyPositioned` and not `already exists`. Somebody created before
     20261006300000 can exist and hold nothing, which is exactly the state the
     constraint outlaws, so re-inviting them must still ask. The question is
     whether the requirement is already SATISFIED, not whether this is a
     create. */
  if (ask.inviteeOnOurEstate && !scopeKind && !ask.alreadyPositioned) {
    if (ask.role === 'referrer' && ask.homeBranchId) {
      /* A negotiator invited with a branch is positioned at that branch. Their
         home branch used to be what located them and is no longer allowed to
         be, so it becomes a real position here rather than at the database. */
      scopeKind = 'branch';
      scopeTarget = ask.homeBranchId;
    } else {
      return { ok: false, error: NEEDS_A_POSITION };
    }
  }

  return { ok: true, scopeKind, scopeTarget };
}
