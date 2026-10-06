/* A NEW AGENCY WORE AN ALERT ABOUT A DOCUMENT THAT DOES NOT EXIST.
 *
 * Matt, 2026-10-03, verbatim: "Agencies list and agency page: for Opndoor's
 * own agencies with no users, replace 'No one at this agency can receive the
 * deed. Invite a manager or nominate a recipient.' with a neutral 'No users
 * yet. Invite someone to start referring.' Only warn about deed delivery when
 * there's an application at that agency whose deed has nowhere to go."
 *
 * `org_deed_readiness` answers a CAPABILITY: could a deed reach somebody at or
 * under this org. It is false for two unrelated situations -- nobody has been
 * invited yet, and there are people the ladder does not reach -- and the
 * screens drew one alert for both. So an agency onboarded this morning, with
 * no application and nothing wrong, was warned about deed delivery, and the
 * one line an admin needed ("invite somebody") was the second half of a
 * sentence about deeds.
 *
 * MEASURED ON DEV: Harbour Lets, one branch, zero people. That is the row.
 *
 * TWO FACTS, TWO SOURCES. "Is anybody there" is a count, and the Agencies list
 * cannot compute one -- it draws a row per agency across the whole estate, and
 * the per-user positions call the single-agency page uses does not scale to
 * it. That is why the count is a new column on the RPC (20261007800000) rather
 * than a client-side tally. "Is a deed waiting" is `cannot_deliver` on an
 * application, read off the hydrated book in data/deedsStuck.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { deedsWithNowhereToGo, NO_USERS_YET } from '@/data/deedsStuck';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
/* WITHOUT THE COMMENTS. Both files quote Matt's instruction, which contains
   the sentence this test asserts is not written out a second time. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function app(o: Partial<FullApp>): FullApp {
  return {
    ref: 'GR-1', partner: 'opndoor-agents', agency: 'A', agencyId: 'ag-1', branch: 'B', branchId: 'br-1',
    referrer: 'Someone', owner: 0, status: 'deed', rent: 2000, fee: 2000, partnerRate: 0, agentRate: 0.1,
    sentAt: null, paidAt: null, deedAt: null, tenancyStart: null, expiry: null,
    refunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
    deedState: null, deedSentAt: null, deedViewedAt: null,
    ...o,
  } as unknown as FullApp;
}

describe('which orgs hold a deed with nowhere to go', () => {
  it('is the executed deed nobody could receive, at its agency and its branch', () => {
    hydrateFull([app({ awaitingStaffSend: true } as Partial<FullApp>)]);
    const stuck = deedsWithNowhereToGo();
    expect([...stuck.agencies]).toEqual(['ag-1']);
    expect([...stuck.branches]).toEqual(['br-1']);
    hydrateFull([]);
  });

  /* A FAILURE IS NOT "NOWHERE TO GO". It means the deed HAD somewhere to go
     and the address bounced, which is a different problem with a different
     fix (Resend), already badged on the application itself. */
  it('and not a delivery that was attempted and failed', () => {
    hydrateFull([app({ deliveryFailedAt: new Date() } as unknown as Partial<FullApp>)]);
    expect([...deedsWithNowhereToGo().agencies]).toEqual([]);
    hydrateFull([]);
  });

  it('nor an application that has no deed yet', () => {
    hydrateFull([app({ status: 'paid', awaitingStaffSend: true } as unknown as Partial<FullApp>)]);
    expect([...deedsWithNowhereToGo().agencies]).toEqual([]);
    hydrateFull([]);
  });

  it('nor one that was delivered', () => {
    hydrateFull([app({ deedSentAt: new Date() } as unknown as Partial<FullApp>)]);
    expect([...deedsWithNowhereToGo().agencies]).toEqual([]);
    hydrateFull([]);
  });

  /* THE DEMO ESTATE HAS NO BOOK, so no stuck deeds, so no deed warnings.
     That reads correctly rather than accidentally: these warnings have never
     been about the demo. */
  it('and nothing at all with no book loaded', () => {
    hydrateFull([]);
    expect(deedsWithNowhereToGo().agencies.size).toBe(0);
    expect(deedsWithNowhereToGo().branches.size).toBe(0);
  });
});

describe('Matt’s neutral line', () => {
  it('is his words, in one place both surfaces read', () => {
    expect(NO_USERS_YET).toBe('No users yet. Invite someone to start referring.');
  });

  it.each([
    ['the Agencies list', 'src/pages/OrgManagement/OrgManagement.tsx'],
    ['the agency page', 'src/pages/Agencies/AgencyHome.tsx'],
  ])('and %s prints it from there, not its own copy', (_where, path) => {
    expect(read(path)).toContain('{NO_USERS_YET}');
    expect(code(path)).not.toContain('No users yet.');
  });
});

describe('the warning now needs a deed', () => {
  it.each([
    ['the Agencies list', 'src/pages/OrgManagement/OrgManagement.tsx'],
    ['the agency page', 'src/pages/Agencies/AgencyHome.tsx'],
  ])('%s asks whether one is stranded there', (_where, path) => {
    expect(read(path)).toContain('deedsWithNowhereToGo');
  });

  /* THE LIST ALSO NEEDS THE COUNT, and it comes off the RPC. A client-side
     tally would be a positions call per agency on a page built for thousands
     of rows. */
  it('and the list reads the people count off the readiness RPC', () => {
    const src = read('src/pages/OrgManagement/OrgManagement.tsx');
    expect(src).toContain('readiness?.agencyPeople.get(a.id)');
    expect(src).toContain('readiness?.branchPeople.get(b.id)');
  });

  it('which the RPC returns since 20261007800000', () => {
    const mig = read('supabase/migrations/20261007800000_readiness_also_says_whether_anybody_is_there.sql');
    expect(mig).toContain('RETURNS TABLE(agency_id uuid, branch_id uuid, ready boolean, people integer)');
    // A DROP takes the grants with it, so they are restated.
    expect(mig).toContain('GRANT EXECUTE ON FUNCTION public.org_deed_readiness() TO authenticated;');
    expect(mig).toContain('GRANT EXECUTE ON FUNCTION public.org_deed_readiness() TO service_role;');
  });
});
