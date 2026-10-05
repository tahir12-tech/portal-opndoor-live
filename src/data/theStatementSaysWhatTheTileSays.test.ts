/* =====================================================================
   THE STATEMENT AND THE TILE USE THE SAME WORDS.

   Matt, setting the order: "one shared rule for 'supplier passes it on
   vs Opndoor pays the agency directly', used by all six surfaces".

   Five of the six are in src/ and import whoPaysTheAgency. The sixth
   is the statement, which is built by a Deno edge function and CANNOT
   import from src/ -- different runtime, different module graph. So
   the two sentences exist twice, on purpose, and this file is the
   reason that is acceptable: a twin with a test is honest, a twin
   without one is two products that will word the same arrangement
   differently within a month.

   WHY IT MATTERS MORE HERE THAN ANYWHERE ELSE. The statement is the
   document a supplier invoices from. If Reporting says "Your agencies'
   share, included above for you to pass on" and the statement says
   something else about the same money, the supplier has to decide
   which of our documents to believe before they can bill us.

   AND THE ARITHMETIC IS ASSERTED IN DENO'S FILE, not here:
   supplierPayableOf has its own tests. This file is only about the
   words -- the one thing the two runtimes can both be read for.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PASSED_ON_BY_SUPPLIER, PAID_DIRECT_BY_OPNDOOR, PAYABLE_TO_YOU } from './whoPaysTheAgency';

const deno = readFileSync(join(process.cwd(), 'supabase/functions/_shared/supplierPayable.ts'), 'utf8');

/** The Deno module's own copy, read out of its source. */
function denoConst(name: string): string {
  const m = new RegExp(`export const ${name} = "((?:[^"\\\\]|\\\\.)*)"`).exec(deno);
  if (!m) throw new Error(`${name} is not exported from supplierPayable.ts`);
  // The file writes the curly apostrophe as ’; unescape it the way
  // the TypeScript compiler would.
  return m[1].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

describe('the two copies of the wording', () => {
  it.each([
    ['PASSED_ON_BY_SUPPLIER', PASSED_ON_BY_SUPPLIER],
    ['PAID_DIRECT_BY_OPNDOOR', PAID_DIRECT_BY_OPNDOOR],
    ['PAYABLE_TO_YOU', PAYABLE_TO_YOU],
  ])('%s says the same thing in both runtimes', (name, fromSrc) => {
    expect(denoConst(name)).toBe(fromSrc);
  });

  /* AND THEY ARE MATT'S WORDS, to the letter, so a change to BOTH
     copies at once still has to be a deliberate one. */
  it('and both are the wording Matt gave', () => {
    expect(PASSED_ON_BY_SUPPLIER).toBe('Your agencies’ share, included above for you to pass on');
    expect(PAID_DIRECT_BY_OPNDOOR).toBe('Paid by opndoor directly to your agencies');
    expect(PAYABLE_TO_YOU).toBe('Payable to you');
  });
});

describe('the statement', () => {
  const fn = readFileSync(join(process.cwd(), 'supabase/functions/commission-statements/index.ts'), 'utf8');

  /* (cf) THE LINE THAT WAS HIDDEN IN THE CASE THAT NEEDED IT. On a
     wholly carved statement payable, net and total are one number, so
     the old `Math.abs(payable - net) > 0.005` guard dropped "Payable
     to you" -- leaving "Your share", the supplier's residual AFTER
     passing the agencies' share on, as the last figure before the
     footer. It was suppressed for being redundant with the total and
     was in fact the only thing distinguishing it from the wrong
     number above it. */
  it('always states what is payable, in the PDF and the CSV', () => {
    expect(fn).not.toContain('Math.abs(payable - net) > 0.005');
    expect(fn.match(/PAYABLE_TO_YOU, gbp\(payable\)/g)?.length ?? 0).toBe(2);
  });

  it('and words the agents’ line by who pays it, in both', () => {
    expect(fn).not.toContain("Of which agents' share");
    expect(fn.match(/PASSED_ON_BY_SUPPLIER, gbp\(carved/g)?.length ?? 0).toBe(2);
    expect(fn.match(/PAID_DIRECT_BY_OPNDOOR, gbp\(direct/g)?.length ?? 0).toBe(2);
  });

  /* THE INVOICE INSTRUCTION WAS ALREADY RIGHT and must stay right:
     "the invoice instruction, once posted, must say the payable figure
     (GBP 947.25), never 'Your share'." */
  it('and the invoice instruction asks for the payable figure', () => {
    expect(fn).toContain('paymentTermsLine(gbp(payable), reference, invoiceEmail)');
  });
});
