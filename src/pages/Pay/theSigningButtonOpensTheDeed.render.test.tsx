/* THE SIGNING BUTTON OPENS THE DEED, NOT THE PAYMENT PAGE.
 *
 * Matt (be): 'Tenant "Sign your Deed of Guarantee" email button: open the
 * signing page directly, not the "This fee has been paid / Sign your deed
 * now" page first. If the deed is already signed, show "Your deed is already
 * signed. Nothing more to do."'
 *
 * MY OWN DOING, FROM (ai) THIS EVENING. I pointed that button at
 * `/pay?token=` because the token is the door that survives 90 days in an
 * inbox and the page already knew how to mint a signing session. What the
 * tenant got was the PAYMENT landing: told their fee is paid, which they
 * know, and offered a second button. Every extra press is tenants who do not
 * sign.
 *
 * THE THREE OUTCOMES ARE WHY THE PAGE SITS IN BETWEEN AT ALL, and they all
 * still have to be handled -- a deed can be signed already, ready, or still
 * being prepared, and sending either of the first and last to a signing
 * session fails in front of the tenant. What changes is that the page
 * RESOLVES them instead of asking the tenant to.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const getPayPage = vi.fn();
const requestSigningLinkByToken = vi.fn();

vi.mock('@/pages/Pay/paymentPageApi', () => ({
  getPayPage: (...a: unknown[]) => getPayPage(...a),
  requestSigningLinkByToken: (...a: unknown[]) => requestSigningLinkByToken(...a),
  startCheckout: vi.fn(),
  declineApplication: vi.fn(),
}));

const PAID = {
  ok: true, isPaid: true, isClosed: false, ref: 'GR-TEST01',
  deedReady: true, deedSigned: false,
};

async function openWith(query: string) {
  const { PayLanding } = await import('./PayLanding');
  render(
    <MemoryRouter initialEntries={[`/pay${query}`]}>
      <Routes><Route path="/pay" element={<PayLanding />} /></Routes>
    </MemoryRouter>,
  );
}

describe('arriving from the email\'s signing button', () => {
  beforeEach(() => {
    cleanup();
    getPayPage.mockReset();
    requestSigningLinkByToken.mockReset();
    vi.resetModules();
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('goes straight to the deed, without the payment page in between', async () => {
    getPayPage.mockResolvedValue(PAID);
    requestSigningLinkByToken.mockResolvedValue({ ok: true, deedReady: true, signingUrl: 'https://pandadoc.test/s/abc' });
    await openWith('?token=t1&sign=1');

    await waitFor(() => expect(requestSigningLinkByToken).toHaveBeenCalledWith('t1'));
    // And the page the tenant was being sent through is NOT what they read.
    expect(screen.queryByText(/This fee has been paid/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Sign your deed now/i })).toBeNull();
  });

  /* MATT'S EXACT SENTENCE, and a different one from "You are all set".
     That answers somebody who reopened their PAYMENT link and is being told
     where they are; this answers somebody who pressed a button saying "sign"
     and needs to know why nothing opened. */
  it('and says so plainly when it is already signed, without opening a session', async () => {
    getPayPage.mockResolvedValue({ ...PAID, deedSigned: true });
    await openWith('?token=t2&sign=1');

    await screen.findByText(/Your deed is already signed/i);
    expect(screen.getByText(/Nothing more to do/i)).toBeTruthy();
    // No session is minted on a signed deed.
    expect(requestSigningLinkByToken).not.toHaveBeenCalled();
  });

  /* STILL BEING PREPARED IS A REAL STATE and nobody's fault: the deed is
     generated after payment. Sending them to a signing session would fail
     in front of them. */
  it('and does not try to open one that is not ready yet', async () => {
    getPayPage.mockResolvedValue({ ...PAID, deedReady: false });
    await openWith('?token=t3&sign=1');

    await screen.findByText(/will be sent to you to sign/i);
    expect(requestSigningLinkByToken).not.toHaveBeenCalled();
  });
});

describe('arriving from the saved payment link, as before', () => {
  beforeEach(() => {
    /* EXPLICIT CLEANUP, because this suite asserts the ABSENCE of text. A
       leftover render from the case above leaves "Your deed is already
       signed" in the document, and queryByText finds it -- which is exactly
       how the last assertion here failed first time round. */
    cleanup();
    getPayPage.mockReset();
    requestSigningLinkByToken.mockReset();
    vi.resetModules();
  });
  afterEach(() => { cleanup(); });

  /* WITHOUT `sign=1` NOTHING CHANGES, which is the half that protects the
     journey Matt approved on 2026-10-03. The payment email's own link is
     still the page that tells a tenant where they are, and it must not start
     redirecting people who only wanted to check. */
  it('still shows the page, and does not redirect anybody', async () => {
    getPayPage.mockResolvedValue(PAID);
    await openWith('?token=t4');

    await screen.findByText(/This fee has been paid/i);
    expect(screen.getByRole('button', { name: /Sign your deed now/i })).toBeTruthy();
    expect(requestSigningLinkByToken).not.toHaveBeenCalled();
  });

  it('and keeps "You are all set" for a signed deed reached that way', async () => {
    getPayPage.mockResolvedValue({ ...PAID, deedSigned: true });
    await openWith('?token=t5');

    await screen.findByText(/You are all set/i);
    expect(screen.queryByText(/Your deed is already signed/i)).toBeNull();
  });
});
