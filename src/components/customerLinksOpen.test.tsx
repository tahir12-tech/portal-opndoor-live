/* THE LINKS OUT OF THE CUSTOMER TABLE HAVE TO RESOLVE.
 *
 * Found while building NM-M. The View as button lives on each agency's own
 * page, and the per-customer table on Reporting is how an admin gets there,
 * so a link that lands on "Agency not found" makes the new control
 * unreachable from the page it is meant to be reached from.
 *
 * THE DEFECT. CustomersTable linked an agency by its NAME:
 *
 *     `/agencies/${encodeURIComponent(r.name)}`
 *
 * and AgencyHome resolves the route parameter against `x.id ?? x.name`.
 * Every other link to an agency in the product goes through the exported
 * helper `agencyKey`, which is that same `id ?? name`; this one was written
 * by hand and is the only one that does not.
 *
 * WHY IT LOOKED FINE. In mock the seed agencies carry no `id` at all
 * (src/data/mock/org.ts), so `id ?? name` IS the name and the hand-written
 * link happens to agree. On dev and in production every agency has a uuid,
 * so the two disagree on every row and the link is broken for all of them.
 * That is the shape of bug a fixture hides completely, which is why this
 * test stages an agency WITH an id -- the one thing the mock book never
 * does.
 *
 * The existing render test (everyCustomer.render.test.tsx) asserts the
 * links start with `/agencies/` and `/partners/`. That was true throughout.
 * Starting with the right prefix and pointing at the right record are two
 * different claims, and only the first was being made.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CustomersTable } from './CustomersTable';
import { agencyKey } from '@/pages/Agencies/AgencyHome';
import type { CustomerRow } from '@/data/liveAnalytics';

const row = (over: Partial<CustomerRow>): CustomerRow => ({
  key: 'agency:Regent’s Lettings', name: 'Regent’s Lettings', kind: 'agency',
  sent: 3, fees: 6000, deeds: 3, payable: 1500, ...over,
});

const hrefs = (rows: CustomerRow[]) => {
  const v = render(<MemoryRouter><CustomersTable rows={rows} seesCommission /></MemoryRouter>);
  return [...v.container.querySelectorAll('tbody a')].map((a) => a.getAttribute('href') ?? '');
};

describe('an agency link', () => {
  /* THE ONE THE MOCK BOOK CANNOT CATCH. On dev this is every agency. */
  it('carries the agency’s id, which is what AgencyHome resolves', () => {
    const [href] = hrefs([row({ key: 'agency:Regent’s Lettings', agencyId: '8c1f0f2e-0000-4000-8000-000000000001' } as Partial<CustomerRow>)]);
    expect(href).toBe('/agencies/8c1f0f2e-0000-4000-8000-000000000001');
  });

  /* AND FALLS BACK TO THE NAME when there is no id, which is the mock book
     and is also what `agencyKey` does. Both halves, so the fix cannot be
     "always use the id" on a book that does not always have one. */
  it('and falls back to the name when the agency has no id', () => {
    const [href] = hrefs([row({})]);
    expect(href).toBe(`/agencies/${encodeURIComponent('Regent’s Lettings')}`);
  });

  /* THE SAME RULE AS EVERY OTHER LINK IN THE PRODUCT. Asserted against the
     exported helper rather than restated, so the two cannot drift: if
     agencyKey's rule changes, this follows it. */
  it('and agrees with the helper the rest of the product uses', () => {
    const agency = { id: 'ag-77', name: 'Somewhere Lettings' };
    const [href] = hrefs([row({ key: 'agency:Somewhere Lettings', name: 'Somewhere Lettings', agencyId: 'ag-77' } as Partial<CustomerRow>)]);
    expect(href).toBe(`/agencies/${encodeURIComponent(agencyKey(agency as never))}`);
  });
});

describe('a supplier link', () => {
  /* UNCHANGED, and asserted so the fix stays on the rail it belongs to. On
     the supplier rail the partner IS the boundary and the slug is the key,
     which is why that half was never broken. */
  it('carries the partner slug, as it always did', () => {
    const [href] = hrefs([row({ key: 'partner:harbourside', name: 'Harbourside Homes', kind: 'supplier' })]);
    expect(href).toBe('/partners/harbourside');
  });
});
