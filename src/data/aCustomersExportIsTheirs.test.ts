/* =====================================================================
   WHAT A CUSTOMER'S OWN EXPORT HOLDS, AND WHAT IS OPNDOOR'S.

   Matt, 2026-10-03, two instructions with one subject:

     "Application export as seen by an agency or supplier: include the tenant's
      name (it's their own client); drop the 'Refund policy anomaly' column;
      replace 'Tenancy ID' with 'Joint with' listing the other tenants'
      references, as the expiries file does. Keep Opndoor's own export as it is
      unless the same changes make sense there."

     "League exports as an agency or supplier: drop the 'Route' column (and
      'Agency or supplier'), which only mean something in Opndoor's view."

   THE AUDIENCE IS THE AXIS, which is why both are one predicate.
   `agencyFacing` was already in scope at every one of these sites and is the
   wrong question: it asks "is the reader on the agency rail", and a supplier's
   Management reading their own book is just as much a customer. Asking it
   would have fixed the agency's copy and left the supplier's alone, which is
   the half of the instruction easiest to miss.

   WHY EACH COLUMN BELONGS WHERE IT DOES:

     Tenant name     their own client. Opndoor's copy is a cross-customer
                     operational list and names tenants further down already.
     Refund policy   an Opndoor reconciliation flag: it reports that a refund
       anomaly       does not match OUR policy, which is ours to resolve.
     Tenancy ID      a uuid, and what Opndoor GROUPS a joint let by.
     Joint with      the same fact in a form a customer can use, and how the
                     expiries file has said it since it was written.
     Route           which of Opndoor's rails the row came in on. A customer's
                     file holds one estate, so it is their own name repeated.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/data/exportsService.ts'), 'utf8');

describe('the predicate', () => {
  it('asks the audience, not the rail', () => {
    expect(SRC).toContain('function customerFacing(role: Role): boolean {\n  return !isOpndoorStaff(role);');
  });

  /* IT IS NOT agencyFacing, and the distinction is the point: that one still
     exists and still decides agency-rail things, like whether to print a
     Supplier column. */
  it('and leaves agencyFacing doing its own job', () => {
    expect(SRC).toContain('function agencyFacing(role: Role): boolean {\n  return isAgencyUser(role, scopeFor(role));');
  });
});

describe('the applications export', () => {
  it('names the tenant on a customer’s copy, beside the reference', () => {
    expect(SRC).toContain("...(forCustomer ? [{ header: 'Tenant', type: 'text' } as Column] : []),");
    expect(SRC).toContain("...(forCustomer ? [findRecord(a.ref)?.name ?? ''] : []),");
  });

  it('drops the refund anomaly flag, which is an opndoor reconciliation column', () => {
    expect(SRC).toContain("...(forCustomer ? [] : [{ header: 'Refund policy anomaly', type: 'text' } as Column]),");
  });

  /* ONE OR THE OTHER, NEVER BOTH AND NEVER NEITHER, because the headings and
     the cells are declared in two places and a mismatch shifts every column
     after it while still opening in Excel. */
  it('swaps the Tenancy ID for Joint with, and keeps the id for opndoor', () => {
    expect(SRC).toContain("? [{ header: 'Joint with', type: 'text' } as Column]");
    expect(SRC).toContain(": [{ header: 'Tenancy ID', type: 'text' } as Column]),");
    expect(SRC).toContain("        : (a.tenancyId ?? ''),");
  });

  /* THE OTHERS, NOT THIS ONE. The expiries file's own rule, and its reason:
     listing a sole tenancy's own reference back at it reads as a second
     guarantee. */
  it('and Joint with lists the others, not this one', () => {
    expect(SRC).toContain(".filter((r) => r !== a.ref).sort().join(', ')");
  });

  /* BUILT OVER THE WHOLE BOOK, which is the trap: a sibling who paid outside
     the exported period is still part of the tenancy, and a "Joint with"
     computed from the filtered rows would quietly drop them. The two maps
     beside it are built that way for the same reason. */
  it('and is built over the whole book, not the filtered rows', () => {
    const block = SRC.slice(SRC.indexOf('const tenancyRefs = new Map'), SRC.indexOf('const tenancyRefs = new Map') + 600);
    expect(block).toContain('for (const a of wholeBook) {');
    expect(block).toContain('tenancyRefs.set(a.tenancyId,');
  });
});

describe('the League export', () => {
  it('drops Route for a customer and keeps it for opndoor', () => {
    expect(SRC).toContain("(forCustomer ? [] : [{ header: 'Route', type: 'text' }])");
  });

  it('drops "Agency or supplier" from their referrer board', () => {
    expect(SRC).toContain("return forCustomer ? [first, ...core] : [first, { header: 'Agency or supplier', type: 'text' }, ...core];");
  });

  /* THE AGENCY COLUMN SURVIVES on their Branches sheet: a branch row still has
     to say which of THEIR agencies it belongs to, which is about their
     structure rather than about our rails. */
  it('but keeps the Agency column on their Branches sheet', () => {
    expect(SRC).toContain("(forCustomer\n        ? [{ header: 'Agency', type: 'text' }]");
    expect(SRC).toContain("view === 'branch' ? (forCustomer ? [sub] : [sub, route])");
  });
});
