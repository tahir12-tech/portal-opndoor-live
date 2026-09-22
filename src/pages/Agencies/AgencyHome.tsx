/* =====================================================================
   AgencyHome — the first-class agency screen. One agency, four dimensions
   consolidated from the Agencies management list into a single home:

     · Structure   — its supplier partner, its group, its branches
     · People       — every agent contact, with position, at agency and branch level
     · Commission   — the resolved Opndoor / agent rates and where each resolves from
     · Referrals    — recent applications for this agency, route-badged

   A view: it reads the same services the Agencies list does. Editing (contacts,
   commission, group, add branch) stays on the Agencies list, which this page
   links back to; the value here is seeing the whole agency in one place.
   ===================================================================== */
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getAgencies, getGroup, getRatesFor, getApplications, partnerName, fmtBig, ALL_PARTNERS,
  effectiveContacts, type Agency, type Branch, type AgentContact,
} from '@/data';
import { channelOf, ROUTE_LABEL, type Channel } from '@/data/channel';
import { useSession } from '@/session/SessionContext';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Card, CardHead, CardBody } from '@/components/ui/Card';
import { Pill, type PillVariant } from '@/components/ui/Pill';
import { Icon } from '@/components/ui/Icon';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Button } from '@/components/ui/Button';
import { fmtRatePct } from '@/lib/format';
import './AgencyHome.css';

const ROUTE_PILL: Record<Channel, PillVariant> = {
  'Direct': 'muted',
  'Agent referral': 'paid',
  'Partner referral': 'sent',
  'Provider hand-over': 'warn',
};
const initials = (n: string) => n.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
// A route key that works in both live mode (row id) and mock/test mode (name).
export const agencyKey = (a: Agency): string => a.id ?? a.name;
const money = (n?: number) => (n && n > 0 ? fmtBig(n) : '£0');

/** One contact line: name (or email), position, and the reachable channels. */
function ContactCard({ c }: { c: AgentContact }) {
  const hasName = c.name && c.name.trim() && c.name.trim().toLowerCase() !== c.email.trim().toLowerCase();
  return (
    <div className="ah-person">
      <span className="ah-person__av">{initials(hasName ? c.name : c.email)}</span>
      <div className="ah-person__body">
        <div className="ah-person__top">
          <span className="ah-person__name">{hasName ? c.name : c.email}</span>
          {c.role && <span className="ah-person__role">{c.role}</span>}
          {c.primary && <Pill variant="paid">Primary</Pill>}
        </div>
        <div className="ah-person__contact">
          {hasName && <span><Icon name="mail" size={13} /> {c.email}</span>}
          {c.phone && <span><Icon name="phone" size={13} /> {c.phone}</span>}
          {!hasName && !c.phone && <span className="muted">{c.email}</span>}
        </div>
      </div>
    </div>
  );
}

export function AgencyHome() {
  const { key } = useParams<{ key: string }>();
  const { role, partnerScope, dataVersion } = useSession();
  usePageMeta('agency-home', 'Agency', ['Home', 'Relationships', 'Agencies', 'Agency']);

  const decoded = decodeURIComponent(key ?? '');
  // A superadmin resolves agencies across every partner, not through a narrowed
  // "viewing as" scope — otherwise an agency reached from a supplier's page (which
  // ignores scope) would dead-end here when the selected scope is a different
  // partner. RLS still bounds a real partner user server-side.
  const scope = role === 'superadmin' ? ALL_PARTNERS : partnerScope;
  const agency = useMemo(
    () => getAgencies(scope).find((a) => agencyKey(a) === decoded),
    [scope, decoded, dataVersion],
  );

  // Referrals for this agency, route-badged. Scoped to the viewer (RLS in live mode).
  const referrals = useMemo(
    () => (agency ? getApplications({ role, scope, agency: agency.name }) : []),
    [agency, role, scope, dataVersion],
  );

  if (!agency) {
    return (
      <>
        <div className="page-head">
          <div>
            <div className="page-head__eyebrow">Agencies</div>
            <h1 className="page-head__title">Agency not found</h1>
            <p className="page-head__sub">This agency is not in your view, or the link is out of date.</p>
          </div>
        </div>
        <Card><CardBody><Link className="ah-back" to="/agencies"><Icon name="arrowLeft" size={14} /> Back to agencies</Link></CardBody></Card>
      </>
    );
  }

  // Commission resolves group → agency → partner default (matches resolve_rates and
  // the Agencies list's commission editor).
  const grp = agency.groupId ? getGroup(agency.groupId) : undefined;
  const base = getRatesFor(agency.partner);
  const resolvedPartner = grp?.partnerRate ?? agency.partnerRate ?? base.partner;
  const resolvedAgent = grp?.agentRate ?? agency.agentRate ?? base.agent;
  const partnerSource = grp?.partnerRate != null ? `Group “${grp.name}”` : agency.partnerRate != null ? 'This agency' : 'Partner default';
  const agentSource = grp?.agentRate != null ? `Group “${grp.name}”` : agency.agentRate != null ? 'This agency' : 'Partner default';

  const groupLabel = grp?.name ?? agency.group;
  const recent = referrals.slice(0, 10);

  const kpis = [
    { l: 'Branches', v: String(agency.branches.length) },
    { l: 'Referrals', v: String(agency.referrals) },
    { l: 'Fees collected', v: money(agency.fees) },
    { l: 'Guaranteed', v: agency.guaranteed || '£0' },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <Link className="ah-back" to="/agencies"><Icon name="arrowLeft" size={14} /> Agencies</Link>
          <h1 className="page-head__title" style={{ marginTop: 8 }}>{agency.name}</h1>
          <p className="page-head__sub ah-sub">
            <span><Icon name="partners" size={14} /> {partnerName(agency.partner)}</span>
            {groupLabel && <span><Icon name="org" size={14} /> {groupLabel}</span>}
            <span>{agency.branches.length} {agency.branches.length === 1 ? 'branch' : 'branches'}</span>
          </p>
        </div>
        <div className="page-head__actions">
          <Button variant="dark" size="sm" to={`/applications?agency=${encodeURIComponent(agency.name)}`}>
            <Icon name="apps" /> All referrals
          </Button>
        </div>
      </div>

      <div className="ah-kpis">
        {kpis.map((k) => (
          <div key={k.l} className="ah-kpi">
            <div className="ah-kpi__v">{k.v}</div>
            <div className="ah-kpi__l">{k.l}</div>
          </div>
        ))}
      </div>

      <div className="ah-grid">
        {/* COMMISSION */}
        <Card>
          <CardHead title="Commission" sub="Resolves group → agency → partner default. Snapshotted onto each referral at creation." />
          <CardBody>
            <div className="ah-rates">
              <div className="ah-rate">
                <div className="ah-rate__v">{fmtRatePct(resolvedPartner)}</div>
                <div className="ah-rate__l">Opndoor rate</div>
                <div className="ah-rate__src">{partnerSource}</div>
              </div>
              <div className="ah-rate">
                <div className="ah-rate__v">{fmtRatePct(resolvedAgent)}</div>
                <div className="ah-rate__l">Agent rate</div>
                <div className="ah-rate__src">{agentSource}</div>
              </div>
            </div>
            {(agency.partnerRate != null || agency.agentRate != null || grp) && (
              <p className="ah-note">
                {grp && <>In group <b>{grp.name}</b>. </>}
                {agency.partnerRate != null || agency.agentRate != null
                  ? <>This agency sets its own {agency.partnerRate != null ? 'Opndoor' : ''}{agency.partnerRate != null && agency.agentRate != null ? ' and ' : ''}{agency.agentRate != null ? 'agent' : ''} rate; anything unset inherits the tier above.</>
                  : <>No agency-level override — it inherits {grp ? 'its group' : 'the partner default'}.</>}
              </p>
            )}
            {role === 'superadmin' && (
              <p className="ah-note muted">Edit rates and group on the <Link to="/agencies">Agencies</Link> screen.</p>
            )}
          </CardBody>
        </Card>

        {/* STRUCTURE — branches */}
        <Card>
          <CardHead title="Structure" sub={`${agency.branches.length} ${agency.branches.length === 1 ? 'branch' : 'branches'}${groupLabel ? ` · group ${groupLabel}` : ''}`} />
          <CardBody style={{ padding: 0 }}>
            {agency.branches.length === 0 ? (
              <div className="ah-empty">No branches yet.</div>
            ) : (
              <table className="dt ah-table">
                <thead><tr><th>Branch</th><th>Area</th><th className="num">Referrals</th><th className="num">Fees</th></tr></thead>
                <tbody>
                  {agency.branches.map((b: Branch) => (
                    <tr key={b.id ?? b.name}>
                      <td><Link className="ah-branchlink" to={`/applications?branch=${encodeURIComponent(b.name)}`}>{b.name}{b.unreviewed && <span className="ah-tag">unreviewed</span>}</Link></td>
                      <td className="soft">{b.area || '—'}</td>
                      <td className="num">{b.referrals}</td>
                      <td className="num">{money(b.fees)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      </div>

      {/* PEOPLE — every contact, with position, at agency and branch level */}
      <Card>
        <CardHead title="People" sub="Agent contacts and their positions. The primary contact is who the Deed of Guarantee is sent to." />
        <CardBody>
          <div className="ah-people-block">
            <div className="ah-people-head"><Eyebrow>Agency contacts</Eyebrow></div>
            {agency.contacts && agency.contacts.length > 0 ? (
              <div className="ah-people">{agency.contacts.map((c, i) => <ContactCard key={c.id ?? `${c.email}-${i}`} c={c} />)}</div>
            ) : (
              <div className="ah-contact-warn"><Icon name="alert" size={14} /> No agency contact. Branches with no contact of their own cannot have a deed issued.</div>
            )}
          </div>

          {agency.branches.map((b) => {
            const eff = effectiveContacts(agency, b);
            return (
              <div className="ah-people-block" key={`ppl-${b.id ?? b.name}`}>
                <div className="ah-people-head">
                  <Eyebrow>{b.name}</Eyebrow>
                  {eff.inherited && <span className="ah-inherit">inherits agency default</span>}
                </div>
                {eff.list.length > 0 ? (
                  <div className="ah-people">{eff.list.map((c, i) => <ContactCard key={c.id ?? `${c.email}-${i}`} c={c} />)}</div>
                ) : (
                  <div className="ah-contact-warn"><Icon name="alert" size={14} /> No contact resolves for this branch. A deed cannot be issued.</div>
                )}
              </div>
            );
          })}
        </CardBody>
      </Card>

      {/* REFERRALS */}
      <Card>
        <CardHead
          title="Referrals"
          sub={`${referrals.length} across every route`}
          actions={<Link className="ah-viewall" to={`/applications?agency=${encodeURIComponent(agency.name)}`}>View all <Icon name="arrowRight" size={13} /></Link>}
        />
        <CardBody style={{ padding: 0 }}>
          {recent.length === 0 ? (
            <div className="ah-empty">No referrals for this agency yet.</div>
          ) : (
            <table className="dt ah-table">
              <thead><tr><th>Route</th><th>Tenant</th><th>Property</th><th>Branch</th><th>Status</th></tr></thead>
              <tbody>
                {recent.map((r) => {
                  const ch = channelOf({ partnerSlug: r.partner, referencingMode: r.referencingMode });
                  return (
                    <tr key={r.ref}>
                      <td><Pill variant={ROUTE_PILL[ch]}>{ROUTE_LABEL[ch]}</Pill></td>
                      <td>
                        <Link className="ah-tenant" to={`/applications/${encodeURIComponent(r.ref)}`}>
                          <span className="who__av">{initials(r.tenant)}</span>
                          <span><span className="dt__name">{r.tenant}</span><span className="dt__sub">{r.ref}</span></span>
                        </Link>
                      </td>
                      <td>{r.prop}</td>
                      <td className="soft">{r.branch}</td>
                      <td><span className="ah-status">{r.status}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </>
  );
}
