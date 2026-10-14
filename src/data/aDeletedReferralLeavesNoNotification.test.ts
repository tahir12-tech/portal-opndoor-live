/* A DELETED REFERRAL LEAVES NO NOTIFICATION.
 *
 * Matt, 2026-10-12: "After I deleted test application GR-20608, its 'New
 * referral sent' notification stayed in my bell, linking to a referral that no
 * longer exists. Notifications for a deleted application should go."
 *
 * THE DATABASE AND THE QUERY ALREADY GUARANTEE IT, and these assertions are
 * what say so, because "it works" is not a thing to leave unwritten after
 * somebody has reported the opposite:
 *
 *   * activity_log.application_id is ON DELETE CASCADE, so deleting an
 *     application takes its activity rows with it. There is no soft delete to
 *     leave a tombstone: applications.status has no 'deleted' member, and dev
 *     holds no orphan activity row and none with a null application_id.
 *   * getNotifications joins `applications!inner`, so a row that somehow
 *     outlived its application is dropped by the join rather than rendered
 *     against a blank tenant name.
 *
 * WHAT ACTUALLY SURVIVED was the Topbar's React state, fetched before the
 * delete and held until the panel's open flag next changed. That is fixed by
 * giving the effect the session's dataVersion as a second dependency, and
 * asserted at the bottom.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const ROWS: Record<string, unknown[]> = {};
let LAST_SELECT = '';

function builder(table: string) {
  const self: Record<string, unknown> = {};
  for (const m of ['eq', 'in', 'order', 'limit', 'gte', 'lte', 'not', 'is']) self[m] = () => self;
  self.select = (cols: string) => { LAST_SELECT = cols; return self; };
  self.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: ROWS[table] ?? [], error: null }).then(resolve);
  return self;
}

vi.mock('@/lib/supabase', () => ({
  SUPABASE_ENABLED: true,
  sb: () => ({ from: (t: string) => builder(t) }),
}));

const { getNotifications } = await import('./activityService');

const row = (ref: string, app: unknown) => ({
  kind: 'referral_created', at: '2026-10-12T09:00:00.000Z', application: app,
  ...(ref ? {} : {}),
});

beforeEach(() => { for (const k of Object.keys(ROWS)) delete ROWS[k]; LAST_SELECT = ''; });
afterEach(() => { vi.clearAllMocks(); });

describe('the notification query', () => {
  /* THE INNER JOIN IS THE GUARANTEE. Written as an assertion on the query
     because it is one character, `!inner`, and dropping it would silently
     start returning notifications for applications nobody can open. */
  it('requires the application to exist, so a deleted one cannot come back', async () => {
    ROWS.activity_log = [];
    await getNotifications();
    expect(LAST_SELECT).toContain('applications!inner');
  });

  it('shows a notification while its application is there', async () => {
    ROWS.activity_log = [row('GR-20608', {
      guarantee_ref: 'GR-20608', tenant_first_name: 'Test', tenant_last_name: 'Tenant',
    })];
    const out = await getNotifications();
    expect(out).toHaveLength(1);
    expect(out[0].ref).toBe('GR-20608');
    expect(out[0].text).toBe('New referral sent to Test Tenant');
  });

  /* AND DROPS ONE WHOSE APPLICATION HAS GONE, which is what PostgREST returns
     for an inner join with nothing on the other side, and is the shape a
     stale row would arrive in if the join were ever loosened. */
  it('and drops one whose application has gone', async () => {
    ROWS.activity_log = [row('GR-20608', null)];
    expect(await getNotifications()).toHaveLength(0);
  });

  it('and does not invent a tenant name for a half-joined row', async () => {
    ROWS.activity_log = [row('', { guarantee_ref: null, tenant_first_name: null, tenant_last_name: null })];
    const out = await getNotifications();
    expect(out.every((n) => n.ref)).toBe(true);
  });
});

describe('the bell does not outlive the book', () => {
  const TOPBAR = readFileSync('src/components/layout/Topbar.tsx', 'utf8');

  /* THE FIX, ASSERTED ON THE SOURCE because the thing being prevented is a
     missing dependency and there is nothing else to look at. Without
     dataVersion the list is whatever was true when the panel's open flag last
     changed, which is exactly the stale item Matt saw. */
  it('refetches when the data underneath moves, not only when the panel opens', () => {
    expect(TOPBAR).toContain("}, [pop === 'notif', dataVersion]);");
  });

  it('and takes dataVersion from the session rather than counting for itself', () => {
    expect(TOPBAR).toContain('setScopeSel, dataVersion } = useSession();');
  });
});

describe('there is no soft delete to leave a tombstone', () => {
  /* ASSERTED ON THE MIGRATION FILES, so adding a 'deleted' status later cannot
     quietly reintroduce the shape this item was about: an application that is
     gone from every screen while its activity rows, and so its notification,
     are still there. */
  const sql = readFileSync('supabase/migrations/20260702134239_core_schema.sql', 'utf8');

  it('applications have no deleted status', () => {
    const m = sql.match(/status text[^,]*check \(status in \(([^)]*)\)\)/i);
    expect(m).toBeTruthy();
    expect(m![1]).not.toContain('deleted');
  });
});
