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
  getAgencies, getGroup, getGroups, getPartner, getRatesFor, setAgencyRates, setGroupRates,
  getApplications, getUsers, maySeeCommission, ALL_PARTNERS,
  type Agency, type AgencyGroup, type ManagedUser, type Status,
} from '@/data';
import { getPositionsForUsers, getDeedRecipients, nominateDeedRecipient, clearDeedRecipient } from '@/data/positionsService';
import { useSession } from '@/session/SessionContext';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Card, CardHead, CardBody } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { fmtRatePct } from '@/lib/format';
import { InviteToLevel, type InviteContext } from './InviteToLevel';
import { AgencyGrow } from './AgencyGrow';
import './AgencyHome.css';

const STATUS_LABEL: Record<Status, string> = { draft: 'In progress', referencing: 'Referencing', declined: 'Declined', sent: 'Sent', paid: 'Paid', deed: 'Deed issued', withdrawn: 'Withdrawn', expired: 'Expired' };
const STATUS_ST: Partial<Record<Status, string>> = { referencing: 'st-wait', sent: 'st-live', paid: 'st-live', deed: 'st-ok' };
const initials = (n: string) => n.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
const pct = (frac: number | null | undefined) => fmtRatePct(frac ?? 0);

type Level = 'group' | 'agency' | 'branch';
interface Placed { userId: string; name: string; email: string; role: string; }
type Org = { kind: 'group'; group: AgencyGroup; agencies: Agency[] } | { kind: 'agency'; agency: Agency };

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
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

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

  const base = getRatesFor(partner || ALL_PARTNERS);
  // Agent-rail orgs deliver deeds to their people; a branch with no one in the whole
  // chain (nominee, branch/agency/group manager) cannot receive a deed.
  const isAgentRail = getPartner(partner)?.referencingMode === 'opndoor_referenced';

  // ---- per-node rate editor. The Agencies section edits ONE rate: the agency
  // commission (agent_rate). partner_rate (the supplier/Opndoor cut, never paid on
  // the agent rail) is preserved untouched — we pass the node's current value back.
  const [editRow, setEditRow] = useState<string | null>(null); // 'group:<id>' | 'agency:<id>'
  const [draftA, setDraftA] = useState('');
  const [preserveP, setPreserveP] = useState<number | null>(null);
  const [savingRow, setSavingRow] = useState(false);
  const openRate = (rowKey: string, ownP: number | null | undefined, ownA: number | null | undefined) => {
    setEditRow(rowKey);
    setPreserveP(ownP ?? null);
    setDraftA(ownA == null ? '' : String(+(ownA * 100).toFixed(2)));
  };
  const saveRate = async () => {
    if (!editRow) return;
    const a = pctToFrac(draftA);
    if (a === undefined) { toast('Enter a percentage between 0 and 100, or leave blank to inherit.', 'error'); return; }
    const [kind, id] = editRow.split(':');
    setSavingRow(true);
    try {
      // partner_rate is left exactly as it was (preserveP); only agent_rate changes.
      if (kind === 'group') await setGroupRates(id, preserveP, a); else await setAgencyRates(id, preserveP, a);
      refreshSession(); bump(); setEditRow(null);
      toast('Commission saved.', 'ok');
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not save the commission.', 'error'); }
    finally { setSavingRow(false); }
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

  // ---- node commission chip. `ownP/ownA` is the rate that applies AT this node:
  //   group node   -> the group's own rate
  //   agency node  -> the agency's own rate
  //   branch node  -> its agency's rate (a branch has no rate of its own)
  // Resolution is most-specific-wins per column: own -> group -> Opndoor standard.
  const CommissionChip = ({ kind, ownP, ownA, ownName, rowKey }: { kind: Level; ownP?: number | null; ownA?: number | null; ownName: string; rowKey?: string }) => {
    if (!canSeeCommission) return null;
    // ONE rate in the Agencies section: the agency commission (agent_rate). The
    // agent-rail's other rate is the house/Opndoor cut, never paid to anyone, so it
    // is not shown here; the supplier side shows partner_rate as "Supplier commission".
    const gA = kind === 'group' ? null : (group?.agentRate ?? null);
    const A: { v: number; src: 'own' | 'group' | 'base' } =
      ownA != null ? { v: ownA, src: 'own' } : gA != null ? { v: gA, src: 'group' } : { v: base.agent, src: 'base' };
    const srcText = (src: 'own' | 'group' | 'base') =>
      src === 'own' ? (kind === 'branch' ? `inherited from ${ownName}` : 'custom rate')
        : src === 'group' ? `inherited from ${group?.name ?? 'the group'}` : 'Opndoor standard rate';
    const editing = rowKey && editRow === rowKey;
    return (
      <span className="ah-comm-wrap">
        <span className="ah-chip" title="Agency commission — this agency's share of the guarantee fee">
          <b>{pct(A.v)}</b> agency commission
        </span>
        <span className="ah-chip-src">{srcText(A.src)}</span>
        {isAdmin && rowKey && !editing && (
          <button className="ah-linkbtn" onClick={() => openRate(rowKey, ownP, ownA)}>Set custom rate</button>
        )}
        {editing && (
          <span className="ah-rate-edit">
            <label>Agency commission <input inputMode="decimal" value={draftA} onChange={(e) => setDraftA(e.target.value)} placeholder="inherit" />%</label>
            <button className="ah-linkbtn" onClick={saveRate} disabled={savingRow}>{savingRow ? '…' : 'Save'}</button>
            <button className="ah-linkbtn ah-linkbtn--quiet" onClick={() => setEditRow(null)}>Cancel</button>
          </span>
        )}
        <details className="ah-how"><summary>How this rate is worked out</summary>
          <div className="ah-how__body">
            <div>Agency commission: {pct(A.v)} — {srcText(A.src)}</div>
            <div className="muted">Most specific wins: the agency's rate, then the group, then the Opndoor standard.</div>
          </div>
        </details>
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
              <div className="ah-node ah-node--group">
                <div className="ah-node-main">
                  <span className="ah-tick t-group">G</span>
                  <span className="ah-node-name">{org.group.name}</span>
                  <span className="ah-node-level">Group</span>
                  <CommissionChip kind="group" ownP={org.group.partnerRate} ownA={org.group.agentRate} ownName={org.group.name} rowKey={`group:${org.group.id}`} />
                </div>
                <PeopleInline level="group" list={people.group} ctx={{ level: 'group', partner, groupId: org.group.id, name: org.group.name }} />
              </div>
            )}
            {agencies.map((a) => {
              const agencyPeople = a.id ? (people.agency[a.id] ?? []) : [];
              const agencyRefs = (a.branches ?? []).reduce((s, b) => s + b.referrals, 0);
              return (
                <div key={a.id ?? a.name}>
                  <div className={`ah-node ah-node--agency${org.kind === 'group' ? ' lv2' : ''}`}>
                    <div className="ah-node-main">
                      <span className="ah-tick t-agency">A</span>
                      <span className="ah-node-name">{a.name}</span>
                      <span className="ah-node-level">Agency</span>
                      <CommissionChip kind="agency" ownP={a.partnerRate} ownA={a.agentRate} ownName={a.name} rowKey={a.id ? `agency:${a.id}` : undefined} />
                      <button className="ah-refs" onClick={() => setFilterBranch(null)} title={`${agencyRefs} referrals across this agency`}>{agencyRefs} referrals</button>
                    </div>
                    <PeopleInline level="agency" list={agencyPeople} ctx={{ level: 'brand', partner, agencyId: a.id, name: a.name }} />
                  </div>
                  {(a.branches ?? []).map((b) => {
                    const bPeople = b.id ? (people.branch[b.id] ?? []) : [];
                    const nomineeId = b.id ? deedRecipients[b.id] : undefined;
                    const nominee = nomineeId ? usersById[nomineeId] : undefined;
                    // Agent-rail deeds resolve to a person; nobody in the whole chain
                    // (nominee, this branch, this agency, the group) means none can receive.
                    const chainEmpty = !nominee && bPeople.length === 0 && agencyPeople.length === 0 && people.group.length === 0;
                    return (
                      <div key={b.id ?? b.name} className={`ah-node ah-node--branch${org.kind === 'group' ? ' lv3' : ' lv2'}`}>
                        <div className="ah-node-main">
                          <span className="ah-tick t-branch">•</span>
                          <span className="ah-node-name">{b.name}</span>
                          <span className="ah-node-level">Branch</span>
                          <CommissionChip kind="branch" ownP={a.partnerRate} ownA={a.agentRate} ownName={a.name} />
                          <button className="ah-refs" onClick={() => setFilterBranch(b.name)} title={`Filter referrals to ${b.name}`}>{b.referrals} referrals</button>
                        </div>
                        {isAgentRail && chainEmpty && (
                          <div className="ah-deed-warn"><Icon name="alert" size={14} /> No one at this branch can receive the deed. Invite a branch manager or nominate a recipient.</div>
                        )}
                        <PeopleInline level="branch" list={bPeople} ctx={{ level: 'branch', partner, branchId: b.id, name: b.name }} />
                        {isAdmin && (
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

      {/* REFERRALS — below the tree; a branch's referral count filters this. */}
      <Card>
        <CardHead
          title="Referrals"
          sub={filterBranch ? `route: Agency · ${filterBranch}` : 'route: Agency'}
          actions={filterBranch
            ? <button className="ah-viewall" onClick={() => setFilterBranch(null)}>Clear branch filter</button>
            : (org.kind === 'agency' ? <Link className="ah-viewall" to={goApplications(org.agency.name)}>Open in Applications <Icon name="arrowRight" size={13} /></Link> : undefined)}
        />
        <CardBody style={{ padding: 0 }}>
          {(() => {
            const rows = (filterBranch ? referrals.filter((r) => r.branch === filterBranch) : referrals).slice(0, 12);
            if (rows.length === 0) return <div className="ah-empty">No referrals{filterBranch ? ` for ${filterBranch}` : ''} yet.</div>;
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
