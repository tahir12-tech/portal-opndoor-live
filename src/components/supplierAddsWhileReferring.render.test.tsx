/* =====================================================================
   "ADD A NEW AGENCY" AND "ADD A NEW OFFICE" ON THE REFERRAL FORM.

   Matt, 2026-10-03: "On the New application form, 'Add a new agency' and 'Add
   a new office' sit under the agency and office pickers. A new agency needs
   its name, address and agency email (where signed deeds go); a new office
   needs its name and address, and its email is optional ... It's checked
   against that supplier's existing agencies and offices first
   (case-insensitive), offering 'Use [existing] instead?' rather than creating
   a duplicate."

   WHY THE OLD OFFER HAD TO GO RATHER THAN GAIN A NEIGHBOUR. The type-ahead's
   "Create new agent" row takes a NAME and nothing else, and the agency is
   written for real later, by create_referral_target, when the referral is
   sent. There is no address field in it and no address on the office it
   makes -- and an address is now required. Leaving both doors open would mean
   two creations of the same thing asking for different facts at different
   moments, so on the supplier rail the row goes and the button takes its
   place. The admin's row stays, because an admin's flow has a partner picker
   in it and is a different thing.

   THE OTHER HALF IS ON SCREEN TOO: by the time the picker selects what the
   dialog made, the agency is a real row with an id, pending_review, in
   Reconciliation, with an org_audit line naming who added it. So the form
   selects it as an EXISTING agency -- which is what the last test here
   measures, because selecting it as new would re-ask for the contact the
   dialog just took and create it a second time on submit.
   ===================================================================== */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/components/ui/Toast';
import { FULL_PICKER, type OrgShape } from '@/data';

/* THE SEED'S OWN SUPPLIER AND ITS OWN AGENCY, read off the mock store rather
   than invented: partyIsSupplier reads the partner's kind, so an invented slug
   would answer "not a supplier" and every assertion below would pass for the
   wrong reason. Cityscape is harbourside's agency and really does hold
   Battersea and Noho, which the duplicate checks need. */
const SUPPLIER = 'harbourside';
const AGENCY = 'Cityscape Lettings';
const OFFICE = 'Battersea';

let role = 'referrer';
let scope: string = SUPPLIER;

vi.mock('@/session/SessionContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/session/SessionContext')>();
  return {
    ...actual,
    useSession: () => ({ ...actual.useSession(), role, partnerScope: scope }),
  };
});

/* OUR OWN ESTATE'S SHAPE, which no amount of session mocking produces on its
   own: loadOrgShape returns FULL_PICKER whenever SUPABASE_ENABLED is false,
   and under vitest that is always. FULL_PICKER is the SUPPLIER shape, so the
   agency-user case has to be mocked or it cannot be reached at all. */
let shapeAnswer: OrgShape = FULL_PICKER;
vi.mock('@/data/orgShapeService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/orgShapeService')>();
  return { ...actual, loadOrgShape: () => Promise.resolve(shapeAnswer) };
});

const OURS: OrgShape = {
  ...FULL_PICKER,
  refersOwnStock: true,
  agencyCount: 2,
  branchCount: 4,
  mayAddAgency: false,
};

import { AgentBranchPicker } from './AgentBranchPicker';
import { SessionProvider } from '@/session/SessionContext';

function open(scopePartner?: string) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <SessionProvider>
          <AgentBranchPicker scopePartner={scopePartner} />
        </SessionProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const body = () => document.body.textContent ?? '';
const btn = (re: RegExp) =>
  screen.queryAllByRole('button').find((b) => re.test(b.textContent ?? ''));

/** The picker has heard back from the shape, so what is drawn is final. */
async function settled() {
  await waitFor(() => {
    if (/Working out which office/i.test(body())) throw new Error('still unresolved');
  });
}

beforeEach(() => { role = 'referrer'; scope = SUPPLIER; shapeAnswer = FULL_PICKER; });
afterEach(() => cleanup());

describe('a supplier’s own referrer', () => {
  it('is offered Add a new agency under the agency picker', async () => {
    open(SUPPLIER);
    await settled();
    expect(btn(/^\s*Add a new agency\s*$/)).toBeTruthy();
  });

  /* THE ROW IS GONE, and this is the assertion that would have caught two
     doors being left open. Typed as an unknown name, which is the only state
     that ever produced the row. */
  it('is not offered the type-ahead’s create row, even on an unknown name', async () => {
    open(SUPPLIER);
    await settled();
    const field = document.getElementById('ag-name') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'Nowhere Lettings' } });
    expect(body()).not.toMatch(/Create new agent/i);
    expect(body()).not.toMatch(/add a new one/i);
    expect(body()).not.toMatch(/on the fly/i);
  });

  /* AND ENTER IS NOT A BACK DOOR. commitAgentEnter created an agency on a
     name nobody had confirmed, by the same local-store route as the row. */
  it('does not create an agency by pressing Enter on an unknown name', async () => {
    open(SUPPLIER);
    await settled();
    const field = document.getElementById('ag-name') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'Nowhere Lettings' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(body()).not.toMatch(/New agency contact/i);
    expect(body()).not.toMatch(/Is this a single-office agency\?/i);
  });

  it('is offered Add a new office only once an agency is chosen', async () => {
    open(SUPPLIER);
    await settled();
    expect(btn(/Add a new office/)).toBeFalsy();
    const field = document.getElementById('ag-name') as HTMLInputElement;
    fireEvent.change(field, { target: { value: AGENCY } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(btn(/Add a new office/)).toBeTruthy());
  });
});

describe('the dialog it opens', () => {
  it('asks for the name, the address and the agency email', async () => {
    open(SUPPLIER);
    await settled();
    fireEvent.click(btn(/^\s*Add a new agency\s*$/)!);
    await waitFor(() => expect(document.getElementById('sao-name')).toBeTruthy());
    expect(document.getElementById('sao-addr')).toBeTruthy();
    expect(body()).toMatch(/Agency email/);
    // Not "(optional)" on an agency: a signed deed has to have somewhere to go.
    expect(body()).toMatch(/Where a signed deed goes/i);
  });

  /* THE DUPLICATE OFFER, AND THE VERB THAT GOES WITH IT. On the Agencies page
     the offer is "Open it instead?" and navigates, which is right there. Here
     the reader is halfway through a referral, so it must SELECT and must not
     navigate -- the whole reason onUseExisting is a prop. */
  it('offers to use the existing agency instead of making a duplicate', async () => {
    open(SUPPLIER);
    await settled();
    fireEvent.click(btn(/^\s*Add a new agency\s*$/)!);
    await waitFor(() => expect(document.getElementById('sao-name')).toBeTruthy());
    // Case-insensitive, which is stricter than the unique index and is the
    // mistake the message exists to prevent.
    fireEvent.change(document.getElementById('sao-name')!, { target: { value: 'cityscape lettings' } });
    await waitFor(() => expect(body()).toMatch(new RegExp(`already has an agency called ${AGENCY}`)));
    expect(btn(new RegExp(`Use ${AGENCY} instead\\?`))).toBeTruthy();
    expect(document.querySelector('a[href*="/agencies/"]')).toBeNull();
    // And it cannot be saved past the warning.
    expect(btn(/^\s*Add agency\s*$/)!.hasAttribute('disabled')).toBe(true);
  });

  /* SELECTED, NOT CREATED. Taking the offer closes the dialog and puts the
     existing agency in the form, which is the point of the whole exchange. */
  it('selects the existing agency when the offer is taken, as an existing one', async () => {
    open(SUPPLIER);
    await settled();
    fireEvent.click(btn(/^\s*Add a new agency\s*$/)!);
    await waitFor(() => expect(document.getElementById('sao-name')).toBeTruthy());
    fireEvent.change(document.getElementById('sao-name')!, { target: { value: 'CITYSCAPE LETTINGS' } });
    await waitFor(() => expect(btn(new RegExp(`Use ${AGENCY} instead\\?`))).toBeTruthy());
    fireEvent.click(btn(new RegExp(`Use ${AGENCY} instead\\?`))!);
    await waitFor(() => {
      expect(document.getElementById('sao-name')).toBeNull();
      expect((document.getElementById('ag-name') as HTMLInputElement).value).toBe(AGENCY);
    });
    /* AS AN EXISTING AGENCY. "New agency contact" is the block that appears for
       a fly-created one; its absence is how we know the form is not about to
       create a second Cityscape on submit. */
    expect(body()).not.toMatch(/New agency contact/i);
  });

  /* THE OFFICE HALF, which the dialog did not have at all before today. There
     is no unique index on branches, so nothing downstream would have caught
     a second Battersea either. */
  it('checks an office against the ones that agency already has', async () => {
    open(SUPPLIER);
    await settled();
    const field = document.getElementById('ag-name') as HTMLInputElement;
    fireEvent.change(field, { target: { value: AGENCY } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(btn(/Add a new office/)).toBeTruthy());
    fireEvent.click(btn(/Add a new office/)!);
    await waitFor(() => expect(document.getElementById('sao-name')).toBeTruthy());
    fireEvent.change(document.getElementById('sao-name')!, { target: { value: 'battersea' } });
    await waitFor(() => expect(body()).toMatch(new RegExp(`${AGENCY} already has an office called ${OFFICE}`)));
    expect(btn(new RegExp(`Use ${OFFICE} instead\\?`))).toBeTruthy();
    // Optional here, and the hint says whose address it falls back to.
    expect(body()).toMatch(/Branch email \(optional\)/);
  });
});

describe('a supplier’s own management', () => {
  it('gets the same two controls', async () => {
    role = 'management';
    open(SUPPLIER);
    await settled();
    expect(btn(/^\s*Add a new agency\s*$/)).toBeTruthy();
    const field = document.getElementById('ag-name') as HTMLInputElement;
    fireEvent.change(field, { target: { value: AGENCY } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(btn(/Add a new office/)).toBeTruthy());
  });
});

describe('one of our own agency’s people', () => {
  /* MATT'S LAST SENTENCE ON THE ITEM: "Opndoor's own agencies are unchanged:
     their users can't add agencies or offices." Both the old offer and the new
     one have to be absent, and the sentence that explains why has to stay. */
  it('is offered neither the button nor the row, and still told why', async () => {
    role = 'referrer';
    scope = 'opndoor-agents';
    shapeAnswer = OURS;
    open('opndoor-agents');
    await settled();
    expect(btn(/Add a new agency/)).toBeFalsy();
    expect(btn(/Add a new office/)).toBeFalsy();
    expect(body()).not.toMatch(/Create new agent/i);
    expect(body()).toMatch(/A new agency is set up by opndoor, not here/);
  });
});

describe('an opndoor admin', () => {
  /* THE ADMIN FLOW IS UNCHANGED, which is the regression the predicate's
     false-for-admin answer exists to prevent. The create row is still there,
     and the dialog -- which has no partner picker -- is not. */
  it('keeps the create-on-the-fly row and does not get the dialog button', async () => {
    role = 'superadmin';
    scope = SUPPLIER;
    open(SUPPLIER);
    await settled();
    expect(btn(/Add a new agency/)).toBeFalsy();
    const field = document.getElementById('ag-name') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'Nowhere Lettings' } });
    await waitFor(() => expect(body()).toMatch(/Create new agent/i));
  });
});
