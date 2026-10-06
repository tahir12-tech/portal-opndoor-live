/* EVERY INVITE FORM SAVES THE NAME, AND NOBODY IS CALLED BY THEIR EMAIL.
 *
 * Matt, 2026-10-01, verbatim: "I invited barb@barb.com with the name
 * 'barb barb' but she shows by email: check invite names are saved on
 * every invite form and fix it." And, in the same message: "When someone
 * has no name yet, show the email once with 'Name not set' beneath, not
 * the email twice."
 *
 * =====================================================================
 * WHAT I FOUND, AND WHAT I COULD NOT
 * =====================================================================
 *
 * barb@barb.com is stored with full_name = 'barb@barb.com', in
 * public.users AND in the auth metadata, so the invite reached the server
 * with no name at all: invite-user composed `${first} ${last}`.trim() ||
 * email. I could not reproduce the loss from the forms. All five pass
 * their two fields (these tests), the deployed function on dev is byte
 * identical to the repo (downloaded and diffed), and the fields were
 * already there on 30 September, the day she was invited.
 *
 * So this file pins the plumbing of every form, and the fallback that
 * turned a missing name into an address is gone: nothing can store an
 * email as somebody's name again, and a nameless person reads "Name not
 * set" once instead of their address twice.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/components/ui/Toast';
import { SessionProvider } from '@/session/SessionContext';
import * as users from './usersService';
import { personInitials, personLabel } from './personLabel';
import { SupplierInvite } from '@/pages/PartnerManagement/SupplierInvite';
import { InviteToLevel, type InviteContext } from '@/pages/Agencies/InviteToLevel';

const SRC = dirname(dirname(fileURLToPath(import.meta.url)));

let sent: users.AddUserInput | null = null;

beforeEach(() => {
  sent = null;
  vi.spyOn(users, 'inviteUser').mockImplementation(async (input: users.AddUserInput) => {
    sent = input;
    return { id: 'u-new', name: `${input.firstName} ${input.lastName}`.trim(), email: input.email,
      role: input.role, lastActive: 'Pending invite', status: 'pending', partner: input.partner ?? '' } as never;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const wrap = (el: React.ReactNode) => render(
  <MemoryRouter><SessionProvider><ToastProvider>{el}</ToastProvider></SessionProvider></MemoryRouter>,
);

/** Type into a labelled text box, by the label a person reads. */
async function typeInto(label: string, value: string) {
  const field = [...document.querySelectorAll('label, .field')]
    .find((f) => (f.textContent ?? '').trim().startsWith(label));
  const input = field?.querySelector('input')
    ?? [...document.querySelectorAll('input')].find((i) => (i.getAttribute('placeholder') ?? '') === label);
  expect(input, `no field called ${label}`).toBeTruthy();
  await act(async () => { fireEvent.change(input!, { target: { value } }); });
}

const press = async (label: string) => {
  const b = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((x) => (x.textContent ?? '').trim().startsWith(label));
  expect(b, `no ${label} button`).toBeTruthy();
  await act(async () => { fireEvent.click(b!); });
};

describe('the supplier People tab’s invite', () => {
  it('sends the name it was given', async () => {
    wrap(<SupplierInvite partnerId="p-1" partnerName="ZZZ Supplier" apiAccessEnabled={false}
      onInvited={() => {}} />);
    /* The tab shows a button; the form is behind it. */
    await press('Invite someone');
    await typeInto('First name', 'barb');
    await typeInto('Last name', 'barb');
    await typeInto('Work email', 'barb@barb.com');
    await press('Send invite');
    await waitFor(() => { if (!sent) throw new Error('nothing sent'); });
    expect(sent!.firstName).toBe('barb');
    expect(sent!.lastName).toBe('barb');
  });
});

describe('the agency People tab’s invite', () => {
  const ctx: InviteContext = {
    partner: 'opndoor-agents', level: 'branch', name: "Regent's Park",
    branchId: 'b-1', agencyId: 'a-1',
  } as unknown as InviteContext;

  it('sends the name it was given', async () => {
    wrap(<InviteToLevel ctx={ctx} onClose={() => {}} onInvited={() => {}} />);
    await typeInto('First name', 'barb');
    await typeInto('Last name', 'barb');
    await typeInto('Work email', 'barb@barb.com');
    await press('Send invite');
    await waitFor(() => { if (!sent) throw new Error('nothing sent'); });
    expect(sent!.firstName).toBe('barb');
    expect(sent!.lastName).toBe('barb');
  });
});

/* AND THE RULE UNDER ALL OF THEM, which is what actually stops it
   happening again: a name that is missing stays missing, and is never
   quietly replaced by the address. */
describe('nobody is named after their own email', () => {
  it('reads a missing name as missing, and says so once', () => {
    const l = personLabel('', 'barb@barb.com');
    expect(l.title).toBe('barb@barb.com');
    expect(l.sub).toBe('Name not set');
    expect(l.unnamed).toBe(true);
  });

  /* THE ROWS THAT ALREADY EXIST. invite-user stored the address as the
     name until today, so "the name IS the email" is the same state as
     "no name", and the screen must not pretend otherwise. */
  it('and treats a row stored as its own address the same way', () => {
    expect(personLabel('barb@barb.com', 'barb@barb.com').unnamed).toBe(true);
    expect(personLabel('BARB@BARB.COM', 'barb@barb.com').unnamed).toBe(true);
  });

  it('but leaves a real name alone', () => {
    const l = personLabel('Rosa Vance', 'rosa@regent.dev.test');
    expect(l).toEqual({ title: 'Rosa Vance', sub: 'rosa@regent.dev.test', unnamed: false });
  });

  /* THE AVATAR TOO. "barb@barb.com" split on spaces gave the initials
     "BA", which reads as a surname nobody has. */
  it('and takes initials from the address without inventing a surname', () => {
    expect(personInitials(personLabel('', 'barb@barb.com'))).toBe('B');
    expect(personInitials(personLabel('', 'rosa.vance@regent.test'))).toBe('RV');
    expect(personInitials(personLabel('Rosa Vance', 'r@x.test'))).toBe('RV');
  });
});

/* AND THE FORMS THIS FILE DOES NOT RENDER. The Users page and Team are
   the same shape -- two name fields, one inviteUser call -- and both need
   a hydrated book and a session to draw, which is a lot of fixture for a
   claim about two lines. So they are checked by reading, the way
   `definerAllowlistCoverage` checks the allowlist: every caller of
   inviteUser must pass a firstName and a lastName that are not literals.
   Crude on purpose, and loud at the moment somebody adds the sixth form. */
describe('every invite form in the codebase', () => {
  const FORMS = [
    'src/pages/UserManagement/UserManagement.tsx',
    'src/pages/Team/Team.tsx',
    'src/pages/PartnerManagement/SupplierInvite.tsx',
    'src/pages/Agencies/InviteToLevel.tsx',
    'src/data/orgShapes.ts',
  ];

  it('is one of the five known ones, so a new one cannot arrive unchecked', () => {
    const all = readdirSync(SRC, { recursive: true } as never) as unknown as string[];
    const callers = all
      .filter((f) => typeof f === 'string' && /\.tsx?$/.test(f) && !f.includes('.test.'))
      .filter((f) => readFileSync(join(SRC, f), 'utf8').includes('inviteUser({'))
      .map((f) => `src/${f.split(sep).join('/')}`)
      .sort();
    expect(callers).toEqual([...FORMS].sort());
  });

  it('and each one sends a name it was given, not an empty literal', () => {
    for (const f of FORMS) {
      const src = readFileSync(join(SRC, '..', f), 'utf8');
      const call = src.slice(src.indexOf('inviteUser({'));
      const first = /firstName:\s*([^,]+),/.exec(call)?.[1] ?? '';
      const last = /lastName:\s*([^,]+),/.exec(call)?.[1] ?? '';
      expect(first, `${f} sends no firstName`).not.toBe('');
      expect(last, `${f} sends no lastName`).not.toBe('');
      expect(first.replace(/\s/g, ''), `${f} hardcodes an empty firstName`).not.toMatch(/^['"]{2}$/);
      expect(last.replace(/\s/g, ''), `${f} hardcodes an empty lastName`).not.toMatch(/^['"]{2}$/);
    }
  });
});
