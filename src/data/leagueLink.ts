/* THE LINK FROM REPORTING TO THE LEAGUE, WRITTEN IN ONE PLACE.
 *
 * Matt, 2026-10-03, verbatim: "Reporting's 'View all' links (Volume by
 * branch, agency, referrer) open League on its default period instead of
 * the period selected on Reporting. Carry the period (and the chosen
 * measure, e.g. Referral count) across in the link, so League shows the
 * same rows."
 *
 * The link carried `view` and nothing else, so a reader looking at
 * September by referral count pressed "View all" and landed on the last
 * 30 days ranked by fees: a different board, with different names at the
 * top, reached by a control that says it is showing the same thing in
 * full.
 *
 * TWO VOCABULARIES, ONE TRANSLATION. Reporting picks a MEASURE
 * ('value' | 'count' | 'conv'); the League ranks by a COLUMN ('fees',
 * 'refs', 'conv', 'deed'). They are not the same words, and the writer
 * and the reader of this link sit in different files, so the mapping
 * lives here rather than being spelled out at each end where a rename
 * would silently break the link rather than fail the build.
 */
import type { LeagueView } from './types';

/** What a Reporting chart is measuring. */
export type ChartMeasure = 'value' | 'count' | 'conv';

/** What a League board is ranked by. `deed` has no chart measure; it is
    here because the League's own "Rank by" control offers it, so a link
    written by hand (or copied from the address bar) still reads. */
export type LeagueRank = 'fees' | 'refs' | 'conv' | 'deed';

const RANK_FOR: Record<ChartMeasure, LeagueRank> = {
  value: 'fees',
  count: 'refs',
  conv: 'conv',
};

/** The "View all" target for a Reporting chart, carrying what the reader
    is looking at: the board, the period and the measure. */
export function leagueLink(view: LeagueView, periodId: string, measure: ChartMeasure): string {
  return leagueLinkByRank(view, periodId, RANK_FOR[measure]);
}

/** The same link for a caller that already thinks in the League's own
    columns rather than in a chart's measures -- the Every customer table,
    whose measures include Deeds issued, which no chart offers and which the
    League has had as a sortable column all along. */
export function leagueLinkByRank(view: LeagueView, periodId: string, rank: LeagueRank): string {
  const params = new URLSearchParams({ view, period: periodId, rank });
  return `/league?${params.toString()}`;
}

/** The rank asked for by a link, or null when none was asked for or the
    word is not one the League knows. Null means "the board's own
    default", never a guess. */
export function rankFromParam(raw: string | null): LeagueRank | null {
  return raw === 'fees' || raw === 'refs' || raw === 'conv' || raw === 'deed' ? raw : null;
}
