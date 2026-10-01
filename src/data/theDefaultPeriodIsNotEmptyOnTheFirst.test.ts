/* REPORTING AND LEAGUE DO NOT OPEN EMPTY ON THE 1st.
 *
 * Matt, 2026-10-01, verbatim: "Also default League and Reporting to
 * 'Last 30 days' instead of 'This calendar month', so they aren't empty
 * on the 1st of the month."
 *
 * HIS REASON IS THE TEST. A calendar-month default shows a month that is
 * nought days old on the 1st, which is the day the statements go out and
 * the day somebody is most likely to open Reporting to see what went. A
 * rolling thirty days is never empty for a reason that is only about the
 * date.
 *
 * TODAY IS THE 1st, which is how this came up.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_PERIOD, PERIODS } from '@/data/mock/analyticsModel';
import { getSelectedPeriod } from '@/data/analyticsService';

describe('the period both screens open on', () => {
  it('is Last 30 days', () => {
    expect(DEFAULT_PERIOD).toBe('last30');
    expect(PERIODS.find((p) => p.id === DEFAULT_PERIOD)?.label).toBe('Last 30 days');
  });

  /* THE SESSION'S PERIOD IS REPORTING'S, so this is the one that decides
     what Reporting opens on for anybody who has not chosen. */
  it('and that is what an unset session resolves to', () => {
    localStorage.clear();
    expect(getSelectedPeriod().id).toBe('last30');
  });

  /* A CHOICE STILL WINS. The default is for somebody who has not picked;
     it must not override somebody who has. */
  it('while a remembered choice is still honoured', () => {
    localStorage.clear();
    localStorage.setItem('grp_period', 'thismonth');
    expect(getSelectedPeriod().id).toBe('thismonth');
    localStorage.clear();
  });

  /* LEAGUE KEEPS ITS OWN PERIOD STATE, deliberately -- it is independent
     of Reporting's selection -- which is exactly why it could drift to a
     different default. It now reads the same constant. */
  it('and League starts from the same constant rather than its own string', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/pages/League/League.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');
    expect(src).toMatch(/p\.id === DEFAULT_PERIOD/);
    expect(src, 'League has gone back to a hardcoded period').not.toMatch(/p\.id === 'thismonth'/);
  });
});
