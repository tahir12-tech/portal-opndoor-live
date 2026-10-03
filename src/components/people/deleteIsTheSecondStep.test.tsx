/* SOMEBODY WITH NO ACCESS STAYED ON EVERY PEOPLE LIST FOR EVER.
 *
 * Matt, 2026-10-03, verbatim: "After access is removed, offer 'Delete':
 * 'Delete Joe Joe? They disappear from People. Their name stays on referrals
 * and activity they're part of.' The person is removed from People lists and
 * can never sign in, but their name stays wherever they appear on past
 * records. Recorded in Recent changes. Removed-but-not-deleted people show as
 * 'No access' with a 'Restore access' option."
 *
 * TWO STEPS, AND THE SECOND ONE DID NOT EXIST. A deactivated row offered
 * Restore access and nothing else, so the only way to tidy somebody off the
 * list was to leave them on it. Delete is now beside Restore -- Restore
 * first, because it is the recoverable one.
 *
 * AND IT DELETES NOTHING, which is Matt's second sentence and the whole
 * design. The person row stays: `applications.referrer_id` and
 * `user_audit.target_user` point at it, and a real delete would either fail on
 * those keys or cascade and take a name off a guarantee that person really did
 * refer. What changes is that `list_managed_users` stops returning them. The
 * SQL half is proved against dev in a_deleted_person_keeps_their_name.test.sql
 * -- including that the application, its snapshotted referrer name and the
 * audit row all survive -- and this file is the client half.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { PersonActions } from './PersonActions';
import { PeopleTable } from './PeopleTable';
import { deleteAsk } from './personConfirm';
import { ALL_PARTNERS } from '@/data/types';

afterEach(cleanup);
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const person = (status: string) => ({
  userId: 'u1', name: 'Joe Joe', email: 'joe@example.co.uk', status, agencyLevel: 'Negotiator',
});

function labels(status: string): string[] {
  const { container } = render(
    <PersonActions
      person={person(status)} isAdmin manyOffices={false}
      onAction={() => {}} onCancelInvite={() => {}} onChangeLevel={() => {}} onPosition={() => {}}
    />,
  );
  return [...container.querySelectorAll('button')].map((b) => b.textContent ?? '');
}

describe('the row of somebody with no access', () => {
  it('offers Restore access and Delete, in that order', () => {
    const l = labels('deactivated');
    expect(l).toContain('Restore access');
    expect(l).toContain('Delete');
    expect(l.indexOf('Restore access')).toBeLessThan(l.indexOf('Delete'));
  });

  /* DELETE IS OFFERED NOWHERE ELSE. "After access is removed" is the
     precondition, and the RPC refuses an active person too -- so this is the
     screen agreeing with the server rather than the only thing stopping it. */
  it('and nowhere else', () => {
    expect(labels('active')).not.toContain('Delete');
    expect(labels('pending')).not.toContain('Delete');
  });

  it('while an active row still offers Remove access', () => {
    expect(labels('active')).toContain('Remove access');
    expect(labels('active')).not.toContain('Restore access');
  });
});

describe('the pill', () => {
  /* "No access", which is the wording the two buttons have always used.
     "Deactivated" was a third word for the same state and the only one of
     the three that is ours rather than English. */
  it('reads "No access", not "Deactivated"', () => {
    const { container } = render(
      <PeopleTable
        showFilters={false}
        rows={[{ id: 'u1', name: 'Joe Joe', email: 'joe@example.co.uk', level: 'Negotiator', status: 'deactivated' }]}
      />,
    );
    expect(container.textContent).toContain('No access');
    expect(container.textContent).not.toContain('Deactivated');
  });

  it('and the status filters say the same', () => {
    for (const p of ['src/pages/Team/Team.tsx', 'src/pages/Agencies/AgencyHome.tsx']) {
      expect(read(p)).toContain('<option value="deactivated">No access</option>');
      expect(read(p)).not.toContain('<option value="deactivated">Deactivated</option>');
    }
  });
});

describe('the question it asks', () => {
  it('is Matt’s sentence, naming what survives', () => {
    expect(deleteAsk('Joe Joe').title).toBe('Delete Joe Joe?');
    expect(deleteAsk('Joe Joe').body)
      .toBe('They disappear from People. Their name stays on referrals and activity they’re part of.');
  });

  it('and every surface asks it before deleting', () => {
    for (const p of [
      'src/pages/Agencies/AgencyHome.tsx',
      'src/pages/PartnerManagement/PartnerHome.tsx',
      'src/pages/Team/Team.tsx',
      'src/pages/UserManagement/UserManagement.tsx',
    ]) {
      expect(read(p), p).toContain('deleteAsk(');
      expect(read(p), p).toContain('deleteUser(');
    }
  });
});

describe('the mock path keeps the same rule as the database', () => {
  /* THE DEMO BOOK, not the opndoor team: the team list holds two people and
     these tests mutate the module's working copy, so taking from the wider
     list keeps each one independent of the last. */
  const book = async () => {
    const users = await import('@/data/usersService');
    return { users, list: users.getUsers({ viewer: 'superadmin', team: false, scope: ALL_PARTNERS }) };
  };

  it('refuses to delete somebody who still has access', async () => {
    const { users, list } = await book();
    const active = list.find((u) => u.status === 'active');
    expect(active, 'no active user in the demo book').toBeTruthy();
    await expect(users.deleteUser(active!.id)).rejects.toThrow(/Remove their access first/);
  });

  it('and takes a deleted person off the lists', async () => {
    const { users, list } = await book();
    const target = list.find((u) => u.status === 'active');
    expect(target).toBeTruthy();
    await users.setUserStatus(target!.id, 'deactivated');
    await users.deleteUser(target!.id);
    const after = users.getUsers({ viewer: 'superadmin', team: false, scope: ALL_PARTNERS });
    expect(after.map((u) => u.id)).not.toContain(target!.id);
  });

  /* AND IT IS RECORDED. Matt: "Recorded in Recent changes", which reads
     user_audit in live mode and this store in the demo. */
  it('and records the change', async () => {
    const { users, list } = await book();
    const target = list.find((u) => u.status === 'active');
    expect(target).toBeTruthy();
    await users.setUserStatus(target!.id, 'deactivated');
    await users.deleteUser(target!.id);
    const audit = await users.getUserAudit(target!.id);
    expect(audit.some((a) => a.newValue === 'deleted')).toBe(true);
  });
});

/* THE ONE CLAUSE THAT DOES THE WORK, in the migration, asserted so the
   client's own filter can never become the only thing holding the rule. */
describe('the list itself', () => {
  it('excludes a deleted person in SQL, for all four screens at once', () => {
    const mig = read('supabase/migrations/20261007810000_a_deleted_person_keeps_their_name.sql');
    expect(mig).toContain("and u.status <> 'deleted'");
    expect(mig).toContain("CHECK (status = ANY (ARRAY['active'::text, 'pending'::text, 'deactivated'::text, 'deleted'::text]))");
  });

  /* CODE ONLY: the migration's own header explains at length why it is NOT a
     `delete from public.users`, so a scan of the raw file finds the phrase it
     is asserting the absence of. */
  it('and nothing in that migration deletes a row', () => {
    const mig = read('supabase/migrations/20261007810000_a_deleted_person_keeps_their_name.sql')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');
    expect(mig).not.toMatch(/delete\s+from\s+public\.users/i);
    expect(mig).not.toMatch(/delete\s+from\s+public\.applications/i);
  });
});
