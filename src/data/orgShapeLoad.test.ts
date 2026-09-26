/* WHAT loadOrgShape DOES WHEN THE SERVER DOES NOT ANSWER.

   Its own file because it needs a Supabase client, and the rest of the suite runs
   with SUPABASE_ENABLED false: loadOrgShape returns early in mock mode, so no
   existing test could reach the branch this is about. That is exactly why the
   branch shipped wrong.

   THE DEFECT. Both of these returned FULL_PICKER:

     an ERROR from my_org_shape   (an expired token, a race with a refresh, a
                                   network failure, the function's own AAL2
                                   refusal)
     NO ROW from my_org_shape     (an opndoor admin with no partner selected,
                                   who really does reach every partner)

   The second is a real answer. The first is not, and FULL_PICKER is the SUPPLIER
   shape: an agency search box and an add-a-new-agency option, on our own estate,
   where SQL refuses both. Conflating them is what put the admin picker in front
   of a Regent manager.

   my_org_shape raises 42501 at AAL1, which makes the first case reachable in
   ordinary use: any call that lands while the token is between states gets it. */
import { describe, expect, it, vi } from 'vitest';

/** The one RPC answer this test is about, swapped per case. */
let answer: { data: unknown; error: unknown } = { data: [], error: null };

vi.mock('@/lib/supabase', () => ({
  SUPABASE_ENABLED: true,
  supabase: null,
  sb: () => ({ rpc: () => Promise.resolve(answer) }),
}));

const { loadOrgShape, FULL_PICKER } = await import('./orgShapeService');

const ROW = {
  refers_own_stock: true, agency_count: 1, branch_count: 1,
  collapse_agency: true, collapse_branch: true, may_add_agency: false,
  only_agency_id: 'a1', only_agency_name: "Regent's Lettings",
  only_branch_id: 'b1', only_branch_name: "Regent's Park",
};

describe('loadOrgShape when the call fails', () => {
  it('says it does not know, rather than saying supplier', async () => {
    answer = { data: null, error: { code: '42501', message: 'not permitted' } };
    const shape = await loadOrgShape();
    expect(shape.resolved).toBe(false);
    // The three that made the admin picker appear.
    expect(shape.mayAddAgency).toBe(false);
    expect(shape.collapseAgency).toBe(false);
    expect(shape).not.toEqual(FULL_PICKER);
  });

  it('does the same for a transport failure, not only a refusal', async () => {
    answer = { data: null, error: { message: 'Failed to fetch' } };
    expect((await loadOrgShape()).resolved).toBe(false);
  });
});

describe('loadOrgShape when the call succeeds', () => {
  /* NO ROW IS AN ANSWER, and this is the case that has to keep working exactly as
     it did: an opndoor admin with no partner selected reaches every partner, so
     nothing can collapse and the full picker is correct. */
  it('treats no row as the full picker, because that is what it means', async () => {
    answer = { data: [], error: null };
    const shape = await loadOrgShape();
    expect(shape.resolved).toBe(true);
    expect(shape.mayAddAgency).toBe(true);
    expect(shape).toEqual(FULL_PICKER);
  });

  it('reads a row through as a resolved shape', async () => {
    answer = { data: [ROW], error: null };
    const shape = await loadOrgShape();
    expect(shape.resolved).toBe(true);
    expect(shape.refersOwnStock).toBe(true);
    expect(shape.collapseAgency).toBe(true);
    expect(shape.collapseBranch).toBe(true);
    expect(shape.mayAddAgency).toBe(false);
    expect(shape.onlyAgencyName).toBe("Regent's Lettings");
    expect(shape.onlyBranchName).toBe("Regent's Park");
  });
});
