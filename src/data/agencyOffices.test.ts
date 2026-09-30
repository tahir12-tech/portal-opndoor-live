/* NM-P. A SINGLE-OFFICE AGENCY IS JUST THE AGENCY.
 *
 * Matt, 2026-09-30, verbatim: "A single-office agency shows only as the
 * agency, e.g. 'Regent Property', everywhere: agencies list, agency page,
 * applications, reporting, statements, emails, deeds and the referral form.
 * No '1 branch', no branch row, no branch name. Where the system needs an
 * office behind the scenes, it uses the agency's own name and address and is
 * never shown separately. 'Add branch' stays available on the agency (its
 * menu or page), and as soon as a second office is added, both appear as
 * branches."
 *
 * THE BRANCH ROW DOES NOT STOP EXISTING. His own second sentence keeps it:
 * every referral still hangs off a branch, `branch_id` is still how the
 * agency rail resolves a position, and deeds, statements and notifications
 * all still route through one. What changes is that when an agency has
 * exactly ONE office, no surface says the word "branch", shows its name, or
 * counts it.
 *
 * SO IT IS ONE PREDICATE, ASKED OF AN AGENCY, AND ASKED EVERYWHERE.
 *
 * THREE-STATE, AND THAT IS THE WHOLE CARE IN THIS FILE. "We do not know this
 * agency's office list" is NOT "it has one office". An application row
 * carries an agency NAME, and the org tree it would be resolved against is
 * scoped by RLS and may not hold that agency at all -- a supplier's reader
 * looking at a row from another partner, a hydrate that has not run, a test
 * fixture. Collapsing on unknown would hide a real office name on a
 * multi-office agency, which is a silent wrong answer. Unknown therefore
 * shows the office, exactly as today.
 *
 * NOT viewerShape, AND THE DIFFERENCE IS NOT PEDANTIC. viewerShape counts
 * what is in the READER's book and answers "does this reader ever see more
 * than one branch". This asks about ONE AGENCY regardless of who is looking.
 * An Opndoor admin reading a three-agency book where every agency has one
 * office has `oneBranch: false` on their own shape and must still see no
 * office named on any of the three.
 *
 * NOT `<= 1`, EITHER. An agency with zero offices is a real state --
 * `orgNotSetUp` treats it as its own case, and the agencies list says so --
 * and folding it into the hidden case destroys that signal.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agencyOffices, showsOffices, officeLabel } from './agencyOffices';
import { hydrateOrg } from './orgService';
import { ORG_SEED } from './mock/org';
import type { Agency } from './types';

const seeded = () => ORG_SEED.map((a) => ({ ...a }));

/** Foxglove has three offices in the seed; Riverside has exactly one. */
const MANY = 'Foxglove Residential';
const ONE = 'Riverside Homes';

beforeEach(() => hydrateOrg(seeded()));
afterEach(() => hydrateOrg(seeded()));

describe('counting an agency’s offices', () => {
  it('knows a multi-office agency by name', () => {
    const r = agencyOffices(MANY);
    expect(r.known).toBe(true);
    expect(r.known && r.offices).toBeGreaterThan(1);
    expect(r.known && r.singleOffice).toBe(false);
  });

  it('and a single-office one', () => {
    const r = agencyOffices(ONE);
    expect(r.known).toBe(true);
    expect(r.known && r.offices).toBe(1);
    expect(r.known && r.singleOffice).toBe(true);
    expect(r.known && r.onlyOfficeName).toBe('Bermondsey');
  });

  /* THE STATE THAT IS NOT A COUNT. An agency the reader's book does not
     hold is not an agency with one office. */
  it('and says plainly when it does not know', () => {
    expect(agencyOffices('An Agency Nobody Has Heard Of').known).toBe(false);
    expect(agencyOffices(null).known).toBe(false);
    expect(agencyOffices(undefined).known).toBe(false);
    expect(agencyOffices('').known).toBe(false);
  });
});

describe('the predicate every surface asks', () => {
  it('says a multi-office agency shows its offices', () => {
    expect(showsOffices(MANY)).toBe(true);
  });

  it('and a single-office agency does not', () => {
    expect(showsOffices(ONE)).toBe(false);
  });

  /* UNKNOWN SHOWS THE OFFICE, which is today's behaviour and the safe
     direction: hiding a real office name on a multi-office agency because
     the tree happened not to be hydrated is a silent wrong answer, and
     showing one on a single-office agency is merely the old screen. */
  it('and an agency it does not know still shows, so nothing is hidden by accident', () => {
    expect(showsOffices('An Agency Nobody Has Heard Of')).toBe(true);
    expect(showsOffices(null)).toBe(true);
  });

  /* ZERO IS NOT ONE. orgNotSetUp treats an agency with no office as its own
     state and the agencies list says so; folding it in would delete that. */
  it('and an agency with no office at all still shows, because zero is a real state', () => {
    hydrateOrg([{ name: 'Empty Lettings', partner: 'northwind', branches: [] } as unknown as Agency]);
    const r = agencyOffices('Empty Lettings');
    expect(r.known && r.offices).toBe(0);
    expect(r.known && r.singleOffice).toBe(false);
    expect(showsOffices('Empty Lettings')).toBe(true);
  });

  /* A PLACEHOLDER IS NOT AN OFFICE. The house rail carries "Unattached"
     branches that exist only so a NOT NULL foreign key resolves; counting
     one would make a genuinely single-office agency look like two. */
  it('and a placeholder office does not count towards the total', () => {
    hydrateOrg([{
      name: 'One Real Office', partner: 'northwind',
      branches: [{ name: 'Chelsea' }, { name: 'Unattached', isPlaceholder: true }],
    } as unknown as Agency]);
    const r = agencyOffices('One Real Office');
    expect(r.known && r.offices).toBe(1);
    expect(showsOffices('One Real Office')).toBe(false);
  });
});

describe('the label a branch-shaped row must carry', () => {
  /* ITS COMPANION, so the count and the words can never disagree. Every
     caller needs something to print, so it never returns an empty string. */
  it('is the office name where the agency names its offices', () => {
    expect(officeLabel(MANY, 'Chelsea')).toBe('Chelsea');
  });

  it('and the agency’s own name where it has one office', () => {
    expect(officeLabel(ONE, 'Bermondsey')).toBe(ONE);
  });

  it('and the office name when the agency is unknown, which is today’s answer', () => {
    expect(officeLabel('Nobody', 'Some Office')).toBe('Some Office');
  });

  /* AND NEVER NOTHING. A caller that prints this into a table cell or an
     email must not be handed an empty string. */
  it('and never an empty string, whatever it is given', () => {
    expect(officeLabel(ONE, '')).toBe(ONE);
    expect(officeLabel(null, '')).toBeTruthy();
    expect(officeLabel(null, null)).toBeTruthy();
  });
});

describe('the flip, which is the half that makes this a rule and not a fixture', () => {
  /* "As soon as a second office is added, both appear as branches." So the
     answer must change on the next read, with no cached flag to go stale. */
  it('a single-office agency shows its offices the moment it gains a second', () => {
    expect(showsOffices(ONE)).toBe(false);
    const grown = seeded().map((a) => (a.name === ONE
      ? { ...a, branches: [...(a.branches ?? []), { name: 'Rotherhithe' }] }
      : a));
    hydrateOrg(grown as Agency[]);
    expect(showsOffices(ONE)).toBe(true);
    expect(officeLabel(ONE, 'Bermondsey')).toBe('Bermondsey');
  });
});
