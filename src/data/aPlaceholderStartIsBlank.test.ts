/* =====================================================================
   A PLACEHOLDER TENANCY START PRINTS AS NOTHING.

   Matt, 2026-10-03: "Application export: GR-20626 (unfinished, no tenancy
   details given) shows Tenancy start date 04/10/2026. Leave Tenancy start
   blank until the tenant has given one; check the screen and other exports
   for the same."

   WHERE THE DATE CAME FROM, measured on dev rather than guessed:
   `create_direct_application` inserts `coalesce(p_tenancy_start, current_date
   + 30)`, GR-20626 was created on 2026-09-04, and 04/09 + 30 days is 04/10.
   So it is not bad data; it is a column that cannot be null holding a value
   nobody typed.

   THE RULE IS THE STEP, not a flag: the rent and the tenancy start are
   collected on one screen, in one save, so a DRAFT whose rent is still zero
   has not reached that step. Every other status has been through
   `assert_application_complete`, which refuses a submit with no rent.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tenancyStartFor, tenancyStartGiven } from './tenancyStartGiven';

describe('whether the tenant has given a tenancy start', () => {
  /* GR-20626 EXACTLY: a direct-rail draft, no tenancy details, the seeded
     date sitting in the column. */
  it('no on an untouched draft', () => {
    expect(tenancyStartGiven({ status: 'draft', rentNum: 0 })).toBe(false);
  });

  it('yes once the rent is there, which is the same save', () => {
    expect(tenancyStartGiven({ status: 'draft', rentNum: 1750 })).toBe(true);
  });

  /* EVERY OTHER STATUS IS A SUBMITTED APPLICATION, and the completeness
     trigger refuses a submit with no rent, so the date is always real. The
     rent is not even consulted. */
  it('yes on anything that has been submitted, whatever the rent says', () => {
    for (const status of ['sent', 'paid', 'deed', 'withdrawn', 'expired', 'declined']) {
      expect(tenancyStartGiven({ status, rentNum: 0 }), status).toBe(true);
    }
  });

  // A row with neither field, which is what a partial shape reads as.
  it('yes when the status is unknown, which is the safe direction', () => {
    expect(tenancyStartGiven({})).toBe(true);
  });
});

describe('what the callers print', () => {
  it('passes the value through when it was given', () => {
    expect(tenancyStartFor({ status: 'sent', rentNum: 1750 }, '04/10/2026')).toBe('04/10/2026');
  });

  it('and nothing at all when it was not', () => {
    expect(tenancyStartFor({ status: 'draft', rentNum: 0 }, '04/10/2026')).toBeNull();
  });
});

describe('the call sites Matt asked me to check', () => {
  /* "check the screen and other exports for the same" is the half of the
     instruction a predicate on its own does not satisfy: the fix is only real
     where it is called. Read off the source, because the alternative is
     rendering four screens to assert one condition. */
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  it('the applications export', () => {
    expect(read('src/data/exportsService.ts'))
      .toContain("tenancyStartGiven(a) && a.tenancyStart ? dmy(a.tenancyStart) : ''");
  });

  it('the performance export', () => {
    const src = read('src/data/exportsService.ts');
    expect(src).toContain("a.deedAt ? dmy(a.deedAt) : '', tenancyStartGiven(a) && a.tenancyStart ? dmy(a.tenancyStart) : ''");
  });

  it('and the application screen, which says so rather than going blank', () => {
    expect(read('src/pages/ApplicationDetail/ApplicationDetail.tsx'))
      .toContain('{tenancyStartGiven(d) ? fmtLong(currentStart) : <span className="muted">Not given yet</span>}');
  });

  /* THE EXPIRIES FILE IS NOT IN THE LIST, and that is a decision rather than
     an omission: every row in it holds an issued deed, so the placeholder
     cannot reach it. A guard there would be dead code pretending to be care. */
  it('and not the expiries file, whose rows all hold a deed', () => {
    const src = read('src/data/exportsService.ts');
    const line = src.split('\n').find((l) => l.includes('others.sort().join'))!;
    expect(line).toContain("a.tenancyStart ? dmy(a.tenancyStart) : ''");
    expect(line).not.toContain('tenancyStartGiven');
  });
});
