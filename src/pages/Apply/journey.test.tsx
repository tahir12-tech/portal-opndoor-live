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
  it('lets the press happen and shows the missing requirement against the field', () => {
    // The button used to be silently disabled with the rule in grey above the
    // field. Now the press is allowed and the reason shows against the field.
    at(<Register />, '/apply/register');
    const submit = screen.getByRole('button', { name: /create/i });
    expect(submit.hasAttribute('disabled')).toBe(false);
    fireEvent.click(submit);
    expect(screen.getByText(/enter your first name/i)).toBeTruthy();
    expect(screen.getByText(/use at least 10 characters/i)).toBeTruthy();
  });

  it('hands the typed address to the sign-in link rather than asking twice', () => {
    // "Already have an account? Sign in" went to a bare /login?tab=tenant with
    // the address sitting in state three lines away.
    at(<Register />, '/apply/register');
    const link = () => screen.getByRole('link', { name: /^sign in$/i }).getAttribute('href');
    expect(link()).toBe('/login?tab=tenant');
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'sam@example.co.uk' } });
    expect(link()).toBe('/login?tab=tenant&email=sam%40example.co.uk');
  });

  it('flags a too-short password against the field, and clears it on edit', () => {
    at(<Register />, '/apply/register');
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Okafor' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 's@example.invalid' } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'short' } });

    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(screen.getByText(/use at least 10 characters/i)).toBeTruthy();
    // Editing the field clears its error.
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'a-long-enough-one' } });
    expect(screen.queryByText(/use at least 10 characters/i)).toBeNull();
  });

  it('rejects an email typed into the Mobile number field, with a message, and does not register', async () => {
    const register = vi.spyOn(auth, 'register').mockResolvedValue(undefined as never);
    at(<Register />, '/apply/register');
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Okafor' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 's@example.invalid' } });
    fireEvent.change(screen.getByLabelText(/mobile number/i), { target: { value: 'saddassa@shshs.com' } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'a-long-enough-one' } });

    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(screen.getByText(/enter a phone number, UK or international/i)).toBeTruthy();
    expect(register).not.toHaveBeenCalled();
    // Correcting it clears the error and lets the account be created.
    fireEvent.change(screen.getByLabelText(/mobile number/i), { target: { value: '07700 900123' } });
    expect(screen.queryByText(/enter a phone number, UK or international/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(register).toHaveBeenCalled());
  });

  it('leaves the optional Mobile number empty without complaint', async () => {
    const register = vi.spyOn(auth, 'register').mockResolvedValue(undefined as never);
    at(<Register />, '/apply/register');
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Okafor' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 's@example.invalid' } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'a-long-enough-one' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(register).toHaveBeenCalled());
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
    // /apply/signin is gone: there is one sign-in page. What must survive the
    // move is the token, because without it the tenant opens an empty draft
    // instead of claiming the application their agent already built.
    await waitFor(() => expect(container.querySelector('a[href*="/login"]')).toBeTruthy());
    const href = container.querySelector('a[href*="/login"]')!.getAttribute('href')!;
    expect(href).toContain('tab=tenant');
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

  it('does not save while the tenant types: only the step button saves', async () => {
    const saveProperty = vi.spyOn(api, 'saveProperty').mockResolvedValue(undefined as never);
    stubSignedIn();
    at(<Apply />, '/apply');
    await waitFor(() => expect(screen.getByLabelText(/address line 1/i)).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/address line 1/i), { target: { value: '2 New Road' } });
    // No debounce, no blur save, no page-hide save. Typing writes nothing to the
    // database that only accepts finished values.
    await new Promise((r) => setTimeout(r, 120));
    expect(saveProperty).not.toHaveBeenCalled();
  });

  it('writes the whole step when Save and continue is pressed, then advances', async () => {
    const saveProperty = vi.spyOn(api, 'saveProperty').mockResolvedValue(undefined as never);
    const saveAgent = vi.spyOn(api, 'saveAgent').mockResolvedValue(undefined as never);
    // A complete property + delivery contact, so the step button is enabled.
    stubSignedIn({ agent: { kind: 'letting_agent', agency_name: 'Foo Lettings', last_name: 'Okafor', phone: '07700 900123', email: 'foo@bar.co' } });
    at(<Apply />, '/apply');
    const next = await screen.findByRole('button', { name: /save and continue/i });
    expect(next.hasAttribute('disabled')).toBe(false);

    fireEvent.click(next);
    await waitFor(() => expect(saveProperty).toHaveBeenCalled());
    const [appId, patch] = saveProperty.mock.calls.at(-1)!;
    expect(appId).toBe('a1');
    // The whole step is written on continue, every field it carries, because the
    // step is complete before the button enables.
    expect(Object.keys(patch as object).length).toBeGreaterThan(1);
    expect(saveAgent).toHaveBeenCalledWith('a1', expect.objectContaining({ kind: 'letting_agent' }));
  });

  it('shows the failure against the step and does not advance when a save fails', async () => {
    vi.spyOn(api, 'saveProperty').mockRejectedValue(new Error('Could not save.'));
    vi.spyOn(api, 'saveAgent').mockResolvedValue(undefined as never);
    stubSignedIn({ agent: { kind: 'letting_agent', agency_name: 'Foo Lettings', last_name: 'Okafor', phone: '07700 900123', email: 'foo@bar.co' } });
    at(<Apply />, '/apply');
    const next = await screen.findByRole('button', { name: /save and continue/i });

    fireEvent.click(next);
    await waitFor(() => expect(screen.getByText(/could not save/i)).toBeTruthy());
    // Still on the property step, its button still there to press again.
    expect(screen.getByRole('button', { name: /save and continue/i })).toBeTruthy();
  });

  it('does not let a submitted application be edited', async () => {
    stubSignedIn({ application: draft({ status: 'sent' }) as never, editable: false });
    at(<Apply />, '/apply');
    await waitFor(() => expect(api.getApplication).toHaveBeenCalled());
    const inputs = document.querySelectorAll('input:not([readonly]):not([disabled])');
    expect(inputs.length).toBe(0);
  });
});
