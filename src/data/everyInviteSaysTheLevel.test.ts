/* EVERY INVITE SAYS THE LEVEL, NOT JUST THE ROLE.
 *
 * Director and Manager are the SAME role and differ only by
 * users.sees_commission. So a screen that sends `role: 'management'` and
 * nothing else has not said which of the two it means, and the invitee lands
 * as a Manager whatever the dialog promised.
 *
 * That has now been the same defect on three different screens:
 *
 *   InviteToLevel   "Invite group director" created a Manager -- it said the
 *                   level out loud and then did not set it. Fixed in 054fbd9,
 *                   and round 5 reported it again as M11: a brand new agency
 *                   ends up with nobody who may see commission, and therefore
 *                   nobody who can promote anyone to it either.
 *   Team            fixed when the Team dialog was rebuilt on AGENCY_LEVELS.
 *   UserManagement  round 5, M10: no seesCommission at all, so this screen
 *                   could never create a Director.
 *
 * Three instances of one shape is not three mistakes, it is a missing rule.
 * The rule: every call to inviteUser passes BOTH, and the pair comes out of
 * AGENCY_LEVELS rather than being written by hand, so no screen can invent a
 * fourth combination of role and commission bit.
 *
 * A source check rather than a behavioural one on purpose. The behaviour of
 * each screen is asserted where that screen lives
 * (inviteOntoTheEstate.render.test.tsx and the Team suites); what cannot be
 * asserted there is the one thing that keeps going wrong, which is a NEW
 * caller written later that forgets. That is a property of the call sites as
 * a set, and this is where the set is visible.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e) ? [p] : [];
  });
}

const FILES = walk(SRC);

/** The argument object of each `inviteUser({ ... })` call, by file. */
function inviteCalls(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/\binviteUser\s*\(\s*\{/g)) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i;
    for (; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') { depth -= 1; if (depth === 0) break; }
    }
    out.push(src.slice(start, i + 1));
  }
  return out;
}

const callers = FILES
  .map((f) => ({ file: f.slice(SRC.length + 1), calls: inviteCalls(readFileSync(f, 'utf8')) }))
  .filter((c) => c.calls.length > 0);

describe('inviteUser call sites', () => {
  it('were found, so a broken walk cannot pass silently', () => {
    // Users, Team and the agency People tab. A fourth is fine; zero is a bug
    // in this test rather than a clean codebase.
    expect(callers.length).toBeGreaterThanOrEqual(3);
  });

  it('all say the commission bit as well as the role', () => {
    const silent = callers.flatMap((c) => c.calls
      .filter((call) => /\brole\s*:/.test(call) && !/\bseesCommission\s*:/.test(call))
      .map(() => c.file));
    expect(silent).toEqual([]);
  });

  /* AND THE PAIR COMES FROM A LIST, NOT FROM THE CALL SITE.
     `seesCommission: true` written by hand next to `role: 'management'` is
     correct today and is exactly how the fourth combination gets invented.
     Each call site resolves an entry (`chosen`/`spec`) and reads the pair
     off it.

     TWO LISTS, ONE PER RAIL, since 2026-10-01: AGENCY_LEVELS for our own
     estate, where a level is a role plus a position and `sees_commission`
     is what tells a Director from a Manager; SUPPLIER_LEVELS for the
     supplier rail, which has no positions and where the levels are the
     roles themselves. The rule is the same for both and this test does not
     care which list a call site used -- only that it used one. */
  it('take the pair from a levels list rather than writing it out', () => {
    const handwritten = callers.flatMap((c) => c.calls
      .filter((call) => /\bseesCommission\s*:\s*(true|false)\b/.test(call))
      .map(() => c.file));
    expect(handwritten).toEqual([]);
  });
});
