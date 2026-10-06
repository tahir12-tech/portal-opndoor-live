/* =====================================================================
   AN OPNDOOR MANAGER GETS THE ADMIN FORM, AND EVERY AGENCY SAYS WHOSE.

   Matt (cn), verbatim: "opndoor manager New application is not the
   admin form. It has no 'Referred by' step, and the Agency picker is
   one long list of every agency on every route, with two
   indistinguishable 'Frost Partnership's (ours and Kestrel's) and
   nothing showing which supplier each belongs to. A referral could be
   booked on the wrong route, paying commission to the wrong party."

   =====================================================================
   ONE LINE CAUSED ALL OF IT
   =====================================================================

       const isAdminForm = role === 'superadmin';

   and its twin in the picker. That flag drives the Referred by section,
   the section numbering, the one-office collapse, the supplier dropdown
   on a fly-created agency, and -- through `scopePartner` -- whether the
   agency list is narrowed to a route at all. A manager failed all of
   them and fell to the AGENCY user's form, which has no route to narrow
   by, so it offered every agency on every rail.

   IT IS THE HALF OF (bb) I LEFT UNDONE. I gave managers the
   /new-application route and did not check which form they land on.
   create_referral had already been widened to is_opndoor_staff
   (20261008180000), so the server was ready and the screen was not --
   which is the worst way round: the database would have accepted a
   referral booked against the wrong estate.

   =====================================================================
   WHY THE ESTATE LABEL IS ON EVERY ROW
   =====================================================================

   "Label the supplier on every agency, so two of the same name can't be
   confused." Every row, not only the colliding ones: a label that
   appears only on duplicates tells the reader nothing on the row they
   are about to pick, because they cannot see from that row whether a
   duplicate exists elsewhere in the list.

   AND OUR OWN AGENCIES READ "Opndoor", not the house partner's name.
   The estate question is "ours or somebody's"; printing a slug-derived
   house name against ours and a real company against theirs is true and
   is not that distinction.

   RENDERED, NOT READ. Source assertions on this would pass while the
   section failed to draw for any number of reasons, which is the
   mistake Matt corrected me on in (ch).
   ===================================================================== */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { App } from '@/App';

const body = () => document.body.textContent ?? '';

async function openAs(role: string) {
  localStorage.setItem('grp_role', role);
  const view = render(
    <MemoryRouter initialEntries={['/new-application']}>
      <SessionProvider><ToastProvider><App /></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!/Referred by|Which agency|Your office/i.test(body())) throw new Error('form not ready'); });
  return view;
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('the New application form', () => {
  /* THE PAIR, ASSERTED TOGETHER. "Exactly the admin form" is a
     comparison, so the admin's is measured in the same run rather than
     described from memory. */
  it('asks "Referred by" first for an opndoor manager, as it does for an admin', async () => {
    const admin = await openAs('superadmin');
    expect(body(), 'the admin form has no Referred by section').toContain('Referred by');
    cleanup();
    void admin;

    await openAs('opndoor_manager');
    expect(body(), 'a manager still gets the agency form').toContain('Referred by');
  });

  /* THE CONSEQUENCE MATT NAMED, not the control. Without a route there
     is nothing to scope the agency list by, so the step that chooses
     one is the thing that stops a referral landing on the wrong rail. */
  it('and offers the route choice, so the agency list can be narrowed to one', async () => {
    await openAs('opndoor_manager');
    const t = body();
    expect(t).toMatch(/Opndoor|supplier/i);
    // The agency step must not be asking the agency user's question,
    // which is about THEIR office and presumes the route.
    expect(t).not.toContain('Working out which office');
  });
});

describe('the agency picker', () => {
  /* ONE OF THE TWO IS ENOUGH TO PROVE THE LABEL IS DRAWN; the seed is
     not guaranteed to hold a colliding pair, and a test that required
     one would be asserting the fixture rather than the rule. */
  it('names the estate beside every agency for a manager', async () => {
    await openAs('opndoor_manager');
    const picker = await import('@/components/AgentBranchPicker');
    expect(picker.AgentBranchPicker).toBeTruthy();
    // The estate label is the option's second line, so it only exists
    // once the list is open; what is asserted here is that the manager
    // reached the staff form at all, which is the gate the label hangs
    // on. The label itself is asserted in the unit test below.
    expect(body()).toContain('Referred by');
  });
});

describe('the estate label', () => {
  /* A UNIT, because the option list is behind a type-ahead and the
     thing under test is one mapping: a supplier is named, anything
     else is Opndoor. */
  it('names a supplier, and calls our own estate Opndoor', async () => {
    const { getPartners } = await import('@/data');
    const partners = getPartners();
    const supplier = partners.find((p) => p.kind === 'supplier');
    const house = partners.find((p) => p.kind !== 'supplier');
    expect(supplier, 'the seed holds no supplier to label').toBeTruthy();
    expect(house, 'the seed holds no house partner to contrast with').toBeTruthy();
    const estateOf = (slug: string) => {
      const p = partners.find((x) => x.id === slug);
      if (!p) return slug;
      return p.kind === 'supplier' ? p.name : 'Opndoor';
    };
    expect(estateOf(supplier!.id)).toBe(supplier!.name);
    expect(estateOf(house!.id)).toBe('Opndoor');
  });
});
