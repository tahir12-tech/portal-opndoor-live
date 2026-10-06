/* THE OFFICE COLUMN MEANT TWO DIFFERENT THINGS ON TWO SCREENS.
 *
 * Matt, 2026-10-02, verbatim: "Office column on every people screen: show
 * the branch name for someone positioned at a branch, and "Whole agency"
 * for someone positioned at the agency (or "Whole group" at a group
 * level). Same wording on the agency Team page and the admin views."
 *
 * WHAT IT WAS. Three screens filled this column and two of them used
 * `describePosition`, which answered two questions at once:
 *
 *   Team, /users        "Agency: Regent's Lettings", "Branch: Camden",
 *                       and -- for anybody holding no position --
 *                       "Everything", "Own referrals", DEVELOPER_SEES
 *   admin agency People the BRANCH name, and a bare "-" for anybody not
 *                       positioned at a branch
 *
 * So a Director reading their own Team saw "Agency: Regent's Lettings"
 * under a header that meant the branch name on the admin view of the same
 * people, and Northgate's agency-level manager read "-" beside colleagues
 * showing an office. One header, three meanings, counting the Sees
 * answers that had nowhere else to live until this morning.
 *
 * WHY THE TEST READS THE CALL SITES. The column is decided by what each
 * screen hands the table, so "same wording on every screen" is a claim
 * about the hand-off and cannot be proved by rendering one of them.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanup, render } from '@testing-library/react';
import { PeopleTable, type PeopleTableRow } from './PeopleTable';
import { officeLabel, officeOf } from '@/data/positionsService';
import type { Position } from '@/data/positionsService';

afterEach(cleanup);

const at = (kind: Position['kind'], targetName: string): Position[] =>
  [{ id: 'p1', kind, targetId: 't1', targetName }];

describe('the Office cell', () => {
  it('is the branch name for someone positioned at a branch', () => {
    expect(officeLabel(at('branch', 'Camden'))).toBe('Camden');
    expect(officeOf('branch', 'Camden')).toBe('Camden');
  });

  it('and "Whole agency" for someone positioned at the agency', () => {
    expect(officeLabel(at('agency', "Regent's Lettings"))).toBe('Whole agency');
    expect(officeOf('agency', null)).toBe('Whole agency');
  });

  it('and "Whole group" at a group level', () => {
    expect(officeLabel(at('group', 'Meridian Property Group'))).toBe('Whole group');
    expect(officeOf('group', null)).toBe('Whole group');
  });

  /* THE NAME IS DELIBERATELY DROPPED ABOVE A BRANCH. "Agency: Regent's
     Lettings" named the level because the name alone could not say
     whether it meant the whole agency or an office inside it; Matt's
     wording says it instead, and the agency's name is the page the
     reader is already on -- or, on an estate-wide list, the second line
     under the cell. */
  it('and does not name the agency it is the whole of', () => {
    expect(officeLabel(at('agency', "Regent's Lettings"))).not.toContain("Regent's");
  });

  /* HIGHEST LEVEL WINS, as it always did: a group position covers the
     branch position inside it, so the narrower one adds nothing. */
  it('takes the highest level when somebody holds several', () => {
    expect(officeLabel([...at('branch', 'Camden'), ...at('group', 'Meridian')])).toBe('Whole group');
  });

  it('and counts them when they are at the same level', () => {
    expect(officeLabel([
      { id: '1', kind: 'branch', targetId: 'a', targetName: 'Camden' },
      { id: '2', kind: 'branch', targetId: 'b', targetName: 'Kentish Town' },
    ])).toBe('2 offices');
  });

  /* NO POSITION MEANS NO OFFICE, and NOT the Sees answer that used to
     fill this cell. opndoor's own staff and a supplier's hold none. */
  it('and is empty for somebody who holds no position at all', () => {
    expect(officeLabel([])).toBe('');
  });
});

/* THE THREE SCREENS THAT FILL IT. The supplier People tab is the fourth
   people screen and passes no office at all, which is correct: a
   supplier's staff hold no position, because partner_id IS the company
   boundary on that rail, and the table drops a column no row fills. */
const FILLS_IT = {
  'agency Team': 'src/pages/Team/Team.tsx',
  'opndoor team': 'src/pages/UserManagement/UserManagement.tsx',
};

describe('every screen that fills it', () => {
  for (const [screen, file] of Object.entries(FILLS_IT)) {
    it(`${screen} takes the wording from the shared helper`, () => {
      expect(readFileSync(file, 'utf8')).toContain('positionsService.officeLabel(');
    });
  }

  /* THE ADMIN AGENCY TAB BUILDS ITS ROWS FROM THE BUCKETS rather than from
     Position objects -- one row per place somebody sits -- so it calls the
     single-position form. Same words, same file. */
  it('and the admin agency People tab calls the single-position form', () => {
    expect(readFileSync('src/pages/Agencies/AgencyHome.tsx', 'utf8'))
      .toContain('office: officeOf(r.level, r.branch)');
  });

  /* AND THE OLD WORDING CANNOT COME BACK, because there is nothing left to
     call. describePosition answered the Office question and the Sees
     question in one string; it is deleted rather than left beside
     officeLabel, so nobody has to guess which of the two to change. */
  it('and nothing calls describePosition, because it is gone', () => {
    /* THE NAME SURVIVES IN PROSE and must: positionsService explains what
       the Office column used to say and why it stopped, and a reader who
       finds the old wording in a screenshot needs that paragraph. What
       must not survive is anything that RUNS. */
    expect(readFileSync('src/data/positionsService.ts', 'utf8'))
      .not.toContain('export function describePosition');
    for (const file of [...Object.values(FILLS_IT), 'src/pages/Agencies/AgencyHome.tsx']) {
      expect(readFileSync(file, 'utf8'), file).not.toContain('describePosition(');
    }
  });
});

describe('drawn, on one agency with two offices', () => {
  const rows: PeopleTableRow[] = [
    { id: '1', name: 'Rachel Voss', email: 'rachel@northgate.test', level: 'Director', office: officeOf('agency', '-'), status: 'active' },
    { id: '2', name: 'Ines Barros', email: 'ines@northgate.test', level: 'Director', office: officeOf('branch', 'Highgate'), status: 'active' },
    { id: '3', name: 'Ada Bello', email: 'ada@northgate.test', level: 'Negotiator', office: officeOf('branch', 'Crouch End'), status: 'active' },
  ];

  it('says the office for the two in one and "Whole agency" for the one above them', () => {
    const { getByText, queryByText } = render(<PeopleTable showFilters={false} rows={rows} />);
    getByText('Highgate');
    getByText('Crouch End');
    getByText('Whole agency');
    // The hyphen it used to print for the agency-level row is gone.
    expect(queryByText('-')).toBeNull();
  });
});

/* =====================================================================
   AND WHEN THE COLUMN IS DRAWN AT ALL.

   Matt, 2026-10-02 in the morning: "Show the Office column only when the
   agency has more than one office; for a single-office agency like New
   Independent, leave it out." His reason was that it carried nothing
   there. Hours later the cell learned to say "Whole agency", which makes
   it carry something on a one-office agency with people at two levels --
   Regent's, where three sit at the agency and two at its only branch.

   So the table shows it when the rows DIFFER, which is his reason rather
   than his proxy, and the two instructions hold together: New
   Independent keeps its three columns, Regent's gains an Office column
   that matches its own Team page word for word.
   ===================================================================== */
const person = (id: string, name: string, office: string | null, officeSub?: string | null): PeopleTableRow =>
  ({ id, name, email: `${id}@test`, level: 'Director', office, officeSub, status: 'active' });

const headers = (rows: PeopleTableRow[]) =>
  [...render(<PeopleTable showFilters={false} rows={rows} />)
    .container.querySelectorAll('thead th')].map((t) => t.textContent);

describe('whether the Office column is drawn', () => {
  /* NEW INDEPENDENT: one office, one person, positioned at the agency.
     The cell would say "Whole agency" on the only row, and the page
     header already says which agency. */
  it('is not, when every row says the same thing', () => {
    expect(headers([person('1', 'Independent Director', 'Whole agency')])).not.toContain('Office');
  });

  /* REGENT'S: one office, three at the agency and two at the branch. The
     old "more than one office" test dropped this; it is exactly the case
     the new wording was asked for. */
  it('but is, on a one-office agency whose people sit at two levels', () => {
    expect(headers([
      person('1', 'Rosa Vance', 'Whole agency'),
      person('2', 'Nadia Shaw', 'Whole agency'),
      person('3', 'Tom Reeve', "Regent's Park"),
    ])).toEqual(['Name', 'Level', 'Office', 'Status']);
  });

  /* A TWO-OFFICE AGENCY WHOSE PEOPLE ALL SIT IN ONE OF THEM is the case
     the old test got wrong the other way: it showed a column of one
     repeated name. */
  it('and is not, when two offices exist but only one is staffed', () => {
    expect(headers([person('1', 'Ada Bello', 'Camden'), person('2', 'Tom Reddy', 'Camden')]))
      .not.toContain('Office');
  });

  /* A LIST MIXING opndoor's OWN STAFF WITH POSITIONED PEOPLE keeps it:
     the blank is one of the distinct answers, and it is the true one --
     an opndoor admin holds no office. */
  it('and is, when some hold an office and some hold none', () => {
    const v = render(<PeopleTable showFilters={false} rows={[
      person('1', 'Matthew Dwyer', ''),
      person('2', 'Rosa Vance', 'Whole agency'),
    ]} />);
    expect([...v.container.querySelectorAll('thead th')].map((t) => t.textContent)).toContain('Office');
    expect(v.container.textContent).toContain('-');
  });

  /* ON A GROUP PAGE every row can read "Whole agency" and differ only in
     the line underneath, so the test is the PAIR and not the cell. */
  it('and is, when the cells match but the agencies under them do not', () => {
    expect(headers([
      person('1', 'Rachel Voss', 'Whole agency', 'Northgate Lettings'),
      person('2', 'Nina Petrova', 'Whole agency', 'Southbank Residential'),
    ])).toContain('Office');
  });
});
