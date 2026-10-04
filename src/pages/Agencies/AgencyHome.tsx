/* =====================================================================
   AgencyHome — the whole page is ONE org tree: Group → Agency → Branch.

   Each node carries, inline: its name and level, the people at that level with
   role labels and a level-specific invite, the resolved commission for that node
   as a chip (with a per-node "Set custom rate" editor and a "How this rate is
   worked out" expander), and — for branches — a referral count that filters the
   Referrals section below, and a nominated deed recipient.

   Vocabulary is Group / Agency / Branch only; never "brand", "partner" or
   "supplier" on screen ("brand" survives in the schema as the agencies table).
   The status badge states what the org actually is. Rates are percentages
   everywhere.

   WHO MAY SEE THE COMMISSION ON THIS PAGE. Seeing it is maySeeCommission, which
   is Opndoor staff and a Director; EDITING it is isAdmin on top of that. The
   header used to call seeing "admin-only", which was the intention and not the
   code: a supplier's management user has always read the rates here too.

   The Director / Manager split needed nothing added to this page, which is worth
   saying plainly because every other commission surface did. canSeeCommission
   was already the gate on all four places a figure appears: the Commission tab
   (both the tab button and the panel), the per-node Earns chip and Set rate
   editor inside RateLine, and the branch payout sentence. A Manager is role
   'management' without sees_commission, so maySeeCommission answers false for
   them and every one of those disappears, tab included. What this page DID do
   was fetch the splits and the negotiated agreement for them anyway and hold
   them in memory unshown; it no longer asks for either. See the two effects.
   ===================================================================== */
// Walk fix 19: the possessive is formed in one place.
import { formatDate, possessive } from '@/lib/format';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getAgencies, getGroup, getGroups, getPartner,
  getApplications, getPeriods, getUsers, maySeeCommission, ALL_PARTNERS,
  type Agency, type AgencyGroup, type ManagedUser,
  applicationStatusLabel, applicationStageClass,
} from '@/data';
import {
  getPositionsForUsers, getDeedRecipients, getOrgDeedReadiness, agencySees, officeOf,
  type DeedReadiness,
} from '@/data/positionsService';
import { setNodeRate, getCommissionSplits, previewNodeRate, setAgencyReferencingMode, getAgreementForAgency, type AgreementView, type SplitLine } from '@/data/orgService';
import { cancelInvite, deleteUser, resendInvite, resetUserMfa, resetUserPassword, setUserStatus } from '@/data/usersService';
import { useSession } from '@/session/SessionContext';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Card, CardHead, CardBody } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { deleteAsk, personAsk, resentLine } from '@/components/people/personConfirm';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { InviteToLevel, type InviteContext } from './InviteToLevel';
import { PeopleTable } from '@/components/people/PeopleTable';
import { PersonNotifications } from '@/components/people/PersonNotifications';
// Walk fix 15: this customer's report, on this customer's page.
import { CustomerReport } from '@/components/CustomerReport';
import { liveByCustomer } from '@/data/liveAnalytics';
import { agencyLevelOf, AGENCY_LEVELS, mayActOnOrEqual, setAgencyLevel, type Actor, type AgencyLevel, type Role } from '@/data';
import { deedsWithNowhereToGo, NO_USERS_YET } from '@/data/deedsStuck';
import { getOrgDepartedReferrals, departedReferralsLine, type DepartedReferrals } from '@/data/positionsService';
import { partyIsSupplier, readerIsTopOfEstate, mayEditOwnEstateOrg } from '@/data/capabilities';
import { EditOrgDetails, type EditOrgTarget } from './EditOrgDetails';
import { PageTabs } from '@/components/ui/PageTabs';
import { PersonActions, type PersonAction } from '@/components/people/PersonActions';
import { PositionModal, type ScopeTarget } from '@/pages/UserManagement/PositionModal';
import { AgencyGrow } from './AgencyGrow';
import { AgreementEditor, agreementSummary, dealWords } from './AgreementEditor';
import { CommissionStatement } from '@/components/CommissionStatement';
import { showsOffices } from '@/data/agencyOffices';
import './AgencyHome.css';
import { plural } from '@/lib/plural';
import { AgencyChanges } from './AgencyChanges';

/* THE LOCAL STATUS MAPS ARE GONE, which is the useful half of (bd). There
   were four copies across four files, and three of them spelled "Deed
   issued" differently from the fourth -- so the refund rule would have had
   to be written four times, and the next rule after it four times again.
   applicationStatusLabel and applicationStageClass are the one answer, and
   every list that shows a stage now asks them. */
const initials = (n: string) => n.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

/** The glyph for a cell with nothing in it. A single hyphen, everywhere, and
    named rather than typed out so the page cannot go back to mixing dashes. */
const EMPTY = '-';

type Level = 'group' | 'agency' | 'branch';
interface Placed {
  userId: string; name: string; email: string; role: string;
  /** 'pending' while an invitation is out. Carried so the deed warning can
      tell an agency with nobody in it from one whose only person has not
      accepted yet: the readiness RPC answers false for both and they are
      a different job. */
  status?: string;
  /** Carried so the pill can say the LEVEL. A Director and a Manager are the
      same role and differ only in this bit, so a pill without it can only ever
      describe the node the person was found under. */
  seesCommission?: boolean;
}
type Org = { kind: 'group'; group: AgencyGroup; agencies: Agency[] } | { kind: 'agency'; agency: Agency };

/** "12%" from 0.12. Formatting only: the arithmetic all lives in SQL. */
const pctLabel = (frac: number): string => `${+(frac * 100).toFixed(2)}%`;

/** What a row may have done to it. Named so the branch view and the People
    table cannot drift on which actions exist. */

/** How a payout line's source reads inside the line itself, in the sentence's
    own voice rather than as a column heading. */
const SOURCE_CAPTION: Record<SplitLine['source'], string> = {
  standard: 'Opndoor standard',
  agreement: 'agreement',
  rate: 'set rate',
};

/**
 * The one plain line a branch shows, built from the lines SQL returned.
 *
 * IT SAYS WHERE EACH RATE CAME FROM. It did not, and the omission had a cost:
 * Regent's negotiated 20% and the Opndoor standard 20% printed as the same
 * five characters, so the line could not tell a party on an agreement from a
 * party on the default. The source is read off SplitLine.source, which is what
 * the rule reported; it is never inferred from whether an explicit rate is set,
 * because an agreement party's explicit rate is null by design.
 *
 * The total is dropped for a single payee, where "20% ... = 20% of the fee"
 * says the same number twice.
 */
const payoutSentence = (lines: SplitLine[]): string => {
  if (!lines.length) return 'Pays out nothing.';
  const parts = lines.map((l) => `${l.orgName} ${pctLabel(l.rate)} (${SOURCE_CAPTION[l.source]})`);
  if (lines.length === 1) return `Pays out: ${parts[0]}`;
  const total = pctLabel(lines.reduce((s, l) => s + l.rate, 0));
  return `Pays out: ${parts.join(' + ')} = ${total} of the fee`;
};

/** WHAT SOMEBODY IS, not where they were found.
 *
 * This read the NODE: everyone under a group was a "Group director", everyone
 * under an agency an "Agency manager", and a Director and a Manager standing
 * side by side on the same branch were both "Branch manager". Those are
 * positions, described as though they were levels, and the one thing the pill
 * could never say was the level. The ladder is Director / Manager /
 * Negotiator and it is a fact about the person. */
const levelLabelFor = (p: Placed): string =>
  agencyLevelOf(p.role as Role, p.seesCommission === true) ?? 'Developer';
const inviteLabelFor = (level: Level) =>
  level === 'group' ? 'Invite group director' : level === 'agency' ? 'Invite agency manager' : 'Invite branch manager or negotiator';

// A parsed percentage input -> fraction. '' -> null (inherit); invalid -> undefined.
const pctToFrac = (s: string): number | null | undefined => {
  const t = s.replace('%', '').trim();
  if (t === '') return null;
  const n = parseFloat(t);
  return isNaN(n) || n < 0 || n > 100 ? undefined : n / 100;
};

/** How a payout line is captioned, by the source the RULE reported. Never
    inferred from "is an explicit rate set": an agreement party has none, by
    design, which is exactly how a negotiated 20% came to be labelled the
    Opndoor standard. */
const SOURCE_LABEL: Record<'standard' | 'agreement' | 'rate', string> = {
  standard: 'Opndoor standard',
  agreement: 'Agreement',
  rate: 'Set rate',
};

export function AgencyHome() {
  const { key } = useParams<{ key: string }>();
  const { role, seesCommission, currentUserId, partnerScope, dataVersion, refresh: refreshSession } = useSession();
  const toast = useToast();
  const { ask: askConfirm, confirmEl } = useConfirm();
  const decoded = decodeURIComponent(key ?? '');
  const isAdmin = role === 'superadmin';
  const canSeeCommission = maySeeCommission(role);
  const scope = isAdmin ? ALL_PARTNERS : partnerScope;

  const [tick, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);
  const [invite, setInvite] = useState<InviteContext | null>(null);
  // Which party's commission is being edited, if any. Null closes the editor.
  const [editAgreement, setEditAgreement] = useState<{ level: 'group' | 'agency' | 'branch'; id: string; name: string } | null>(null);
  /* Creation is anchored to a node, so the modal can say what it is adding and
     where. `growAgency` is the agency a branch is being added to. */
  const [grow, setGrow] = useState<null | { mode: 'branch' | 'agency'; agencyId?: string }>(null);
  // The agency or office whose own details are being corrected. See (am)'s
  // sibling instruction: supplier Management may edit their own.
  const [editOrg, setEditOrg] = useState<EditOrgTarget | null>(null);

  const org = useMemo<Org | null>(() => {
    void dataVersion; void tick;
    const groups = getGroups(scope);
    const agencies = getAgencies(scope);
    const g = groups.find((x) => (x.id ?? x.name) === decoded);
    if (g) return { kind: 'group', group: g, agencies: agencies.filter((a) => a.groupId === g.id) };
    const a = agencies.find((x) => (x.id ?? x.name) === decoded);
    if (!a) return null;
    if (a.groupId) {
      const parent = getGroup(a.groupId);
      if (parent) return { kind: 'group', group: parent, agencies: agencies.filter((x) => x.groupId === parent.id) };
    }
    return { kind: 'agency', agency: a };
  }, [scope, decoded, dataVersion, tick]);

  const title = org ? (org.kind === 'group' ? org.group.name : org.agency.name) : 'Agency';
  usePageMeta('agency-home', title, ['Home', 'Relationships', 'Agencies', title]);

  const agencies = org ? (org.kind === 'group' ? org.agencies : [org.agency]) : [];
  const partner = org ? (org.kind === 'group' ? org.group.partner : org.agency.partner) : '';
  const group = org?.kind === 'group' ? org.group : (org?.kind === 'agency' && org.agency.groupId ? getGroup(org.agency.groupId) : undefined);
  const branchesFlat = useMemo(
    () => agencies.flatMap((a) => (a.branches ?? []).map((br) => ({ agency: a, branch: br }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [org, tick],
  );

  // People placed at each node, and the nominated deed recipient per branch.
  const [people, setPeople] = useState<{ group: Placed[]; agency: Record<string, Placed[]>; branch: Record<string, Placed[]>; total: number }>({ group: [], agency: {}, branch: {}, total: 0 });
  const [usersById, setUsersById] = useState<Record<string, ManagedUser>>({});
  const [deedRecipients, setDeedRecipients] = useState<Record<string, string>>({});
  /* The two tickbox columns that used to sit here -- "Notifications" and
     "Statements", each with its own row-level busy flag and its own bulk read
     -- are gone with walk fix 12. Both settings are now on the person's own
     Notifications panel, next to their event choices, which is where somebody
     looking for "what does this person get emailed" actually goes. */
  useEffect(() => {
    if (!org || !partner) { setPeople({ group: [], agency: {}, branch: {}, total: 0 }); setDeedRecipients({}); return; }
    let alive = true;
    const groupId = org.kind === 'group' ? org.group.id : undefined;
    const agencyIds = new Set(agencies.map((a) => a.id).filter(Boolean) as string[]);
    const branchIds = branchesFlat.map((x) => x.branch.id).filter(Boolean) as string[];
    const branchIdSet = new Set(branchIds);
    const users = getUsers({ viewer: role, team: false, scope: partner });
    setUsersById(Object.fromEntries(users.map((u) => [u.id, u])));
    getPositionsForUsers(users.map((u) => u.id))
      .then((byUser) => {
        if (!alive) return;
        const g: Placed[] = []; const ag: Record<string, Placed[]> = {}; const br: Record<string, Placed[]> = {};
        const seen = new Set<string>();
        for (const u of users) {
          const put = (bucket: Placed[]) => { bucket.push({ userId: u.id, name: u.name, email: u.email, role: u.role, seesCommission: u.seesCommission, status: u.status }); seen.add(u.id); };
          for (const p of byUser[u.id] ?? []) {
            if (p.kind === 'group' && groupId && p.targetId === groupId) put(g);
            else if (p.kind === 'agency' && agencyIds.has(p.targetId)) put(ag[p.targetId] ||= []);
            else if (p.kind === 'branch' && branchIdSet.has(p.targetId)) put(br[p.targetId] ||= []);
          }
          // A negotiator is a referrer with a home branch and no user_scope position.
          // Show them on that branch node too, labelled "Negotiator".
          if (!seen.has(u.id) && u.role === 'referrer' && u.homeBranchId && branchIdSet.has(u.homeBranchId)) {
            put(br[u.homeBranchId] ||= []);
          }
        }
        setPeople({ group: g, agency: ag, branch: br, total: seen.size });
      })
      .catch(() => { if (alive) setPeople({ group: [], agency: {}, branch: {}, total: 0 }); });
    getDeedRecipients(branchIds).then((m) => { if (alive) setDeedRecipients(m); }).catch(() => { if (alive) setDeedRecipients({}); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, partner, role, dataVersion, tick]);

  const referrals = useMemo(() => {
    if (!org || !partner) return [];
    const names = new Set(agencies.map((a) => a.name));
    return getApplications({ role, scope: partner }).filter((r) => names.has(r.agency));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, partner, role, dataVersion, tick]);

  /* One flat row per person in this org, for the People tab. Built from the same
     buckets the tree draws, so the two can never disagree about who is here. */
  const peopleRows = useMemo(() => {
    const rows: {
      userId: string; name: string; email: string; role: string; level: Level;
      agency: string; branch: string; status: string;
      /* THE AGENCY LEVEL, which is the pair and not the node. `level` above is
         where somebody sits in the tree (group, agency, branch); this is what
         they ARE (Director, Manager, Negotiator). The table showed the first and
         called it Level, which is a different question with the same word, and
         the answer to it was "branch". */
      agencyLevel: string; seesCommission: boolean;
      /* LAST ACTIVE, which the tab did not carry. Matt, 2026-10-02: the
         shared table's Sees and Last active columns, and for a pending
         invite the latter reads "Invited [date]" -- worded once, in
         hydrate.ts, so every people screen says it the same way. */
      lastActive: string;
      agencyId?: string; branchId?: string;
    }[] = [];
    const u = (id: string) => usersById[id];
    const statusOf = (id: string) => u(id)?.status ?? 'active';
    const levelOf = (id: string, role: string) =>
      agencyLevelOf(role as Role, u(id)?.seesCommission === true) ?? role;
    const sees = (id: string) => u(id)?.seesCommission === true;
    const activeOf = (id: string) => u(id)?.lastActive ?? EMPTY;
    // EMPTY is a single hyphen, here and in every other cell on this page. A
    // group person has no agency and no branch, which is a fact about the level
    // and not missing data.
    people.group.forEach((p) => rows.push({
      ...p, level: 'group', agency: EMPTY, branch: EMPTY, status: statusOf(p.userId),
      agencyLevel: levelOf(p.userId, p.role), seesCommission: sees(p.userId),
      lastActive: activeOf(p.userId),
    }));
    agencies.forEach((a) => {
      (a.id ? people.agency[a.id] ?? [] : []).forEach((p) => rows.push({
        ...p, level: 'agency', agency: a.name, branch: EMPTY, status: statusOf(p.userId),
        agencyLevel: levelOf(p.userId, p.role), seesCommission: sees(p.userId), agencyId: a.id,
        lastActive: activeOf(p.userId),
      }));
      (a.branches ?? []).forEach((b) => {
        (b.id ? people.branch[b.id] ?? [] : []).forEach((p) => rows.push({
          ...p, level: 'branch', agency: a.name, branch: b.name, status: statusOf(p.userId),
          agencyLevel: levelOf(p.userId, p.role), seesCommission: sees(p.userId),
          agencyId: a.id, branchId: b.id, lastActive: activeOf(p.userId),
        }));
      });
    });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, agencies, usersById]);



  const [pFilter, setPFilter] = useState({ level: '', position: '', agency: '', branch: '', status: '', q: '' });
  const peopleShown = useMemo(() => {
    const q = pFilter.q.trim().toLowerCase();
    return peopleRows.filter((r) =>
      // THE AGENCY LEVEL, not the node. This compared against r.level, which is
      // group / agency / branch, so the control now labelled Level and offering
      // Director, Manager and Negotiator would have matched nothing at all.
      (!pFilter.level || r.agencyLevel === pFilter.level)
      && (!pFilter.agency || r.agency === pFilter.agency)
      && (!pFilter.branch || r.branch === pFilter.branch)
      && (!pFilter.status || r.status === pFilter.status)
      && (!q || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q)));
  }, [peopleRows, pFilter]);

  // Agent-rail orgs deliver deeds to their people; a branch with no one in the whole
  // chain (nominee, branch/agency/group manager) cannot receive a deed.
  /* AUDIT (M3). This read the PARTNER's mode for the whole page, which stops being
     the right answer the moment two agencies under one partner differ. The rail is
     now asked per AGENCY, with the partner as the fallback. */
  const partnerMode = getPartner(partner)?.referencingMode ?? null;
  // The ESTATE: is this one of ours? Deed readiness is about having named people
  // to deliver to, which an agency has whether or not it references its own
  // tenants. agencyReferencingMode still answers the other question — the
  // journey — and drives the route selector further down this page.
  const inOurEstate = partnerMode === 'opndoor_referenced';
  const agentRailFor = (_a: Agency) => inOurEstate;
  /* HOW THIS AGENCY'S TENANTS ARE CHECKED. Matt, 2026-10-02, replacing
     the "Referrals from this agency" dropdown: two options, no "follow
     the default", "changing it asks for confirmation and applies to new
     referrals only, and is recorded in Recent changes."

     THE CONFIRMATION IS HERE AND THE RECORD IS IN SQL. A confirmation
     belongs to the screen -- it is about what the person is about to do
     -- and the audit row belongs to the setter, so every caller writes
     one. The third clause needs nothing built: changing the mode has
     always applied to new referrals only, because each application
     snapshots its own `referencing_mode` at creation. The confirmation
     says so, which is the part that was missing. */
  const doSetMode = (agencyId: string, name: string, mode: string) => {
    const toEligibility = mode === 'opndoor_referenced';
    askConfirm({
      title: `Change how ${possessive(name)} tenants are checked?`,
      body: toEligibility
        ? <>New referrals from {name} will go through eligibility: the tenant completes it before paying.
            Referrals already sent keep the route they were given. It is recorded in Recent changes.</>
        : <>New referrals from {name} will go straight to payment, because {name} has already referenced
            the tenant. Referrals already sent keep the route they were given. It is recorded in Recent changes.</>,
      confirmLabel: 'Change it',
      run: async () => {
        try { await setAgencyReferencingMode(agencyId, mode); refreshSession(); bump(); toast('Saved. It applies to new referrals.', 'ok'); }
        catch (e) { toast(e instanceof Error ? e.message : 'Could not save it.', 'error'); }
      },
    });
  };

  /* ---- DRILL-DOWN. The page opens at the top node expanded ONE level; clicking
     an agency expands it and scopes the Referrals section to it, clicking a branch
     scopes to the branch. `sel` is the scope, and the breadcrumb walks back. */
  type Tab = 'overview' | 'people' | 'reporting' | 'commission' | 'referrals';
  const [tab, setTab] = useState<Tab>('overview');

  type Sel = { level: 'group' | 'agency' | 'branch'; id: string; name: string };
  const [sel, setSel] = useState<Sel | null>(null);
  /* WHICH NODE IS OPEN AS A VIEW, if any. The tree is how you find a party; the
     view is where you act on one. A node's NAME opens its view and the tick
     beside it expands the tree, which is the ordinary tree idiom and what lets
     a branch be opened at all: a branch has nothing under it, so "expand" and
     "open" were the same click and the branch only ever got the first. */
  const [focus, setFocus] = useState<Sel | null>(null);
  /** Open a node's view, keeping the Referrals tab and its crumb in step. */
  const openNode = (level: 'agency' | 'branch', id: string, name: string) => {
    setSel({ level, id, name });
    setFocus({ level, id, name });
  };
  const selAgency = sel?.level === 'agency' ? sel.id : sel?.level === 'branch' ? (branchesFlat.find((x) => x.branch.id === sel.id)?.agency.id ?? null) : null;

  // An independent agency page opens AT its agency, expanded one level; a group
  // page opens at the group with its agencies collapsed.
  useEffect(() => {
    if (org?.kind === 'agency' && org.agency.id) setSel({ level: 'agency', id: org.agency.id, name: org.agency.name });
    else setSel(null);
  }, [org?.kind, org?.kind === 'agency' ? org.agency.id : org?.kind === 'group' ? org.group.id : '']);

  /* Every branch's payee lines, ONE call per page load. No client-side copy of
     the rule exists: this is the same function create_referral freezes.

     NOT ASKED FOR AT ALL unless this reader may be shown a figure. Both places
     these lines are drawn were already refused to a Manager, so nothing of this
     reached the screen, but a page that pulls the whole rate table into a
     Manager's browser and then declines to print it is one devtools tab away
     from the thing the level exists to prevent. Cleared rather than left behind,
     because a hydrate that answers sees_commission = false arrives after the
     first paint and bumps dataVersion. */
  const [splits, setSplits] = useState<Map<string, SplitLine[]>>(new Map());
  useEffect(() => {
    // Same Map back when there is nothing to clear, so refusing costs no render.
    if (!canSeeCommission) { setSplits((m) => (m.size ? new Map() : m)); return; }
    let alive = true;
    const ids = branchesFlat.map((x) => x.branch.id).filter(Boolean) as string[];
    getCommissionSplits(ids).then((m) => { if (alive) setSplits(m); }).catch(() => { if (alive) setSplits(new Map()); });
    return () => { alive = false; };
  }, [branchesFlat, dataVersion, tick, canSeeCommission]);

  // The negotiated agreement pricing this org, if there is one. Its bands, its
  // tiers and the rate the next referral lands at are the deal itself, and it is
  // only ever drawn on the Commission tab, so a reader without that tab does not
  // ask for it either.
  const [agreement, setAgreement] = useState<AgreementView | null>(null);
  /* ONE PER AGENCY, not one per page. A group page lists several agencies and
     each may be on its own deal, so a single piece of state can only ever be
     right about the first of them. The Commission tab keeps reading that first
     one, which is what it always showed; the Overview tree reads the map. */
  const [agreements, setAgreements] = useState<Record<string, AgreementView | null>>({});
  /* KEYED ON THE IDS, NOT ON THE ARRAY. `agencies` is rebuilt as a fresh array
     literal on every render (it is not memoised), so an effect depending on it
     runs every render. The single-agreement version got away with that because
     setAgreement(null) over an already-null value is a no-op React bails out
     of; a map is a new object every time, so it re-rendered, which re-ran the
     effect, which set a new object. The page span. */
  const agencyIdsKey = agencies.map((a) => a.id ?? a.name).join('|');
  useEffect(() => {
    if (!canSeeCommission) { setAgreement(null); setAgreements({}); return; }
    let alive = true;
    const ids = agencyIdsKey ? agencies.map((a) => a.id).filter(Boolean) as string[] : [];
    if (!ids.length) { setAgreement(null); setAgreements({}); return; }
    Promise.all(ids.map((id) => getAgreementForAgency(id).then((v) => [id, v] as const).catch(() => [id, null] as const)))
      .then((pairs) => {
        if (!alive) return;
        setAgreements(Object.fromEntries(pairs));
        setAgreement(pairs[0][1]);
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agencyIdsKey, dataVersion, tick, canSeeCommission]);

  // Deed readiness, the SAME answer the Agencies list uses, so the two surfaces
  // cannot disagree: one RPC, active people only, pending does not clear it.
  const [readiness, setReadiness] = useState<DeedReadiness | null>(null);
  useEffect(() => {
    let alive = true;
    getOrgDeedReadiness().then((r) => { if (alive) setReadiness(r); }).catch(() => { if (alive) setReadiness(null); });
    return () => { alive = false; };
  }, [dataVersion, tick]);
  /* AND WHETHER THERE IS ACTUALLY A DEED STUCK, which is the second half of
     the readiness question. Readiness says "could a deed reach somebody";
     this says "is one waiting". See data/deedsStuck.ts for why the warning
     needs both. Read off the hydrated book, so it costs no call. */
  const stuckDeeds = useMemo(() => deedsWithNowhereToGo(), [dataVersion, tick]);

  /* OPEN REFERRALS OF PEOPLE WHO HAVE LEFT, and who their deeds go to instead.

     Matt, 2026-10-03: "the agency page should say 'N open referrals from
     people who have left; deeds will go to [who]'."

     A THIRD QUESTION, not a variant of the two above it. Readiness asks
     "could a deed reach anybody here"; stuckDeeds asks "is one waiting";
     this asks "whose referrals are now somebody else's to receive" -- and
     the answer is reassuring rather than a warning, which is why it reads
     as a note and not as the blocked banner.

     THE SAME SHAPE AS READINESS, one call for every agency, because the
     answer walks the delivery ladder per referral and is resolved
     server-side. Absent means none, so an agency with nothing to say draws
     nothing. */
  const [departed, setDeparted] = useState<Map<string, DepartedReferrals> | null>(null);
  useEffect(() => {
    let alive = true;
    getOrgDepartedReferrals().then((d) => { if (alive) setDeparted(d); }).catch(() => { if (alive) setDeparted(null); });
    return () => { alive = false; };
  }, [dataVersion, tick]);
  /* ROLLED UP OVER THE AGENCIES THIS PAGE IS SHOWING, which is one for an
     agency and several for a group: the line is about the page, and a group
     whose two agencies each have one is telling the reader about two. */
  const departedHere = useMemo(() => {
    if (!departed) return null;
    const rows = agencies.map((a) => (a.id ? departed.get(a.id) : undefined)).filter(Boolean) as DepartedReferrals[];
    if (!rows.length) return null;
    return {
      count: rows.reduce((n, r) => n + r.count, 0),
      goesTo: [...new Set(rows.flatMap((r) => r.goesTo))].sort(),
    };
  }, [departed, agencies]);

  /* ---- per-node rate editor. Every level can hold a line now, including a
     branch. The editor previews the worst branch total the change produces and
     surfaces the 50% refusal from SQL verbatim. */
  const [editRow, setEditRow] = useState<string | null>(null); // '<level>:<id>'
  const [draftA, setDraftA] = useState('');
  const [savingRow, setSavingRow] = useState(false);
  const [rateErr, setRateErr] = useState('');
  const openRate = (rowKey: string, own: number | null | undefined) => {
    setEditRow(rowKey); setRateErr('');
    setDraftA(own == null ? '' : String(+(own * 100).toFixed(2)));
  };
  /* A refusal the administrator MAY overrule: putting a line over an all-in
     agreement below takes that agency's branches above the number it signed.
     SQL refuses it and will accept it with a deliberate confirmation, so the
     screen has to offer that confirmation — otherwise the rule reads as "you
     cannot", when what it means is "not by accident". Held here with the exact
     sentence SQL gave, both parties and both numbers named. */
  const [breach, setBreach] = useState<{ level: 'group' | 'agency' | 'branch'; id: string; message: string } | null>(null);

  const saveRate = async (level: 'group' | 'agency' | 'branch', id: string, confirmBreach = false) => {
    const a = pctToFrac(draftA);
    if (a === undefined) { toast('Enter a percentage between 0 and 100, or leave blank to clear.', 'error'); return; }
    setSavingRow(true); setRateErr('');
    try {
      await setNodeRate(level, id, a, confirmBreach);
      refreshSession(); bump(); setEditRow(null); setBreach(null);
      toast(a == null ? 'Rate cleared.' : 'Rate saved.', 'ok');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save the rate.';
      // "sits above ... all-in agreement" is the one refusal with a way through.
      if (!confirmBreach && /all-in agreement/i.test(msg)) setBreach({ level, id, message: msg });
      // The 50% rule lives in SQL; show exactly what it said.
      else setRateErr(msg);
    } finally { setSavingRow(false); }
  };

  /* doSetNotify and doSetTick lived here, one per tickbox column. Both are on
     the person's Notifications panel now, which owns the toast and the
     reload, so there is nothing for this page to hold. */

  // A pending person has not accepted; withdrawing the invitation removes them.
  const doCancelInvite = (userId: string, who: string) => {
    const q = personAsk('cancelInvite', who);
    askConfirm({
      ...q,
      run: async () => {
        try { await cancelInvite(userId); refreshSession(); bump(); toast(`Invitation to ${who} cancelled.`, 'ok'); }
        catch (e) { toast(e instanceof Error ? e.message : 'Could not cancel that invitation.', 'error'); }
      },
    });
  };

  /* THE SAME SET OF CONTROLS AS TEAM AND USERS, on every person.

     These four existed on /users and not here, so an admin looking at an agency
     could cancel an invitation and nothing else, and had to go and find the
     person again on another screen to reset their two-factor. One set, three
     places.

     No level check: every one of these is behind isAdmin, and opndoor staff sit
     above all three agency levels, so assert_may_act_on_user returns early for
     them. The ladder still refuses in SQL if this page is ever opened by someone
     who is not staff. */
  /* CHANGE LEVEL and POSITION, the two Team controls this page lacked. Level
     moves role and sees_commission together through set_agency_level; nothing
     else may, because updateUserRole moves only the role and would leave a
     demoted Director still reading as entitled to the money. */
  const [levelFor, setLevelFor] = useState<{ userId: string; name: string; current: string } | null>(null);
  const [levelPick, setLevelPick] = useState<AgencyLevel | null>(null);
  const [posFor, setPosFor] = useState<{ id: string; name: string } | null>(null);
  const [notifFor, setNotifFor] = useState<{ id: string; name: string } | null>(null);
  /* WALK FIX 15. This customer's own numbers, from the same function the
     estate-wide table uses, so the two cannot disagree.

     A GROUP PAGE IS SEVERAL CUSTOMERS, which is why this filters on a SET
     of names rather than one: an agency page can be showing a group, and
     then the honest answer is every agency in it, totalled by the tiles and
     broken down by the table. */
  const isOpndoorStaff = role === 'superadmin' || role === 'opndoor_manager';
  /* DOES AN AGENCY ON THIS ESTATE HAVE LOGINS AT ALL?

     Matt, 2026-10-03: "remove the People tab and '0 people' (supplier-estate
     agencies have no logins)."

     ASKED OF THE ESTATE THIS AGENCY IS IN, not of the reader: an Opndoor
     admin looking at Kestrel's Frost must see the same absence a Kestrel
     manager does, because the fact is about the agency. `partner` is the
     agency's own partner, resolved above. */
  const hasLogins = !partyIsSupplier(partner);
  const reportPeriods = getPeriods();
  const [reportPeriod, setReportPeriod] = useState(
    () => reportPeriods.find((p) => p.id === 'last12m') ?? reportPeriods[reportPeriods.length - 1],
  );
  const customerRows = useMemo(() => {
    if (!isOpndoorStaff) return [];
    const mine = new Set(agencies.map((a) => a.name));
    return liveByCustomer(role, ALL_PARTNERS, reportPeriod).filter((r) => mine.has(r.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpndoorStaff, role, reportPeriod, agencies, dataVersion]);

  /* WHO MAY OPEN WHOSE NOTIFICATIONS. The client twin of the server's
     `caller_may_set_for`: at or below you, and yourself. An admin is above
     everybody, so this is only ever load-bearing for an agency's own
     Director or Manager, who is drawn no other row action at all. */
  const actor: Actor = useMemo(
    () => ({ id: currentUserId, role, seesCommission }),
    [currentUserId, role, seesCommission],
  );
  const mayNotify = (r: { userId: string; role: string; seesCommission: boolean }) =>
    mayActOnOrEqual(actor, { id: r.userId, role: r.role as Role, seesCommission: r.seesCommission });

  /** Everywhere an admin could place somebody in THIS org: the same reach the
      Overview tree draws, so the picker cannot offer a node off this page. */
  const scopeTargets = useMemo<ScopeTarget[]>(() => {
    const out: ScopeTarget[] = [];
    // org is null while the page is still resolving; the same guard `title`,
    // `agencies` and `partner` above all use.
    if (org && org.kind === 'group' && org.group.id) {
      out.push({ id: org.group.id, name: org.group.name, kind: 'group' });
    }
    const several = agencies.length > 1;
    for (const a of agencies) {
      if (a.id) out.push({ id: a.id, name: a.name, kind: 'agency' });
      for (const b of a.branches ?? []) {
        if (b.id) out.push({ id: b.id, name: several ? `${a.name}, ${b.name}` : b.name, kind: 'branch' });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, agencies]);

  const doSetLevel = async () => {
    if (!levelFor || !levelPick) return;
    try {
      await setAgencyLevel(levelFor.userId, levelPick);
      refreshSession(); bump();
      toast(`${levelFor.name} is now a ${levelPick}.`, 'ok');
      setLevelFor(null); setLevelPick(null);
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not change that level.', 'error'); }
  };

  const doPersonAction = async (what: PersonAction, userId: string, who: string, email: string) => {
    const run = {
      remove: () => setUserStatus(userId, 'deactivated'),
      restore: () => setUserStatus(userId, 'active'),
      resend: () => resendInvite(userId),
      password: () => resetUserPassword(userId),
      mfa: () => resetUserMfa(userId),
      delete: () => deleteUser(userId),
    }[what];
    const done = {
      remove: `${who} no longer has access.`,
      restore: `${who} has access again.`,
      resend: resentLine(email),
      // Says what happened and nothing about the account, the same answer
      // whether or not the address turned out to be reachable.
      password: 'Password reset link sent.',
      mfa: `${who} will enrol a new authenticator at their next sign in.`,
      // Says what survived, because "deleted" on its own invites the question.
      delete: `${who} is off the People lists. Their name stays on their referrals.`,
    }[what];
    const go = async () => {
      try { await run(); refreshSession(); bump(); toast(done, 'ok'); }
      catch (e) { toast(e instanceof Error ? e.message : 'That did not work.', 'error'); }
    };
    /* IT ASKS FIRST, FOR EVERYTHING BUT A RESEND. Matt, 2026-10-03: "Every
       action that changes something asks first, in plain words". This page
       ran all five on the click -- so "Remove access", one word away from
       "Reset two-factor" in a row of six quiet links, signed somebody out
       and banned their account with nothing in between. The words are
       personAsk's, shared with the other three People surfaces.

       A RESEND IS THE EXCEPTION, and it is not in Matt's list: it sends the
       same invitation again and changes nothing about the person. */
    if (what === 'resend') { await go(); return; }
    askConfirm({ ...(what === 'delete' ? deleteAsk(who) : personAsk(what, who)), run: go });
  };

  /* THE DEED-RECIPIENT NOMINATION IS GONE (20261006160000). It answered "this
     branch has nobody obvious"; the referrer answers that better and is always
     there, so the override was dropped from deed_people_target and the control
     that set it had nothing left to do. branch_deed_recipient and its two RPCs
     are left in the schema holding what people nominated, unread. */

  if (!org) {
    return (
      <>
        <div className="page-head"><div>
          <div className="page-head__eyebrow">Agencies</div>
          <h1 className="page-head__title">Agency not found</h1>
          <p className="page-head__sub">This group or agency is not in your view, or the link is out of date.</p>
        </div></div>
        <Card><CardBody><Link className="ah-back" to="/agencies"><Icon name="arrowLeft" size={14} /> Back to agencies</Link></CardBody></Card>
      </>
    );
  }

  const branchCount = branchesFlat.length;
  /* THE SCOPE RULE, on this page's own tree rather than on the viewer's book.
     An admin looking at a one-office agency should not be offered an Office
     column or a Branch filter that can only ever hold one value, which is the
     rule Team and the Referring agent card already follow. Counted off the org
     being shown, because that is the thing these columns describe. */
  const manyOffices = branchCount > 1;
  const manyAgencies = agencies.length > 1;
  const statusBadge = org.kind === 'group' ? 'Group' : 'Agency';

  /* BY ID, since 2026-10-02. A name is not an identity across estates,
     and this page is looking at one agency ROW, which knows its own id.
     The name is the fallback for a row that has none yet. */
  const goApplications = (agencyName: string) => {
    const a = agencies.find((x) => x.name === agencyName);
    return a?.id
      ? `/applications?agencyId=${encodeURIComponent(a.id)}`
      : `/applications?agency=${encodeURIComponent(agencyName)}`;
  };

  /* The worst branch total a pending edit would produce, answered by SQL
     (commission_preview) with the draft substituted into the same rule that will
     judge the save. Debounced so typing does not chatter. */
  const [preview, setPreview] = useState<{ worstTotal: number; worstBranch: string | null } | null>(null);
  useEffect(() => {
    if (!editRow) { setPreview(null); return; }
    const [level, id] = editRow.split(':');
    const draft = pctToFrac(draftA);
    if (draft === undefined) { setPreview(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      previewNodeRate(level as 'group' | 'agency' | 'branch', id, draft)
        .then((p) => { if (alive) setPreview(p); })
        .catch(() => { if (alive) setPreview(null); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [editRow, draftA]);

  /* ---- A node's OWN commission line. Shown ONLY where a rate is explicitly set:
     an inheriting node shows no chip at all, because repeating an inherited figure
     on every branch was what made the old page unreadable. */
  /* ---- RENDER HELPERS, CALLED AND NOT MOUNTED -------------------------
     These five are defined inside AgencyHome because they close over most of
     its state. That is fine as long as they are CALLED — {RateLine({...})} —
     and never written as JSX elements.

     Written <RateLine />, React sees a brand-new component TYPE on every render
     of this page (the function identity changes each time), so it unmounts and
     remounts the whole subtree instead of updating it. The page then flickers on
     hover and every click dies: the element the mousedown landed on is destroyed
     before the mouseup, so no click event is ever produced. Set rate, the branch
     rows and the people pills were all dead for exactly this reason.

     None of them uses a hook, which is what makes calling them safe: a hook
     inside one would then be running conditionally. If you add state to one of
     these, hoist it to module scope with explicit props rather than putting the
     angle brackets back. */
  const RateLine = ({ level, id, name, own, deal, onCommissionTab }: {
    level: 'group' | 'agency' | 'branch'; id?: string; name: string; own?: number | null;
    deal?: AgreementView | null;
    /** Drawn on the Commission tab, which is the one place a rate is set. */
    onCommissionTab?: boolean;
  }) => {
    if (!canSeeCommission) return null;
    const rowKey = id ? `${level}:${id}` : undefined;
    const editing = !!rowKey && editRow === rowKey;
    /* A RATE CANNOT BE SET ALONGSIDE AN AGREEMENT, so the control that would
       set one is replaced by the deal itself. Set rate used to be offered here
       regardless, and the refusal only arrived after the round trip, from the
       trigger that owns the rule. Saying what the party is actually on, and
       pointing at the tab that can change it, is the honest form of the same
       information. */
    const summary = agreementSummary(deal);
    if (summary && !editing) {
      return (
        <span className="ah-comm-wrap">
          <button className="ah-linkbtn ah-agreement-sum" onClick={() => setTab('commission')} title="Open the Commission tab">
            {summary}
          </button>
        </span>
      );
    }
    const on = level === 'group' ? 'referrals through this group'
      : level === 'branch' ? 'referrals from this branch'
      : 'its referrals';
    const worst = editing ? preview?.worstTotal ?? null : null;
    return (
      <span className="ah-comm-wrap">
        {own != null && (
          <span className="ah-chip" title={`Paid to ${name}`}>
            Earns <b>{pctLabel(own)}</b> of the guarantee fee on {on} · paid to {name}
          </span>
        )}
        {/* ONE PLACE TO SET COMMISSION, and it is the Commission tab.
            Matt, 2026-10-02. `RateLine` is called from both the Overview
            tree and that tab, so the button is gated on where it is
            being drawn rather than removed: the tab keeps it, the tree
            shows the figure and a way to the tab. A second control for
            one setting is two places for it to be half-changed. */}
        {isAdmin && rowKey && !editing && onCommissionTab && (
          <button className="ah-linkbtn" onClick={() => openRate(rowKey, own)}>{own != null ? 'Change rate' : 'Set rate'}</button>
        )}
        {isAdmin && rowKey && !editing && !onCommissionTab && (
          <button className="ah-linkbtn" onClick={() => setTab('commission')} title="Open the Commission tab">
            {own != null ? 'Change on Commission' : 'Set on Commission'}
          </button>
        )}
        {editing && id && (
          <span className="ah-rate-edit">
            <label>Rate <input inputMode="decimal" value={draftA} autoFocus onChange={(e) => setDraftA(e.target.value)} placeholder="none" />%</label>
            {worst != null && (
              <span className={`ah-rate-preview${worst > 0.5 ? ' is-over' : ''}`}>
                Worst branch total: <b>{pctLabel(worst)}</b>
                {preview?.worstBranch ? ` (${preview.worstBranch})` : ''}
                {worst > 0.5 ? ', over the 50% limit' : ''}
              </span>
            )}
            <button className="ah-linkbtn" onClick={() => { void saveRate(level, id); }} disabled={savingRow}>{savingRow ? '…' : 'Save'}</button>
            <button className="ah-linkbtn ah-linkbtn--quiet" onClick={() => setEditRow(null)}>Cancel</button>
            <span className="ah-rate-hint">Leave blank to clear.</span>
            {rateErr && <span className="ah-rate-err" role="alert">{rateErr}</span>}
          </span>
        )}
      </span>
    );
  };

  /* ---- PEOPLE. One table of everyone in the org, filterable. Scoped to this org
     and, through getUsers, to the caller's own reach. */
  const PeopleTab = () => {
    const uniq = (xs: string[]) => [...new Set(xs.filter((x) => x && x !== EMPTY))].sort();
    const set = (k: keyof typeof pFilter, v: string) => setPFilter((f) => ({ ...f, [k]: v }));
    return (
      <Card>
        <CardHead
          title="People"
          sub={`${peopleShown.length} of ${peopleRows.length} shown`}
          /* ONE INVITE BUTTON, offering all three levels, because an admin
             adding somebody to an agency is not adding them to a node. The old
             one appeared on a group only and said "Invite a group director",
             so staffing an ordinary agency from here was not possible at all:
             it had to be done from a node in the Overview tree or from /users. */
          actions={isAdmin
            ? <button className="ah-linkbtn" onClick={() => setInvite({
                level: org.kind === 'group' ? 'group' : 'brand',
                partner,
                groupId: org.kind === 'group' ? org.group.id : undefined,
                agencyId: org.kind === 'group' ? undefined : agencies[0]?.id,
                name: org.kind === 'group' ? org.group.name : (agencies[0]?.name ?? 'this agency'),
                chooseLevel: true,
              })}>Invite someone</button>
            : undefined}
        />
        <CardBody>
          <div className="ah-filters">
            <input className="ah-filter-q" type="text" placeholder="Search name or email" value={pFilter.q} onChange={(e) => set('q', e.target.value)} />
            {/* LEVEL IS THE PERSON, not the node. This filtered on group /
                agency / branch, which is where somebody sits, under a label
                that reads as what they are. Two different questions had the
                same word and only the wrong one was askable. */}
            <select className="sel" value={pFilter.level} onChange={(e) => set('level', e.target.value)} aria-label="Level">
              <option value="">All levels</option>
              {AGENCY_LEVELS.map((l) => <option key={l.level} value={l.level}>{l.level}</option>)}
            </select>
            {/* Agency and Branch follow the scope rule: a filter that can only
                hold one value is a control that cannot do anything. */}
            {manyAgencies && (
              <select className="sel" value={pFilter.agency} onChange={(e) => set('agency', e.target.value)} aria-label="Agency">
                <option value="">All agencies</option>
                {uniq(peopleRows.map((r) => r.agency)).map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            )}
            {manyOffices && (
              <select className="sel" value={pFilter.branch} onChange={(e) => set('branch', e.target.value)} aria-label="Office">
                <option value="">All offices</option>
                {uniq(peopleRows.map((r) => r.branch)).map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            )}
            <select className="sel" value={pFilter.status} onChange={(e) => set('status', e.target.value)} aria-label="Status">
              <option value="">Any status</option>
              <option value="active">Active</option><option value="pending">Pending</option>
              {/* Deactivated was missing, so Restore access would have landed on
                  rows nobody could filter to: the only way to find a person you
                  had just removed was to scroll the whole org. */}
              <option value="deactivated">No access</option>
            </select>
            {(pFilter.q || pFilter.level || pFilter.agency || pFilter.branch || pFilter.status) && (
              <button className="ah-linkbtn ah-linkbtn--quiet" onClick={() => setPFilter({ level: '', position: '', agency: '', branch: '', status: '', q: '' })}>Clear filters</button>
            )}
          </div>
          {/* THE SHARED TABLE, same columns as every other people screen.
              Matt, 2026-10-01. Agency and Office were two columns here and
              one everywhere else; the office is the column, with the agency
              under it when several are in view, so the rows line up with
              the supplier tab and the opndoor team page.

              AND ITS LAST TWO COLUMNS, 2026-10-02: "Use the same shared
              people table as every other people screen, with Sees and Last
              active (or 'Invited [date]' for pending invites)." The table
              had both already -- the supplier tab passes them -- and this
              tab passed neither, so on a single-office agency like New
              Independent it drew three columns: Name, Level and Status.

              THE OFFICE COLUMN IS CONDITIONAL, and the condition moved
              into the table on the same day: it is drawn when the rows
              differ, which is why a single-office agency like New
              Independent still has no Office column and why the supplier
              tab has none at all. The reasoning is beside the rule in
              PeopleTable. */}
          <PeopleTable
            showFilters={false}
            extraHeader="Sees"
            rows={peopleShown.map((r) => ({
              id: r.userId,
              name: r.name,
              email: r.email,
              level: r.agencyLevel,
              extra: agencySees(r.role, r.level, r.seesCommission),
              /* WHERE THEY SIT, in Matt's words of 2026-10-02: the branch
                 name at a branch, "Whole agency" at the agency, "Whole
                 group" above one. It passed `r.branch`, which is a hyphen
                 for anybody not positioned at a branch -- so on a
                 two-office agency like Northgate the agency-level manager
                 read "-" where every colleague read an office name.

                 AND THE manyOffices GATE IS GONE FROM HERE, into
                 PeopleTable, where it is now "show it when the rows
                 differ" -- the reason behind this morning's "only when
                 the agency has more than one office" rather than the
                 proxy for it. New Independent still gets no Office
                 column; Regent's, which has one office and people at two
                 levels, now gets one and matches its own Team page. The
                 argument is in full beside the rule. */
              office: officeOf(r.level, r.branch),
              /* AND THE AGENCY UNDER IT, but only when there is one: a
                 group-level person belongs to no agency, and `r.agency` is
                 the same hyphen for them. */
              officeSub: manyAgencies && r.agency !== EMPTY ? r.agency : null,
              status: r.status,
              lastActive: r.lastActive,
              actions: (
                <PersonActions
                  person={r}
                  isAdmin={isAdmin}
                  manyOffices={manyOffices}
                  onAction={(what, id, who, email) => void doPersonAction(what, id, who, email)}
                  onCancelInvite={(id, who) => void doCancelInvite(id, who)}
                  onChangeLevel={(p) => { setLevelPick(null); setLevelFor(p); }}
                  onPosition={setPosFor}
                  onNotifications={setNotifFor}
                  mayNotify={mayNotify(r)}
                />
              ),
            }))}
          />
        </CardBody>
      </Card>
    );
  };

  /* ---- ONE NODE, OPENED. -------------------------------------------------

     The tree used to answer every question inline: click a branch and its
     people PILLS appeared under it, with the deed-recipient line beside them.
     Pills are a summary and cannot carry an action, so the only way to change
     anything about a branch's people was to leave the Overview for the People
     tab and filter it back down to that branch by name.

     This is the drill-down. It is the same people, at the depth where you can
     act on them: the People table's own row actions, the branch's own rate and
     what a referral there pays out, its nominated deed recipient, and its
     referrals. The tree stays exactly as it was for scanning; the tick expands
     it and the name opens this.

     CALLED, NOT MOUNTED, like the helpers above, and it uses no hook. */
  const NodeView = () => {
    if (!focus || focus.level === 'group') return null;
    const isBranch = focus.level === 'branch';
    const found = isBranch ? branchesFlat.find((x) => (x.branch.id ?? x.branch.name) === focus.id) : undefined;
    const branch = found?.branch;
    const agency = isBranch ? found?.agency : agencies.find((a) => (a.id ?? a.name) === focus.id);
    // The org can change under an open view (a branch deleted, a group edited).
    // Falling back to the tree is better than a panel about nothing.
    if (!agency || (isBranch && !branch)) return null;

    /* BY ID, not by name. The People tab filters its Office select on the
       branch NAME, so two branches called "Head Office" under different
       agencies select together; the id is already on every row. */
    const rows = peopleRows.filter((r) => (isBranch
      ? (branch?.id ? r.branchId === branch.id : r.branch === focus.name)
      : r.level === 'agency' && (agency.id ? r.agencyId === agency.id : r.agency === agency.name)));
    const refs = isBranch
      ? referrals.filter((r) => r.branch === focus.name)
      : referrals.filter((r) => r.agency === agency.name);
    const branchReady = isBranch && branch?.id ? readiness?.branches.get(branch.id) : undefined;
    const inviteCtx: InviteContext = isBranch
      ? { level: 'branch', partner, branchId: branch?.id, name: focus.name }
      : { level: 'brand', partner, agencyId: agency.id, name: agency.name, chooseLevel: true };

    return (
      <Card>
        <CardHead
          title={focus.name}
          sub={isBranch ? `Office of ${agency.name}` : (org.kind === 'group' ? `Agency in ${org.group.name}` : 'Agency')}
          actions={<button className="ah-linkbtn ah-linkbtn--quiet" onClick={() => setFocus(null)}>Back to the tree</button>}
        />
        <CardBody>
          {/* WHAT THIS PARTY IS ON. The same line the tree carries, so the two
              cannot say different things about one branch. */}
          <div className="ah-nv-rate">
            {RateLine({
              level: focus.level, id: isBranch ? branch?.id : agency.id, name: focus.name,
              own: isBranch ? branch?.agentRate : agency.agentRate,
              deal: !isBranch && agency.id ? agreements[agency.id] : null,
            })}
          </div>
          {canSeeCommission && isBranch && branch?.id && splits.has(branch.id) && (
            <div className="ah-payout">{payoutSentence(splits.get(branch.id)!)}</div>
          )}

          {/* WHO RECEIVES A DEED FROM THIS OFFICE. The nominated recipient is
              gone (20261006160000): a deed goes to the person who sent the
              referral, which is a fact about the referral and not about the
              branch, so there is nothing here to nominate. What a BRANCH can
              still lack is somebody to catch a referral whose referrer has
              left, and that is what the warning below is about now. */}
          {isBranch && (
            <>
              <div className="ah-deed">
                Deeds from this office go to whoever sent the referral. Anyone ticked for
                notifications at this office, its agency or its group is copied.
              </div>
              {agentRailFor(agency) && branchReady === false && (
                <div className="ah-deed-warn"><Icon name="alert" size={14} /> Nobody here could catch a referral whose sender has left. Invite a manager, or tick somebody for notifications.</div>
              )}
            </>
          )}

          <h3 className="ah-nv-h">{isBranch ? 'People at this office' : 'People at agency level'}</h3>
          {rows.length === 0 ? (
            <div className="ah-empty">
              Nobody {isBranch ? 'at this office' : 'at agency level'} yet.
              {!isBranch && ' People placed at an office appear on that office.'}
            </div>
          ) : (
            /* The node view's people, on the same shared table as the
               People tab above it: this one lists who sits at the office or
               agency in focus, which is a narrower question and not a
               different layout. */
            <PeopleTable
              showFilters={false}
              extraHeader="Sees"
              rows={rows.map((r) => ({
                id: r.userId,
                name: r.name,
                email: r.email,
                level: r.agencyLevel,
                extra: agencySees(r.role, r.level, r.seesCommission),
                status: r.status,
                lastActive: r.lastActive,
                actions: (
                  <PersonActions
                    person={r}
                    isAdmin={isAdmin}
                    manyOffices={manyOffices}
                    onAction={(what, id, who, email) => void doPersonAction(what, id, who, email)}
                    onCancelInvite={(id, who) => void doCancelInvite(id, who)}
                    onChangeLevel={(p) => { setLevelPick(null); setLevelFor(p); }}
                    onPosition={setPosFor}
                    onNotifications={setNotifFor}
                    mayNotify={mayNotify(r)}
                  />
                ),
              }))}
            />
          )}
          {isAdmin && (
            <div className="ah-nv-invite">
              <button className="ah-linkbtn" onClick={() => setInvite(inviteCtx)}><Icon name="send" size={12} /> Invite someone to {focus.name}</button>
            </div>
          )}

          <h3 className="ah-nv-h">Referrals</h3>
          {refs.length === 0 ? (
            <div className="ah-empty">No referrals from {focus.name} yet.</div>
          ) : (
            <table className="dt ah-table">
              <thead><tr><th>Tenant</th>{!isBranch && <th>Branch</th>}<th>Stage</th></tr></thead>
              <tbody>
                {refs.slice(0, 12).map((r) => (
                  <tr key={r.ref}>
                    <td><Link className="ah-tenant" to={`/applications/${encodeURIComponent(r.ref)}`}><span className="who__av">{initials(r.tenant)}</span><span><span className="dt__name">{r.tenant}</span><span className="dt__sub">{r.ref}</span></span></Link></td>
                    {!isBranch && <td className="soft">{r.branch}</td>}
                    <td><span className={`ah-st ${applicationStageClass(r)}`}>{applicationStatusLabel(r)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    );
  };

  /* ---- COMMISSION. Rates that are actually SET, and what each branch pays out.
     Both read the split SQL resolved; nothing is recomputed here. */
  /* ONE CARD PER PARTY, and the party's deal is EDITABLE on it. The Commission
     tab used to describe an agreement it could not change, and said so in a
     sentence — "Negotiated agreements are set by Opndoor" — that was true only
     in the sense that Opndoor had to open a psql prompt to do it. An admin edits
     it here; every rule and every refusal still belongs to SQL. */
  const editAgreementFor = (lvl: 'group' | 'agency' | 'branch', nodeId: string, nodeName: string) =>
    setEditAgreement({ level: lvl, id: nodeId, name: nodeName });

  const AgreementPanel = () => {
    // The party the Agreement card is about. An agency page's agreement may sit
    // on the agency or on the group above it; edit the one that actually prices.
    const target: { level: 'group' | 'agency'; id: string; name: string } | null =
      agreement && !agreement.isStandard && agreement.scopeLevel === 'group' && group?.id
        ? { level: 'group', id: group.id, name: group.name }
        : agencies[0]?.id ? { level: 'agency', id: agencies[0].id, name: agencies[0].name } : null;
    const editBtn = isAdmin && target
      ? <Button variant="ghost" size="sm" onClick={() => editAgreementFor(target.level, target.id, target.name)}>
          <Icon name="edit" size={13} /> {agreement && !agreement.isStandard ? 'Edit' : 'Set a deal'}
        </Button>
      : null;

    if (!agreement || agreement.isStandard) {
      return (
        <Card>
          <CardHead title="Agreement" sub="Standard terms" actions={editBtn} />
          <CardBody>
            <p className="ah-agr__std">
              This org is on standard terms: the guarantee fee is one month's rent and the agency earns
              the Opndoor standard rate. A negotiated deal is the exception, and is set here.
            </p>
          </CardBody>
        </Card>
      );
    }
    const pct = (r: number | null) => (r == null ? 'standard' : pctLabel(r));
    const band = (b: AgreementView['bands'][number]) =>
      `${b.min}${b.max == null ? '+' : b.max > b.min ? `-${b.max}` : ''} ${plural(b.max ?? 0, 'tenant')}`;

    /* THE DEAL IN ONE LINE, IN THE WORDS IT WAS AGREED IN.

       Matt, 2026-10-03: "Replace 'Negotiated · additive · volume counted per
       agency per year' and the 'Additive: …' paragraph with one line, e.g.
       'Agreed deal: 1 tenant pays 3 weeks' rent and we pay 20%; 2 or more pay
       5 weeks and we pay 25%.'"

       The subtitle was three pieces of our own vocabulary -- negotiated,
       additive, counting scope -- none of which is a term of the deal, and
       the paragraph under it explained one of those three words. Neither
       said what had been agreed. `dealWords` is the sentence the editor's own
       preview shows while somebody is agreeing it, so the card now says back
       what they typed, rather than describing the record it was stored in. */
    const agreed = dealWords(agreement.bands.map((b) => ({ ...b, unit: b.unit ?? 'weeks' })), agreement.tiers);

    /* WHETHER ANYBODY ELSE IS ACTUALLY PAID. Matt: "Show 'Other offices or
       the group above are also paid on top' only when that's actually the
       case." "Additive" was printed on every negotiated deal, and on the
       ordinary one -- a single agency, nobody else holding a rate -- it
       warned about an addition that does not happen. The test is whether
       some OTHER node in this org holds an explicit rate. */
    const othersPaid = agreement.coverage !== 'all_in' && (
      (group?.agentRate ?? null) != null
      || agencies.some((a) => a.id !== target?.id && a.agentRate != null)
      || agencies.some((a) => (a.branches ?? []).some((b) => b.agentRate != null))
    );

    /* AND THE VOLUME HALF ONLY WHERE VOLUME MOVES THE DEAL. Matt: "Show the
       volume 'Counter' and 'next referral lands at' only when the deal
       changes with volume". Without tiers the counter is a number that
       changes nothing, printed beside a "next referral lands at" that is the
       same as the last one. */
    const byVolume = agreement.tiers.length > 0;
    const periodWord = { week: 'this week', month: 'this month', year: 'this year' }[agreement.period] ?? 'in total';
    return (
      <Card>
        <CardHead title="Agreement" actions={editBtn} />
        <CardBody>
          {agreement.note && <p className="ah-agr__note">{agreement.note}</p>}
          <p className="ah-agr__std"><b>Agreed deal:</b> {agreed}</p>
          {/* An all-in deal is the whole commission for everything beneath it.
              Showing the bands without saying so describes half the deal, and
              somebody will then wonder why a branch rate cannot be set. */}
          {agreement.coverage === 'all_in' && (
            <p className="ah-agr__std">
              This is the entire commission for every office under this agency. No office below may hold a
              rate of its own. A rate set above, at the group, still adds.
            </p>
          )}
          {othersPaid && (
            <p className="ah-agr__std">Other offices or the group above are also paid on top.</p>
          )}
          <table className="dt ah-table">
            <thead><tr><th>Deal shape</th><th>Fee</th><th>Rate</th></tr></thead>
            <tbody>
              {agreement.bands.map((b) => (
                <tr key={`${b.min}-${b.max ?? 'up'}`}>
                  <td className="dt__name">{band(b)}</td>
                  <td>{b.weeks} weeks of rent</td>
                  <td>{pct(b.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {agreement.tiers.length > 0 && (
            <>
              <div className="ah-agr__sub">Volume tiers</div>
              <table className="dt ah-table">
                <thead><tr><th>Paid applications</th><th>Rate</th></tr></thead>
                <tbody>
                  {agreement.tiers.map((t) => (
                    <tr key={t.from}>
                      <td className="dt__name">{t.from}{t.to == null ? ' and above' : `-${t.to - 1}`}</td>
                      <td>{pctLabel(t.rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {/* THE COUNTER, WHERE IT MEANS SOMETHING, AND AS A SENTENCE. Matt:
              "worded as '18 referrals so far this year; the next is paid at
              20%', with dates as '23 Sep 2026'." It was two labelled figures
              -- "Counter: 18 paid since 2026-09-23" and "The next referral
              lands at 3 weeks · 20%" -- which is the mechanism in two halves
              and an ISO date, on a card an agency's Director reads. */}
          {byVolume && (
            <div className="ah-agr__now">
              {agreement.volumes.length > 1 ? (
                /* ONE COUNTER, OR ONE PER ROUTE. An agency is never duplicated
                   per supplier, so an agency doing business under two of them
                   is one party with two counters and the pooled total would be
                   wrong in both directions: volume bought through one supplier
                   would pay for a better band with the other. Almost every
                   agency has a single route, and then this reads exactly as the
                   single sentence below. */
                <div>
                  {agreement.volumes.map((v) => (
                    <div key={v.routeId}>
                      <b>{v.count}</b> {plural(v.count, 'referral')} through {v.route} {periodWord}
                    </div>
                  ))}
                  <div className="soft">
                    The next is paid at <b>{pct(agreement.nextRate)}</b>
                    {agreement.periodStart ? <> · counting from {formatDate(agreement.periodStart)}</> : null}
                  </div>
                </div>
              ) : (
                <div>
                  <b>{agreement.volume}</b> {plural(agreement.volume, 'referral')} so far {periodWord};
                  {' '}the next is paid at <b>{pct(agreement.nextRate)}</b>
                  {agreement.periodStart ? <span className="soft"> · counting from {formatDate(agreement.periodStart)}</span> : null}
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>
    );
  };

  const CommissionTab = () => {
    // A live negotiated agreement prices this agency, so "no rate set" means
    // something quite different from "earns the standard".
    const negotiated = !!agreement && !agreement.isStandard;
    /* EVERY NODE, NOT ONLY THE ONES WITH A RATE. Matt, 2026-10-02: "The
       'Set rate' button beside the agency name: if commission is set on
       the Commission tab, remove it so there's one place to set
       commission."

       It was two places, and this tab was the lesser of them: it listed
       the rates that WERE set, so the only way to set a first one was
       the button in the Overview tree. Taking that button away without
       this change would have removed the capability rather than moved
       it.

       So the table lists the group, the agencies and the branches, each
       with its own RateLine -- which already says "Set rate" where there
       is none and "Change rate" where there is one. An inheriting row
       says so in words rather than showing a figure, because repeating
       an inherited number on every branch is what made the old page
       unreadable. */
    const set: { level: 'group' | 'agency' | 'branch'; id?: string; name: string; rate: number | null }[] = [];
    if (group) set.push({ level: 'group', id: group.id, name: group.name, rate: group.agentRate ?? null });
    agencies.forEach((a) => {
      set.push({ level: 'agency', id: a.id, name: a.name, rate: a.agentRate ?? null });
      (a.branches ?? []).forEach((b) => {
        set.push({ level: 'branch', id: b.id, name: b.name, rate: b.agentRate ?? null });
      });
    });
    /* THE SUBTITLE COUNTED THE ROWS, NOT THE RATES. Matt, 2026-10-03:
       "remove '2 rates explicitly set' when both rows say 'Inherits'."
       `set` became every node on 2026-10-02, so that a first rate could be
       set from this tab -- and the sentence above it went on counting the
       list, which now includes every inheriting branch. Two rows both
       reading "Inherits" were announced as two rates explicitly set. */
    const explicit = set.filter((r) => r.rate != null).length;
    return (
      <>
        {AgreementPanel()}
        <Card>
          <CardHead
            title="Rates set"
            sub={explicit
              ? `${explicit} ${plural(explicit, 'rate')} explicitly set`
              : negotiated
                ? 'No explicit rate is set: this agency is priced by its agreement'
                : 'No rate is set anywhere; every branch earns the Opndoor standard'}
          />
          <CardBody style={{ padding: 0 }}>
            {set.length === 0 ? (
              <div className="ah-empty">
                {/* An agreement party has no explicit rate BY DESIGN — one rate
                    per party — so "nothing is set" read as "they earn 10%" on an
                    agency earning 20%. */}
                {negotiated
                  ? <>No explicit rate is set, and none may be: this agency is priced by its agreement above.</>
                  : <>Nothing is set. Every branch below pays the Opndoor standard to its agency.</>}
              </div>
            ) : (
              <table className="dt ah-table">
                <thead><tr><th>Paid to</th><th>Level</th><th>Rate</th><th /></tr></thead>
                <tbody>
                  {set.map((r) => (
                    <tr key={`${r.level}:${r.id}`}>
                      <td className="dt__name">{r.name}</td>
                      <td className="soft">{r.level}</td>
                      <td>
                        {r.rate == null
                          ? <span className="soft">Inherits</span>
                          : <><b>{pctLabel(r.rate)}</b> of the guarantee fee</>}
                      </td>
                      {/* NO "SET RATE" HERE ANY MORE. Matt, 2026-10-03:
                          "remove the 'Set rate' buttons (deals are set with
                          'Set a deal')." A rate set per node and a deal are
                          two ways to price the same party, and the deal is
                          the one that can say what was actually agreed.
                          "Change rate" STAYS where a rate already exists: a
                          figure somebody can see and cannot correct is worse
                          than either, and Matt named the Set button. */}
                      <td className="num">{r.rate == null ? null : RateLine({ level: r.level, id: r.id, name: r.name, own: r.rate, onCommissionTab: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHead title="What each branch pays out" sub="Every payee on a referral made here, added up" />
          <CardBody style={{ padding: 0 }}>
            {branchesFlat.length === 0 ? (
              <div className="ah-empty">No branches yet, so there is nothing to pay out against.</div>
            ) : (
              <table className="dt ah-table">
                <thead><tr><th>Branch</th><th>Pays out</th><th>Total</th></tr></thead>
                <tbody>
                  {branchesFlat.map(({ agency: a, branch: b }) => {
                    const lines = b.id ? splits.get(b.id) ?? [] : [];
                    const total = lines.reduce((t, l) => t + l.rate, 0);
                    // The rule says where each rate came from; the screen must
                    // never infer it. "no explicit rate" is true of a standard
                    // line AND of an agreement line, which is how 20% came to be
                    // captioned "Opndoor standard".
                    const soleLine = lines.length === 1 ? lines[0] : null;
                    return (
                      <tr key={b.id ?? b.name}>
                        <td className="dt__name">{b.name}<span className="dt__sub">{a.name}</span></td>
                        <td>
                          {lines.length === 0 ? <span className="soft">{EMPTY}</span>
                            : soleLine
                              ? <>{SOURCE_LABEL[soleLine.source]} {pctLabel(soleLine.rate)} · paid to {soleLine.orgName}</>
                              : lines.map((l, i) => (
                                  <span key={`${l.level}:${l.orgId ?? l.orgName}`}>
                                    {i > 0 ? ' + ' : ''}{l.orgName} {pctLabel(l.rate)}
                                  </span>
                                ))}
                        </td>
                        <td><b>{pctLabel(total)}</b></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
        {/* WHAT THIS AGENCY ACTUALLY EARNED, under the rates above. The rate
            cards say what the deal is; this says what it produced, month by
            month, and it is the identical component the agency's own manager
            reads on Reporting — one rendering, so admin and customer cannot be
            shown different numbers for the same month. */}
        <CommissionStatement
          role={role}
          scope={partner}
          orgId={agencies.length === 1 ? (agencies[0]?.id ?? null) : null}
          title="What they earned"
        />
      </>
    );
  };

  const PeopleInline = ({ level, list, ctx }: { level: Level; list: Placed[]; ctx: InviteContext }) => (
    <div className="ah-node-people">
      {list.map((p) => (
        <span key={p.userId} className="ah-chip-person" title={p.email}>
          <span className="ah-av">{initials(p.name || p.email)}</span>{p.name || p.email}<span className="ah-role">{levelLabelFor(p)}</span>
        </span>
      ))}
      {isAdmin && <button className="ah-linkbtn ah-invite-inline" onClick={() => setInvite(ctx)}><Icon name="send" size={12} /> {inviteLabelFor(level)}</button>}
    </div>
  );

  return (
    <>
      {confirmEl}
      <div className="page-head" style={{ alignItems: 'center' }}>
        <div>
          <Link className="ah-back" to="/agencies"><Icon name="arrowLeft" size={14} /> Agencies</Link>
          <h1 className="page-head__title" style={{ marginTop: 8 }}>{title}</h1>
          {/* Each figure is the way into the tab that explains it. */}
          <p className="page-head__sub ah-sub">
            <Pill variant={org.kind === 'group' ? 'sent' : 'paid'}>{statusBadge}</Pill>
            <span className="ah-figs">
              {org.kind === 'group' && (
                <>
                  <button className="ah-fig" onClick={() => setTab('overview')}>
                    <b>{agencies.length}</b> {plural(agencies.length, 'agency')}
                  </button>
                  <span className="ah-fig-sep">·</span>
                </>
              )}
              {/* NM-P. "No '1 branch'", in Matt's own words. The figure and
                  its separator go together: leaving the separator prints a
                  stray dot between People and Referrals. A group keeps the
                  figure, because a group of single-office agencies still
                  has several offices and the count is about the group. */}
              {showsOffices(title, partner) && (
                <>
                  <button className="ah-fig" onClick={() => setTab('overview')}>
                    <b>{branchCount}</b> {plural(branchCount, 'branch')}
                  </button>
                  <span className="ah-fig-sep">·</span>
                </>
              )}
              {/* NO PEOPLE ON A SUPPLIER'S AGENCY, so no figure and no tab.
                  Matt, 2026-10-03: "remove the People tab and '0 people'
                  (supplier-estate agencies have no logins)."

                  AND HE IS RIGHT THAT IT IS STRUCTURAL rather than empty:
                  `create_invited_user` refuses a developer off the supplier
                  rail and `user_must_hold_a_position` returns early there,
                  because on that rail the SUPPLIER's own staff do the
                  referring and its agencies never get logins at all. So "0
                  people" is not a count that might one day be 1; it is a
                  question that does not apply, and a tab behind it opens an
                  empty list with an Invite button that could only fail. */}
              {hasLogins && (
                <>
                  <button className="ah-fig" onClick={() => setTab('people')}>
                    <b>{people.total}</b> {plural(people.total, 'person')}
                  </button>
                  <span className="ah-fig-sep">·</span>
                </>
              )}
              <button className="ah-fig" onClick={() => setTab('referrals')}>
                {/* "1 referrals". Matt, 2026-10-03. Through `plural`, which
                    `theCountsReadAsEnglish` requires and which the two
                    figures above it were already using. */}
                <b>{referrals.length}</b> {plural(referrals.length, 'referral')}
              </button>
            </span>
          </p>
        </div>
        {/* NO "View as" HERE, AND IT IS A STOPGAP, NOT A DECISION.

            Matt, 2026-09-30: "hide View as on agency and group pages, keep
            it on supplier pages where it works."

            IT DID NOT WORK HERE. Every figure on Reporting is keyed on
            `partnerScope`, and `partnerFor` can only turn a selection into
            a partner scope when it names a partner -- on the agency rail
            the partner is a ROUTE shared by every agency, so `agency:` and
            `group:` both leave it at ALL_PARTNERS. The narrowing was meant
            to happen afterwards in `scopeFull`'s fourth argument, which no
            production call site passes. So this button changed the page's
            wording and its gates and not one of its numbers: it put
            "Viewing as Regent's Lettings. This is the page their management
            sees." over Opndoor's entire estate.

            The supplier page keeps its button because `partner:<slug>` is
            the one shape the figures do follow.

            THE PROPER FIX is every Reporting figure following the
            selection, which is what walk item 15 reported and NM-F's
            acceptance line specifies. It is recorded in QUEUE.md as the
            first item after shipping. When it lands, this button comes
            back and `figuresFollow` in origin.ts goes away. */}
      </div>

      {/* THE DEPARTED-REFERRER LINE, under the header and above the tabs: it is
          about the whole agency, not about one tab's contents, and it is the
          first thing a manager wants to know on the day somebody leaves. */}
      {departedHere && (
        <div className="ah-departed" role="note">
          <Icon name="info" size={15} />
          <span>{departedReferralsLine(departedHere)}</span>
        </div>
      )}

      {/* Creation lives on the NODES it creates into, never floating up here where
          it cannot say what it is adding to. */}
      <PageTabs<Tab>
        ariaLabel="Agency sections"
        value={tab}
        onChange={setTab}
        /* WALK FIX 15 adds Reporting, and NM-F makes it Opndoor-only:
           "the per-customer Reporting tab is Opndoor-only; agencies and
           suppliers keep their own Reporting page as it is." Unlike the
           supplier page, this route is reachable by an agency's own people,
           so the gate is real here and not belt-and-braces. */
        tabs={([['overview', 'Overview'], ['people', 'People'], ['reporting', 'Reporting'], ['commission', 'Commission'], ['referrals', 'Referrals']] as [Tab, string][])
          .filter(([id]) => (id !== 'commission' || canSeeCommission)
            && (id !== 'reporting' || isOpndoorStaff)
            /* See the People figure above: an agency in a supplier's estate
               never has logins, so the tab is not empty, it does not apply. */
            && (id !== 'people' || hasLogins))}
      />

      {/* OVERVIEW — the tree, or the one node opened out of it. */}
      {tab === 'overview' && focus && NodeView()}
      {tab === 'overview' && !focus && (
      <Card>
        <CardBody style={{ padding: 0 }}>
          <div className="ah-tree">
            {org.kind === 'group' && (
              <div className={`ah-node ah-node--group${sel === null ? ' is-sel' : ''}`}>
                <div className="ah-node-main">
                  <span className="ah-tick t-group">G</span>
                  <button className="ah-node-name ah-node-btn" onClick={() => setSel(null)}>{org.group.name}</button>
                  <span className="ah-node-level">Group</span>
                  {RateLine({ level: 'group', id: org.group.id, name: org.group.name, own: org.group.agentRate })}
                </div>
                {PeopleInline({ level: 'group', list: people.group, ctx: { level: 'group', partner, groupId: org.group.id, name: org.group.name } })}
                {isAdmin && (
                  <div className="ah-node-add">
                    <button className="ah-linkbtn" onClick={() => setGrow({ mode: 'agency' })}>
                      <Icon name="plus" size={12} /> Add agency to {org.group.name}
                    </button>
                  </div>
                )}
              </div>
            )}
            {agencies.map((a) => {
              const agencyPeople = a.id ? (people.agency[a.id] ?? []) : [];
              const agencyRefs = (a.branches ?? []).reduce((s2, b) => s2 + b.referrals, 0);
              const branchCount = (a.branches ?? []).length;
              const peopleCount = agencyPeople.length + (a.branches ?? []).reduce((s2, b) => s2 + (b.id ? (people.branch[b.id] ?? []).length : 0), 0);
              const open = selAgency === a.id;
              const agencyReady = a.id ? readiness?.agencies.get(a.id) : undefined;
              /* ONE OFFICE IS NOT A TREE. An agency with a single office drew a
                 branch node under it holding the same people, the same
                 referrals and the same name with "Lettings" on the end: a
                 second row that added a level of indentation and no
                 information. It is merged into the agency card, and the office
                 is still a link because the branch view is where its deed
                 recipient and its own rate live.

                 COUNTED ON THIS AGENCY'S OWN BRANCHES, not on the page's
                 `manyOffices`, which spans every agency in a group: a
                 single-office agency sitting beside a two-office sibling would
                 otherwise never merge. */
              const soleOffice = (a.branches ?? []).length === 1 ? (a.branches ?? [])[0] : null;
              return (
                <div key={a.id ?? a.name}>
                  <div className={`ah-node ah-node--agency${org.kind === 'group' ? ' lv2' : ''}${open ? ' is-open is-sel' : ''}`}>
                    <div className="ah-node-main">
                      {/* THE TICK EXPANDS, THE NAME OPENS. One click used to do
                          both jobs and so could only do the first: an agency
                          name expanded the node and a branch name, having
                          nothing under it to expand, did almost nothing. */}
                      <button
                        className="ah-tick t-agency ah-tick-btn"
                        aria-expanded={open}
                        aria-label={`${open ? 'Collapse' : 'Expand'} ${a.name}`}
                        onClick={() => setSel(open && org.kind === 'group' ? null : { level: 'agency', id: a.id ?? a.name, name: a.name })}
                      >{open ? '▾' : '▸'}</button>
                      <button
                        className="ah-node-name ah-node-btn"
                        onClick={() => openNode('agency', a.id ?? a.name, a.name)}
                      >{a.name}</button>
                      <span className="ah-node-level">Agency</span>
                      {/* CORRECT ITS OWN DETAILS. Matt: supplier Management
                          (not Referrers) may edit their agencies' and
                          offices' name, address and email, from here.
                          Opndoor admins too.

                          ON THE NODE RATHER THAN IN A MENU, because the
                          thing being corrected is the name sitting two
                          inches to its left, and most of these agencies
                          were typed into a referral form in a hurry. */}
                      {mayEditOwnEstateOrg(role, partnerScope) && a.id && (
                        <button
                          className="ah-linkbtn ah-linkbtn--quiet"
                          onClick={() => setEditOrg({ level: 'agency', id: a.id!, name: a.name, address: a.address ?? null, email: a.email ?? null })}
                        >Edit</button>
                      )}
                      {RateLine({ level: 'agency', id: a.id, name: a.name, own: a.agentRate, deal: a.id ? agreements[a.id] : null })}
                      {/* The merged office reads as the agency's own, and is the
                          way into its branch view. */}
                      {soleOffice && (
                        <button
                          className="ah-linkbtn ah-linkbtn--quiet ah-office-inline"
                          onClick={() => openNode('branch', soleOffice.id ?? soleOffice.name, soleOffice.name)}
                        >Office: {soleOffice.name}</button>
                      )}
                      {!open && (
                        <span className="ah-node-meta">
                          {peopleCount} {plural(peopleCount, 'person')}
                          {soleOffice ? '' : ` · ${branchCount} ${plural(branchCount, 'branch')}`} · {agencyRefs} referrals
                        </span>
                      )}
                    </div>
                    {agentRailFor(a) && agencyReady === false && branchCount > 0 && (
                      /* AN UNACCEPTED INVITE IS NOT AN EMPTY AGENCY. Matt,
                         2026-10-02: "When the only person who could receive
                         the deed has a pending invite, say 'Independent
                         Director hasn't accepted their invite yet; deeds
                         will reach them once they do' instead of 'No one at
                         this agency can receive the deed'."

                         The readiness RPC answers false for both, and
                         rightly: a deed cannot be delivered today either
                         way. But the two are a different JOB. "Nobody here"
                         asks an admin to invite somebody, and doing that
                         for an agency that already has an invitation out
                         produces a second one. "They have not accepted yet"
                         asks for nothing and resolves itself.

                         Read off the people the page already has rather
                         than from a second RPC: a pending row is exactly
                         what `status === 'pending'` is. */
                      (() => {
                        /* A STUCK DEED COMES FIRST, ahead of the invite line
                           below. Matt, 2026-10-03: "Only warn about deed
                           delivery when there's an application at that
                           agency whose deed has nowhere to go." Where there
                           is one, it is the actionable fact and it outranks
                           "deeds will reach them once they accept" -- which
                           is not true of a deed that is already executed and
                           already queued for a staff send. */
                        if (stuckDeeds.agencies.has(a.id ?? '')) {
                          return (
                            <div className="ah-deed-warn"><Icon name="alert" size={14} /> No one at this agency can receive the deed. Invite a manager or nominate a recipient.</div>
                          );
                        }
                        const waiting = agencyPeople.filter((u) => u.status === 'pending');
                        if (waiting.length && waiting.length === agencyPeople.length) {
                          const who = waiting.length === 1
                            ? waiting[0].name
                            : `${waiting.length} invited people`;
                          return (
                            <div className="ah-deed-warn ah-deed-warn--waiting">
                              <Icon name="info" size={14} />{' '}
                              {waiting.length === 1
                                ? `${who} hasn’t accepted their invite yet; deeds will reach them once they do.`
                                : `${who} haven’t accepted their invites yet; deeds will reach them once they do.`}
                            </div>
                          );
                        }
                        /* AND A CAPABILITY IS NOT A PROBLEM. Matt,
                           2026-10-03: "for Opndoor's own agencies with no
                           users, replace 'No one at this agency can receive
                           the deed...' with a neutral 'No users yet. Invite
                           someone to start referring.'"

                           The readiness RPC answers "could a deed reach
                           somebody here", and an agency onboarded this
                           morning answers no for the most ordinary reason
                           there is. So a new agency wore an alert about a
                           document that does not exist, and the one line an
                           admin needed -- invite somebody -- was the second
                           half of a sentence about deeds.

                           CONDITIONED ON THERE BEING NOBODY, not on the
                           readiness answer: readiness is also false for an
                           agency with several people none of whom can
                           receive, and "No users yet" would be a lie there.
                           That case now says nothing at all, which is what
                           Matt's second sentence asks for. */
                        if (!agencyPeople.length) {
                          return <div className="ah-node-note">{NO_USERS_YET}</div>;
                        }
                        return null;
                      })()
                    )}
                    {open && PeopleInline({ level: 'agency', list: agencyPeople, ctx: { level: 'brand', partner, agencyId: a.id, name: a.name } })}
                    {open && branchCount === 0 && (
                      <div className="ah-node-note">
                        No branches yet. {possessive(a.name)} manager can add them, or add one here.
                      </div>
                    )}
                    {open && isAdmin && a.id && (
                      /* TWO OPTIONS, EACH SAYING WHAT IT DOES TO THE TENANT.
                         Matt's own title and his own two labels. It was a
                         three-option select whose first option was
                         "Follow the default (...)", which made the reader
                         work out what the partner's default was before
                         they could tell what this agency does -- and the
                         answer was in the option's own parenthesis, which
                         is a note about somebody else's setting.

                         RADIOS, NOT A SELECT. Two mutually exclusive
                         answers that each need a sentence of explanation
                         do not fit in a dropdown: the explanation can only
                         be shown for the one already chosen. */
                      <div className="ah-route">
                        <span className="ah-route__lbl">How are {possessive(a.name)} tenants checked?</span>
                        <div className="ah-route__opts">
                          {([
                            ['opndoor_referenced', 'Opndoor checks eligibility', 'The tenant completes eligibility before paying.'],
                            ['pre_referenced_open', 'Agency has already referenced them', 'The tenant goes straight to payment.'],
                          ] as const).map(([value, label, why]) => {
                            const chosen = value === 'opndoor_referenced'
                              ? a.referencingMode === 'opndoor_referenced'
                              : a.referencingMode !== 'opndoor_referenced';
                            return (
                              <label key={value} className={`ah-route__opt${chosen ? ' is-on' : ''}`}>
                                <input
                                  type="radio"
                                  name={`tenant-check-${a.id}`}
                                  checked={chosen}
                                  onChange={() => { if (!chosen) doSetMode(a.id!, a.name, value); }}
                                />
                                <span>
                                  <b>{label}</b>
                                  <span className="ah-route__why">{why}</span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {open && isAdmin && (
                      <div className="ah-node-add">
                        <button className="ah-linkbtn" onClick={() => setGrow({ mode: 'branch', agencyId: a.id })}>
                          <Icon name="plus" size={12} /> Add branch to {a.name}
                        </button>
                        {org.kind === 'agency' && (
                          <button className="ah-linkbtn" onClick={() => setGrow({ mode: 'agency' })}>
                            <Icon name="plus" size={12} /> Add another agency
                            <span className="ah-node-add__why">creates a group above {a.name} and moves it in</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {/* The sole office is drawn on the card above, so the map
                      renders nothing for it. The map itself stays exactly where
                      it was: giving a node two possible JSX positions is what
                      put NewApplication's picker in a remount loop. */}
                  {open && (soleOffice ? [] : (a.branches ?? [])).map((b) => {
                    const bPeople = b.id ? (people.branch[b.id] ?? []) : [];
                    /* NOT `nomineeId`. That is the picker's own state, declared
                       at the top of the page, and a const of the same name here
                       shadowed it for the whole of this map -- including the
                       select's `value` and the Nominate button's `disabled`,
                       both of which then read the recipient this branch does
                       not have. The button was permanently disabled and a deed
                       recipient could not be nominated through the product at
                       all. Two different things, so two different names. */
                    const recipientId = b.id ? deedRecipients[b.id] : undefined;
                    const bSel = sel?.level === 'branch' && sel.id === (b.id ?? b.name);
                    const branchReady = b.id ? readiness?.branches.get(b.id) : undefined;
                    return (
                      <div key={b.id ?? b.name} className={`ah-node ah-node--branch${org.kind === 'group' ? ' lv3' : ' lv2'}${bSel ? ' is-sel' : ''}`}>
                        <div className="ah-node-main">
                          <span className="ah-tick t-branch">•</span>
                          {/* A BRANCH HAS NOTHING UNDER IT, so its name has only
                              one job and it is to open the branch. It used to
                              toggle an inline strip of people pills, which is
                              why acting on a branch's people meant leaving for
                              the People tab and filtering back down by name. */}
                          <button
                            className="ah-node-name ah-node-btn"
                            onClick={() => openNode('branch', b.id ?? b.name, b.name)}
                          >{b.name}</button>
                          <span className="ah-node-level">Branch</span>
                          {RateLine({ level: 'branch', id: b.id, name: b.name, own: b.agentRate })}
                          <span className="ah-node-meta">
                            {bPeople.length} {plural(bPeople.length, 'person')} · {b.referrals} referrals
                            {recipientId ? '' : ' · no deed recipient'}
                          </span>
                        </div>
                        {/* The whole question in one line, whoever is paid. */}
                        {canSeeCommission && b.id && splits.has(b.id) && <div className="ah-payout">{payoutSentence(splits.get(b.id)!)}</div>}
                        {/* THE SAME RULE ONE LEVEL DOWN. The Agencies list and
                            this tree both draw a line per branch as well as per
                            agency, so gating only the agency's would have left
                            every branch of a new agency wearing the alert the
                            agency had just lost. */}
                        {agentRailFor(a) && branchReady === false && (
                          stuckDeeds.branches.has(b.id ?? '')
                            ? <div className="ah-deed-warn"><Icon name="alert" size={14} /> No one at this branch can receive the deed. Invite a branch manager or nominate a recipient.</div>
                            : bPeople.length === 0
                              ? <div className="ah-node-note">{NO_USERS_YET}</div>
                              : null
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>
      )}

      {/* RECENT CHANGES, UNDER THE TREE. Matt, 2026-10-01: "Agency page:
          add a 'Recent changes' list like the supplier's, showing every
          change to the agency's details, branches, people's levels and
          commission deals in plain English, with who and when, using the
          shared builder."

          ON OVERVIEW, where the supplier's sits on Settings, because an
          agency has no Settings tab -- its details are the tree itself.
          Under it rather than over it: the question "what is this
          agency" comes before "what changed about it".

          ONLY FOR A SINGLE AGENCY. A group's page shows several, and a
          list mixing three agencies' histories under one heading would
          need a fourth chip to say whose -- which is a different screen
          from the one Matt asked for. The group case is noted in
          QUEUE.md rather than guessed at. */}
      {tab === 'overview' && !focus && agencies.length === 1 && (
        /* THE ID MAY BE ABSENT -- mock rows carry none -- and the card
           handles that by showing what WOULD appear here. Gating the card
           on the id instead would make the section vanish rather than be
           empty, which reads as a feature that is not there at all. The
           supplier's list is always drawn for the same reason. */
        <AgencyChanges agencyId={agencies[0]?.id ?? null} />
      )}

      {tab === 'reporting' && isOpndoorStaff && (
        <CustomerReport
          rows={customerRows}
          seesCommission={canSeeCommission}
          periodId={reportPeriod.id}
          periods={reportPeriods.map((p) => ({ value: p.id, label: p.label }))}
          onPeriod={(id) => setReportPeriod(reportPeriods.find((p) => p.id === id) ?? reportPeriod)}
          emptyText="No referrals from this customer in this period."
        />
      )}

      {tab === 'people' && PeopleTab()}
      {/* The "Who is told what" grid stood here. It was one set of switches
          for the whole agency, so it could not answer the question anybody
          arriving at it actually had -- what does THIS person get emailed --
          and a Director changing one row changed it for all their colleagues.
          Settings are per person now, on the person's own row. */}
      {tab === 'commission' && canSeeCommission && CommissionTab()}

      {/* REFERRALS — follows the selected node, with one click back to the top. */}
      {tab === 'referrals' && (
      <Card>
        <CardHead
          title="Referrals"
          sub={sel ? `Scoped to ${sel.name}` : (org.kind === 'group' ? 'Whole group' : 'Whole agency')}
          actions={org.kind === 'agency'
            ? <Link className="ah-viewall" to={goApplications(org.agency.name)}>Open in Applications <Icon name="arrowRight" size={13} /></Link>
            : undefined}
        />
        <CardBody style={{ padding: 0 }}>
          <div className="ah-crumb">
            <button className={`ah-crumb__seg${sel === null ? ' is-cur' : ''}`} onClick={() => setSel(null)}>
              {org.kind === 'group' ? 'Whole group' : 'Whole agency'}
            </button>
            {sel && selAgency && (() => {
              const a = agencies.find((x) => (x.id ?? x.name) === selAgency);
              if (!a) return null;
              return (
                <>
                  <span className="ah-crumb__sep">›</span>
                  <button
                    className={`ah-crumb__seg${sel.level === 'agency' ? ' is-cur' : ''}`}
                    onClick={() => setSel({ level: 'agency', id: a.id ?? a.name, name: a.name })}
                  >{a.name}</button>
                </>
              );
            })()}
            {sel?.level === 'branch' && (
              <>
                <span className="ah-crumb__sep">›</span>
                <span className="ah-crumb__seg is-cur">{sel.name}</span>
              </>
            )}
          </div>
          {(() => {
            const scoped = sel === null ? referrals
              : sel.level === 'branch' ? referrals.filter((r) => r.branch === sel.name)
              : referrals.filter((r) => r.agency === sel.name);
            const rows = scoped.slice(0, 12);
            if (rows.length === 0) return <div className="ah-empty">No referrals{sel ? ` for ${sel.name}` : ''} yet.</div>;
            return (
              <table className="dt ah-table">
                <thead><tr><th>Tenant</th><th>Branch</th><th>Stage</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.ref}>
                      <td><Link className="ah-tenant" to={`/applications/${encodeURIComponent(r.ref)}`}><span className="who__av">{initials(r.tenant)}</span><span><span className="dt__name">{r.tenant}</span><span className="dt__sub">{r.ref}</span></span></Link></td>
                      <td className="soft">{r.branch}</td>
                      <td><span className={`ah-st ${applicationStageClass(r)}`}>{applicationStatusLabel(r)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })()}
        </CardBody>
      </Card>
      )}

      {invite && <InviteToLevel ctx={invite} onClose={() => setInvite(null)} onInvited={() => { setInvite(null); refreshSession(); bump(); }} />}

      {levelFor && (
        <Modal
          open
          width={460}
          title={`Change ${possessive(levelFor.name)} level`}
          sub="This changes what they can see and do across the portal."
          onClose={() => { setLevelFor(null); setLevelPick(null); }}
          footer={<>
            <Button variant="ghost" onClick={() => { setLevelFor(null); setLevelPick(null); }}>Cancel</Button>
            <Button variant="primary" disabled={!levelPick} onClick={() => void doSetLevel()}>Change level</Button>
          </>}
        >
          <div className="roleopts">
            {AGENCY_LEVELS.filter((o) => o.level !== levelFor.current).map((o) => (
              <label key={o.level} className={`roleopt${levelPick === o.level ? ' is-sel' : ''}`} onClick={() => setLevelPick(o.level)}>
                <span className="roleopt__radio" />
                <div><div className="roleopt__name">{o.level}</div><div className="roleopt__desc">{o.desc}</div></div>
              </label>
            ))}
          </div>
          {levelPick && <p className="soft" style={{ marginTop: 14 }}>Make {levelFor.name} a {levelPick}?</p>}
        </Modal>
      )}

      {posFor && (
        <PositionModal
          user={{ id: posFor.id, name: posFor.name } as never}
          targets={scopeTargets}
          onClose={() => setPosFor(null)}
          onSaved={() => { setPosFor(null); refreshSession(); bump(); }}
        />
      )}
      {/* No bump() on close: the panel owns its own reload and this page no
          longer reads any of what it changes. */}
      {editOrg && (
        <EditOrgDetails
          target={editOrg}
          onClose={() => setEditOrg(null)}
          onSaved={() => { setEditOrg(null); refreshSession(); }}
        />
      )}
      {notifFor && (
        <PersonNotifications
          /* (qq) Whether opndoor is the only level above this reader, which
             decides whether a locked setting says "Management decides this"
             or "opndoor decides this". The page knows the session; the
             dialog is presentational and is told. */
          viewerIsTop={readerIsTopOfEstate(role, seesCommission === true, partnerScope)}
          userId={notifFor.id}
          personName={notifFor.name}
          onClose={() => setNotifFor(null)}
        />
      )}
      {editAgreement && (
        <AgreementEditor
          level={editAgreement.level}
          id={editAgreement.id}
          name={editAgreement.name}
          current={agreement}
          onClose={() => setEditAgreement(null)}
          onSaved={() => { setEditAgreement(null); refreshSession(); bump(); }}
        />
      )}
      {grow && (
        <AgencyGrow
          mode={grow.mode}
          anchorAgencyId={grow.agencyId}
          agencies={agencies}
          group={group}
          onClose={() => setGrow(null)}
          onDone={() => { setGrow(null); refreshSession(); bump(); }}
        />
      )}

      {/* THE SIGNED-DEAL BREACH, with a way through.
          The refusal names both parties, what was agreed and what the branches
          would actually pay; confirming it is audited against both of them. */}
      <Modal
        open={!!breach}
        onClose={() => setBreach(null)}
        width={520}
        title="This breaks an agreement below"
        footer={<>
          <Button variant="ghost" onClick={() => setBreach(null)}>Go back</Button>
          <Button variant="primary" disabled={savingRow}
            onClick={() => { if (breach) void saveRate(breach.level, breach.id, true); }}>
            {savingRow ? 'Saving…' : 'Set it anyway'}
          </Button>
        </>}
      >
        <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.6, margin: 0 }}>{breach?.message}</p>
        <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', lineHeight: 1.6, margin: '12px 0 0' }}>
          Setting it anyway is recorded against both parties, with who did it and when.
        </p>
      </Modal>
    </>
  );
}

export const agencyKey = (a: Agency): string => a.id ?? a.name;
