/* Grouping a joint tenancy for the screen.

   The two facts these lock, because both are counter-intuitive and both are
   load-bearing:

   1. The DEED is the tenancy's and only its lead ever carries one, so a sibling
      asked for its own status answers "Paid" forever while the guarantee is in
      force. The group's status is the lead's.
   2. PAYMENT is per applicant, because each tenant pays their own share through
      their own link. It must not be flattened into the tenancy.

   Plus the page-boundary rule: a tenancy split across two pages reads as exactly
   the unrelated rows the grouping exists to prevent. */
import { describe, expect, it } from 'vitest';
import {
  collateTenancies, groupTenancies, memberLabel, pageWithoutSplitting, tenancyProgress,
} from './tenancyGroups';
import type { ApplicationSummary, Status } from './types';

let n = 0;
function row(over: Partial<ApplicationSummary> = {}): ApplicationSummary {
  n += 1;
  return {
    ref: `GR-${1000 + n}`, tenant: `Tenant ${n}`, prop: '14 Chalcot Road, NW1',
    branch: 'South Kensington', agency: 'Foxglove Residential', ben: '',
    rent: 3000, status: 'sent' as Status, date: '2026-06-20', owner: 1, partner: 'northwind',
    ...over,
  };
}
const joint = (pos: number, status: Status, over: Partial<ApplicationSummary> = {}) =>
  row({ tenancyId: 'ten-1', tenancyPosition: pos, sharePercent: 50, status, ...over });

describe('what counts as a group', () => {
  it('ignores sole applicants entirely', () => {
    expect(groupTenancies([row(), row()]).size).toBe(0);
  });

  it('ignores a tenancy with only one row visible, because the others are not on the screen', () => {
    // A referrer who owns one applicant of three sees one row. Drawing a group
    // header around it would assert two tenants that are nowhere to be seen.
    expect(groupTenancies([joint(1, 'paid')]).size).toBe(0);
  });

  it('groups two or more siblings', () => {
    const g = groupTenancies([joint(1, 'deed'), joint(2, 'paid')]);
    expect(g.size).toBe(1);
    expect(g.get('ten-1')!.members).toHaveLength(2);
  });
});

describe('the deed is the tenancy’s, the payment is the person’s', () => {
  const rows = [joint(1, 'deed'), joint(2, 'paid')];

  it('takes the group status from the LEAD, not from whichever row was asked', () => {
    // The sibling sits at 'paid' for good: apply_deed_executed keys on the
    // PandaDoc document and only the lead has one.
    const g = groupTenancies(rows).get('ten-1')!;
    expect(g.status).toBe('deed');
  });

  it('marks position 1 as the lead and nobody else', () => {
    const g = groupTenancies(rows).get('ten-1')!;
    expect(g.members.map((m) => m.isLead)).toEqual([true, false]);
  });

  it('keeps payment per applicant', () => {
    const g = groupTenancies([joint(1, 'sent'), joint(2, 'paid')]).get('ten-1')!;
    expect(g.members.map((m) => m.paid)).toEqual([false, true]);
    expect(g.fullyPaid).toBe(false);
    expect(g.unpaidCount).toBe(1);
    expect(tenancyProgress(g)).toBe('1 of 2 tenants have paid');
  });

  it('is fully paid only once every tenant has paid their own share', () => {
    const g = groupTenancies(rows).get('ten-1')!;
    expect(g.fullyPaid).toBe(true);
    expect(tenancyProgress(g)).toBe('All 2 tenants have paid');
  });

  it('prefers the payment timestamp over the status when it is there', () => {
    const g = groupTenancies([
      joint(1, 'sent', { paidAtTs: 1 }), joint(2, 'sent'),
    ]).get('ten-1')!;
    expect(g.members.map((m) => m.paid)).toEqual([true, false]);
  });

  it('orders members by entry order, not by however the rows arrived', () => {
    const g = groupTenancies([joint(2, 'paid'), joint(1, 'deed')]).get('ten-1')!;
    expect(g.members.map((m) => m.position)).toEqual([1, 2]);
    expect(g.members[0].isLead).toBe(true);
    expect(memberLabel(g, g.members[1].ref)).toBe('Tenant 2 of 2');
  });
});

describe('collating, without disturbing the sort', () => {
  it('brings siblings together at the position of the first one', () => {
    const a = row({ ref: 'A' });
    const j2 = joint(2, 'paid', { ref: 'J2' });
    const b = row({ ref: 'B' });
    const j1 = joint(1, 'deed', { ref: 'J1' });
    const rows = [a, j2, b, j1];
    const out = collateTenancies(rows, groupTenancies(rows));
    // J2 appeared second, so the tenancy sits second — and in entry order.
    expect(out.map((r) => r.ref)).toEqual(['A', 'J1', 'J2', 'B']);
  });

  it('leaves a list with no joint tenancies exactly as it was', () => {
    const rows = [row(), row(), row()];
    expect(collateTenancies(rows, groupTenancies(rows))).toEqual(rows);
  });
});

describe('a tenancy is never split across a page boundary', () => {
  it('moves the whole tenancy to the next page rather than stranding a tenant', () => {
    const singles = Array.from({ length: 3 }, () => row());
    const j = [joint(1, 'deed', { ref: 'J1' }), joint(2, 'paid', { ref: 'J2' })];
    const rows = [...singles, ...j];
    const groups = groupTenancies(rows);
    const pages = pageWithoutSplitting(collateTenancies(rows, groups), groups, 4);
    // Page one would have taken J1 as its fourth row; instead the pair moves on.
    expect(pages[0].map((r) => r.ref)).toEqual(singles.map((r) => r.ref));
    expect(pages[1].map((r) => r.ref)).toEqual(['J1', 'J2']);
  });

  it('lets a page run over rather than break a tenancy that starts within it', () => {
    const j = [joint(1, 'deed', { ref: 'J1' }), joint(2, 'paid', { ref: 'J2' }), joint(3, 'paid', { ref: 'J3' })];
    const rows = [...j, row()];
    const groups = groupTenancies(rows);
    const pages = pageWithoutSplitting(collateTenancies(rows, groups), groups, 2);
    // The tenancy opens the page, so it stays whole even at three rows over two.
    expect(pages[0].map((r) => r.ref)).toEqual(['J1', 'J2', 'J3']);
    expect(pages[1]).toHaveLength(1);
  });

  it('pages a plain list exactly as a slice would', () => {
    const rows = Array.from({ length: 5 }, () => row());
    const pages = pageWithoutSplitting(rows, new Map(), 2);
    expect(pages.map((p) => p.length)).toEqual([2, 2, 1]);
  });

  it('gives an empty list one empty page rather than none, so the pager has something to show', () => {
    expect(pageWithoutSplitting([], new Map(), 20)).toEqual([[]]);
  });

  it('can need MORE pages than a division says, which is why the pager is told the count', () => {
    /* Three singles, a pair, three singles, four to a page. Dividing says two
       pages; keeping the pair whole needs three. A pager that divided would
       disable Next on page two and the eighth row would simply not exist as far
       as anyone could tell. */
    const rows = [
      row(), row(), row(),
      joint(1, 'deed', { ref: 'J1' }), joint(2, 'paid', { ref: 'J2' }),
      row(), row(), row(),
    ];
    const groups = groupTenancies(rows);
    const pages = pageWithoutSplitting(collateTenancies(rows, groups), groups, 4);
    expect(Math.ceil(rows.length / 4)).toBe(2);
    expect(pages).toHaveLength(3);
    // Every row is still reachable, which is the property that matters.
    expect(pages.flat()).toHaveLength(rows.length);
  });
});
