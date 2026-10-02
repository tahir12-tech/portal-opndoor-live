/* THE AGENCY PEOPLE TAB DREW THREE COLUMNS.
 *
 * Matt, 2026-10-02, verbatim: "The agency People tab (admin view, e.g. New
 * Independent) only shows Name, Level and Status. Use the same shared
 * people table as every other people screen, with Sees and Last active (or
 * "Invited [date]" for pending invites). Show the Office column only when
 * the agency has more than one office; for a single-office agency like New
 * Independent, leave it out. Check every people screen uses the shared
 * table and list any that don't. Deploy to dev and check there."
 *
 * IT WAS ALREADY ON THE SHARED TABLE -- onePeopleTable.render.test.tsx has
 * asserted that for all four screens since 2026-10-01. What it passed was
 * three of the table's columns. `extra`/`extraHeader` (the supplier tab's
 * "Sees") and `lastActive` were never filled, and the table drops a column
 * nobody fills, so on a single-office agency the header row really was
 * Name, Level, Status: every absence looked deliberate.
 *
 * WHICH IS WHY THIS FILE READS THE CALL SITES. The columns are decided by
 * what the screen hands the table, not by the table, so the test has to
 * be about the hand-off.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanup, render } from '@testing-library/react';
import { PeopleTable, type PeopleTableRow } from '@/components/people/PeopleTable';
import { agencySees, supplierSees, DEVELOPER_SEES } from '@/data/positionsService';

afterEach(cleanup);

const AGENCY_HOME = readFileSync('src/pages/Agencies/AgencyHome.tsx', 'utf8');

/* BOTH TABLES ON THE PAGE, not just the tab. The People tab lists the
   whole org; the node view lists who sits at the office or agency in
   focus. They are the same rows filtered, so a column on one and not the
   other is the same person reading two answers one scroll apart. */
const CALLS = AGENCY_HOME.split('<PeopleTable').slice(1);

describe('the agency People tab', () => {
  it('has two shared tables on it, and that is the whole page', () => {
    expect(CALLS).toHaveLength(2);
  });

  for (const [i, call] of CALLS.entries()) {
    const which = i === 0 ? 'the People tab' : 'the node view';

    it(`${which} asks for the Sees column`, () => {
      expect(call).toContain('extraHeader="Sees"');
    });

    /* THE SENTENCE COMES FROM positionsService, which is where
       supplierSees moved to on the same day. A screen that words it
       itself is how "-" and "Own referrals" came to mean the same thing
       on the two supplier lists. */
    it(`${which} fills it from the shared helper`, () => {
      expect(call).toContain('extra: agencySees(r.role, r.level)');
    });

    it(`${which} fills Last active`, () => {
      expect(call).toContain('lastActive: r.lastActive');
    });
  }

  /* THE OFFICE RULE, which needed no new code: `manyOffices` is
     branchCount > 1 over the org in view, the row passes null below that,
     and the table drops a header no row fills. Asserted because "leave it
     out" is a requirement whether or not it is already met, and the next
     reader is entitled to know it was checked. */
  it('passes no office at all when there is only one', () => {
    expect(AGENCY_HOME).toContain('office: manyOffices ? r.branch : null');
    expect(AGENCY_HOME).toContain('const manyOffices = branchCount > 1;');
  });
});

/* WHAT "SEES" SAYS ON OUR ESTATE. The applications policy is the subject:
   management is narrowed by app_scoped_agencies, a referrer to
   referrer_id = auth.uid(). */
describe('what a person on our estate sees', () => {
  it('is own referrals for a Negotiator, whatever they are positioned at', () => {
    expect(agencySees('referrer', 'branch')).toBe('Own referrals');
    expect(agencySees('referrer', 'agency')).toBe('Own referrals');
    expect(agencySees('referrer', 'group')).toBe('Own referrals');
  });

  /* A BRANCH POSITION REACHES THE AGENCY, not the office: app_scoped_agencies
     resolves a branch scope to the agency the branch belongs to. The office
     is a placement, not a permission -- which is the whole reason the Sees
     column is not the Office column said twice. */
  it('is the whole agency for management at an agency OR a branch', () => {
    expect(agencySees('management', 'branch')).toBe('The whole agency');
    expect(agencySees('management', 'agency')).toBe('The whole agency');
  });

  it('and every agency in the group for management positioned above them', () => {
    expect(agencySees('management', 'group')).toBe('Every agency in the group');
  });

  it('and a Developer reads the one sentence there is for that', () => {
    expect(agencySees('developer', null)).toBe(DEVELOPER_SEES);
    expect(supplierSees('developer')).toBe(DEVELOPER_SEES);
  });

  it('and opndoor is not narrowed at all', () => {
    expect(agencySees('superadmin', null)).toBe('Everything');
    expect(agencySees('opndoor_manager', null)).toBe('Everything');
  });

  /* A DASH FOR A ROLE GENUINELY OUTSIDE THE LADDER, and not "Own
     referrals": the supplier list already learned that reading an absence
     as the smallest scope tells somebody they see nothing. */
  it('and a role nobody has heard of is a dash, not the smallest scope', () => {
    expect(agencySees('tenant', 'agency')).toBe('-');
  });
});

/* AND THE SUPPLIER'S SENTENCES ARE THE SAME SENTENCES. Both rails' Sees
   wording lives in positionsService now, so the two lists cannot drift. */
describe('the supplier rail', () => {
  it('keeps its own answers, from the shared file', () => {
    expect(supplierSees('management')).toBe('Everything');
    expect(supplierSees('referrer')).toBe('Own referrals');
  });

  it('and PartnerHome no longer words them itself', () => {
    const src = readFileSync('src/pages/PartnerManagement/PartnerHome.tsx', 'utf8');
    expect(src).not.toContain('const supplierSees');
    expect(src).toContain("import { supplierSees } from '@/data/positionsService';");
  });
});

const agencyRows = (offices: boolean): PeopleTableRow[] => [
  {
    id: '1', name: 'Independent Director', email: 'dir@independent.test',
    level: 'Director', extra: agencySees('management', 'agency'),
    office: offices ? 'Camden' : null, status: 'pending',
    lastActive: 'Invited 29 Sep 2026',
  },
  {
    id: '2', name: 'Ola Fisher', email: 'ola@independent.test',
    level: 'Negotiator', extra: agencySees('referrer', 'branch'),
    office: offices ? 'Kentish Town' : null, status: 'active',
    lastActive: '2 hours ago',
  },
];

describe('drawn', () => {
  it('a single-office agency gets five columns and no Office', () => {
    const { container, getByText } = render(
      <PeopleTable showFilters={false} extraHeader="Sees" rows={agencyRows(false)} />,
    );
    const heads = [...container.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(heads).toEqual(['Name', 'Level', 'Sees', 'Status', 'Last active']);
    getByText('Own referrals');
    getByText('The whole agency');
    // The pending invite says when, where it used to repeat its own pill.
    getByText('Invited 29 Sep 2026');
  });

  it('and a two-office one gains Office between Sees and Status', () => {
    const { container } = render(
      <PeopleTable showFilters={false} extraHeader="Sees" rows={agencyRows(true)} />,
    );
    const heads = [...container.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(heads).toEqual(['Name', 'Level', 'Sees', 'Office', 'Status', 'Last active']);
  });
});
