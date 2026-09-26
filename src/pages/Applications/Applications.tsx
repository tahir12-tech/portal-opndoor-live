/* =====================================================================
   Applications — every referral, filterable and searchable. Status tabs,
   search, agency/branch filters, a partner column + filter (opndoor admin),
   the drill-through banner when arriving from Agencies & branches, and row
   click through to the detail view. Partner isolation + the referrer
   "own referrals only" rule live in applicationsService.

   THE COLUMNS ARE NOT FIXED. A viewer inside one agency has one agency, one
   branch and one route, so those columns and their filters repeat the same
   word down every row; viewerShape measures the book and they come off. And
   delivery is shown here, as a badge on the status cell and as its own chips:
   "Deed Issued" reads identically whether or not the deed ever arrived.
   ===================================================================== */
import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  agencyNamesForScope, agencyOfBranch, branchNamesForScope, countByStatus, getApplications, getPartners,
  getPartner, partnerName, referrerNamesForScope, getPeriods, periodRange, ALL_PARTNERS, type Status, type Period,
  collateTenancies, groupTenancies, pageWithoutSplitting, scopedSummaries, tenancyDeedTally, tenancyPaidTally,
} from '@/data';
import { useSession } from '@/session/SessionContext';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Card } from '@/components/ui/Card';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Pill, type PillVariant } from '@/components/ui/Pill';
import { channelOf, ROUTE_LABEL, CHANNELS, type Channel } from '@/data/channel';
import { deliveryBadge, deliveryStateOf } from '@/data/deliveryState';
import { viewerShape } from '@/data/viewerShape';

/** The pill variant per route, reusing the portal's status palette so the four
    routes read distinctly and on-brand. */
const ROUTE_PILL: Record<Channel, PillVariant> = {
  'Direct': 'muted',
  'Agent referral': 'paid',
  'Partner referral': 'sent',
  'Provider hand-over': 'warn',
};
import { FilterTabs } from '@/components/ui/FilterTabs';
import { RoleOnly } from '@/components/ui/RoleOnly';
import { RoleNote } from '@/components/ui/RoleNote';
import { Pager } from '@/components/ui/Pager';
import './Applications.css';

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
const SUB_ONE_AGENCY = 'Every referral from sent through to deed issued. Filter by status or referrer, or search by tenant.';
const SUB_OWN_ONLY = 'Every referral from sent through to deed issued. Filter by status, or search by tenant.';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
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
  const { role, partnerScope, dataVersion } = useSession();
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
  // Partner sub-filter (opndoor admin). Seeded from ?partner= so a supplier's page
  // can deep-link to its own applications; validated against the real partner list
  // (unknown/stale slugs fall back to no filter rather than an empty, mislabelled
  // list). A non-superadmin is already confined to their own partner by scope.
  const [partner, setPartner] = useState(() => {
    const p = params.get('partner');
    return p && getPartners().some((x) => x.id === p) ? p : '';
  });
  const [agency, setAgency] = useState(() => params.get('agency') || (params.get('branch') ? agencyOfBranch(params.get('branch')!) : ''));
  const [branch, setBranch] = useState(() => params.get('branch') || '');
  // #owner Referrer filter (management + opndoor admin only). Referrers only ever
  // see their own applications, so the filter is never offered to them and a
  // ?referrer= they craft is ignored (scopedSet already restricts them to owner rows).
  const [referrer, setReferrer] = useState(() => (role !== 'referrer' ? params.get('referrer') || '' : ''));
  // Route filter (Direct / Agency / Supplier / Provider), for every role — the one
  // list, filterable by how each application arrived. Empty = all routes. Seeded
  // from ?route= (validated against the four channels) so Home's Direct tile and
  // other deep-links can open the list pre-filtered by route.
  const [route, setRoute] = useState<Channel | ''>(() => {
    const r = params.get('route');
    return (CHANNELS as readonly string[]).includes(r ?? '') ? (r as Channel) : '';
  });
  // #owner Period filter — the dashboard's options, bucketed on sent date. Defaults
  // to All time so the page's default view (every application) is unchanged.
  const periods = getPeriods();
  const [period, setPeriod] = useState<Period>(() => periods.find((p) => p.id === 'alltime') || periods[periods.length - 1]);
  const range = useMemo(() => periodRange(period), [period]);

  // Reset partner/agency/branch/referrer when the role changes (partner isolation), skipping first run.
  const firstRole = useRef(true);
  useEffect(() => {
    if (firstRole.current) {
      firstRole.current = false;
      return;
    }
    setPartner('');
    setAgency('');
    setBranch('');
    setReferrer('');
    setRoute('');
  }, [role]);

  // const scopeOpts = { role, scope: partnerScope, partner: partner || undefined };

  // opndoor staff (superadmin + opndoor_manager) read the whole book across every
  // partner — RLS permits it and Home counts the same way — so both see all
  // partners here. Everyone else is confined to their own partner scope.
  const isOpsStaff = role === 'superadmin' || role === 'opndoor_manager';
  const effectiveScope = isOpsStaff ? ALL_PARTNERS : partnerScope;
  const scopeOpts = { role, scope: effectiveScope, partner: partner || undefined };
  // #owner Chips recount within the selected period and the current filter state.
  const counts = countByStatus({ ...scopeOpts, agency: agency || undefined, branch: branch || undefined, referrer: referrer || undefined, channel: route || undefined, periodRange: range });
  // #13: the "Showing X of Y" denominator must match the active status tab.
  // Withdrawn/Expired are terminal and excluded from counts.all, so on those tabs
  // Y must be the tab's own count, not the operational total.
  const total = (counts as Record<string, number>)[status] ?? counts.all;
  const visibleRows = useMemo(
    () => getApplications({ ...scopeOpts, status, agency: agency || undefined, branch: branch || undefined, referrer: referrer || undefined, channel: route || undefined, q, sort, periodRange: range }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [role, partnerScope, partner, status, agency, branch, referrer, route, q, sort, period],
  );

  // Pagination. Reset to the first page whenever the filtered set changes, and
  // clamp if the current page fell off the end (e.g. after narrowing filters).
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [role, partnerScope, partner, status, agency, branch, referrer, route, q, sort, period]);
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
    [role, partnerScope, partner, dataVersion],
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

  const agencyOptions = agencyNamesForScope(scopeOpts);
  const branchOptions = branchNamesForScope(scopeOpts, agency || undefined);
  const referrerOptions = referrerNamesForScope(scopeOpts);
  // opndoor staff (superadmin + opndoor_manager) view every partner's book, so
  // both get the Partner column and the Partner filter chip to sub-filter by one.
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
     hands opndoor_manager and developer nothing at all, and collapsing on a
     measurement of zero would take the Agency and Branch columns off a table
     that is still showing several of each. So a book has to have told us
     something before its answer is acted on. */
  const shape = useMemo(() => viewerShape(role, effectiveScope), [role, effectiveScope, dataVersion]);
  const measured = shape.agencies > 0;
  const showRoute = !(measured && shape.oneRoute);
  const showAgency = !(measured && shape.oneAgency);
  const showBranch = !(measured && shape.oneBranch);
  /* Branch and agency share one column (the branch, its agency underneath), so
     the column survives while either half still varies. */
  const showOrgCol = showBranch || showAgency;

  /* A control that is not on screen must not still be filtering. A ?route=
     deep-link into a one-route book would otherwise leave the list filtered to
     a route nothing matches, with nothing on screen to clear it. */
  useEffect(() => {
    if (!showRoute && route) setRoute('');
  }, [showRoute, route]);

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
          <p className="page-head__sub">{showAgency ? SUB_ESTATE : showReferrer ? SUB_ONE_AGENCY : SUB_OWN_ONLY}</p>
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
          {showPartner && (
           <FilterChip
                icon={<Icon name="shield" />}
                label="Partner:"
                display={!partner || partner === ALL_PARTNERS ? 'All' : partnerName(partner)}
                value={partner}
                onChange={(e) => {
                  setPartner(e.target.value);
                  setAgency('');
                  setBranch('');
                  setReferrer('');
                }}
              >
                <option value="">All</option>
                {getPartners().map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </FilterChip>
          )}
          {showAgency && (
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
          {showRoute && (
            <FilterChip icon={<Icon name="filter" />} label="Route:" display={route ? ROUTE_LABEL[route] : 'All'} value={route}
              onChange={(e) => setRoute(e.target.value as Channel | '')}>
              <option value="">All</option>
              {CHANNELS.map((c) => <option key={c} value={c}>{ROUTE_LABEL[c]}</option>)}
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
                {showRoute && <th>Route</th>}
                {showPartner && <th>Partner</th>}
                <th>Property</th>
                {showOrgCol && <th>{showBranch ? 'Branch' : 'Agency'}</th>}
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
                const ch = channelOf({ partnerSlug: r.partner, partnerMode: getPartner(r.partner)?.referencingMode });
                /* THE TENANCY, when this row is part of one. The heading is drawn
                   once, above the first member, and every member row then reads
                   as part of it rather than as its own let. */
                const g = r.tenancyId ? tenancies.get(r.tenancyId) : undefined;
                const first = !!g && pagedRows[i - 1]?.tenancyId !== r.tenancyId;
                const last = !!g && pagedRows[i + 1]?.tenancyId !== r.tenancyId;
                const me = g?.members.find((m) => m.ref === r.ref);
                const shown = g ? pagedRows.filter((x) => x.tenancyId === r.tenancyId).length : 0;
                /* Tenant, Property, rent, Status, Last activity and the chevron are always
                   drawn; the other three come and go with the viewer's shape.
                   Keep this in step with the header row above, or the tenancy
                   heading runs short of the table it sits in. */
                const cols = 6 + (showRoute ? 1 : 0) + (showPartner ? 1 : 0) + (showOrgCol ? 1 : 0);
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
                    {showRoute && <td><Pill variant={ROUTE_PILL[ch]}>{ROUTE_LABEL[ch]}</Pill></td>}
                    {showPartner && <td>{partnerName(r.partner)}</td>}
                    {/* THE PROPERTY BELONGS TO THE HEADING when this row is in
                        a tenancy. It is stated once above the group, and
                        repeating it down the siblings is exactly what made two
                        tenants read as two lets at the same address. */}
                    <td>{g ? <span className="soft">-</span> : r.prop}</td>
                    {showOrgCol && (
                      <td>
                        {showBranch ? r.branch : r.agency}
                        {showBranch && showAgency && <div className="dt__sub">{r.agency}</div>}
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
