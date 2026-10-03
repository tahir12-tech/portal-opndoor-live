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
import { personAsk, levelChangeAsk, deleteAsk } from './personConfirm';

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
    expect(read('src/pages/PartnerManagement/SupplierRoleDialog.tsx')).toContain("levelChangeAsk(user.name, was?.level ?? user.current, chosen.level, 'role')");
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

  /* AND A RESEND, which is not in Matt's list: it sends the same invitation
     again and changes nothing about the person. Named here so the decision is
     visible rather than looking like a miss. */
  it('and Resend invite, which changes nothing about the person', () => {
    expect(read('src/pages/Agencies/AgencyHome.tsx')).toContain("if (what === 'resend') { await go(); return; }");
    expect(read('src/pages/PartnerManagement/PartnerHome.tsx')).toContain("if (what === 'resend') { void runPerson(what, userId, who); return; }");
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
