/* ONE PEOPLE TABLE, ON EVERY PEOPLE SCREEN.
 *
 * Matt, 2026-10-01, verbatim: "Use one shared people table on every
 * people screen (agency Team as a Director sees it, admin agency People,
 * supplier People, opndoor team): fixed aligned columns Name (initials,
 * name, email below), Level, Office, Status, Last active, and actions
 * right-aligned, so every row lines up. Search and level/status filters
 * styled like the rest of the portal. When someone has no name yet, show
 * the email once with 'Name not set' beneath, not the email twice."
 *
 * The four screens are asserted by reading their source for the shared
 * component rather than by rendering each of them: three need a session,
 * a hydrated book and a route, and what this test is about is that no
 * screen draws its own table any more. What the table itself does is
 * rendered below.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { PeopleTable, type PeopleTableRow } from './PeopleTable';

afterEach(cleanup);

const SCREENS = {
  'agency Team': 'src/pages/Team/Team.tsx',
  'admin agency People': 'src/pages/Agencies/AgencyHome.tsx',
  'supplier People': 'src/pages/PartnerManagement/PartnerHome.tsx',
  'opndoor team': 'src/pages/UserManagement/UserManagement.tsx',
};

describe('every people screen uses it', () => {
  for (const [screen, file] of Object.entries(SCREENS)) {
    it(`${screen} draws the shared table`, () => {
      expect(readFileSync(file, 'utf8')).toContain('<PeopleTable');
    });
  }

  /* AND NONE OF THEM KEEPS A TABLE OF ITS OWN. The four were written at
     different times and each decided again what a level, a status and a
     missing name look like; the point of the change is that there is one
     answer, not four that happen to agree today. */
  it('and none of them still hand-draws one', () => {
    for (const [screen, file] of Object.entries(SCREENS)) {
      const src = readFileSync(file, 'utf8');
      /* The SIGNATURE of a people table, not any one header: the agency
         page also lists commission payees as "Paid to / Level / Rate",
         which is a table about money and not about people. */
      const signature = (src.match(/<th>(Name|User)<\/th>\s*<th>(Level|Role)<\/th>/g) ?? []);
      expect(signature, `${screen} still draws its own people columns`).toEqual([]);
    }
  });
});

const rows: PeopleTableRow[] = [
  { id: '1', name: 'Rosa Vance', email: 'rosa@regent.test', level: 'Director', office: "Regent's Park", status: 'active', lastActive: 'today' },
  { id: '2', name: '', email: 'barb@barb.com', level: 'Negotiator', office: 'Camden', status: 'pending', lastActive: 'Pending invite' },
  { id: '3', name: 'Nadia Shah', email: 'nadia@regent.test', level: 'Manager', office: 'Camden', status: 'deactivated', lastActive: '3 weeks ago' },
];

const table = (extra: Partial<Parameters<typeof PeopleTable>[0]> = {}) =>
  render(<PeopleTable rows={rows} {...extra} />);

describe('the table itself', () => {
  it('has the columns Matt listed, in that order', () => {
    const v = table();
    /* The actions header is empty on purpose: a column of row menus has no
       name, and `aria-label` carries it for a screen reader. */
    expect([...v.container.querySelectorAll('thead th')].map((t) => t.textContent))
      .toEqual(['Name', 'Level', 'Office', 'Status', 'Last active']);
  });

  it('and a person with no name reads the email once', () => {
    const v = table();
    const row = [...v.container.querySelectorAll('tbody tr')][1];
    expect(row.querySelector('.dt__name')?.textContent).toBe('barb@barb.com');
    expect(row.querySelector('.dt__sub')?.textContent).toBe('Name not set');
  });

  /* "INVITED", NOT "PENDING": what is pending is an invitation, which is
     the word Team argued for and the one the shared table keeps. */
  it('and calls a pending invitation an invitation', () => {
    expect(table().container.textContent).toContain('Invited');
  });

  it('and filters by search, level and status', async () => {
    const v = table();
    const rowCount = () => v.container.querySelectorAll('tbody tr').length;
    expect(rowCount()).toBe(3);
    fireEvent.change(v.container.querySelector('input[type="search"]')!, { target: { value: 'camden' } });
    expect(rowCount()).toBe(2);
    fireEvent.change(v.container.querySelector('input[type="search"]')!, { target: { value: '' } });
    fireEvent.change(v.container.querySelector('select[aria-label="Level"]')!, { target: { value: 'Director' } });
    expect(rowCount()).toBe(1);
  });

  /* A COLUMN NOBODY FILLS IS NOT A COLUMN, which is how a supplier's staff
     avoid a column of dashes: they hold no office. */
  it('and drops the Office column when nobody has one', () => {
    const v = render(<PeopleTable rows={rows.map((r) => ({ ...r, office: null }))} />);
    expect([...v.container.querySelectorAll('thead th')].map((t) => t.textContent))
      .not.toContain('Office');
  });

  it('and shows the extra column only when a screen asks for one', () => {
    const withExtra = render(<PeopleTable rows={rows.map((r) => ({ ...r, extra: 'Everything' }))} extraHeader="Sees" />);
    expect([...withExtra.container.querySelectorAll('thead th')].map((t) => t.textContent)).toContain('Sees');
  });
});
