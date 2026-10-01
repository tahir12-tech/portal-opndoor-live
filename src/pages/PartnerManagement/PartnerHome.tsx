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
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ALL_PARTNERS, getPartner, getPeriods, getRatesFor, getAgencies, getUsers, maySeeCommission,
  statementMonths,
  REFERENCING_MODES, type Agency, type ManagedUser, type ReferencingMode, type Role,
} from '@/data';
// Walk fix 15: this customer's report, on this customer's page.
import { liveByCustomer } from '@/data/liveAnalytics';
import { CustomerReport } from '@/components/CustomerReport';
import { SupplierStatements } from '@/components/SupplierStatements';
import { SupplierSettings } from './SupplierSettings';
import { ApiAccessSwitch } from './ApiAccessSwitch';
import { SupplierDeals } from './SupplierDeals';
import { SupplierInvite } from './SupplierInvite';
import { SupplierRoleDialog } from './SupplierRoleDialog';
/* THE DEV CENTRE'S OWN PANELS, read-only. Matt, 2026-10-01: "read-only
   for Opndoor admin: their sandbox activity (sandbox applications and
   their status), recent API requests and errors, and webhook delivery
   history, same data as their Dev Centre."

   "SAME DATA" IS LITERAL HERE: these are the Dev Centre's components
   with their actions taken away, not three new readers of the same
   tables. A second implementation is how the two screens come to
   disagree about what a partner's traffic looked like. */
import { Sandbox } from '@/pages/DevCentre/Sandbox';
import { Logs } from '@/pages/DevCentre/Logs';
import { WebhookHistory } from '@/pages/DevCentre/WebhookHistory';
import '@/pages/DevCentre/DevCentre.css';
import { useSession } from '@/session/SessionContext';
import { usePageMeta } from '@/components/layout/pageMeta';
import { getApplications } from '@/data/applicationsService';
import { effectivePrimary } from '@/data/orgService';
import { DEVELOPER_SEES } from '@/data/positionsService';
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

/* ===========================================================================
   THE AGENCY ROW'S CONTACT, WHICH IS A DIFFERENT QUESTION FROM A BRANCH'S.

   Matt, 2026-10-01: "Supplier Overview: don't show 'No agent contact' on an
   agency when its branches have contacts; only warn where a branch would
   actually have nowhere to send the deed."

   The agency row ran the same `ContactLine` as the branch rows, which asks
   "does THIS node have a contact". For an agency that keeps its contacts on
   the branches -- the normal arrangement, and the one the inheritance exists
   to support -- the answer is no, so the row cried "No agent contact" with a
   working email printed under it on every branch. A warning that is wrong
   whenever the data is organised the usual way is a warning people learn to
   scroll past, which costs the ones that are real.

   What the row should answer is "would any deed under this agency have
   nowhere to go". That is the union of the branches, not the agency node:

     a contact of its own    show it. Every branch inherits it.
     none, branches all      say nothing. Each branch prints its own below,
     covered                 and repeating them at the agency is noise.
     none, some branch bare  warn, and COUNT them, because the point of the
                             warning is to send somebody to fix those.
     none, no branches       warn. There is nothing underneath to cover it.
   =========================================================================== */
function AgencyContactLine({ agency }: { agency: Agency }) {
  const own = effectivePrimary(agency, null);
  if (own.contact) return <ContactLine agency={agency} />;

  const branches = agency.branches ?? [];
  if (branches.length === 0) return <ContactLine agency={agency} />;

  const bare = branches.filter((b) => !effectivePrimary(agency, b).contact);
  if (bare.length === 0) {
    return (
      <span className="ph-contact ph-contact--perbranch" title="Each branch below has its own agent contact.">
        <Icon name="send" size={12} /> Contacts are set per branch
      </span>
    );
  }
  return (
    <span
      className="ph-contact ph-contact--none"
      title="An executed deed for these branches has nowhere to go until a contact is set."
    >
      No agent contact on {bare.length} of {branches.length} {plural(branches.length, 'branch')}
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
import { agencyKey } from '@/pages/Agencies/AgencyHome';
import { PersonNotifications } from '@/components/people/PersonNotifications';
import { StatementRecipients } from '@/components/StatementRecipients';
import { ViewAsButton } from '@/components/ViewAsButton';
import './PartnerHome.css';
import { plural, countOf } from '@/lib/plural';
import { formatDate, formatMonth } from '@/lib/format';

const STATUS_PILL: Record<string, [string, PillVariant]> = {
  active: ['Active', 'deed'],
  onboarding: ['Onboarding', 'warn'],
  paused: ['Paused', 'muted'],
};
const ROLE_LABEL: Record<string, string> = {
  superadmin: 'opndoor admin', opndoor_manager: 'opndoor management',
  management: 'Management', referrer: 'Referrer', developer: 'Developer',
};
/* WHAT A SUPPLIER'S PERSON SEES. Matt, 2026-10-01: "On supplier people
   lists, show supplier levels (Management, Referrer), and Management
   sees 'Everything' not 'Own referrals'."

   WHY IT IS NOT describePosition(). That function answers the AGENCY
   rail's question, by reading the group / agency / branch ladder, and a
   supplier's staff hold no position on that ladder at all -- there is no
   group above them and no branch below. It therefore fell through to its
   last line and told a supplier's Management user they could see "Own
   referrals", which is the opposite of true: on the supplier rail the
   partner IS the company boundary, and their Management sees the whole
   of it.

   THREE ROLES, NOT TWO. A supplier with API access also has Developers,
   and they fell through to the '-' that meant "none of the above" --
   which reads as "sees nothing" for somebody who reads the whole
   supplier's book. Matt, 2026-10-01. The sentence comes from
   positionsService so this list and /users cannot word it differently;
   the dash stays for a role genuinely outside the three. */
const supplierSees = (role: string): string =>
  (role === 'management' ? 'Everything'
    : role === 'referrer' ? 'Own referrals'
    : role === 'developer' ? DEVELOPER_SEES
    : '-');

/* THE SAME WORDS TEAM USES. Matt, 2026-10-01: 'People: show status as
   "Active", capitalised, like elsewhere.' This printed `u.status`, the stored
   value, so the supplier's People tab read "active" and "pending" in a column
   that reads "Active" and "Invited" on every other people list -- and
   "pending" is not even the word, since what is pending is an invitation.
   Label and pill colour together, as Team has them. */
const USER_STATUS_PILL: Record<string, [string, PillVariant]> = {
  active: ['Active', 'deed'],
  pending: ['Invited', 'warn'],
  deactivated: ['Deactivated', 'muted'],
};
const initials = (n: string) => n.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
const modeLabel = (m: ReferencingMode | undefined) => REFERENCING_MODES.find((x) => x.id === m)?.label ?? 'Screened referral';

export function PartnerHome() {
  const { key } = useParams<{ key: string }>();
  const { role, dataVersion, refresh } = useSession();
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
  const [busy, setBusy] = useState(false);
  const [roleFor, setRoleFor] = useState<{ userId: string; name: string; current: Role } | null>(null);
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
      /* THE RESET AND THE EMAIL ARE TWO FACTS, and the toast says both.
         The reset is irreversible by the time the send is attempted, so a
         failed email must not read as a failed reset -- an administrator
         who presses the button again on that reading achieves nothing and
         signs the person out twice. */
      else if (what === 'mfa') {
        const r = await resetUserMfa(userId);
        toast(r.emailed
          ? `Two-factor reset for ${who}, and they have been emailed.`
          : `Two-factor reset for ${who}. We could not email them, so tell them to delete the old opndoor entry from their authenticator before scanning the new code.`,
          r.emailed ? undefined : 'error');
      }
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
  type Tab = 'overview' | 'people' | 'settings' | 'reporting' | 'commission' | 'referrals' | 'integration';
  const [tab, setTab] = useState<Tab>('overview');
  /* THE KEY COUNT MOVED WITH THE SWITCH. ApiAccessSwitch reads it
     itself, and re-reads it at the moment the switch is flipped rather
     than when the page loaded: a key minted in between is a key the
     confirmation would otherwise not be counting. */

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
            <span>Live from {formatMonth(partner.since) || '-'}</span>
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
          /* SETTINGS, on the supplier's own page. Matt, 2026-10-01: "its
             settings (name, live from, status, referencing mode,
             capabilities) move into a Settings tab, with the same fields
             as Manage." Before People because it is what the page IS,
             and People is who is on it. */
          ['settings', 'Settings'],
          /* WALK FIX 15: the report for this customer, on this customer's
             own page. This whole route is superadmin-only, so there is no
             role gate to add here. */
          ['reporting', 'Reporting'],
          ['commission', 'Commission'],
          ['referrals', 'Referrals'], ['integration', 'Integration'],
        ]}
      />

      {tab === 'settings' && (
        <SupplierSettings slug={partner.id} canEdit={isAdmin} onSaved={refresh} />
      )}

      {tab === 'reporting' && (
        <>
        {/* THE STATEMENTS THE SUPPLIER WAS SENT, on the page the email
            points at. Matt, 2026-10-01: the schedules are "always
            available" on the supplier's Reporting page. Admin reads the
            identical card here, so a supplier asking "what did you send
            me in June" is answered from the same bytes rather than from
            somebody's sent folder. */}
        {maySeeCommission(role) && (
          <SupplierStatements
            partner={partner.dbId ?? partner.id}
            supplierName={partner.name}
            months={statementMonths(role, partner.id)}
          />
        )}
        <CustomerReport
          rows={customerRows}
          seesCommission={maySeeCommission(role)}
          periodId={reportPeriod.id}
          periods={reportPeriods.map((p) => ({ value: p.id, label: p.label }))}
          onPeriod={(id) => setReportPeriod(reportPeriods.find((p) => p.id === id) ?? reportPeriod)}
          emptyText={`No referrals from ${partner?.name ?? 'this supplier'} in this period.`}
        />
        </>
      )}

      {tab === 'commission' && (
      <div className="ph-grid">
        {/* ONE WAY TO SET COMMISSION, AND THIS IS IT.

            Matt, 2026-10-01: "Supplier Commission tab: one way to set
            commission only. Remove the old card (Total commission %, Agents'
            share %, read-only volume tiers, Save commission) and keep the
            deal editors ... moving the 'Opndoor pays the agents directly'
            switch and the plain-English summary into that layout."

            The old card and the deal editors were two ways to price the same
            referral, sitting one above the other, and they could disagree:
            the card's "Total commission %" is the flat rate, a deal
            overrides it, and the card went on printing the flat figure as
            though it were in force. Keeping the card "for the common case"
            was my reasoning when I put the deals below it, and it was wrong
            for exactly the reason this tab exists -- the fault it was built
            to end was two screens editing one number.

            What the card owned that was worth keeping has moved into
            SupplierDeals: the pays-agents switch, and the one sentence
            saying who ends up with what. The flat pair is still what prices
            a supplier with no deal, and the deal cards say so in words
            rather than in a second pair of inputs.

            NO LONGER BEHIND `isAdmin`. The card it replaces rendered
            read-only for anybody who could reach this page and took
            `canEdit` for the buttons; gating the whole component instead
            would have left an opndoor_manager on a Commission tab with no
            commission on it. `canEdit` is passed and every control already
            honours it. */}
        <SupplierDeals
          slug={partner.id}
          partnerId={partner.dbId ?? partner.id}
          name={partner.name}
          canEdit={isAdmin}
          total={rates.partner ?? null}
          agentShare={rates.agent ?? null}
          paysAgents={partner.opndoorPaysAgents === true}
          /* THE REAL IDS ONLY. A membership is keyed on agencies.id, so an
             agency with no db id -- mock mode, and any row that has not come
             back from the server -- cannot be put on a deal, and offering it
             in the picker would be offering a click that fails. */
          agencies={agencies.filter((a) => !!a.id).map((a) => ({ id: a.id!, name: a.name }))}
          onSaved={refresh}
        />

        {/* WHO THE MONTHLY STATEMENT GOES TO. On the Commission tab because
            the statement IS the commission, and this is the only screen in
            the product where a supplier's named addresses can be set. Admin
            only here; the RPCs behind it are guarded regardless.

            UNDER ITS OWN HEADING, which is Matt's, 2026-10-01: "Move
            Monthly statement addresses to its own section below, headed
            'Who gets the statements'." It sat as one more card in the
            run of deal cards, so it read as part of the negotiation
            rather than as where the paperwork goes. */}
        {isAdmin && (
          <>
            <div className="sd-sharehead">
              <h3 className="sd-sharehead__t">Who gets the statements</h3>
              <p className="sd-sharehead__s">
                Where the monthly commission statement is sent. Management users of this supplier
                get it by default; these are the extra addresses.
              </p>
            </div>
            <StatementRecipients partnerKey={partner.dbId ?? partner.id} supplierName={partner.name} />
          </>
        )}

      </div>
      )}

      {tab === 'integration' && (
      <div className="ph-grid">
        {/* API ACCESS, AS A SWITCH, WHERE THE KEYS ARE. Matt,
            2026-10-01: "add the API access on/off switch here (moved
            from Settings), with a confirmation that says how many
            active API keys will stop working if it's turned off." It
            was a tickbox on the Manage modal, read beside a list of
            unrelated settings and acted on by pressing Save at the
            bottom; the sentence that matters now sits on its own
            action. */}
        <Card>
          <CardHead title="API access" sub="Whether this supplier can use the partner API, and how many keys are live." />
          <CardBody>
            <ApiAccessSwitch slug={partner.id} canEdit={isAdmin} onChanged={refresh} />
            <p className="ph-note muted">
              {/* WHAT THIS SCREEN SHOWS, EXACTLY. It said admin "can see
                  that keys exist", which UNDERSTATES it: the line above
                  prints the live count. Matt, 2026-10-01: no screen should
                  claim more or less than it shows. */}
              {partner.apiAccessEnabled
                ? 'You can see how many keys are active, above, and turn API access off, which stops all of them at once. You can never see a key, its prefix, or create one: the supplier’s own developer manages those in the Dev Centre. To revoke a single key you need its prefix, under Break glass in the Dev Centre.'
                : 'This supplier cannot hold API keys. Turn API access on first.'}
            </p>
          </CardBody>
        </Card>

        {/* WHAT THEIR INTEGRATION IS ACTUALLY DOING. Shown only once API
            access is on: before that there is no traffic, no sandbox and
            no endpoint, and three empty panels would read as broken
            rather than as not-yet-started.

            READ-ONLY, which is the instruction and is also the line that
            matters: clearing a sandbox, replaying a delivery and sending
            a test event all ACT on a developer's working state, and an
            admin doing that from a page about a supplier would be
            changing something this screen does not say it changes. */}
        {partner.apiAccessEnabled && (
          <>
            <Card>
              <CardHead
                title="Sandbox activity"
                sub="The test applications this supplier’s developer has created, and where each has got to. Read-only here; they drive it from their own Dev Centre."
              />
              <CardBody>
                <Sandbox partnerId={partner.dbId ?? null} readOnly />
              </CardBody>
            </Card>

            <Card>
              <CardHead
                title="Recent API requests and errors"
                sub="Every call this supplier has made to the partner API, newest first, with the ones that failed and why."
              />
              <CardBody>
                <Logs partnerId={partner.dbId ?? null} />
              </CardBody>
            </Card>

            <Card>
              <CardHead
                title="Webhook delivery history"
                sub="What opndoor has sent to their endpoints, whether it arrived, and how many attempts it took."
              />
              <CardBody>
                <WebhookHistory partnerId={partner.dbId ?? null} readOnly />
              </CardBody>
            </Card>
          </>
        )}
      </div>
      )}

      {tab === 'overview' && (<>
      {/* STRUCTURE — agencies + branches tree */}
      <Card>
        <CardHead
          title="Structure"
          sub={`${agencies.length} ${plural(agencies.length, 'agency')} · ${branchCount} ${plural(branchCount, 'branch')}`}
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
                    <span className="ph-tree__meta">{countOf(a.branches.length, 'branch')} · {countOf(a.referrals, 'referral')}</span>
                  </div>
                  {/* WHO THE DEED GOES TO. Q-06 item A asks the Overview to
                      show "agent contacts and deed recipients". On the
                      supplier rail those are the same thing: there are no
                      positions here, so the deed goes to the branch's agent
                      contact, inheriting the agency's where the branch has
                      none. A supplier agency with no contact anywhere has
                      nowhere to send an executed deed, and the page said
                      nothing about it. */}
                  <AgencyContactLine agency={a} />
                  {a.branches.length > 0 && (
                    <div className="ph-tree__branches">
                      {a.branches.map((b) => (
                        <div className="ph-tree__branch" key={b.id ?? b.name}>
                          <span className="ph-tree__bic"><Icon name="home" size={13} /></span>
                          <Link className="ph-tree__bname" to={`/applications?branch=${encodeURIComponent(b.name)}`}>{b.name}</Link>
                          {b.area && <span className="ph-tree__barea">{b.area}</span>}
                          {b.unreviewed && <span className="ph-tag">unreviewed</span>}
                          <span className="ph-tree__meta">{countOf(b.referrals, 'referral')}</span>
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
                      <td className="soft">{formatDate(r.date)}</td>
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
          sub={countOf(users.length, 'person')}
          /* NO LINK OFF TO THE ESTATE-WIDE LIST. Matt, 2026-10-01: "Its
             people are on the People tab only" and "Anything that linked
             to /users?partner=… now goes to that supplier's People tab."
             This tab IS that page, so the link pointed at a filtered copy
             of itself.

             WHICH IS ALSO WHY THE INVITE LIVES HERE. Matt, 2026-10-01:
             "Supplier People tab: add an 'Invite someone' button, using
             the supplier Add user form". Sending somebody to /users to
             invite would undo the change above and would ask them to
             pick the supplier whose page they are standing on. */
          actions={isAdmin && (
            <SupplierInvite
              partnerId={partner.id}
              partnerName={partner.name}
              apiAccessEnabled={partner.apiAccessEnabled === true}
              onInvited={refresh}
            />
          )}
        />
        <CardBody style={{ padding: users.length === 0 ? undefined : 0 }}>
          {users.length === 0 ? (
            <div className="ph-empty">No users for this partner.</div>
          ) : (
            <table className="dt ph-table">
              <thead><tr><th>Name</th><th>Level</th><th>Sees</th><th>Status</th><th>Last active</th>{isAdmin && <th />}</tr></thead>
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
                    <td className="soft">{supplierSees(u.role)}</td>
                    <td>{(() => {
                      const [label, variant] = USER_STATUS_PILL[u.status] ?? [u.status, 'muted' as PillVariant];
                      return <Pill variant={variant}>{label}</Pill>;
                    })()}</td>
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
                          onChangeLevel={(pr) => setRoleFor({ userId: pr.userId, name: pr.name, current: u.role })}
                          /* UNREACHABLE, and left as a no-op rather than
                             wired to something: `manyOffices={false}` above
                             means PersonActions never draws the Position
                             button here, because a supplier's staff hold no
                             position -- partner_id IS the company boundary
                             on this rail and there is no ladder to stand
                             on. If that ever changes, this is the line that
                             has to change with it. */
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
      {/* THE ROLE DIALOG, HERE, which is the whole instruction: "Change
          role" used to raise a toast naming the Users page. */}
      {roleFor && (
        <SupplierRoleDialog
          user={roleFor}
          apiAccessEnabled={partner.apiAccessEnabled === true}
          onClose={() => setRoleFor(null)}
          onSaved={() => { setRoleFor(null); refresh(); }}
        />
      )}
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
