/* THE SCREEN YOU GET AFTER SIGNING IN, AND THE FUNCTION THAT FILLS IT.

   A live sign-in crashed with "Cannot access 'toDate' before initialization"
   and dropped the user back to the sign-in page. The cause was mundane: two
   calls to `toDate` were added to the listOut mapping in hydrateFromSupabase,
   and `const toDate` is declared BELOW that mapping. The mapping's callback
   runs immediately, so the const was still in its temporal dead zone.

   WHAT LET IT THROUGH IS THE INTERESTING PART, and it is what this file exists
   to close:

     * TYPESCRIPT CANNOT CATCH IT. A callback handed to .map() might run at any
       time, so a block-scoped variable referenced inside one is not a
       use-before-declaration as far as the compiler is concerned. `npm run
       typecheck` was clean on the broken build.
     * NO TEST REACHED IT. SUPABASE_ENABLED is `Boolean(url && key) &&
       import.meta.env.MODE !== 'test'`, so it is false in vitest BY
       CONSTRUCTION. hydrateFromSupabase is the one function in the app that
       only ever runs in the mode the suite cannot enter, and it is also the
       first thing that runs after a real sign-in. 585 tests passed over it.

   So this file does two things, and the first matters more than the second:

     1. Runs the REAL hydrateFromSupabase against a stubbed client. Not a
        reimplementation of it, not a mock of it: the actual function, with the
        actual column names, over rows shaped like the ones Postgres returns.
        Any ordering fault inside it fails here.
     2. Renders the post-login shell, which is what the user was looking at
        when it broke.
*/
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/* ---------------------------------------------------------------------------
   A stub Supabase client.

   PostgREST's builder is thenable at every step: `.select()` can be awaited,
   and so can `.select().order().order()`. The stub is one self-returning object
   that resolves to the rows registered for whichever table `.from()` was last
   handed, which is enough for hydrate and short enough to read.
--------------------------------------------------------------------------- */
const TABLES: Record<string, unknown[]> = {};
const RPCS: Record<string, unknown[]> = {};

function builder(rows: unknown[]) {
  const result = { data: rows, error: null };
  const self: Record<string, unknown> = {};
  for (const m of ['select', 'order', 'eq', 'in', 'limit', 'maybeSingle', 'single']) {
    self[m] = () => self;
  }
  // Thenable, so `await client.from(x).select(y)` resolves to { data, error }.
  self.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return self;
}

vi.mock('@/lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase')>();
  return {
    ...actual,
    // Left FALSE. The point is not to make the app think it is live; it is to
    // call hydrateFromSupabase directly with a client that answers.
    SUPABASE_ENABLED: false,
    sb: () => ({
      from: (table: string) => builder(TABLES[table] ?? []),
      rpc: (name: string) => builder(RPCS[name] ?? []),
    }),
  };
});

import { hydrateFromSupabase } from './hydrate';
import { allFull, allSummaries, hydrateApplications, hydrateFull } from '@/data/applicationsService';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { AppShell } from '@/components/layout/AppShell';

/** One application row, in the column names Postgres actually returns. */
const APP_ROW = {
  id: 'a1', guarantee_ref: 'GR-1',
  tenant_title: 'Ms', tenant_first_name: 'Amara', tenant_last_name: 'Okonjo',
  tenant_dob: '1992-03-14', tenant_email: 'a@example.test', tenant_phone: '07700900301',
  prop_addr1: '14 Chalcot Square', prop_addr2: null, prop_city: 'London',
  prop_county: null, prop_postcode: 'NW1 8YA',
  monthly_rent: 2400, fee_amount: 1661.54, fee_basis_weeks: 3,
  tenancy_id: null, tenancy_position: null, share_percent: null, share_amount: null,
  status: 'deed', beneficiary: null, tenancy_start: '2026-10-16',
  // The four the crash was about: every one of these reaches toDate.
  sent_at: '2026-09-14T09:00:00Z',
  paid_at: '2026-09-16T09:00:00Z',
  deed_issued_at: '2026-09-22T09:00:00Z',
  deed_sent_at: '2026-09-21T09:00:00Z',
  expiry_date: '2027-10-15',
  payment_state: 'paid', refunded_at: null, refunded_amount: null, paid_amount: 1661.54,
  refund_after_start: false, withdrawn_at: null, withdrawn_reason: null, withdrawn_note: null,
  deed_state: 'executed', deed_viewed_at: null, expiry_reminders_sent: 0,
  awaiting_staff_send: false,
  delivery_failed_at: '2026-09-23T09:00:00Z',
  delivery_attempted_to: 'manager@regent.test',
  delivery_source: 'org_person',
  delivery_reason: 'mailbox full',
  referencing_mode: 'pre_referenced_open', applicant_id: null,
  landlord_name: null, landlord_email: null, elig: null,
  referrer_id: 'u1', referrer_name: 'Rosa Vance',
  branch_id: 'b1', agency_id: 'ag1', partner_id: 'p1',
  branch: { name: "Regent's Park" }, agency: { name: "Regent's Lettings" },
  referrer: { full_name: 'Rosa Vance', role: 'management' },
  partner: { slug: 'opndoor-agents' },
};

beforeEach(() => {
  for (const k of Object.keys(TABLES)) delete TABLES[k];
  for (const k of Object.keys(RPCS)) delete RPCS[k];
  TABLES.partners = [{ id: 'p1', slug: 'opndoor-agents', name: 'Opndoor Agents', status: 'active', referencing_mode: 'opndoor_referenced', api_access_enabled: false }];
  TABLES.agencies = [{ id: 'ag1', name: "Regent's Lettings", partner_id: 'p1', partner: { slug: 'opndoor-agents' } }];
  TABLES.agency_groups = [];
  TABLES.branches = [{ id: 'b1', name: "Regent's Park", agency_id: 'ag1', partner_id: 'p1' }];
  TABLES.agent_contacts = [];
  TABLES.applications = [APP_ROW];
  TABLES.application_commission_lines = [
    { application_id: 'a1', level: 'agency', org_id: 'ag1', org_name: "Regent's Lettings", rate: 0.2, source: 'agreement', basis_amount: 1661.54 },
  ];
  RPCS.list_managed_users = [{ id: 'u1', full_name: 'Rosa Vance', email: 'manager@regent.test', role: 'management', status: 'active', partner: 'opndoor-agents' }];
  RPCS.my_partner_rates = [];
  RPCS.application_commission_rates = [];
});

afterEach(() => { cleanup(); hydrateFull([]); hydrateApplications([], []); });

describe('hydrateFromSupabase, the first thing that runs after signing in', () => {
  it('completes without throwing', async () => {
    // THE REGRESSION. On the broken build this rejected with
    // "Cannot access 'toDate' before initialization" and the user was returned
    // to the sign-in screen with no way forward.
    await expect(hydrateFromSupabase('u1')).resolves.toBeUndefined();
  });

  it('fills the summary row, including every date it reads through toDate', async () => {
    await hydrateFromSupabase('u1');
    const [row] = allSummaries();
    expect(row.ref).toBe('GR-1');
    // These four are the calls that were in the dead zone.
    expect(row.deedSentAt).toBeInstanceOf(Date);
    expect(row.deliveryFailedAt).toBeInstanceOf(Date);
    expect(row.deliveryAttemptedTo).toBe('manager@regent.test');
    expect(row.deliverySource).toBe('org_person');
  });

  it('fills the full row too, so the two mappings stay in step', async () => {
    await hydrateFromSupabase('u1');
    const [full] = allFull();
    expect(full.ref).toBe('GR-1');
    expect(full.sentAt).toBeInstanceOf(Date);
    expect(full.paidAt).toBeInstanceOf(Date);
    expect(full.deedAt).toBeInstanceOf(Date);
    // A DATE column, which takes the other helper and must not drift to UTC.
    expect(full.tenancyStart).toBeInstanceOf(Date);
    expect(full.fee).toBe(1661.54);
  });

  it('a null timestamp stays null rather than becoming the epoch', async () => {
    TABLES.applications = [{ ...APP_ROW, deed_sent_at: null, delivery_failed_at: null, paid_at: null }];
    await hydrateFromSupabase('u1');
    expect(allSummaries()[0].deedSentAt).toBeNull();
    expect(allSummaries()[0].deliveryFailedAt).toBeNull();
    expect(allFull()[0].paidAt).toBeNull();
  });

  it('survives an empty book, which is a brand new agency on its first sign-in', async () => {
    TABLES.applications = [];
    TABLES.application_commission_lines = [];
    await expect(hydrateFromSupabase('u1')).resolves.toBeUndefined();
    expect(allSummaries()).toHaveLength(0);
  });
});

describe('the post-login shell', () => {
  it('renders, which is the screen the crash replaced with a sign-in page', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <ToastProvider>
          <SessionProvider>
            <PageMetaProvider>
              <AppShell />
            </PageMetaProvider>
          </SessionProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    // The sidebar wordmark is the cheapest proof the shell mounted and that
    // nothing in the module graph threw on the way in. A circular import would
    // fail here before any assertion ran, which is why the test is worth having
    // even though the actual fault turned out to be simpler than that.
    await waitFor(() => expect(screen.getByText('opndoor')).toBeTruthy());
  });
});
