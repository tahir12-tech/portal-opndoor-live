/* WALK FIX 19. "Northgate Lettings's commission" should read "Northgate
 * Lettings' commission" where the name ends in s.
 *
 * FIXED WHERE THE POSSESSIVE IS FORMED, not where it is read. The QUEUE note
 * says why that matters: if the string is built by appending at each call
 * site, this is several bugs; if there is one helper, it is one. There was no
 * helper -- eight sites each wrote `${name}’s` inline -- so the first part of
 * this fix is that there is now one place to be wrong.
 *
 * THE RULE IS EXACTLY THE ONE MATT NAMED, and no wider. A name ending in s
 * takes the apostrophe alone. Names ending in x or z, or in a silent s, are
 * argued over by style guides and nobody has asked; inventing a rule for them
 * here would be a second thing to be wrong about. Written down so the next
 * reader knows the omission is a decision.
 *
 * AND THE CURLY APOSTROPHE IS THE ONE THE PRODUCT USES. Every call site that
 * had it right used U+2019, and a helper that quietly switched to U+0027
 * would change eight strings while fixing one.
 */
import { describe, expect, it } from 'vitest';
import { possessive } from './format';

describe('a name that does not end in s', () => {
  it('takes an apostrophe and an s', () => {
    expect(possessive('Regent')).toBe('Regent’s');
  });

  it('including one with an s inside it', () => {
    expect(possessive('Kestrel Lettings Group')).toBe('Kestrel Lettings Group’s');
  });

  /* The apostrophe is the typographic one, matching every string in the
     product that was already right. */
  it('and it is the curly apostrophe, not the typewriter one', () => {
    expect(possessive('Regent')).not.toContain("'");
  });
});

describe('a name that ends in s', () => {
  /* THE DEFECT, AS REPORTED. */
  it('takes the apostrophe alone', () => {
    expect(possessive('Northgate Lettings')).toBe('Northgate Lettings’');
  });

  it('whatever the case of it', () => {
    expect(possessive('ACME HOMES')).toBe('ACME HOMES’');
  });

  /* A name that already ENDS in an apostrophe-s, which is what a badly
     stored name looks like. Adding another would give "Jones’s’s". */
  it('and is not doubled on a name that already ends in one', () => {
    expect(possessive('Jones’')).toBe('Jones’');
  });
});

describe('what it does with nothing', () => {
  /* An empty name must not become a bare apostrophe hanging in front of the
     word it was meant to qualify. */
  it('returns nothing rather than a stray apostrophe', () => {
    expect(possessive('')).toBe('');
    expect(possessive(null)).toBe('');
    expect(possessive(undefined)).toBe('');
  });

  it('and trims, so a trailing space cannot hide the s', () => {
    expect(possessive('Northgate Lettings ')).toBe('Northgate Lettings’');
  });
});
