/* The tenant-facing status vocabulary.

   applications.status is OUR vocabulary: 'sent' means a payment link is out,
   which is meaningless to the person it was sent to, and 'paid' means the
   guarantee fee rather than the application fee. statusView is the translation,
   and these lock the two places it must never get wrong: what a tenant is told
   after submitting, and what they are told once approved. */
import { describe, expect, it } from 'vitest';
import { statusView } from './ApplicationStatus';

describe('what a tenant is told about their application', () => {
  it('in progress counts the sections done', () => {
    const v = statusView('draft', false, 3, 7);
    expect(v.headline).toBe('In progress');
    expect(v.detail).toContain('3 of 7');
    expect(v.detail).toContain('application fee');   // says what unlocks the rest
  });

  it('stops mentioning the fee once it is paid', () => {
    expect(statusView('draft', true, 3, 7).detail).not.toContain('application fee');
  });

  it('says it is ready to send when everything is done', () => {
    expect(statusView('draft', true, 7, 7).headline).toBe('Ready to send');
  });

  it('never says "referencing" to a tenant: it is an eligibility check', () => {
    // Our internal vocabulary and the partner API's is "referencing"; the word a
    // tenant sees is "eligibility". These are the two places it leaks.
    for (const st of ['draft', 'referencing', 'declined', 'sent', 'paid', 'deed']) {
      const v = statusView(st, true, 7, 7);
      expect(`${v.headline} ${v.detail}`.toLowerCase()).not.toContain('referenc');
    }
  });

  it('after submitting, says it is pending and that nothing is needed from them', () => {
    const v = statusView('referencing', true, 7, 7);
    expect(v.headline).toBe('Eligibility check in progress');
    expect(v.detail).toContain('do not need to do anything');
    expect(v.tone).toBe('waiting');
    expect(v.reached).toBe(2);
  });

  it('approved says approved, and offers the guarantee fee', () => {
    const v = statusView('sent', true, 7, 7);
    expect(v.headline).toBe('Approved');
    expect(v.cta).toBe('pay_guarantee');
    expect(v.tone).toBe('good');
  });

  it('declined is terminal on the timeline and never shows a success tick', () => {
    const v = statusView('declined', true, 7, 7);
    expect(v.terminated).toBe(true);
    expect(v.tone).toBe('bad');
    expect(v.cta).toBeUndefined();      // never ask a declined tenant for money
  });

  it('the guarantee being issued is the end of the timeline', () => {
    expect(statusView('deed', true, 7, 7).reached).toBeGreaterThan(5);
    expect(statusView('deed', true, 7, 7).tone).toBe('good');
  });

  it('lapsed and withdrawn are terminal, not silent', () => {
    expect(statusView('expired', true, 7, 7).terminated).toBe(true);
    expect(statusView('withdrawn', true, 7, 7).terminated).toBe(true);
  });

  it('never offers to take money except when approved', () => {
    for (const st of ['draft', 'referencing', 'declined', 'paid', 'deed', 'expired', 'withdrawn']) {
      expect(statusView(st, true, 7, 7).cta).toBeUndefined();
    }
  });
});
