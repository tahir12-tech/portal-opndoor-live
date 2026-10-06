/* TWO AUDIENCE RULES THAT WERE WRITTEN AS SHAPE RULES.
 *
 * (tt) Matt: 'Applications for supplier and agency users: hide the "Origin"
 * filter and column (it's Opndoor's own view).'
 * (at) Matt: 'Supplier Developer level: hide League and Reporting (they're
 * for referral performance and show nothing useful to a developer); keep
 * Applications and Dev Centre.'
 *
 * THE FIRST WAS THE INTERESTING ONE. Origin was gated on
 * `showPartner || showRoute` -- opndoor staff, OR anybody whose own book
 * spans more than one rail. That reads like an audience test and is a shape
 * test: it happened to hide the column from an agency with one route, and
 * happened to SHOW it to a supplier whose agencies sit on more than one,
 * which is exactly the reader Matt named. The answer never depended on the
 * shape of somebody's book.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NAV } from '@/constants/nav';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('Origin is opndoor\'s own view', () => {
  const page = read('src/pages/Applications/Applications.tsx');

  it('is gated on being opndoor, not on the shape of a book', () => {
    expect(page).toContain('const showOrigin = isOpsStaff;');
  });

  /* THE SHAPE FLAGS ARE GONE, which is the half that stops this coming
     back: `showRoute` existed only to feed that expression, and a flag left
     lying about is a flag somebody re-uses. */
  it('and the flags that used to decide it are gone', () => {
    expect(page).not.toContain('const showRoute =');
    expect(page).not.toContain('const showPartner =');
  });
});

describe('a Developer has no referral performance', () => {
  const item = (id: string) => NAV.flatMap((g) => g.items).find((i) => i.id === id)!;

  it('so Reporting and League are not offered to them', () => {
    for (const id of ['dashboard', 'league']) {
      expect(item(id).roles, `${id} still offers itself to a developer`).not.toContain('developer');
    }
  });

  /* KEPT, AND NAMED, because the risk in a change like this is taking one
     rung too many: a developer is the person debugging what the API
     produced, so the book itself stays. */
  it('but Applications and the Dev Centre stay', () => {
    expect(item('applications').roles).toContain('developer');
    expect(item('devcentre').roles).toContain('developer');
  });

  /* THE ROUTE, NOT ONLY THE TAB. Taking them out of the sidebar leaves two
     addresses a developer can still type, and both pages would then show
     them somebody else's figures counted as their own. */
  it('and the routes refuse them too, not just the sidebar', () => {
    const app = read('src/App.tsx');
    const i = app.indexOf('<Route path="/dashboard"');
    const guard = app.slice(app.lastIndexOf('<Route element={<RequireRole', i), i);
    expect(guard).not.toContain('developer');
    expect(guard).toContain('redirectTo="/applications"');
  });
});
