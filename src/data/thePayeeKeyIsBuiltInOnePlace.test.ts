/* THE KEY A STATEMENT IS ADDRESSED BY.
 *
 * Matt, 2026-10-04: "Download statement (Kestrel, September 2026) still says
 * 'Reference assigned when the statement is posted' ... but it was posted
 * this morning as STMT-2026-09-0006 ... tell me why this path missed it."
 *
 * BECAUSE IT ASKED A DIFFERENT QUESTION AND GOT A TRUE ANSWER TO IT. The
 * stored key is `<partner slug>|<level>:<org uuid>`, built by
 * commission_statement_lines. The supplier download built
 * `${partnerId}|partner:${partnerId}` -- the same value on both sides -- so
 * it could only ever produce slug|partner:slug or uuid|partner:uuid, never
 * the mixed shape that exists. Measured on dev:
 *
 *     kestrel-lettings|partner:<uuid>            STMT-2026-09-0006
 *     kestrel-lettings|partner:kestrel-lettings        (none)
 *
 * THE TEST IS THAT THE TWO SIDES DIFFER. Asserting the exact string would
 * pass on a builder that put the uuid on both sides, which is the other
 * wrong answer.
 */
import { describe, expect, it, vi } from 'vitest';

const PARTNERS = [
  { id: 'kestrel-lettings', dbId: '9ec3cdd0-107b-4cd7-8322-62b533b78a2e', name: 'Kestrel Lettings' },
  { id: 'letly', name: 'Letly' }, // no dbId: mock mode, or a partner never synced
];

vi.mock('@/data/partnersService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/partnersService')>();
  return { ...actual, getPartner: (id: string) => PARTNERS.find((p) => p.id === id) ?? null };
});

import { supplierPayeeKey, orgPayeeKey } from './exportsService';

describe('the supplier payee key', () => {
  it('puts the slug on the left and the uuid on the right', () => {
    expect(supplierPayeeKey('kestrel-lettings'))
      .toBe('kestrel-lettings|partner:9ec3cdd0-107b-4cd7-8322-62b533b78a2e');
  });

  /* THE DEFECT, AS ITS OWN ASSERTION. Both halves being the same value is
     what produced "assigned when the statement is posted" for a statement
     that had been posted an hour earlier. */
  it('and never the same value twice', () => {
    const key = supplierPayeeKey('kestrel-lettings')!;
    const [left, right] = [key.slice(0, key.indexOf('|')), key.slice(key.indexOf(':') + 1)];
    expect(left).not.toBe(right);
    expect(key).not.toBe('kestrel-lettings|partner:kestrel-lettings');
  });

  /* NOTHING RATHER THAN A GUESS. Without a uuid there is no stored statement
     to find, and a key built from the slug would ask the question that
     stranded a sequence number on dev in the first place. */
  it('and refuses to guess when there is no uuid', () => {
    expect(supplierPayeeKey('letly')).toBeNull();
    expect(supplierPayeeKey('nobody')).toBeNull();
  });
});

describe('an org payee key', () => {
  it('carries the level, so an agency and a branch of one name cannot collide', () => {
    const a = orgPayeeKey('opndoor-agents', 'agency', 'f0057000-0000-4000-8000-00000000a001');
    const b = orgPayeeKey('opndoor-agents', 'branch', 'f0057000-0000-4000-8000-00000000a001');
    expect(a).toBe('opndoor-agents|agency:f0057000-0000-4000-8000-00000000a001');
    expect(a).not.toBe(b);
  });

  /* TWO ESTATES, ONE NAME. Dev holds two "Frost Partnership" agencies and
     only one of them was posted, so a key built from a name rather than an
     id would read the wrong estate's statement. */
  it('and the org id, so two same-named agencies address different statements', () => {
    expect(orgPayeeKey('opndoor-agents', 'agency', 'f0057000-0000-4000-8000-00000000a001'))
      .not.toBe(orgPayeeKey('kestrel-lettings', 'agency', 'f0057000-0000-4000-8000-00000000a002'));
  });

  it('and is null when there is no org to address', () => {
    expect(orgPayeeKey('opndoor-agents', 'agency', null)).toBeNull();
  });
});
