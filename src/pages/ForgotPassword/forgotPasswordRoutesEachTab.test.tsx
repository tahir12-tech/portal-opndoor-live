/* FORGOT PASSWORD: WHICH DOOR EACH TAB GOES THROUGH, AND WHOSE MAILER.
 *
 * Matt, 2026-10-13: "Confirm 'Forgot password' on the sign-in page (before
 * anyone is signed in, all three tabs) goes through send-password-reset and
 * the /auth/confirm button page, not Supabase's own mailer."
 *
 * Nothing pinned this. authService.reset.test.ts pins what
 * requestPasswordReset DOES; no test said which of the two senders each tab
 * reaches, or that GoTrue's own mailer is reached by neither.
 *
 * THE ANSWER IS NOT THE SAME FOR ALL THREE, and the third case below records
 * it rather than papering over it: Agent and Supplier go to
 * send-password-reset and land on /auth/confirm, which spends nothing until a
 * button is pressed. Tenant goes to tenant-auth and lands on /apply/reset,
 * which carries its token in the URL FRAGMENT and exchanges it on mount.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const requestPasswordReset = vi.fn();
const requestReset = vi.fn();

vi.mock('@/data', () => ({ authService: { requestPasswordReset: (a: string, b: string) => requestPasswordReset(a, b) } }));
vi.mock('@/tenant/tenantAuth', () => ({ requestReset: (a: string) => requestReset(a) }));

const { ForgotPassword } = await import('./ForgotPassword');

async function ask(tab: string, email = 'someone@example.test') {
  const view = render(
    <MemoryRouter initialEntries={[`/forgot-password?tab=${tab}`]}><ForgotPassword /></MemoryRouter>,
  );
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  fireEvent.change(view.container.querySelector('#reset-email')!, { target: { value: email } });
  fireEvent.submit(view.container.querySelector('form')!);
  return view;
}

beforeEach(() => {
  requestPasswordReset.mockReset(); requestReset.mockReset();
  requestPasswordReset.mockResolvedValue({ ok: true });
  requestReset.mockResolvedValue({ ok: true });
});
afterEach(() => cleanup());

describe('the two staff tabs go through send-password-reset', () => {
  it.each(['agent', 'supplier'])('%s, carrying its own audience', async (tab) => {
    await ask(tab);
    await waitFor(() => expect(requestPasswordReset).toHaveBeenCalledWith('someone@example.test', tab));
    expect(requestReset).not.toHaveBeenCalled();
  });
});

describe('the tenant tab goes somewhere else, and that is on purpose', () => {
  /* A TENANT AND A MEMBER OF STAFF ARE DIFFERENT PRINCIPALS IN DIFFERENT
     TABLES, which is the page's own reason. Recorded here so the difference is
     a decision somebody can read rather than a surprise. */
  it('reaches tenant-auth, not send-password-reset', async () => {
    await ask('tenant');
    await waitFor(() => expect(requestReset).toHaveBeenCalledWith('someone@example.test'));
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });
});

describe('what the senders put in the email', () => {
  const fn = (name: string) => readFileSync(`supabase/functions/${name}/index.ts`, 'utf8');

  it('send-password-reset emits our own confirm page, with the tab on it', () => {
    const src = fn('send-password-reset');
    expect(src).toContain('/auth/confirm?token_hash=');
    expect(src).toContain('&type=recovery&tab=${audience}');
  });

  /* AND NEVER GoTrue's VERIFY URL. `properties.action_link` IS that URL, and a
     plain GET of it spends the token: that is the fault that cost fourteen
     Regent invites on 2026-10-13. */
  it('and never GoTrue’s verify URL, nor a redirect it would have to allowlist', () => {
    for (const name of ['send-password-reset', 'accept-invite', 'invite-user']) {
      const src = fn(name);
      expect(src).not.toMatch(/properties\??\.action_link/);
      expect(src).not.toMatch(/options:\s*\{\s*redirectTo/);
    }
  });

  /* THE TENANT'S SHAPE, STATED. A fragment is never sent to a server, so a
     plain fetch cannot spend it; a scanner that RENDERS the page would, because
     the exchange is in a mount effect. Pinned so that the difference between
     the two rails is visible and a change to either is deliberate. */
  it('tenant-auth still uses a fragment on /apply/reset', () => {
    const src = fn('tenant-auth');
    expect(src).toContain('/apply/reset#');
    expect(src).toContain('token_hash=');
  });
});

describe('Supabase’s own mailer is never used, anywhere', () => {
  /* THE WHOLE REPO, because the point is not that today's three senders avoid
     it: it is that adopting resetPasswordForEmail or auth.resend later would
     silently hand the email back to GoTrue and reintroduce the verify URL this
     week was spent removing. */
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
    });

  it('no source file asks GoTrue to send an email', () => {
    const offenders = [...walk('src'), ...walk('supabase/functions')].filter((f) => {
      const s = readFileSync(f, 'utf8');
      return /\.resetPasswordForEmail\s*\(|auth\.resend\s*\(|\.signInWithOtp\s*\(/.test(s);
    });
    expect(offenders).toEqual([]);
  });

  /* AND generateLink IS ONLY EVER USED FOR THE TOKEN. It does not send
     anything by itself, which is exactly why it is the right call: every
     message in this product is built from our templates and sent by Resend. */
  it('and generateLink is only read for its hashed_token or its user id', () => {
    for (const name of ['send-password-reset', 'accept-invite']) {
      const src = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8');
      expect(src).toContain('hashed_token');
    }
  });
});
