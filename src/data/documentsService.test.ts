/* The staff-side view of applicant uploads. In the demo (SUPABASE off in test)
   the list is a representative set so the card is reviewable, and downloads are
   live-data only rather than failing silently. */
import { describe, expect, it } from 'vitest';
import { applicationDocumentUrl, listApplicationDocuments } from './documentsService';

describe('staff documents service (mock mode)', () => {
  it('lists a representative set, labelled, applicant kinds only', async () => {
    const docs = await listApplicationDocuments('GR-1');
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.every((d) => d.label && d.filename)).toBe(true);
    expect(docs.map((d) => d.kind)).toEqual(expect.arrayContaining(['proof_of_address', 'bank_statement']));
    // Never a provider report: those live in a different bucket, not this card.
    expect(docs.some((d) => d.kind.endsWith('_report'))).toBe(false);
  });

  it('does not offer a live download in the demo', async () => {
    const r = await applicationDocumentUrl('mock-proof');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/live data only/i);
  });
});
