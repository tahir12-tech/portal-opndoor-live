/* The New application form when there is more than one tenant.

   Two things are being locked here. First, that a SOLE tenant is never asked
   about shares at all: the ruling is that one applicant carries 100% and should
   not have to say so, and a form that asks is the regression. Second, that once
   a second tenant exists, each share row's percentage and amount mirror to the
   penny and the shares are defaulted to something that already sums to 100. */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { App } from '@/App';

afterEach(cleanup);

async function openForm() {
  localStorage.setItem('grp_role', 'management');
  const view = render(
    <MemoryRouter initialEntries={['/new-application']}>
      <SessionProvider><ToastProvider><App /></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!document.querySelector('#ty-rent')) throw new Error('form not ready'); });
  const q = <T extends HTMLElement = HTMLInputElement>(sel: string) => view.container.querySelector<T>(sel)!;
  const change = (sel: string, value: string) => fireEvent.change(q(sel), { target: { value } });
  const addTenant = () => {
    const btn = [...view.container.querySelectorAll('button')].find((b) => /add another tenant/i.test(b.textContent ?? ''))!;
    fireEvent.click(btn);
  };
  /** The share inputs, in tenant order: [pct, amount, pct, amount, ...]. */
  const shareInputs = () => [...view.container.querySelectorAll<HTMLInputElement>('.shares__in input')];
  return { q, change, addTenant, shareInputs, view };
}

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
    const { change, addTenant, shareInputs } = await openForm();
    change('#ty-rent', '1800');
    addTenant();
    const [p1, a1, p2, a2] = shareInputs();
    expect(p1.value).toBe('50');
    expect(p2.value).toBe('50');
    expect(a1.value).toBe('900');
    expect(a2.value).toBe('900');
  });

  it('re-spreads to thirds on a third tenant, the last taking the rounding', async () => {
    const { change, addTenant, shareInputs } = await openForm();
    change('#ty-rent', '1800');
    addTenant();
    addTenant();
    const pcts = shareInputs().filter((_, i) => i % 2 === 0).map((i) => i.value);
    expect(pcts).toEqual(['33.333', '33.333', '33.334']);
  });

  it('repeats the same tenant fields, so tenant 2 has every field tenant 1 has', async () => {
    const { q, addTenant } = await openForm();
    addTenant();
    for (const f of ['title', 'first', 'middle', 'last', 'dob', 'email', 'phone']) {
      expect(q(`#x0-${f}`)).toBeTruthy();
    }
  });

  it('removing the extra tenant puts the form back to a sole tenant', async () => {
    const { view, addTenant } = await openForm();
    addTenant();
    expect(view.container.querySelector('.shares')).toBeTruthy();
    fireEvent.click([...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Remove')!);
    expect(view.container.querySelector('.shares')).toBeNull();
  });
});

describe('each share row mirrors, to the penny', () => {
  it('typing a percentage fills that tenant’s amount (£1,800 @ 40% = £720)', async () => {
    const { change, addTenant, shareInputs } = await openForm();
    change('#ty-rent', '1800');
    addTenant();
    fireEvent.change(shareInputs()[0], { target: { value: '40' } });
    expect(shareInputs()[1].value).toBe('720');
  });

  it('typing an amount sets that tenant’s percentage (£900 of £1,800 = 50%)', async () => {
    const { change, addTenant, shareInputs } = await openForm();
    change('#ty-rent', '1800');
    addTenant();
    fireEvent.change(shareInputs()[1], { target: { value: '450' } });
    expect(shareInputs()[0].value).toBe('25');
  });

  it('rounds to the penny rather than leaking thirds', async () => {
    const { change, addTenant, shareInputs } = await openForm();
    change('#ty-rent', '1000');
    addTenant();
    fireEvent.change(shareInputs()[0], { target: { value: '33.333' } });
    expect(shareInputs()[1].value).toBe('333.33');
  });

  it('follows the rent: the amounts re-derive from the shares that were set', async () => {
    const { change, addTenant, shareInputs } = await openForm();
    change('#ty-rent', '1800');
    addTenant();
    fireEvent.change(shareInputs()[0], { target: { value: '60' } });
    change('#ty-rent', '2000');
    expect(shareInputs()[0].value).toBe('60');
    expect(shareInputs()[1].value).toBe('1200');
  });

  it('names the gap when the shares do not describe the whole tenancy', async () => {
    const { view, change, addTenant, shareInputs } = await openForm();
    change('#ty-rent', '1800');
    addTenant();
    fireEvent.change(shareInputs()[0], { target: { value: '30' } });
    expect(view.container.textContent).toMatch(/shares total 80%\. Add 20% more/i);
  });
});

describe('the same person cannot be two tenants', () => {
  it('refuses a repeated email inline, against the tenant who repeats it', async () => {
    const { q, addTenant, view } = await openForm();
    addTenant();
    fireEvent.change(q('#t-email'), { target: { value: 'amelia@example.com' } });
    fireEvent.change(q('#x0-email'), { target: { value: 'AMELIA@example.com' } });
    expect(view.container.textContent).toMatch(/Two tenants cannot share an email address/i);
  });
});
