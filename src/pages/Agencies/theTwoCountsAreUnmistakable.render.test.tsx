/* THE TWO COUNTS ARE UNMISTAKABLE, ON THE SCREEN.
 *
 * Matt, 2026-10-01: "make the choice between pricing by number of tenants
 * and pricing by number of referrals unmistakable, each with a one-line
 * example ... Warn before saving a tenant band above 4 tenants, since
 * that's almost certainly meant as referral volume."
 *
 * The predicate is in tenantsAreNotVolume.test.tsx. This is the screen: the
 * two names, the two examples, and the dialog that stands between a 50 in
 * the tenants box and a deal that prices every referral wrongly for a year.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/Toast';
import * as org from '@/data/orgService';
import { AgreementEditor } from './AgreementEditor';

let created: ReturnType<typeof vi.fn>;

beforeEach(() => {
  created = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(org, 'createAgreement').mockImplementation(created as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function editor() {
  const v = render(
    <ToastProvider>
      <AgreementEditor level="partner" id="p-1" name="ZZZ Co" current={null}
        onClose={() => {}} onSaved={() => {}} />
    </ToastProvider>,
  );
  await waitFor(() => { if (!document.querySelector('[role="dialog"]')) throw new Error('nr'); });
  await act(async () => {});
  return v;
}
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement;

async function choose(name: string) {
  const opt = [...dialog().querySelectorAll<HTMLElement>('.roleopt')]
    .find((o) => (o.querySelector('.roleopt__name')?.textContent ?? '').includes(name));
  expect(opt, `no model called "${name}"`).toBeTruthy();
  await act(async () => { fireEvent.click(opt!); });
}

describe('the two models that get confused', () => {
  /* NAMED FOR THE THING COUNTED, both of them, so the contrast is the
     noun rather than the sentence structure. */
  it('are both named for what they count', async () => {
    await editor();
    const names = [...dialog().querySelectorAll('.roleopt__name')].map((e) => e.textContent ?? '');
    expect(names).toContain('Price by number of TENANTS on the tenancy');
    expect(names).toContain('Price by number of REFERRALS they send');
  });

  /* MATT'S OWN TWO EXAMPLES, each on its own line rather than buried in
     a paragraph: it is the line a reader checks their intention against. */
  it('and each carries its one-line example', async () => {
    await editor();
    const egs = [...dialog().querySelectorAll('.roleopt__eg')].map((e) => e.textContent ?? '');
    expect(egs.join(' | ')).toContain('e.g. 1 tenant 3 weeks’ rent, 2 tenants 5 weeks’');
    expect(egs.join(' | ')).toContain('e.g. first 5 referrals a month at 10%, then 15%');
  });

  /* AND EACH SAYS WHAT THE OTHER ONE IS, which a name alone cannot do. */
  it('and each says what it is not', async () => {
    await editor();
    const t = dialog().textContent ?? '';
    expect(t).toContain('Counts people on a tenancy, not referrals sent');
    expect(t).toContain('Counts referrals in a period, not people on a tenancy');
  });
});

describe('a tenant band that is really a volume', () => {
  async function setBand(max: string) {
    await editor();
    await choose('TENANTS');
    /* BY ARIA-LABEL, not by position or by type: the inputs are
       `inputMode="numeric"` rather than `type="number"`, and the columns
       the table draws change with the model. */
    const to = dialog().querySelector<HTMLInputElement>('input[aria-label="Band 1 to"]');
    expect(to, 'no band inputs after choosing the tenants model').toBeTruthy();
    await act(async () => { fireEvent.change(to!, { target: { value: max } }); });
  }
  const save = async () => {
    const b = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((x) => /save/i.test(x.textContent ?? '') && !/anyway|replace/i.test(x.textContent ?? ''));
    expect(b, 'no save button').toBeTruthy();
    await act(async () => { fireEvent.click(b!); });
  };

  it('is questioned before it is saved', async () => {
    await setBand('50');
    await save();
    expect(document.body.textContent).toMatch(/Is that a tenant count\?/);
    expect(created, 'it saved before asking').not.toHaveBeenCalled();
  });

  /* THE DIALOG NAMES THE NUMBER, so a reader can see which box it came
     from without hunting. */
  it('and the question names the number', async () => {
    await setBand('50');
    await save();
    expect(document.body.textContent).toMatch(/you have entered\s*50/);
  });

  /* AND IT POINTS AT THE OTHER MODEL, which is the actual remedy. */
  it('and points at the model they probably meant', async () => {
    await setBand('50');
    await save();
    expect(document.body.textContent).toContain('Price by number of REFERRALS they send');
  });

  /* A WARNING, NOT A REFUSAL. A five-tenant HMO is real, just rare, and
     the one thing this must not do is make a true deal impossible. */
  it('but can be saved anyway, because big households exist', async () => {
    await setBand('6');
    await save();
    const yes = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => (b.textContent ?? '').trim() === 'Yes, save it')!;
    await act(async () => { fireEvent.click(yes); });
    expect(created).toHaveBeenCalledTimes(1);
  });

  /* AND AN ORDINARY TENANCY IS NEVER QUESTIONED, or the warning becomes
     the thing people click through without reading. */
  it('while four or fewer is saved without a word', async () => {
    await setBand('4');
    await save();
    expect(document.body.textContent).not.toMatch(/Is that a tenant count\?/);
    expect(created).toHaveBeenCalledTimes(1);
  });
});
