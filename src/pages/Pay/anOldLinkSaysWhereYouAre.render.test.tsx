/* =====================================================================
   THE LINK THE TENANT SAVED, OPENED AFTER THEY PAID.

   Matt, 2026-10-03: "Tenant payment link opened after payment: reflect where
   they actually are. If the deed is signed: 'Your guarantee fee is paid and
   your Deed of Guarantee is signed. Nothing more is needed. A copy was emailed
   to you.' If paid but not yet signed: show the 'Sign your deed now' button.
   Same for every tenant-facing page reached from an old link."

   THE SECOND OPENING IS THE ORDINARY JOURNEY, not the edge. The payment email
   is the one a tenant keeps, so they come back to it: to check they paid, to
   find the reference, to sign. The page told every one of them the same
   sentence, "Your Deed of Guarantee will be sent to you to sign
   electronically" -- to somebody who had already signed it, and to somebody
   whose deed was waiting with no way to reach it from here.

   THE POST-CHECKOUT PAGE HAD THE BUTTON ALL ALONG, which is why this reads as
   an oversight rather than a feature: `PaymentConfirmed` draws exactly these
   three states. It mints its signing link from a STRIPE SESSION ID, and a
   saved link has none, so the door was shut to precisely the reader Matt is
   describing.
   ===================================================================== */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PayPageData } from './paymentPageApi';

let answer: PayPageData = { ok: true };
const signCalls: string[] = [];

vi.mock('./paymentPageApi', async (io) => {
  const actual = await io<typeof import('./paymentPageApi')>();
  return {
    ...actual,
    getPayPage: () => Promise.resolve(answer),
    requestSigningLinkByToken: (t: string) => {
      signCalls.push(t);
      return Promise.resolve({ ok: true, deedReady: true, signingUrl: 'https://sign.example/abc' });
    },
  };
});

import { PayLanding } from './PayLanding';

const PAID: PayPageData = {
  ok: true, ref: 'GR-20501', isPaid: true, status: 'paid',
  monthlyRent: 1200, feeAmount: 1200,
};

function open() {
  return render(
    <MemoryRouter initialEntries={['/pay?token=zzz-token']}>
      <PayLanding />
    </MemoryRouter>,
  );
}
const body = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

afterEach(() => { cleanup(); signCalls.length = 0; });

describe('paid, and the deed is signed', () => {
  it('says so, in Matt’s own words', async () => {
    answer = { ...PAID, deedSigned: true };
    open();
    await waitFor(() => expect(body()).toMatch(/You are all set/));
    expect(body()).toContain('Your guarantee fee is paid and your Deed of Guarantee is signed. Nothing more is needed. A copy was emailed to you');
  });

  /* THE OLD SENTENCE IS THE ONE THAT WAS WRONG HERE: a tenant who has signed
     being told their deed will be sent to them to sign. */
  it('and never says the deed will be sent to them to sign', async () => {
    answer = { ...PAID, deedSigned: true };
    open();
    await waitFor(() => expect(body()).toMatch(/You are all set/));
    expect(body()).not.toMatch(/will be sent to you to sign/);
  });

  it('and offers nothing to press, because there is nothing to do', async () => {
    answer = { ...PAID, deedSigned: true };
    open();
    await waitFor(() => expect(body()).toMatch(/You are all set/));
    expect(screen.queryAllByRole('button').map((b) => b.textContent)).not.toContain('Sign your deed now');
  });
});

describe('paid, and the deed is waiting to be signed', () => {
  it('offers the button', async () => {
    answer = { ...PAID, deedReady: true };
    open();
    await waitFor(() => expect(body()).toMatch(/ready to sign/));
    expect(screen.getAllByRole('button').some((b) => /Sign your deed now/.test(b.textContent ?? ''))).toBe(true);
  });

  /* IT MINTS FROM THE TOKEN, which is the whole reason this path exists: the
     saved link has no Stripe session id to mint from. */
  it('and mints the link from the token in the saved link', async () => {
    answer = { ...PAID, deedReady: true };
    open();
    await waitFor(() => expect(body()).toMatch(/ready to sign/));
    const btn = screen.getAllByRole('button').find((b) => /Sign your deed now/.test(b.textContent ?? ''))!;
    btn.click();
    await waitFor(() => expect(signCalls).toEqual(['zzz-token']));
  });
});

describe('paid, and the deed is still being prepared', () => {
  /* A REAL STATE AND NOBODY'S FAULT: the deed is generated after payment, so
     there is a gap. The old sentence is the right one here, and only here. */
  it('keeps the sentence that was only ever right for this case', async () => {
    answer = { ...PAID };
    open();
    await waitFor(() => expect(body()).toMatch(/This fee has been paid/));
    expect(body()).toMatch(/will be sent to you to sign electronically/);
    expect(screen.queryAllByRole('button').map((b) => b.textContent)).not.toContain('Sign your deed now');
  });
});
