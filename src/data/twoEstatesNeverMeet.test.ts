/* TWO ESTATES, AND THE SAME COMPANY CAN BE IN BOTH.
 *
 * Matt, 2026-10-01, replacing the "one agency record across routes" plan he
 * had sent an hour earlier: "Opndoor's estate: agencies that are Opndoor's
 * own clients (like Regent) ... Admin's Agencies tab lists only these. Each
 * supplier's estate (e.g. Rightmove): the agencies and branches that come
 * through that supplier. They never have logins ... The same real company
 * can exist in both estates (Frost as Opndoor's client and Frost under
 * Rightmove). They are two separate records that never link, share nothing,
 * and never show each other's data."
 *
 * =====================================================================
 * WHAT THE DATABASE ALREADY DID, AND WHAT THE CLIENT DID NOT
 * =====================================================================
 *
 * `agencies.partner_id` is NOT NULL and the unique index is on
 * (partner_id, name), so two estates have always been two rows. The client
 * was the half that assumed otherwise, under Matt's earlier ruling of
 * 2026-08-17 that an agency exists once across partners and is identified
 * by its name:
 *
 *   origin.ts        a selection was `agency:<name>`, so choosing Frost
 *                    chose every Frost
 *   agencyOffices    looked an agency up by name across every partner, so
 *                    a three-office Frost in one estate could decide
 *                    whether a one-office Frost in another showed a branch
 *                    column, a Branch row on the record, and a branch count
 *                    on its own page
 *
 * The League was already right: `keyOf` has always grouped agencies by
 * partner and name together.
 *
 * WHICH ESTATES CAN ACTUALLY COLLIDE IN A SELECTION. Only the ones on the
 * agency rail -- `opndoor-agents` and an agency-mode partner of our own.
 * A referral that came through a SUPPLIER has the supplier as its origin,
 * not the agency (the reasoning is at the top of origin.ts and is older
 * than this change), so it never produces an `agency:` value at all. That
 * is asserted below rather than left as an absence, because it is the
 * reason the estate scheme does not need to reach further than it does.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { agencySelection, originMatches, originOf, originValue } from './origin';

/** Two estates on the agency rail: the house partner every agency Opndoor
    onboards hangs off, and an agency-mode partner of our own. */
const OURS = 'opndoor-agents';
const THEIRS = 'northwind';
/** And a supplier, which is an estate of a different shape. */
const SUPPLIER = 'harbourside';

const row = (partner: string, agency: string) => ({ partner, agency });

describe('an agency selection names its estate', () => {
  it('so the two Frosts are two selections', () => {
    expect(originValue(row(OURS, 'Frost Partnership')))
      .toBe('agency:opndoor-agents:Frost Partnership');
    expect(originValue(row(THEIRS, 'Frost Partnership')))
      .toBe('agency:northwind:Frost Partnership');
  });

  it('and choosing one does not select the other', () => {
    const ours = 'agency:opndoor-agents:Frost Partnership';
    expect(originMatches(row(OURS, 'Frost Partnership'), ours)).toBe(true);
    expect(originMatches(row(THEIRS, 'Frost Partnership'), ours)).toBe(false);
  });

  /* A LINK SOMEBODY SAVED LAST WEEK still has to work. The older two-part
     form matches by name, which is what it has always done: a link that
     silently selects nothing is worse than one that selects a little too
     much. */
  it('while an older link still selects by name alone', () => {
    const legacy = 'agency:Frost Partnership';
    expect(agencySelection(legacy)).toEqual({ estate: '', name: 'Frost Partnership' });
    expect(originMatches(row(OURS, 'Frost Partnership'), legacy)).toBe(true);
    expect(originMatches(row(THEIRS, 'Frost Partnership'), legacy)).toBe(true);
  });

  /* THE HOUSE SLUG IS AN ESTATE, which is the case that matters most and
     the one a directory lookup alone would have missed: `opndoor-agents`
     is plumbing and has no partner record to find, so reading the estate
     off the partner list would fold the slug into the agency's name and
     make every Opndoor-estate selection unparseable. */
  it('and the house slug parses as an estate, not as part of the name', () => {
    expect(agencySelection('agency:opndoor-agents:Frost Partnership'))
      .toEqual({ estate: 'opndoor-agents', name: 'Frost Partnership' });
  });

  /* AND AN AGENCY WHOSE NAME HOLDS A COLON keeps all of it: the first
     segment is an estate only when it is actually a partner. */
  it('and a colon in a name is not mistaken for an estate', () => {
    expect(agencySelection('agency:Smith: Lettings'))
      .toEqual({ estate: '', name: 'Smith: Lettings' });
  });

  it('while a supplier-route referral is the supplier’s, never an agency selection', () => {
    expect(originOf(row(SUPPLIER, 'Frost Partnership')).kind).toBe('supplier');
    expect(originValue(row(SUPPLIER, 'Frost Partnership'))).toBe('partner:harbourside');
    expect(originMatches(row(SUPPLIER, 'Frost Partnership'), 'agency:Frost Partnership'))
      .toBe(false);
  });
});

describe('the code that assumed one agency across routes', () => {
  it('no longer looks an agency up by name alone where the estate is known', () => {
    const offices = readFileSync('src/data/agencyOffices.ts', 'utf8');
    expect(offices).toContain('estate?: string | null');
    expect(offices).toContain("all.find((a) => a.partner === estate)");
  });

  it('and every caller that knows its estate passes it', () => {
    expect(readFileSync('src/data/liveAnalytics.ts', 'utf8'))
      .toContain('showsOffices(app.agency, app.partner)');
    expect(readFileSync('src/pages/Applications/Applications.tsx', 'utf8'))
      .toContain('officeLabel(r.agency, r.branch, r.partner)');
    expect(readFileSync('src/pages/OrgManagement/OrgManagement.tsx', 'utf8'))
      .toContain('showsOffices(a.name, a.partner)');
    /* THE RECORD ITSELF. `ApplicationDetail` carried a partner display NAME
       and no slug, so the detail page asked by name and could be told by
       the other estate's Frost whether to draw a Branch row. */
    const detail = readFileSync('src/pages/ApplicationDetail/ApplicationDetail.tsx', 'utf8');
    expect(detail).toContain('showsOffices(d.agency, d.partner)');
    expect(detail).toContain('officeLabel(d.agency, d.branch, d.partner)');
    expect(readFileSync('src/pages/Agencies/AgencyHome.tsx', 'utf8'))
      .toContain('showsOffices(title, partner)');
  });

  /* THE LEAGUE WAS ALREADY RIGHT, and this says so rather than leaving
     somebody to wonder why it was not changed with the rest. */
  it('and the League already grouped by estate and name together', () => {
    expect(readFileSync('src/data/liveAnalytics.ts', 'utf8'))
      .toMatch(/key === 'agency'[\s\S]{0,120}\$\{app\.partner\}\$\{S\}\$\{app\.agency\}/);
  });
});

describe('admin’s Agencies tab is Opndoor’s own estate', () => {
  it('and a supplier’s agencies are on that supplier’s page instead', () => {
    const org = readFileSync('src/pages/OrgManagement/OrgManagement.tsx', 'utf8');
    expect(org).toContain('return all.filter((a) => !partyIsSupplier(a.partner));');
    const ph = readFileSync('src/pages/PartnerManagement/PartnerHome.tsx', 'utf8');
    expect(ph).toContain("'agencies'");
    expect(ph).toContain("{tab === 'agencies' && (");
  });

  /* A SUPPLIER'S OWN STAFF ARE UNAFFECTED, which is the sentence right
     after the one about admin: "The supplier's own staff keep seeing their
     agencies in their own Agencies tab, as now." They are scoped to their
     own partner, so the filter above returns before it can reach them. */
  it('while a supplier’s own staff keep their list', () => {
    expect(readFileSync('src/pages/OrgManagement/OrgManagement.tsx', 'utf8'))
      .toContain("if (role !== 'superadmin' && role !== 'opndoor_manager') return all;");
  });
});
