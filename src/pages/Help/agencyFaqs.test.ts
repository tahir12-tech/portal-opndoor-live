/* THE AGENCY FAQ SET.

   An agency on our own estate was reading the twelve answers written for a
   supplier: adding agencies on the fly, white-labelling, "the partner earns 25%
   of that fee", and the guarantee fee stated flatly as one month's rent. Three
   of those describe a product Regent is not using and the fourth is wrong for
   every agency that has negotiated a basis.

   EIGHT ANSWERS, ONE SET, ruled 27 September. Not three near-identical copies
   differing by a paragraph: three documents are three things to keep in step,
   and a reader at any level should be able to send a colleague the same link.
   The only level-specific content is INSIDE the "who sees what" answer, which
   describes all three levels in one place.

   The sweep below is the part worth automating. The words are easy to get right
   once and easy to reintroduce later, by somebody editing an answer who does not
   know the rule, and the failure is silent: a sentence about a partner reads
   perfectly well and is simply about somebody else. */
import { describe, expect, it } from 'vitest';
import { HELP_SEED } from '@/data/mock/help';
import { mayOpenFaq, type HelpViewer } from './Help';

const agency = HELP_SEED.faqs.filter((f) => f.rail === 'agency');
const supplier = HELP_SEED.faqs.filter((f) => f.rail === 'supplier');

const DIRECTOR: HelpViewer = { role: 'management', seesCommission: true, agency: true, admin: false };
const MANAGER: HelpViewer = { role: 'management', seesCommission: false, agency: true, admin: false };
const NEGOTIATOR: HelpViewer = { role: 'referrer', seesCommission: false, agency: true, admin: false };
const SUPPLIER: HelpViewer = { role: 'management', seesCommission: true, agency: false, admin: false };

const AGENCY_LEVELS_ALL = [DIRECTOR, MANAGER, NEGOTIATOR];
const text = (f: { q: string; a: string }) => `${f.q} ${f.a}`;

describe('the set itself', () => {
  /* (dt) NINE IN THE CATALOGUE, EIGHT TO ANY READER. af5 answers
     "what does the tenant pay" for the two journeys with no
     application fee, af5b for the one where opndoor checks and the
     tenant also pays GBP 20. They are alternatives on the `modes`
     axis, so exactly one of the pair ever reaches a reader -- which
     the next test asserts per journey, and which is the assertion
     that actually carries the rule.

     THE RULE WAS NEVER ABOUT THE NUMBER EIGHT. It is "one set, shared
     by all three levels": per-LEVEL copies are the thing not to
     build. A per-JOURNEY answer is a different axis and a different
     question, because the journeys genuinely differ. */
  it('is eight questions, with a variant per journey where the journey differs', () => {
    const ALL = ['opndoor_referenced', 'pre_referenced_open', 'pre_referenced_screened'];
    // Eight distinct QUESTIONS, however many answers there are to them.
    const questions = new Set(agency.map((f) => f.q.toLowerCase().trim()));
    expect(questions.size).toBe(8);
    // And every question is answered exactly once on every journey:
    // no reader meets two answers to one question, and none meets none.
    for (const q of questions) {
      const answers = agency.filter((f) => f.q.toLowerCase().trim() === q);
      for (const mode of ALL) {
        const live = answers.filter((f) => !f.modes || f.modes.includes(mode as never));
        expect(live, `"${q}" on ${mode}`).toHaveLength(1);
      }
    }
  });

  it('covers the eight things that were asked for', () => {
    const qs = agency.map((f) => f.q.toLowerCase()).join(' | ');
    for (const topic of [
      'what is this portal for',
      'guarantor',
      'sent, paid and deed issued',
      'how do i refer',
      'what does the tenant pay',
      'who sees what',
      'tenancy start date',
      'find an application',
    ]) {
      expect(qs, `no answer covers "${topic}"`).toContain(topic);
    }
  });

  it('gives every answer a body, because an empty one is worse than a missing one', () => {
    for (const f of agency) expect(f.a.trim().length, f.q).toBeGreaterThan(80);
  });

  it('uses ids that cannot collide with the supplier set', () => {
    const ids = new Set(HELP_SEED.faqs.map((f) => f.id));
    expect(ids.size).toBe(HELP_SEED.faqs.length);
  });
});

describe('one set, shared by all three levels', () => {
  /* THE RULING, asserted directly. Per-level copies are the thing not to build,
     so the test that matters is that all three readers get the same eight. */
  it('shows every level the same eight answers, on every journey', () => {
    for (const mode of ['pre_referenced_open', 'pre_referenced_screened', 'opndoor_referenced'] as const) {
      const seen = AGENCY_LEVELS_ALL.map((v) =>
        agency.filter((f) => mayOpenFaq(f, { ...v, mode })).map((f) => f.id));
      expect(seen[0], `journey ${mode}`).toHaveLength(8);
      expect(seen[1]).toEqual(seen[0]);
      expect(seen[2]).toEqual(seen[0]);
    }
  });

  /* Which means no answer may be gated. A needsCommission flag on one of these
     would fork the set by level through the back door. */
  it('gates none of them on the commission bit', () => {
    for (const f of agency) expect(f.needsCommission, f.q).toBeFalsy();
  });

  it('describes all three levels inside the who-sees-what answer', () => {
    const who = agency.find((f) => f.q.toLowerCase().includes('who sees what'));
    expect(who).toBeTruthy();
    for (const level of ['Negotiator', 'Manager', 'Director']) {
      expect(who!.a, `the who-sees-what answer does not mention ${level}`).toContain(level);
    }
  });
});

describe('the agency set replaces the supplier set rather than joining it', () => {
  it('shows an agency reader the eight and none of the twelve, on every journey', () => {
    for (const mode of ['pre_referenced_open', 'pre_referenced_screened', 'opndoor_referenced'] as const) {
      const shown = HELP_SEED.faqs.filter((f) => mayOpenFaq(f, { ...DIRECTOR, mode }));
      expect(shown, `journey ${mode}`).toHaveLength(8);
      expect(shown.every((f) => f.rail === 'agency')).toBe(true);
    }
  });

  it('leaves a supplier reader the twelve they had', () => {
    const shown = HELP_SEED.faqs.filter((f) => mayOpenFaq(f, SUPPLIER));
    expect(shown.filter((f) => f.rail === 'supplier')).toHaveLength(12);
    expect(shown.some((f) => f.rail === 'agency')).toBe(false);
  });
});

describe('the sweep', () => {
  /* THE FOUR BANNED THINGS, on the agency set only. The supplier set keeps
     "partner" because a supplier IS one, and keeps its own fee wording. */

  /* AN EMAIL ADDRESS IS NOT THE WORD. `partners@opndoor.co` is the real
     address agency staff are given in the topbar help menu, and it is the
     one an answer should hand them rather than a vaguer "contact opndoor".
     Matt's sweep was about calling a supplier a partner to a reader who is
     an agency, which an address does not do. Stripped before the check so
     the rule keeps applying to every other word in the sentence. */
  const prose = (f: { q: string; a: string }) => text(f).toLowerCase().replace(/\S+@\S+/g, '');

  it('never says partner, which is our word for a supplier', () => {
    for (const f of agency) expect(prose(f), f.q).not.toContain('partner');
  });

  /* FAQ 9 AND THE RPC MUST AGREE, because this is the one answer a reader
     acts on before they find out the server disagrees.

     Matt, 2026-10-04: "agency and supplier users can change a start date only
     before the tenancy starts (signed or not); after the start date, only
     Opndoor staff can ... Update FAQ 9 to match."

     BOTH RAILS, because the answer is duplicated for the supplier and agency
     audiences and the previous version of it drifted apart exactly that way.
     The old text promised that management could change a signed deed with
     "no deadline", which is now false after the start date, so the assertion
     names the thing that must not come back as well as the thing that must
     be there. */
  it('FAQ 9 states the start date as the boundary, on both rails', () => {
    const nine = HELP_SEED.faqs.filter((f) => /tenancy start date be changed/i.test(f.q));
    expect(nine).toHaveLength(2);
    for (const f of nine) {
      const a = f.a.toLowerCase();
      expect(a, `${f.rail}: must say opndoor alone can change it after the start`)
        .toContain('from the start date onwards, only opndoor can change it');
      expect(a, `${f.rail}: must say the deed state no longer decides`)
        .toContain('whether the deed has been signed');
      expect(a, `${f.rail}: the old no-deadline promise is false after the start`)
        .not.toContain('there is <b>no deadline</b>');
    }
  });

  /* The fee basis is per agreement: Regent's is 3 weeks for a single tenant and
     5 shared between joint ones, and the next agency's is not. Any figure or
     fixed basis in this copy is wrong for somebody.

     (dt) THE GBP 20 IS THE ONE EXCEPTION, and it is an exception for
     the exact reason the rule exists. The rule bans a figure that
     VARIES BY AGREEMENT from being stated as though it were fixed.
     The eligibility check fee does not vary: Matt settled it as GBP 20
     per tenant, the same for everybody who pays it, and the whole
     point of writing this copy was that an agency opndoor checks for
     was never told the figure. Excluded by NAME rather than by
     loosening the pattern, so the guarantee fee is still protected. */
  it('states no fee figure and no fixed basis', () => {
    for (const f of agency) {
      // The eligibility fee is fixed and is allowed to be named; the
      // guarantee fee is not. Removing only "£20" keeps every other
      // figure banned, including a second one in the same answer.
      const a = text(f).toLowerCase().replace(/£\s?20\b/g, '[eligibility fee]');
      expect(a, f.q).not.toContain("one month's rent");
      expect(a, f.q).not.toContain('one month of rent');
      expect(a, f.q).not.toMatch(/\b\d+\s*weeks?['’]? rent\b/);
      expect(a, f.q).not.toMatch(/£\s?\d/);
    }
  });

  it('states no commission percentage, for any level', () => {
    for (const f of agency) {
      expect(text(f), f.q).not.toMatch(/\b\d+(\.\d+)?%/);
      expect(text(f).toLowerCase(), f.q).not.toContain('commission');
    }
  });

  it('uses no em dashes', () => {
    for (const f of agency) expect(text(f), f.q).not.toContain('—');
  });

  /* Nothing from the other rail's world, which is most of what made the twelve
     wrong for Regent rather than merely verbose. */
  it('says nothing about adding agencies or white-labelling', () => {
    for (const f of agency) {
      const a = text(f).toLowerCase();
      expect(a, f.q).not.toContain('white-label');
      expect(a, f.q).not.toContain('on the fly');
    }
  });
});

describe('the supplier set is untouched', () => {
  it('is still the same twelve', () => {
    expect(supplier).toHaveLength(12);
  });
});
