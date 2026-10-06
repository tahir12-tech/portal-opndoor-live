/* NM-P, ON THE SCREENS. A SINGLE-OFFICE AGENCY IS JUST THE AGENCY.
 *
 * Matt, 2026-09-30, verbatim: "A single-office agency shows only as the
 * agency, e.g. 'Regent Property', everywhere: agencies list, agency page,
 * applications, reporting, statements, emails, deeds and the referral
 * form. No '1 branch', no branch row, no branch name... 'Add branch'
 * stays available on the agency (its menu or page), and as soon as a
 * second office is added, both appear as branches."
 *
 * THE FIXTURE IS THE TEST. Every assertion below is made against a book
 * holding BOTH shapes at once -- Foxglove with three offices, Riverside
 * with one -- because the mistake this rule invites is a page-wide
 * collapse. The existing column rule on Applications (`showBranch`) asks
 * about the READER's whole book and is right to; NM-P asks about one
 * agency, and on a mixed page the two disagree by design. A fixture with
 * only single-office agencies in it would pass a page-wide collapse and
 * prove nothing.
 *
 * AND THE TRAP HAS ITS OWN BLOCK. "Add branch" lives INSIDE the branch
 * list, so the obvious implementation -- hide the rows -- deletes the one
 * control Matt said must stay.
 *
 * =====================================================================
 * AMENDED 2026-10-04: THE RULE IS THE NAME, NOT THE COUNT
 * =====================================================================
 *
 * Matt: "Office naming: apply it everywhere; show the office's own name
 * wherever an office is shown." Chosen from three options after he reported
 * that Kestrel's Frost showed as "Frost Partnership" with no agency on the
 * row.
 *
 * His 2026-09-30 ruling rests on a sentence in it: "where the system needs an
 * office behind the scenes, it uses the agency's own name and address". That
 * is true of three single-office agencies on dev and false of five.
 * Riverside's one office is called "Bermondsey", a name a person chose, and
 * the count rule threw it away.
 *
 * SO `ONE` NO LONGER COLLAPSES and `SAME` is added for the shape that does.
 * Every assertion below that read "one office, therefore the agency" is now
 * one of the two, and Matt's "as soon as a second office is added" clause is
 * tested on `SAME`, because it is the only one that starts collapsed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { AgencyHome } from './AgencyHome';
import { hydrateOrg, hydrateCommissionVisibility } from '@/data';
import { ORG_SEED } from '@/data/mock/org';
import { showsOffices, officeLabel } from '@/data/agencyOffices';
import type { Agency } from '@/data';

const MANY = 'Foxglove Residential';   // three offices in the seed
const ONE = 'Riverside Homes';         // one office, called "Bermondsey"
/* ONE OFFICE, NAMED AFTER ITS AGENCY, which since 2026-10-04 is the shape
   that collapses. See the block below. */
const SAME = 'Selfsame Lettings';

const seeded = () => [
  ...ORG_SEED.map((a) => ({ ...a })),
  { name: SAME, partner: 'northwind', branches: [{ name: SAME }] },
] as unknown as Agency[];

beforeEach(() => { localStorage.clear(); hydrateOrg(seeded()); hydrateCommissionVisibility(true); });
afterEach(() => { cleanup(); hydrateOrg(seeded()); });

async function openAgency(name: string, role = 'superadmin') {
  localStorage.setItem('grp_role', role);
  const view = render(
    <MemoryRouter initialEntries={[`/agencies/${encodeURIComponent(name)}`]}>
      <ToastProvider><SessionProvider><PageMetaProvider>
        <Routes><Route path="/agencies/:key" element={<AgencyHome />} /></Routes>
      </PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.page-head')) throw new Error('not ready'); });
  await act(async () => {});
  return view;
}

type View = Awaited<ReturnType<typeof openAgency>>;
const text = (v: View) => v.container.textContent ?? '';

/* THE FIGURES, READ AS ELEMENTS RATHER THAN OUT OF THE PAGE TEXT.
   My first version of this asserted `not.toMatch(/\b1 branch\b/)` over
   textContent and PASSED WITH THE FIX REMOVED. The page renders
   "Agency1 branch·0 people", with no whitespace between the pill and the
   figure, so there is no word boundary between "y" and "1" and the regex
   could never match. A mutation check caught it; the assertion had looked
   exactly right. Reading the elements removes the question. */
const figures = (v: View) =>
  [...v.container.querySelectorAll('.ah-fig')].map((e) => (e.textContent ?? '').trim());

describe('the agency page of a single-office agency', () => {
  it('does not print "1 branch"', async () => {
    const v = await openAgency(SAME);
    expect(figures(v).join(' | ')).not.toMatch(/branch/i);
  });

  /* AND ONE WHOSE OFFICE HAS A NAME DOES COUNT IT, which is the 2026-10-04
     change: "Bermondsey" is where the let is, and the figure is the way into
     the tree that names it. */
  it('while an agency whose one office has its own name counts it', async () => {
    const v = await openAgency(ONE);
    expect(figures(v).join(' | ')).toMatch(/1 branch/);
  });

  /* THE CONTROL, and the reason the fixture holds both shapes: a
     three-office agency must still count its offices on the same build. */
  it('while a multi-office agency still counts its offices', async () => {
    const v = await openAgency(MANY);
    expect(figures(v).join(' | ')).toMatch(/3 branches/);
  });

  /* AND THE PAGE IS STILL THE AGENCY'S. Asserting only the absence would
     pass on a page that failed to render at all. */
  it('and the page is still there, named after the agency', async () => {
    const v = await openAgency(SAME);
    expect(v.container.querySelector('.page-head__title')?.textContent).toBe(SAME);
    expect(text(v)).toMatch(/people/i);
  });
});

describe('the predicate the screens ask', () => {
  /* THE RULE IS PER AGENCY, NOT PER READER, and this is the assertion that
     says so: one book, two agencies, two different answers. A reader-shaped
     rule cannot produce this. */
  it('answers differently for two agencies in the same book', () => {
    expect(showsOffices(MANY)).toBe(true);
    expect(showsOffices(SAME)).toBe(false);
  });

  /* THREE AGENCIES, THREE SHAPES, ONE BOOK, which is what the per-agency
     rule has to produce and a per-reader one never could: many offices, one
     office with a name, one office without. */
  it('and all three shapes at once', () => {
    expect(showsOffices(MANY)).toBe(true);
    expect(showsOffices(ONE)).toBe(true);
    expect(showsOffices(SAME)).toBe(false);
  });

  it('and labels a row by the office wherever the office has its own name', () => {
    expect(officeLabel(ONE, 'Bermondsey')).toBe('Bermondsey');
    expect(officeLabel(MANY, 'Chelsea')).toBe('Chelsea');
    expect(officeLabel(SAME, SAME)).toBe(SAME);
  });
});

describe('and as soon as a second office is added', () => {
  /* MATT'S LAST CLAUSE, and the one that makes this a rule rather than a
     fixture: "as soon as a second office is added, both appear as
     branches." No cached flag, no migration, no re-login. */
  it('both appear as branches', async () => {
    expect(showsOffices(SAME)).toBe(false);
    hydrateOrg(seeded().map((a) => (a.name === SAME
      ? { ...a, branches: [...(a.branches ?? []), { name: 'Rotherhithe', area: 'SE16' }] }
      : a)) as Agency[]);
    expect(showsOffices(SAME)).toBe(true);
    const v = await openAgency(SAME);
    expect(figures(v).join(' | ')).toMatch(/2 branches/);
  });
});
