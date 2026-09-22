/* =====================================================================
   AgencyHome — the first-class agency screen, top down: GROUP → BRAND → BRANCH.

   Addressed by the org itself (a group, or a standalone brand), never by a
   supplier or partner — the house partner that plumbs direct agencies is never
   named here. Gathers, in one place and at every scale:
     · Structure   — the group → brand → branch tree
     · People       — who covers what, bucketed by the level they sit at, each
                      with a position (Group director / Brand · X / Branch · Y),
                      invited from that level
     · Commission   — the tier editor (Group override → Brand override → Opndoor
                      base) that already resolves in SQL, with the resolved rate
     · Referrals    — the Agency-route applications beneath it

   "Brand" is the UI word for an agencies row; "group" for an agency_groups row.
   ===================================================================== */
import { useEffect, useMemo, useState, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getAgencies, getGroup, getGroups, getRatesFor, setAgencyRates, setGroupRates,
  getApplications, getUsers, ALL_PARTNERS,
  type Agency, type AgencyGroup, type ManagedUser, type Status,
} from '@/data';
import { getPositionsForUsers } from '@/data/positionsService';
import { useSession } from '@/session/SessionContext';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Card, CardHead, CardBody } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { fmtRatePct } from '@/lib/format';
import { InviteToLevel, type InviteContext } from './InviteToLevel';
import './AgencyHome.css';

const STATUS_LABEL: Record<Status, string> = { draft: 'In progress', referencing: 'Referencing', declined: 'Declined', sent: 'Sent', paid: 'Paid', deed: 'Deed issued', withdrawn: 'Withdrawn', expired: 'Expired' };
const STATUS_ST: Partial<Record<Status, string>> = { referencing: 'st-wait', sent: 'st-live', paid: 'st-live', deed: 'st-ok' };
const initials = (n: string) => n.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

// A person placed on this org, with the level they cover.
interface Placed { userId: string; name: string; email: string; }

/** A group, or a standalone brand — the org this page is addressed by. */
type Org =
  | { kind: 'group'; group: AgencyGroup; brands: Agency[] }
  | { kind: 'brand'; brand: Agency };

export function AgencyHome() {
  const { key } = useParams<{ key: string }>();
  const { role, partnerScope, dataVersion, refresh: refreshSession } = useSession();
  const toast = useToast();
  const decoded = decodeURIComponent(key ?? '');
  const isAdmin = role === 'superadmin';
  // Superadmin resolves across all partners (a group reached from anywhere must
  // resolve); everyone else through their own scope. RLS bounds it server-side.
  const scope = isAdmin ? ALL_PARTNERS : partnerScope;

  const [tick, setTick] = useState(0); // local bump after a rate save
  const bump = () => setTick((t) => t + 1);
  const [invite, setInvite] = useState<InviteContext | null>(null);

  // Resolve the org: a group by key, or a brand — and if that brand belongs to a
  // group, render the whole group so the page always shows the top of the tree.
  const org = useMemo<Org | null>(() => {
    void dataVersion; void tick;
    const groups = getGroups(scope);
    const brands = getAgencies(scope);
    const groupByKey = groups.find((g) => (g.id ?? g.name) === decoded);
    if (groupByKey) return { kind: 'group', group: groupByKey, brands: brands.filter((a) => a.groupId === groupByKey.id) };
    const brand = brands.find((a) => (a.id ?? a.name) === decoded);
    if (!brand) return null;
    if (brand.groupId) {
      const g = getGroup(brand.groupId);
      if (g) return { kind: 'group', group: g, brands: brands.filter((a) => a.groupId === g.id) };
    }
    return { kind: 'brand', brand };
  }, [scope, decoded, dataVersion, tick]);

  const title = org ? (org.kind === 'group' ? org.group.name : org.brand.name) : 'Agency';
  usePageMeta('agency-home', title, ['Home', 'Relationships', 'Agencies', title]);

  // The brands and their branches, flattened, plus the owning partner slug (used
  // only to scope the people/referrals reads — never shown).
  const brands = org ? (org.kind === 'group' ? org.brands : [org.brand]) : [];
  const partner = org ? (org.kind === 'group' ? (org.brands[0]?.partner ?? '') : org.brand.partner) : '';
  const branchesFlat = useMemo(
    () => brands.flatMap((b) => (b.branches ?? []).map((br) => ({ brand: b, branch: br }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [org, tick],
  );
  const branchCount = branchesFlat.length;

  // People, bucketed by the level they hold a position on within this subtree.
  const [people, setPeople] = useState<{ group: Placed[]; brand: Record<string, Placed[]>; branch: Record<string, Placed[]>; total: number }>({ group: [], brand: {}, branch: {}, total: 0 });
  useEffect(() => {
    if (!org || !partner) { setPeople({ group: [], brand: {}, branch: {}, total: 0 }); return; }
    let alive = true;
    const groupId = org.kind === 'group' ? org.group.id : undefined;
    const brandIds = new Set(brands.map((b) => b.id).filter(Boolean) as string[]);
    const branchIds = new Set(branchesFlat.map((x) => x.branch.id).filter(Boolean) as string[]);
    const users = getUsers({ viewer: role, team: false, scope: partner });
    getPositionsForUsers(users.map((u) => u.id))
      .then((byUser) => {
        if (!alive) return;
        const g: Placed[] = []; const brand: Record<string, Placed[]> = {}; const branch: Record<string, Placed[]> = {};
        const seen = new Set<string>();
        const place = (bucket: Placed[], u: ManagedUser) => { bucket.push({ userId: u.id, name: u.name, email: u.email }); seen.add(u.id); };
        for (const u of users) {
          for (const p of byUser[u.id] ?? []) {
            if (p.kind === 'group' && groupId && p.targetId === groupId) place(g, u);
            else if (p.kind === 'agency' && brandIds.has(p.targetId)) { (brand[p.targetId] ||= []).push({ userId: u.id, name: u.name, email: u.email }); seen.add(u.id); }
            else if (p.kind === 'branch' && branchIds.has(p.targetId)) { (branch[p.targetId] ||= []).push({ userId: u.id, name: u.name, email: u.email }); seen.add(u.id); }
          }
        }
        setPeople({ group: g, brand, branch, total: seen.size });
      })
      .catch(() => { if (alive) setPeople({ group: [], brand: {}, branch: {}, total: 0 }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, partner, role, dataVersion, tick]);

  // Referrals beneath this org (route: Agency). Scoped to the partner, then to the
  // brands under it, so a group gathers all its brands' applications.
  const referrals = useMemo(() => {
    if (!org || !partner) return [];
    const names = new Set(brands.map((b) => b.name));
    return getApplications({ role, scope: partner }).filter((r) => names.has(r.agency));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, partner, role, dataVersion, tick]);

  // ---- commission tier editor state (superadmin) ----
  const base = getRatesFor(partner || ALL_PARTNERS);
  const grp = org?.kind === 'group' ? org.group : (org?.kind === 'brand' && org.brand.groupId ? getGroup(org.brand.groupId) : undefined);
  const rateStr = (n: number | null | undefined) => (n == null ? '' : String(n));
  // Draft rows keyed by tier id ("group:<id>" | "brand:<id>").
  const [draft, setDraft] = useState<Record<string, { p: string; a: string }>>({});
  const [savingRow, setSavingRow] = useState<string | null>(null);
  // Seed the draft whenever the org (or a save) changes the underlying rates.
  useEffect(() => {
    const d: Record<string, { p: string; a: string }> = {};
    if (grp) d[`group:${grp.id}`] = { p: rateStr(grp.partnerRate), a: rateStr(grp.agentRate) };
    for (const b of brands) if (b.id) d[`brand:${b.id}`] = { p: rateStr(b.partnerRate), a: rateStr(b.agentRate) };
    setDraft(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, tick]);

  if (!org) {
    return (
      <>
        <div className="page-head">
          <div>
            <div className="page-head__eyebrow">Agencies</div>
            <h1 className="page-head__title">Agency not found</h1>
            <p className="page-head__sub">This group or brand is not in your view, or the link is out of date.</p>
          </div>
        </div>
        <Card><CardBody><Link className="ah-back" to="/agencies"><Icon name="arrowLeft" size={14} /> Back to agencies</Link></CardBody></Card>
      </>
    );
  }

  const parseRate = (s: string): number | null | undefined => {
    const t = s.trim();
    if (t === '') return null; // inherit
    const n = parseFloat(t);
    return isNaN(n) || n < 0 || n > 1 ? undefined : n; // undefined = invalid
  };
  const saveRow = async (rowKey: string) => {
    const cur = draft[rowKey]; if (!cur) return;
    const p = parseRate(cur.p); const a = parseRate(cur.a);
    if (p === undefined || a === undefined) { toast('Rates must be a fraction between 0 and 1, e.g. 0.30. Blank inherits the tier above.', 'error'); return; }
    const [kind, id] = rowKey.split(':');
    setSavingRow(rowKey);
    try {
      if (kind === 'group') await setGroupRates(id, p, a);
      else await setAgencyRates(id, p, a);
      refreshSession();
      bump();
      toast('Commission saved.', 'ok');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the commission.', 'error');
    } finally {
      setSavingRow(null);
    }
  };

  // Resolved rate for a representative brand → branch (group → brand → base).
  const sampleBrand = brands.find((b) => (b.branches ?? []).length > 0) ?? brands[0];
  const sampleBranch = sampleBrand?.branches?.[0];
  const resolvedP = grp?.partnerRate ?? sampleBrand?.partnerRate ?? base.partner;
  const resolvedA = grp?.agentRate ?? sampleBrand?.agentRate ?? base.agent;

  const inviteBtn = (ctx: InviteContext, label: string, variant: 'primary' | 'ghost' = 'ghost') => (
    <Button variant={variant} size="sm" onClick={() => setInvite(ctx)}><Icon name="send" /> {label}</Button>
  );

  const summary = org.kind === 'group'
    ? `Group · ${brands.length} ${brands.length === 1 ? 'brand' : 'brands'} · ${branchCount} ${branchCount === 1 ? 'branch' : 'branches'} · ${people.total} ${people.total === 1 ? 'person' : 'people'} · ${referrals.length} referrals`
    : `Brand · ${branchCount} ${branchCount === 1 ? 'branch' : 'branches'} · ${people.total} ${people.total === 1 ? 'person' : 'people'} · ${referrals.length} referrals`;

  const recent = referrals.slice(0, 12);

  return (
    <>
      <div className="page-head" style={{ alignItems: 'center' }}>
        <div>
          <Link className="ah-back" to="/agencies"><Icon name="arrowLeft" size={14} /> Agencies</Link>
          <h1 className="page-head__title" style={{ marginTop: 8 }}>{title}</h1>
          <p className="page-head__sub ah-sub"><Pill variant="paid">Agency</Pill> <span>{summary}</span></p>
        </div>
        <div className="page-head__actions">
          {isAdmin && inviteBtn(
            org.kind === 'group' ? { level: 'group', partner, groupId: org.group.id, name: org.group.name } : { level: 'brand', partner, agencyId: org.brand.id, name: org.brand.name },
            'Invite manager', 'primary',
          )}
        </div>
      </div>

      <div className="ah-grid">
        {/* STRUCTURE — group -> brand -> branch tree */}
        <div className="block card">
          <div className="block-h"><h4>Structure</h4><span className="block-sub">group → brand → branch</span></div>
          <div className="ah-tree">
            {org.kind === 'group' && (
              <div className="ah-node"><span className="ah-tick t-group">G</span><span className="ah-nm">{org.group.name}</span><span className="ah-mt">group</span></div>
            )}
            {brands.map((b) => (
              <div key={b.id ?? b.name}>
                <div className={`ah-node${org.kind === 'group' ? ' lv2' : ''}`}>
                  <span className="ah-tick t-brand">B</span>
                  <span className="ah-nm">{b.name}</span>
                  <span className="ah-mt">{(b.branches ?? []).length} {(b.branches ?? []).length === 1 ? 'branch' : 'branches'}</span>
                </div>
                {(b.branches ?? []).map((br) => (
                  <div key={br.id ?? br.name} className={org.kind === 'group' ? 'ah-node lv3' : 'ah-node lv2'}>
                    <span className="ah-tick t-branch">•</span>
                    <Link className="ah-nm ah-nm--link" to={`/applications?branch=${encodeURIComponent(br.name)}`}>{br.name}</Link>
                    <span className="ah-mt">{br.referrals} refs</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* COMMISSION — tier editor */}
        <div className="block card">
          <div className="block-h"><h4>Commission</h4>{isAdmin && <span className="ah-newtag">editor</span>}<span className="block-sub" style={{ marginLeft: 'auto' }}>share of the guarantee fee</span></div>
          <div className="ah-comm">
            <div className="ah-crow ah-crow--head"><span>Tier</span><span>Opndoor</span><span>Agent</span></div>
            {grp && (
              <RateRow
                label={<><b>Group override</b><br /><span>applies to all brands unless a brand sets its own</span></>}
                rowKey={`group:${grp.id}`} draft={draft} setDraft={setDraft} editable={isAdmin}
                saving={savingRow === `group:${grp.id}`} onSave={() => saveRow(`group:${grp.id}`)}
              />
            )}
            {brands.filter((b) => b.id).map((b) => (
              <RateRow
                key={b.id}
                label={<><b>{b.name}</b><br /><span>brand override</span></>}
                rowKey={`brand:${b.id}`} draft={draft} setDraft={setDraft} editable={isAdmin}
                saving={savingRow === `brand:${b.id}`} onSave={() => saveRow(`brand:${b.id}`)}
              />
            ))}
            <div className="ah-crow">
              <div className="ah-clbl"><b>Opndoor base</b><br /><span>fallback for anything unset</span></div>
              <span className="ah-inp ah-inp--ro">{base.partner}</span>
              <span className="ah-inp ah-inp--ro">{base.agent}</span>
            </div>
            {sampleBrand && sampleBranch && (
              <div className="ah-resolved">
                <Icon name="check" size={14} /> Resolved for <b>{sampleBrand.name} → {sampleBranch.name}</b>: <b style={{ margin: '0 4px' }}>{fmtRatePct(resolvedP)} / {fmtRatePct(resolvedA)}</b>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* PEOPLE & POSITIONS — bucketed by level, invite from the level */}
      <Card>
        <CardHead title="People & positions" sub="who covers what — invited from the level they sit at" />
        <CardBody>
          {org.kind === 'group' && (
            <PeopleBlock
              eyebrow={<><span className="ah-pos ah-pos--grp">Group director</span> · {org.group.name}</>}
              people={people.group} emptyRole="group director"
              invite={isAdmin ? () => setInvite({ level: 'group', partner, groupId: org.group.id, name: org.group.name }) : undefined}
            />
          )}
          {brands.map((b) => (
            <PeopleBlock
              key={`ppl-brand-${b.id ?? b.name}`}
              eyebrow={<><span className="ah-pos ah-pos--brand">Brand</span> · {b.name}</>}
              people={b.id ? (people.brand[b.id] ?? []) : []} emptyRole="brand manager"
              invite={isAdmin && b.id ? () => setInvite({ level: 'brand', partner, agencyId: b.id, name: b.name }) : undefined}
            />
          ))}
          {branchesFlat.map(({ brand, branch }) => (
            <PeopleBlock
              key={`ppl-branch-${branch.id ?? `${brand.name}-${branch.name}`}`}
              eyebrow={<><span className="ah-pos">Branch</span> · {branch.name}{org.kind === 'group' ? ` · ${brand.name}` : ''}</>}
              people={branch.id ? (people.branch[branch.id] ?? []) : []} emptyRole="branch manager or negotiator"
              invite={isAdmin && branch.id ? () => setInvite({ level: 'branch', partner, branchId: branch.id, name: branch.name }) : undefined}
            />
          ))}
        </CardBody>
      </Card>

      {/* REFERRALS — route: Agency */}
      <Card>
        <CardHead
          title="Referrals"
          sub="route: Agency"
          actions={org.kind === 'brand'
            ? <Link className="ah-viewall" to={`/applications?agency=${encodeURIComponent(org.brand.name)}`}>Open in Applications <Icon name="arrowRight" size={13} /></Link>
            : <Link className="ah-viewall" to="/applications?route=Agent%20referral">Open in Applications <Icon name="arrowRight" size={13} /></Link>}
        />
        <CardBody style={{ padding: recent.length === 0 ? undefined : 0 }}>
          {recent.length === 0 ? (
            <div className="ah-empty">No referrals beneath this {org.kind === 'group' ? 'group' : 'brand'} yet.</div>
          ) : (
            <table className="dt ah-table">
              <thead><tr><th>Tenant</th><th>Branch</th><th>Stage</th></tr></thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.ref}>
                    <td><Link className="ah-tenant" to={`/applications/${encodeURIComponent(r.ref)}`}><span className="who__av">{initials(r.tenant)}</span><span><span className="dt__name">{r.tenant}</span><span className="dt__sub">{r.ref}</span></span></Link></td>
                    <td className="soft">{r.branch}</td>
                    <td><span className={`ah-st ${STATUS_ST[r.status] ?? 'st-neutral'}`}>{STATUS_LABEL[r.status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {invite && <InviteToLevel ctx={invite} onClose={() => setInvite(null)} onInvited={() => { setInvite(null); refreshSession(); bump(); }} />}
    </>
  );
}

/** One editable commission tier row (two rate inputs + a per-row save). */
function RateRow({ label, rowKey, draft, setDraft, editable, saving, onSave }: {
  label: ReactNode; rowKey: string;
  draft: Record<string, { p: string; a: string }>;
  setDraft: Dispatch<SetStateAction<Record<string, { p: string; a: string }>>>;
  editable: boolean; saving: boolean; onSave: () => void;
}) {
  const v = draft[rowKey] ?? { p: '', a: '' };
  const set = (patch: Partial<{ p: string; a: string }>) => setDraft((d) => ({ ...d, [rowKey]: { ...(d[rowKey] ?? { p: '', a: '' }), ...patch } }));
  return (
    <div className="ah-crow">
      <div className="ah-clbl">{label}</div>
      {editable ? (
        <>
          <input className={`ah-inp${v.p ? ' set' : ''}`} inputMode="decimal" placeholder="inherit" value={v.p} onChange={(e) => set({ p: e.target.value })} aria-label="Opndoor rate" />
          <input className={`ah-inp${v.a ? ' set' : ''}`} inputMode="decimal" placeholder="inherit" value={v.a} onChange={(e) => set({ a: e.target.value })} aria-label="Agent rate" />
          <button className="ah-crow__save" onClick={onSave} disabled={saving} title="Save this tier">{saving ? '…' : 'Save'}</button>
        </>
      ) : (
        <>
          <span className={`ah-inp${v.p ? ' set' : ' ah-inp--ro'}`}>{v.p || '—'}</span>
          <span className={`ah-inp${v.a ? ' set' : ' ah-inp--ro'}`}>{v.a || '—'}</span>
        </>
      )}
    </div>
  );
}

/** People at one level: a labelled block with rows and an invite-from-here action. */
function PeopleBlock({ eyebrow, people, emptyRole, invite }: { eyebrow: ReactNode; people: Placed[]; emptyRole: string; invite?: () => void }) {
  return (
    <div className="ah-people-block">
      <div className="ah-people-head">
        <span className="ah-people-eyebrow">{eyebrow}</span>
        {invite && <button className="ah-invite" onClick={invite}><Icon name="send" size={12} /> Invite</button>}
      </div>
      {people.length > 0 ? (
        <div className="ah-people">
          {people.map((p) => (
            <div key={p.userId} className="ah-person">
              <span className="ah-person__av">{initials(p.name || p.email)}</span>
              <div className="ah-person__body">
                <div className="ah-person__name">{p.name || p.email}</div>
                <div className="ah-person__em">{p.email}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="ah-people-empty">No {emptyRole} yet.{invite ? ' Invite one from here.' : ''}</div>
      )}
    </div>
  );
}

export const agencyKey = (a: Agency): string => a.id ?? a.name;
