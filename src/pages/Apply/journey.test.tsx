/* The steps into the journey: register, claim an invite, open a draft, come
   back to it, and save a section.

   NONE OF THESE HAD A TEST. Everything before this file covered what a tenant
   is TOLD (status.test.ts) or that the screen mounts (Apply.render.test.tsx).
   Nothing covered getting in, or the resume path, which is the one a tenant on
   a phone uses every time they come back to a form they did not finish in one
   sitting.

   These run in mock mode, where SUPABASE_ENABLED is false, so they prove the
   CLIENT contract: which call is made, with what, and what the screen does with
   the answer. The server side of each is a REGRESSION row. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Register, InviteLanding } from './FrontDoor';
import { Apply } from './Apply';
import * as auth from '@/tenant/tenantAuth';
import * as api from '@/tenant/tenantApi';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function at(node: React.ReactElement, path = '/') {
  return render(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>);
}

const APPLICANT = { email: 's@example.invalid', first_name: 'Sam', last_name: 'Okafor' };

function draft(over: Partial<api.ApplicationBundle['application']> = {}) {
  return {
    id: 'a1', guarantee_ref: 'GR-TEST', status: 'draft',
    monthly_rent: 1200, tenancy_start: '2026-09-01',
    prop_addr1: '1 Test Street', prop_addr2: null, prop_city: 'Sheffield',
    prop_county: null, prop_postcode: 'S1 1AA',
    tenant_first_name: 'Sam', tenant_last_name: 'Okafor', tenant_email: 's@example.invalid',
    ...over,
  };
}

function stubSignedIn(bundle: Partial<api.ApplicationBundle> = {}) {
  vi.spyOn(auth, 'currentTenant').mockResolvedValue(APPLICANT);
  vi.spyOn(api, 'listApplications').mockResolvedValue({ applicant: APPLICANT, applications: [draft()] as never });
  vi.spyOn(api, 'getApplication').mockResolvedValue({
    application: draft(), editable: true, fee_paid: true,
    profile: { first_name: 'Sam', last_name: 'Okafor' },
    addresses: [], incomes: [], documents: [], agent: null,
    ...bundle,
  } as never);
  vi.spyOn(api, 'prequalify').mockResolvedValue({ outcome: 'nothing_rules_you_out', reasons: [] } as never);
}

describe('creating an account', () => {
  it('will not submit until the form is actually complete', () => {
    at(<Register />, '/apply/register');
    const submit = screen.getByRole('button', { name: /create/i });
    expect(submit.hasAttribute('disabled')).toBe(true);
  });

  it('requires a password of at least ten characters', () => {
    at(<Register />, '/apply/register');
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Okafor' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 's@example.invalid' } });
    const submit = screen.getByRole('button', { name: /create/i });

    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'short' } });
    expect(submit.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'a-long-enough-one' } });
    expect(submit.hasAttribute('disabled')).toBe(false);
  });

  it('passes the invite token through, so the agent’s application is claimed', async () => {
    const register = vi.spyOn(auth, 'register').mockResolvedValue(undefined as never);
    vi.spyOn(api, 'claimInvite').mockResolvedValue('a1');
    at(<Register />, '/apply/register?invite=TOK123');

    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Okafor' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 's@example.invalid' } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'a-long-enough-one' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => expect(register).toHaveBeenCalled());
    expect(register.mock.calls[0][0]).toMatchObject({ invite: 'TOK123' });
  });

  it('surfaces a failure rather than looking like it worked', async () => {
    vi.spyOn(auth, 'register').mockRejectedValue(new Error('That address is already registered.'));
    at(<Register />, '/apply/register');
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Okafor' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 's@example.invalid' } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'a-long-enough-one' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(screen.getByText(/already registered/i)).toBeTruthy());
  });
});

describe('an invite link', () => {
  it('shows the property the agent already filled in', async () => {
    vi.spyOn(auth, 'inviteInfo').mockResolvedValue({
      ok: true, valid: true, email: 's@example.invalid',
      prop_addr1: '12 Bramble Court', prop_postcode: 'S7 1FD',
      monthly_rent: 1450, tenancy_start: null, already_claimed: false,
    } as never);
    at(<InviteLanding />, '/apply/invite?token=TOK123');
    await waitFor(() => expect(screen.getByText(/Bramble Court/)).toBeTruthy());
  });

  it('says so when the link has already been used, rather than failing silently', async () => {
    vi.spyOn(auth, 'inviteInfo').mockResolvedValue({
      ok: true, valid: true, email: 's@example.invalid', already_claimed: true,
    } as never);
    const { container } = at(<InviteLanding />, '/apply/invite?token=TOK123');
    await waitFor(() => expect(container.textContent).toMatch(/already been used|already claimed|already/i));
  });

  it('carries the token to sign-in, so the draft is not lost', async () => {
    vi.spyOn(auth, 'inviteInfo').mockResolvedValue({
      ok: true, valid: true, email: 's@example.invalid', already_claimed: false,
    } as never);
    const { container } = at(<InviteLanding />, '/apply/invite?token=TOK123');
    await waitFor(() => expect(container.querySelector('a[href*="/apply/signin"]')).toBeTruthy());
    const href = container.querySelector('a[href*="/apply/signin"]')!.getAttribute('href')!;
    expect(href).toContain('invite=TOK123');
  });
});

describe('coming back to a draft', () => {
  it('loads the saved application rather than starting a new one', async () => {
    stubSignedIn();
    at(<Apply />, '/apply');
    await waitFor(() => expect(api.getApplication).toHaveBeenCalled());
    // The resume path: an existing draft is fetched, not created.
    expect(api.getApplication).toHaveBeenCalledWith('a1');
  });

  it('saves a section by patch, not by rewriting the record', async () => {
    const saveProperty = vi.spyOn(api, 'saveProperty').mockResolvedValue(undefined as never);
    stubSignedIn();
    at(<Apply />, '/apply');
    await waitFor(() => expect(screen.getByLabelText(/address line 1/i)).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/address line 1/i), { target: { value: '2 New Road' } });
    await waitFor(() => expect(saveProperty).toHaveBeenCalled(), { timeout: 3000 });

    const [appId, patch] = saveProperty.mock.calls.at(-1)!;
    expect(appId).toBe('a1');
    // ONE key. The server upserts a patch, so sending the whole record would let
    // a field they have not reached overwrite one they have.
    expect(Object.keys(patch as object).length).toBe(1);
  });

  it('debounces, so typing a line is one save and not one per character', async () => {
    const saveProperty = vi.spyOn(api, 'saveProperty').mockResolvedValue(undefined as never);
    stubSignedIn();
    at(<Apply />, '/apply');
    await waitFor(() => expect(screen.getByLabelText(/address line 1/i)).toBeTruthy());

    const box = screen.getByLabelText(/address line 1/i);
    for (const v of ['2', '2 ', '2 N', '2 Ne', '2 New']) fireEvent.change(box, { target: { value: v } });
    await waitFor(() => expect(saveProperty).toHaveBeenCalled(), { timeout: 3000 });
    expect(saveProperty).toHaveBeenCalledTimes(1);
  });

  it('does not let a submitted application be edited', async () => {
    stubSignedIn({ application: draft({ status: 'sent' }) as never, editable: false });
    at(<Apply />, '/apply');
    await waitFor(() => expect(api.getApplication).toHaveBeenCalled());
    const inputs = document.querySelectorAll('input:not([readonly]):not([disabled])');
    expect(inputs.length).toBe(0);
  });
});
