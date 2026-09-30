/* MAY THIS REFERRAL COVER MORE THAN ONE TENANT? Walk fix 26.
 *
 * Q-06 item H: "single tenant (no Add another tenant)" on the supplier
 * path. Batch 16 reverses it: "Suppliers may refer joint tenancies, the
 * same way agencies can." Batch 16 is newer, so it governs, and the
 * assertion that used to enforce the old rule is inverted in
 * referredBy.render.test.tsx rather than deleted.
 *
 * WHY THIS IS A FUNCTION AND NOT TWO CONDITIONS. The same question is asked
 * in two places: the "Add another tenant" button, and the effect that DROPS
 * tenants already typed once the origin turns out not to be able to carry
 * them. Before the fix both read `estate` and agreed. Changing only the
 * button would have left the effect still saying no -- so the moment the
 * rail probe settled it would have silently wiped the tenants an admin had
 * just added, on the one path the fix exists to open.
 *
 * That is not a hypothetical: it is what the first version of this change
 * did, and no render test caught it, because reaching the wipe needs the
 * probe to settle and the supplier path's probe never does without an
 * agency and branch chosen. A render test that CAN be written and does not
 * bite is worse than none; one predicate, tested here, is the answer.
 */
import { describe, expect, it } from 'vitest';
import { mayAddAnotherTenant, type JointInputs } from './jointAllowed';

const at = (o: Partial<JointInputs> = {}): JointInputs => ({
  referredBy: '', routeSupplier: '', railState: 'none', estate: false, ...o,
});

describe('the supplier route, which batch 16 opened', () => {
  it('allows a second tenant once the supplier is named', () => {
    expect(mayAddAnotherTenant(at({ referredBy: 'supplier', routeSupplier: 'kestrel-lettings' }))).toBe(true);
  });

  /* SETTLED FROM THE ROUTE, with nothing to wait for: the admin has just
     said which supplier. The probe answers about a BRANCH, which is a
     different question and is not asked here. */
  it('without waiting for the estate probe, which answers a different question', () => {
    for (const railState of ['none', 'loading', 'ready'] as const) {
      expect(mayAddAnotherTenant(at({ referredBy: 'supplier', routeSupplier: 'kestrel-lettings', railState })), railState)
        .toBe(true);
    }
  });

  /* AND `estate` IS FALSE FOR A SUPPLIER, which is exactly why it could not
     stay as the test. If this returned false the fix would be undone. */
  it('and while `estate` is false, which is what it means to be a supplier', () => {
    expect(mayAddAnotherTenant(at({
      referredBy: 'supplier', routeSupplier: 'kestrel-lettings', railState: 'ready', estate: false,
    }))).toBe(true);
  });

  it('but not before the supplier has been chosen', () => {
    expect(mayAddAnotherTenant(at({ referredBy: 'supplier', routeSupplier: '' }))).toBe(false);
  });
});

describe('the agency route, which is unchanged', () => {
  it('allows a second tenant once the probe says the branch is ours', () => {
    expect(mayAddAnotherTenant(at({ referredBy: 'agency', railState: 'ready', estate: true }))).toBe(true);
  });

  /* THE PROBE IS STILL WAITED FOR HERE, and that is the difference between
     the two halves: on this path the answer depends on the BRANCH, and an
     agency a supplier introduced is the case where the route and the branch
     disagree. */
  it('and waits for it, because on this path the branch decides', () => {
    for (const railState of ['none', 'loading'] as const) {
      expect(mayAddAnotherTenant(at({ referredBy: 'agency', railState, estate: true })), railState).toBe(false);
    }
  });

  it('and refuses once the probe says the branch is not ours', () => {
    expect(mayAddAnotherTenant(at({ referredBy: 'agency', railState: 'ready', estate: false }))).toBe(false);
  });
});

describe('a non-admin, who is never asked Referred by', () => {
  /* Their form has no Referred by section at all, so `referredBy` is ''
     and the branch decides -- which is what it always did for them. */
  it('is decided by the branch, exactly as before', () => {
    expect(mayAddAnotherTenant(at({ railState: 'ready', estate: true }))).toBe(true);
    expect(mayAddAnotherTenant(at({ railState: 'ready', estate: false }))).toBe(false);
    expect(mayAddAnotherTenant(at({ railState: 'loading', estate: true }))).toBe(false);
  });
});
