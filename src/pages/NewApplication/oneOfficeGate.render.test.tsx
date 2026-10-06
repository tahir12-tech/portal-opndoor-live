/* WHAT AN AGENCY USER IS ALLOWED TO SEE ON NEW APPLICATION.

   Two things were reported from the walk as Rosa, a manager at a single-office
   agency on our own estate, and they turned out to be one fault:

     the form sat on "Checking this agent..." for ever and "Add another tenant"
     never enabled, so a single-office agency could not send a joint tenancy;

     section 4 showed the full admin picker, "Search agencies or add a new one"
     and a create-a-branch-on-the-fly option, neither of which an agency user may
     have and both of which SQL refuses.

   THE FAULT. The form's whole question depends on which rail the viewer is on,
   and the only witness to that is my_org_shape. loadOrgShape returned
   FULL_PICKER when that call failed, and FULL_PICKER is not "we do not know", it
   is the SUPPLIER shape: a search box, a create option, and refersOwnStock
   false. Worse, AgentBranchPicker latched the first answer it got in a ref, so
   one failure at any point stuck permanently with no retry. An agency user then
   sat in front of the supplier form, having chosen nothing, which is also why
   the rail check never resolved and the tenant button never enabled.

   WHY NO TEST CAUGHT IT. loadOrgShape returns FULL_PICKER whenever
   SUPABASE_ENABLED is false, which under vitest is always, by construction. So
   every existing test of this form exercises the supplier shape and none
   exercises the shape Rosa actually gets. Mocking the shape is the whole point
   of this file, and the unresolved case below is the regression itself. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { FULL_PICKER, UNRESOLVED, type OrgShape } from '@/data';

/* ROSA'S SHAPE: one agency of ours, one office, and both named. That last part
   matters: a shape that says "one office" without saying which one cannot be
   printed, so the form is supposed to fall back to the full section rather than
   hide a fact it cannot state. */
const ONE_OFFICE: OrgShape = {
  ...FULL_PICKER,
  refersOwnStock: true,
  agencyCount: 1,
  branchCount: 1,
  collapseAgency: true,
  collapseBranch: true,
  mayAddAgency: false,
  onlyAgencyName: "Regent's Lettings",
  onlyBranchName: "Regent's Park",
};

/* ONE OF OURS WITH SEVERAL OFFICES. Foxglove, because it is the mock seed's
   Regent shape and really does hold three branches, so the select below has
   something to list. A shape whose branches the store cannot produce is a
   different case and says so on screen. */
const MANY_OFFICES: OrgShape = {
  ...FULL_PICKER,
  refersOwnStock: true,
  agencyCount: 1,
  branchCount: 3,
  collapseAgency: true,
  collapseBranch: false,
  mayAddAgency: false,
  onlyAgencyName: 'Foxglove Residential',
};

/* The queue of answers loadOrgShape will give, one per call, the last repeating.
   A queue rather than a single value because the retry is the fix for the latch
   and cannot be tested with a mock that always says the same thing. */
let answers: OrgShape[] = [ONE_OFFICE];
let calls = 0;

vi.mock('@/data/orgShapeService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/orgShapeService')>();
  return {
    ...actual,
    loadOrgShape: () => {
      const i = Math.min(calls, answers.length - 1);
      calls += 1;
      return Promise.resolve(answers[i]);
    },
  };
});

/* The rail answer. In mock mode the real one resolves through the mock org tree,
   which does not contain Regent, so it would answer "not our estate" for reasons
   that have nothing to do with what is being tested. Pinned to the truth for
   these agencies: they ARE ours. */
vi.mock('@/data/orgService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/orgService')>();
  return { ...actual, originIsAgentEstate: () => Promise.resolve(true) };
});

/* The fee. previewReferralFee returns null with no server, so without this the
   panel could not appear for any tenant count and the assertion below would be
   vacuous. The figures are dev's real answer for Regent at £1,750 on one tenant
   (three weeks of rent under their agreement, not one month), so the test also
   pins that a single tenant gets a NON-standard basis printed. */
vi.mock('@/data/feePreview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/feePreview')>();
  return {
    ...actual,
    previewReferralFee: (input: { sharePercents: number[] }) => {
      feeCalls.push(input.sharePercents);
      return Promise.resolve({
        feeAmount: 1211.54, feeBasisWeeks: 3, isStandard: false, shares: [1211.54],
      });
    },
  };
});
const feeCalls: number[][] = [];

import { NewApplication } from './NewApplication';

function open() {
  return render(
    <MemoryRouter initialEntries={['/new-application']}>
      <ToastProvider>
        <SessionProvider>
          <PageMetaProvider>
            <NewApplication />
          </PageMetaProvider>
        </SessionProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const addTenantButton = () =>
  screen.queryAllByRole('button').find((b) => /add another tenant/i.test(b.textContent ?? ''));
const body = () => document.body.textContent ?? '';

/* THE COLLAPSE HAS SETTLED, without reading the office off the screen.

   These tests used to wait for "Regent's Park" to appear, which was a fine signal
   right up until the ruling that the form says nothing about the office at all.
   The behavioural signal is better anyway: the rail check only resolves once the
   picker has reported an agency AND an office upward, so an enabled "Add another
   tenant" means the collapse happened, whatever the form chooses to print. */
async function settled() {
  await waitFor(() => {
    const b = addTenantButton();
    if (!b || b.hasAttribute('disabled')) throw new Error('not settled yet');
  }, { timeout: 5000 });
}

/** The office is nowhere on the form: not the agency, not the branch, not a
    control for either. */
function expectSilentAboutTheOffice() {
  expect(body()).not.toMatch(/Regent's Park/);
  expect(body()).not.toMatch(/Regent's Lettings/);
  expect(body()).not.toMatch(/This referral is against/i);
  expect(document.getElementById('ag-name')).toBeNull();
  expect(document.getElementById('br-name')).toBeNull();
}

/** Every offer an agency user must never be given, in the words on screen. */
function expectNothingOffered() {
  expect(body()).not.toMatch(/Search agencies or add a new one/i);
  expect(body()).not.toMatch(/add a new one/i);
  expect(body()).not.toMatch(/on the fly/i);
  /* BOTH SPELLINGS REFUSED. The row was renamed to "Create new agency" on
     2026-10-04; its absence is the claim, so the old name is kept here in case
     it returns and the new one is added because that is what it is called. */
  expect(body()).not.toMatch(/Create new agent/i);
  expect(body()).not.toMatch(/Create new agency/i);
  expect(body()).not.toMatch(/Create new branch/i);
  // The supplier form's heading and its sub, which promise the same thing.
  expect(body()).not.toMatch(/You can add either/i);
}

beforeEach(() => { answers = [ONE_OFFICE]; calls = 0; feeCalls.length = 0; });
afterEach(cleanup);

describe('a single-office agency, before typing anything', () => {
  it('stops saying it is checking the agent', async () => {
    open();
    // THE REPORTED SYMPTOM. The origin is pre-filled by the collapse, so the
    // check has everything it needs the moment the shape lands.
    await waitFor(() => expect(body()).not.toMatch(/Checking this agent/i));
  });

  it('offers Add another tenant, enabled, with nothing filled in', async () => {
    open();
    await waitFor(() => expect(addTenantButton()).toBeTruthy());
    await waitFor(() => expect(addTenantButton()?.hasAttribute('disabled')).toBe(false));
  });

  it('says nothing about the office at all', async () => {
    /* THE RULING, reversed from the one this file was written under. There used to
       be a line under Tenancy reading "This referral is against Regent's Lettings,
       Regent's Park", on the principle that the fact was worth keeping once the
       section asking for it had gone. It is not: somebody filing a referral from
       their only office knows which office they work at. So the form is silent,
       and the test that used to assert the line now asserts the silence. */
    open();
    await settled();
    expectSilentAboutTheOffice();
    expectNothingOffered();
  });

  /* THE ONE THAT WOULD HAVE CAUGHT ALL OF IT.

     The fault was never in the collapse logic, which was right. It was that the
     picker had two positions in the tree, one for each side of oneOffice, so
     resolving the shape moved it, React remounted it, the new one had no shape,
     and oneOffice flipped back. Thousands of remounts a second, each clearing the
     agency and branch.

     A remount asks the server again, so the call count IS the loop, and counting
     it is the cheapest possible detector. Every assertion above passes or fails
     depending on which frame waitFor happens to catch; this one does not. Against
     the two-position render it counted in the thousands. */
  it('asks the server once and settles, rather than remounting for ever', async () => {
    open();
    await settled();
    const settledCalls = calls;
    // Long enough that a loop would add hundreds.
    await new Promise((r) => setTimeout(r, 300));
    expect(calls).toBe(settledCalls);
    // StrictMode double-invokes effects, so two is the honest ceiling for one
    // mount. Anything more means the component is being rebuilt.
    expect(calls).toBeLessThanOrEqual(2);
  });

  it('shows the fee once rent is entered, on a SINGLE tenant', async () => {
    // Reported separately: the panel appeared only with two or more tenants.
    // A sole tenant carries 100% and is the common case by a distance, so this
    // is the count that matters most.
    open();
    await settled();
    const rent = document.getElementById('ty-rent') as HTMLInputElement;
    fireEvent.change(rent, { target: { value: '1750' } });
    await waitFor(() => expect(body()).toMatch(/Guarantee fee/i), { timeout: 3000 });
    expect(body()).toMatch(/1,211\.54/);
    // The basis, printed rather than assumed: three weeks, not one month.
    expect(body()).toMatch(/3 weeks of rent/i);
    // And it asked for one share of 100, not for a joint split.
    expect(feeCalls.at(-1)).toEqual([100]);
  });
});

/* =====================================================================
   THE REGRESSION ITSELF.
   ===================================================================== */
describe('when the server cannot say which rail the viewer is on', () => {
  it('offers nothing at all, rather than the supplier picker', async () => {
    // Every call fails, so the retry runs out and the form settles on the
    // unresolved shape. Before the fix this WAS the full admin picker.
    answers = [UNRESOLVED];
    open();
    await waitFor(() => expect(body()).toMatch(/Working out which office/i));
    expectNothingOffered();
    // No agency search box of any kind, under any label.
    expect(document.getElementById('ag-name')).toBeNull();
  });

  it('asks again, so one failed call is not permanent', async () => {
    // THE LATCH. The picker used to store the first answer in a ref and never
    // ask again, so a single failure stuck for the life of the page.
    answers = [UNRESOLVED, ONE_OFFICE];
    open();
    await settled();
    expect(calls).toBeGreaterThan(1);
    expectNothingOffered();
  });
});

/* =====================================================================
   MORE THAN ONE OFFICE: A PLAIN SELECT OF THEIR OWN.
   ===================================================================== */
describe('an agency with several offices', () => {
  it('gets a select of its own offices, not a search box', async () => {
    answers = [MANY_OFFICES];
    open();
    await waitFor(() => expect(document.getElementById('br-name')).toBeTruthy());
    const office = document.getElementById('br-name') as HTMLElement;
    // A select, not an input. The control itself is the ruling: a select cannot
    // accept free text and has no "create new" row to carry.
    expect(office.tagName).toBe('SELECT');
    const options = Array.from((office as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toContain('South Kensington');
    expect(options).toContain('Chelsea');
    expect(options).toContain('Fulham');
    expectNothingOffered();
  });

  it('names the agency rather than asking, since there is only one', async () => {
    answers = [MANY_OFFICES];
    open();
    await waitFor(() => expect(body()).toMatch(/Foxglove Residential/));
    expect(document.getElementById('ag-name')).toBeNull();
  });
});

/* =====================================================================
   AND THE FORM THAT IS ALLOWED THE PICKER STILL HAS IT.
   ===================================================================== */
describe('a supplier is unchanged', () => {
  /* "on the fly" IS GONE FROM THE COPY, 2026-10-04, so this asserts the
     CONTROL rather than the phrase: the search box and the create row are what
     the supplier keeps, and the words for them changed with Matt's Agent/Branch
     to Agency/Office rename. */
  it('still searches agencies and may add one', async () => {
    answers = [FULL_PICKER];
    open();
    await waitFor(() => expect(document.getElementById('ag-name')).toBeTruthy());
    /* THE PROMISE THE FIELD MAKES, which is what "may add one" means before
       anybody has typed anything. The type-ahead's create row is conditional
       on an unknown name being typed, and the dialog button belongs to a
       SUPPLIER's own scope -- this fixture is the supplier SHAPE under the
       default scope, which is a different thing. The placeholder is what the
       shape's `mayAddAgency` actually controls, and asserting it needs no
       typing and no scope. */
    expect((document.getElementById('ag-name') as HTMLInputElement).placeholder)
      .toMatch(/Search agencies or add a new one/);
  });

  it('still waits for an answer before offering a second tenant', async () => {
    // The guard against fixing the collapsed shape by simply enabling the
    // button: on a shape with a real choice in it, the form must still ask.
    answers = [FULL_PICKER];
    open();
    await waitFor(() => expect(document.getElementById('ag-name')).toBeTruthy());
    const btn = addTenantButton();
    if (btn) expect(btn.hasAttribute('disabled')).toBe(true);
  });
});
