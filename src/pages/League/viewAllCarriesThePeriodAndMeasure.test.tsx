/* "VIEW ALL" SHOWED A DIFFERENT TABLE FROM THE ONE IT SAT UNDER.
 *
 * Matt, 2026-10-03, verbatim: "Reporting's 'View all' links (Volume by
 * branch, agency, referrer) open League on its default period instead of the
 * period selected on Reporting. Carry the period (and the chosen measure,
 * e.g. Referral count) across in the link, so League shows the same rows.
 * Deploy to dev and check there."
 *
 * The link was `/league?view=${key}` and nothing else, so a reader looking at
 * Last 12 months ranked by referral count pressed a control that says "view
 * ALL of this" and got the last 30 days ranked by fees: different rows, in a
 * different order, under a heading that claims to be the same board.
 *
 * TWO VOCABULARIES. Reporting picks a MEASURE ('value' | 'count' | 'conv');
 * the League ranks by a COLUMN ('fees' | 'refs' | 'conv' | 'deed'). The
 * translation is in data/leagueLink.ts so that neither end spells out the
 * other's words, and the writer and the reader are tested against the same
 * function rather than against each other's string literals.
 *
 * AND THE PERIOD IS STILL THE PAGE'S OWN. League deliberately does not
 * inherit the dashboard's period (filters must not carry between pages).
 * A link that NAMES a period is the reader asking for it, which is the
 * difference between a link and a leak.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { App } from '@/App';
import { leagueLink, rankFromParam } from '@/data/leagueLink';

afterEach(cleanup);

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('the link Reporting writes', () => {
  it('names the board, the period and the measure', () => {
    expect(leagueLink('branch', 'last12m', 'count')).toBe('/league?view=branch&period=last12m&rank=refs');
  });

  it('translates fees collected and conversion too', () => {
    expect(leagueLink('agency', 'lastmonth', 'value')).toBe('/league?view=agency&period=lastmonth&rank=fees');
    expect(leagueLink('agency', 'lastmonth', 'conv')).toBe('/league?view=agency&period=lastmonth&rank=conv');
  });

  /* THE RANK IS READ BACK, NOT GUESSED. An absent or unknown word means
     "the board's own default", because a link written by hand is not a
     reason to rank a table by something nobody asked for. */
  it('and reads back only words the League knows', () => {
    expect(rankFromParam('refs')).toBe('refs');
    expect(rankFromParam('deed')).toBe('deed');
    expect(rankFromParam(null)).toBeNull();
    expect(rankFromParam('fees collected')).toBeNull();
  });
});

describe('the Reporting end', () => {
  const DASH = read('src/pages/Dashboard/Dashboard.tsx');

  it('builds the link from the helper, with the period and the chart measure', () => {
    expect(DASH).toContain('to={leagueLink(key, period.id, measure[key])}');
  });

  it('and no longer writes a bare view link', () => {
    expect(DASH).not.toContain('/league?view=${key}');
  });
});

describe('the League end', () => {
  const LEAGUE = read('src/pages/League/League.tsx');

  it('takes its opening period from the link on both boards', () => {
    expect(LEAGUE).toContain('useLeaguePeriod(params.get(\'period\'))');
    expect(LEAGUE).toContain('useLeaguePeriod(refParams.get(\'period\'))');
  });

  it('and its opening rank, falling back to fees', () => {
    expect(LEAGUE).toContain("rankFromParam(params.get('rank')) ?? 'fees'");
  });
});

/* DRAWN, because the two ends only matter where they meet. */
function open(path: string, role = 'superadmin') {
  localStorage.setItem('grp_role', role);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider><ToastProvider><App /></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
}

describe('opened', () => {
  it('a link with no period still opens on the League\'s own default', () => {
    const { container } = open('/league?view=agency');
    expect(container.querySelector('.eyebrow')?.textContent).toContain('Last 30 days');
  });

  it('and a link that names one opens on that period instead', () => {
    const { container } = open(leagueLink('agency', 'last12m', 'count'));
    expect(container.querySelector('.eyebrow')?.textContent).toContain('Last 12 months');
  });

  it('and the named measure is the ranked column, not fees', () => {
    const { container } = open(leagueLink('agency', 'last12m', 'count'));
    const ranked = container.querySelector('thead th.is-sort');
    expect(ranked?.textContent).toContain('Referrals');
  });

  it('where with no measure the board opens on fees, as it always did', () => {
    const { container } = open('/league?view=agency');
    const ranked = container.querySelector('thead th.is-sort');
    expect(ranked?.textContent).toContain('Fees collected');
  });
});
