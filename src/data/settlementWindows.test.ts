/* THE TWO WINDOWS A SETTLEMENT IS ABOUT.

   Settlement only ever computed the CLOSED month, payable on the 15th of this
   one. So on the 3rd of September the surface said

     "No commission is payable for August."

   over a September that had already taken money. It reads as "you have earned
   nothing", which is the opposite of true, and it was the only thing the page
   could say because the only figure it had was August's.

   'current' is that missing figure: this month TO DATE, payable on the 15th of
   next. Both windows come out of one helper so the two blocks cannot disagree
   about where a month ends.

   These assert the WINDOW arithmetic against the live book, which is the part
   that was missing. What each block renders is asserted in the surface's own
   render test; what a payee is owed is asserted in settlement-statement. */
import { describe, expect, it } from 'vitest';
import { ALL_PARTNERS, getAgentCommissionSettlement, getCommissionSettlement } from '@/data';

const ADMIN = { role: 'superadmin' as const, scope: ALL_PARTNERS };
const prior = () => getCommissionSettlement(ADMIN.role, ADMIN.scope);
const current = () => getCommissionSettlement(ADMIN.role, ADMIN.scope, 'current');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const labelOf = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

/* THE REFERENCE "NOW", which is not the wall clock: the demo book is pinned to
   a fixed date so its figures do not change overnight. Rather than import that
   constant and hard-code the demo's month into assertions about arithmetic,
   every expectation below is derived from the closed window's own settlement
   date, which is by definition the 15th of the reference month. The test then
   says the same thing in live mode and in mock mode. */
const refMonthStart = () => {
  const d = prior().settlementDate;
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

describe('which month each window is about', () => {
  it('defaults to the month before the reference one, so every existing caller is unchanged', () => {
    const ref = refMonthStart();
    expect(prior().monthLabel).toBe(labelOf(new Date(ref.getFullYear(), ref.getMonth() - 1, 1)));
  });

  it('the current window is the reference month itself', () => {
    expect(current().monthLabel).toBe(labelOf(refMonthStart()));
  });

  it('they are never the same month', () => {
    expect(current().monthLabel).not.toBe(prior().monthLabel);
  });
});

describe('when each becomes payable', () => {
  it('the closed month is payable on the 15th of the month after it', () => {
    const d = prior().settlementDate;
    const closed = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    expect(d.getDate()).toBe(15);
    expect(prior().monthLabel).toBe(labelOf(closed));
  });

  /* A MONTH LATER, and it has to survive December: month + 1 on a Date rolls
     the year, which is why this is arithmetic and not string work. */
  it('the open month becomes payable on the 15th of next, a month later', () => {
    const ref = refMonthStart();
    const expected = new Date(ref.getFullYear(), ref.getMonth() + 1, 15);
    const d = current().settlementDate;
    expect(d.getDate()).toBe(15);
    expect(d.getMonth()).toBe(expected.getMonth());
    expect(d.getFullYear()).toBe(expected.getFullYear());
  });
});

describe('what the current window counts', () => {
  /* TO DATE, NOT TO MONTH END. Money that has not been taken cannot be
     accruing; it is forecast, and this figure is read as a fact. The bound is
     the reference now, whose day this test cannot know, so what is asserted is
     the part that is knowable: everything counted falls inside the reference
     month, and nothing later than the reference instant can be in the book to
     begin with. */
  it('counts only payments inside the open month', () => {
    const ref = refMonthStart();
    for (const p of current().partners) {
      for (const app of p.apps) {
        expect(app.paidAt.getMonth()).toBe(ref.getMonth());
        expect(app.paidAt.getFullYear()).toBe(ref.getFullYear());
      }
    }
  });

  it('counts nothing the closed month already counted', () => {
    const inPrior = new Set(prior().partners.flatMap((p) => p.apps.map((a) => a.ref)));
    const inCurrent = current().partners.flatMap((p) => p.apps.map((a) => a.ref));
    for (const ref of inCurrent) expect(inPrior.has(ref)).toBe(false);
  });
});

describe('the agent side takes the same windows', () => {
  it('defaults to the closed month and accepts the current one', () => {
    const a = getAgentCommissionSettlement(ADMIN.role, ADMIN.scope);
    const b = getAgentCommissionSettlement(ADMIN.role, ADMIN.scope, 'current');
    expect(a.monthLabel).toBe(prior().monthLabel);
    expect(b.monthLabel).toBe(current().monthLabel);
    expect(b.settlementDate.getTime()).toBeGreaterThan(a.settlementDate.getTime());
  });

  /* A window is not a way round the commission gate: a Manager gets no payees
     and no total in either. */
  it('withholds both windows from a level that may not see commission', () => {
    for (const w of ['prior', 'current'] as const) {
      const s = getAgentCommissionSettlement('management', 'northwind', w);
      // 'management' alone is a Manager here: hydrateCommissionVisibility has
      // not been called, so maySeeCommission is false.
      expect(s.payees).toEqual([]);
      expect(s.total).toBe(0);
      // The calendar stays, because a date is not a figure.
      expect(s.monthLabel).toBeTruthy();
    }
  });
});
