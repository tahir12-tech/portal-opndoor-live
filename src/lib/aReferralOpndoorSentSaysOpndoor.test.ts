/* =====================================================================
   (cq) A REFERRAL OPNDOOR SENT ON A CUSTOMER'S BEHALF SAYS "opndoor".

   Matt: "Referrals an Opndoor admin made on a customer's behalf still
   show the admin's name ('Nicholas Dwyer') in that customer's referrer
   lists, charts and exports; show 'opndoor (on your behalf)' in every
   customer view."

   WHY IT IS TESTED AT HYDRATE AND NOT ON SIX SCREENS. The name is made
   here, once, and the Applications list, its referrer filter, the
   referrer chart, the League, the application page and three exports
   all read it. (bm) did the same sweep surface by surface and missed
   the ones it could not see; this is the seam where none can be missed.

   AND WHY THE DATABASE IS ASKED AT ALL. Measured on dev as Kestrel
   Management, on GR-22162: referrer_name reads "Nicholas Dwyer" off
   the application, and `select from users by referrer_id` returns zero
   rows, because users RLS hides opndoor staff from a customer. So the
   embedded role is NULL for exactly the rows that need masking, and a
   client-side mask keyed on it would have been a no-op that looked
   built. opndoor_user_ids answers the one bit, about ids the caller
   already holds.

   This runs the real hydrateFromSupabase against a stub client, in the
   pattern of directDoesNotInflateTheAgency.test.ts.
   ===================================================================== */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TABLES: Record<string, unknown[]> = {};
const RPCS: Record<string, unknown[]> = {};
const rpcCalls: { name: string; args: unknown }[] = [];

function builder(rows: unknown[]) {
  const result = { data: rows, error: null };
  const self: Record<string, unknown> = {};
  for (const m of ['select', 'order', 'eq', 'in', 'limit', 'maybeSingle', 'single']) self[m] = () => self;
  self.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return self;
}

vi.mock('@/lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase')>();
  return {
    ...actual,
    SUPABASE_ENABLED: false,
    sb: () => ({
      from: (table: string) => builder(TABLES[table] ?? []),
      rpc: (name: string, args?: unknown) => { rpcCalls.push({ name, args }); return builder(RPCS[name] ?? []); },
    }),
  };
});

import { hydrateFromSupabase } from './hydrate';
import { hydrateApplications, hydrateFull, getApplications } from '@/data/applicationsService';
import { ALL_PARTNERS } from '@/data/types';
import { OPNDOOR_ON_YOUR_BEHALF } from '@/data/whoSentThisReferral';

const ADMIN = 'u-admin';
const NEGOTIATOR = 'u-neg';

const row = (over: Record<string, unknown>) => ({
  id: 'a1', guarantee_ref: 'GR-1',
  tenant_title: 'Ms', tenant_first_name: 'Amara', tenant_last_name: 'Okonjo',
  tenant_dob: '1992-03-14', tenant_email: 'a@example.test', tenant_phone: '07700900301',
  prop_addr1: '14 Chalcot Square', prop_addr2: null, prop_city: 'London',
  prop_county: null, prop_postcode: 'NW1 8YA',
  monthly_rent: 2400, fee_amount: 1661.54, fee_basis_weeks: 3,
  tenancy_id: null, tenancy_position: null, share_percent: null, share_amount: null,
  status: 'deed', beneficiary: null, tenancy_start: '2026-10-16',
  sent_at: '2026-09-14T09:00:00Z', paid_at: '2026-09-16T09:00:00Z',
  deed_issued_at: '2026-09-22T09:00:00Z', deed_sent_at: null,
  expiry_date: '2027-10-15',
  payment_state: 'paid', refunded_at: null, refunded_amount: null, paid_amount: 1661.54,
  refund_after_start: false, withdrawn_at: null, withdrawn_reason: null, withdrawn_note: null,
  deed_state: 'executed', deed_viewed_at: null, expiry_reminders_sent: 0,
  awaiting_staff_send: false,
  delivery_failed_at: null, delivery_attempted_to: null, delivery_source: null, delivery_reason: null,
  referencing_mode: 'pre_referenced_open', applicant_id: null,
  landlord_name: null, landlord_email: null, elig: null,
  branch_id: 'b1', agency_id: 'ag1', partner_id: 'p1',
  branch: { name: "Regent's Park" }, agency: { name: "Regent's Lettings" },
  partner: { slug: 'opndoor-agents' },
  ...over,
});

/* THE TWO ROWS. The admin's row carries the snapshotted name and NO
   embedded user, which is what a customer's query actually returns:
   users RLS hid it. The negotiator's row has both, as any ordinary
   referral does. */
const SENT_BY_OPNDOOR = row({
  id: 'a1', guarantee_ref: 'GR-22162',
  referrer_id: ADMIN, referrer_name: 'Nicholas Dwyer', referrer: null,
});
const SENT_BY_THE_AGENCY = row({
  id: 'a2', guarantee_ref: 'GR-OWN',
  referrer_id: NEGOTIATOR, referrer_name: 'Rosa Vance',
  referrer: { full_name: 'Rosa Vance', role: 'referrer' },
});

beforeEach(() => {
  for (const k of Object.keys(TABLES)) delete TABLES[k];
  for (const k of Object.keys(RPCS)) delete RPCS[k];
  rpcCalls.length = 0;
  TABLES.partners = [{ id: 'p1', slug: 'opndoor-agents', name: 'Opndoor Agents', status: 'active', referencing_mode: 'opndoor_referenced', api_access_enabled: false }];
  TABLES.agencies = [{ id: 'ag1', name: "Regent's Lettings", partner_id: 'p1', partner: { slug: 'opndoor-agents' } }];
  TABLES.agency_groups = [];
  TABLES.branches = [{ id: 'b1', name: "Regent's Park", agency_id: 'ag1', partner_id: 'p1' }];
  TABLES.agent_contacts = [];
  TABLES.application_commission_lines = [];
  TABLES.applications = [SENT_BY_OPNDOOR, SENT_BY_THE_AGENCY];
  RPCS.list_managed_users = [{ id: NEGOTIATOR, full_name: 'Rosa Vance', email: 'rosa@regent.test', role: 'referrer', status: 'active', partner: 'opndoor-agents' }];
  RPCS.my_partner_rates = [];
  RPCS.application_commission_rates = [];
  RPCS.opndoor_user_ids = [ADMIN];
});
afterEach(() => { hydrateFull([]); hydrateApplications([], []); });

const byRef = (ref: string) => getApplications({ role: 'management', scope: ALL_PARTNERS }).find((a) => a.ref === ref);

describe('a customer reading their own referrals', () => {
  it('is told opndoor sent the one opndoor sent', async () => {
    await hydrateFromSupabase(NEGOTIATOR);
    expect(byRef('GR-22162')?.referrer).toBe(OPNDOOR_ON_YOUR_BEHALF);
  });

  /* THE STAFF NAME IS GONE, asserted on its own: the label being right
     does not prove the name is not also somewhere in the row. */
  it('and never sees the member of staff by name', async () => {
    await hydrateFromSupabase(NEGOTIATOR);
    expect(JSON.stringify(byRef('GR-22162'))).not.toContain('Nicholas Dwyer');
  });

  it('and their own colleague is still named', async () => {
    await hydrateFromSupabase(NEGOTIATOR);
    expect(byRef('GR-OWN')?.referrer).toBe('Rosa Vance');
  });

  /* ASKED ABOUT THE DISTINCT REFERRERS AND THE READER, in one call. The
     reader goes in so that "is this reader opndoor staff" comes from the
     same answer as "was the referrer", with no second copy of the rule.

     AND ONLY ABOUT THE ONES IT COULD NOT READ. The colleague's row came
     back on the embed, so their role is already known and they are not
     in the question; the admin's did not, which is precisely the state
     that needs masking. */
  it('by asking the database once, about the ids it could not read', async () => {
    await hydrateFromSupabase(NEGOTIATOR);
    const call = rpcCalls.filter((c) => c.name === 'opndoor_user_ids');
    expect(call).toHaveLength(1);
    expect((call[0].args as { p_users: string[] }).p_users.sort()).toEqual([ADMIN, NEGOTIATOR].sort());
  });
});

describe('a book with nothing to mask', () => {
  /* THE SIGN-IN PATH PAYS NOTHING. (dg) is about what sign-in costs, and
     an unconditional round trip to answer a question about rows that
     usually do not exist would be taking with one hand. Every referrer
     readable means no question. */
  it('asks nothing at all', async () => {
    TABLES.applications = [SENT_BY_THE_AGENCY];
    await hydrateFromSupabase(NEGOTIATOR);
    expect(rpcCalls.filter((c) => c.name === 'opndoor_user_ids')).toHaveLength(0);
    expect(byRef('GR-OWN')?.referrer).toBe('Rosa Vance');
  });
});

describe('opndoor reading the same book', () => {
  /* THEIR OWN LISTS ARE WHERE "who sent this" IS A REAL QUESTION, so no
     mask. The reader is recognised by being in the same answer. */
  it('sees the member of staff by name', async () => {
    RPCS.opndoor_user_ids = [ADMIN];
    await hydrateFromSupabase(ADMIN);
    expect(byRef('GR-22162')?.referrer).toBe('Nicholas Dwyer');
  });
});

describe('when the question cannot be asked', () => {
  /* A LABEL IS NOT WORTH A LOGIN. An empty answer leaves every name as
     the product showed it yesterday rather than failing the hydrate. */
  it('hydrates anyway, with the name unmasked', async () => {
    RPCS.opndoor_user_ids = [];
    await hydrateFromSupabase(NEGOTIATOR);
    expect(byRef('GR-22162')?.referrer).toBe('Nicholas Dwyer');
    expect(byRef('GR-OWN')?.referrer).toBe('Rosa Vance');
  });
});
