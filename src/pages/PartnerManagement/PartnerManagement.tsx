/* =====================================================================
   Partners — the top of the hierarchy (opndoor admin only, enforced by the
   route guard). Lists every partner with users/agencies/branches/apps and
   status, drills into a partner's users, and onboards / amends partners
   (including their per-partner commission rates) via the add/manage modal.
   ===================================================================== */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { addPartner, getPartner, getPartners, getReferrerLeaderboardMode, orgCounts, setReferrerLeaderboardMode, updatePartnerSettings, getPartnerAudit, type LeaderboardMode, type PartnerAuditEntry, type PartnerSettingsInput, type PartnerStatus, partnerActiveKeyCount, REFERENCING_MODES, type ReferencingMode } from '@/data';
import { useSession } from '@/session/SessionContext';
import { fmtRatePct } from '@/lib/format';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Card, CardHead } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Pill, type PillVariant } from '@/components/ui/Pill';
import { Tag } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import '@/components/ui/opbar.css';
import './PartnerManagement.css';

const STATUS_PILL: Record<PartnerStatus, [string, PillVariant]> = {
  active: ['Active', 'deed'],
  onboarding: ['Onboarding', 'warn'],
  paused: ['Paused', 'muted'],
};
const initials = (n: string) => n.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
// One decimal, never rounded, so a 9.5% rate populates the editor as "9.5" (not "10").
const asPct = (frac: number | undefined, fallback: number) => Number(((frac != null ? frac : fallback) * 100).toFixed(1));

const AUDIT_LABEL: Record<string, string> = {
  partner_rate: 'Supplier commission', agent_rate: 'Agent commission',
  status: 'Status', live_from: 'Live from', name: 'Name',
  referrer_leaderboard: 'Referrer leaderboard',
};
const auditField = (f: string) => AUDIT_LABEL[f] ?? f;

const LB_LABEL: Record<LeaderboardMode, string> = {
  full: 'Full (rankings and fees)',
  rankings: 'Rankings only (no fees)',
  private: 'Private (own performance only)',
};
// Friendly audit values for the leaderboard field (raw values are full/rankings/private).
const LB_SHORT: Record<string, string> = { full: 'Full', rankings: 'Rankings only', private: 'Private' };
const auditValue = (f: string, v: string) => (f === 'referrer_leaderboard' ? (LB_SHORT[v] ?? v) : v);
const dmy = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

interface RateChange { label: string; from: string; to: string; }

export function PartnerManagement() {
  usePageMeta('partners', 'Suppliers', ['Home', 'Relationships', 'Suppliers']);
  const navigate = useNavigate();
  const toast = useToast();
  const { refresh: refreshData } = useSession();
  const [, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [since, setSince] = useState('');
  const [status, setStatus] = useState<PartnerStatus>('active');
  const [partnerRate, setPartnerRate] = useState('25');
  const [agentRate, setAgentRate] = useState('10');
  const [refMode, setRefMode] = useState<ReferencingMode>('pre_referenced_screened');
  const [portalOn, setPortalOn] = useState(true);
  const [apiOn, setApiOn] = useState(false);
  // How many keys stop working if API access is turned off. Fetched when the
  // edit opens, so the confirmation can name a number rather than a warning.
  const [activeKeys, setActiveKeys] = useState(0);
  const [lbMode, setLbMode] = useState<LeaderboardMode>('full'); // #88 referrer leaderboard visibility
  const [audit, setAudit] = useState<PartnerAuditEntry[]>([]);
  const [showAllAudit, setShowAllAudit] = useState(false); // #89 cap Recent changes at 5
  const [saving, setSaving] = useState(false);
  // Pending rate change awaiting confirmation (current -> new), or null.
  const [confirm, setConfirm] = useState<{ input: PartnerSettingsInput; changes: RateChange[] } | null>(null);
  // #114 Referrer-leaderboard change awaiting confirmation (Manage partner is the single lever).
  const [lbConfirm, setLbConfirm] = useState<LeaderboardMode | null>(null);

  const partners = getPartners();

  function openAdd() {
    setEditingId(null);
    setName('');
    setSince('');
    setStatus('active');
    setPartnerRate('25');
    setAgentRate('10');
    // New partners default to screened and portal-only. Screened refuses
    // applications until that mode is built, which is the safe place to start:
    // open means no criteria at all and is a commercial decision, not a default.
    setRefMode('pre_referenced_screened');
    setPortalOn(true);
    setApiOn(false);
    setActiveKeys(0);
    setAudit([]);
    setConfirm(null);
    setOpen(true);
  }
  function openEdit(id: string) {
    const p = getPartner(id);
    if (!p) return;
    setEditingId(id);
    setName(p.name);
    setSince(p.since || '');
    setStatus(p.status || 'active');
    setPartnerRate(String(asPct(p.partnerRate, 0.25)));
    setAgentRate(String(asPct(p.agentRate, 0.1)));
    setRefMode(p.referencingMode ?? 'pre_referenced_screened');
    setPortalOn(p.portalReferralsEnabled !== false);
    setApiOn(p.apiAccessEnabled === true);
    setActiveKeys(0);
    void partnerActiveKeyCount(id).then(setActiveKeys).catch(() => setActiveKeys(0));
    setLbMode(getReferrerLeaderboardMode(id));
    setConfirm(null);
    setAudit([]);
    setShowAllAudit(false);
    getPartnerAudit(id).then(setAudit).catch(() => setAudit([]));
    setOpen(true);
  }

  // #88 The referrer-leaderboard setting saves immediately (not via the rate save,
  // which has a rate-confirmation early-return). Same governed RPC + audit.
  async function changeLbMode(next: LeaderboardMode) {
    if (!editingId) return;
    const prev = lbMode;
    setLbMode(next);
    try {
      await setReferrerLeaderboardMode(editingId, next);
      await refreshData();
      getPartnerAudit(editingId).then(setAudit).catch(() => { /* keep prior */ });
      toast('Referrer leaderboard visibility updated.', 'error');
    } catch (e) {
      setLbMode(prev);
      toast(e instanceof Error ? e.message : 'Could not update the setting.', 'error');
    }
  }

  const modeLabel = (m: ReferencingMode): string =>
    REFERENCING_MODES.find((x) => x.id === m)?.label ?? m;

  function readRate(v: string, fallback: number): number {
    const n = parseFloat(v);
    if (isNaN(n) || n < 0) return fallback;
    return Math.min(100, n) / 100;
  }

  // Persist an edit (already confirmed for rate changes) and re-hydrate.
  async function applyUpdate(id: string, input: PartnerSettingsInput) {
    setSaving(true);
    try {
      await updatePartnerSettings(id, input);
      await refreshData(); // live mode: re-read the partner (and its new live rate)
      toast(`Updated ${input.name}. New applications will use ${fmtRatePct(input.partnerRate)} supplier / ${fmtRatePct(input.agentRate)} agent; existing applications keep the rate recorded when they were created.`);
      setConfirm(null);
      setOpen(false);
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the partner.', 'error');
    } finally {
      setSaving(false);
    }
  }

  function save() {
    if (!name.trim() || saving) return;
    const pr = readRate(partnerRate, 0.25);
    const ar = readRate(agentRate, 0.1);
    if (editingId) {
      const cur = getPartner(editingId);
      if (!cur) return;
      const input: PartnerSettingsInput = {
        name: name.trim(), status, since, partnerRate: pr, agentRate: ar,
        referencingMode: refMode, portalReferralsEnabled: portalOn, apiAccessEnabled: apiOn,
      };
      // A rate change needs explicit confirmation (current -> new), since it sets
      // the rate for new applications going forward.
      const changes: RateChange[] = [];
      if (cur.partnerRate !== pr) changes.push({ label: 'Supplier commission', from: fmtRatePct(cur.partnerRate ?? 0.25), to: fmtRatePct(pr) });
      if (cur.agentRate !== ar) changes.push({ label: 'Agent commission', from: fmtRatePct(cur.agentRate ?? 0.1), to: fmtRatePct(ar) });
      if ((cur.referencingMode ?? 'pre_referenced_screened') !== refMode) {
        changes.push({
          label: 'Referencing mode',
          from: modeLabel(cur.referencingMode ?? 'pre_referenced_screened'),
          to: modeLabel(refMode),
        });
      }
      if ((cur.portalReferralsEnabled !== false) !== portalOn) {
        changes.push({ label: 'Portal referrals', from: cur.portalReferralsEnabled !== false ? 'On' : 'Off', to: portalOn ? 'On' : 'Off' });
      }
      // Named separately and last, because turning it OFF is the one change here
      // that breaks something already running.
      if ((cur.apiAccessEnabled === true) !== apiOn) {
        changes.push({
          label: 'API access',
          from: cur.apiAccessEnabled ? 'On' : 'Off',
          to: apiOn
            ? 'On'
            : activeKeys > 0
              ? `Off. ${activeKeys} active key${activeKeys === 1 ? '' : 's'} stop working immediately`
              : 'Off',
        });
      }
      if (changes.length) {
        setConfirm({ input, changes });
        return;
      }
      void applyUpdate(editingId, input);
    } else {
      // Awaited now. It used to be a synchronous localStorage write that reported
      // success without persisting anything, so the toast below is only reached
      // if the server actually created the row.
      setSaving(true);
      addPartner({
        name: name.trim(), since: since || undefined, status, partnerRate: pr, agentRate: ar,
        referencingMode: refMode, portalReferralsEnabled: portalOn, apiAccessEnabled: apiOn,
      })
        .then(async (rec) => {
          await refreshData();
          toast(`Partner "${rec.name}" created at ${Math.round(pr * 100)}% supplier / ${Math.round(ar * 100)}% agent. Add users, agencies and branches under it next.`);
          setOpen(false);
          refresh();
        })
        .catch((e) => toast(e instanceof Error ? e.message : 'Could not create the partner.', 'error'))
        .finally(() => setSaving(false));
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="rec-eyebrow"><span className="opx">opndoor</span> · internal admin</div>
          <h1 className="page-head__title" style={{ marginTop: 10 }}>Partners</h1>
          <p className="page-head__sub">Every partner company on the portal. A partner sits at the top of the hierarchy, with its own users, agencies, branches and applications beneath it. Click a partner to open its page; <b>Manage</b> edits its settings.</p>
        </div>
        <div className="page-head__actions">
          <Button variant="primary" size="sm" onClick={openAdd}><Icon name="plus" /> Add partner</Button>
        </div>
      </div>

      <div className="card opbar">
        <Icon name="shield" />
        <span>Visible to <b>opndoor admins</b> only. Partners never see each other; each partner only sees its own data.</span>
      </div>

      <Card>
        <CardHead
          title="All partners"
          sub={`${partners.length} partner ${partners.length === 1 ? 'company' : 'companies'}`}
          actions={<Button variant="quiet" size="sm" to="/users" arrow>All users · all partners</Button>}
        />
        <div className="table-wrap">
          <table className="dt ptable">
            <thead>
              <tr>
                <th>Partner</th>
                <th style={{ textAlign: 'right' }}>Users</th>
                <th style={{ textAlign: 'right' }}>Agencies</th>
                <th style={{ textAlign: 'right' }}>Branches</th>
                <th style={{ textAlign: 'right' }}>Applications</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => {
                const c = orgCounts(p.id);
                const sp = STATUS_PILL[p.status] || STATUS_PILL.active;
                return (
                  <tr key={p.id}>
                    <td>
                      <div className="pco">
                        <span className="pco__logo">{initials(p.name)}</span>
                        <div>
                          <div className="pco__name"><Link className="pco__namelink" to={`/partners/${encodeURIComponent(p.id)}`} title={`Open ${p.name}`}>{p.name}</Link>{p.primary && <> <Tag variant="primary">Primary</Tag></>}</div>
                          <div className="pco__since">Live from {p.since || '—'} · Supplier {fmtRatePct(p.partnerRate ?? 0.25)} / Agent {fmtRatePct(p.agentRate ?? 0.1)}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}><span className="pnum">{p.users}</span></td>
                    <td style={{ textAlign: 'right' }}><span className="pnum">{c.agencies}</span></td>
                    <td style={{ textAlign: 'right' }}><span className="pnum">{c.branches}</span></td>
                    <td style={{ textAlign: 'right' }}><span className="pnum">{p.apps.toLocaleString('en-GB')}</span></td>
                    <td><Pill variant={sp[1]}>{sp[0]}</Pill></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Button variant="ghost" size="sm" onClick={() => navigate(`/users?partner=${encodeURIComponent(p.id)}`)}>Users</Button>{' '}
                      <Button variant="primary" size="sm" onClick={() => openEdit(p.id)}>Manage</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editingId ? `Manage ${getPartner(editingId)?.name ?? ''}` : 'Add partner'}
        sub={editingId ? "Adjust this partner’s details and commission. Rate changes apply to new applications from now on." : 'Onboard a new partner company. Users, agencies and branches can be added under it afterwards.'}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button><Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Create partner'}</Button></>}
      >
        <Field label="Partner company name" htmlFor="pm-name"><input id="pm-name" type="text" placeholder="e.g. Acme Property Group" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Live from" htmlFor="pm-since" hint="Optional"><input id="pm-since" type="month" value={since} onChange={(e) => setSince(e.target.value)} /></Field>
        <Field label="Status" htmlFor="pm-status">
          <select id="pm-status" value={status} onChange={(e) => setStatus(e.target.value as PartnerStatus)}>
            <option value="active">Active</option>
            <option value="onboarding">Onboarding</option>
            <option value="paused">Paused</option>
          </select>
        </Field>
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16, marginTop: 2 }}>
          <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 14, marginBottom: 3 }}>Referencing</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginBottom: 12 }}>
            What happens to an application after it arrives. Each application records the mode in force
            when it was created, so changing this never rewrites the basis of applications already in flight.
          </div>
          <Field label="Referencing mode" htmlFor="pm-refmode">
            <select id="pm-refmode" value={refMode} onChange={(e) => setRefMode(e.target.value as ReferencingMode)}>
              {REFERENCING_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </Field>
          <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginTop: -6, marginBottom: 4 }}>
            {REFERENCING_MODES.find((m) => m.id === refMode)?.desc}
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16, marginTop: 16 }}>
          <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 14, marginBottom: 3 }}>Capabilities</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginBottom: 12 }}>
            What this partner can do. Two independent settings rather than one partner type: an agency is
            portal only, a CRM is API only, and some partners are both.
          </div>

          <label className="pmcap">
            <input type="checkbox" checked={portalOn} onChange={(e) => setPortalOn(e.target.checked)} />
            <div>
              <div className="pmcap__name">Portal referrals</div>
              <div className="pmcap__desc">
                Their staff can create referrals in the portal. Turning this off refuses new referrals for
                this partner, including ones an opndoor admin makes on their behalf. Existing applications
                are untouched.
              </div>
            </div>
          </label>

          <label className="pmcap">
            <input type="checkbox" checked={apiOn} onChange={(e) => setApiOn(e.target.checked)} />
            <div>
              <div className="pmcap__name">API access</div>
              <div className="pmcap__desc">
                They can hold API keys and reach the partner API, and the Dev Centre appears for their
                developers.{' '}
                {!apiOn && activeKeys > 0 ? (
                  <b>
                    Turning this off stops {activeKeys} active key{activeKeys === 1 ? '' : 's'} working
                    immediately, not just new ones. A live integration will start failing as soon as you save.
                  </b>
                ) : (
                  <>Off by default, so enabling the API is always a deliberate act.</>
                )}
              </div>
            </div>
          </label>
        </div>

        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16, marginTop: 16 }}>
          <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 14, marginBottom: 3 }}>Commission</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginBottom: 12 }}>
            Each a share of the guarantor fee (one month's rent). These are the rates for <b>new applications from now on</b>. Applications already created keep the rate recorded when they were created, so past settlements and reports never change.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Supplier commission %" htmlFor="pm-partner-rate"><input id="pm-partner-rate" type="number" step="0.5" min="0" max="100" placeholder="25" value={partnerRate} onChange={(e) => setPartnerRate(e.target.value)} /></Field>
            <Field label="Agent commission %" htmlFor="pm-agent-rate"><input id="pm-agent-rate" type="number" step="0.5" min="0" max="100" placeholder="10" value={agentRate} onChange={(e) => setAgentRate(e.target.value)} /></Field>
          </div>
        </div>

        {/* #88 Referrer leaderboard visibility (per-partner policy, saves immediately). */}
        {editingId && (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16, marginTop: 16 }}>
            <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 14, marginBottom: 3 }}>Referrer leaderboard</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginBottom: 12 }}>
              What referrers at this partner see on the League Referrers tab. Commission is never shown to referrers.
            </div>
            <Field label="Visibility" htmlFor="pm-lb-mode">
              <select id="pm-lb-mode" value={lbMode} onChange={(e) => setLbConfirm(e.target.value as LeaderboardMode)}>
                {(Object.keys(LB_LABEL) as LeaderboardMode[]).map((m) => <option key={m} value={m}>{LB_LABEL[m]}</option>)}
              </select>
            </Field>
          </div>
        )}

        {editingId && (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16, marginTop: 16 }}>
            <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Recent changes</div>
            {audit.length > 0 ? (
              <>
                <ul className="pm-audit">
                  {(showAllAudit ? audit : audit.slice(0, 5)).map((e, i) => (
                    <li key={i} className="pm-audit__row">
                      <span className="pm-audit__field">{auditField(e.field)}</span>
                      <span className="pm-audit__delta">{auditValue(e.field, e.oldValue)} → <b>{auditValue(e.field, e.newValue)}</b></span>
                      <span className="pm-audit__meta">{e.actor} · {dmy(e.at)}</span>
                    </li>
                  ))}
                </ul>
                {audit.length > 5 && (
                  <button type="button" className="pm-audit__more" onClick={() => setShowAllAudit((v) => !v)}>
                    {showAllAudit ? 'Show fewer' : `View all changes (${audit.length})`}
                  </button>
                )}
              </>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: 0 }}>No changes recorded yet. Edits to this partner's name, status, go-live date or commission rates will appear here.</p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        width={460}
        title="Confirm commission change"
        sub="This sets the rate for new applications from now on. Existing applications keep the rate recorded when they were created, so past settlements and reports are unaffected."
        footer={<><Button variant="ghost" onClick={() => setConfirm(null)} disabled={saving}>Back</Button><Button variant="primary" onClick={() => confirm && editingId && applyUpdate(editingId, confirm.input)} disabled={saving}>{saving ? 'Saving…' : 'Confirm change'}</Button></>}
      >
        <ul className="pm-confirm">
          {confirm?.changes.map((c) => (
            <li key={c.label} className="pm-confirm__row">
              <span className="pm-confirm__label">{c.label}</span>
              <span className="pm-confirm__delta"><span className="pm-confirm__from">{c.from}</span> → <b className="pm-confirm__to">{c.to}</b></span>
            </li>
          ))}
        </ul>
        <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginTop: 4 }}>This change is recorded in the partner's audit trail.</p>
      </Modal>

      <Modal
        open={lbConfirm !== null}
        onClose={() => setLbConfirm(null)}
        width={460}
        title="Change referrer leaderboard visibility?"
        sub={`This changes what all referrers at ${name || 'this partner'} see on their leaderboard. Commission is never shown to referrers.`}
        footer={<><Button variant="ghost" onClick={() => setLbConfirm(null)}>Back</Button><Button variant="primary" onClick={() => { const n = lbConfirm; setLbConfirm(null); if (n) void changeLbMode(n); }}>Change visibility</Button></>}
      >
        <ul className="pm-confirm">
          <li className="pm-confirm__row">
            <span className="pm-confirm__label">Visibility</span>
            <span className="pm-confirm__delta"><span className="pm-confirm__from">{LB_LABEL[lbMode]}</span> → <b className="pm-confirm__to">{lbConfirm ? LB_LABEL[lbConfirm] : ''}</b></span>
          </li>
        </ul>
        <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginTop: 4 }}>This change is recorded in the partner's audit trail.</p>
      </Modal>
    </>
  );
}
