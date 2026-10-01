/* THE LEAGUE INTRO NAMES THE BOARDS ON THE PAGE, not three boards in general.

   The sentence was hardcoded: "Every agency, branch and referrer ranked in
   full." The tabs have been filtered by scope for some time, so a Regent
   Director read a promise of three boards over a page showing one, in vocabulary
   the product had already stopped using.

   Tested against the pure helper rather than the rendered page because the rule
   is a sentence built from a list, and a DOM test of it would need a session, a
   hydrated book and a period to assert the same string. */
import { describe, expect, it } from 'vitest';
import { introFor } from './League';
import type { LeagueView } from '@/data';

const tab = (id: LeagueView, label: string) => ({ id, label });
const ALL = [tab('agency', 'Agencies'), tab('branch', 'Branches'), tab('referrer', 'Negotiators')];

describe('the league intro', () => {
  /* REGENT: one agency, one office, so one board. The sentence a Director reads
     on the morning of go-live. */
  /* "EVERYONE WHO HAS REFERRED", changed 2026-10-01 on Matt's word: a
     Director and a Manager refer too and are on this board, so naming it
     after the junior level described the wrong set, and left out the
     people most likely to be reading it. */
  it('names one board when there is one', () => {
    expect(introFor([tab('referrer', 'Negotiators')])).toBe('Everyone who has referred, ranked in full.');
  });

  it('names all three for a group that has all three', () => {
    expect(introFor(ALL)).toBe('Every agency, branch and negotiator ranked in full.');
  });

  it('names two without a stray comma', () => {
    expect(introFor([tab('branch', 'Branches'), tab('referrer', 'Negotiators')]))
      .toBe('Every branch and negotiator ranked in full.');
  });

  /* THE OLD WORD IS GONE. "referrer" is the role name the level replaced, and
     this sentence was the last place on the page still saying it. */
  it('never says referrer', () => {
    for (const tabs of [ALL, [tab('referrer', 'Negotiators')], []]) {
      expect(introFor(tabs)).not.toMatch(/referrer/i);
    }
  });

  /* An empty tab list should not produce "Every  ranked in full." A scope with
     nothing to rank is a real state on a brand new agency. */
  it('says something sensible when there is nothing to rank', () => {
    expect(introFor([])).toBe('Nothing to rank in this scope yet.');
  });
});
