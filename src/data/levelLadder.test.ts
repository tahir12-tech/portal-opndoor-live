/* THE LADDER, CLIENT SIDE: you may act only on someone below you.

   This is the lens that decides which buttons a row draws. It is NOT the
   boundary: public.assert_may_act_on_user and the users_level_ladder_guard
   trigger refuse independently, and supabase/tests/the_level_ladder.test.sql is
   where that is proved. A button that cannot work should still not be offered,
   which is what these assertions protect.

   THE TWO RULES ARE DIFFERENT COMPARISONS, and most of this file exists to keep
   them apart:

     the PERSON you act on must be strictly BELOW you   mayActOn
     the LEVEL you hand out may be AT OR BELOW yours    levelsGrantableBy

   so a Director sees all three levels in the invite dialog while being unable to
   touch another Director, and a Manager may grow a peer Manager and then cannot
   act on them. Collapsing the two into one comparison is how the invite dialog
   and the row actions would start disagreeing with each other and with SQL. */
import { describe, expect, it } from 'vitest';
import { levelRank, mayActOn, levelsGrantableBy, type Actor } from './types';
import { otpauthParts } from './authService';

const director: Actor = { id: 'd', role: 'management', seesCommission: true };
const manager: Actor = { id: 'm', role: 'management', seesCommission: false };
const negotiator: Actor = { id: 'n', role: 'referrer', seesCommission: false };
const developer: Actor = { id: 'v', role: 'developer', seesCommission: false };
const admin: Actor = { id: 'a', role: 'superadmin', seesCommission: true };
const opsManager: Actor = { id: 'o', role: 'opndoor_manager', seesCommission: false };

describe('the rungs', () => {
  it('orders opndoor above Director above Manager above Negotiator', () => {
    expect(levelRank('superadmin', true)).toBe(0);
    expect(levelRank('opndoor_manager', false)).toBe(0);
    expect(levelRank('management', true)).toBe(1);
    expect(levelRank('management', false)).toBe(2);
    expect(levelRank('referrer', false)).toBe(3);
  });

  /* A developer holds API keys and is not an agency level, but they are ranked so
     that an agency can still deactivate its own key holders, which it can today.
     Ranking them null would have been the tidier reading of "not on the ladder"
     and would have silently taken that away. They still act on nobody. */
  it('ranks a developer beside a Negotiator rather than nowhere', () => {
    expect(levelRank('developer', false)).toBe(3);
  });
});

describe('who may act on whom', () => {
  /* THE WHOLE MATRIX, because the interesting cases are the diagonal and the
     direction, and a spot check of one pair would miss both. */
  const everyone = [
    ['a Director', director], ['a Manager', manager], ['a Negotiator', negotiator],
  ] as const;

  it('lets each level act on those below it and on nobody else', () => {
    const rows = everyone.map(([an, a]) =>
      everyone.map(([, t]) => (mayActOn(a, { ...t, id: `${t.id}2` }) ? 'y' : '.')).join('') + '  ' + an);
    expect(rows).toEqual([
      '.yy  a Director',    // may act on a Manager and a Negotiator
      '..y  a Manager',     // on a Negotiator only
      '...  a Negotiator',  // on nobody
    ]);
  });

  it('refuses an equal in both directions, which is what "at or above" means', () => {
    expect(mayActOn(manager, { ...director, id: 'x' })).toBe(false);   // upward
    expect(mayActOn(manager, { ...manager, id: 'x' })).toBe(false);    // sideways
    expect(mayActOn(director, { ...director, id: 'x' })).toBe(false);
  });

  /* Matt's report was "as a Manager, Rosa's row shows no actions", Rosa being the
     Director above her. Named here so the report and the assertion are the same
     sentence. */
  it('shows a Manager no action against her own Director', () => {
    expect(mayActOn(manager, director)).toBe(false);
  });

  it('never lets anyone act on themselves, because self is at your own level', () => {
    expect(mayActOn(director, director)).toBe(false);
    expect(mayActOn(admin, admin)).toBe(false);
    // Same person, same id, whatever the level says.
    expect(mayActOn({ id: 'z', role: 'management', seesCommission: true },
                    { id: 'z', role: 'referrer', seesCommission: false })).toBe(false);
  });

  it('puts opndoor staff above all three', () => {
    for (const t of [director, manager, negotiator, developer]) {
      expect(mayActOn(admin, t)).toBe(true);
      expect(mayActOn(opsManager, t)).toBe(true);
    }
  });

  it('does not let an agency level act on opndoor staff', () => {
    expect(mayActOn(director, admin)).toBe(false);
    expect(mayActOn(director, opsManager)).toBe(false);
  });

  it('lets an agency manage its own developer, and the developer manage nobody', () => {
    expect(mayActOn(director, developer)).toBe(true);
    expect(mayActOn(manager, developer)).toBe(true);
    expect(mayActOn(developer, negotiator)).toBe(false);
  });
});

describe('which levels may be handed out', () => {
  const names = (a: Actor) => levelsGrantableBy(a).map((l) => l.level);

  /* AT OR BELOW, and this is the asymmetry with mayActOn. Stated by the ruling as
     "a Manager sees Manager and Negotiator, a Director sees all three". */
  it('offers a Director all three', () => {
    expect(names(director)).toEqual(['Director', 'Manager', 'Negotiator']);
  });

  it('offers a Manager her own level and below, not Director', () => {
    expect(names(manager)).toEqual(['Manager', 'Negotiator']);
  });

  it('offers a Negotiator only Negotiator, though nothing lets them invite', () => {
    expect(names(negotiator)).toEqual(['Negotiator']);
  });

  it('offers opndoor all three', () => {
    expect(names(admin)).toEqual(['Director', 'Manager', 'Negotiator']);
  });

  /* THE PAIR THAT MUST DISAGREE. A Manager may CREATE a peer Manager and may not
     ACT on one. If these two ever agree, one of the two rules has been lost. */
  it('lets a Manager grant a level she could not then act on', () => {
    expect(names(manager)).toContain('Manager');
    expect(mayActOn(manager, { ...manager, id: 'other' })).toBe(false);
  });
});

/* THE AUTHENTICATOR ENTRY SAYS WHO IT IS FOR.

   Without an issuer, GoTrue labels the TOTP entry with the project reference, so
   a person holding accounts on more than one opndoor environment, or any other
   Supabase-backed app, sees a list of indistinguishable six-digit codes against
   opaque strings. Asserted by reading the otpauth URI, because the alternative
   is eyeballing a phone.

   An otpauth URI carries the issuer TWICE, in the path label and in the query,
   and the two can disagree. The Key Uri Format makes the query authoritative. */
describe('the otpauth URI', () => {
  it('carries the issuer and the account, which is the user email', () => {
    const p = otpauthParts('otpauth://totp/opndoor:rosa%40regents.co.uk?secret=ABC&issuer=opndoor');
    expect(p.issuer).toBe('opndoor');
    expect(p.account).toBe('rosa@regents.co.uk');
  });

  it('prefers the query issuer when the label disagrees with it', () => {
    const p = otpauthParts('otpauth://totp/Supabase:rosa%40regents.co.uk?secret=ABC&issuer=opndoor');
    expect(p.issuer).toBe('opndoor');
  });

  it('still finds the account when the label carries no issuer prefix', () => {
    const p = otpauthParts('otpauth://totp/rosa%40regents.co.uk?secret=ABC&issuer=opndoor');
    expect(p.account).toBe('rosa@regents.co.uk');
    expect(p.issuer).toBe('opndoor');
  });

  /* THE STATE THIS EXISTS TO CATCH: no issuer at all, which is what the enrol
     call produced before it passed one. */
  it('reports an empty issuer when nothing set one', () => {
    expect(otpauthParts('otpauth://totp/rosa%40regents.co.uk?secret=ABC').issuer).toBe('');
  });

  it('does not throw on a URI it cannot parse', () => {
    expect(otpauthParts('not a uri')).toEqual({ issuer: '', account: '' });
    expect(otpauthParts('')).toEqual({ issuer: '', account: '' });
  });
});
