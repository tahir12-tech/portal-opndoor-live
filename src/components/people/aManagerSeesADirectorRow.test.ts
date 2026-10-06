/* WHAT A MANAGER IS TOLD ABOUT A DIRECTOR, AND WHAT THEY MAY HAND OUT.
 *
 * Matt, 2026-10-04 (au): 'on Director rows say "Only a Director or opndoor
 * can change a Director." (A Director's own view keeps "contact your account
 * manager".) Also check a Manager's Invite only offers Manager and
 * Negotiator.'
 *
 * TWO HALVES AND ONLY ONE WAS A BUG. The sentence is copy and was wrong for
 * one of its two readers. The invite question is a LADDER question, and had
 * the answer been no it would have been an isolation fault rather than a
 * wording one -- so it is asserted here rather than assumed, which is the
 * whole reason Matt asked for it to be checked.
 */
import { describe, it, expect } from 'vitest';
import { peerActionNote } from './personConfirm';
import { levelsGrantableBy, type Actor } from '@/data/types';

const DIRECTOR: Actor = { id: 'd1', role: 'management', seesCommission: true };
const MANAGER: Actor = { id: 'm1', role: 'management', seesCommission: false };
const NEGOTIATOR: Actor = { id: 'n1', role: 'referrer', seesCommission: false };

describe('the note on a row the reader cannot act on', () => {
  /* THE ROW LOOKS THE SAME TO BOTH READERS, which is why one sentence used
     to cover both and why the fault was invisible. */
  it('sends a Director to opndoor, because they have exhausted their estate', () => {
    expect(peerActionNote('Director', false))
      .toBe('To change or remove a Director, contact your account manager at partners@opndoor.co.');
  });

  it('but tells a Manager there is somebody in their own building', () => {
    expect(peerActionNote('Director', true))
      .toBe('Only a Director or opndoor can change a Director.');
  });

  /* A SUPPLIER'S MANAGEMENT IS THE TOP OF ITS RAIL, so nothing sits above a
     reader looking at one and the second arm never fires for them. The
     article matters too: "To change or remove a Management" is not English,
     which is what PEER_PHRASE exists for. */
  it('keeps the supplier wording, where nobody is above either reader', () => {
    expect(peerActionNote('Management', false))
      .toBe('To change or remove someone at Management level, contact your account manager at partners@opndoor.co.');
  });
});

describe('what each level may hand out in an invite', () => {
  const levels = (a: Actor) => levelsGrantableBy(a).map((l) => l.level);

  it('a Manager offers Manager and Negotiator, and not Director', () => {
    expect(levels(MANAGER)).toEqual(['Manager', 'Negotiator']);
  });

  /* AT OR BELOW, not strictly below, and the asymmetry with the row actions
     is deliberate: growing a second Manager is an agency's own business;
     acting on one is not. */
  it('and a Director offers all three, including their own level', () => {
    expect(levels(DIRECTOR)).toEqual(['Director', 'Manager', 'Negotiator']);
  });

  /* THE ONE THAT WOULD BE AN ISOLATION FAULT IF IT WERE WRONG. A Negotiator
     has no invite button at all -- `canInvite` is role === 'management' --
     so this list is never rendered for them. What matters is that reaching
     it another way yields their own level and nothing above it, rather than
     the whole ladder by default. The at-or-below rule gives them exactly
     Negotiator, which is the floor, not nothing. */
  it('and a Negotiator reaches no further than their own level', () => {
    expect(levels(NEGOTIATOR)).toEqual(['Negotiator']);
  });
});
