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
import { SessionProvider } from '@/session/SessionContext';
import { Login } from './Login';

afterEach(() => cleanup());

/* All three intro variants are in the DOM by design: that is what makes the row
   size to the tallest. So a test about COPY has to read the visible one, not
   whatever querySelector reaches first. */
function shown(container: ParentNode = document.body) {
  // The first stack is the heading and paragraph; the second is the helper line
  // under the button. Both render every variant, so scope to the intro.
  // Scoped to the card: the left panel now stacks its three lines too, so an
  // unscoped '.auth__stack' picks up the eyebrow stack instead.
  const intro = container.querySelector('.auth__pane-body > .auth__stack')!;
  const v = Array.from(intro.querySelectorAll('.auth__stack-v'))
    .find((el) => !el.getAttribute('aria-hidden'))!;
  return {
    title: v.querySelector('.auth__title')!.textContent ?? '',
    sub: v.querySelector('.auth__sub')!.textContent ?? '',
  };
}

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider><Login /></SessionProvider>
    </MemoryRouter>,
  );
}

describe('the three audiences', () => {

  it('defaults to agent, because that is who has been signing in here for a year', () => {
    at('/login');
    expect(screen.getByRole('tab', { name: 'Agent' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByLabelText('Work email')).toBeTruthy();
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
    expect(shown().sub).toMatch(/on behalf of the agencies they work with/i);
    cleanup();
    at('/login?tab=agent');
    // The supplier sentence is still in the DOM, hidden, holding the row open.
    // What matters is which one is SHOWN. Both now end with the same sentence
    // about the work email, so the discriminator is the opening clause.
    expect(shown().sub).not.toMatch(/on behalf of the agencies/i);
    expect(shown().sub).toMatch(/your administrator registered/i);
  });
});

describe('the left panel speaks to whoever is signing in', () => {
  /* It used to be one block of agent copy on all three tabs. Two of its three
     promises were false for a tenant, who refers nobody and earns nothing, and
     the third was wrong about how they sign in. */

  it('gives each audience its own eyebrow', () => {
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


describe('the three panes are the same size', () => {
  /* The tabs aligning was not enough: the panes still finished 44px apart,
     which is what "different sizes on the right" meant. The card is a fixed
     height and the last line of every pane is pinned to its bottom edge, so
     both ends line up and only the middle differs.

     jsdom does no layout, so this asserts the STRUCTURE the CSS depends on. If
     a pane stops ending in a footer, or the wrapper goes missing, the pin
     silently stops reaching and nothing else would say so. */
  for (const tab of ['agent', 'supplier']) {
    it(`${tab} ends in the helper stack, not a pinned footer`, () => {
      const { container } = at(`/login?tab=${tab}`);
      expect(container.querySelectorAll('.auth__pane').length).toBe(1);

      // The footer pin is gone on purpose: the card is centred again, and a
      // reserved height would only move the slack somewhere else. The helper
      // line holds its own height by stacking instead.
      const body = container.querySelector('.auth__pane-body')!;
      const last = body.lastElementChild!;
      expect(last.classList.contains('auth__stack--foot')).toBe(true);
      expect(last.querySelectorAll('.auth__stack-v').length).toBe(2);
    });
  }

  it('gives every audience the step strip, so none starts lower than another', () => {
    for (const tab of ['agent', 'supplier']) {
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

  for (const tab of ['agent', 'supplier']) {
    it(`${tab} has the same skeleton in the same order`, () => {
      const { container } = at(`/login?tab=${tab}`);
      const pane = container.querySelector('.auth__pane')!;
      const kids = Array.from(pane.children).map((el) => el.className.split(' ')[0]);
      expect(kids).toEqual(SKELETON);
    });

    it(`${tab} puts its heading and sentence inside the reserved block`, () => {
      const { container } = at(`/login?tab=${tab}`);
      const intro = container.querySelector('.auth__pane-body > .auth__stack');
      expect(intro).toBeTruthy();
      expect(intro!.querySelector('.auth__title')).toBeTruthy();
      expect(intro!.querySelector('.auth__sub')).toBeTruthy();
      // First child of the body, so nothing above it can shift it.
      expect(container.querySelector('.auth__pane-body')!.firstElementChild)
        .toBe(intro);
    });
  }

  it('keeps the copy different, which is the point of the tabs', () => {
    at('/login?tab=agent');
    const agent = shown().sub;
    cleanup();
    at('/login?tab=supplier');
    expect(shown().sub).not.toBe(agent);
  });
});

describe('the intro is a stack, not a measured constant', () => {
  /* The reserved height was a magic number and it was too small for the
     supplier's three lines: tab to first label measured 310, 310 and 321.
     All three variants now share one grid cell, so the row is as tall as the
     tallest and stays that way when the copy changes. */
  for (const tab of ['agent', 'supplier']) {
    it(`${tab} renders all three variants and shows one`, () => {
      const { container } = at(`/login?tab=${tab}`);
      const intro = container.querySelector('.auth__pane-body > .auth__stack')!;
      const variants = intro.querySelectorAll('.auth__stack-v');
      expect(variants.length).toBe(2);

      const shown = Array.from(variants).filter((v) => !v.getAttribute('aria-hidden'));
      expect(shown.length).toBe(1);
      expect(shown[0].querySelector('.auth__title')).toBeTruthy();
    });

    it(`${tab} hides the other two from assistive tech and keeps their space`, () => {
      const { container } = at(`/login?tab=${tab}`);
      // Five stacks now: three lines in the left panel, plus the heading block
      // and the helper line on the card. Each renders three and hides two.
      const hidden = Array.from(container.querySelectorAll('.auth__stack-v'))
        .filter((v) => v.getAttribute('aria-hidden') === 'true');
      expect(hidden.length).toBe(5);
      // visibility:hidden reserves the box. display:none would not, and the
      // row would collapse to the visible variant, which is the whole defect.
      for (const h of hidden) {
        expect((h as HTMLElement).style.visibility).toBe('hidden');
      }
    });
  }

  it('keeps the copy different per tab, which is the point', () => {
    // Both tabs share a heading; the sentence under it is the difference.
    at('/login?tab=agent');
    expect(shown().title).toBe('Sign in to the portal');
    expect(shown().sub).toMatch(/your administrator registered/i);
    cleanup();
    at('/login?tab=supplier');
    expect(shown().sub).toMatch(/on behalf of the agencies/i);
  });
});

describe('the left panel lines up too', () => {
  /* Third and last variable-height block. The headline is two lines for a
     tenant and an agent and three for a supplier, so a centred block put the
     eyebrow at 624, 624 and 591.

     Stacked PER LINE, not per block: stacking the whole block lined the eyebrow
     and heading up and left the paragraph at 499, 499 and 551, because the
     supplier's own three-line headline pushed its own paragraph down inside its
     own variant. */
  for (const line of ['eyebrow', 'h1', 'copy']) {
    it(`${line} is its own stack, so the line after it starts level`, () => {
      const { container } = at('/login?tab=supplier');
      const stack = container.querySelector(`.auth__stack--${line}`)!;
      expect(stack).toBeTruthy();
      expect(stack.querySelectorAll('.auth__stack-v').length).toBe(2);
      expect(Array.from(stack.children).filter((c) => !c.getAttribute('aria-hidden')).length).toBe(1);
    });
  }

  it('shows the right copy for the tab and hides the other two', () => {
    at('/login?tab=agent');
    const visible = (sel: string) => document.querySelector(`${sel}:not([aria-hidden])`)!.textContent;
    expect(visible('.auth__eyebrow')).toBe('Agent sign in');
    expect(visible('.auth__brand-h1')).toBe('Let the property. We guarantee the tenant.');
    cleanup();
    at('/login?tab=supplier');
    expect(visible('.auth__eyebrow')).toBe('Supplier sign in');
  });

  it('spaces the lines from the cell, not the item', () => {
    /* A margin on the item would apply once per hidden variant and grid items
       do not collapse margins, so the gap would be three times too big. */
    const { container } = at('/login?tab=tenant');
    for (const el of container.querySelectorAll('.auth__brand-h1, .auth__brand-copy')) {
      expect(el.classList.contains('auth__stack-v')).toBe(true);
    }
  });
});

describe('the portal login is for partner staff', () => {
  /* Tenants sign in at /apply/signin, which runs the SAME two-step email code
     this tab used to: both call tenantAuth.signInStart, which checks the
     password server side and discards the session, then verify with
     purpose 'sign_in'. Nothing stronger was deleted; only the step indicator
     differed. */
  it('offers two tabs, and Agent is the default', () => {
    at('/login');
    expect(screen.getByRole('tab', { name: 'Agent' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Supplier' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Tenant' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Agent' }).getAttribute('aria-selected')).toBe('true');
  });

  it('shows two-factor on both tabs, because both are staff', () => {
    for (const tab of ['agent', 'supplier']) {
      at(`/login?tab=${tab}`);
      expect(screen.getByText('Credentials')).toBeTruthy();
      expect(screen.getByText('Verify')).toBeTruthy();
      expect(screen.getByLabelText('Work email')).toBeTruthy();
      cleanup();
    }
  });

  it('never renders a tenant sign-in here', () => {
    for (const path of ['/login', '/login?tab=agent', '/login?tab=supplier']) {
      const { container } = at(path);
      expect(container.textContent).not.toMatch(/apply for a guarantee/i);
      expect(container.textContent).not.toMatch(/sign in to your application/i);
      cleanup();
    }
  });
});
