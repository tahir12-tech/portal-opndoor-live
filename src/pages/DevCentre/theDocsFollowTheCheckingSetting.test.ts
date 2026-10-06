/* =====================================================================
   THE DEV CENTRE DOCS DESCRIBE THE JOURNEY THIS ORGANISATION GETS.

   Matt (dj): "Make the Dev Centre's API documentation and Getting
   started follow the supplier's checking setting: show the journey,
   statuses and webhook events that apply to their current setting
   ... with the others available under 'If your checking setting
   changes'. State that each application keeps the setting in force
   when it was created, so changing it never changes applications
   already sent. Admins viewing a supplier's Dev Centre see that
   supplier's version."

   =====================================================================
   WHY DOCS MATTER MORE HERE THAN GUIDES DO
   =====================================================================

   A guide that describes the wrong journey misleads somebody. Docs
   that describe the wrong journey make them write code that breaks.
   An integrator on "accepts as sent" who builds a wait state around
   `application.decision` waits for an event that will never arrive;
   one on "opndoor checks" who does not build for it drops a status
   their applications really pass through.

   THE THREE JOURNEYS ARE ASSERTED AS DATA, not as rendered prose,
   because the risk is a wrong FACT rather than a clumsy sentence: the
   wrong status list or the wrong event list is what costs somebody a
   day.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JOURNEY_BY_MODE } from './CheckingJourney';
import { REFERENCING_MODES } from '@/data';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('every checking setting has a journey', () => {
  /* ONE PER MODE AND NO MORE. A mode added to the product without one
     here would render nothing at all, so this is the guard that makes
     the panel safe to extend. */
  it('and exactly the modes the product has', () => {
    expect(Object.keys(JOURNEY_BY_MODE).sort()).toEqual(REFERENCING_MODES.map((m) => m.id).sort());
  });

  it.each(REFERENCING_MODES.map((m) => [m.id, m.choice] as const))(
    '%s has statuses, events and a warning', (id) => {
      const j = JOURNEY_BY_MODE[id];
      expect(j.statuses.length).toBeGreaterThan(1);
      expect(j.events.length).toBeGreaterThan(1);
      expect(j.flow.length).toBeGreaterThan(40);
      expect(j.watch.length).toBeGreaterThan(40);
    });
});

describe('and the journeys genuinely differ', () => {
  /* THE WHOLE POINT. Three identical journeys would satisfy every
     structural assertion above and tell a developer nothing. */
  it('straight-to-payment has no decision step; the other two do', () => {
    expect(JOURNEY_BY_MODE.pre_referenced_open.statuses).not.toContain('referencing');
    expect(JOURNEY_BY_MODE.pre_referenced_screened.statuses).toContain('referencing');
    expect(JOURNEY_BY_MODE.opndoor_referenced.statuses).toContain('referencing');
  });

  it('and only the two with a decision emit a decision event', () => {
    expect(JOURNEY_BY_MODE.pre_referenced_open.events).not.toContain('application.decision');
    expect(JOURNEY_BY_MODE.pre_referenced_screened.events).toContain('application.decision');
    expect(JOURNEY_BY_MODE.opndoor_referenced.events).toContain('application.decision');
  });

  /* THE TRAP THAT COSTS MONEY. On "opndoor checks" the tenant pays
     TWICE and only the second is the guarantee fee. An integration
     that treats the first as application.paid marks applications paid
     that are not. */
  it('and the two-payment setting warns about the two payments', () => {
    expect(JOURNEY_BY_MODE.opndoor_referenced.watch).toMatch(/two payments/i);
    expect(JOURNEY_BY_MODE.opndoor_referenced.watch).toContain('application.paid');
  });

  it('while the no-decision setting warns not to wait for one', () => {
    expect(JOURNEY_BY_MODE.pre_referenced_open.watch).toMatch(/decision/i);
  });
});

describe('the panel', () => {
  const src = read('src/pages/DevCentre/CheckingJourney.tsx');

  /* MATT ASKED FOR THIS SENTENCE IN AS MANY WORDS, and it is the one
     a developer otherwise discovers by changing the setting, testing
     against an old application and concluding nothing happened. */
  it('states that an application keeps the setting it was created under', () => {
    expect(src).toContain('keeps the setting that was in force when it was created');
    expect(src).toContain('never changes applications already sent');
  });

  it('and puts the other two behind "If your checking setting changes"', () => {
    expect(src).toContain('If your checking setting changes');
  });

  /* UNRESOLVED SHOWS ALL THREE rather than picking one. A developer
     shown the wrong journey writes the wrong code; a developer shown
     three and told to check is merely inconvenienced. */
  it('and shows all three where the setting has not resolved', () => {
    expect(src).toContain('because yours has not resolved');
  });
});

describe('both tabs use it, for the organisation being viewed', () => {
  it.each([
    ['Getting started', 'src/pages/DevCentre/GettingStarted.tsx'],
    ['the API reference', 'src/pages/DevCentre/ApiDocsPanel.tsx'],
  ])('%s renders the journey', (_label, path) => {
    const s = read(path);
    expect(s).toContain('<CheckingJourney mode={mode ?? null}');
  });

  /* "ADMINS VIEWING A SUPPLIER'S DEV CENTRE SEE THAT SUPPLIER'S
     VERSION." Reading the session here would give an admin their own
     non-existent setting, so the mode is resolved from the partner
     being viewed and passed down. */
  it('and the Dev Centre resolves it from the partner being viewed', () => {
    const s = read('src/pages/DevCentre/DevCentre.tsx');
    expect(s).toContain('const docsMode = getPartner(isAdmin ? (partnerId || ALL_PARTNERS) : partnerScope)?.referencingMode ?? null;');
    expect(s).toContain('<GettingStarted mode={docsMode}');
    expect(s).toContain('<ApiDocsPanel mode={docsMode}');
  });
});
