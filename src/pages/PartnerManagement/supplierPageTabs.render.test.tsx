/* THE SUPPLIER PAGE MIRRORS THE AGENCY PAGE.
 *
 * Q-06 item A: "Supplier detail page mirrors the agency page: tabs Overview
 * ... People ... Commission ... Referrals, and Integration ... Regent's
 * agency page is the template."
 *
 * It was four flat cards in document order, so an admin scrolled past the
 * commission rates to reach the people, the People table was read-only with
 * no row actions at all, there was no Referrals tab of any kind, and the
 * Overview said nothing about who a deed would actually reach.
 *
 * WHAT IS DELIBERATELY NOT HERE. The Commission tab shows today's two rate
 * figures and today's read-only form; the EDITOR's shape is NM-C questions 3
 * and 4 and is not mine to decide. And "Manage" still exists on the
 * suppliers list, because the same modal is the only way to CREATE a
 * supplier -- deleting it without separating those two is how the Add button
 * stops working.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { hydratePartners } from '@/data/partnersService';
import { hydrateOrg } from '@/data/orgService';
import * as users from '@/data/usersService';
import type { ManagedUser } from '@/data/usersService';
import type { Partner } from '@/data/types';
import { PartnerHome } from './PartnerHome';

const SUPPLIER = 'zzz-supplier';

const PARTNERS = [{
  id: SUPPLIER, name: 'ZZZ Supplier Co', status: 'active', since: '2026-01-01',
  weight: 1, users: 1, apps: 3,
  referencingMode: 'pre_referenced_open', partnerRate: 0.25, agentRate: 0.1,
  apiAccessEnabled: true, portalReferralsEnabled: true, primary: false, kind: 'supplier' }] as unknown as Partner[];

/* One agency WITH a contact and one WITHOUT, because the useful half of the
   Overview change is the second: a supplier agency with nowhere to send an
   executed deed said nothing at all before. */
const ORG = [
  { id: 'ag-with', partner: SUPPLIER, name: 'ZZZ With Contact', referrals: 3, guaranteed: '0',
    contacts: [{ id: 'c1', name: 'Ada Contact', email: 'ada@zzz.test', primary: true }],
    branches: [{ id: 'br-1', name: 'ZZZ Office', referrals: 3, guaranteed: '0' }] },
  { id: 'ag-none', partner: SUPPLIER, name: 'ZZZ No Contact', referrals: 0, guaranteed: '0',
    branches: [] },
  /* AND THE ARRANGEMENT THE WARNING WAS WRONG ABOUT. No contact on the
     agency, one on every branch: the deed always has somewhere to go, and
     the agency row used to shout that it did not. */
  { id: 'ag-perbranch', partner: SUPPLIER, name: 'ZZZ Per Branch', referrals: 4, guaranteed: '0',
    branches: [
      { id: 'br-p1', name: 'ZZZ North', referrals: 2, guaranteed: '0',
        contacts: [{ id: 'c2', name: 'Nora North', email: 'north@zzz.test', primary: true }] },
      { id: 'br-p2', name: 'ZZZ South', referrals: 2, guaranteed: '0',
        contacts: [{ id: 'c3', name: 'Sol South', email: 'south@zzz.test', primary: true }] },
    ] },
  /* AND THE ONE THAT MUST STILL WARN: covered on one branch, bare on the
     other, so one of the two really has nowhere to send. */
  { id: 'ag-partial', partner: SUPPLIER, name: 'ZZZ Partly Covered', referrals: 2, guaranteed: '0',
    branches: [
      { id: 'br-q1', name: 'ZZZ East', referrals: 1, guaranteed: '0',
        contacts: [{ id: 'c4', name: 'Eve East', email: 'east@zzz.test', primary: true }] },
      { id: 'br-q2', name: 'ZZZ West', referrals: 1, guaranteed: '0' },
    ] },
] as never[];

const PEOPLE: ManagedUser[] = [
  { id: 'u-1', name: 'Sam Supplier', email: 'sam@zzz.test', role: 'management',
    seesCommission: false, partner: SUPPLIER, status: 'active', lastActive: 'today' },
] as unknown as ManagedUser[];

beforeEach(() => {
  localStorage.setItem('grp_role', 'superadmin');
  hydratePartners(PARTNERS);
  hydrateOrg(ORG);
  vi.spyOn(users, 'getUsers').mockReturnValue(PEOPLE);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function open() {
  const view = render(
    <MemoryRouter initialEntries={[`/partners/${SUPPLIER}`]}>
      <ToastProvider><SessionProvider><PageMetaProvider>
        {/* Through a Route, because the page reads its subject from
            useParams; mounted bare it finds no key and renders not-found. */}
        <Routes><Route path="/partners/:key" element={<PartnerHome />} /></Routes>
      </PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('[role="tablist"]')) throw new Error('no tabs'); });
  await act(async () => {});
  return view;
}

type View = Awaited<ReturnType<typeof open>>;
const tabNames = (v: View) =>
  [...v.container.querySelectorAll('[role="tab"]')].map((b) => (b.textContent ?? '').trim());
async function openTab(v: View, name: string) {
  const b = [...v.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .find((x) => (x.textContent ?? '').trim() === name);
  if (!b) throw new Error(`no ${name} tab. Have: ${tabNames(v).join(', ')}`);
  await act(async () => { fireEvent.click(b); });
}

describe('the supplier detail page', () => {
  /* SIX NOW, not five. Walk fix 15 adds Reporting: "the per-customer
     Reporting tab is Opndoor-only", and this whole route is
     superadmin-only. The assertion is widened rather than loosened to a
     `toContain`, because the ORDER is part of what it protects -- Reporting
     sits with the other read-only views and before Commission, which is
     the money. */
  /* SEVEN SINCE 2026-10-01. Matt: "On the supplier's page, its settings
     (name, live from, status, referencing mode, capabilities) move into
     a Settings tab, with the same fields as Manage." Settings sits after
     People because it is what the supplier IS, and People is who is on
     it.

     EIGHT LATER THE SAME DAY, with the separate estates: "Each supplier's
     estate ... appear in an 'Agencies' tab on that supplier's page, not
     in admin's main Agencies tab." The agencies tree was a card on
     Overview headed "Structure"; it is the same tree with a tab of its
     own, and admin's Agencies list has stopped carrying them. */
  it('has the eight tabs, in order', async () => {
    const v = await open();
    expect(tabNames(v)).toEqual([
      'Overview', 'Agencies', 'People', 'Settings', 'Reporting', 'Commission', 'Referrals', 'Integration',
    ]);
  });

  it('opens on Overview, and does not show the commission rates until asked', async () => {
    const v = await open();
    // The rates were the first card on the page. A reader looking for the
    // people scrolled past what a supplier earns to reach them.
    expect(v.container.textContent).not.toMatch(/snapshotted onto each referral/);
  });
});

/* THE TREE MOVED TO ITS OWN TAB on 2026-10-01, so these open it first.
   Every claim is unchanged: they are about what the tree says. */
describe('the Agencies tab', () => {
  it('says who an executed deed would actually reach', async () => {
    const v = await open();
    await openTab(v, 'Agencies');
    expect(v.container.textContent).toMatch(/ada@zzz\.test/);
  });

  /* THE HALF THAT MATTERS. */
  it('and says so plainly where there is nobody, which it did not before', async () => {
    const v = await open();
    await openTab(v, 'Agencies');
    expect(v.container.textContent).toMatch(/No agent contact/);
  });

  /* =======================================================================
     AND ONLY WHERE A DEED WOULD ACTUALLY HAVE NOWHERE TO GO.

     Matt, 2026-10-01: "Supplier Overview: don't show 'No agent contact' on
     an agency when its branches have contacts; only warn where a branch
     would actually have nowhere to send the deed."

     The agency row ran the branch row's question -- "does THIS node have a
     contact" -- so an agency keeping its contacts on the branches, which is
     the ordinary arrangement, was marked as having none while every branch
     under it printed a working address.
     ======================================================================= */
  const agencyRow = (v: { container: HTMLElement }, name: string) =>
    [...v.container.querySelectorAll('.ph-tree__agency')]
      .find((d) => (d.querySelector('.ph-tree__name')?.textContent ?? '') === name)!;
  /** The agency's OWN row, without the branch rows underneath it. */
  const rowText = (v: { container: HTMLElement }, name: string) =>
    agencyRow(v, name).querySelector('.ph-tree__arow')!.parentElement!.textContent!
      .replace(agencyRow(v, name).querySelector('.ph-tree__branches')?.textContent ?? '', '');

  it('so an agency whose branches all have contacts is not warned about', async () => {
    const v = await open();
    await openTab(v, 'Agencies');
    expect(rowText(v, 'ZZZ Per Branch')).not.toMatch(/No agent contact/);
  });

  /* AND IT ASKS FOR THE AGENCY ADDRESS INSTEAD, since 2026-10-02. Matt:
     "an agency email is required at creation and is the default for all
     its branches ... For supplier-estate agencies with no agency email,
     show a clear warning." So "Contacts are set per branch" -- which was
     the reassuring answer under the old rule -- is now "No agency email",
     with the reason spelled out: nothing is stranded today, and the next
     office added would inherit nothing. The case above is unchanged and
     is what keeps the two honest: no stranded-deed alarm on this shape. */
  it('and asks for the agency address instead, saying nothing is stranded', async () => {
    const v = await open();
    await openTab(v, 'Agencies');
    const row = rowText(v, 'ZZZ Per Branch');
    expect(row).toMatch(/No agency email/);
    expect(row).toMatch(/nothing stranded today, but the next office would inherit nothing/);
  });

  /* THE WARNING IS NOT WEAKENED, ONLY AIMED. An agency covered on one branch
     and bare on the other still has a deed with nowhere to go, and the row
     counts them so the reader knows how much work it is. The sentence moved
     under "No agency email", which is the thing to fix; the count did not. */
  it('while one with a bare branch is still warned about, and counted', async () => {
    const v = await open();
    await openTab(v, 'Agencies');
    expect(rowText(v, 'ZZZ Partly Covered'))
      .toMatch(/No agency email · 1 of 2 branches cannot be sent a deed/);
  });

  /* AND THE BRANCH ROWS GO ON ANSWERING FOR THEMSELVES, which is where the
     warning was always right and is what makes the agency row redundant. */
  it('and the bare branch itself still says so', async () => {
    const v = await open();
    await openTab(v, 'Agencies');
    const branches = agencyRow(v, 'ZZZ Partly Covered').querySelector('.ph-tree__branches')!;
    const west = [...branches.querySelectorAll('.ph-tree__branch')]
      .find((d) => (d.textContent ?? '').includes('ZZZ West'))!;
    expect(west.textContent).toMatch(/No agent contact/);
  });
});

describe('the People tab', () => {
  it('carries the same row actions as the agency page, rather than being read-only', async () => {
    const v = await open();
    await openTab(v, 'People');
    const acts = v.container.querySelector('.ah-rowacts');
    expect(acts, 'no row actions on the supplier People tab').toBeTruthy();
    const labels = [...acts!.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('Send password reset');
    expect(labels).toContain('Remove access');
  });

  /* (cd) ONE LABEL, AND THIS ASSERTION IS THE REVERSE OF WHAT IT WAS.

     It read: says "Change role", not "Change level", because this rail
     has no levels. That was decision D11 and it is true of the MODEL --
     the agency rail has three levels, the supplier rail has roles.

     Matt, 2026-10-05: 'Supplier People tab: "Change level", not "Change
     role", matching every other people list.' The model fact turned out
     to be the wrong thing to spend a reader's attention on: they are
     looking at a row of people, and one button worded differently from
     the same button everywhere else reads as a different button. The
     old assertion is inverted rather than deleted, so the reversal is
     visible to whoever reads this next. */
  /* AND THE DIALOG IS OPENED BEFORE THE ABSENCE IS ASSERTED. My first
     version of this checked the page without clicking, so the modal
     was never mounted when it ran -- it asserted "Change role" was
     gone from a DOM that could not have contained it, while the
     sibling file was simultaneously passing an assertion that the open
     dialog said exactly that. A green suite positively demonstrating
     both answers at once. */
  it('and says "Change level", like every other people list, in the dialog too', async () => {
    const v = await open();
    await openTab(v, 'People');
    const labels = [...v.container.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(labels).toContain('Change level');
    const row = [...v.container.querySelectorAll('button')]
      .find((b) => (b.textContent ?? '').trim() === 'Change level');
    fireEvent.click(row!);
    await waitFor(() => { if (!document.querySelector('[role="dialog"]')) throw new Error('no dialog'); });
    expect(document.body.textContent).not.toContain('Change role');
  });

  it('and offers no Position, because positions are an agency-estate thing', async () => {
    const v = await open();
    await openTab(v, 'People');
    const labels = [...v.container.querySelectorAll('.ah-rowacts button')].map((b) => b.textContent);
    expect(labels).not.toContain('Position');
  });
});

describe('the Referrals tab', () => {
  it('exists at all, which it did not', async () => {
    const v = await open();
    await openTab(v, 'Referrals');
    expect(v.container.textContent).toMatch(/Referrals/);
  });
});

describe('the Integration tab', () => {
  it('holds the API access card, and no longer points at a Manage page', async () => {
    const v = await open();
    await openTab(v, 'Integration');
    expect(v.container.textContent).toMatch(/API access/);
    // Two dead pointers told the reader to go somewhere item A removes.
    expect(v.container.textContent).not.toMatch(/Manage on the Suppliers list/);
  });
});

/* ===========================================================================
   TWO WORDS, BOTH OF THEM THE READER'S.

   Matt, 2026-10-01: 'Settings: replace "The partner references first" with
   "The supplier references first". People: show status as "Active",
   capitalised, like elsewhere.'
   =========================================================================== */
describe('the words on a supplier’s own page', () => {
  it('call the supplier a supplier, not a partner, on Settings', async () => {
    const v = await open();
    await openTab(v, 'Settings');
    const t = v.container.textContent ?? '';
    /* THE SENTENCE IT USED TO READ WAS "The supplier references first ...",
       the `desc` under the dropdown. Matt replaced both on 2026-10-03: the
       dropdown became three radios and the note under it went, because it
       only ever described the option already chosen. The rule this test is
       about is unchanged -- this party is called a supplier, never a partner
       -- so it now reads the lines that are actually on the page. */
    expect(t).toContain('They check tenants, and Opndoor applies its own criteria too');
    expect(t).toContain('How are this supplier’s tenants checked?');
    expect(t).not.toMatch(/\bpartner\b/i);
  });

  /* STATUS IS A LABEL, NOT THE STORED VALUE. The column printed `u.status`
     straight out of the record, so it read "active" beside a People list
     that says "Active" everywhere else -- and "pending" where every other
     list says "Invited", which is also the truer word. */
  it('and capitalise the status on People, as every other people list does', async () => {
    const v = await open();
    await openTab(v, 'People');
    const cells = [...v.container.querySelectorAll('.pill')].map((e) => e.textContent ?? '');
    expect(cells).toContain('Active');
    expect(cells).not.toContain('active');
  });
});

/* ===========================================================================
   A BRANCH'S OWN CONTACT IS SHOWN, AND KEEPS BEING SHOWN.

   Matt, 2026-10-01: "Supplier Overview for Kestrel Lettings: Kestrel
   Riverside no longer shows its contact email (it showed
   kestrel.riverside@kestrel.invalid earlier). Find whether the contact was
   removed or the screen stopped showing it, fix it, and if a branch
   genuinely has no contact, warn on that branch."

   THE CONTACT WAS NOT REMOVED: it is on dev, RLS returns it to an admin,
   the hydration maps it onto the branch and the page renders it -- checked
   with dev's own rows, in the plain state and in the View as state. I could
   not reproduce the disappearance, and these are the assertions that would
   have caught it, written so that the next change which could cause it
   fails here instead of on Matt's screen.

   THE FIXTURE IS KESTREL'S SHAPE, which is the one with nothing on the
   agency and a contact on every branch -- the arrangement the agency row's
   own warning was rewritten around this afternoon, and therefore the one
   most likely to lose a branch's line by accident.
   =========================================================================== */
/* The tree is on its own tab since 2026-10-01; the claims are unchanged. */
describe('a branch with its own contact', () => {
  const branchRow = (v: { container: HTMLElement }, name: string) =>
    [...v.container.querySelectorAll('.ph-tree__branch')]
      .find((d) => (d.textContent ?? '').includes(name))!;

  it('shows that contact on the branch, not just on the agency', async () => {
    const v = await open();
    await openTab(v, 'Agencies');
    expect(branchRow(v, 'ZZZ North').textContent).toContain('north@zzz.test');
    expect(branchRow(v, 'ZZZ South').textContent).toContain('south@zzz.test');
  });

  /* THE ROW SHOWS AN ADDRESS OR A WARNING, NEVER NEITHER. "No longer shows
     its contact email" could mean either an empty row or a wrong one, and
     an empty row is the version nobody notices. */
  it('and every branch row says one or the other, never nothing', async () => {
    const v = await open();
    await openTab(v, 'Agencies');
    for (const row of v.container.querySelectorAll('.ph-tree__branch')) {
      const contact = row.querySelector('.ph-contact');
      expect(contact, `no contact line at all on: ${row.textContent}`).toBeTruthy();
      expect((contact!.textContent ?? '').trim().length).toBeGreaterThan(0);
    }
  });

  /* "IF A BRANCH GENUINELY HAS NO CONTACT, WARN ON THAT BRANCH" -- which
     is the branch's own row, not a count on the agency above it. */
  it('while a branch that genuinely has none is warned about there', async () => {
    const v = await open();
    await openTab(v, 'Agencies');
    expect(branchRow(v, 'ZZZ West').textContent).toMatch(/No agent contact/);
  });

  /* AND A BRANCH THAT INHERITS ITS AGENCY'S IS NOT WARNED ABOUT, because
     the deed has somewhere to go. The line says where it came from. */
  it('and one that inherits the agency’s shows it, marked as inherited', async () => {
    const v = await open();
    await openTab(v, 'Agencies');
    const row = branchRow(v, 'ZZZ Office');
    expect(row.textContent).toContain('ada@zzz.test');
    expect(row.textContent).not.toMatch(/No agent contact/);
  });
});

/* =====================================================================
   (cc2) THE PAGE IS NAMED AFTER THE SUPPLIER, AND THE TAG SAYS WHAT
   HAPPENS.

   Matt: "Supplier page: breadcrumb and page title show the supplier's
   name ('Kestrel Lettings'), not 'Supplier'; the header tag uses the
   plain wording of the checking setting ('They check tenants;
   Opndoor accepts them as sent')."

   A page titled with its own TYPE tells the reader what kind of page
   they opened, which they know, instead of which one, which is the
   question. The agency page has always passed its title; this one
   had two hardcoded literals.

   AND THE TAG WAS OUR VOCABULARY. REFERENCING_MODES carries both
   `label` ("Pre-referenced, open", the name of the setting in our
   words) and `choice` (the sentence a reader picks from, which says
   what actually happens). A header should say what happens.
   ===================================================================== */
describe('(cc2) the page is named after the supplier', () => {
  const src = readFileSync(join(process.cwd(), 'src/pages/PartnerManagement/PartnerHome.tsx'), 'utf8');

  it('passes the supplier name to the title and the breadcrumb', () => {
    expect(src).toContain("usePageMeta('partner-home', partner?.name ?? 'Supplier',");
    expect(src).toContain("partner?.name ?? 'Supplier']);");
    expect(src).not.toContain("usePageMeta('partner-home', 'Supplier', ['Home', 'Relationships', 'Suppliers', 'Supplier']);");
  });

  /* THE TYPE SURVIVES AS THE FALLBACK, for the moment before the
     partner resolves: a blank breadcrumb is worse than a generic
     one. */
  it('and keeps the generic word only as a fallback', () => {
    expect(src).toContain("?? 'Supplier'");
  });

  it('and the header tag uses the plain wording, not our label', () => {
    expect(src).toContain('REFERENCING_MODES.find((x) => x.id === m)?.choice');
    expect(src).not.toContain('REFERENCING_MODES.find((x) => x.id === m)?.label');
  });
});
