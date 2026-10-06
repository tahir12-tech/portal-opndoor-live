/* £840 INVOICED AGAINST A £600 DEBT IS £240 PAID TWICE.
 *
 * Matt, 2026-10-03, verbatim: "the invoice instruction must ask for what
 * Opndoor owes the supplier itself (£600 here, not £840), otherwise agency
 * commission Opndoor pays directly gets paid twice. For a draft, leave out
 * the invoice instruction entirely ('Don't invoice yet: this statement hasn't
 * been posted')."
 *
 * And, the message before it: "On referrals frozen under 'opndoor pays the
 * agents', the agency's share is paid by Opndoor directly, so it must not be
 * in the supplier's total: GR-FROST-KES should show Kestrel's £600 as the
 * total, with a note 'Agency commission of £240 paid by Opndoor directly to
 * Frost Partnership'."
 *
 * THE AMOUNTS CANNOT TELL THE TWO ARRANGEMENTS APART, which is why this
 * needed a migration and not an edit. Under BOTH shapes
 * `supplier_amount = total_amount - agent_amount`:
 *
 *   siblings  total 840 = supplier 600 + agents 240 ON TOP.
 *             Opndoor pays Frost the 240. Kestrel is owed 600.
 *   carved    total 600, agents 240 carved OUT, supplier 360.
 *             Kestrel is owed the whole 600 and passes 240 on.
 *
 * Same three numbers in the same relationship, opposite answers. 20261007820000
 * returns `settles_own` so the question can be asked per line -- per LINE,
 * because a supplier's arrangement can change and every referral keeps the one
 * it was sold under, so a month that straddles a change holds both kinds.
 *
 * MEASURED ON DEV: Kestrel's September is one line, GR-FROST-KES, frozen
 * `opndoor_pays_agents_at_freeze = true`, and the RPC now returns
 * `settles_own = false` with total 840.00, agents 240.00, supplier 600.00.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  supplierPayableOf, paidDirectToAgents, directToAgentNotes, DRAFT_NO_INVOICE, DRAFT_REFERENCE,
} from '../../supabase/functions/_shared/supplierPayable.ts';

/** Kestrel's September, as the RPC returns it. */
const SIBLINGS = [{
  guarantee_ref: 'GR-FROST-KES', agency_name: 'Frost Partnership',
  total_amount: 840, agent_amount: 240, supplier_amount: 600, settles_own: false,
}] as never[];

/** The same money frozen the other way. */
const CARVED = [{
  guarantee_ref: 'GR-FROST-KES', agency_name: 'Frost Partnership',
  total_amount: 600, agent_amount: 240, supplier_amount: 360, settles_own: true,
}] as never[];

describe('what Opndoor owes the supplier', () => {
  it('is their own share where Opndoor pays the agency directly', () => {
    expect(supplierPayableOf(SIBLINGS)).toBe(600);
  });

  it('and the whole total where the supplier passes it on', () => {
    expect(supplierPayableOf(CARVED)).toBe(600);
  });

  /* THE SAME DEBT EITHER WAY, which is the point and the reason the bug was
     invisible: Kestrel is owed £600 under both arrangements. What differs is
     which of the statement's own figures that £600 is. */
  it('which is the same £600 both ways, reached from different columns', () => {
    expect(supplierPayableOf(SIBLINGS)).toBe(supplierPayableOf(CARVED));
  });

  /* A MONTH THAT STRADDLES A CHANGE holds both kinds, and the answer is the
     sum of the right answers rather than one rule applied to the lot. */
  it('and a mixed month adds each line’s own answer', () => {
    expect(supplierPayableOf([...SIBLINGS, ...CARVED] as never[])).toBe(1200);
  });
});

describe('what Opndoor pays the agencies directly', () => {
  it('is the agents’ share on the siblings lines only', () => {
    expect(paidDirectToAgents(SIBLINGS)).toBe(240);
    expect(paidDirectToAgents(CARVED)).toBe(0);
  });

  it('and is named, in Matt’s words, per agency', () => {
    expect(directToAgentNotes(SIBLINGS))
      .toEqual(['Agency commission of £240.00 paid by opndoor directly to Frost Partnership.']);
  });

  it('and nothing is said where there is nothing to say', () => {
    expect(directToAgentNotes(CARVED)).toEqual([]);
  });

  /* ONE LINE PER AGENCY, not per referral: a supplier with eleven Frost
     referrals gets one sentence about Frost. */
  it('and one sentence per agency, however many referrals', () => {
    const two = [...SIBLINGS, { ...SIBLINGS[0] }] as never[];
    expect(directToAgentNotes(two))
      .toEqual(['Agency commission of £480.00 paid by opndoor directly to Frost Partnership.']);
  });
});

describe('a draft asks for nothing', () => {
  it('and says why', () => {
    expect(DRAFT_NO_INVOICE).toBe("Don't invoice yet: this statement hasn't been posted.");
  });

  /* AND THE REFERENCE LINE SAYS IT ONCE. It read "Reference Reference
     assigned when the statement is poste..." -- the label, then a value
     beginning with the same word, then truncated. */
  it('and prints no reference at all, because it has none', () => {
    expect(DRAFT_REFERENCE).toBe('Draft: not yet posted');
  });
});

describe('the documents agree', () => {
  const SRC = readFileSync(join(process.cwd(), 'supabase/functions/commission-statements/index.ts'), 'utf8');
  /* THE SUPPLIER'S TWO BUILDERS ONLY. The agency statement sits in the same
     file and is NOT part of this: nothing is paid around an agency, so its
     total is its debt and `net` is right there. Only the draft handling is
     shared, and that is asserted separately below. */
  const SUPPLIER = SRC.slice(SRC.indexOf('export function supplierStatementPdf'), SRC.indexOf('export function statementPdf'));

  it('the PDF and the CSV both invoice the payable, not the total', () => {
    expect(SUPPLIER.match(/paymentTermsLine\(gbp\(payable\), reference, invoiceEmail\)/g) ?? []).toHaveLength(2);
    expect(SUPPLIER).not.toContain('paymentTermsLine(gbp(net), reference, invoiceEmail)');
  });

  /* AND AN AGENCY'S STATEMENT STILL INVOICES ITS TOTAL, which is the half
     that must NOT change: an agency is paid everything on its statement. */
  it('while an agency still invoices its own total', () => {
    const agency = SRC.slice(SRC.indexOf('export function statementPdf'), SRC.indexOf('function settlementPdf'));
    expect(agency).toContain('paymentTermsLine(gbp(net), reference, invoiceEmail)');
    // "Total payable" is the row LABEL on both statements; what must not
    // appear here is the supplier's computed `payable` figure.
    expect(agency).not.toContain('supplierPayableOf');
    expect(agency).not.toContain('gbp(payable)');
  });

  it('and both carry the direct-payment note', () => {
    expect(SUPPLIER.match(/directToAgentNotes\(lines\)/g) ?? []).toHaveLength(2);
  });

  /* FOUR, NOT TWO: the agency statement has the identical defect in its own
     two builders -- "Reference Reference assigned when..." and an invoice
     instruction on a document nobody may invoice against yet -- and it is
     the same two lines. Matt reported it on the supplier's; fixing one and
     leaving the other would be the drift these files keep producing. */
  it('and all four builders drop the instruction on a draft', () => {
    expect(SRC.match(/: DRAFT_NO_INVOICE/g) ?? []).toHaveLength(4);
  });

  /* THE REFERENCE LINE SAID THE WORD TWICE. Matt: it read "Reference
     Reference assigned when the statement is poste...". The label is the
     label; a draft has no reference, so it says what it is. */
  it('and a draft says "Draft: not yet posted" once, on all four', () => {
    expect(SRC.match(/DRAFT_REFERENCE/g) ?? []).length;
    expect(SRC).not.toContain('["Statement reference", reference]');
    expect(SRC.match(/posted \? reference : DRAFT_REFERENCE/g) ?? []).toHaveLength(4);
  });

  /* THE INSTRUCTION ITSELF IS UNCHANGED, which matters: the wording is
     Matt's own from 2026-10-01 and only the FIGURE in it moves. */
  it('and the instruction’s own wording is untouched', () => {
    expect(SRC).toContain('Please send an invoice to opndoor for ${total}, quoting statement reference ${reference}, ');
    expect(SRC).toContain('Invoices received by the 8th are paid by the 15th.');
  });
});
