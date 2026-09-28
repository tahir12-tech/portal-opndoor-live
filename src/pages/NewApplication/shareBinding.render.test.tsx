/* The New application form when there is more than one tenant.

   Three things are locked here.

   First, that multi-tenant is offered ONLY where the chosen origin is the agent
   rail. A pre-referenced referral arrives with its references already done and
   covers a single tenant; create_joint_referral refuses the rest. A form that
   offers the button there is offering something that cannot be sent.

   Second, that a SOLE tenant is never asked about shares — one applicant carries
   100% and should not have to say so.

   Third, that once a second tenant exists, each share row's percentage and
   amount mirror to the penny and the shares default to something that already
   sums to 100.

   ONE FORM, EVERY ROLE. superadmin, management and referrer all create referrals
   through this same component, so the gate and the share behaviour are asserted
   under an admin session as well as a partner one: a rule added for one is a
   rule for both, and that is the whole point of there being one form. */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { App } from '@/App';

afterEach(cleanup);

/* The two shapes that matter, and they are NOT the same question.

   Foxglove is one of OUR agencies (its partner, Northwind, is the estate) that
   references its OWN tenants — the Regent shape. It gets joint tenancies AND its
   applicants go straight to payment.

   Cityscape sits under a partner with no estate: referrals arrive one tenant at
   a time, the way a supplier sends them. It is under Harbourside, so only an
   admin can select it — which is itself the point: the estate is a property of
   the partner, so a partner user can never see both cases. */
const OUR_AGENCY = { agency: 'Foxglove Residential', branch: 'South Kensington' };
const NOT_OUR_AGENCY = { agency: 'Cityscape Lettings', branch: 'Battersea' };

async function openForm(role: 'management' | 'superadmin' = 'management') {
  localStorage.setItem('grp_role', role);
  const view = render(
    <MemoryRouter initialEntries={['/new-application']}>
      <SessionProvider><ToastProvider><App /></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!document.querySelector('#ty-rent')) throw new Error('form not ready'); });
  const q = <T extends HTMLElement = HTMLInputElement>(sel: string) => view.container.querySelector<T>(sel)!;
  const change = (sel: string, value: string) => fireEvent.change(q(sel), { target: { value } });

  /** Pick an option out of a TypeAhead by its visible name. Selection is on
      mousedown, so it fires before the input blurs. */
  const pick = (name: string) => {
    const opt = [...view.container.querySelectorAll<HTMLElement>('.typeahead__opt')]
      .find((o) => (o.textContent ?? '').includes(name));
    if (!opt) throw new Error(`no option matching ${name}`);
    fireEvent.mouseDown(opt);
  };

  /** Choose the agent and branch, which is what decides whether this referral
      may carry more than one tenant. */
  const chooseOrigin = async (o: { agency: string; branch: string }) => {
    fireEvent.focus(q('#ag-name'));
    fireEvent.change(q('#ag-name'), { target: { value: o.agency } });
    pick(o.agency);
    await waitFor(() => { if (!document.querySelector('#br-name')) throw new Error('branch field not ready'); });
    fireEvent.focus(q('#br-name'));
    fireEvent.change(q('#br-name'), { target: { value: o.branch } });
    pick(o.branch);
    // The rail is resolved asynchronously, even in mock mode.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  };

  const addBtn = () => [...view.container.querySelectorAll('button')]
    .find((b) => /add another tenant/i.test(b.textContent ?? '')) as HTMLButtonElement | undefined;
  const addTenant = () => {
    const btn = addBtn();
    if (!btn) throw new Error('no add-another-tenant button');
    fireEvent.click(btn);
  };
  /** The share inputs, in tenant order: [pct, amount, pct, amount, ...]. */
  const shareInputs = () => [...view.container.querySelectorAll<HTMLInputElement>('.shares__in input')];
  return { q, change, pick, chooseOrigin, addBtn, addTenant, shareInputs, view };
}

describe.each(['management', 'superadmin'] as const)('multi-tenant needs one of our agencies [%s]', (role) => {
  it('will not offer a second tenant before an origin is chosen, and says what is missing', async () => {
    const { addBtn, view } = await openForm(role);
    expect(addBtn()?.disabled).toBe(true);
    expect(view.container.textContent).toMatch(/Choose the agent and branch first/i);
  });

  it('offers it for one of our agencies, EVEN THOUGH they reference their own tenants', async () => {
    /* The case the whole seam exists for. Foxglove's applicants are
       pre-referenced and go straight to payment; that is a fact about the
       journey and has nothing to do with whether they can send us a joint
       tenancy. Asked as one question, this agency was impossible. */
    const { addBtn, chooseOrigin } = await openForm(role);
    await chooseOrigin(OUR_AGENCY);
    expect(addBtn()?.disabled).toBe(false);
  });
});

describe('an agency that is not ours', () => {
  it('is refused a second tenant, and told why', async () => {
    // Admin-only, because the estate is a property of the partner: a Northwind
    // user cannot reach a Harbourside agency to compare the two.
    const { addBtn, chooseOrigin, view } = await openForm('superadmin');
    await chooseOrigin(NOT_OUR_AGENCY);
    expect(addBtn()?.disabled).toBe(true);
    expect(view.container.textContent).toMatch(/one tenant at a time/i);
  });
});

describe('changing the origin under tenants already entered', () => {
  it('SURVIVES a keystroke in the branch box, which is not a change of rail', async () => {
    /* The picker clears its branch selection on every keystroke, so a form that
       keyed on "multi-tenant not currently allowed" threw away everything the
       moment somebody went back to fix a typo in that field. Only a settled
       answer of "this origin cannot carry them" may remove a tenant. */
    const { q, chooseOrigin, addTenant, view } = await openForm();
    await chooseOrigin(OUR_AGENCY);
    addTenant();
    fireEvent.change(q('#x0-first'), { target: { value: 'Daniel' } });

    fireEvent.change(q('#br-name'), { target: { value: 'South Kensingto' } });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(view.container.querySelector('#x0-first')).toBeTruthy();
    expect(q('#x0-first').value).toBe('Daniel');
    expect(view.container.textContent).not.toMatch(/additional tenants were removed/i);
  });

  it('drops them rather than carrying tenants it cannot send, and says so', async () => {
    const { chooseOrigin, addTenant, view } = await openForm('superadmin');
    await chooseOrigin(OUR_AGENCY);
    addTenant();
    expect(view.container.querySelector('.shares')).toBeTruthy();

    await chooseOrigin(NOT_OUR_AGENCY);
    expect(view.container.querySelector('.shares')).toBeNull();
    expect(view.container.textContent).toMatch(/additional tenants were removed/i);
  });

  it('takes the removal notice back down once multi-tenant is on offer again', async () => {
    const { chooseOrigin, addTenant, view } = await openForm('superadmin');
    await chooseOrigin(OUR_AGENCY);
    addTenant();
    await chooseOrigin(NOT_OUR_AGENCY);
    expect(view.container.textContent).toMatch(/additional tenants were removed/i);
    await chooseOrigin(OUR_AGENCY);
    expect(view.container.textContent).not.toMatch(/additional tenants were removed/i);
  });
});

describe('a sole tenant is never asked about shares', () => {
  it('renders no share fields and no share rows', async () => {
    const { view, change } = await openForm();
    change('#ty-rent', '1800');
    expect(view.container.querySelector('.shares')).toBeNull();
    expect(view.container.querySelectorAll('.shares__in input')).toHaveLength(0);
  });

  it('says "Tenant", not "Tenants"', async () => {
    const { view } = await openForm();
    expect(view.container.querySelector('#sec-tenant .sec__title')?.textContent).toBe('Tenant');
  });
});

describe('adding a tenant', () => {
  it('opens the shares at an even split that already sums to 100', async () => {
    const { change, addTenant, shareInputs, chooseOrigin } = await openForm();
    await chooseOrigin(OUR_AGENCY);
    change('#ty-rent', '1800');
    addTenant();
    const [p1, a1, p2, a2] = shareInputs();
    expect(p1.value).toBe('50');
    expect(p2.value).toBe('50');
    expect(a1.value).toBe('900');
    expect(a2.value).toBe('900');
  });

  it('re-spreads to thirds on a third tenant, the last taking the rounding', async () => {
    const { change, addTenant, shareInputs, chooseOrigin } = await openForm();
    await chooseOrigin(OUR_AGENCY);
    change('#ty-rent', '1800');
    addTenant();
    addTenant();
    const pcts = shareInputs().filter((_, i) => i % 2 === 0).map((i) => i.value);
    expect(pcts).toEqual(['33.333', '33.333', '33.334']);
  });

  it('repeats the same tenant fields, so tenant 2 has every field tenant 1 has', async () => {
    const { q, addTenant, chooseOrigin } = await openForm();
    await chooseOrigin(OUR_AGENCY);
    addTenant();
    for (const f of ['title', 'first', 'middle', 'last', 'dob', 'email', 'phone']) {
      expect(q(`#x0-${f}`)).toBeTruthy();
    }
  });

  it('removing the extra tenant puts the form back to a sole tenant', async () => {
    const { view, addTenant, chooseOrigin } = await openForm();
    await chooseOrigin(OUR_AGENCY);
    addTenant();
    expect(view.container.querySelector('.shares')).toBeTruthy();
    fireEvent.click([...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Remove')!);
    expect(view.container.querySelector('.shares')).toBeNull();
  });
});

describe('each share row mirrors, to the penny', () => {
  it('typing a percentage fills that tenant’s amount (£1,800 @ 40% = £720)', async () => {
    const { change, addTenant, shareInputs, chooseOrigin } = await openForm();
    await chooseOrigin(OUR_AGENCY);
    change('#ty-rent', '1800');
    addTenant();
    fireEvent.change(shareInputs()[0], { target: { value: '40' } });
    expect(shareInputs()[1].value).toBe('720');
  });

  it('typing an amount sets that tenant’s percentage (£450 of £1,800 = 25%)', async () => {
    const { change, addTenant, shareInputs, chooseOrigin } = await openForm();
    await chooseOrigin(OUR_AGENCY);
    change('#ty-rent', '1800');
    addTenant();
    fireEvent.change(shareInputs()[1], { target: { value: '450' } });
    expect(shareInputs()[0].value).toBe('25');
  });

  it('rounds to the penny rather than leaking thirds', async () => {
    const { change, addTenant, shareInputs, chooseOrigin } = await openForm();
    await chooseOrigin(OUR_AGENCY);
    change('#ty-rent', '1000');
    addTenant();
    fireEvent.change(shareInputs()[0], { target: { value: '33.333' } });
    expect(shareInputs()[1].value).toBe('333.33');
  });

  it('follows the rent: the amounts re-derive from the shares that were set', async () => {
    const { change, addTenant, shareInputs, chooseOrigin } = await openForm();
    await chooseOrigin(OUR_AGENCY);
    change('#ty-rent', '1800');
    addTenant();
    fireEvent.change(shareInputs()[0], { target: { value: '60' } });
    change('#ty-rent', '2000');
    expect(shareInputs()[0].value).toBe('60');
    expect(shareInputs()[1].value).toBe('1200');
  });

  /* AUTO-BALANCE CHANGED HOW A GAP IS REACHED, and this test used to reach it by
     accident. Typing 30 into the first of two left the second on 50 and the
     total on 80, and that was the gap being asserted. Editing one share now
     spreads the remainder over the untouched one, so 30 gives 70 and the total
     is 100: there is no gap to name, which is the point of the fold.

     A gap still happens and still has to be named, but only once BOTH shares
     have been typed by hand, because auto-balance stops when there is nobody
     left to absorb the remainder. That is the case asserted now, and it is the
     one a real agent hits: they set one, then override the other. */
  it('names the gap once every share has been set by hand and they do not total 100', async () => {
    const { view, change, addTenant, shareInputs, chooseOrigin } = await openForm();
    await chooseOrigin(OUR_AGENCY);
    change('#ty-rent', '1800');
    addTenant();

    /* shareInputs() interleaves the % and £ boxes, so tenant 1 is [0] and [1]
       and tenant 2 is [2] and [3]. Asserting the £ box as well is worth the line:
       it proves auto-balance reached the mirrored value and not just the
       percentage. */
    fireEvent.change(shareInputs()[0], { target: { value: '30' } });
    expect(shareInputs()[1].value).toBe('540');   // 30% of 1800
    expect(shareInputs()[2].value).toBe('70');    // the untouched share absorbed the rest
    expect(view.container.textContent).not.toMatch(/shares total/i);

    // Second edit is the last untouched one, so nothing absorbs the remainder
    // and the shortfall is real.
    fireEvent.change(shareInputs()[2], { target: { value: '50' } });
    expect(view.container.textContent).toMatch(/shares total 80%\. Add 20% more/i);
  });
});

describe('the same person cannot be two tenants', () => {
  it('refuses a repeated email inline, against the tenant who repeats it', async () => {
    const { q, addTenant, view, chooseOrigin } = await openForm();
    await chooseOrigin(OUR_AGENCY);
    addTenant();
    fireEvent.change(q('#t-email'), { target: { value: 'amelia@example.com' } });
    fireEvent.change(q('#x0-email'), { target: { value: 'AMELIA@example.com' } });
    expect(view.container.textContent).toMatch(/Two tenants cannot share an email address/i);
  });
});
