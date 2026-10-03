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
/* THE TAB IS CALLED "Referrers" SINCE 2026-10-02, which is the rename this
   file's own assertions were written before. The label is not what `introFor`
   reads -- it maps the tab's id -- but a fixture naming it the old thing is a
   fixture that tells the next reader the wrong story. */
const ALL = [tab('agency', 'Agencies'), tab('branch', 'Branches'), tab('referrer', 'Referrers')];

describe('the league intro', () => {
  /* REGENT: one agency, one office, so one board. The sentence a Director reads
     on the morning of go-live. */
  /* "EVERYONE WHO HAS REFERRED", changed 2026-10-01 on Matt's word: a
     Director and a Manager refer too and are on this board, so naming it
     after the junior level described the wrong set, and left out the
     people most likely to be reading it. */
  it('names one board when there is one', () => {
    expect(introFor([tab('referrer', 'Referrers')])).toBe('Everyone who has referred, ranked in full.');
  });

  it('names all three for a group that has all three', () => {
    expect(introFor(ALL)).toBe('Every agency, branch and referrer ranked in full.');
  });

  it('names two without a stray comma', () => {
    expect(introFor([tab('branch', 'Branches'), tab('referrer', 'Referrers')]))
      .toBe('Every branch and referrer ranked in full.');
  });

  /* =====================================================================
     MATT REVERSED THIS, AND THE REVERSAL IS THE POINT OF THE COMMENT.

     This file used to assert `not.toMatch(/referrer/i)` under the heading
     "THE OLD WORD IS GONE", because on 2026-10-01 the agency ladder's three
     levels were being adopted everywhere and "referrer" was the role name
     they replaced.

     Then, 2026-10-02: "call it 'Referrers' on screen and in the export, since
     it includes Directors and supplier staff" -- so the TAB was renamed back.
     And 2026-10-03: "League description: 'Every agency, branch, referrer and
     supplier ranked in full.' Sweep the portal, emails, exports and help for
     any remaining 'negotiator' used to mean a referrer generally (keep it
     only where it's the Negotiator level)."

     THE TWO INSTRUCTIONS ARE NOT IN CONFLICT, which took reading twice. The
     LEVEL is Negotiator and stays Negotiator, on the ladder, in the invite
     dialog and on a person's row. The POPULATION on this board is everybody
     who referred, which includes two levels above Negotiator and a supplier's
     staff who are on no ladder at all. So the level word was wrong here, and
     the sentence that banned the general word had it backwards.

     The sweep's own finding was this file's subject: the tab was renamed on
     the 2nd and `introFor` was not, so the page called one board two things
     two lines apart.
     ===================================================================== */
  it('says referrer, and never the level word', () => {
    expect(introFor(ALL)).toMatch(/referrer/);
    for (const tabs of [ALL, [tab('referrer', 'Referrers')], []]) {
      expect(introFor(tabs)).not.toMatch(/negotiator/i);
    }
  });

  /* AND WITH ALL FOUR BOARDS, which is Matt's sentence exactly. Only Opndoor
     sees the Suppliers tab, so this is the admin's reading of the page. */
  it('is Matt\u2019s own sentence when every board is shown', () => {
    expect(introFor([...ALL, tab('supplier', 'Suppliers')]))
      .toBe('Every agency, branch, referrer and supplier ranked in full.');
  });

  /* An empty tab list should not produce "Every  ranked in full." A scope with
     nothing to rank is a real state on a brand new agency. */
  it('says something sensible when there is nothing to rank', () => {
    expect(introFor([])).toBe('Nothing to rank in this scope yet.');
  });
});
