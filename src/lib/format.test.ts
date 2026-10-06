import { describe, it, expect } from 'vitest';
import { fmtRatePct, formatLongDate } from './format';

// Money-path guard: commission rates must always render to one decimal place so a
// stored 9.5% can never be rounded to, or mistaken for, 10% anywhere in the product
// (the exact defect from Friday's Northwind Property agent-rate mis-entry).
describe('fmtRatePct — commission-rate display precision', () => {
  it('always shows exactly one decimal place', () => {
    expect(fmtRatePct(0.095)).toBe('9.5%');
    expect(fmtRatePct(0.1)).toBe('10.0%');
    expect(fmtRatePct(0.25)).toBe('25.0%');
    expect(fmtRatePct(0.11)).toBe('11.0%');
    expect(fmtRatePct(0)).toBe('0.0%');
  });

  it('renders 9.5% and 10% as visibly distinct strings', () => {
    expect(fmtRatePct(0.095)).not.toBe(fmtRatePct(0.1));
    expect(fmtRatePct(0.095)).toBe('9.5%');
  });

  it('treats null/undefined as 0.0%', () => {
    expect(fmtRatePct(null)).toBe('0.0%');
    expect(fmtRatePct(undefined)).toBe('0.0%');
  });
});

describe('formatLongDate — the human date on the declaration', () => {
  it('renders an ISO date as "23 September 2026", not 2026-09-23', () => {
    expect(formatLongDate('2026-09-23')).toBe('23 September 2026');
  });
  it('has no leading zero on the day', () => {
    expect(formatLongDate('2026-09-01')).toBe('1 September 2026');
  });
  it('returns empty string for null or an unparseable value', () => {
    expect(formatLongDate(null)).toBe('');
    expect(formatLongDate('not a date')).toBe('');
  });
});
