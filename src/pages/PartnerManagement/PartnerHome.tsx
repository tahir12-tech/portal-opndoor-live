/* =====================================================================
   PartnerHome — the first-class supplier (partner) screen. One partner, the
   whole thing in one place, the same shape as the agency page:

     · Structure    — its agencies and branches, as a tree
     · People        — its users (role, status, last active)
     · Commission    — its Opndoor / agent rates
     · API access    — whether API access is on, and how many keys are live

   opndoor admin only (the route sits in the superadmin guard group). A view:
   it reads the same services the Suppliers list does. Editing a partner's
   settings stays in the Manage modal on the Suppliers list, which this links to.

   NOTE on API keys: by deliberate security design an opndoor admin CANNOT read a
   partner's API keys (dev_api_keys returns zero rows for admin; a partner's own
   developer manages them in the Dev Centre). So this page shows only what an
   admin is entitled to: the API-access capability and the active-key COUNT
   (partner_active_key_count), never the keys themselves.
   ===================================================================== */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getPartner, getRatesFor, getAgencies, getUsers, partnerActiveKeyCount,
  REFERENCING_MODES, type Agency, type ManagedUser, type ReferencingMode,
} from '@/data';
import { useSession } from '@/session/SessionContext';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Card, CardHead, CardBody } from '@/components/ui/Card';
import { Pill, type PillVariant } from '@/components/ui/Pill';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { Tag } from '@/components/ui/Tag';
import { fmtRatePct } from '@/lib/format';
import { agencyKey } from '@/pages/Agencies/AgencyHome';
import './PartnerHome.css';

const STATUS_PILL: Record<string, [string, PillVariant]> = {
  active: ['Active', 'deed'],
  onboarding: ['Onboarding', 'warn'],
  paused: ['Paused', 'muted'],
};
const ROLE_LABEL: Record<string, string> = {
  superadmin: 'opndoor admin', opndoor_manager: 'opndoor management',
  management: 'Management', referrer: 'Referrer', developer: 'Developer',
};
const USER_STATUS_PILL: Record<string, PillVariant> = { active: 'deed', pending: 'warn', deactivated: 'muted' };
const initials = (n: string) => n.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
const modeLabel = (m: ReferencingMode | undefined) => REFERENCING_MODES.find((x) => x.id === m)?.label ?? 'Screened referral';

export function PartnerHome() {
  const { key } = useParams<{ key: string }>();
  const { role, dataVersion } = useSession();
  usePageMeta('partner-home', 'Supplier', ['Home', 'Relationships', 'Suppliers', 'Supplier']);

  const decoded = decodeURIComponent(key ?? '');
  const partner = getPartner(decoded);

  // Agencies + branches tree, and the partner's users. Both are synchronous reads
  // off the hydrated working copy (RLS already scoped them in live mode).
  const agencies = useMemo<Agency[]>(() => (partner ? getAgencies(partner.id) : []), [partner, dataVersion]);
  const users = useMemo<ManagedUser[]>(
    () => (partner ? getUsers({ viewer: role, team: false, scope: partner.id }) : []),
    [partner, role, dataVersion],
  );

  // Active API-key count is the ONE key signal an admin may read (a count, not the
  // keys). Best-effort: it needs live mode + MFA, so failures degrade to "unknown".
  const [keyCount, setKeyCount] = useState<number | null>(null);
  useEffect(() => {
    if (!partner || !partner.apiAccessEnabled) { setKeyCount(null); return; }
    let alive = true;
    partnerActiveKeyCount(partner.id)
      .then((n) => { if (alive) setKeyCount(n); })
      .catch(() => { if (alive) setKeyCount(null); });
    return () => { alive = false; };
  }, [partner, dataVersion]);

  // getPartner resolves house/plumbing partners too (opndoor-direct etc.), which
  // are never shown as suppliers (their name is an internal route label). Treat
  // them as not-found so this page never surfaces one.
  if (!partner || partner.isHouse) {
    return (
      <>
        <div className="page-head">
          <div>
            <div className="rec-eyebrow"><span className="opx">opndoor</span> · internal admin</div>
            <h1 className="page-head__title">Supplier not found</h1>
            <p className="page-head__sub">This partner is not in your view, or the link is out of date.</p>
          </div>
        </div>
        <Card><CardBody><Link className="ph-back" to="/partners"><Icon name="arrowLeft" size={14} /> Back to suppliers</Link></CardBody></Card>
      </>
    );
  }

  const rates = getRatesFor(partner.id);
  const branchCount = agencies.reduce((n, a) => n + (a.branches ? a.branches.length : 0), 0);
  const sp = STATUS_PILL[partner.status] || STATUS_PILL.active;

  const kpis = [
    // Drive the count from the same list the Users card renders (getUsers), not the
    // denormalized partner.users aggregate, so the KPI and the table always agree.
    { l: 'Users', v: String(users.length) },
    { l: 'Agencies', v: String(agencies.length) },
    { l: 'Branches', v: String(branchCount) },
    { l: 'Applications', v: partner.apps.toLocaleString('en-GB') },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <Link className="ph-back" to="/partners"><Icon name="arrowLeft" size={14} /> Suppliers</Link>
          <h1 className="page-head__title" style={{ marginTop: 8 }}>
            {partner.name}{partner.primary && <> <Tag variant="primary">Primary</Tag></>}
          </h1>
          <p className="page-head__sub ph-sub">
            <Pill variant={sp[1]}>{sp[0]}</Pill>
            <span>Live from {partner.since || '—'}</span>
            <span><Icon name="reconcile" size={14} /> {modeLabel(partner.referencingMode)}</span>
          </p>
        </div>
        <div className="page-head__actions">
          <Button variant="dark" size="sm" to={`/applications?partner=${encodeURIComponent(partner.id)}`}>
            <Icon name="apps" /> All applications
          </Button>
        </div>
      </div>

      <div className="ph-kpis">
        {kpis.map((k) => (
          <div key={k.l} className="ph-kpi">
            <div className="ph-kpi__v">{k.v}</div>
            <div className="ph-kpi__l">{k.l}</div>
          </div>
        ))}
      </div>

      <div className="ph-grid">
        {/* COMMISSION */}
        <Card>
          <CardHead title="Commission" sub="Per-partner rates, snapshotted onto each referral at creation." />
          <CardBody>
            <div className="ph-rates">
              <div className="ph-rate">
                <div className="ph-rate__v">{fmtRatePct(rates.partner)}</div>
                <div className="ph-rate__l">Supplier commission</div>
              </div>
              <div className="ph-rate">
                <div className="ph-rate__v">{fmtRatePct(rates.agent)}</div>
                <div className="ph-rate__l">Agent rate</div>
              </div>
            </div>
            <p className="ph-note muted">Edit rates and settings from <b>Manage</b> on the <Link to="/partners">Suppliers</Link> list.</p>
          </CardBody>
        </Card>

        {/* API ACCESS & SANDBOX */}
        <Card>
          <CardHead title="API access" sub="Whether this partner can use the partner API, and how many keys are live." />
          <CardBody>
            <div className="ph-caps">
              <div className="ph-cap">
                <span className={`ph-dot ph-dot--${partner.apiAccessEnabled ? 'on' : 'off'}`} />
                <span>API access <b>{partner.apiAccessEnabled ? 'enabled' : 'disabled'}</b></span>
              </div>
              <div className="ph-cap">
                <span className={`ph-dot ph-dot--${partner.portalReferralsEnabled !== false ? 'on' : 'off'}`} />
                <span>Portal referrals <b>{partner.portalReferralsEnabled !== false ? 'enabled' : 'disabled'}</b></span>
              </div>
              {partner.apiAccessEnabled && (
                <div className="ph-cap">
                  <Icon name="lock" size={14} />
                  <span>Active API keys: <b>{keyCount == null ? '—' : keyCount}</b></span>
                </div>
              )}
            </div>
            <p className="ph-note muted">
              {partner.apiAccessEnabled
                ? 'Keys and sandbox data are managed by the partner’s own developer in the Dev Centre. For security, opndoor admin can see that keys exist, but never the keys themselves.'
                : 'This partner cannot hold API keys. Enable API access from Manage on the Suppliers list first.'}
            </p>
          </CardBody>
        </Card>
      </div>

      {/* STRUCTURE — agencies + branches tree */}
      <Card>
        <CardHead
          title="Structure"
          sub={`${agencies.length} ${agencies.length === 1 ? 'agency' : 'agencies'} · ${branchCount} ${branchCount === 1 ? 'branch' : 'branches'}`}
        />
        <CardBody style={{ padding: agencies.length === 0 ? undefined : 0 }}>
          {agencies.length === 0 ? (
            <div className="ph-empty">No agencies under this partner.</div>
          ) : (
            <div className="ph-tree">
              {agencies.map((a) => (
                <div className="ph-tree__agency" key={agencyKey(a)}>
                  <div className="ph-tree__arow">
                    <span className="ph-tree__ic"><Icon name="org" size={16} /></span>
                    <Link className="ph-tree__name" to={`/agencies/${encodeURIComponent(agencyKey(a))}`}>{a.name}</Link>
                    {a.unreviewed && <span className="ph-tag">unreviewed</span>}
                    <span className="ph-tree__meta">{a.branches.length} {a.branches.length === 1 ? 'branch' : 'branches'} · {a.referrals} referrals</span>
                  </div>
                  {a.branches.length > 0 && (
                    <div className="ph-tree__branches">
                      {a.branches.map((b) => (
                        <div className="ph-tree__branch" key={b.id ?? b.name}>
                          <span className="ph-tree__bic"><Icon name="home" size={13} /></span>
                          <Link className="ph-tree__bname" to={`/applications?branch=${encodeURIComponent(b.name)}`}>{b.name}</Link>
                          {b.area && <span className="ph-tree__barea">{b.area}</span>}
                          {b.unreviewed && <span className="ph-tag">unreviewed</span>}
                          <span className="ph-tree__meta">{b.referrals} referrals</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* PEOPLE — the partner's users */}
      <Card>
        <CardHead
          title="Users"
          sub={`${users.length} ${users.length === 1 ? 'person' : 'people'}`}
          actions={<Link className="ph-viewall" to={`/users?partner=${encodeURIComponent(partner.id)}`}>Manage users <Icon name="arrowRight" size={13} /></Link>}
        />
        <CardBody style={{ padding: users.length === 0 ? undefined : 0 }}>
          {users.length === 0 ? (
            <div className="ph-empty">No users for this partner.</div>
          ) : (
            <table className="dt ph-table">
              <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Last active</th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <span className="ph-user">
                        <span className="who__av">{initials(u.name || u.email)}</span>
                        <span><span className="dt__name">{u.name || u.email}</span><span className="dt__sub">{u.email}</span></span>
                      </span>
                    </td>
                    <td>{ROLE_LABEL[u.role] ?? u.role}</td>
                    <td><Pill variant={USER_STATUS_PILL[u.status] ?? 'muted'}>{u.status}</Pill></td>
                    <td className="soft">{u.lastActive}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </>
  );
}
