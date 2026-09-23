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
   everywhere. Commission is admin-only to see (maySeeCommission) and edit.
   ===================================================================== */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getAgencies, getGroup, getGroups, getPartner,
  getApplications, getUsers, maySeeCommission, ALL_PARTNERS,
  type Agency, type AgencyGroup, type ManagedUser, type Status,
} from '@/data';
import { getPositionsForUsers, getDeedRecipients, nominateDeedRecipient, clearDeedRecipient, getOrgDeedReadiness, type DeedReadiness } from '@/data/positionsService';
import { setNodeRate, getCommissionSplits, previewNodeRate, type SplitLine } from '@/data/orgService';
import { useSession } from '@/session/SessionContext';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Card, CardHead, CardBody } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { InviteToLevel, type InviteContext } from './InviteToLevel';
import { AgencyGrow } from './AgencyGrow';
import './AgencyHome.css';

const STATUS_LABEL: Record<Status, string> = { draft: 'In progress', referencing: 'Referencing', declined: 'Declined', sent: 'Sent', paid: 'Paid', deed: 'Deed issued', withdrawn: 'Withdrawn', expired: 'Expired' };
const STATUS_ST: Partial<Record<Status, string>> = { referencing: 'st-wait', sent: 'st-live', paid: 'st-live', deed: 'st-ok' };
const initials = (n: string) => n.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

type Level = 'group' | 'agency' | 'branch';
interface Placed { userId: string; name: string; email: string; role: string; }
type Org = { kind: 'group'; group: AgencyGroup; agencies: Agency[] } | { kind: 'agency'; agency: Agency };

/** "12%" from 0.12. Formatting only: the arithmetic all lives in SQL. */
const pctLabel = (frac: number): string => `${+(frac * 100).toFixed(2)}%`;

/** The one plain line a branch shows, built from the lines SQL returned. */
const payoutSentence = (lines: SplitLine[]): string => {
  if (!lines.length) return 'A referral here pays out nothing.';
  const parts = lines.map((l) => `${l.orgName} ${pctLabel(l.rate)}`);
  const total = pctLabel(lines.reduce((s, l) => s + l.rate, 0));
  return `A referral here pays out: ${parts.join(' + ')} = ${total} of the fee`;
};

const roleLabelFor = (level: Level, role: string) =>
  level === 'group' ? 'Group director' : level === 'agency' ? 'Agency manager' : role === 'referrer' ? 'Negotiator' : 'Branch manager';
const inviteLabelFor = (level: Level) =>
  level === 'group' ? 'Invite group director' : level === 'agency' ? 'Invite agency manager' : 'Invite branch manager or negotiator';

// A parsed percentage input -> fraction. '' -> null (inherit); invalid -> undefined.
const pctToFrac = (s: string): number | null | undefined => {
  const t = s.replace('%', '').trim();
  if (t === '') return null;
  const n = parseFloat(t);
  return isNaN(n) || n < 0 || n > 100 ? undefined : n / 100;
};

export function AgencyHome() {
  const { key } = useParams<{ key: string }>();
  const { role, partnerScope, dataVersion, refresh: refreshSession } = useSession();
  const toast = useToast();
  const decoded = decodeURIComponent(key ?? '');
  const isAdmin = role === 'superadmin';
  const canSeeCommission = maySeeCommission(role);
  const scope = isAdmin ? ALL_PARTNERS : partnerScope;

  const [tick, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);
  const [invite, setInvite] = useState<InviteContext | null>(null);
  const [grow, setGrow] = useState<'branch' | 'agency' | null>(null);

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
          const put = (bucket: Placed[]) => { bucket.push({ userId: u.id, name: u.name, email: u.email, role: u.role }); seen.add(u.id); };
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

  // Agent-rail orgs deliver deeds to their people; a branch with no one in the whole
  // chain (nominee, branch/agency/group manager) cannot receive a deed.
  const isAgentRail = getPartner(partner)?.referencingMode === 'opndoor_referenced';

  /* ---- DRILL-DOWN. The page opens at the top node expanded ONE level; clicking
     an agency expands it and scopes the Referrals section to it, clicking a branch
     scopes to the branch. `sel` is the scope, and the breadcrumb walks back. */
  type Sel = { level: 'group' | 'agency' | 'branch'; id: string; name: string };
  const [sel, setSel] = useState<Sel | null>(null);
  const selAgency = sel?.level === 'agency' ? sel.id : sel?.level === 'branch' ? (branchesFlat.find((x) => x.branch.id === sel.id)?.agency.id ?? null) : null;

  // An independent agency page opens AT its agency, expanded one level; a group
  // page opens at the group with its agencies collapsed.
  useEffect(() => {
    if (org?.kind === 'agency' && org.agency.id) setSel({ level: 'agency', id: org.agency.id, name: org.agency.name });
    else setSel(null);
  }, [org?.kind, org?.kind === 'agency' ? org.agency.id : org?.kind === 'group' ? org.group.id : '']);

  // Every branch's payee lines, ONE call per page load. No client-side copy of
  // the rule exists: this is the same function create_referral freezes.
  const [splits, setSplits] = useState<Map<string, SplitLine[]>>(new Map());
  useEffect(() => {
    let alive = true;
    const ids = branchesFlat.map((x) => x.branch.id).filter(Boolean) as string[];
    getCommissionSplits(ids).then((m) => { if (alive) setSplits(m); }).catch(() => { if (alive) setSplits(new Map()); });
    return () => { alive = false; };
  }, [branchesFlat, dataVersion, tick]);

  // Deed readiness, the SAME answer the Agencies list uses, so the two surfaces
  // cannot disagree: one RPC, active people only, pending does not clear it.
  const [readiness, setReadiness] = useState<DeedReadiness | null>(null);
  useEffect(() => {
    let alive = true;
    getOrgDeedReadiness().then((r) => { if (alive) setReadiness(r); }).catch(() => { if (alive) setReadiness(null); });
    return () => { alive = false; };
  }, [dataVersion, tick]);

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
  const saveRate = async (level: 'group' | 'agency' | 'branch', id: string) => {
    const a = pctToFrac(draftA);
    if (a === undefined) { toast('Enter a percentage between 0 and 100, or leave blank to clear.', 'error'); return; }
    setSavingRow(true); setRateErr('');
    try {
      await setNodeRate(level, id, a);
      refreshSession(); bump(); setEditRow(null);
      toast(a == null ? 'Rate cleared.' : 'Rate saved.', 'ok');
    } catch (e) {
      // The 50% rule lives in SQL; show exactly what it said.
      setRateErr(e instanceof Error ? e.message : 'Could not save the rate.');
    } finally { setSavingRow(false); }
  };

  // ---- deed recipient nomination ----
  const [nominateBranch, setNominateBranch] = useState<string | null>(null); // branchId
  const [nomineeId, setNomineeId] = useState('');
  const doNominate = async () => {
    if (!nominateBranch || !nomineeId) return;
    try { await nominateDeedRecipient(nominateBranch, nomineeId); bump(); setNominateBranch(null); setNomineeId(''); toast('Deed recipient nominated.', 'ok'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not nominate.', 'error'); }
  };
  const doClear = async (branchId: string) => {
    try { await clearDeedRecipient(branchId); bump(); toast('Deed recipient cleared.', 'ok'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not clear.', 'error'); }
  };

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
  const statusBadge = org.kind === 'group' ? 'Group' : 'Agency';
  const summary = org.kind === 'group'
    ? `${agencies.length} ${agencies.length === 1 ? 'agency' : 'agencies'} · ${branchCount} ${branchCount === 1 ? 'branch' : 'branches'} · ${people.total} ${people.total === 1 ? 'person' : 'people'} · ${referrals.length} referrals`
    : `${branchCount} ${branchCount === 1 ? 'branch' : 'branches'} · ${people.total} ${people.total === 1 ? 'person' : 'people'} · ${referrals.length} referrals`;

  const goApplications = (agencyName: string) => `/applications?agency=${encodeURIComponent(agencyName)}`;

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
  const RateLine = ({ level, id, name, own }: { level: 'group' | 'agency' | 'branch'; id?: string; name: string; own?: number | null }) => {
    if (!canSeeCommission) return null;
    const rowKey = id ? `${level}:${id}` : undefined;
    const editing = !!rowKey && editRow === rowKey;
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
        {isAdmin && rowKey && !editing && (
          <button className="ah-linkbtn" onClick={() => openRate(rowKey, own)}>{own != null ? 'Change rate' : 'Set rate'}</button>
        )}
        {editing && id && (
          <span className="ah-rate-edit">
            <label>Rate <input inputMode="decimal" value={draftA} autoFocus onChange={(e) => setDraftA(e.target.value)} placeholder="none" />%</label>
            {worst != null && (
              <span className={`ah-rate-preview${worst > 0.5 ? ' is-over' : ''}`}>
                Worst branch total: <b>{pctLabel(worst)}</b>
                {preview?.worstBranch ? ` (${preview.worstBranch})` : ''}
                {worst > 0.5 ? ' — over the 50% limit' : ''}
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

  const PeopleInline = ({ level, list, ctx }: { level: Level; list: Placed[]; ctx: InviteContext }) => (
    <div className="ah-node-people">
      {list.map((p) => (
        <span key={p.userId} className="ah-chip-person" title={p.email}>
          <span className="ah-av">{initials(p.name || p.email)}</span>{p.name || p.email}<span className="ah-role">{roleLabelFor(level, p.role)}</span>
        </span>
      ))}
      {isAdmin && <button className="ah-linkbtn ah-invite-inline" onClick={() => setInvite(ctx)}><Icon name="send" size={12} /> {inviteLabelFor(level)}</button>}
    </div>
  );

  return (
    <>
      <div className="page-head" style={{ alignItems: 'center' }}>
        <div>
          <Link className="ah-back" to="/agencies"><Icon name="arrowLeft" size={14} /> Agencies</Link>
          <h1 className="page-head__title" style={{ marginTop: 8 }}>{title}</h1>
          <p className="page-head__sub ah-sub"><Pill variant={org.kind === 'group' ? 'sent' : 'paid'}>{statusBadge}</Pill> <span>{summary}</span></p>
        </div>
        {isAdmin && (
          <div className="page-head__actions">
            <Button variant="ghost" size="sm" onClick={() => setGrow('branch')}><Icon name="plus" /> Add a branch</Button>
            <Button variant="ghost" size="sm" onClick={() => setGrow('agency')}><Icon name="plus" /> {org.kind === 'group' ? 'Add agency' : 'Add another agency'}</Button>
          </div>
        )}
      </div>

      {/* THE TREE — one spine, people/commission/invite/referrals inline per node */}
      <Card>
        <CardBody style={{ padding: 0 }}>
          <div className="ah-tree">
            {org.kind === 'group' && (
              <div className={`ah-node ah-node--group${sel === null ? ' is-sel' : ''}`}>
                <div className="ah-node-main">
                  <span className="ah-tick t-group">G</span>
                  <button className="ah-node-name ah-node-btn" onClick={() => setSel(null)}>{org.group.name}</button>
                  <span className="ah-node-level">Group</span>
                  <RateLine level="group" id={org.group.id} name={org.group.name} own={org.group.agentRate} />
                </div>
                <PeopleInline level="group" list={people.group} ctx={{ level: 'group', partner, groupId: org.group.id, name: org.group.name }} />
              </div>
            )}
            {agencies.map((a) => {
              const agencyPeople = a.id ? (people.agency[a.id] ?? []) : [];
              const agencyRefs = (a.branches ?? []).reduce((s2, b) => s2 + b.referrals, 0);
              const branchCount = (a.branches ?? []).length;
              const peopleCount = agencyPeople.length + (a.branches ?? []).reduce((s2, b) => s2 + (b.id ? (people.branch[b.id] ?? []).length : 0), 0);
              const open = selAgency === a.id;
              const agencyReady = a.id ? readiness?.agencies.get(a.id) : undefined;
              return (
                <div key={a.id ?? a.name}>
                  <div className={`ah-node ah-node--agency${org.kind === 'group' ? ' lv2' : ''}${open ? ' is-open is-sel' : ''}`}>
                    <div className="ah-node-main">
                      <span className="ah-tick t-agency">A</span>
                      <button
                        className="ah-node-name ah-node-btn"
                        onClick={() => setSel(open && org.kind === 'group' ? null : { level: 'agency', id: a.id ?? a.name, name: a.name })}
                      >{a.name}</button>
                      <span className="ah-node-level">Agency</span>
                      <RateLine level="agency" id={a.id} name={a.name} own={a.agentRate} />
                      {!open && (
                        <span className="ah-node-meta">
                          {peopleCount} {peopleCount === 1 ? 'person' : 'people'} · {branchCount} {branchCount === 1 ? 'branch' : 'branches'} · {agencyRefs} referrals
                        </span>
                      )}
                    </div>
                    {isAgentRail && agencyReady === false && (
                      <div className="ah-deed-warn"><Icon name="alert" size={14} /> No one at this agency can receive the deed. Invite a manager or nominate a recipient.</div>
                    )}
                    {open && <PeopleInline level="agency" list={agencyPeople} ctx={{ level: 'brand', partner, agencyId: a.id, name: a.name }} />}
                  </div>
                  {open && (a.branches ?? []).map((b) => {
                    const bPeople = b.id ? (people.branch[b.id] ?? []) : [];
                    const nomineeId = b.id ? deedRecipients[b.id] : undefined;
                    const nominee = nomineeId ? usersById[nomineeId] : undefined;
                    const bOpen = sel?.level === 'branch' && sel.id === b.id;
                    const branchReady = b.id ? readiness?.branches.get(b.id) : undefined;
                    return (
                      <div key={b.id ?? b.name} className={`ah-node ah-node--branch${org.kind === 'group' ? ' lv3' : ' lv2'}${bOpen ? ' is-open is-sel' : ''}`}>
                        <div className="ah-node-main">
                          <span className="ah-tick t-branch">•</span>
                          <button
                            className="ah-node-name ah-node-btn"
                            onClick={() => setSel(bOpen ? { level: 'agency', id: a.id ?? a.name, name: a.name } : { level: 'branch', id: b.id ?? b.name, name: b.name })}
                          >{b.name}</button>
                          <span className="ah-node-level">Branch</span>
                          <RateLine level="branch" id={b.id} name={b.name} own={b.agentRate} />
                          {!bOpen && <span className="ah-node-meta">{bPeople.length} {bPeople.length === 1 ? 'person' : 'people'} · {b.referrals} referrals</span>}
                        </div>
                        {/* The whole question in one line, whoever is paid. */}
                        {canSeeCommission && b.id && splits.has(b.id) && <div className="ah-payout">{payoutSentence(splits.get(b.id)!)}</div>}
                        {isAgentRail && branchReady === false && (
                          <div className="ah-deed-warn"><Icon name="alert" size={14} /> No one at this branch can receive the deed. Invite a branch manager or nominate a recipient.</div>
                        )}
                        {bOpen && <PeopleInline level="branch" list={bPeople} ctx={{ level: 'branch', partner, branchId: b.id, name: b.name }} />}
                        {bOpen && isAdmin && (
                          <div className="ah-deed">
                            {nominee ? (
                              <>Deed recipient: <b>{nominee.name || nominee.email}</b> <button className="ah-linkbtn ah-linkbtn--quiet" onClick={() => b.id && doClear(b.id)}>Clear</button></>
                            ) : nominateBranch === b.id ? (
                              <>
                                <select value={nomineeId} onChange={(e) => setNomineeId(e.target.value)} aria-label="Nominate deed recipient">
                                  <option value="">Choose a person…</option>
                                  {Object.values(usersById).map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                                </select>
                                <button className="ah-linkbtn" onClick={doNominate} disabled={!nomineeId}>Nominate</button>
                                <button className="ah-linkbtn ah-linkbtn--quiet" onClick={() => { setNominateBranch(null); setNomineeId(''); }}>Cancel</button>
                              </>
                            ) : (
                              <button className="ah-linkbtn" onClick={() => { setNominateBranch(b.id ?? null); setNomineeId(''); }}>Nominate deed recipient</button>
                            )}
                          </div>
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

      {/* REFERRALS — follows the selected node, with one click back to the top. */}
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
                      <td><span className={`ah-st ${STATUS_ST[r.status] ?? 'st-neutral'}`}>{STATUS_LABEL[r.status]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })()}
        </CardBody>
      </Card>

      {invite && <InviteToLevel ctx={invite} onClose={() => setInvite(null)} onInvited={() => { setInvite(null); refreshSession(); bump(); }} />}
      {grow && <AgencyGrow mode={grow} agencies={agencies} group={group} onClose={() => setGrow(null)} onDone={() => { setGrow(null); refreshSession(); bump(); }} />}
    </>
  );
}

export const agencyKey = (a: Agency): string => a.id ?? a.name;
