/* ROUND 6, M9-a. THE ORG COUNTERS COUNTED SOMEBODY ELSE'S TENANTS.
 *
 * `hydrate.ts` builds two indexes, `appsByAgency` and `appsByBranch`, over
 * every application with no rail test, and four counters on each agency and
 * branch are derived from them: referrers, referrals, guaranteed and fees.
 *
 * A DIRECT APPLICATION LANDS IN BOTH. `resolve_agency_match` and the email
 * matcher rewrite a direct signup's `agency_id` and `branch_id` to a REAL
 * agency so a person can service it, while pinning `partner_id` to
 * `opndoor-direct`. So the row looks like Regent's business by every field
 * except the one that decides, and Regent's agency page, the agencies list
 * and the group tree all counted it.
 *
 * `referrers` WAS THE WORST OF THE FOUR. A direct row's `referrer_id` is
 * NULL, so `new Set(bApps.map(x => x.referrer_id))` admitted `null` as a
 * member: a branch whose only traffic was direct reported one referrer who
 * does not exist.
 *
 * WHY IT SURVIVED. Matt's ruling produced four server-side fixes --
 * 20261006410000 for digests, the expiry-cohorts CSV, 20261006580000 for
 * commission_statement_lines and 20261006590000 for agreement_volume -- and
 * the client was never swept. `hydrate.ts` has no rail predicate in it at
 * all; its only channel import was `isHousePartner`, used to flag partner
 * rows as house.
 *
 * THIS RUNS THE REAL hydrateFromSupabase against a stub client, in the
 * pattern established by postLoginShell.render.test.tsx and for the reason
 * given there: hydrate is the one function whose contract is the exact
 * shape of Postgres's reply, so a test that hand-builds the working copy
 * proves nothing about it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TABLES: Record<string, unknown[]> = {};
const RPCS: Record<string, unknown[]> = {};

function builder(rows: unknown[]) {
  const result = { data: rows, error: null };
  const self: Record<string, unknown> = {};
  for (const m of ['select', 'order', 'eq', 'in', 'limit', 'maybeSingle', 'single']) {
    self[m] = () => self;
  }
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
      rpc: (name: string) => builder(RPCS[name] ?? []),
    }),
  };
});

import { hydrateFromSupabase } from './hydrate';
import { hydrateApplications, hydrateFull } from '@/data/applicationsService';
import { getAgencies } from '@/data/orgService';
import { ALL_PARTNERS } from '@/data/types';

/** One application row, in the column names Postgres actually returns. */
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
  referrer_id: 'u1', referrer_name: 'Rosa Vance',
  branch_id: 'b1', agency_id: 'ag1', partner_id: 'p1',
  branch: { name: "Regent's Park" }, agency: { name: "Regent's Lettings" },
  referrer: { full_name: 'Rosa Vance', role: 'management' },
  partner: { slug: 'opndoor-agents' },
  ...over,
});

/* THE TWO ROWS THAT MATTER, and the second is the whole test.
   Both carry the SAME agency_id and branch_id, because that is what the
   matcher does. Only the partner slug and the null referrer tell them
   apart -- which is exactly the state in which the old code counted two. */
const AGENCY_REFERRAL = row({ id: 'a1', guarantee_ref: 'GR-AG' });
const DIRECT_MATCHED_TO_IT = row({
  id: 'a2', guarantee_ref: 'GR-DIRECT',
  partner_id: 'pd', partner: { slug: 'opndoor-direct' },
  // A direct signup has no referrer. This is what put `null` in the Set.
  referrer_id: null, referrer_name: 'Direct signup', referrer: null,
});

beforeEach(() => {
  for (const k of Object.keys(TABLES)) delete TABLES[k];
  for (const k of Object.keys(RPCS)) delete RPCS[k];
  TABLES.partners = [
    { id: 'p1', slug: 'opndoor-agents', name: 'Opndoor Agents', status: 'active', referencing_mode: 'opndoor_referenced', api_access_enabled: false },
    { id: 'pd', slug: 'opndoor-direct', name: 'Opndoor Direct', status: 'active', referencing_mode: null, api_access_enabled: false },
  ];
  TABLES.agencies = [{ id: 'ag1', name: "Regent's Lettings", partner_id: 'p1', partner: { slug: 'opndoor-agents' } }];
  TABLES.agency_groups = [];
  TABLES.branches = [{ id: 'b1', name: "Regent's Park", agency_id: 'ag1', partner_id: 'p1' }];
  TABLES.agent_contacts = [];
  TABLES.application_commission_lines = [];
  RPCS.list_managed_users = [{ id: 'u1', full_name: 'Rosa Vance', email: 'manager@regent.test', role: 'management', status: 'active', partner: 'opndoor-agents' }];
  RPCS.my_partner_rates = [];
  RPCS.application_commission_rates = [];
});

afterEach(() => { hydrateFull([]); hydrateApplications([], []); });

const regent = () => getAgencies(ALL_PARTNERS).find((a) => a.name === "Regent's Lettings")!;

describe('an agency with one referral of its own and one direct signup matched to it', () => {
  beforeEach(() => { TABLES.applications = [AGENCY_REFERRAL, DIRECT_MATCHED_TO_IT]; });

  it('counts one referral, not two', async () => {
    await hydrateFromSupabase('u1');
    expect(regent().referrals).toBe(1);
  });

  it('and its branch counts one', async () => {
    await hydrateFromSupabase('u1');
    expect(regent().branches![0].referrals).toBe(1);
  });

  /* THE NULL IN THE SET. Worse than an off-by-one: it is a person who does
     not exist, on a page that names people. */
  it('and one referrer, not a phantom second one from the direct row’s null', async () => {
    await hydrateFromSupabase('u1');
    expect(regent().branches![0].referrers).toBe(1);
  });

  /* AND THE MONEY, asserted exactly rather than by absence. `money()`
     rounds to thousands, so one row of 2400 x 12 = 28,800 is "£29k" and
     two are "£58k". A not-toMatch on the two-row figure passed before the
     fix as well, because the string it was looking for was never the
     format -- which is its own small lesson about negative assertions on
     formatted output. */
  it('and guarantees only its own rent', async () => {
    await hydrateFromSupabase('u1');
    expect(regent().guaranteed).toBe('£29k');
  });
});

describe('an agency whose only matched traffic is direct', () => {
  beforeEach(() => { TABLES.applications = [DIRECT_MATCHED_TO_IT]; });

  /* THE CLEANEST STATEMENT OF THE DEFECT. Regent referred nothing. Before
     the fix this branch reported one referral and one referrer, and the
     referrer was null. */
  it('shows no referrals at all', async () => {
    await hydrateFromSupabase('u1');
    expect(regent().referrals).toBe(0);
  });

  it('and no referrers', async () => {
    await hydrateFromSupabase('u1');
    expect(regent().branches![0].referrers).toBe(0);
  });
});

describe('but the direct rail keeps its own figures', () => {
  beforeEach(() => { TABLES.applications = [AGENCY_REFERRAL, DIRECT_MATCHED_TO_IT]; });

  /* THE EXCLUSION IS FROM THE TWO ORG INDEXES ONLY. A direct row genuinely
     belongs to opndoor-direct, and `appsByPartner` is what makes the direct
     rail's own figures work, so it is deliberately untouched. Asserted
     because the obvious over-fix is to drop the row on the way in, which
     would take the direct rail's whole book out with it. */
  it('the application is still hydrated, not dropped', async () => {
    await hydrateFromSupabase('u1');
    const { allFull } = await import('@/data/applicationsService');
    const refs = allFull().map((a) => a.ref).sort();
    expect(refs).toEqual(['GR-AG', 'GR-DIRECT']);
  });

  it('and still carries the direct rail as its partner', async () => {
    await hydrateFromSupabase('u1');
    const { allFull } = await import('@/data/applicationsService');
    expect(allFull().find((a) => a.ref === 'GR-DIRECT')!.partner).toBe('opndoor-direct');
  });
});
