/* THE GUARANTEE FEE STAGE, WHICH USED TO PRINT A BASIS IT HAD NOT BEEN TOLD.

   The stage appended the words "one month's rent" to whatever amount it was
   handed, and fell back to them outright when it was handed nothing. That is
   true only at standard terms: 3 and 5 week bases exist, and on a joint tenancy
   the tenant pays a share of even that. The stage was printing a price nobody
   had been charged, next to the date they paid a different one.

   The basis now comes from the caller, because only the record knows it, and
   there is no wording to fall back to. */
import { describe, expect, it } from 'vitest';
import { buildAgentJourney, type ApplicationJourney } from './journeyStages';

const journey = (over: Partial<ApplicationJourney> = {}): ApplicationJourney => ({
  referencing_mode: 'opndoor_referenced',
  status: 'deed',
  invited_at: '2026-06-01T09:00:00Z',
  registered_at: '2026-06-02T09:00:00Z',
  property_done: true,
  about_done: true,
  fee_paid_at: '2026-06-03T09:00:00Z',
  id_done: true,
  financials_done: true,
  submitted_at: '2026-06-04T09:00:00Z',
  decided_at: '2026-06-05T09:00:00Z',
  decision: 'approved',
  decline_reason: null,
  guarantee_paid_at: '2026-06-06T09:00:00Z',
  deed_at: '2026-06-07T09:00:00Z',
  deed_state: 'executed',
  current_step: null,
  ...over,
});

const fmt = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
/** Stage 8, the guarantee fee. */
const feeNote = (fees?: { guarantee?: string; basis?: string }) =>
  buildAgentJourney(journey(), fmt, fees).steps[7].note;

describe('the guarantee fee stage states the basis it was given', () => {
  it('prints the amount and the row’s own basis', () => {
    expect(feeNote({ guarantee: '£1,153.84', basis: "3 weeks of rent (this tenant's 50% share)" }))
      .toBe("£1,153.84 · 3 weeks of rent (this tenant's 50% share)");
  });

  it('says one month’s rent only when the caller says so', () => {
    expect(feeNote({ guarantee: '£3,000', basis: "one month's rent" }))
      .toBe("£3,000 · one month's rent");
  });

  it('never invents a basis it was not given', () => {
    // The old fallback. A 3-week agency read "£2,076.92 · one month's rent".
    expect(feeNote({ guarantee: '£2,076.92' })).toBe('£2,076.92');
    expect(feeNote({ guarantee: '£2,076.92' })).not.toMatch(/month/);
  });

  it('says nothing at all rather than a bare basis with no amount', () => {
    // It used to answer "One month's rent" with no figure beside it, which is
    // the same claim with even less to check it against.
    expect(feeNote()).toBe('');
    expect(feeNote({ basis: "one month's rent" })).toBe("one month's rent");
  });

  it('leaves the other eight stages alone', () => {
    const v = buildAgentJourney(journey(), fmt, { guarantee: '£1,000', basis: '5 weeks of rent' });
    expect(v.steps).toHaveLength(9);
    expect(v.steps[3].label).toBe('Application fee paid');
    expect(v.steps[3].note).toBe('');
    expect(v.steps[8].label).toBe('Deed signed and issued');
  });
});
