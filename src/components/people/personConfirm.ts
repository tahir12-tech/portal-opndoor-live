/* =====================================================================
   EVERY PERSON ACTION ASKS FIRST, IN THE SAME WORDS EVERYWHERE.

   Matt, 2026-10-03, verbatim: "People tables (every level: admin, agency,
   supplier, opndoor team): Every action that changes something asks first, in
   plain words: 'Remove access for Joe Joe? They can't sign in from now on.
   Their referrals stay as they are.' Same for Reset two-factor, Send password
   reset, Cancel invite and Change level (show old and new level).
   Notifications can open straight away."

   NONE OF THEM ASKED. `doPersonAction` on the agency page and `runPerson` on
   the supplier page both ran the moment the link was clicked -- so "Remove
   access", one word away from "Reset two-factor" in a row of six quiet links,
   signed somebody out and banned their account with no step in between. The
   shared PersonActions component was written in part because "the two that
   already exist disagree about whether a destructive action is confirmed";
   what it shared was the buttons, not the asking.

   THE WORDS LIVE HERE, NOT AT THE FOUR CALL SITES, for the same reason the
   buttons do. Each of the four People surfaces runs the action itself -- they
   have different RPCs and different refresh paths -- so what can be shared is
   the question, and a question copied four times is four questions.

   WHAT EACH ONE SAYS IS THE CONSEQUENCE, NOT THE MECHANISM. Matt's own
   sentence is the pattern: what stops working, and what does not change.
   "Their referrals stay as they are" is the half somebody needs before they
   press it, and it is the half a dialog written from the code would leave out.

   WHAT DOES NOT ASK, and why:
     Notifications    Matt: "can open straight away". It opens a panel; the
                      panel has its own save.
     Resend invite    Matt, 2026-10-03, when I asked: "Resend invite: no
                      question needed, but show 'Invite sent again to
                      [email]'." It sends the same invitation again and
                      changes nothing about the person, so there is nothing
                      to warn about -- but it is worth REPORTING, and the
                      thing to report is the address it went to. `resentLine`
                      below is that sentence.
   ===================================================================== */

/** The actions that ask, which is every one that changes something. */
export type AskedAction = 'remove' | 'restore' | 'password' | 'mfa' | 'cancelInvite';

export interface PersonAsk {
  title: string;
  body: string;
  confirmLabel: string;
  /** Red button: hard to undo, or it signs somebody out. */
  danger?: boolean;
}

/**
 * The question to ask before doing `what` to `who`.
 *
 * `who` is already the display name the row shows, falling back to the email,
 * so this never has to decide what somebody is called.
 */
export function personAsk(what: AskedAction, who: string): PersonAsk {
  switch (what) {
    case 'remove':
      return {
        title: `Remove access for ${who}?`,
        body: `They can’t sign in from now on. Their referrals stay as they are.`,
        confirmLabel: 'Remove access',
        danger: true,
      };
    /* RESTORE IS NOT IN MATT'S LIST AND IS ASKED ANYWAY: it is the exact
       inverse of an action that is, it hands somebody their sign-in back,
       and an action pair where one half asks and the other does not reads
       as though only one of them matters. Not red -- it gives access back. */
    case 'restore':
      return {
        title: `Restore access for ${who}?`,
        body: `They can sign in again from now on, at the level they held before.`,
        confirmLabel: 'Restore access',
      };
    case 'password':
      return {
        title: `Send a password reset to ${who}?`,
        body: `They get an email with a link to set a new password. Their current password keeps working until they use it.`,
        confirmLabel: 'Send reset',
      };
    case 'mfa':
      return {
        title: `Reset two-factor for ${who}?`,
        body: `Their authenticator app stops working and they set up a new one the next time they sign in. They can’t sign in until they do.`,
        confirmLabel: 'Reset two-factor',
        danger: true,
      };
    case 'cancelInvite':
      return {
        title: `Cancel the invitation for ${who}?`,
        body: `The link in their email stops working and they disappear from People. You can invite them again at any time.`,
        confirmLabel: 'Cancel invitation',
        danger: true,
      };
  }
}

/**
 * The question before a level change, which is the one that has to name two
 * things. Matt: "Change level (show old and new level)."
 *
 * THE LABELS, NOT THE STORED VALUES. A dialog saying "change from management
 * to management" is what you get from the role column; Director and Manager
 * are both `management` and differ only in `sees_commission`, so the caller
 * passes the words its own picker showed.
 */
export function levelChangeAsk(who: string, from: string, to: string, levelWord = 'level'): PersonAsk {
  return {
    title: `Change ${who} from ${from} to ${to}?`,
    body: `It takes effect the next time they load the portal. What they can see and do changes with it; their referrals stay as they are.`,
    confirmLabel: `Change ${levelWord}`,
  };
}

/**
 * The question before a person is taken off the People lists for good.
 *
 * Matt: "After access is removed, offer 'Delete': 'Delete Joe Joe? They
 * disappear from People. Their name stays on referrals and activity they're
 * part of.'"
 *
 * HIS SECOND SENTENCE IS THE WHOLE DESIGN and it is why nothing cascades:
 * `applications.referrer_name` has been snapshotted since #97 and the
 * activity log stores its actor as text, so a deleted person's name survives
 * in both without this having to copy anything anywhere.
 */
export function deleteAsk(who: string): PersonAsk {
  return {
    title: `Delete ${who}?`,
    body: `They disappear from People. Their name stays on referrals and activity they’re part of.`,
    confirmLabel: 'Delete',
    danger: true,
  };
}

/**
 * The line to show after an invitation is sent again.
 *
 * Matt, 2026-10-03, verbatim: "Resend invite: no question needed, but show
 * 'Invite sent again to [email]'."
 *
 * THE EMAIL, NOT THE NAME, which is the whole of the instruction. Two of the
 * four surfaces said "Invitation resent to Joe Joe", which tells an
 * administrator that something was sent and not where -- and where is the one
 * thing they are checking when they press Resend, because the usual reason to
 * press it is that the first one did not arrive.
 */
export function resentLine(email: string): string {
  return `Invite sent again to ${email}.`;
}

/* =====================================================================
   WHY A PEER'S ROW HAS NO ACTIONS ON IT.

   Matt, 2026-10-03, about the agency Team page: "on other Directors' rows,
   show a small note instead of the missing actions: 'To change or remove a
   Director, contact your account manager at partners@opndoor.co.'"

   AND THE SAME SENTENCE ANSWERS THE SUPPLIER COMPLAINT, which is why this is
   one function and not two. Matt, the same day: "the '...' menu on each row
   opens an empty box, so no actions are possible." Those are the same rule
   seen from two rails:

     the LADDER refuses a peer. `assert_may_act_on_user` ends with
     `v_caller >= v_target` and raises, and `mayActOn` is the client twin of
     it. Two Directors are level 1 and level 1; so are two of a supplier's
     Management, which since 20261007880000 is the top of that rail.

   SO THE MENU WAS HONEST AND SAID NOTHING, which is the worst of both: the
   reader cannot act and cannot find out why, and an empty box reads as a bug
   rather than as a rule. It IS a rule, and it has a remedy -- ask Opndoor --
   so the row says both.

   NOT "Nothing you can change here", which the deactivated arm says and which
   is right there: that row is somebody whose access is already gone and whom
   this reader may not restore. This row is a colleague at your own level, and
   the thing to do about it is a different thing.

   THE ARTICLE IS PER LEVEL because "Management" is not a countable person.
   "To change or remove a Management" is not English; "a Director" is.
   ===================================================================== */
const PEER_PHRASE: Record<string, string> = {
  Management: 'someone at Management level',
};

/* AND IT IS A DIFFERENT SENTENCE WHEN THE READER IS BELOW, NOT LEVEL.
 *
 * Matt, 2026-10-04 (au): 'on Director rows say "Only a Director or opndoor
 * can change a Director." (A Director's own view keeps "contact your account
 * manager".)'
 *
 * THE ROW LOOKS IDENTICAL AND THE SITUATION IS NOT. Both readers see a
 * Director's row with no actions on it, and `mayActOn` refuses both, so one
 * sentence covered both. But a Director looking at a peer has exhausted
 * their own estate -- the only way up is us, and "contact your account
 * manager" is the whole answer. A MANAGER has not: there is somebody in
 * their own building who can do this, and sending them to opndoor sends them
 * past the person who would have said yes in a minute.
 *
 * WHICH IS WHY THE ARGUMENT IS "could a colleague do this", not the reader's
 * level: that is the fact that decides the sentence, and asking for it by
 * name stops a caller passing a role and this function re-deriving a ladder
 * it should not know about.
 */
/** The note that stands in for the actions a peer's row cannot offer.
 *
 *  `aLevelExistsAbove` -- is there a rung above the READER that could do
 *  this? False for a Director or a supplier's Management, who are the top of
 *  their own estate; true for a Manager looking at a Director. */
export function peerActionNote(level: string, aLevelExistsAbove = false): string {
  const who = PEER_PHRASE[level] ?? `a ${level}`;
  /* MATT'S SHAPE EXACTLY: "Only a Director or opndoor can change a
     Director." Both halves are the same phrase because the rule is that it
     takes one of their own level, and naming it twice is what makes that
     readable without a second sentence. In practice `level` here is always
     Director: a supplier's Management is the top of its rail, so nothing
     sits above a reader looking at one and this arm never fires for them. */
  if (aLevelExistsAbove) return `Only ${who} or opndoor can change ${who}.`;
  return `To change or remove ${who}, contact your account manager at partners@opndoor.co.`;
}
