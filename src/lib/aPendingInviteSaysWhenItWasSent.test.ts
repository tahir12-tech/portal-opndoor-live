/* "INVITED [DATE]", NOT THE STATUS SAID TWICE.
 *
 * Matt, 2026-10-02, verbatim: "Use the same shared people table as every
 * other people screen, with Sees and Last active (or "Invited [date]" for
 * pending invites)."
 *
 * Last active is relative time since auth.users.last_sign_in_at, which
 * somebody who has never signed in has not got, so every pending row read
 * "Pending invite" -- the pill's own word in the date column, saying
 * nothing about how long the invitation had been out. That is the one
 * thing worth knowing about a pending row: an invitation sent this
 * morning needs no action and one sent five weeks ago does.
 *
 * RUN THROUGH THE REAL hydrateFromSupabase against a stub client, in the
 * pattern directDoesNotInflateTheAgency.test.ts established and for the
 * same reason: the wording is decided by what Postgres returns, so a test
 * that hand-builds a ManagedUser proves nothing about the path that
 * produces one. `invited_at` is new on list_managed_users in
 * 20261007480000.
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
import { getUsers } from '@/data/usersService';

const user = (over: Record<string, unknown>) => ({
  id: 'u1', full_name: 'Rosa Vance', email: 'manager@regent.test',
  role: 'management', status: 'active', partner_slug: 'opndoor-agents',
  last_sign_in_at: null, invited_at: null, sees_commission: true,
  ...over,
});

beforeEach(() => {
  for (const k of Object.keys(TABLES)) delete TABLES[k];
  for (const k of Object.keys(RPCS)) delete RPCS[k];
  TABLES.partners = [{ id: 'p1', slug: 'opndoor-agents', name: 'Opndoor Agents', status: 'active', referencing_mode: 'opndoor_referenced', api_access_enabled: false }];
  TABLES.agencies = [];
  TABLES.agency_groups = [];
  TABLES.branches = [];
  TABLES.agent_contacts = [];
  TABLES.applications = [];
  TABLES.application_commission_lines = [];
  RPCS.my_partner_rates = [];
  RPCS.application_commission_rates = [];
});

afterEach(() => { hydrateFull([]); hydrateApplications([], []); });

const lastActiveOf = (email: string) =>
  getUsers({ viewer: 'superadmin', team: false, scope: 'opndoor-agents' })
    .find((u) => u.email === email)?.lastActive;

describe('a pending invite', () => {
  it('says the date it was sent', async () => {
    RPCS.list_managed_users = [user({
      id: 'u2', full_name: 'Independent Director', email: 'dir@independent.test',
      role: 'management', status: 'pending', invited_at: '2026-09-29T09:12:00Z',
    })];
    await hydrateFromSupabase('u1');
    expect(lastActiveOf('dir@independent.test')).toBe('Invited 29 Sep 2026');
  });

  /* AND NOT A RELATIVE TIME IT HAPPENS TO CARRY. A person deactivated and
     re-invited keeps their old last_sign_in_at, and "3 weeks ago" against
     an outstanding invitation reads as somebody working. Pending is tested
     before the timestamp for this row. */
  it('even when they signed in before, under an earlier invitation', async () => {
    RPCS.list_managed_users = [user({
      id: 'u3', email: 'back@independent.test', status: 'pending',
      last_sign_in_at: '2026-09-01T09:00:00Z', invited_at: '2026-10-01T09:00:00Z',
    })];
    await hydrateFromSupabase('u1');
    expect(lastActiveOf('back@independent.test')).toBe('Invited 1 Oct 2026');
  });

  /* NO DATE AT ALL still has to say something, and the old word is the
     right one: list_managed_users coalesces invited_at with the users row's
     created_at, so this is a row made some way neither stamped. */
  it('falls back to the old wording when nothing stamped a date', async () => {
    RPCS.list_managed_users = [user({
      id: 'u4', email: 'nodate@independent.test', status: 'pending', invited_at: null,
    })];
    await hydrateFromSupabase('u1');
    expect(lastActiveOf('nodate@independent.test')).toBe('Pending invite');
  });
});

describe('and everybody else', () => {
  it('still reads as relative time since they last signed in', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    RPCS.list_managed_users = [user({ email: 'rosa@regent.test', last_sign_in_at: twoHoursAgo })];
    await hydrateFromSupabase('u1');
    expect(lastActiveOf('rosa@regent.test')).toBe('2 hours ago');
  });

  /* A '-' AND NOT A DATE, because an active person with no sign-in has
     accepted their invitation and not come back; the invitation's date
     would read as activity. */
  it('and an active person who has never signed in is a dash', async () => {
    RPCS.list_managed_users = [user({
      email: 'never@regent.test', last_sign_in_at: null, invited_at: '2026-09-01T09:00:00Z',
    })];
    await hydrateFromSupabase('u1');
    expect(lastActiveOf('never@regent.test')).toBe('-');
  });
});

/* AND WHEN IT RUNS OUT, AND WHETHER IT STILL WORKS.
 *
 * Matt, 2026-10-09: "7-day links, Accept invite page, sent date, expiry,
 * resend and cancel." 20261009100000 adds staff_invites and carries its
 * sent date, expiry and state through list_managed_users.
 *
 * THE SENT DATE IS THE LIVE LINK'S, which is the part that was wrong rather
 * than missing: auth.users.invited_at is stamped once when the account is
 * made and never moves, so after a resend the cell named the wrong day. Matt
 * pressed Resend for Ethan Li at about 11:20 and the row still showed the
 * previous afternoon.
 */
describe('and the invitation itself', () => {
  const pending = (over: Record<string, unknown>) => user({
    id: 'u9', email: 'inv@independent.test', status: 'pending',
    invited_at: '2026-10-01T09:00:00Z', ...over,
  });

  it('says when the live link was sent and when it expires', async () => {
    RPCS.list_managed_users = [pending({
      invite_sent_at: '2026-10-09T11:20:00Z',
      invite_expires_at: '2026-10-16T11:20:00Z',
      invite_state: 'live',
    })];
    await hydrateFromSupabase('u1');
    expect(lastActiveOf('inv@independent.test')).toBe('Invited 9 Oct 2026, expires 16 Oct 2026');
  });

  /* THE RESEND CASE, STATED AS ITS OWN ASSERTION. invited_at here is 1
     October and the live link went out on the 9th. Reading invited_at would
     print the first of the month beside a link that is eight days younger,
     which is what Matt was looking at. */
  it('and prefers the resent date over the date the account was made', async () => {
    RPCS.list_managed_users = [pending({
      invited_at: '2026-10-01T09:00:00Z',
      invite_sent_at: '2026-10-09T11:20:00Z',
      invite_expires_at: '2026-10-16T11:20:00Z',
      invite_state: 'live',
    })];
    await hydrateFromSupabase('u1');
    expect(lastActiveOf('inv@independent.test')).not.toContain('1 Oct');
  });

  /* AN EXPIRED ONE NAMES A JOB. "Invited 2 October" beside somebody who
     cannot get in reads as patience; this reads as a resend. */
  it('says an expired invitation has expired, and when', async () => {
    RPCS.list_managed_users = [pending({
      invite_sent_at: '2026-09-25T09:00:00Z',
      invite_expires_at: '2026-10-02T09:00:00Z',
      invite_state: 'expired',
    })];
    await hydrateFromSupabase('u1');
    expect(lastActiveOf('inv@independent.test')).toBe('Invite expired 2 Oct 2026');
  });

  it('and says a cancelled one was cancelled', async () => {
    RPCS.list_managed_users = [pending({ invite_state: 'cancelled' })];
    await hydrateFromSupabase('u1');
    expect(lastActiveOf('inv@independent.test')).toBe('Invite cancelled');
  });

  /* WHERE ETHAN LI SAT FOR A DAY: he opened the link and signed in but never
     enrolled his authenticator, so the invitation is spent and he is still
     pending. "Pending invite" said none of that. */
  it('and tells an administrator when somebody opened it but never finished', async () => {
    RPCS.list_managed_users = [pending({
      invite_sent_at: '2026-10-08T17:17:00Z',
      invite_expires_at: '2026-10-15T17:17:00Z',
      invite_state: 'used',
    })];
    await hydrateFromSupabase('u1');
    expect(lastActiveOf('inv@independent.test')).toBe('Opened 8 Oct 2026, two-factor not set up');
  });

  /* AND A ROW FROM BEFORE THE TABLE EXISTED keeps the wording it had, which
     is what every person already invited on live will read as. */
  it('and keeps the old wording for somebody invited before any of this', async () => {
    RPCS.list_managed_users = [pending({ invite_state: 'none' })];
    await hydrateFromSupabase('u1');
    expect(lastActiveOf('inv@independent.test')).toBe('Invited 1 Oct 2026');
  });
});
