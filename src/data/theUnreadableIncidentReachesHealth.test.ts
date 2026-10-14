/* =====================================================================
   (cp) THE REPORT THAT WAS BUILT TO FIND THE ERROR COULD NOT REPORT
   ITSELF.

   Matt, 2026-10-04: "A draft month has no reference by design; it
   should say 'Reference assigned when the statement is posted', never
   a load error. Find why it errored and log it to Health."
   Matt, 2026-10-05: "find the real error, don't hide it."

   =====================================================================
   WHAT THE REAL ERROR TURNED OUT TO BE
   =====================================================================

   20261008020000 created report_portal_incident(p_type, p_month) and
   wired this call to it. Two hours later 20261008080000 added export
   failures to the same function and, to do it, renamed the second
   argument to p_context. It updated the export call site. It left this
   one sending p_month.

   PostgREST resolves an RPC BY ARGUMENT NAME, so the call has resolved
   to no function at all ever since: PGRST202 in the console, nothing in
   Health. Every unreadable reference Matt has seen went unreported by
   the mechanism built to report it.

   MEASURED ON DEV before writing anything: as Kestrel Management
   (de6f243b), commission_statement_ref answers cleanly for every payee
   key the Agency schedules panel can build in October -- all eight
   estate agencies, all their branches, and the supplier's own partner
   key -- returning null, which the client words as "Reference assigned
   when the statement is posted". So the SQL is not what failed on his
   screen, and with Health deaf there is no record of what did. That is
   the thing to fix first: the report now carries the error CODE, so the
   next occurrence names itself instead of being guessed at.
   ===================================================================== */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const calls: { fn: string; args: Record<string, unknown> }[] = [];
let refAnswer: { data: unknown; error: unknown } = { data: null, error: null };

vi.mock('@/lib/supabase', () => ({
  SUPABASE_ENABLED: true,
  supabase: null,
  sb: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const answer = fn === 'commission_statement_ref' ? refAnswer : { data: null, error: null };
      return Promise.resolve(answer);
    },
  }),
}));

import { statementReference, REFERENCE_UNREADABLE, REFERENCE_ON_POST } from './exportsService';

const incident = () => calls.find((c) => c.fn === 'report_portal_incident');

beforeEach(() => { calls.length = 0; refAnswer = { data: null, error: null }; });

describe('when the reference read fails', () => {
  it('tells Health, with the argument name the function actually has', async () => {
    refAnswer = { data: null, error: { code: 'PGRST301', message: 'JWT expired' } };
    expect(await statementReference('2026-10', 'kestrel-lettings|agency:x')).toBe(REFERENCE_UNREADABLE);
    expect(incident()?.args).toEqual({
      p_type: 'portal_statement_reference_unreadable', p_context: '2026-10', p_code: 'PGRST301',
    });
  });

  /* THE REGRESSION ITSELF, named. A rename in a later migration is
     invisible to a caller in another language, and this is the assertion
     that would have caught it. */
  it('and never sends p_month, which is the argument that was renamed away', async () => {
    refAnswer = { data: null, error: { code: '42501', message: 'denied' } };
    await statementReference('2026-10', 'k|agency:x');
    expect(Object.keys(incident()?.args ?? {})).not.toContain('p_month');
  });

  /* A THROW ARRIVES BY THE OTHER DOOR and must report the same way. */
  it('reports a thrown failure too, and its code', async () => {
    refAnswer = { get data(): never { throw Object.assign(new Error('boom'), { code: 'PGRST202' }); }, error: null };
    expect(await statementReference('2026-10', 'k|agency:x')).toBe(REFERENCE_UNREADABLE);
    expect(incident()?.args.p_code).toBe('PGRST202');
  });

  /* A CODE THAT IS NOT A CODE IS DROPPED, not trimmed and not forwarded.
     The RPC refuses anything outside twelve characters of letters, digits
     and underscores, and a report that is itself refused teaches nobody
     anything -- which is the whole failure being fixed here. */
  it.each([
    ['a sentence', 'Could not reach the server, please try again later'],
    ['an object', { nested: true }],
    ['nothing at all', undefined],
  ])('drops %s rather than sending something the RPC would refuse', async (_what, code) => {
    refAnswer = { data: null, error: { code, message: 'x' } };
    await statementReference('2026-10', 'k|agency:x');
    expect(incident()?.args.p_code).toBeNull();
  });
});

describe('when the month simply has no statement yet', () => {
  /* THE CASE MATT REPORTED: a draft month is not a failure, so nothing is
     said to Health and the reader is told the truth. */
  it('says so, and tells Health nothing', async () => {
    refAnswer = { data: null, error: null };
    expect(await statementReference('2026-10', 'k|agency:x')).toBe(REFERENCE_ON_POST);
    expect(incident()).toBeUndefined();
  });

  it('and a posted month returns its reference, still saying nothing', async () => {
    refAnswer = { data: 'STMT-2026-09-0006', error: null };
    expect(await statementReference('2026-09', 'k|partner:x')).toBe('STMT-2026-09-0006');
    expect(incident()).toBeUndefined();
  });
});
