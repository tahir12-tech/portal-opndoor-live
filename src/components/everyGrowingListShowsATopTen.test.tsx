/* THE SWEEP: WHICH LISTS ON REPORTING AND HOME GROW WITH THE ESTATE.
 *
 * Matt, 2026-10-03, verbatim: "Reporting, 'Every customer' table: show the top
 * 10 by the chosen measure, with the search still finding any customer, and a
 * 'View all N customers' link to League with the same period and filter. Same
 * for any other list on Reporting or Home that grows with the number of
 * agencies."
 *
 * THE AUDIT, every list on the two pages, sorted into the two kinds:
 *
 *   FIXED LENGTH, so out of scope
 *     Home's four queue tiles, and its Direct signups stages
 *     Reporting's funnel, its KPI row and its Operational health row
 *     the monthly trend (twelve months, always)
 *
 *   ONE ROW PER PARTY, so in scope
 *     Volume by branch / agency / referrer / supplier  top 10 + "Top N of M"
 *                                                      + View all -> League
 *     Every customer                                   done today
 *     Agent commission settlement (Reporting and ops
 *       Home, one payee per agency)                    top 5 + "View all N
 *                                                      payees" disclosure
 *     Commission statement payees                      WAS UNBOUNDED. One row
 *                                                      per agency, group,
 *                                                      branch and supplier
 *                                                      owed anything in the
 *                                                      month, all of them,
 *                                                      every month.
 *
 *   PER SUPPLIER, not per agency: Commission by route and the supplier
 *     settlement list. A supplier count is single digits and stays that way;
 *     these are left alone and named here so the next reader knows they were
 *     looked at.
 *
 * SO THE ONE FINDING IS THE STATEMENT PAYEE LIST, which is also the one where
 * the length hurts most: it is the table somebody opens to find out who is
 * owed the most, and that row was at the top with the rest of the estate
 * underneath it.
 *
 * NO LEAGUE LINK ON THAT ONE, deliberately: the League ranks what each party
 * SOLD, and this is what each party is OWED for one month. The search is what
 * reaches a named payee, and Show all is the way to the rest.
 *
 * AND ONE THING LEFT ALONE, reported rather than changed: Home's "Awaiting a
 * decision" table takes the first 8 applications and states no count, so it
 * does stop silently -- but it grows with APPLICATIONS, not with agencies,
 * which is not what Matt asked about. Flagging it rather than widening the
 * instruction myself.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const STATEMENT = read('src/components/CommissionStatement.tsx');
const CUSTOMERS = read('src/components/CustomersTable.tsx');
const DASH = read('src/pages/Dashboard/Dashboard.tsx');
const FINANCE = read('src/pages/Home/FinanceSurfaces.tsx');

describe('the statement payee list', () => {
  it('shows ten, not the whole estate', () => {
    expect(STATEMENT).toContain('const TOP_PAYEES = 10;');
    expect(STATEMENT).toContain('matchingPayees.slice(0, TOP_PAYEES)');
  });

  it('ordered by what each payee is owed, which is the only measure it has', () => {
    expect(STATEMENT).toContain('b.total - a.total || a.payeeName.localeCompare(b.payeeName)');
  });

  it('says it is showing ten of more, rather than stopping quietly', () => {
    expect(STATEMENT).toContain('Top ${listed.length} by amount owed, of ${matchingPayees.length}');
  });

  it('and offers the rest', () => {
    expect(STATEMENT).toContain('onClick={() => setShowAllPayees(true)}');
    expect(STATEMENT).toContain('Show all {matchingPayees.length}');
  });

  /* THE SEARCH REACHES ANYBODY, in or out of the ten, which is what makes a
     capped table trustworthy for "is X in here". */
  it('while a search shows everything it found', () => {
    expect(STATEMENT).toContain('showAllPayees || searchingPayees ? matchingPayees');
  });
});

describe('the lists that already conformed', () => {
  it('the volume charts cap at ten and say so', () => {
    expect(DASH).toContain('const countLine = total > TOP_N ? `Top ${TOP_N} of ${total}` : `${total} total`;');
  });

  it('and link out to the League carrying the period and the measure', () => {
    expect(DASH).toContain('to={leagueLink(key, period.id, measure[key])}');
  });

  it('the Every customer table caps at ten by the chosen measure', () => {
    expect(CUSTOMERS).toContain('const TOP_N = 10;');
    expect(CUSTOMERS).toContain('matching.slice(0, TOP_N)');
  });

  /* ONE PAYEE PER AGENCY, capped at five behind a "View all N payees"
     disclosure since before this instruction. Five rather than ten, and left
     at five: it is a disclosure rather than a truncation, it already states
     the full count, and renumbering it would be a change with no report
     behind it. */
  it('and both copies of the agent settlement cap with the count stated', () => {
    for (const [where, src] of [['Reporting', DASH], ['ops Home', FINANCE]] as const) {
      expect(src, where).toContain('agentSettlement.payees.slice(0, 5)');
      expect(src, where).toContain("View all {countOf(agentSettlement.payees.length, 'payee')}");
    }
  });
});
