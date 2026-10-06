/* The Continue chain must read in the same order as the sidebar: the detail steps,
   then the before-you-send tabs, then the declaration. This locks that order and the
   next-stop each screen names, so Nationality no longer skips ID check and Financials. */
import { describe, expect, it } from 'vitest';
import { JOURNEY, stopPhrase } from './Apply';

describe('the journey chain', () => {
  it('runs steps, then the before-you-send tabs, then declaration', () => {
    expect(JOURNEY.map((s) => s.id)).toEqual([
      'property', 'about', 'fee', 'address', 'income', 'nationality',
      'id', 'financials', 'declaration',
    ]);
  });

  it('each screen names the next stop, weaving through the tabs after Nationality', () => {
    const chain = JOURNEY.map((s, i) => {
      const next = JOURNEY[i + 1];
      return `${s.id} -> ${next ? stopPhrase(next) : '(send)'}`;
    });
    expect(chain).toContain('nationality -> ID check');   // no longer straight to declaration
    expect(chain).toContain('id -> financials');
    expect(chain).toContain('financials -> declaration');
    expect(chain).toContain('declaration -> (send)');
  });

  it('keeps the ID acronym cased, lowercases the rest', () => {
    expect(stopPhrase({ kind: 'tab', id: 'id' })).toBe('ID check');
    expect(stopPhrase({ kind: 'tab', id: 'financials' })).toBe('financials');
    expect(stopPhrase({ kind: 'step', id: 'nationality' })).toBe('nationality');
  });
});
