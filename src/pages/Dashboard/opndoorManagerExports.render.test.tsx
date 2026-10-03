/* THE THREE CONTROLS THE BLANK-PAGE FIX LEFT HALF-WIRED.
 *
 * Found by the audit Matt asked for on the three items I had just built,
 * not by a failing test. All three are the same mistake in three places:
 * f2ccdb0 widened the gate on a BUTTON and not the gate on the thing the
 * button opens, or the copy the thing then prints.
 *
 *   1. Expiries      button widened, modal left at superadmin|management.
 *                    So the button renders for an opndoor_manager and
 *                    opens nothing. A dead control is worse than an absent
 *                    one: the reader cannot tell it from a broken page.
 *   2. Export summary  never widened at all, and its allowlist includes
 *                    'referrer'. So a Negotiator could take the summary of
 *                    their own book and Opndoor's own operations staff
 *                    could not.
 *   3. The scope line, in the modal and in the CSV itself, reads "Your
 *                    partner only" for anybody who is not a superadmin.
 *                    An opndoor_manager has no partner and the file
 *                    contains every one of them, so the document
 *                    misdescribes itself.
 *
 * WHY THIS IS ITS OWN FILE. opndoorManagerReporting.render.test.tsx asserts
 * what the PAGE shows. These are three controls and a document, and the
 * defect in each is the gap between a control and what sits behind it,
 * which is a different question from "is the page blank".
 *
 * AND THE NEGOTIATOR ASSERTIONS ARE NOT PADDING. 'referrer' is on the
 * Export summary allowlist deliberately -- the builders drop what a
 * Negotiator may not see rather than withholding the file -- so widening
 * that list is exactly the change most likely to be made by replacing it
 * with READS_THE_WHOLE_BOOK, which would silently take the export away
 * from every Negotiator in the estate.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { Dashboard } from './Dashboard';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { hydrateCommissionVisibility, buildExpiriesDoc } from '@/data';

const D = (y: number, m: number, d: number) => new Date(y, m, d);

const app = (over: Partial<FullApp>): FullApp => ({
  ref: 'GR-EX-1', partner: 'opndoor-agents', agency: 'Regent’s Lettings',
  branch: "Regent's Park", agencyId: 'ag-1', branchId: 'br-1',
  referrer: 'Tom Reeve', referrerId: 'u-tom', referrerRole: 'referrer',
  referrerSeesCommission: false, owner: 0,
  rent: 2000, fee: 2000, agentRate: 0.25, partnerRate: 0.25,
  status: 'deed', deedState: 'executed',
  sentAt: D(2026, 3, 10), paidAt: D(2026, 3, 20), deedAt: D(2026, 4, 1),
  tenancyStart: D(2026, 4, 2), expiry: D(2027, 4, 1),
  refunded: false, partiallyRefunded: false, withdrawn: false, expired: false,
  refundedAt: null, refundedAmount: null, refundAfterStart: false,
  deedSentAt: null, deedViewedAt: null,
  ...over,
} as unknown as FullApp);

const BOOK = [
  app({ ref: 'GR-AG' }),
  app({ ref: 'GR-SUP', partner: 'harbourside', agency: 'Harbourside Homes' }),
];

beforeEach(() => { localStorage.clear(); hydrateFull(BOOK); hydrateCommissionVisibility(true); });
afterEach(() => { cleanup(); hydrateFull([]); hydrateCommissionVisibility(true); });

async function open(role: string) {
  localStorage.setItem('grp_role', role);
  const view = render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <ToastProvider><SessionProvider><PageMetaProvider><Dashboard /></PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.page-head')) throw new Error('not ready'); });
  await act(async () => {});
  return view;
}

type View = Awaited<ReturnType<typeof open>>;
const button = (v: View, label: string) =>
  [...v.container.querySelectorAll<HTMLElement>('button')].find((b) => (b.textContent ?? '').trim() === label);
const dialog = (v: View) => v.container.querySelector('[role="dialog"]');

describe('the Expiries control', () => {
  /* THE DEAD CONTROL. Both halves in one test on purpose: a button that
     renders and a dialog that does not is precisely the state that shipped,
     so asserting only the button would have passed then too. */
  it('opens its dialog for an opndoor manager, not just render', async () => {
    const v = await open('opndoor_manager');
    const b = button(v, 'Expiries');
    expect(b, 'no Expiries button').toBeTruthy();
    await act(async () => { fireEvent.click(b!); });
    expect(dialog(v), 'the button rendered and opened nothing').toBeTruthy();
  });

  it('and still does for an admin', async () => {
    const v = await open('superadmin');
    await act(async () => { fireEvent.click(button(v, 'Expiries')!); });
    expect(dialog(v)).toBeTruthy();
  });

  /* THE DOCUMENT MUST NOT MISDESCRIBE ITSELF. "Your partner only" over a
     file containing every partner is a false statement about the contents,
     and it is the sentence a reader would quote if they were ever asked
     what the file covered. */
  it('and does not tell Opndoor ops staff the file is one partner’s', async () => {
    const v = await open('opndoor_manager');
    await act(async () => { fireEvent.click(button(v, 'Expiries')!); });
    expect(dialog(v)?.textContent ?? '').not.toMatch(/Your partner only/);
  });
});

describe('the Export summary control', () => {
  it('is offered to an opndoor manager', async () => {
    const v = await open('opndoor_manager');
    expect(button(v, 'Export summary'), 'no Export summary button').toBeTruthy();
  });

  /* THE ONE MOST LIKELY TO BE BROKEN BY THE FIX. 'referrer' is on this
     allowlist deliberately: the builder drops what a Negotiator may not
     see rather than withholding the document. Swapping the list for
     READS_THE_WHOLE_BOOK would take the export from every Negotiator in
     the estate and no other test would notice. */
  it('while a Negotiator keeps it, which the obvious fix would have taken away', async () => {
    const v = await open('referrer');
    expect(button(v, 'Export summary')).toBeTruthy();
  });

  it('and management keeps it', async () => {
    const v = await open('management');
    expect(button(v, 'Export summary')).toBeTruthy();
  });
});

describe('the expiries workbook itself', () => {
  /* A WORKBOOK SINCE 2026-10-03, and the scope line moved with it: it is a
     key/value line in the branded header block now rather than a CSV row,
     and it reads "Whole book" where it read "All partners (opndoor whole
     book)". Matt: "Header 'Scope: Whole book' instead of 'All partners'." */
  const scopeOf = (role: Parameters<typeof buildExpiriesDoc>[0]) => {
    const built = buildExpiriesDoc(role, 2027, 3);
    expect(built, 'the builder refused the role outright').toBeTruthy();
    const items = built!.sheets.flatMap((s) => s.doc.blocks).flatMap((b) => (b.kind === 'keyvalue' ? b.items : []));
    return String(items.find((i) => i.label === 'Scope')?.value ?? '');
  };

  /* THE SAME SENTENCE, IN THE FILE. The modal and the document build their
     scope line separately, so fixing one leaves the other. Asserted on the
     builder because that is what a person ends up holding. */
  it('does not describe a whole-book file as one partner’s', () => {
    expect(scopeOf('opndoor_manager')).not.toMatch(/Your partner/);
  });

  it('and says what it actually covers', () => {
    expect(scopeOf('opndoor_manager')).toBe('Whole book');
  });

  /* AND AN AGENCY'S OWN FILE STILL SAYS THE AGENCY'S NAME, which is what
     the line above it was changed to do in the first place: "Your partner"
     told an agency manager their own book belonged to a party they have
     never heard of. */
  it('while an agency reader still gets their own name on it', () => {
    expect(scopeOf('management')).not.toBe('Whole book');
  });
});
