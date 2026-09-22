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
  getApplications, ALL_PARTNERS,
} from '@/data';
import { channelOf, ROUTE_LABEL, type Channel } from '@/data/channel';
import { useSession } from '@/session/SessionContext';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Card, CardHead, CardBody } from '@/components/ui/Card';
import { Pill, type PillVariant } from '@/components/ui/Pill';
import { Icon } from '@/components/ui/Icon';
import { FinanceSurfaces } from './FinanceSurfaces';
import './Home.css';

const ROUTE_PILL: Record<Channel, PillVariant> = {
  'Direct': 'muted',
  'Agent referral': 'paid',
  'Partner referral': 'sent',
  'Provider hand-over': 'warn',
};
const initials = (n: string) => n.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

export function Home() {
  usePageMeta('home', 'Home', ['Home']);
  const { role, dataVersion } = useSession();
  const isOpndoorStaff = role === 'superadmin' || role === 'opndoor_manager';
  const scopeOpts = { role, scope: ALL_PARTNERS as string };

  const awaiting = awaitingDecisionCount();
  const recon = reconciliationPendingCount();
  const deliveryFailed = countByStatus(scopeOpts).deliveryFailed;

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
  // the Dev Centre; every other role lands on their book (Reporting).
  if (!isOpndoorStaff) return <Navigate to={role === 'developer' ? '/dev-centre' : '/dashboard'} replace />;

  const tiles = [
    { label: 'Awaiting decision', n: awaiting, meta: 'need an eligibility decision', to: '/applications?status=referencing', tone: 'warn' as const },
    { label: 'Agency matches', n: matches, meta: 'direct tenants, unmatched agent', to: '/reconciliation', tone: 'accent' as const },
    { label: 'Reconciliation', n: recon, meta: 'agencies/branches to review', to: '/reconciliation', tone: 'accent' as const },
    { label: 'Delivery failed', n: deliveryFailed, meta: 'deed not delivered', to: '/applications?deed=delivery-failed', tone: 'danger' as const },
  ];

  // Direct signups — tenants who came to Opndoor directly (route 'Direct', no
  // agency or supplier). They start at Awaiting decision, then Sent -> Paid -> Deed.
  // Each stage links to the applications list pre-filtered to Direct + that stage.
  const direct = countByStatus({ ...scopeOpts, channel: 'Direct' });
  const directStages = [
    { label: 'Awaiting decision', n: direct.referencing, to: '/applications?route=Direct&status=referencing' },
    { label: 'Sent', n: direct.sent, to: '/applications?route=Direct&status=sent' },
    { label: 'Paid', n: direct.paid, to: '/applications?route=Direct&status=paid' },
    { label: 'Deed issued', n: direct.deed, to: '/applications?route=Direct&status=deed' },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">Opndoor</div>
          <h1 className="page-head__title">Home</h1>
          <p className="page-head__sub">What needs a person today, across every route.</p>
        </div>
      </div>

      <div className="home-queues">
        {tiles.map((t) => (
          <Link key={t.label} to={t.to} className={`home-q home-q--${t.tone}${t.n > 0 ? '' : ' home-q--empty'}`}>
            <div className="home-q__label">{t.label}</div>
            <div className="home-q__n">{t.n}</div>
            <div className="home-q__meta">{t.meta}</div>
            <span className="home-q__go">Open <Icon name="arrowRight" size={13} /></span>
          </Link>
        ))}
      </div>

      {/* DIRECT SIGNUPS — the one route with no agency/supplier home of its own;
          its stages get a first-class panel here, each deep-linking to the list. */}
      <Card>
        <CardHead
          title="Direct signups"
          sub="Tenants who came to Opndoor directly — no agency or supplier — by stage."
          actions={<Link className="home-viewall" to="/applications?route=Direct">View all Direct <Icon name="arrowRight" size={13} /></Link>}
        />
        <CardBody>
          <div className="home-stages">
            {directStages.map((s) => (
              <Link key={s.label} to={s.to} className={`home-stage${s.n > 0 ? '' : ' home-stage--empty'}`}>
                <div className="home-stage__n">{s.n}</div>
                <div className="home-stage__l">{s.label}</div>
              </Link>
            ))}
          </div>
        </CardBody>
      </Card>

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
                  const ch = channelOf({ partnerSlug: r.partner, referencingMode: r.referencingMode });
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
                      <td className="soft">{r.branch}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {/* Finance lives on the ops Home (Operations stays one home): commission
          settlement + the underwriter bordereau, for opndoor admin. A partner
          still sees its own settlement on its own Reporting dashboard. */}
      {role === 'superadmin' && <FinanceSurfaces role={role} partnerScope={ALL_PARTNERS} />}
    </>
  );
}
