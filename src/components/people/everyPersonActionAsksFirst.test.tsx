/* "REMOVE ACCESS" WAS ONE CLICK, ONE WORD AWAY FROM "RESET TWO-FACTOR".
 *
 * Matt, 2026-10-03, verbatim: "People tables (every level: admin, agency,
 * supplier, opndoor team): Every action that changes something asks first, in
 * plain words: 'Remove access for Joe Joe? They can't sign in from now on.
 * Their referrals stay as they are.' Same for Reset two-factor, Send password
 * reset, Cancel invite and Change level (show old and new level).
 * Notifications can open straight away."
 *
 * MEASURED ACROSS THE FOUR SURFACES BEFORE CHANGING ANYTHING:
 *
 *   agency page      nothing asked. All five ran on the click.
 *   supplier page    nothing asked. All six ran on the click.
 *   Team             asked for cancel, password, two-factor and remove.
 *                    Restore ran on the click.
 *   Users (admin)    asked for cancel, two-factor, deactivate, reactivate.
 *                    Password reset ran on the click.
 *
 * So two surfaces asked nothing at all, and the two that did asked in four
 * different sets of words -- "Deactivate Jane?", "Remove Jane's access?" --
 * for the identical RPC. PersonActions was extracted precisely because "the
 * two that already exist disagree about whether a destructive action is
 * confirmed"; what it shared was the buttons.
 *
 * THE WORDS NOW LIVE IN personConfirm, one question per action, and the four
 * surfaces read them from there. They cannot be shared any further than that:
 * each page has its own RPC, its own busy flag and its own refresh, so the
 * question is the shareable part and a question copied four times is four
 * questions.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { personAsk, levelChangeAsk, deleteAsk, resentLine } from './personConfirm';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const SURFACES: [string, string][] = [
  ['the agency page', 'src/pages/Agencies/AgencyHome.tsx'],
  ['the supplier page', 'src/pages/PartnerManagement/PartnerHome.tsx'],
  ['Team', 'src/pages/Team/Team.tsx'],
  ['Users', 'src/pages/UserManagement/UserManagement.tsx'],
];

describe('the question each action asks', () => {
  /* MATT'S OWN SENTENCE, word for word, because it is the one he wrote out
     and the pattern the other four follow: what stops working, and what does
     not change. */
  it('is Matt’s, for Remove access', () => {
    const q = personAsk('remove', 'Joe Joe');
    expect(q.title).toBe('Remove access for Joe Joe?');
    expect(q.body).toBe('They can’t sign in from now on. Their referrals stay as they are.');
    expect(q.confirmLabel).toBe('Remove access');
    expect(q.danger).toBe(true);
  });

  it.each(['restore', 'password', 'mfa', 'cancelInvite'] as const)('and names the person for %s', (what) => {
    const q = personAsk(what, 'Joe Joe');
    expect(q.title).toContain('Joe Joe');
    expect(q.title.endsWith('?'), `${what} asks a question`).toBe(true);
    expect(q.body.length, `${what} says the consequence`).toBeGreaterThan(20);
    // Never "OK" or "Confirm": the button says the action.
    expect(q.confirmLabel).not.toMatch(/^(OK|Confirm|Yes)$/);
  });

  /* THE TWO THAT TAKE SOMETHING AWAY ARE RED; the two that give something
     back are not. */
  it('and goes red only where something stops working', () => {
    expect(personAsk('remove', 'X').danger).toBe(true);
    expect(personAsk('mfa', 'X').danger).toBe(true);
    expect(personAsk('cancelInvite', 'X').danger).toBe(true);
    expect(personAsk('restore', 'X').danger).toBeUndefined();
    expect(personAsk('password', 'X').danger).toBeUndefined();
  });
});

describe('a level change', () => {
  /* OLD AND NEW. On this ladder the level somebody is LEAVING is the thing
     an administrator is most likely to have mis-remembered: a Director and a
     Manager are both `management` and differ in one flag. */
  it('names both levels', () => {
    expect(levelChangeAsk('Joe Joe', 'Manager', 'Director').title)
      .toBe('Change Joe Joe from Manager to Director?');
  });

  it('and says "role" on the rail that has roles', () => {
    expect(levelChangeAsk('Joe Joe', 'Referrer', 'Management', 'role').confirmLabel).toBe('Change role');
    expect(levelChangeAsk('Joe Joe', 'Manager', 'Director').confirmLabel).toBe('Change level');
  });

  it('and all four surfaces ask it from here', () => {
    expect(read('src/components/people/ChangeLevelModal.tsx')).toContain('levelChangeAsk(person.name, person.current, pick)');
    expect(read('src/pages/Team/Team.tsx')).toContain('levelChangeAsk(levelUser.name, levelLabel(levelUser), levelPick)');
    /* (cd) THE SUPPLIER DIALOG NOW PASSES 'level'. It said 'role',
       from decision D11; Matt reversed that on 2026-10-05 -- "Change
       level, not Change role, matching every other people list" --
       and the dialog had to follow the row button or the tab
       contradicted itself one click in. The helper's 'role' arm is
       still exercised by the Users page below, and by the unit test
       above, so the capability has not gone untested with it. */
    expect(read('src/pages/PartnerManagement/SupplierRoleDialog.tsx')).toContain("levelChangeAsk(user.name, was?.level ?? user.current, chosen.level, 'level')");
    expect(read('src/pages/UserManagement/UserManagement.tsx')).toContain("levelChangeAsk(u.name, from, to, 'role')");
  });
});

describe('every surface asks from the one place', () => {
  it.each(SURFACES)('%s reads personAsk', (_where, path) => {
    expect(read(path)).toContain("from '@/components/people/personConfirm'");
    expect(read(path)).toContain('personAsk(');
  });

  /* NO SURFACE STILL RUNS A STATUS CHANGE STRAIGHT OFF A CLICK. The two that
     did are the two this is about, and the assertion is on the call shape
     rather than on a render, because what was wrong is which function the
     click reached. */
  it('and none of them runs setUserStatus straight off a click', () => {
    for (const [where, path] of SURFACES) {
      const code = read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, where).not.toMatch(/onClick=\{\(\) => void run\(\(\) => setUserStatus/);
      expect(code, where).not.toMatch(/onAction=\{\(what, userId, who\) => void runPerson/);
    }
  });
});

describe('what does not ask', () => {
  /* MATT'S OWN EXCEPTION: "Notifications can open straight away." It opens a
     panel, and the panel has its own save. */
  it('Notifications, which opens a panel', () => {
    const actions = read('src/components/people/PersonActions.tsx');
    expect(actions).toContain('onClick={() => onNotifications!({ id: r.userId, name: who })}');
  });

  /* AND A RESEND. Matt, 2026-10-03, when I raised it: "Resend invite: no
     question needed, but show 'Invite sent again to [email]'." It sends the
     same invitation again and changes nothing about the person, so there is
     nothing to warn about -- but it is worth reporting. */
  it('and Resend invite, which changes nothing about the person', () => {
    expect(read('src/pages/Agencies/AgencyHome.tsx')).toContain("if (what === 'resend') { await go(); return; }");
    expect(read('src/pages/PartnerManagement/PartnerHome.tsx')).toContain("if (what === 'resend') { void runPerson(what, userId, email); return; }");
  });
});

/* WHAT A RESEND REPORTS INSTEAD.
 *
 * Matt, 2026-10-03, verbatim: "Resend invite: no question needed, but show
 * 'Invite sent again to [email]'."
 *
 * THE EMAIL, NOT THE NAME, which is the whole of it. Two of the four surfaces
 * said "Invitation resent to Joe Joe": that reports that something was sent
 * and not WHERE, and where is the one thing an administrator is checking,
 * because the usual reason to press Resend is that the first one did not
 * arrive.
 */
describe('the resend report', () => {
  it('is Matt’s sentence, naming the address', () => {
    expect(resentLine('joe@example.co.uk')).toBe('Invite sent again to joe@example.co.uk.');
  });

  it.each(SURFACES)('%s reports it from there', (_where, path) => {
    expect(read(path)).toContain('resentLine(');
  });

  it('and nowhere still says "Invitation resent"', () => {
    for (const [where, path] of SURFACES) {
      const code = read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, where).not.toContain('Invitation resent');
    }
  });

  /* THE EMAIL HAS TO REACH THE HOST, which is why PersonActions' callback
     gained a fourth argument rather than `who` changing meaning for one
     action: every question this row asks is about a PERSON and wants the
     name, and only this one report is about an address. */
  it('because the row hands over both the name and the address', () => {
    const actions = read('src/components/people/PersonActions.tsx');
    expect(actions).toContain('onAction: (what: PersonAction, userId: string, who: string, email: string) => void;');
    expect(actions).toContain("onAction('resend', r.userId, who, r.email)");
  });
});

/* THE DELETE WORDS EXIST, ready for part 2 of the instruction. */
describe('the Delete question', () => {
  it('is Matt’s sentence, including what survives', () => {
    const q = deleteAsk('Joe Joe');
    expect(q.title).toBe('Delete Joe Joe?');
    expect(q.body).toBe('They disappear from People. Their name stays on referrals and activity they’re part of.');
    expect(q.danger).toBe(true);
  });
});
