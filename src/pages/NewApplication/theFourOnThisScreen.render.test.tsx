/* WALK FIXES 27, 28, 29 AND 30. FOUR ON ONE SCREEN, BUILT AS ONE PIECE.
 *
 * 27. "New application: the section numbers repeat (Tenant and Property are
 *     both '2'). Number the sections in order."
 * 28. "Admin New application with Referred by set to Supplier (Kestrel
 *     Lettings): the last section says 'Your office' and sits on 'Working
 *     out which office this referral is against' without ever resolving.
 *     That's the supplier user's own wording and behaviour. For Opndoor
 *     admin it should be 'Agency and office' (renamed from branch,
 *     2026-10-04): choose from the chosen
 *     supplier's agencies and branches, as specified in the Referred by
 *     fold-in. The side navigation should match the section names."
 * 29. "after choosing Supplier, Kestrel Lettings, then an agency and branch,
 *     the choices disappear and the only way to correct a wrong agency or
 *     branch is to cancel and start again. Every choice in Referred by stays
 *     visible and changeable until the application is sent, with a Change
 *     option on each. Changing an earlier choice clears only what depends on
 *     it."
 * 30. "The Referred by description is jargon ('It decides the rail, the
 *     route and the commission'). Rewrite in plain English, for example 'Who
 *     sent us this tenant. This decides the price and who is paid
 *     commission.'"
 *
 * WHY 28 NEVER RESOLVED, measured on dev rather than guessed. The section's
 * heading comes from `orgSectionCopy(orgShape)`, and orgShape starts at
 * UNRESOLVED whose copy is "Your office / Working out which office this
 * referral is against." It is filled from `my_org_shape()`, which for an
 * Opndoor admin returns NO ROW AT ALL -- confirmed by calling it on dev as
 * the probe admin, which produced an empty set where a Regent director
 * produced a full shape. An admin belongs to no org, so there is no shape to
 * report and the placeholder is permanent. The fix is not to make the query
 * answer: it is that an admin is not asking that question.
 *
 * AND 27 IS NOT A TYPO. The numbers were literals -- Referred by 1, Tenant
 * `isAdminForm ? 2 : 1`, Property 2, Tenancy 3, office 4 -- so the admin
 * form read 1, 2, 2, 3, 4 and the agency form read 1, 2, 3, 4 with a gap
 * where Referred by is not drawn. Numbering by position is the fix; anything
 * else is the same bug waiting for the next section.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { NewApplication } from './NewApplication';
import { newApplicationSectionCopy } from '@/data/orgShapeService';
import * as orgShape from '@/data/orgShapeService';
import { UNRESOLVED } from '@/data';
import { vi } from 'vitest';

beforeEach(() => { localStorage.clear(); });
afterEach(() => cleanup());

async function openForm(role: string) {
  localStorage.setItem('grp_role', role);
  const view = render(
    <MemoryRouter initialEntries={['/new-application']}>
      <ToastProvider><SessionProvider><PageMetaProvider><NewApplication /></PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('#sec-tenant')) throw new Error('form not ready'); });
  await act(async () => {});
  return view;
}

type View = Awaited<ReturnType<typeof openForm>>;
const sel = (v: View, label: string) =>
  v.container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
/** Every section number on the page, in document order. */
const numbers = (v: View) =>
  [...v.container.querySelectorAll('.sec__num')].map((n) => (n.textContent ?? '').trim());
/** Every section title, in document order. */
const titles = (v: View) =>
  [...v.container.querySelectorAll('.sec__title')].map((t) => (t.textContent ?? '').replace('*', '').trim());
/** The side navigation's labels. */
const railLinks = (v: View) =>
  [...v.container.querySelectorAll('.navrail a')].map((a) => (a.textContent ?? '').trim());

/** Choose Supplier, then Kestrel, as Matt did. */
async function chooseSupplier(v: View) {
  await act(async () => { fireEvent.change(sel(v, 'Referred by')!, { target: { value: 'supplier' } }); });
  const s = sel(v, 'Supplier')!;
  const opt = [...s.options].find((o) => o.value && o.text.toLowerCase().includes('harbour'))
    ?? [...s.options].find((o) => o.value)!;
  await act(async () => { fireEvent.change(s, { target: { value: opt.value } }); });
  return opt.text;
}

describe('item 27: the sections are numbered in order', () => {
  it('for an Opndoor admin, who has one more section than anybody else', async () => {
    const v = await openForm('superadmin');
    const n = numbers(v);
    expect(n.length).toBeGreaterThan(3);
    expect(n).toEqual(n.map((_, i) => String(i + 1)));
  });

  it('and for an agency user, where Referred by is not drawn at all', async () => {
    const v = await openForm('management');
    const n = numbers(v);
    expect(n.length).toBeGreaterThan(2);
    expect(n).toEqual(n.map((_, i) => String(i + 1)));
  });

  /* THE DEFECT AS REPORTED, named so a regression reads as itself rather
     than as "an off-by-one somewhere". */
  it('so Tenant and Property are not both 2', async () => {
    const v = await openForm('superadmin');
    const t = titles(v);
    const n = numbers(v);
    const at = (name: string) => n[t.findIndex((x) => x === name || x.startsWith(name))];
    expect(at('Tenant')).not.toBe(at('Property'));
  });
});

describe('item 28: an admin is asked the admin question', () => {
  it('names the section Agency and office, not Your office', async () => {
    const v = await openForm('superadmin');
    await chooseSupplier(v);
    /* "Agency and office" SINCE 2026-10-04. Matt: "use 'Agency' and 'Office'
       instead of 'Agent' and 'Branch' on this form, matching the supplier and
       agency forms." The agency-user headings beside it had said office all
       along, which is what matching meant. */
    expect(titles(v)).toContain('Agency and office');
    expect(titles(v)).not.toContain('Your office');
  });

  /* THE HANG. `my_org_shape()` returns no row for an admin, so the
     placeholder never went away. */
  it('and never sits on "Working out which office this referral is against"', async () => {
    const v = await openForm('superadmin');
    await chooseSupplier(v);
    expect(v.container.textContent ?? '').not.toMatch(/Working out which office/i);
  });

  it('and the side navigation says the same thing the section does', async () => {
    const v = await openForm('superadmin');
    await chooseSupplier(v);
    const shown = titles(v).filter((t) => t !== 'Referred by');
    for (const label of railLinks(v)) {
      expect(shown, `rail says "${label}" and no section does`).toContain(label);
    }
    expect(railLinks(v)).toContain('Agency and office');
  });
});

/* THE HANG ITSELF CANNOT BE REPRODUCED IN MOCK MODE, and saying so is the
   point of this block rather than leaving the render tests above to imply
   more than they check.

   `my_org_shape()` returns no row for an admin on DEV -- measured -- so the
   shape never resolves and the copy stays on the placeholder for ever. In
   mock mode the shape resolves to something, so the render assertions above
   pass whether or not the admin is asked their own question. The rule is
   therefore asserted where it lives, against the shape that never
   resolves. */
describe('item 28: the copy does not wait for a shape an admin does not have', () => {
  it('asks the admin question even when nothing has resolved', () => {
    expect(newApplicationSectionCopy(true, UNRESOLVED)).toEqual({
      title: 'Agency and office',
      /* RENAMED WITH THE TITLE, 2026-10-04. "on the fly" went too: it is
         jargon, and it stopped being accurate on 2026-10-03 when a
         supplier's own people began creating a real agency that waits for
         review rather than a name attached to one referral. */
      sub: 'Which agency is letting this property, and which office. You can add either here.',
    });
  });

  /* AND EVERYBODY ELSE STILL WAITS, which is right: an agency user's
     question depends on a shape they do have, and printing the supplier's
     question at them for even one frame is what the placeholder exists to
     prevent. */
  it('and still waits for everybody else, who has a shape to wait for', () => {
    expect(newApplicationSectionCopy(false, UNRESOLVED).title).toBe('Your office');
  });
});

/* AND THE PICKER DOES NOT ASK EITHER. The heading was only half of it: the
   picker itself returns "Your office / Working out which office this
   referral is against" and NOTHING ELSE while the shape is unresolved, so
   an admin had no agency or branch control at all.

   Measured on dev: `my_org_shape(null)` returns no row for an admin, and
   `my_org_shape(<the chosen supplier>)` returns that SUPPLIER's shape --
   refers_own_stock true, one agency and it is yours, "Kestrel Lettings".
   Either way the admin is answered as somebody else.

   The fix is that an admin's shape needs no round trip: it is fixed. This
   asserts the absence of the call, because that is the substance -- no
   call, no wait, and no supplier's shape to be handed. */
describe('item 28: an admin does not wait on a question about an org they have not got', () => {
  it('does not ask the server for a shape at all', async () => {
    const spy = vi.spyOn(orgShape, 'loadOrgShape');
    const v = await openForm('superadmin');
    await chooseSupplier(v);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  /* AND EVERYBODY ELSE STILL DOES, or this would have removed the question
     rather than removing it from the one reader it cannot be asked of. */
  it('while an agency user still does, because theirs is a real question', async () => {
    const spy = vi.spyOn(orgShape, 'loadOrgShape');
    await openForm('management');
    await waitFor(() => expect(spy).toHaveBeenCalled());
    spy.mockRestore();
  });
});

describe('item 30: the description is in plain English', () => {
  it('does not say rail or route', async () => {
    const v = await openForm('superadmin');
    const sub = v.container.querySelector('#sec-referredby .sec__sub')?.textContent ?? '';
    expect(sub).not.toMatch(/\brail\b/i);
    expect(sub).not.toMatch(/\broute\b/i);
  });

  /* MATT'S OWN WORDING, used as given. */
  it('and says what he wrote instead', async () => {
    const v = await openForm('superadmin');
    const sub = v.container.querySelector('#sec-referredby .sec__sub')?.textContent ?? '';
    expect(sub).toMatch(/Who sent us this tenant/i);
    expect(sub).toMatch(/decides the price and who is paid commission/i);
  });
});

describe('item 29: every choice stays visible and changeable', () => {
  it('keeps the Referred by answer on screen after it is made', async () => {
    const v = await openForm('superadmin');
    await chooseSupplier(v);
    expect(sel(v, 'Referred by')!.value).toBe('supplier');
  });

  it('and keeps the supplier on screen too', async () => {
    const v = await openForm('superadmin');
    await chooseSupplier(v);
    expect(sel(v, 'Supplier')!.value).not.toBe('');
  });

  /* THE DEPENDENCY, which is the whole of the difficulty in item 29:
     supplier -> agency -> branch. Changing the supplier must clear both. */
  it('and changing the supplier clears the agency and the branch beneath it', async () => {
    const v = await openForm('superadmin');
    await chooseSupplier(v);
    const agency = sel(v, 'Agency') ?? sel(v, 'Agent');
    if (agency) {
      const first = [...agency.options].find((o) => o.value);
      if (first) await act(async () => { fireEvent.change(agency, { target: { value: first.value } }); });
    }
    const s = sel(v, 'Supplier')!;
    const other = [...s.options].find((o) => o.value && o.value !== s.value);
    expect(other, 'the fixture needs a second supplier to change to').toBeTruthy();
    await act(async () => { fireEvent.change(s, { target: { value: other!.value } }); });
    const after = sel(v, 'Agency') ?? sel(v, 'Agent');
    if (after) expect(after.value).toBe('');
  });

  /* THE DISAPPEARANCE ITSELF. The section collapses to nothing once the org
     resolves to a single office -- right for somebody who works at one
     office and has nothing to choose, wrong for an admin choosing somebody
     else's agency and branch, who must be able to change it. That collapse
     is what "the choices disappear" was. */
  it('and the whole section never collapses away for an admin', async () => {
    const v = await openForm('superadmin');
    await chooseSupplier(v);
    const section = v.container.querySelector('#sec-branch');
    expect(section, 'no agency and branch section').toBeTruthy();
    expect(section!.className).not.toMatch(/sec-quiet/);
    expect(titles(v)).toContain('Agency and office');
  });

  /* AND CHANGING NOTHING CHANGES NOTHING. Re-selecting the value already
     chosen must not clear what was filled in underneath it: an onChange that
     clears unconditionally turns a mis-click onto the same option into lost
     work. */
  it('and re-choosing the same supplier clears nothing', async () => {
    const v = await openForm('superadmin');
    await chooseSupplier(v);
    const s = sel(v, 'Supplier')!;
    const chosen = s.value;
    const agency = sel(v, 'Agency') ?? sel(v, 'Agent');
    const first = agency ? [...agency.options].find((o) => o.value) : undefined;
    if (agency && first) await act(async () => { fireEvent.change(agency, { target: { value: first.value } }); });
    const before = (sel(v, 'Agency') ?? sel(v, 'Agent'))?.value ?? '';
    await act(async () => { fireEvent.change(s, { target: { value: chosen } }); });
    expect((sel(v, 'Agency') ?? sel(v, 'Agent'))?.value ?? '').toBe(before);
  });
});
