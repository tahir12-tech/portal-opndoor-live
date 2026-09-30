/* =====================================================================
   THE ROW ACTIONS ON A PERSON, ONCE, FOR EITHER RAIL.

   Lifted out of AgencyHome because Q-06 item A gives the supplier People tab
   "their staff with the same row actions". Its own comment already said why
   it existed: copies of an action set do not stay equal, and the two that
   were already in the product disagreed about whether a destructive action
   is confirmed.

   ONE PROP ADDED IN THE MOVE. `changeLevelLabel`, because the agency rail has
   three LEVELS and the supplier rail has roles (decision D11), so the button
   there says Change role. The label is the only thing that differs; what the
   button opens is the host page's business.
   ===================================================================== */
export type PersonAction = 'remove' | 'restore' | 'resend' | 'password' | 'mfa';

interface PersonActionsProps {
  person: { userId: string; name: string; email: string; status: string; agencyLevel: string };
  isAdmin: boolean;
  /** Position is only a choice where there is more than one office to choose. */
  manyOffices: boolean;
  onAction: (what: PersonAction, userId: string, who: string) => void;
  onCancelInvite: (userId: string, who: string) => void;
  onChangeLevel: (p: { userId: string; name: string; current: string }) => void;
  onPosition: (p: { id: string; name: string }) => void;
  /** Walk fixes 10 and 12: notifications move onto the person, reached from
   *  their row like permissions. Optional so a screen that has not been
   *  wired yet simply does not draw it, rather than drawing a dead control. */
  onNotifications?: (p: { id: string; name: string }) => void;
  /** May THIS viewer open THIS person's notifications. The one action here
   *  that is not Opndoor's alone, so it is the one that needs a per-row
   *  answer. Hosts pass `mayActOnOrEqual(me, them)`, the client twin of the
   *  server's `caller_may_set_for`. Defaults to true because every other
   *  caller is already behind `isAdmin`, for whom it is always true. */
  mayNotify?: boolean;
  /** 'Change level' on the agency estate; 'Change role' on the supplier
      rail, which has no levels. */
  changeLevelLabel?: string;
}

/**
 * THE ROW ACTIONS, ONCE.
 *
 * These were written out inline in the People table, and a branch view needing
 * "the same row actions as People" would have made a second copy on this page
 * and a fourth in the product, since Team and Users each hold their own.
 * Copies of an action set do not stay equal: the two that already exist
 * disagree about whether a destructive action is confirmed and about which
 * levels may be granted.
 *
 * MODULE SCOPE, EXPLICIT PROPS, NO HOOK. The five render helpers inside
 * AgencyHome must be CALLED rather than mounted (see the comment on RateLine);
 * this is a real component with a stable identity, so it mounts normally and
 * that trap does not apply to it.
 */
export function PersonActions({
  person: r, isAdmin, manyOffices, onAction, onCancelInvite, onChangeLevel, onPosition,
  onNotifications, mayNotify = true,
  changeLevelLabel = 'Change level',
}: PersonActionsProps) {
  const who = r.name || r.email;
  const notifies = !!onNotifications && mayNotify && r.status !== 'pending';

  /* EVERYTHING ELSE HERE IS SOMETHING OPNDOOR DOES TO SOMEBODY -- resend,
     change level, position, password, two-factor, remove, restore -- so the
     admin-only return below is right for all of it. Notifications is not one
     of those: a Director may change their own people's, and everybody may
     change their own event choices, so it has to survive the return or the
     capability has no door in the product. */
  if (!isAdmin) {
    if (!notifies) return null;
    return (
      <div className="ah-rowacts">
        <button className="ah-linkbtn ah-linkbtn--quiet" onClick={() => onNotifications!({ id: r.userId, name: who })}>Notifications</button>
      </div>
    );
  }

  return (
    <div className="ah-rowacts">
      {r.status === 'pending' && <>
        <button className="ah-linkbtn ah-linkbtn--quiet" onClick={() => onAction('resend', r.userId, who)}>Resend invite</button>
        <button className="ah-linkbtn ah-linkbtn--quiet" onClick={() => onCancelInvite(r.userId, who)}>Cancel invite</button>
      </>}
      {r.status === 'active' && (
        <button className="ah-linkbtn ah-linkbtn--quiet" onClick={() => onChangeLevel({ userId: r.userId, name: who, current: r.agencyLevel })}>{changeLevelLabel}</button>
      )}
      {/* Position only where there is somewhere to choose between, the same
          test Team applies: on a one-office agency every node describes the
          same people. */}
      {manyOffices && r.status !== 'pending' && (
        <button className="ah-linkbtn ah-linkbtn--quiet" onClick={() => onPosition({ id: r.userId, name: who })}>Position</button>
      )}
      {/* Beside Position on purpose: both answer "what is this person's
          relationship to the work", and Matt's instruction is that
          notifications belong here "like permissions". */}
      {notifies && (
        <button className="ah-linkbtn ah-linkbtn--quiet" onClick={() => onNotifications!({ id: r.userId, name: who })}>Notifications</button>
      )}
      {r.status !== 'pending' && <>
        <button className="ah-linkbtn ah-linkbtn--quiet" onClick={() => onAction('password', r.userId, who)}>Send password reset</button>
        <button className="ah-linkbtn ah-linkbtn--quiet" onClick={() => onAction('mfa', r.userId, who)}>Reset two-factor</button>
      </>}
      {r.status === 'active' && (
        <button className="ah-linkbtn ah-linkbtn--quiet" onClick={() => onAction('remove', r.userId, who)}>Remove access</button>
      )}
      {r.status === 'deactivated' && (
        <button className="ah-linkbtn ah-linkbtn--quiet" onClick={() => onAction('restore', r.userId, who)}>Restore access</button>
      )}
    </div>
  );
}

