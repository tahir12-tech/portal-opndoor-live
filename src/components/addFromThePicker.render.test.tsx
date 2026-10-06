/* =====================================================================
   ADD FROM THE PICKER, WITH THE TYPED NAME CARRIED IN.

   Matt (vv), verbatim: "New application, Agency and Office pickers
   (supplier users): when what's typed doesn't match an existing agency
   or office, show an option at the bottom of the list, 'Add 'New
   Agency' as a new agency', that opens the add fields with the name
   already filled in. Same for offices. Keep the duplicate check (if it
   nearly matches an existing one, show that first with 'Did you
   mean...?')."

   WHAT THIS IS NOT. It is not a second way to create an agency. The
   dialog is the same one the "Add a new agency" button under the picker
   already opens -- same fields, same server, same duplicate check --
   and the only difference is what the name field starts as. Two
   creation routes asking for different facts is the mistake
   supplierAddsWhileReferring records; this file must not reintroduce
   it, which is why it asserts the DIALOG opens rather than that an
   agency appears.

   "THE DUPLICATE CHECK COMES FIRST" IS KEPT BY DOING NOTHING TO IT. The
   options above this row are already every match for what was typed, so
   putting the add row at the BOTTOM is itself the ordering Matt asked
   for -- which is why the order is asserted here rather than assumed.
   The exact-name check is the dialog's, and on this form its offer
   selects the existing agency in the form behind rather than navigating
   away from a half-written referral.
   ===================================================================== */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/components/ui/Toast';
import { FULL_PICKER, type OrgShape } from '@/data';

const SUPPLIER = 'harbourside';
const AGENCY = 'Cityscape Lettings';

let role = 'referrer';
let scope: string = SUPPLIER;

vi.mock('@/session/SessionContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/session/SessionContext')>();
  return {
    ...actual,
    useSession: () => ({ ...actual.useSession(), role, partnerScope: scope }),
  };
});

let shapeAnswer: OrgShape = FULL_PICKER;
vi.mock('@/data/orgShapeService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/orgShapeService')>();
  return { ...actual, loadOrgShape: () => Promise.resolve(shapeAnswer) };
});

/* ONE OF OUR OWN AGENCIES' people, who must NOT get this row: for them a
   new agency is an acquisition, and it belongs to an admin on the
   Agencies screen rather than to whoever is sending a referral. */
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
const options = () => screen.queryAllByRole('option').map((o) => o.textContent ?? '');

async function settled() {
  await waitFor(() => {
    if (/Working out which office/i.test(body())) throw new Error('still unresolved');
  });
}

const type = (id: string, value: string) =>
  fireEvent.change(document.getElementById(id) as HTMLInputElement, { target: { value } });

/* THE OPTION CHOOSES ON mouseDown, NOT click -- TypeAhead preventDefaults
   it so the input does not blur the menu away before the choice lands. A
   fireEvent.click on these rows does nothing at all, silently, which is
   how my first draft of this file "passed": it clicked, nothing happened,
   and the assertions matched text that was on the page anyway. */
const pickOption = (re: RegExp) => {
  const row = screen.queryAllByRole('option').find((o) => re.test(o.textContent ?? ''));
  expect(row, `no option matching ${re}`).toBeTruthy();
  fireEvent.mouseDown(row!);
};

beforeEach(() => { role = 'referrer'; scope = SUPPLIER; shapeAnswer = FULL_PICKER; });
afterEach(() => cleanup());

describe('the agency picker', () => {
  it('offers to add what was typed when nothing matches it', async () => {
    open(SUPPLIER);
    await settled();
    type('ag-name', 'Nowhere Lettings');
    expect(options().some((t) => /Add .Nowhere Lettings. as a new agency/.test(t))).toBe(true);
  });

  /* THE ORDER IS THE DUPLICATE CHECK. "Cityscape" matches a real agency
     in the seed, so the match and the add row are both drawn -- and the
     match has to come first, or the reader creates a second Cityscape
     because the quickest row said they could. */
  it('and puts it last, under the near-matches', async () => {
    open(SUPPLIER);
    await settled();
    type('ag-name', 'Cityscape');
    const opts = options();
    const match = opts.findIndex((t) => t.includes(AGENCY));
    const add = opts.findIndex((t) => /as a new agency/.test(t));
    expect(match, 'the existing agency is not offered at all').toBeGreaterThanOrEqual(0);
    expect(add, 'the add row is not offered').toBeGreaterThan(match);
  });

  /* THE WHOLE VALUE OF THE ITEM. Typing a name, being told there is no
     match and then retyping it into a dialog is what (vv) removes. */
  it('opening the dialog with the name already filled in', async () => {
    open(SUPPLIER);
    await settled();
    type('ag-name', 'Nowhere Lettings');
    pickOption(/as a new agency/);
    /* THE DIALOG'S OWN TITLE AND THE DIALOG'S OWN FIELD. "Add a new
       agency" is the button UNDER the picker and is on the page the
       whole time, and the picker's own input already holds the typed
       name -- so asserting either would pass without the dialog ever
       opening. Both of those are mistakes this file made first. */
    await waitFor(() => expect(body()).toMatch(/Add an agency to/i));
    const field = document.getElementById('sao-name') as HTMLInputElement;
    expect(field, 'the dialog did not open').toBeTruthy();
    expect(field.value).toBe('Nowhere Lettings');
  });

  /* NOT FOR OUR OWN ESTATE. They have no dialog to open, and offering a
     row that leads nowhere is worse than not offering one. */
  it('but not to a reader whose agencies are set up by opndoor', async () => {
    shapeAnswer = OURS;
    open(SUPPLIER);
    await settled();
    type('ag-name', 'Nowhere Lettings');
    expect(body()).not.toMatch(/as a new agency/);
  });
});

describe('the office picker', () => {
  /* ONLY ONCE THERE IS AN AGENCY TO PUT IT UNDER. admin_add_branch takes
     the agency's id, so the row before an agency is chosen would open a
     dialog that could only fail on save. */
  it('offers to add the typed office, once an agency is chosen', async () => {
    open(SUPPLIER);
    await settled();
    /* CHOSEN FROM THE LIST, NOT TYPED. `selectedAgency` is set by
       choosing an option; typing the name only filters. The office
       field exists either way, so a test that typed would have been
       asserting against an agency the picker had not accepted. */
    type('ag-name', AGENCY);
    pickOption(new RegExp(AGENCY));
    await waitFor(() => {
      const f = document.getElementById('br-name') as HTMLInputElement | null;
      if (!f || f.disabled) throw new Error('the agency has not been accepted yet');
    });
    type('br-name', 'Nowhere Office');
    expect(options().some((t) => /Add .Nowhere Office. as a new office/.test(t))).toBe(true);
  });
});
