/* Tenant sign-in at /apply/signin, end to end through the six-digit code.

   WHY THIS FILE EXISTS. The only tests that ever covered a tenant signing in
   were written against the /login Tenant tab, and they went when that tab did:
   nine tests deleted, three of them the only coverage of the email code
   anywhere in the suite. Removing the tab was right; removing the coverage of a
   flow that still exists was not. These are those three, ported to the page the
   flow actually lives on, plus the ones for the form fixes.

   Under vitest SUPABASE_ENABLED is false, so signInStart resolves without a
   backend and verifyCode accepts any six digits. That is enough to prove the
   SHAPE: a password alone does not sign anybody in, a code step follows it, and
   the code is six digits or nothing. The server-side half, that the password is
   checked in tenant-auth and the session it produces is discarded, is REGRESSION
   H19.7 and cannot be asserted from here. */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SignIn } from './FrontDoor';

afterEach(() => cleanup());

function at(path = '/apply/signin') {
  return render(<MemoryRouter initialEntries={[path]}><SignIn /></MemoryRouter>);
}

async function submitPassword() {
  at();
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 't@example.invalid' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-password' } });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
  await waitFor(() => expect(screen.getByLabelText('Confirmation code')).toBeTruthy());
}

describe('signing in as a tenant', () => {
  it('asks for a code after the password, not straight in', async () => {
    await submitPassword();
    expect(screen.getByText('Check your email')).toBeTruthy();
    expect(screen.getByRole('button', { name: /confirm and continue/i })).toBeTruthy();
  });

  it('will not accept fewer than six digits', async () => {
    await submitPassword();
    const confirm = screen.getByRole('button', { name: /confirm and continue/i });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Confirmation code'), { target: { value: '12345' } });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Confirmation code'), { target: { value: '123456' } });
    expect(confirm.hasAttribute('disabled')).toBe(false);
  });

  it('strips anything that is not a digit', async () => {
    await submitPassword();
    const box = screen.getByLabelText('Confirmation code') as HTMLInputElement;
    fireEvent.change(box, { target: { value: '12ab34cd56' } });
    expect(box.value).toBe('123456');
  });

  it('lets somebody go back and use a different address', async () => {
    await submitPassword();
    fireEvent.click(screen.getByRole('button', { name: /different email address/i }));
    await waitFor(() => expect(screen.getByLabelText('Email address')).toBeTruthy());
  });

  it('will not submit without both fields', () => {
    at();
    const submit = screen.getByRole('button', { name: /sign in/i });
    expect(submit.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 't@example.invalid' } });
    expect(submit.hasAttribute('disabled')).toBe(true);
  });
});

describe('the form the applicant sees', () => {
  it('offers creating an account, as a link', () => {
    const { container } = at();
    const create = container.querySelector('.ap-foot a')!;
    expect(create).toBeTruthy();
    expect(create.getAttribute('href')).toBe('/apply/register');
  });

  it('stacks the fields in one column', () => {
    const { container } = at();
    // .ap-grid is the two-column application layout and is wrong here.
    expect(container.querySelector('.ap-grid')).toBeNull();
    expect(container.querySelector('.ap-stack')).toBeTruthy();
  });

  it('puts the forgotten-password link above the submit, not beside it', () => {
    const { container } = at();
    const row = container.querySelector('.ap-row-end')!;
    const submit = container.querySelector('.ap-stack button[type="submit"]')!;
    expect(row.querySelector('a')!.getAttribute('href')).toBe('/apply/forgot');
    expect(row.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('spaces the heading off the first field', () => {
    const { container } = at();
    expect(container.querySelector('.auth__card > .ap-shell-body')).toBeTruthy();
    // .ap-body is the two-column application layout; reusing it squeezed this
    // card into a 232px column.
    expect(container.querySelector('.ap-body')).toBeNull();
  });

  it('does not tell an applicant they are in the referral portal', () => {
    at();
    expect(document.title).toBe('Sign in | opndoor guarantor application');
    expect(document.title).not.toMatch(/Guarantee Referral Portal/);
  });
});
