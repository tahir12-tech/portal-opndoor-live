/* THE NOTIFICATION RULES ARE STATED, NOT IMPLIED BY THE SWITCHES.
 *
 * Matt (ap) item 4: "Explain these rules in plain English in each
 * Notifications dialog." Item 2 is the policy itself: "Every email to a
 * portal user is on by default, and each person can switch any of it off,
 * including their copy of the signed deed ... Two things can never be
 * switched off: account emails (invites, password resets, two-factor), and
 * delivery of the signed deed to the agency it's for."
 *
 * THE DIALOG WAS A LIST OF SWITCHES WITH NO STATED POLICY. A reader could
 * see that two boxes were locked and not know why, or what the default was
 * for the rest -- and neither is a property of a box. A reason printed
 * beside one checkbox cannot say "everything else is on by default", and the
 * signed deed reaching the agency regardless is the rule most likely to be
 * reported as a bug if nobody says it out loud.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

vi.mock('@/data/personNotifications', async (orig) => {
  const real = await orig<typeof import('@/data/personNotifications')>();
  return {
    ...real,
    getPersonPanel: vi.fn(async () => ({
      ...real.EMPTY_PANEL,
      userId: 'u1', name: 'Dee Referrer', partyKind: 'supplier' as const,
      copiedApplies: true, copiedOn: true, mayEditCopied: false,
      events: [], internal: [],
    })),
  };
});
vi.mock('@/components/ui/Toast', () => ({ useToast: () => () => {} }));

afterEach(() => cleanup());

async function open() {
  const { PersonNotifications } = await import('./PersonNotifications');
  render(<PersonNotifications userId="u1" personName="Dee Referrer" onClose={() => {}} />);
  await waitFor(() => screen.getByText(/How these work/i));
}

describe('the notifications dialog states its own rules', () => {
  it('says everything is on by default, which no single switch can say', async () => {
    await open();
    expect(screen.getByText(/on by default/i)).toBeTruthy();
  });

  /* BOTH OF THEM, BY NAME. A reader deciding what to turn off needs to know
     the floor before they start. */
  it('names the two that can never be switched off', async () => {
    await open();
    const body = document.body.textContent ?? '';
    expect(body).toMatch(/account emails/i);
    expect(body).toMatch(/invites, password resets, two-factor/i);
    expect(body).toMatch(/delivery of the signed deed to the agency it is for/i);
  });

  /* AND THE LIMIT OF WHAT A SWITCH DOES, because the obvious misreading of
     a notifications panel is that ticking something grants access. */
  it('and says these settings do not widen what anybody can see', async () => {
    await open();
    expect(document.body.textContent ?? '').toMatch(/does not widen what they have access to/i);
  });
});
