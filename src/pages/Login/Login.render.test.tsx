/* The three audience tabs on /login.

   WHY THIS EXISTS. Discovery found the tab strip had no test of any kind: not
   the tabs, not the ?tab= seeding, not either panel. smoke.test.tsx renders
   /login with no query string, so `audience` defaults to 'agent' and the other
   two panels were never mounted by anything.

   That is the same shape of gap as the Dev Centre vanishing from the nav: the
   boundary was covered and the thing the screen exists for was not. So these
   assert what each audience GETS, not only what it is denied.

   Deliberately shallow. The point is that each tab mounts and offers a way in. */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SessionProvider } from '@/session/SessionContext';
import { Login } from './Login';

afterEach(() => cleanup());

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider><Login /></SessionProvider>
    </MemoryRouter>,
  );
}

describe('the three audiences', () => {
  it('offers all three tabs', () => {
    at('/login');
    for (const label of ['Tenant', 'Agent', 'Supplier']) {
      expect(screen.getByRole('tab', { name: label })).toBeTruthy();
    }
  });

  it('defaults to agent, because that is who has been signing in here for a year', () => {
    at('/login');
    expect(screen.getByRole('tab', { name: 'Agent' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByLabelText('Work email')).toBeTruthy();
  });

  it('seeds the tab from the URL, so ?tab= is a link somebody can be sent', () => {
    at('/login?tab=tenant');
    expect(screen.getByRole('tab', { name: 'Tenant' }).getAttribute('aria-selected')).toBe('true');
  });

  /* The defect this file was written for. */
  it('gives a tenant the form itself, not a button to another page', () => {
    at('/login?tab=tenant');
    expect(screen.getByLabelText('Email address')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
  });

  /* This used to assert the opposite: that a tenant saw no step strip at all.
     That was wrong. A tenant has two factors like everybody else, the second
     just arrives by email instead of from an app, and hiding the strip made
     the tenant path read as the lesser one and left the panes different
     heights. What a tenant must not see is the AUTHENTICATOR, not the step. */
  it('shows a tenant the same two steps as staff', () => {
    at('/login?tab=tenant');
    expect(screen.getByText('Credentials')).toBeTruthy();
    expect(screen.getByText('Verify')).toBeTruthy();
  });

  it('never mentions an authenticator app to a tenant', () => {
    at('/login?tab=tenant');
    expect(screen.queryByText(/scan this qr/i)).toBeNull();
    expect(screen.getByText(/no authenticator app needed/i)).toBeTruthy();
  });

  /* A supplier is a partner who sends us referrals: staff, same credentials,
     same portal. The tab used to be a dead end saying sign-in was not open. */
  it('lets a supplier actually sign in', () => {
    at('/login?tab=supplier');
    expect(screen.getByLabelText('Work email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.queryByText(/not open yet/i)).toBeNull();
  });

  it('keeps two-factor on the supplier path, because a supplier is staff', () => {
    at('/login?tab=supplier');
    expect(screen.getByText('Credentials')).toBeTruthy();
    expect(screen.getByText('Verify')).toBeTruthy();
  });

  it('tells a supplier and an agent apart in the copy, not in the form', () => {
    at('/login?tab=supplier');
    const supplierSub = screen.getByText(/partners who send us referrals/i);
    expect(supplierSub).toBeTruthy();
    cleanup();
    at('/login?tab=agent');
    expect(screen.queryByText(/partners who send us referrals/i)).toBeNull();
    expect(screen.getByText(/your administrator registered/i)).toBeTruthy();
  });
});

describe('the left panel speaks to whoever is signing in', () => {
  /* It used to be one block of agent copy on all three tabs. Two of its three
     promises were false for a tenant, who refers nobody and earns nothing, and
     the third was wrong about how they sign in. */
  it('does not promise a tenant commission or an authenticator app', () => {
    at('/login?tab=tenant');
    expect(screen.queryByText(/commission earned/i)).toBeNull();
    expect(screen.queryByText(/two-factor authentication on every sign in/i)).toBeNull();
    expect(screen.getByText(/code to your email every sign in/i)).toBeTruthy();
  });

  it('gives each audience its own eyebrow', () => {
    at('/login?tab=tenant');
    expect(screen.getByText('Tenant sign in')).toBeTruthy();
    cleanup();
    at('/login?tab=agent');
    expect(screen.getByText('Agent sign in')).toBeTruthy();
    cleanup();
    at('/login?tab=supplier');
    expect(screen.getByText('Supplier sign in')).toBeTruthy();
  });

  it('tells an agent about their own branches and a supplier about other agencies', () => {
    at('/login?tab=agent');
    expect(screen.getByText(/refer in seconds/i)).toBeTruthy();
    cleanup();
    at('/login?tab=supplier');
    expect(screen.getByText(/refer for any agency/i)).toBeTruthy();
  });
});

describe('a tenant gets two-factor too', () => {
  /* A tenant is emailed a six-digit code rather than enrolling an authenticator:
     they sign in a handful of times and a lost phone would lock them out of
     their own application. The password is checked SERVER side and the session
     it produces is discarded, so nothing usable reaches the browser until the
     code is right. */
  it('asks for a code after the password, not straight in', async () => {
    at('/login?tab=tenant');
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 't@example.invalid' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(screen.getByText('Check your email')).toBeTruthy());
    expect(screen.getByLabelText('Confirmation code')).toBeTruthy();
    expect(screen.getByRole('button', { name: /confirm and continue/i })).toBeTruthy();
  });

  it('will not accept fewer than six digits', async () => {
    at('/login?tab=tenant');
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 't@example.invalid' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByLabelText('Confirmation code')).toBeTruthy());

    const confirm = screen.getByRole('button', { name: /confirm and continue/i });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Confirmation code'), { target: { value: '12345' } });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Confirmation code'), { target: { value: '123456' } });
    expect(confirm.hasAttribute('disabled')).toBe(false);
  });

  it('strips anything that is not a digit', async () => {
    at('/login?tab=tenant');
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 't@example.invalid' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByLabelText('Confirmation code')).toBeTruthy());

    const box = screen.getByLabelText('Confirmation code') as HTMLInputElement;
    fireEvent.change(box, { target: { value: '12ab34cd56' } });
    expect(box.value).toBe('123456');
  });
});

describe('the three panes are the same size', () => {
  /* The tabs aligning was not enough: the panes still finished 44px apart,
     which is what "different sizes on the right" meant. The card is a fixed
     height and the last line of every pane is pinned to its bottom edge, so
     both ends line up and only the middle differs.

     jsdom does no layout, so this asserts the STRUCTURE the CSS depends on. If
     a pane stops ending in a footer, or the wrapper goes missing, the pin
     silently stops reaching and nothing else would say so. */
  for (const tab of ['tenant', 'agent', 'supplier']) {
    it(`${tab} renders one pane that ends in a pinned footer`, () => {
      const { container } = at(`/login?tab=${tab}`);
      const panes = container.querySelectorAll('.auth__pane');
      expect(panes.length).toBe(1);

      // The footer is either the pane's own last child or the last child of the
      // body it nests. Both are what the CSS targets.
      const direct = panes[0].lastElementChild;
      const pinned = direct?.classList.contains('auth__foot')
        || (direct?.classList.contains('auth__pane-body')
            && direct.lastElementChild?.classList.contains('auth__foot'));
      expect(pinned).toBe(true);
    });
  }

  it('gives every audience the step strip, so none starts lower than another', () => {
    for (const tab of ['tenant', 'agent', 'supplier']) {
      const { container } = at(`/login?tab=${tab}`);
      expect(container.querySelectorAll('.auth__steps').length).toBe(1);
      cleanup();
    }
  });
});

describe('switching tabs changes the words and nothing else', () => {
  /* The tabs were pinned, then the panes were pinned top and bottom, and the
     FIELDS still sat in three different places. The cause was the intro block:
     one line of copy for an agent, two for a tenant, three for a supplier, so a
     shorter one pulled everything below it upwards.

     jsdom does no layout, so these assert the structure the CSS relies on:
     every tab has the same skeleton, in the same order, with the intro in a
     block whose height is reserved. */
  const SKELETON = ['auth__steps', 'auth__pane-body'];

  for (const tab of ['tenant', 'agent', 'supplier']) {
    it(`${tab} has the same skeleton in the same order`, () => {
      const { container } = at(`/login?tab=${tab}`);
      const pane = container.querySelector('.auth__pane')!;
      const kids = Array.from(pane.children).map((el) => el.className.split(' ')[0]);
      expect(kids).toEqual(SKELETON);
    });

    it(`${tab} puts its heading and sentence inside the reserved block`, () => {
      const { container } = at(`/login?tab=${tab}`);
      const intro = container.querySelector('.auth__pane-body > .auth__intro');
      expect(intro).toBeTruthy();
      expect(intro!.querySelector('.auth__title')).toBeTruthy();
      expect(intro!.querySelector('.auth__sub')).toBeTruthy();
      // First child of the body, so nothing above it can shift it.
      expect(container.querySelector('.auth__pane-body')!.firstElementChild)
        .toBe(intro);
    });
  }

  it('keeps the copy different, which is the point of the tabs', () => {
    at('/login?tab=tenant');
    const tenant = document.querySelector('.auth__title')!.textContent;
    cleanup();
    at('/login?tab=agent');
    expect(document.querySelector('.auth__title')!.textContent).not.toBe(tenant);
  });
});

describe('the reserved intro height matches the copy it has to hold', () => {
  /* The number in the CSS is a magic number and the first guess at it was 3px
     short, which is exactly enough to move the form. This recomputes it from
     the same values the stylesheet uses, so a copy change that adds a line, or
     a font-size change, fails here rather than in somebody's eyes. */
  // From the repo root: import.meta.url is not a file URL under this runner.
  const css = readFileSync(resolve(process.cwd(), 'src/pages/auth/auth.css'), 'utf8');

  const num = (rule: string, prop: string) => {
    const block = css.match(new RegExp(`\\${rule}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    return parseFloat(block.match(new RegExp(`${prop}:\\s*([\\d.]+)`))?.[1] ?? 'NaN');
  };

  it('reserves at least a one-line heading and a three-line sentence', () => {
    const titlePx = num('.auth__title', 'font-size');
    const subPx = num('.auth__sub', 'font-size');
    const subLh = num('.auth__sub', 'line-height');
    const subGap = num('.auth__sub', 'margin-top');
    const reserved = num('.auth__intro', 'min-height');

    expect(titlePx).toBe(28);
    expect(subPx).toBe(14);

    // Body line-height is 1.5 and h2 margins are reset to 0 in portal.css.
    const needed = titlePx * 1.5 + subGap + 3 * subPx * subLh;
    expect(needed).toBeCloseTo(115.1, 1);
    expect(reserved).toBeGreaterThanOrEqual(needed);
  });
});
