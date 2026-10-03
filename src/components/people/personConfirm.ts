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
