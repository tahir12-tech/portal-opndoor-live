/* THE SCHEDULES ARE ACTUALLY ON THE REPORTING PAGE.
 *
 * Matt, 2026-10-01, verbatim: "If the zip would be over 10MB, don't
 * attach it; instead the email links to download it from the supplier's
 * Reporting page, where it's always available."
 *
 * THIS FILE EXISTS BECAUSE I SENT THE EMAIL FIRST. The TEST supplier
 * statement went out with the sentence "They are also always available
 * on your Reporting page" in it, and at that moment the Reporting page
 * had no such download: the sentence was copy describing something
 * nobody had built. The tests below are the ones that would have failed
 * that evening.
 *
 * =====================================================================
 * WHAT IS ASSERTED WHERE
 * =====================================================================
 *
 * The endpoint runs on Deno and talks to a service_role client, so
 * vitest cannot execute it. What a test CAN hold is the handful of
 * decisions in it that are dangerous to get wrong and silent when they
 * are: who may take a supplier's statement, and the fact that opening a
 * month does not mint a statement number for it. Both are pinned
 * against the source.
 *
 * The browser half is real code and is run for real.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FN = resolve(process.cwd(), 'supabase/functions/commission-statements/index.ts');
const src = readFileSync(FN, 'utf8');
/* Comments out: this file's prose quotes the very strings it asserts on,
   and a comment that mentions commission_statement_ref would otherwise
   satisfy the test that the code does not call it. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');
const endpoint = code.slice(
  code.indexOf('async function serveSupplierBundle'),
  code.indexOf('Deno.serve(async (req)'),
);

describe('the supplier can fetch the month again', () => {
  it('there is an endpoint for it, and the page calls that one', () => {
    expect(endpoint.length).toBeGreaterThan(500);
    expect(code).toMatch(/body\.action === "supplier_bundle"/);
    const client = readFileSync(resolve(process.cwd(), 'src/data/supplierStatementsService.ts'), 'utf8');
    expect(client).toMatch(/action: 'supplier_bundle'/);
    expect(client).toMatch(/invoke\('commission-statements'/);
  });

  /* IT IS NOT A RUN. The handler below it refuses any manual call that
     is not { test: true } or ?dry=1, which is right for a thing that
     posts statements and wrong for a thing that posts nothing. If the
     branch ever moves below that gate, the download works on the 1st of
     the month and nowhere else, which is the kind of fault that is
     found in December. */
  it('and it answers before the gate that refuses manual runs', () => {
    const branch = code.indexOf('body.action === "supplier_bundle"');
    const gate = code.indexOf('Manual runs must set');
    expect(branch).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(0);
    expect(branch).toBeLessThan(gate);
  });

  /* ONE BUILDER. The whole reason buildSupplierBundle takes a client is
     that the email and the page produce the same bytes. A second
     generator here would drift, and the drift would only ever be found
     by a supplier holding two documents for one month. */
  it('and it builds the documents with the same builder the email uses', () => {
    expect(endpoint).toMatch(/await buildSupplierBundle\(service, p, monthStart, month, label, reference, invoiceEmail\)/);
  });
});

describe('who may take a supplier statement', () => {
  it('nobody without a token', () => {
    expect(endpoint).toMatch(/if \(!authHeader\) return json\(\{ ok: false, error: "Not authorised\." \}, 401\)/);
  });

  /* THE SUPPLIER RAIL'S BOUNDARY, and the one place in this codebase
     where `partner_id = app_partner()` IS the authorisation test. It is
     the same rule commission_statement_ref states for a partner payee.
     The agency rail's rule is the opposite and CI refuses a migration
     that confuses them; this endpoint only ever answers for a
     partner-level payee, which is why the narrow test is right here. */
  it('an opndoor admin, or the supplier itself holding commission', () => {
    expect(endpoint).toMatch(/callerRole === "superadmin" \|\| callerRole === "opndoor_manager"/);
    expect(endpoint).toMatch(/rpc\("may_see_commission"\)/);
    expect(endpoint).toMatch(/rpc\("app_partner"\)/);
    expect(endpoint).toMatch(/if \(sees !== true\) return json\([\s\S]{0,120}403\)/);
    expect(endpoint).toMatch(/const may = staff \|\| mine === partnerId;/);
  });

  it('and anybody else is refused rather than quietly given an empty month', () => {
    expect(endpoint).toMatch(/if \(!may\) return json\([\s\S]{0,120}403\)/);
  });

  /* FOUND BY PROBING THE DEPLOYED FUNCTION, not by reading it. The first
     version resolved the slug before it looked at the token, so a caller
     with NO token at all got "No such supplier." for a slug that does
     not exist and something else for one that does: an unauthenticated
     way to tell one from the other. Nothing secret is behind it and
     nothing was deployed anywhere but dev, but it is published state
     nobody asked for, and the fix is an ordering rather than a check,
     which is exactly the kind of fix that quietly comes undone. */
  it('and it checks the token before it so much as looks the supplier up', () => {
    const token = endpoint.indexOf('auth.getUser()');
    const lookup = endpoint.indexOf('from("partners")');
    expect(token).toBeGreaterThan(0);
    expect(lookup).toBeGreaterThan(0);
    expect(token, 'the supplier is resolved before the caller is').toBeLessThan(lookup);
    // ...and a caller with no commission capability never reaches it either.
    expect(endpoint.indexOf('rpc("may_see_commission")')).toBeLessThan(lookup);
  });

  /* THE PAYEE IS LOOKED UP BY LEVEL, so an agency id handed to this
     endpoint finds nothing rather than finding a partner that happens
     to share the number. */
  it('and it only ever answers for a partner-level payee', () => {
    expect(endpoint).toMatch(/x\.level === "partner" && x\.org_id === partnerId/);
  });
});

describe('opening a month is not posting one', () => {
  /* THE ONE THING THIS ENDPOINT MUST GET RIGHT THAT THE RUN DOES NOT.
     commission_statement_ref MINTS on read: it takes the month's next
     sequence number and stores it. A supplier browsing a month that has
     not been posted would burn that number on a statement nobody sent,
     and the month's sequence would have a hole in it that no document
     explains. So the endpoint reads the table instead. */
  it('the reference is read from the table, never minted', () => {
    expect(endpoint).toMatch(/from\("commission_statement_refs"\)/);
    expect(endpoint).not.toMatch(/commission_statement_ref"/);
  });

  it('and an unposted month shows the same placeholder the dry run does', () => {
    expect(endpoint).toMatch(/:\s*REF_ON_SEND;/);
  });

  it('and it writes nothing at all', () => {
    for (const write of ['.insert(', '.update(', '.upsert(', '.delete(']) {
      expect(endpoint, `the download must not ${write}`).not.toContain(write);
    }
    expect(endpoint, 'the download must not send').not.toContain('sendMessage');
  });

  /* THE SAME REFUSAL AS THE RUN. A statement that cannot say where to
     invoice is not a statement, and handing one out from a page would
     be a quieter way of doing what the run refuses to do loudly. */
  it('and it refuses just as the run does when the invoice email is unset', () => {
    expect(endpoint).toMatch(/rpc\("statement_invoice_email"\)/);
    expect(endpoint).toMatch(/if \(!invoiceEmail\)/);
  });
});

/* =====================================================================
   THE BROWSER HALF, run for real.
   ===================================================================== */
describe('saving one of the documents', () => {
  it('decodes the base64 and does not add a second BOM', async () => {
    /* THE EDGE FUNCTION ALREADY WRITES A BOM INTO THE CSV. downloadCsv,
       which every other export here goes through, prepends one. Sending
       these bytes through that path would put a visible "i>¿" in
       Excel's first cell, which is the exact fault a BOM prevents, so
       this is its own saver and this is the assertion that keeps it
       one. */
    const { downloadSupplierDocument } = await import('./supplierStatementsService');
    const bytes: Uint8Array[] = [];
    const created: string[] = [];
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    // jsdom has no Blob reader here, so the bytes are captured at the source.
    URL.createObjectURL = vi.fn((b: Blob) => {
      // @ts-expect-error jsdom Blob keeps its parts
      const parts = (b as unknown as { _buffer?: Uint8Array })._buffer;
      if (parts) bytes.push(parts);
      created.push('blob:x');
      return 'blob:x';
    }) as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();

    const clicked: string[] = [];
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = realCreateElement(tag);
      if (tag === 'a') (el as HTMLAnchorElement).click = () => { clicked.push((el as HTMLAnchorElement).download); };
      return el;
    }) as typeof document.createElement);

    // "hi" in base64, with a .csv name so the CSV branch is the one run.
    downloadSupplierDocument({ filename: 'opndoor-commission-2026-05.csv', content: 'aGk=' });

    expect(clicked).toEqual(['opndoor-commission-2026-05.csv']);
    expect(created.length).toBe(1);

    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
    vi.restoreAllMocks();
  });

  it('and the service never prepends one', () => {
    /* COMMENTS OUT FIRST, and that is not a detail: my first draft asked
       that the word "downloadCsv" appeared nowhere in the file, and it
       failed on the comment that explains why this is NOT downloadCsv.
       Asserting the absence of a word is a weak way to say "it does not
       call that" and a reliable way to trip over prose. */
    const client = readFileSync(resolve(process.cwd(), 'src/data/supplierStatementsService.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');
    expect(client).not.toContain('\\ufeff');
    expect(client).not.toMatch(/downloadCsv\(/);
  });
});

/* =====================================================================
   AND IT NEVER REJECTS.

   FOUND BY THE SUITE, which is the point of running it before
   committing rather than after. Mounting the card on the dashboard
   added EIGHT unhandled errors to two render tests that run with no
   Supabase client deliberately: sb() THROWS in that state, the effect
   had no catch, and the rejection went nowhere. The tests still passed,
   which is what makes it the kind of fault worth a test of its own.

   On a real screen the same throw is a dead network, and the card would
   have sat on "Building..." with no sentence and no way to know why.
   ===================================================================== */
describe('a failure is a sentence, never a rejection', () => {
  it('survives a client that is not there at all', async () => {
    const { getSupplierBundle } = await import('./supplierStatementsService');
    const sb = await import('@/lib/supabase');
    vi.spyOn(sb, 'sb').mockImplementation(() => { throw new Error('This test runs with no Supabase client.'); });
    const r = await getSupplierBundle('test-supplier', '2026-05');
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    vi.restoreAllMocks();
  });

  it('and a call that rejects', async () => {
    const { getSupplierBundle } = await import('./supplierStatementsService');
    const sb = await import('@/lib/supabase');
    vi.spyOn(sb, 'sb').mockReturnValue({
      functions: { invoke: () => Promise.reject(new Error('network')) },
    } as unknown as ReturnType<typeof sb.sb>);
    const r = await getSupplierBundle('test-supplier', '2026-05');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Could not reach/);
    vi.restoreAllMocks();
  });

  /* AND A REFUSAL FROM THE FUNCTION STILL READS AS ITSELF. The catch
     must not swallow the endpoint's own sentences: "No supplier
     commission for May 2026." is the answer, not an error to replace. */
  it('and passes the endpoint’s own refusal through unchanged', async () => {
    const { getSupplierBundle } = await import('./supplierStatementsService');
    const sb = await import('@/lib/supabase');
    vi.spyOn(sb, 'sb').mockReturnValue({
      functions: { invoke: () => Promise.resolve({ data: { ok: false, error: 'No supplier commission for May 2026.' }, error: null }) },
    } as unknown as ReturnType<typeof sb.sb>);
    const r = await getSupplierBundle('test-supplier', '2026-05');
    expect(r).toEqual({ ok: false, error: 'No supplier commission for May 2026.' });
    vi.restoreAllMocks();
  });
});
