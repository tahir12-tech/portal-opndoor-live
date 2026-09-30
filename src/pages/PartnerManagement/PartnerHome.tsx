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
  ALL_PARTNERS, getPartner, getPeriods, getRatesFor, getAgencies, getUsers, maySeeCommission,
  partnerActiveKeyCount, REFERENCING_MODES, type Agency, type ManagedUser, type ReferencingMode,
} from '@/data';
// Walk fix 15: this customer's report, on this customer's page.
import { liveByCustomer } from '@/data/liveAnalytics';
import { CustomerReport } from '@/components/CustomerReport';
import { useSession } from '@/session/SessionContext';
import { usePageMeta } from '@/components/layout/pageMeta';
import { getApplications } from '@/data/applicationsService';
import { effectivePrimary } from '@/data/orgService';
import type { Status, Branch } from '@/data';

/* The same words the agency page and the applications list use. Copied
   rather than imported because AgencyHome does not export them; lifting them
   is the next thing to do here and is noted in QUEUE.md rather than done
   mid-tab. */
/** The agent contact a deed would actually reach, said plainly. */
function ContactLine({ agency, branch }: { agency: Agency; branch?: Branch }) {
  const { contact, inherited } = effectivePrimary(agency, branch ?? null);
  if (!contact) {
    return <span className="ph-contact ph-contact--none" title="An executed deed has nowhere to go until this is set.">No agent contact</span>;
  }
  return (
    <span className="ph-contact" title={inherited ? "Inherited from the agency" : undefined}>
      <Icon name="send" size={12} /> {contact.email}{inherited && <span className="ph-contact__inh">agency</span>}
    </span>
  );
}

const PH_STATUS_LABEL: Record<Status, string> = {
  draft: 'In progress', referencing: 'Referencing', declined: 'Declined', sent: 'Sent',
  paid: 'Paid', deed: 'Deed issued', withdrawn: 'Withdrawn', expired: 'Expired',
};
const PH_STATUS_ST: Partial<Record<Status, string>> = {
  referencing: 'st-wait', sent: 'st-live', paid: 'st-live', deed: 'st-ok',
};
import { PageTabs } from '@/components/ui/PageTabs';
import { PersonActions } from '@/components/people/PersonActions';
import { useToast } from '@/components/ui/Toast';
import { cancelInvite, resendInvite, resetUserMfa, resetUserPassword, setUserStatus } from '@/data/usersService';
import { Card, CardHead, CardBody } from '@/components/ui/Card';
import { Pill, type PillVariant } from '@/components/ui/Pill';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { Tag } from '@/components/ui/Tag';
import { fmtRatePct } from '@/lib/format';
import { agencyKey } from '@/pages/Agencies/AgencyHome';
import { PersonNotifications } from '@/components/people/PersonNotifications';
import { StatementRecipients } from '@/components/StatementRecipients';
import { ViewAsButton } from '@/components/ViewAsButton';
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
  const referrals = useMemo(
    () => (partner ? getApplications({ role, scope: partner.id }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [partner, role, dataVersion],
  );
  const [keyCount, setKeyCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notifFor, setNotifFor] = useState<{ id: string; name: string } | null>(null);
  /* WALK FIX 15. This supplier's own numbers, from the same function the
     estate-wide table uses, so the two cannot disagree about them. Its own
     period state: the report is read here and the choice belongs to this
     page, not to Reporting's remembered one. */
  const reportPeriods = getPeriods();
  const [reportPeriod, setReportPeriod] = useState(
    () => reportPeriods.find((p) => p.id === 'last12m') ?? reportPeriods[reportPeriods.length - 1],
  );
  const customerRows = useMemo(
    () => (partner
      ? liveByCustomer(role, ALL_PARTNERS, reportPeriod).filter((r) => r.key === `partner:${partner.id}`)
      : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [role, reportPeriod, partner, dataVersion],
  );
  const toast = useToast();
  const isAdmin = role === 'superadmin';

  /* ONE HANDLER FOR THE ROW ACTIONS. Each is a single call into usersService
     and each reports the same way, so they share a body rather than growing
     six copies of try/catch/toast -- which is how the two action sets
     already in the product came to disagree about confirmation. */
  const runPerson = async (what: string, userId: string, who: string) => {
    if (busy) return;
    setBusy(true);
    try {
      if (what === 'resend') { await resendInvite(userId); toast(`Invitation resent to ${who}.`); }
      else if (what === 'cancel') { await cancelInvite(userId); toast(`Invitation to ${who} cancelled.`); }
      else if (what === 'password') { await resetUserPassword(userId); toast(`Password reset link sent to ${who}.`); }
      else if (what === 'mfa') { await resetUserMfa(userId); toast(`${who} will set up two-factor again at next sign-in.`); }
      else if (what === 'remove') { await setUserStatus(userId, 'deactivated'); toast(`${who} no longer has access.`); }
      else if (what === 'restore') { await setUserStatus(userId, 'active'); toast(`${who} has access again.`); }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Something went wrong.', 'error');
    } finally { setBusy(false); }
  };
  /* FIVE TABS, the same five the agency page has. Q-06 item A: "Supplier
     detail page mirrors the agency page ... Regent's agency page is the
     template." The page was four flat cards in document order, so a reader
     scrolled past the commission rates to reach the people. */
  type Tab = 'overview' | 'people' | 'reporting' | 'commission' | 'referrals' | 'integration';
  const [tab, setTab] = useState<Tab>('overview');
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
            <span>Live from {partner.since || '-'}</span>
            <span><Icon name="reconcile" size={14} /> {modeLabel(partner.referencingMode)}</span>
          </p>
        </div>
        <div className="page-head__actions">
          {/* NM-M. On the supplier rail the partner IS the boundary, so the
              selection is the slug and needs no name lookup. */}
          <ViewAsButton scope={`partner:${partner.id}`} />
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

      <PageTabs<Tab>
        ariaLabel="Supplier sections"
        value={tab}
        onChange={setTab}
        tabs={[
          ['overview', 'Overview'], ['people', 'People'],
          /* WALK FIX 15: the report for this customer, on this customer's
             own page. This whole route is superadmin-only, so there is no
             role gate to add here. */
          ['reporting', 'Reporting'],
          ['commission', 'Commission'],
          ['referrals', 'Referrals'], ['integration', 'Integration'],
        ]}
      />

      {tab === 'reporting' && (
        <CustomerReport
          rows={customerRows}
          seesCommission={maySeeCommission(role)}
          periodId={reportPeriod.id}
          periods={reportPeriods.map((p) => ({ value: p.id, label: p.label }))}
          onPeriod={(id) => setReportPeriod(reportPeriods.find((p) => p.id === id) ?? reportPeriod)}
          emptyText={`No referrals from ${partner?.name ?? 'this supplier'} in this period.`}
        />
      )}

      {tab === 'commission' && (
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

        {/* WHO THE MONTHLY STATEMENT GOES TO. On the Commission tab because
            the statement IS the commission, and this is the only screen in
            the product where a supplier's named addresses can be set. Admin
            only here; the RPCs behind it are guarded regardless. */}
        {isAdmin && <StatementRecipients partnerKey={partner.dbId ?? partner.id} supplierName={partner.name} />}

      </div>
      )}

      {tab === 'integration' && (
      <div className="ph-grid">
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
                  <span>Active API keys: <b>{keyCount == null ? '-' : keyCount}</b></span>
                </div>
              )}
            </div>
            <p className="ph-note muted">
              {partner.apiAccessEnabled
                ? 'Keys and sandbox data are managed by the partner’s own developer in the Dev Centre. For security, opndoor admin can see that keys exist, but never the keys themselves.'
                : 'This partner cannot hold API keys. Enable API access on this tab first.'}
            </p>
          </CardBody>
        </Card>
      </div>
      )}

      {tab === 'overview' && (<>
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
                  {/* WHO THE DEED GOES TO. Q-06 item A asks the Overview to
                      show "agent contacts and deed recipients". On the
                      supplier rail those are the same thing: there are no
                      positions here, so the deed goes to the branch's agent
                      contact, inheriting the agency's where the branch has
                      none. A supplier agency with no contact anywhere has
                      nowhere to send an executed deed, and the page said
                      nothing about it. */}
                  <ContactLine agency={a} />
                  {a.branches.length > 0 && (
                    <div className="ph-tree__branches">
                      {a.branches.map((b) => (
                        <div className="ph-tree__branch" key={b.id ?? b.name}>
                          <span className="ph-tree__bic"><Icon name="home" size={13} /></span>
                          <Link className="ph-tree__bname" to={`/applications?branch=${encodeURIComponent(b.name)}`}>{b.name}</Link>
                          {b.area && <span className="ph-tree__barea">{b.area}</span>}
                          {b.unreviewed && <span className="ph-tag">unreviewed</span>}
                          <span className="ph-tree__meta">{b.referrals} referrals</span>
                          <ContactLine agency={a} branch={b} />
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

      </>)}

      {/* REFERRALS. There was no referrals tab at all: the only way to a
          supplier's own book was the header button that navigates away to
          the applications list with a partner filter. That is still there
          and is still the right thing for the full list; this is the recent
          slice, in place, which is what the agency page gives. */}
      {tab === 'referrals' && (
        <Card>
          <CardHead
            title="Referrals"
            sub={`The most recent ${Math.min(referrals.length, 25)} of ${referrals.length}.`}
            actions={<Button variant="quiet" size="sm" to={`/applications?partner=${encodeURIComponent(partner.id)}`}>All applications</Button>}
          />
          <CardBody>
            {referrals.length === 0 ? (
              <p className="soft">No referrals from this supplier yet.</p>
            ) : (
              <table className="dt">
                <thead>
                  <tr><th>Reference</th><th>Tenant</th><th>Property</th><th>Status</th><th>Date</th></tr>
                </thead>
                <tbody>
                  {referrals.slice(0, 25).map((r) => (
                    <tr key={r.ref}>
                      <td><Link to={`/applications/${encodeURIComponent(r.ref)}`}>{r.ref}</Link></td>
                      <td>{r.tenant}</td>
                      <td className="soft">{r.prop}</td>
                      <td><span className={`ph-st ${PH_STATUS_ST[r.status] ?? 'st-neutral'}`}>{PH_STATUS_LABEL[r.status]}</span></td>
                      <td className="soft">{r.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      )}

      {tab === 'people' && (<>
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
              <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Last active</th>{isAdmin && <th />}</tr></thead>
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
                    {/* THE SAME ROW ACTIONS THE AGENCY PAGE HAS. Q-06 item A:
                        "their staff with the same row actions". The table was
                        read-only, so an admin looking at a supplier had to
                        leave for /users to resend an invitation. Position is
                        suppressed because positions are an agency-estate
                        thing and this rail has none; the level button says
                        "Change role" for the same reason (D11). */}
                    {isAdmin && (
                      <td style={{ textAlign: 'right' }}>
                        <PersonActions
                          person={{ userId: u.id, name: u.name, email: u.email, status: u.status, agencyLevel: ROLE_LABEL[u.role] ?? u.role }}
                          isAdmin
                          manyOffices={false}
                          changeLevelLabel="Change role"
                          onAction={(what, userId, who) => void runPerson(what, userId, who)}
                          onCancelInvite={(userId, who) => void runPerson('cancel', userId, who)}
                          onChangeLevel={() => toast('Change a supplier user\u2019s role from Users.')}
                          onPosition={() => {}}
                          onNotifications={setNotifFor}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
      {/* The "Who is told what" grid stood here, one set of switches for the
          whole supplier. Settings are per person now, on each person's row
          above, so there is nothing party-wide left to draw.

          ONE THING THIS RAIL STILL CANNOT DO PER PERSON: the branch agent
          contact is a contact record with no user row behind it, so it has no
          per-person settings to hold. Its deliveries are unchanged. B3. */}
      </>)}
      {notifFor && (
        <PersonNotifications
          userId={notifFor.id}
          personName={notifFor.name}
          onClose={() => setNotifFor(null)}
        />
      )}
    </>
  );
}
