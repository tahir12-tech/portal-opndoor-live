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
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ALL_PARTNERS, getPartner, getPeriods,  getAgencies, getUsers, maySeeCommission,
  statementMonths,
  REFERENCING_MODES, type Agency, type ManagedUser, type ReferencingMode, type Role,
  applicationStatusLabel, applicationStageClass,
} from '@/data';
// Walk fix 15: this customer's report, on this customer's page.
import { liveByCustomer } from '@/data/liveAnalytics';
import { CustomerReport } from '@/components/CustomerReport';
import { SupplierStatements } from '@/components/SupplierStatements';
import { SupplierSettings } from './SupplierSettings';
import { ApiAccessSwitch } from './ApiAccessSwitch';
import { SupplierApiKeys } from './SupplierApiKeys';
import { AddContactEmail } from './AddContactEmail';
import { SupplierOverview } from './SupplierOverview';
import { SupplierAddOrg } from './SupplierAddOrg';
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
import { supplierSees } from '@/data/positionsService';
import type { Branch } from '@/data';

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
/* WHAT THIS AGENCY'S ROW SAYS ABOUT ITS ADDRESS.
 *
 * REWRITTEN 2026-10-02 onto the shared predicate. Matt: "an agency email
 * is required at creation and is the default for all its branches ... For
 * supplier-estate agencies with no agency email, show a clear warning on
 * the supplier's Agencies tab and list them on Reconciliation so Opndoor
 * can add one."
 *
 * So the subject is the AGENCY address, not "is any deed stranded". An
 * agency whose offices each hold their own is still missing the default,
 * and the row says which of the two cases it is rather than treating them
 * alike. `agencyContactState` is the one place that decides, shared with
 * the Agencies screen, so this page and that one cannot answer
 * differently -- which is the fault its own history records.
 */
function AgencyContactLine({ agency }: { agency: Agency }) {
  const state = agencyContactState(agency);
  if (state.kind !== 'needs-email') return <ContactLine agency={agency} />;
  const stranded = state.bare > 0;
  return (
    <span
      className="ph-contact ph-contact--none"
      title={stranded
        ? 'An executed deed for those branches has nowhere to go until a contact is set.'
        : 'Every branch has its own address, so nothing is stranded. The next one added would inherit nothing.'}
    >
      No agency email
      {stranded
        ? <> · {state.bare} of {state.branches} {plural(state.branches, 'branch')} cannot be sent a deed</>
        : <> · nothing stranded today, but the next office would inherit nothing</>}
    </span>
  );
}

/* THE LOCAL STATUS MAPS ARE GONE, which is the useful half of (bd). There
   were four copies across four files, and three of them spelled "Deed
   issued" differently from the fourth -- so the refund rule would have had
   to be written four times, and the next rule after it four times again.
   applicationStatusLabel and applicationStageClass are the one answer, and
   every list that shows a stage now asks them. */
import { agencyContactState } from '@/data/deedContact';
import { PageTabs } from '@/components/ui/PageTabs';
import { PersonActions } from '@/components/people/PersonActions';
import { useToast } from '@/components/ui/Toast';
import { cancelInvite, deleteUser, resendInvite, resetUserMfa, resetUserPassword, setUserStatus } from '@/data/usersService';
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
import { formatDate, formatMonth, possessive } from '@/lib/format';
import { PeopleTable } from '@/components/people/PeopleTable';
import { deleteAsk, personAsk, resentLine, type AskedAction } from '@/components/people/personConfirm';
import { useConfirm } from '@/components/ui/ConfirmModal';

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
   the dash stays for a role genuinely outside the three.

   AND THE SENTENCES THEMSELVES MOVED THERE on 2026-10-02, when the
   agency People tab gained the same column: two files wording "sees
   everything" separately is the fault this comment is already about.
   `supplierSees` and `agencySees` are now side by side. */

/* USER_STATUS_PILL moved into PeopleTable with the table itself: one
   place decides what Active, Invited and Deactivated look like. */
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
  const { ask: askConfirm, confirmEl } = useConfirm();
  const isAdmin = role === 'superadmin';

  /* ONE HANDLER FOR THE ROW ACTIONS. Each is a single call into usersService
     and each reports the same way, so they share a body rather than growing
     six copies of try/catch/toast -- which is how the two action sets
     already in the product came to disagree about confirmation. */
  /* AND IT ASKS FIRST, FOR EVERYTHING BUT A RESEND. Matt, 2026-10-03: "Every
     action that changes something asks first, in plain words". The comment
     above notes that the two action sets already in the product "came to
     disagree about confirmation" -- and what this page settled on was no
     confirmation at all, for all six, including the one that bans an account
     and ends its sessions. The words are personAsk's, shared with the other
     three People surfaces. A resend is the exception and is not in Matt's
     list: it sends the same invitation again and changes nothing. */
  const askPerson = (what: AskedAction | 'resend' | 'cancel' | 'delete', userId: string, who: string, email = who) => {
    if (what === 'resend') { void runPerson(what, userId, email); return; }
    const q = what === 'delete' ? deleteAsk(who)
      : personAsk(what === 'cancel' ? 'cancelInvite' : what, who);
    askConfirm({ ...q, run: () => runPerson(what, userId, who) });
  };
  const runPerson = async (what: string, userId: string, who: string) => {
    if (busy) return;
    setBusy(true);
    try {
      /* `who` IS THE EMAIL ON THIS ONE ARM, passed as such by askPerson:
         Matt, 2026-10-03, "show 'Invite sent again to [email]'". */
      if (what === 'resend') { await resendInvite(userId); toast(resentLine(who)); }
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
      /* Says what survived, because "deleted" on its own invites the question
         Matt's own dialog answers: their name stays on their referrals. */
      else if (what === 'delete') { await deleteUser(userId); toast(`${who} is off the People lists. Their name stays on their referrals.`); }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Something went wrong.', 'error');
    } finally { setBusy(false); }
  };
  /* FIVE TABS, the same five the agency page has. Q-06 item A: "Supplier
     detail page mirrors the agency page ... Regent's agency page is the
     template." The page was four flat cards in document order, so a reader
     scrolled past the commission rates to reach the people. */
  type Tab = 'overview' | 'agencies' | 'people' | 'settings' | 'reporting' | 'commission' | 'referrals' | 'integration';
  /* ?tab= SO ANOTHER PAGE CAN LINK AT A TAB. Reconciliation's "Supplier
     agencies with no email" rows link to the agency on its supplier's
     page, and a link that lands on Overview has not done that: the
     reader arrives at a summary and has to find the tab the row was
     about. The Overview's own warning switches tabs with a callback,
     which works because it is already on this page; a link from another
     one needs a URL.

     A WHITELIST OF LITERALS, as Reconciliation's is and for the same
     reason: a new tab has to be named here to be deep-linkable, and
     missing it opens Overview rather than a blank page. */
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const t = params.get('tab');
    return t === 'agencies' || t === 'people' || t === 'settings' || t === 'reporting'
      || t === 'commission' || t === 'referrals' || t === 'integration' ? t : 'overview';
  });
  /** The Add agency / Add branch dialog, and what it is adding to. */
  const [addOrg, setAddOrg] = useState<{ mode: 'agency' | 'branch'; agency: Agency | null } | null>(null);
  /* THE KEY COUNT MOVED WITH THE SWITCH. ApiAccessSwitch reads it
     itself, and re-reads it at the moment the switch is flipped rather
     than when the page loaded: a key minted in between is a key the
     confirmation would otherwise not be counting.

     AND WHEN A KEY IS REVOKED, 2026-10-03. Matt: "after revoking a key, the
     'N active keys' count at the top doesn't update until refresh." The
     revoke happens in SupplierApiKeys, which reloads its own list; the count
     is in ApiAccessSwitch beside it. Two siblings with no way to hear about
     each other, so the parent holds the fact they share. */
  const [keysVersion, setKeysVersion] = useState(0);

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
          ['overview', 'Overview'],
          /* THIS SUPPLIER'S ESTATE, ON THIS SUPPLIER'S PAGE. Matt,
             2026-10-01: "Each supplier's estate ... On admin's view, they
             appear in an 'Agencies' tab on that supplier's page, not in
             admin's main Agencies tab."

             The tree was a card on Overview, under the heading
             "Structure", which is a word about shape rather than about
             who these companies are. It is the same tree; it has a tab of
             its own now, and admin's main Agencies tab has stopped
             listing them. */
          ['agencies', 'Agencies'],
          ['people', 'People'],
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
      <div className="ph-grid ph-grid--one">
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
          /* THE PARTNER'S OWN RATES, NOT getRatesFor's. Matt, 2026-10-03:
             "No Deal Supplier" showed "25% of the fee, agencies 10%" on this
             card with 25/10 really stored on the row -- and it would have
             gone on showing it after that was fixed, because `getRatesFor`
             substituted 25% for a null before this `?? null` could see one.
             SupplierDeals asks `flat == null` to say "No commission deal
             set", and it was never handed a null to ask about. */
          total={partner.partnerRate ?? null}
          agentShare={partner.agentRate ?? null}
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
            <ApiAccessSwitch slug={partner.id} canEdit={isAdmin} onChanged={refresh} version={keysVersion} />
            <p className="ph-note muted">
              {/* WHAT THIS SCREEN SHOWS, EXACTLY. It said admin "can see
                  that keys exist", which UNDERSTATES it: the line above
                  prints the live count. Matt, 2026-10-01: no screen should
                  claim more or less than it shows.

                  AND IT NO LONGER SENDS ANYONE TO THE DEV CENTRE. Matt,
                  2026-10-02: "Opndoor admin can revoke a single key here
                  ... removing any mention of Break glass or the Dev
                  Centre for admin." Both were in this sentence, and both
                  were directions to a screen admin can no longer open:
                  the Dev Centre is for developers only as of the same
                  day. A line that names a door that is now locked is
                  worse than no line. */}
              {partner.apiAccessEnabled
                ? 'Each active key is listed below, with a Revoke beside it. You can also turn API access off, which stops every key at once. You can never see a key or create one: the supplier’s own developer does that.'
                : 'This supplier cannot hold API keys. Turn API access on first.'}
            </p>
          </CardBody>
        </Card>

        {/* THE KEYS THEMSELVES, AND ONE REVOKE EACH. Matt, 2026-10-02:
            "List each active key by its name, when it was created and
            when it was last used, each with a Revoke button and a
            confirmation." Under the switch, because turning access off
            is the blunt version of the same act and the two belong in
            one place; above the read-only panels, because this is the
            only thing on the tab an admin can DO. */}
        {partner.apiAccessEnabled && (
          <Card>
            <CardHead
              title="API keys"
              sub="Every key this supplier has live. Revoking one stops it immediately and leaves their others working."
            />
            <CardBody style={{ padding: 0 }}>
              <SupplierApiKeys partnerId={partner.dbId ?? null} canRevoke={isAdmin} onChanged={() => setKeysVersion((v) => v + 1)} />
            </CardBody>
          </Card>
        )}

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
                <Logs partnerId={partner.dbId ?? null} readOnly />
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

      {/* THE OVERVIEW, which had no branch at all: eight tabs and the one
          everybody lands on drew nothing. Matt, 2026-10-02. */}
      {addOrg && partner && (
        <SupplierAddOrg
          mode={addOrg.mode}
          partnerSlug={partner.id}
          partnerName={partner.name}
          agency={addOrg.agency}
          onClose={() => setAddOrg(null)}
          onDone={() => { setAddOrg(null); refresh(); }}
        />
      )}

      {tab === 'overview' && (
        <SupplierOverview
          slug={partner.id}
          partnerDbId={partner.dbId ?? null}
          name={partner.name}
          standardTotal={partner.partnerRate ?? null}
          standardShare={partner.agentRate ?? null}
          onOpenAgencies={() => setTab('agencies')}
          dataVersion={dataVersion}
        />
      )}

      {tab === 'agencies' && (
      <Card>
        <CardHead
          actions={isAdmin ? (
            /* ADD AN AGENCY, IN THIS SUPPLIER'S ESTATE. Matt,
               2026-10-02. On the card head rather than at the foot of
               the tree, so it is reachable without scrolling past
               however many agencies they have. */
            <Button variant="quiet" size="sm" onClick={() => setAddOrg({ mode: 'agency', agency: null })}>
              <Icon name="plus" size={13} /> Add agency
            </Button>
          ) : undefined}
          /* THE SHARED HELPER, not an apostrophe-s. Matt, 2026-10-02:
             "fix 'Kestrel Lettings's agencies' to 'Kestrel Lettings''
             agencies' (use the shared possessive helper everywhere)."
             `possessive` has known that a name ending in s takes the
             apostrophe alone since it was written; this heading was
             built by hand and did not ask it. */
          title={`${possessive(partner.name)} agencies`}
          sub={`${agencies.length} ${plural(agencies.length, 'agency')} · ${branchCount} ${plural(branchCount, 'branch')}. These come through ${partner.name} and are theirs: they have no logins, and they are not on Opndoor's own Agencies list.`}
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
                    {isAdmin && (
                      <button type="button" className="ph-addemail"
                        onClick={(e) => { e.stopPropagation(); setAddOrg({ mode: 'branch', agency: a }); }}>
                        <Icon name="plus" size={12} /> Add branch
                      </button>
                    )}
                  </div>
                  {/* WHO THE DEED GOES TO. Q-06 item A asks the Overview to
                      show "agent contacts and deed recipients". On the
                      supplier rail those are the same thing: there are no
                      positions here, so the deed goes to the branch's agent
                      contact, inheriting the agency's where the branch has
                      none. A supplier agency with no contact anywhere has
                      nowhere to send an executed deed, and the page said
                      nothing about it. */}
                  <span className="ph-tree__contact">
                    <AgencyContactLine agency={a} />
                    {/* AND A WAY TO CLOSE THE GAP IT REPORTS. Matt,
                        2026-10-02: an "Add email" button next to "No
                        agency email", setting it in place. A warning
                        with no action beside it is a screen telling
                        somebody to go and find another screen. */}
                    {isAdmin && (
                      <AddContactEmail
                        agency={a}
                        current={(a.contacts ?? []).find((c) => c.primary) ?? (a.contacts ?? [])[0] ?? null}
                        onSaved={refresh}
                      />
                    )}
                  </span>
                  {a.branches.length > 0 && (
                    <div className="ph-tree__branches">
                      {a.branches.map((b) => (
                        <div className="ph-tree__branch" key={b.id ?? b.name}>
                          <span className="ph-tree__bic"><Icon name="home" size={13} /></span>
                          {/* BY ID: this page is a SUPPLIER's estate, which is
                              precisely where a name collides with one of
                              Opndoor's own. */}
                          <Link className="ph-tree__bname" to={b.id ? `/applications?branchId=${encodeURIComponent(b.id)}` : `/applications?branch=${encodeURIComponent(b.name)}`}>{b.name}</Link>
                          {b.area && <span className="ph-tree__barea">{b.area}</span>}
                          {b.unreviewed && <span className="ph-tag">unreviewed</span>}
                          <span className="ph-tree__meta">{countOf(b.referrals, 'referral')}</span>
                          <ContactLine agency={a} branch={b} />
                          {/* "Each branch's email can be added or changed
                              the same way." Its own address overrides the
                              agency's for that branch, which is what the
                              confirmation says. */}
                          {isAdmin && (
                            <AddContactEmail
                              agency={a}
                              branch={b}
                              current={(b.contacts ?? []).find((c) => c.primary) ?? (b.contacts ?? [])[0] ?? null}
                              onSaved={refresh}
                            />
                          )}
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
      )}

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
                      <td><span className={`ph-st ${applicationStageClass(r)}`}>{applicationStatusLabel(r)}</span></td>
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
          {/* THE SHARED TABLE. Matt, 2026-10-01: "Use one shared people
              table on every people screen ... fixed aligned columns Name
              (initials, name, email below), Level, Office, Status, Last
              active, and actions right-aligned, so every row lines up."

              Sees rides in the `extra` column, which is its own
              instruction from the same day and is about what a Developer
              can reach. Office is dropped by the table itself, because a
              supplier's staff hold no position: partner_id IS the company
              boundary on this rail, and a column of dashes is the thing
              this table exists to stop. */}
          <PeopleTable
            emptyText="No users for this partner."
            extraHeader="Sees"
            rows={users.map((u) => ({
              id: u.id,
              name: u.name,
              email: u.email,
              level: ROLE_LABEL[u.role] ?? u.role,
              status: u.status,
              lastActive: u.lastActive,
              extra: supplierSees(u.role),
              actions: isAdmin ? (
                <PersonActions
                  person={{ userId: u.id, name: u.name, email: u.email, status: u.status, agencyLevel: ROLE_LABEL[u.role] ?? u.role }}
                  isAdmin
                  manyOffices={false}
                  changeLevelLabel="Change role"
                  onAction={(what, userId, who, email) => askPerson(what, userId, who, email)}
                  onCancelInvite={(userId, who) => askPerson('cancel', userId, who)}
                  onChangeLevel={(pr) => setRoleFor({ userId: pr.userId, name: pr.name, current: u.role })}
                  onPosition={() => {}}
                  onNotifications={(pr) => setNotifFor(pr)}
                  mayNotify
                />
              ) : undefined,
            }))}
          />
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
      {confirmEl}
    </>
  );
}
