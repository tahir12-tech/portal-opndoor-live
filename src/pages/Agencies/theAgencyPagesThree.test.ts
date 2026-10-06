/* THE AGENCY PAGE'S THREE, 2026-10-02.
 *
 * Matt:
 *   1. "When the only person who could receive the deed has a pending
 *      invite, say 'Independent Director hasn't accepted their invite
 *      yet; deeds will reach them once they do' instead of 'No one at
 *      this agency can receive the deed'."
 *   2. "'invited set to management' should read 'Independent Director
 *      invited as Director', using agency level names (Director,
 *      Manager, Negotiator) everywhere on agency pages."
 *   3. "The 'Set rate' button beside the agency name: if commission is
 *      set on the Commission tab, remove it so there's one place to set
 *      commission."
 *
 * ONE IS A DIFFERENT JOB, NOT A DIFFERENT WORDING. The readiness RPC
 * answers false for an empty agency and for one whose only person has
 * not accepted, and rightly: a deed cannot be delivered today either
 * way. But "nobody here" asks an admin to invite somebody, and doing
 * that where an invitation is already out produces a second one. "They
 * have not accepted yet" asks for nothing and resolves itself.
 *
 * TWO IS A SHAPE PROBLEM. `agency_changes` passed a `user_audit` row
 * through as a FIELD PAIR -- field 'invited', value 'management' -- and
 * a field pair can only ever render as "X set to Y". The value is the
 * ROLE, and Director and Manager are the same role differing only by
 * `sees_commission`, so no better sentence over that value could have
 * named the level.
 *
 * THREE MOVED A CAPABILITY RATHER THAN REMOVING ONE. The Commission tab
 * listed the rates that WERE set, so the tree's button was the only way
 * to set a first. Both halves changed together.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { changeSentence } from '@/data/changeSentence';

const read = (p: string) => readFileSync(p, 'utf8');
const home = read('src/pages/Agencies/AgencyHome.tsx');

describe('an unaccepted invite is not an empty agency', () => {
  it('so the page says they have not accepted yet, naming them', () => {
    expect(home).toContain("hasn’t accepted their invite yet; deeds will reach them once they do.");
  });

  /* ONLY WHEN EVERY PERSON IS WAITING. One pending invite beside an
     active Director is not why the deed cannot be delivered, and
     saying so would explain the wrong thing. */
  it('and only when every person there is waiting', () => {
    expect(home).toContain("waiting.length && waiting.length === agencyPeople.length");
  });

  it('while an agency with nobody in it still says so', () => {
    expect(home).toContain('No one at this agency can receive the deed. Invite a manager or nominate a recipient.');
  });
});

describe('an invite is said in agency levels', () => {
  it('as "Invited as Director", not "invited set to management"', () => {
    expect(changeSentence({ action: 'invited_as', detail: 'Director' })).toBe('Invited as Director');
    expect(changeSentence({ action: 'invited_as', detail: 'Negotiator' })).toBe('Invited as Negotiator');
  });

  /* AND THE LEVEL IS COMPUTED IN SQL, from the person's own row,
     because the stored value is the ROLE and cannot tell a Director
     from a Manager. */
  it('and the level comes from the reader, not from the stored role', () => {
    const sql = read('supabase/migrations/20261007460000_an_invite_is_said_in_agency_levels.sql');
    expect(sql).toContain("when u.role = 'management' and coalesce(u.sees_commission, false) then 'Director'");
    expect(sql).toContain("when u.role = 'management' then 'Manager'");
    expect(sql).toContain("when u.role = 'referrer' then 'Negotiator'");
  });

  it('and an invite with no level still reads', () => {
    expect(changeSentence({ action: 'invited_as', detail: '' })).toBe('Invited');
  });
});

describe('one place to set commission', () => {
  it('the tree points at the Commission tab instead of editing in place', () => {
    expect(home).toContain("{own != null ? 'Change on Commission' : 'Set on Commission'}");
    expect(home).toContain('isAdmin && rowKey && !editing && onCommissionTab');
  });

  /* AND THE TAB CAN SET ONE WHERE NONE IS SET, which is the half that
     makes removing the tree's button a move rather than a loss. */
  it('and the Commission tab lists every node, not only the ones with a rate', () => {
    expect(home).toContain("set.push({ level: 'agency', id: a.id, name: a.name, rate: a.agentRate ?? null })");
    expect(home).toContain("set.push({ level: 'branch', id: b.id, name: b.name, rate: b.agentRate ?? null })");
    expect(home).toContain('onCommissionTab: true');
  });

  it('and an inheriting row says so rather than repeating a figure', () => {
    expect(home).toContain('<span className="soft">Inherits</span>');
  });
});
