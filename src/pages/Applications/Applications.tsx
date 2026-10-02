/* =====================================================================
   Applications — every referral, filterable and searchable. Status tabs,
   search, an Origin column + filter (opndoor admin), branch filter, the
   drill-through banner when arriving from Agencies & branches, and row click
   through to the detail view. Partner isolation + the referrer "own referrals
   only" rule live in applicationsService.

   THE COLUMNS ARE NOT FIXED. A viewer inside one agency has one agency, one
   branch and one route, so those columns and their filters repeat the same
   word down every row; viewerShape measures the book and they come off. And
   delivery is shown here, as a badge on the status cell and as its own chips:
   "Deed Issued" reads identically whether or not the deed ever arrived.

   ONE QUESTION, ONE COLUMN. Route and Partner used to sit side by side, and
   between them they never answered "where did this come from": the pill said
   which rail and the name said which partner record, which on the agency rail
   is house plumbing nobody has heard of. They are one Origin column now, and
   one Origin filter, over the four kinds of party in origin.ts.
   ===================================================================== */
import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { officeLabel, showsOffices, isPlaceholderOrg } from '@/data/agencyOffices';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  agencyNamesForScope, agencyOfBranch, branchNamesForScope, countByStatus, getApplications,
  referrerNamesForScope, getPeriods, periodRange, ALL_PARTNERS, type Status, type Period,
  collateTenancies, groupTenancies, pageWithoutSplitting, scopedSummaries, tenancyDeedTally, tenancyPaidTally,
  originOf, originOptions, originToFilter, originFromParams, ORIGIN_KIND_LABEL,
} from '@/data';
import type { Role } from '@/data/types';
import { useSession } from '@/session/SessionContext';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Button } from '@/components/ui/Button';
import { ScopePicker } from '@/components/ui/ScopePicker';
import { recentScopes } from '@/data/scopeRecents';
import { Icon } from '@/components/ui/Icon';
import { Card } from '@/components/ui/Card';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Pill, type PillVariant } from '@/components/ui/Pill';
import { deliveryBadge, deliveryStateOf } from '@/data/deliveryState';
import { viewerShape } from '@/data/viewerShape';
import { FilterTabs } from '@/components/ui/FilterTabs';
import { RoleOnly } from '@/components/ui/RoleOnly';
import { RoleNote } from '@/components/ui/RoleNote';
import { Pager } from '@/components/ui/Pager';
import './Applications.css';
import { formatDate } from '@/lib/format';

const PAGE_SIZE = 20;
const STATUS_LABEL: Record<Status, string> = { draft: 'In progress', referencing: 'Awaiting decision', declined: 'Declined', sent: 'Sent', paid: 'Paid', deed: 'Deed Issued', withdrawn: 'Withdrawn', expired: 'Expired' };
/* Every id the status strip can hold: the eight real statuses, the cross-cuts
   that keep their row's own status (refunded, awaiting signature, the two draft
   sub-states) and the two DELIVERY states, which are two different questions
   with two different audiences (see deliveryState.ts). */
type ListFilter = Status | 'all' | 'refunded' | 'awaiting' | 'delivery-failed' | 'cannot-deliver' | 'withdrawn' | 'expired' | 'invited' | 'fee-unpaid';

/* The sub names the filters this viewer has actually been given. Telling
   somebody to filter by agency or branch beside a toolbar holding neither is
   the estate showing through again. */
const SUB_ESTATE = 'Every referral from sent through to deed issued. Filter by status, agency or branch, or search by tenant.';
/* The Origin selector lists the agencies itself, so where it is shown the
   Agency chip is not, and the sub has to name the control that is actually
   there rather than the one it replaced. */
const SUB_ORIGIN = 'Every referral from sent through to deed issued. Filter by status, origin or branch, or search by tenant.';
const SUB_ONE_AGENCY = 'Every referral from sent through to deed issued. Filter by status or referrer, or search by tenant.';
const SUB_OWN_ONLY = 'Every referral from sent through to deed issued. Filter by status, or search by tenant.';

// One format, shared. See lib/format.
const fmtDate = formatDate;
function initials(name: string): string {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('');
}

/** A filter pill whose WHOLE surface is the trigger: a transparent select is
    overlaid across the pill, so clicking the label, value or caret opens it. */
function FilterChip({ icon, label, display, value, onChange, children }: {
  icon: ReactNode;
  label: string;
  display: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  children: ReactNode;
}) {
  return (
    <span className="fchip">
      {icon}
      <span className="fchip__text">{label} <b>{display}</b></span>
      <Icon name="chevronDown" className="fchip__caret" />
      <select value={value} onChange={onChange} aria-label={label}>{children}</select>
    </span>
  );
}

export function Applications() {
  usePageMeta('applications', 'Applications', ['Home', 'Applications']);
  const { role, partnerScope, scopeSel, setScopeSel, dataVersion } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // Initial filters from the drill-through URL (?agency= / ?branch= / ?status= / ?deed=).
  // 'refunded' and 'awaiting' are status chips that cross-cut Paid (status stays Paid).
  const [status, setStatus] = useState<ListFilter>(() => {
    if (params.get('deed') === 'awaiting') return 'awaiting';
    /* TWO DEEP-LINKS, because delivery is two states.
       A send that ERRORED is the agency's business: they are the ones waiting
       for the deed and send_deed_to_agent lets them resend it, so every role
       may land on that filter, referrers included. "Cannot deliver" is ours:
       nothing was sent, nobody on the ladder could receive it, and it sits in a
       staff queue, so only opndoor staff may. #93 gated both to non-referrers,
       which was right about the state the old code could actually detect (the
       ops one) and wrong about the other. */
    if (params.get('deed') === 'delivery-failed') return 'delivery-failed';
    if ((role === 'superadmin' || role === 'opndoor_manager') && params.get('deed') === 'cannot-deliver') return 'cannot-deliver';
    const s = params.get('status');
    return s === 'sent' || s === 'paid' || s === 'deed' || s === 'refunded' || s === 'withdrawn' || s === 'expired' || s === 'referencing'
      || s === 'draft' || s === 'declined' || s === 'invited' || s === 'fee-unpaid' ? s : 'all';
  });
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('Newest first');
  /* ORIGIN: which party this came from (opndoor admin, or anyone whose book runs
     across more than one rail). One control in place of the old Route and
     Partner filters.

     Seeded from ?origin=, and from the two deep-links that predate it: ?partner=
     from a supplier's own page and ?route= from Home's Direct tiles. Both are
     translated by originFromParams rather than dropped, and both are validated
     there, so an unknown or stale id opens the whole book rather than an empty
     list labelled with a party that does not exist. */
  /* THE SELECTION IS THIS VISIT'S, AND A LINK DECIDES IT.
     ==================================================================
     Matt, 2026-10-02, reversing his own ruling of 2026-09-29 ("Reporting
     and Applications share one remembered scope choice"):

       "Any link that opens Applications sets exactly the filters it
        names and clears the rest; 'View all applications' clears them
        all. Filters chosen on the page itself can still be remembered
        while you stay on it."

     and, about the same selection reaching a third page:

       "Filters must not carry between pages: League, Applications and
        Reporting each open with their own defaults (Origin: Everything)
        unless a link sets a filter."

     WHAT WENT WRONG. The selection lived on the session and was written
     to localStorage, so it outlived the page AND the tab. Home's "View
     all Direct" set Origin: Direct, and "View all applications" -- which
     names no filter -- then opened the list still narrowed to Direct.
     Walking on to League carried it a page further, where there are no
     direct rows at all, so the Agencies table read "No matches".

     THE RULE IS NOW ON ARRIVAL, not on the picker. A link that names an
     origin sets it; a link that names none clears it. In between, the
     picker writes the session value as before, which is "remembered
     while you stay on it" -- and leaving is what ends it, because the
     next page's own arrival effect runs.

     STILL THE SESSION'S VALUE and not local state, deliberately:
     `setScopeSel` also moves `partnerScope`, which mirrors the server's
     isolation rule, and `viewingAs`, which the Reporting banner reads.
     Splitting those apart would be a change to the isolation plumbing to
     fix a filter that leaks, and the leak is fixed by deciding the value
     on arrival. */
  const origin = scopeSel;
  const setOrigin = setScopeSel;
  useEffect(() => {
    const fromLink = originFromParams({
      origin: params.get('origin'),
      partner: params.get('partner'),
      route: params.get('route'),
    });
    // `fromLink` is ORIGIN_ALL ('') when the link names nothing, which is
    // the clearing case and the reason this is not `if (fromLink)`.
    if (fromLink !== scopeSel) setScopeSel(fromLink);
    /* KEYED ON THE QUERY STRING, not on mount. Two links into this page
       from a page that IS this page -- an agency chip, a branch chip --
       do not remount it, so an effect that ran once would leave the
       previous link's filter in place and prove Matt's complaint again
       one navigation later. Nothing on this page writes the URL, so this
       cannot fight the picker: the only thing that changes `params` is
       arriving. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toString()]);
  const [agency, setAgency] = useState(() => params.get('agency') || (params.get('branch') ? agencyOfBranch(params.get('branch')!) : ''));
  const [branch, setBranch] = useState(() => params.get('branch') || '');
  // #owner Referrer filter (management + opndoor admin only). Referrers only ever
  // see their own applications, so the filter is never offered to them and a
  // ?referrer= they craft is ignored (scopedSet already restricts them to owner rows).
  const [referrer, setReferrer] = useState(() => (role !== 'referrer' ? params.get('referrer') || '' : ''));

  /* AND THE OTHER THREE FILTERS ARE THE LINK'S TOO. Matt, 2026-10-02:
     "Any link that opens Applications sets exactly the filters it names
     AND CLEARS THE REST; 'View all applications' clears them all."

     The three above are initialised from the URL, which is the "sets
     what it names" half, and a `useState` initialiser runs once per
     MOUNT. Arriving here from a page that is already this page -- an
     agency chip, a branch chip, the "Clear" on the drill-through banner
     -- does not remount, so the previous link's agency stayed in the
     box under the new link's origin. This is the clearing half, keyed on
     the query string like the origin effect beside it, and for the same
     reason: nothing on this page writes the URL, so it cannot fight the
     chips. */
  useEffect(() => {
    const linkBranch = params.get('branch') || '';
    setBranch(linkBranch);
    setAgency(params.get('agency') || (linkBranch ? agencyOfBranch(linkBranch) : ''));
    setReferrer(role !== 'referrer' ? params.get('referrer') || '' : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toString()]);
  // #owner Period filter — the dashboard's options, bucketed on sent date. Defaults
  // to All time so the page's default view (every application) is unchanged.
  const periods = getPeriods();
  const [period, setPeriod] = useState<Period>(() => periods.find((p) => p.id === 'alltime') || periods[periods.length - 1]);
  const range = useMemo(() => periodRange(period), [period]);

  /* Reset origin/agency/branch/referrer when the role CHANGES (partner
     isolation): a seat that swaps role must not keep the last one's filters.

     THE GUARD IS THE ROLE ITSELF, NOT A COUNT OF RUNS, and that is the whole
     of bug `?route=Direct is ignored`. It was `useRef(true)` with "skip the
     first run", which is invalid under StrictMode: React 18 double-invokes
     every effect on mount -- run, clean up, run again -- with the component
     instance and its refs PRESERVED. So the first invocation spent the guard
     and the second did the reset, wiping the origin the arrival effect above
     had just taken out of ?route=Direct. src/main.tsx wraps the app in
     StrictMode, so this happened on every mount of this page in dev: the box
     read Everything and the list showed the whole book, exactly as reported.

     Comparing the VALUE is idempotent, so running twice does what running
     once does. A real role change still clears, which is what the effect is
     for; being invoked again with the same role does nothing. */
  const actedOnRole = useRef<Role | null>(null);
  useEffect(() => {
    if (actedOnRole.current === null || actedOnRole.current === role) {
      actedOnRole.current = role;
      return;
    }
    actedOnRole.current = role;
    setOrigin('');
    setAgency('');
    setBranch('');
    setReferrer('');
  }, [role]);

  // opndoor staff (superadmin + opndoor_manager) read the whole book across every
  // partner — RLS permits it and Home counts the same way — so both see all
  // partners here. Everyone else is confined to their own partner scope.
  const isOpsStaff = role === 'superadmin' || role === 'opndoor_manager';
  const effectiveScope = isOpsStaff ? ALL_PARTNERS : partnerScope;
  /* THE ORIGIN SELECTION, AS THE QUERY ALREADY UNDERSTANDS IT. A supplier is the
     partner filter, Direct is the channel filter, an agency or a group is a list
     of agency names. One selector, no second filtering rule to drift from the
     first. */
  const originQuery = useMemo(
    () => originToFilter(origin, effectiveScope),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [origin, effectiveScope, dataVersion],
  );
  const scopeOpts = { role, scope: effectiveScope, partner: originQuery.partner };
  /* WALK FIX 7. The rows narrow by the SELECTION, asked as itself, rather
     than by originToFilter's translation of it into partner / agencies /
     channel. That translation has no arm for the two rails at the top of the
     picker (`rail:supplier`, `rail:agency`) and falls through to no filter,
     so choosing either left the whole book on screen: "choosing an option
     does nothing, the list doesn't change."

     `originToFilter` still earns its place just above, narrowing `scopeOpts`
     to a partner so the Agency, Branch and Referrer chips list that party's
     own options. That is a different job from filtering the rows, and it is
     the one it can do: a rail names no single partner, and leaving those
     chips open across the rail is right. */
  const filterOpts = {
    ...scopeOpts,
    agency: agency || undefined,
    branch: branch || undefined,
    referrer: referrer || undefined,
    origin,
    periodRange: range,
  };
  /* #owner Chips recount within the selected period and the current filter
     state -- AND WITHIN THE SEARCH, which was the one filter they did not
     follow. Matt, 2026-10-01: "every status tab count follows the current
     filters (origin, period, branch, referrer, search)."

     `filterOpts` is deliberately the SAME object the rows are built from,
     with only the status and the sort added on the row side, so a filter
     added to one is a filter added to both. `q` was the exception: it was
     passed to `getApplications` at the call site and never put in here, so
     typing a reference narrowed the list to one row while every tab above
     went on counting the whole book and "Showing 1 of 4" kept a denominator
     the search had already excluded. */
  const counts = countByStatus({ ...filterOpts, q });
  // #13: the "Showing X of Y" denominator must match the active status tab.
  /* "SHOWING X OF Y" COUNTS THE SAME SET THE TAB DOES. Matt, 2026-10-02:
     "the 'All' tab counts and shows every application in the current
     filters ... 'Showing X of Y' counts the same set."

     Y is the active tab's own count, which for All is now every row.

     THE HYPHENATED TABS NEEDED A MAP, and this is a fault the change
     above would have made worse rather than one it introduced. Four tab
     ids are hyphenated -- fee-unpaid, delivery-failed, cannot-deliver --
     while the count keys are camelCase, so `counts['fee-unpaid']` was
     undefined and Y silently fell back to `counts.all`. That used to
     show the funnel total under a draft tab; with All meaning all it
     would show the whole book. Named here rather than left to the
     fallback, which now has nothing sensible to fall back to. */
  const COUNT_KEY: Record<string, keyof typeof counts> = {
    'fee-unpaid': 'feeUnpaid',
    'delivery-failed': 'deliveryFailed',
    'cannot-deliver': 'cannotDeliver',
  };
  const total = counts[COUNT_KEY[status] ?? (status as keyof typeof counts)] ?? counts.all;
  const visibleRows = useMemo(
    () => getApplications({ ...filterOpts, status, q, sort }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [role, partnerScope, origin, status, agency, branch, referrer, q, sort, period],
  );

  // Pagination. Reset to the first page whenever the filtered set changes, and
  // clamp if the current page fell off the end (e.g. after narrowing filters).
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [role, partnerScope, origin, status, agency, branch, referrer, q, sort, period]);
  /* A JOINT TENANCY IS ONE THING, so it is ordered as one thing and never split
     across a page boundary. The tenancy takes the position of its first member
     under whatever sort is active, its members follow in entry order, and a page
     may run a row or two over PAGE_SIZE rather than leave the third tenant
     stranded at the top of the next page. */
  /* Grouped from the SCOPED set, not the filtered one. Filter to "Paid" and the
     lead disappears (it is in 'deed'), and a group built from what is left
     promotes the wrong applicant to lead, renumbers the others and reports the
     tenancy's status from a sibling. The tenancy is a fact about the data, not
     about the filter. */
  const tenancies = useMemo(
    () => groupTenancies(scopedSummaries(scopeOpts)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [role, partnerScope, origin, dataVersion],
  );
  const collated = useMemo(() => collateTenancies(visibleRows, tenancies), [visibleRows, tenancies]);
  const pages = useMemo(() => pageWithoutSplitting(collated, tenancies, PAGE_SIZE), [collated, tenancies]);
  const pageCount = Math.max(1, pages.length);
  const safePage = Math.min(page, pageCount);
  const pagedRows = pages[safePage - 1] ?? [];
  // The Pager cannot derive its own range here: pages are not uniform, because a
  // tenancy moves to the next page whole rather than being split.
  const shownFrom = pages.slice(0, safePage - 1).reduce((n, p) => n + p.length, 0) + 1;
  const pageRange: [number, number] = [shownFrom, shownFrom + pagedRows.length - 1];

  /* THE BOOK THE ORIGIN SELECTOR IS BUILT FROM, which is deliberately the book
     BEFORE the origin filter. Building the options from the filtered set would
     leave the selector holding only what is already selected, with no way back
     to anything else. */
  const originBook = useMemo(
    () => scopedSummaries({ role, scope: effectiveScope }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [role, effectiveScope, dataVersion],
  );
  const originOpts = useMemo(() => originOptions(originBook, origin), [originBook, origin]);
  /* The branch list follows whichever agency has been picked, by the drill-through
     or by the origin selector. Without the second, choosing one agency as the
     origin left the Branch chip offering every branch in the book. */
  const originAgency = originQuery.agencies?.length === 1 ? originQuery.agencies[0] : undefined;
  const agencyOptions = agencyNamesForScope(scopeOpts);
  const branchOptions = branchNamesForScope(scopeOpts, agency || originAgency);
  const referrerOptions = referrerNamesForScope(scopeOpts);
  // opndoor staff (superadmin + opndoor_manager) view every partner's book, so
  // both get the Origin column and the Origin filter to sub-filter by one party.
  const showPartner = isOpsStaff;
  const showReferrer = role !== 'referrer';

  /* WHAT DOES THIS VIEWER HAVE MORE THAN ONE OF?
     Rosa's list carried a Route column reading "Agent referral" 40 times, an
     Agency column reading her own agency's name 40 times and a Branch column
     under it reading her one branch, plus a filter for each offering a single
     choice. None of that is a choice; it is three columns of the same word.

     Measured on the book THIS PAGE renders (effectiveScope), not on the
     viewer's own partner: opndoor staff read every partner here whatever their
     home partner is, and asking about their home partner would strip the very
     columns that tell one partner's rows from another's.

     `measured` is the guard viewerShape cannot give us. It answers "one of
     everything" for an EMPTY book, deliberately and correctly for the screens
     it was written for; but it reads through scopeFull, whose role allowlist
     hands 'developer' nothing at all, and collapsing on a measurement of zero
     would take the Agency and Branch columns off a table that is still showing
     several of each. So a book has to have told us something before its answer
     is acted on.

     THIS PARAGRAPH NAMED opndoor_manager TOO until their blank Reporting page
     was fixed. Widening scopeFull to admit them does not weaken the guard here:
     it turns their measurement from a starved zero into the real shape of the
     estate, which is several agencies, so `oneAgency` is false and the columns
     stay for the right reason instead of by exemption. */
  const shape = useMemo(() => viewerShape(role, effectiveScope), [role, effectiveScope, dataVersion]);
  const measured = shape.agencies > 0;
  const showRoute = !(measured && shape.oneRoute);
  const showAgency = !(measured && shape.oneAgency);
  const showBranch = !(measured && shape.oneBranch);
  /* Branch and agency share one column (the branch, its agency underneath), so
     the column survives while either half still varies. */
  const showOrgCol = showBranch || showAgency;
  /* ORIGIN IS SHOWN WHERE EITHER OF THE TWO COLUMNS IT REPLACES WAS: opndoor
     staff, who read across every partner, and anybody else whose book runs
     across more than one rail. An agency user has one of each and gets neither,
     exactly as before. */
  const showOrigin = showPartner || showRoute;
  /* AND IT SUBSUMES THE AGENCY CHIP where it is shown, because it lists every
     agency and group in the book itself. Two chips both offering agencies is the
     same word twice, which is what this page takes columns off for. The Branch
     chip stays: it is the drill INTO the party the origin names. */
  const showAgencyChip = showAgency && !showOrigin;

  /* WHO SENT IT. Matt, 2026-10-01: "Agency Applications: add a 'Referred
     by' column for Directors and Managers."

     Not for a Negotiator, whose book is their own referrals, so the column
     would be their own name on every row -- the same measurement the Agency
     and Branch columns already come off on, and the reason `showReferrer`
     (the FILTER) is gated the same way -- and keeping the column on the
     same test as the filter is the honest pairing: a page that can filter
     by referrer and will not show you who sent a row is asking somebody to
     filter blind. */
  const showReferredBy = showReferrer;

  /* A control that is not on screen must not still be filtering. A ?route= or
     ?partner= deep-link into a one-rail book would otherwise leave the list
     filtered to a party nothing matches, with nothing on screen to clear it. */
  useEffect(() => {
    if (!showOrigin && origin) setOrigin('');
  }, [showOrigin, origin]);

  const tabs = [
    { id: 'all', label: 'All', count: counts.all },
    // Agent-rail pre-Sent stages (referencing_mode 'opndoor_referenced'). Each is
    // shown only when rows exist or the filter is deep-linked, so a supplier-only
    // partner never sees these tabs and its list is unchanged. Referrers DO see
    // their own agent-rail apps here (this is the "goes blind from invite to
    // approval" fix), so these are not gated to non-referrers.
    ...(counts.draft > 0 || status === 'draft'
      ? [{ id: 'draft', label: <Pill variant="muted" style={{ background: 'none', padding: 0 }}>In progress</Pill>, count: counts.draft }]
      : []),
    ...(counts.invited > 0 || status === 'invited'
      ? [{ id: 'invited', label: <Pill variant="muted" style={{ background: 'none', padding: 0 }}>Invited, not registered</Pill>, count: counts.invited }]
      : []),
    ...(counts.feeUnpaid > 0 || status === 'fee-unpaid'
      ? [{ id: 'fee-unpaid', label: <Pill variant="warn" style={{ background: 'none', padding: 0 }}>Fee unpaid</Pill>, count: counts.feeUnpaid }]
      : []),
    // Awaiting decision: submitted, awaiting the eligibility decision. Agent rail
    // only (a supplier app is never here); shown to referrers too now.
    ...(counts.referencing > 0 || status === 'referencing'
      ? [{ id: 'referencing', label: <Pill variant="warn" style={{ background: 'none', padding: 0 }}>Awaiting decision</Pill>, count: counts.referencing }]
      : []),
    ...(counts.declined > 0 || status === 'declined'
      ? [{ id: 'declined', label: <Pill variant="danger" style={{ background: 'none', padding: 0 }}>Declined</Pill>, count: counts.declined }]
      : []),
    { id: 'sent', label: <Pill variant="sent" style={{ background: 'none', padding: 0 }}>Sent</Pill>, count: counts.sent },
    { id: 'paid', label: <Pill variant="paid" style={{ background: 'none', padding: 0 }}>Paid</Pill>, count: counts.paid },
    { id: 'deed', label: <Pill variant="deed" style={{ background: 'none', padding: 0 }}>Deed Issued</Pill>, count: counts.deed },
    // Refunded cross-cuts Paid (the fee was refunded; status stays Paid). Counted
    // separately, so All still equals Sent + Paid + Deed, not their sum plus this.
    { id: 'refunded', label: <Pill variant="danger" style={{ background: 'none', padding: 0 }}>Refunded</Pill>, count: counts.refunded },
    // Awaiting signature: deed out for signature (a sub-state of Paid). Shown when
    // there is anything awaiting, or when the filter is already active (deep-link).
    ...(counts.awaiting > 0 || status === 'awaiting'
      ? [{ id: 'awaiting', label: <Pill variant="warn" style={{ background: 'none', padding: 0 }}>Awaiting signature</Pill>, count: counts.awaiting }]
      : []),
    /* DELIVERY IS TWO CHIPS, because it is two states with two audiences.
       "Delivery failed" is a send that was attempted and errored: everyone sees
       it, the agency included, because they are the ones waiting for the deed
       and they can resend it. "Held for send" is nobody on the rail's ladder to
       receive it: nothing was sent, nothing errored, and it is parked in our own
       queue, so it goes to opndoor staff alone. Each shows when it has rows or
       when its filter is deep-linked, as every other chip here does. */
    ...(counts.deliveryFailed > 0 || status === 'delivery-failed'
      ? [{ id: 'delivery-failed', label: <Pill variant="danger" style={{ background: 'none', padding: 0 }}>Delivery failed</Pill>, count: counts.deliveryFailed }]
      : []),
    ...(isOpsStaff && (counts.cannotDeliver > 0 || status === 'cannot-deliver')
      ? [{ id: 'cannot-deliver', label: <Pill variant="warn" style={{ background: 'none', padding: 0 }}>Held for send</Pill>, count: counts.cannotDeliver }]
      : []),
    // #2 Withdrawn: terminal, out of the funnel (excluded from All/Sent). Shown when
    // any exist or when deep-linked, so it never crowds the tabs when unused.
    ...(counts.withdrawn > 0 || status === 'withdrawn'
      ? [{ id: 'withdrawn', label: <Pill variant="muted" style={{ background: 'none', padding: 0 }}>Withdrawn</Pill>, count: counts.withdrawn }]
      : []),
    // #13 Expired: terminal (unpaid 14 days after Sent). Same closed/withdrawn family.
    ...(counts.expired > 0 || status === 'expired'
      ? [{ id: 'expired', label: <Pill variant="muted" style={{ background: 'none', padding: 0 }}>Expired</Pill>, count: counts.expired }]
      : []),
  ];

  const activeFilter = branch
    ? <>Showing applications for the <b>{branch}</b> branch{agency ? <> at <b>{agency}</b></> : null}</>
    : agency
      ? <>Showing applications for <b>{agency}</b> (all branches)</>
      : referrer
        ? <>Showing applications referred by <b>{referrer}</b></>
        : null;

  return (
    <>
      <div className="page-head">
        <div>
          <Eyebrow>Tracking</Eyebrow>
          <h1 className="page-head__title" style={{ marginTop: 10 }}>Applications</h1>
          <p className="page-head__sub">{showOrigin ? SUB_ORIGIN : showAgency ? SUB_ESTATE : showReferrer ? SUB_ONE_AGENCY : SUB_OWN_ONLY}</p>
        </div>
        {/* Management too: the route guard on /new-application admits them and
            the sidebar has always offered it, so withholding the button here
            only made a partner manager hunt for the one they are allowed.
            opndoor_manager stays out, deliberately — create_referral refuses it
            in SQL, so a button would be a promise the database breaks. */}
        <RoleOnly roles={['superadmin', 'management', 'referrer']}>
          <div className="page-head__actions">
            <Button variant="primary" size="sm" to="/new-application"><Icon name="plus" /> New application</Button>
          </div>
        </RoleOnly>
      </div>

      <RoleOnly roles={['referrer']}>
        <RoleNote style={{ marginBottom: 18 }}>
          Showing <b>your referrals only</b>. You can track every application you have sent.
        </RoleNote>
      </RoleOnly>

      {activeFilter && (
        <div className="active-filter">
          <Icon name="filter" className="lead" />
          <span>{activeFilter}</span>
          <button className="active-filter__clear" onClick={() => { setAgency(''); setBranch(''); setReferrer(''); }}>
            <Icon name="x" />Clear filter
          </button>
        </div>
      )}

      <div className="toolbar">
        <FilterTabs tabs={tabs} active={status} onChange={(id) => setStatus(id as ListFilter)} />
      </div>

      <div className="toolbar">
        <div className="toolbar__search">
          <Icon name="search" />
          <input type="text" placeholder="Search by tenant, property or reference" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="filterchips">
          <FilterChip icon={<Icon name="calendar" />} label="Period:" display={period.label} value={period.id}
            onChange={(e) => setPeriod(periods.find((p) => p.id === e.target.value) || period)}>
            {periods.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </FilterChip>
          {showOrigin && (
            <ScopePicker
              label="Origin:"
              ariaLabel="Origin"
              value={origin}
              options={originOpts}
              recents={recentScopes()}
              onChange={(v: string) => {
                setOrigin(v);
                /* The branch and the referrer belong to whoever was selected
                   before, so they go with the selection rather than sitting
                   there narrowing a different party to nothing. The agency
                   filter is the drill-through banner's, and has its own Clear. */
                setBranch('');
                setReferrer('');
              }}
            />
          )}
          {showAgencyChip && (
            <FilterChip icon={<Icon name="building" />} label="Agency:" display={agency || 'All'} value={agency}
              onChange={(e) => { setAgency(e.target.value); setBranch(''); }}>
              <option value="">All</option>
              {agencyOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </FilterChip>
          )}
          {showBranch && (
            <FilterChip icon={<Icon name="home" />} label="Branch:" display={branch || (agency ? 'All branches' : 'All')} value={branch}
              onChange={(e) => setBranch(e.target.value)}>
              <option value="">{agency ? 'All branches' : 'All'}</option>
              {branchOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </FilterChip>
          )}
          {showReferrer && (
            <FilterChip icon={<Icon name="users" />} label="Referrer:" display={referrer || 'All'} value={referrer}
              onChange={(e) => setReferrer(e.target.value)}>
              <option value="">All</option>
              {referrerOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </FilterChip>
          )}
          <FilterChip icon={<Icon name="chevronDown" />} label="Sort:" display={sort} value={sort}
            onChange={(e) => setSort(e.target.value)}>
            <option>Newest first</option>
            <option>Oldest first</option>
            <option>Rent: high to low</option>
          </FilterChip>
        </div>
        <span className="countline">Showing <b>{visibleRows.length}</b> of <b>{total}</b></span>
      </div>

      <Card>
        <div className="table-wrap">
          <table className="dt">
            <thead>
              <tr>
                <th>Tenant</th>
                {showOrigin && <th>Origin</th>}
                <th>Property</th>
                {showOrgCol && <th>{showBranch ? 'Branch' : 'Agency'}</th>}
                {showReferredBy && <th>Referred by</th>}
                <th style={{ textAlign: 'right' }}>Monthly rent</th>
                <th>Status</th>
                {/* NOT "Date". The cell is the row's MOST RECENT event,
                    deed issued, else paid, else sent (eventDate/eventTs in
                    hydrate, and what the Newest/Oldest sort orders on), so
                    the old heading never said which of the three it
                    was, and a row that jumped up the list looked mis-sorted
                    against a "Date" the reader took for the referral date. */}
                <th>Last activity</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((r, i) => {
                // Where it came from, named as the reader knows the party. Read
                // by the Origin cell and by the branch cell below it, which
                // drops its agency line when the origin has already said it.
                const o = originOf(r);
                /* THE TENANCY, when this row is part of one. The heading is drawn
                   once, above the first member, and every member row then reads
                   as part of it rather than as its own let. */
                const g = r.tenancyId ? tenancies.get(r.tenancyId) : undefined;
                const first = !!g && pagedRows[i - 1]?.tenancyId !== r.tenancyId;
                const last = !!g && pagedRows[i + 1]?.tenancyId !== r.tenancyId;
                const me = g?.members.find((m) => m.ref === r.ref);
                const shown = g ? pagedRows.filter((x) => x.tenancyId === r.tenancyId).length : 0;
                /* Tenant, Property, rent, Status, Last activity and the chevron are always
                   drawn; the other four come and go with the viewer's shape.
                   Keep this in step with the header row above, or the tenancy
                   heading runs short of the table it sits in. */
                const cols = 6 + (showOrigin ? 1 : 0) + (showOrgCol ? 1 : 0) + (showReferredBy ? 1 : 0);
                /* DID THIS TENANT'S DEED GET THERE? deliveryBadge owns both the
                   wording and who is shown which state; the state itself is read
                   again only to pick the tone, which is not its business. */
                const delivery = deliveryBadge(role, r);
                const failed = deliveryStateOf(r) === 'failed';
                return (
                <Fragment key={r.ref}>
                  {first && (
                    <tr className="jt-head">
                      <td colSpan={cols}>
                        {/* THE HEADING IS THE PROPERTY, and the rows under it are
                            the people. It used to open "2 tenants · 14 Chalcot
                            Road · one tenancy, a deed each": a count the rows
                            themselves make, then the address, then a rule about
                            deeds that the tally on the right now states as a
                            fact instead of a slogan. The address leads because
                            it is the one thing the rows below no longer say. */}
                        <span className="jt-head__prop">{g!.prop}</span>
                        <span className="jt-head__tag">Joint tenancy</span>
                        {/* A filter can hide a sibling, and then the tallies on
                            the right are counting tenants that are not on the
                            screen. Say so, rather than leave "2 of 2 paid"
                            standing over one row. */}
                        {shown < g!.members.length && (
                          <span className="jt-head__part">{shown} of {g!.members.length} shown by this filter</span>
                        )}
                        {/* THIS HEADING USED TO CARRY ONE STATUS PILL for the
                            whole tenancy, taken from the lead, on the old rule
                            that the deed was the tenancy's and only the lead
                            ever reached 'deed'. Each tenant now signs their own
                            deed once they have paid their own share, so there is
                            no single status that is true of the group and
                            TenancyGroup no longer offers one. What is true at
                            this level is the two counts; each row goes on saying
                            its own status, as it always did. */}
                        <span className="jt-head__prog">
                          <span className="jt-head__paid">{tenancyPaidTally(g!)}</span>
                          <span className="jt-head__dot" aria-hidden="true">·</span>
                          <span className="jt-head__deeds">{tenancyDeedTally(g!)}</span>
                        </span>
                      </td>
                    </tr>
                  )}
                  <tr
                    className={g ? `jt-row${first ? ' jt-row--first' : ''}${last ? ' jt-row--last' : ''}` : undefined}
                    onClick={() => navigate(`/applications/${encodeURIComponent(r.ref)}`)}
                  >
                    <td>
                      <div className="who">
                        <span className="who__av">{initials(r.tenant)}</span>
                        <div>
                          {/* NO LEAD BADGE, and no "Tenant 1 of 2". The badge
                              marked the applicant who carried the tenancy's one
                              deed; with a deed each it ranks people who are not
                              ranked, and "first entered" is not a fact the
                              reader can do anything with. The numbering went the
                              same way: the tally on the heading, "2 of 2 paid",
                              already says how many tenants there are. The row is
                              this person: their name and their reference. */}
                          <div className="dt__name">{r.tenant}</div>
                          <div className="dt__sub">{r.ref}</div>
                        </div>
                      </div>
                    </td>
                    {/* THE PARTY, then what kind of party it is. The name on its
                        own is not enough — "Regent's Lettings" and "Homeppl"
                        are both just names until something says which rail each
                        is on — and the kind on its own is the Route pill this
                        replaced, which never said whose. */}
                    {showOrigin && (
                      <td>
                        <div className="dt__name">{o.name}</div>
                        <div className="dt__sub">{ORIGIN_KIND_LABEL[o.kind]}</div>
                      </td>
                    )}
                    {/* THE PROPERTY IN MUTED TEXT ON A SIBLING, not a dash.
                        It was a dash on the reasoning that the heading had
                        already said it and repeating it made two tenants read
                        as two lets at the same address. The heading does say
                        it, and the tag and the tallies now make the grouping
                        unmistakable, so the repetition costs nothing; a column
                        of dashes reads as missing data, which costs more. */}
                    <td>{g ? <span className="soft">{r.prop}</span> : r.prop}</td>
                    {showOrgCol && (
                      <td>
                        {/* NM-P, PER ROW AND NOT PER PAGE. `showBranch` is a
                            COLUMN rule about the reader's whole book; this is
                            about THIS row's agency, and the two can disagree
                            on the same page -- a mixed list where Foxglove
                            has three offices and Riverside has one must name
                            the office on one row and the agency on the other.
                            `officeLabel` answers exactly that and never
                            returns an empty string. */}
                        {showBranch ? officeLabel(r.agency, r.branch, r.partner) : r.agency}
                        {/* Not when the Origin column has just said it, and not
                            when the line above has already been promoted to the
                            agency's own name for a single-office agency -- that
                            would print the same words twice. */}
                        {showBranch && showAgency && showsOffices(r.agency, r.partner) && r.agency !== o.name && !isPlaceholderOrg(r.agency) && <div className="dt__sub">{r.agency}</div>}
                      </td>
                    )}
                    {showReferredBy && (
                      <td className="soft">
                        {r.referrer || <span className="dt__sub">Not recorded</span>}
                      </td>
                    )}
                    {/* The rent is the PROPERTY's and is the same on every sibling,
                        so a joint row says what this tenant's share of it is —
                        otherwise two rows read as two £3,000 lets. */}
                    <td style={{ textAlign: 'right' }}>
                      <span className="dt__rent">£{r.rent.toLocaleString('en-GB')}</span>
                      <div className="dt__sub">{me?.sharePercent != null ? `${me.sharePercent}% share` : 'per month'}</div>
                    </td>
                    <td>
                      <span className="status-cell">
                        <Pill variant={r.status === 'withdrawn' || r.status === 'expired' || r.status === 'draft' ? 'muted' : r.status === 'referencing' ? 'warn' : r.status === 'declined' ? 'danger' : (r.status as PillVariant)}>{STATUS_LABEL[r.status]}</Pill>
                        {r.refunded && <span className="refund-tag" title="Guarantor fee refunded">Refunded</span>}
                        {/* Payment is per applicant: each tenant pays their own
                            share through their own link, so it is theirs to show
                            even where the status is the tenancy's. */}
                        {me && !me.paid && <span className="jt-unpaid" title="This tenant has not paid their share">Not paid</span>}
                        {/* The status says "Deed Issued" whether the deed arrived
                            or not, which is how a filter could find a row that
                            showed no sign of the thing it was filtered on. */}
                        {delivery && (
                          <span className={`delivery-tag${failed ? ' delivery-tag--failed' : ''}`} title={delivery.title}>{delivery.label}</span>
                        )}
                      </span>
                    </td>
                    <td className="dt__num soft">{fmtDate(r.date)}</td>
                    <td><Icon name="chevronRight" className="dt__chev" size={16} /></td>
                  </tr>
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {visibleRows.length === 0 && <div className="empty is-shown">No applications match your filters.</div>}
        <Pager page={safePage} pageSize={PAGE_SIZE} total={visibleRows.length} pageCount={pageCount} range={pageRange} onPage={setPage} noun="applications" />
      </Card>
    </>
  );
}
