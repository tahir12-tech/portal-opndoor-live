/* =====================================================================
   Admin home — the Opndoor-staff landing (superadmin + opndoor_manager).
   Queues that need a person first, then applications across every route with
   the route visible. Replaces the analytics dashboard as the front door for
   staff who run the book; the analytics live on Reporting, one destination among
   several. Uses the existing services and route model; no new data.
   ===================================================================== */
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  awaitingDecisionCount, reconciliationPendingCount, loadAgencyMatchQueue, countByStatus,
  getApplications, getAgencies, ALL_PARTNERS, canPostStatements,
} from '@/data';
import { agenciesNeedingAnEmail } from '@/data/deedContact';
import { plural } from '@/lib/plural';
import { channelOf, ROUTE_LABEL, type Channel } from '@/data/channel';
import { getPartner } from '@/data/partnersService';
import { getPositions } from '@/data/positionsService';
import { orgLabel } from '@/data/agencyOffices';
import { useSession } from '@/session/SessionContext';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Card, CardHead, CardBody } from '@/components/ui/Card';
import { Pill, type PillVariant } from '@/components/ui/Pill';
import { Icon } from '@/components/ui/Icon';
import './Home.css';

const ROUTE_PILL: Record<Channel, PillVariant> = {
  'Direct': 'muted',
  'Agent referral': 'paid',
  'Partner referral': 'sent',
  'Provider hand-over': 'warn',
};
const initials = (n: string) => n.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

/**
 * What the Reconciliation tile's number is made of.
 *
 * Matt, 2026-10-02: "Include those in the Home count and say what they
 * are, e.g. '2 supplier agencies need an email'." His example is the
 * phrasing, so it is used verbatim when that is the whole of it.
 *
 * NAMES ONLY WHAT IS THERE. A tile reading "and 0 supplier agencies need
 * an email" is a sentence about nothing, and the reason the older meta
 * said one thing was that there was only one thing to say.
 */
export function reconMeta(review: number, needEmail: number): string {
  const parts: string[] = [];
  /* "3 to review" rather than "3 agencies and branches to review": the
     queue holds both kinds and the count is of the two together, so
     naming them would need "1 agency and branch", which is not English.
     The tile is labelled Reconciliation and the page says the rest. */
  if (review > 0) parts.push(`${review} to review`);
  if (needEmail > 0) {
    parts.push(`${needEmail} supplier ${plural(needEmail, 'agency')} ${needEmail === 1 ? 'needs' : 'need'} an email`);
  }
  // Nothing waiting: the tile shows 0 and the line says what it would count.
  if (!parts.length) return 'waiting now: agencies and branches to review';
  return `waiting now: ${parts.join(', ')}`;
}

export function Home() {
  usePageMeta('home', 'Home', []);
  const { role, dataVersion } = useSession();
  const isOpndoorStaff = role === 'superadmin' || role === 'opndoor_manager';
  const scopeOpts = { role, scope: ALL_PARTNERS as string };

  const awaiting = awaitingDecisionCount();
  const recon = reconciliationPendingCount();
  /* AND THE AGENCIES THAT NEED AN EMAIL, which are on the same page and
     were not in the same number. Matt, 2026-10-02: "Home's Reconciliation
     count shows 0 while the 'Supplier agencies with no email' tab lists
     two. Include those in the Home count and say what they are."

     COUNTED HERE FROM THE HYDRATED ORG, not fetched. The tile is
     synchronous and the Reconciliation tab's own reader is an RPC; asking
     the server here would make Home wait on a round trip to draw a
     number. `agenciesNeedingAnEmail` is the same predicate the Agencies
     screen and the supplier's page use, and the SQL reader applies the
     same three tests, so the tile and the tab count the same rows. */
  const needEmail = agenciesNeedingAnEmail(getAgencies(ALL_PARTNERS)).length;
  const deliveryFailed = countByStatus(scopeOpts).deliveryFailed;

  /* THE INVOICE ADDRESS, and whether a statement could be posted at all.
     Matt, 2026-10-01: "Until it's set, don't send statements; show a
     clear warning on Home and Health saying the invoice email needs
     setting." His second message added the seeded default and "no
     warning needed while it's set", so on a healthy estate this is true
     and nothing renders.

     ASKED THROUGH statements_can_be_posted(), not by reading
     app_settings: that table is readable only by an admin at aal2, so a
     direct read would answer "empty" for everyone else and put a warning
     about Opndoor's own finance inbox on a page an agency manager reads.
     The gate below is `isOpndoorStaff`, which is who can act on it. */
  const [canPost, setCanPost] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (!isOpndoorStaff) { setCanPost(undefined); return; }
    let cancelled = false;
    void canPostStatements()
      .then((ok) => { if (!cancelled) setCanPost(ok); })
      // A failed read is not an unset setting: say nothing rather than
      // raise an alarm about a question we could not ask.
      .catch(() => { if (!cancelled) setCanPost(undefined); });
    return () => { cancelled = true; };
  }, [dataVersion, isOpndoorStaff]);

  // The direct-match backlog is an async, superadmin-scoped RPC (see Sidebar).
  const [matches, setMatches] = useState(0);
  useEffect(() => {
    if (!isOpndoorStaff) { setMatches(0); return; }
    let cancelled = false;
    void loadAgencyMatchQueue()
      .then((rows) => { if (!cancelled) setMatches(rows.filter((r) => r.state === 'needs_review').length); })
      .catch(() => { if (!cancelled) setMatches(0); });
    return () => { cancelled = true; };
  }, [dataVersion, isOpndoorStaff]);

  // The awaiting-decision cohort, route-badged — the clearest "needs a person" list.
  const needs = useMemo(
    () => getApplications({ ...scopeOpts, status: 'referencing' }).slice(0, 8),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [role, dataVersion],
  );

  // Per-actor landing: only opndoor staff see the ops Home. A developer's home is
  // the Dev Centre; an agency/group manager lands on THEIR agency home (per the
  // invited-manager decision); everyone else lands on their book (Reporting).
  if (!isOpndoorStaff) return <ManagerLanding />;

  /* WALK FIX 25. "Label every number with what it counts: the four queue
     tiles as 'waiting now'." Every one of these is a snapshot of what is
     sitting in a queue at this moment, and nothing on the page said so, so
     a reader had no way to tell them from a total for some period. Matt's
     own words, on the meta line each tile already has. */
  const tiles = [
    { label: 'Awaiting decision', n: awaiting, meta: 'waiting now for an eligibility decision', to: '/applications?status=referencing', tone: 'warn' as const },
    { label: 'Agency matches', n: matches, meta: 'waiting now: direct tenants, unmatched agent', to: '/reconciliation?tab=matches', tone: 'accent' as const },
    /* ONE TILE, TWO KINDS OF WORK, and the meta names whichever is there.
       A tile that counts both and describes one sends the reader to a
       page looking for rows that are on another tab. */
    { label: 'Reconciliation', n: recon + needEmail, meta: reconMeta(recon, needEmail), to: '/reconciliation', tone: 'accent' as const },
    { label: 'Delivery failed', n: deliveryFailed, meta: 'waiting now: deed not delivered', to: '/applications?deed=delivery-failed', tone: 'danger' as const },
  ];

  // Direct signups — tenants who came to Opndoor directly (route 'Direct', no
  // agency or supplier). They start at Awaiting decision, then Sent -> Paid -> Deed.
  // Each stage links to the applications list pre-filtered to Direct + that stage.
  const direct = countByStatus({ ...scopeOpts, channel: 'Direct' });
  /* SHOWN ONLY WHERE THE RAIL EXISTS. A panel of four zeros headed "Direct
     signups" is not information: most days opndoor has no direct tenants at
     all, and the card was the largest thing on a page whose job is to say what
     needs doing. */
  const directTotal = direct.referencing + direct.sent + direct.paid + direct.deed;
  /* WALK FIX 25, and the label is not one label. `countByStatus` above is
     called with no periodRange, so it is ALL TIME, and it counts CURRENT
     STATUS rather than events in a window: a row is under `sent` because it
     is sitting at Sent now, not because it was sent recently.

     Which makes three of these four a snapshot and the fourth a lifetime
     total. Awaiting decision, Sent and Paid are states a referral waits in
     and leaves; Deed issued is terminal, so nothing leaves it and that
     number grows for ever. One period label over all four would be wrong
     about three of them or about the fourth, so each says what it is.

     Whether the panel should offer a period at all is Matt's, recorded as
     NM-L. This labels what is there. */
  const directStages = [
    { label: 'Awaiting decision', n: direct.referencing, counts: 'waiting now', to: '/applications?route=Direct&status=referencing' },
    { label: 'Sent', n: direct.sent, counts: 'waiting now', to: '/applications?route=Direct&status=sent' },
    { label: 'Paid', n: direct.paid, counts: 'waiting now', to: '/applications?route=Direct&status=paid' },
    { label: 'Deed issued', n: direct.deed, counts: 'all time', to: '/applications?route=Direct&status=deed' },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          {/* SAID ONCE. The eyebrow read "Opndoor", the title read "Home" and
              the breadcrumb read "Home" again, so three lines of chrome carried
              no information between them and the sentence that does was fourth.
              The sentence IS the title now. */}
          <h1 className="page-head__title">What needs a person today</h1>
          <p className="page-head__sub">Across every route. Settlements and the bordereau are on Reporting.</p>
        </div>
      </div>

      {/* NOTHING CAN BE POSTED AT ALL, which outranks every queue below it:
          the tiles say what needs a person today, and this says the
          monthly run will do nothing on the 1st. Linked to where the
          setting lives rather than described, so it is one click to fix. */}
      {canPost === false && (
        <Link to="/health" className="home-stop" role="alert">
          <Icon name="alert" />
          <span>
            <b>The invoice email is not set, so no commission statement can be posted.</b>{' '}
            Every statement tells the payee where to send their invoice, and the monthly run
            refuses rather than sending one that cannot. Set it on Health, under Settings.
          </span>
          <Icon name="arrowRight" size={13} />
        </Link>
      )}

      <div className="home-queues">
        {/* A QUEUE WITH NOTHING IN IT IS DONE, not a link. It rendered as a
            faded card still offering Open, so the page asked to be worked
            through four times to find that three of them were empty. An empty
            one is now a plain div: nothing to click, and it says so. */}
        {tiles.map((t) => (t.n > 0 ? (
          <Link key={t.label} to={t.to} className={`home-q home-q--${t.tone}`}>
            <div className="home-q__label">{t.label}</div>
            <div className="home-q__n">{t.n}</div>
            <div className="home-q__meta">{t.meta}</div>
            <span className="home-q__go">Open <Icon name="arrowRight" size={13} /></span>
          </Link>
        ) : (
          <div key={t.label} className="home-q home-q--empty">
            <div className="home-q__label">{t.label}</div>
            <div className="home-q__n">0</div>
            <div className="home-q__meta">{t.meta}</div>
            <span className="home-q__done">Nothing to do</span>
          </div>
        )))}
      </div>

      {/* DIRECT SIGNUPS — the one route with no agency/supplier home of its own;
          its stages get a first-class panel here, each deep-linking to the list.
          Only when there are any: see directTotal. */}
      {directTotal > 0 && (
      <Card>
        <CardHead
          title="Direct signups"
          /* MATT'S WORDING, 2026-09-30, verbatim. It replaces "Three of
             these are how many are sitting there now; Deed issued is every
             direct deed ever issued", which made the reader work out WHICH
             three against four tiles, and would have quietly stopped being
             true the day a fifth stage was added. His names them. */
          sub="Tenants who came to Opndoor directly, with no agency or supplier, by stage. Awaiting decision, Sent and Paid show who is there now. Deed issued is all time."
          actions={<Link className="home-viewall" to="/applications?route=Direct">View all Direct <Icon name="arrowRight" size={13} /></Link>}
        />
        <CardBody>
          <div className="home-stages">
            {directStages.map((s) => (
              <Link key={s.label} to={s.to} className={`home-stage${s.n > 0 ? '' : ' home-stage--empty'}`}>
                <div className="home-stage__n">{s.n}</div>
                <div className="home-stage__l">{s.label}</div>
                <div className="home-stage__c">{s.counts}</div>
              </Link>
            ))}
          </div>
        </CardBody>
      </Card>
      )}

      <Card>
        <CardHead
          title="Needs attention"
          sub="Applications awaiting a decision, across every route."
          actions={<Link className="home-viewall" to="/applications">View all applications <Icon name="arrowRight" size={13} /></Link>}
        />
        <CardBody style={{ padding: 0 }}>
          {needs.length === 0 ? (
            <div className="home-empty">Nothing awaiting a decision right now.</div>
          ) : (
            <table className="dt home-table">
              <thead>
                <tr><th>Route</th><th>Tenant</th><th>Property</th><th>Branch</th></tr>
              </thead>
              <tbody>
                {needs.map((r) => {
                  const ch = channelOf({ partnerSlug: r.partner, partnerMode: getPartner(r.partner)?.referencingMode });
                  return (
                    <tr key={r.ref}>
                      <td><Pill variant={ROUTE_PILL[ch]}>{ROUTE_LABEL[ch]}</Pill></td>
                      <td>
                        <Link className="home-tenant" to={`/applications/${encodeURIComponent(r.ref)}`}>
                          <span className="who__av">{initials(r.tenant)}</span>
                          <span><span className="dt__name">{r.tenant}</span><span className="dt__sub">{r.ref}</span></span>
                        </Link>
                      </td>
                      <td>{r.prop}</td>
                      {/* "-" for a direct signup: its branch is the house
                          rail's placeholder, not a branch. */}
                      <td className="soft">{orgLabel(r.branch)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {/* SETTLEMENTS AND THE BORDEREAU HAVE MOVED TO REPORTING. This page is
          the human work queue: what needs a person today. A settlement total
          and an underwriter bordereau are neither a queue nor a thing a person
          does today, and they were the largest thing on the page. They are
          money, and money is Reporting's subject. See Dashboard. */}
    </>
  );
}

/** Non-staff landing. A developer goes to the Dev Centre; an agency or group
    manager (a position holder) lands on their own agency home; everyone else on
    their book (Reporting). Async because positions are read per user. */
function ManagerLanding() {
  const { role, currentUserId } = useSession();
  const [dest, setDest] = useState<string | null>(null);
  useEffect(() => {
    if (role === 'developer') { setDest('/dev-centre'); return; }
    if (role !== 'management') { setDest('/dashboard'); return; }
    let alive = true;
    getPositions(currentUserId ?? '')
      .then((ps) => {
        if (!alive) return;
        const node = ps.find((p) => p.kind === 'agency') ?? ps.find((p) => p.kind === 'group');
        setDest(node ? `/agencies/${encodeURIComponent(node.targetId)}` : '/dashboard');
      })
      .catch(() => { if (alive) setDest('/dashboard'); });
    return () => { alive = false; };
  }, [role, currentUserId]);
  if (!dest) return null;
  return <Navigate to={dest} replace />;
}
