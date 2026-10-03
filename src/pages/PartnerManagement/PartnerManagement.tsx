/* =====================================================================
   Suppliers — the top of the hierarchy (opndoor admin only, enforced by the
   route guard). Lists every supplier with users/agencies/branches/apps and
   status, drills into a supplier's users, and onboards / amends suppliers
   via the add/manage modal.

   COMMISSION IS NOT EDITED HERE ANY MORE. Matt, 2026-09-30: "Supplier
   commission is edited only on the supplier's Commission tab ... Remove
   the two flat commission boxes from Manage." The word "partner" is the
   database's and survives in column names, RPC arguments and types; the
   screen says supplier.
   ===================================================================== */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { addPartner, getPartner, getPartners, getSupplierDeal, orgCounts, updatePartnerSettings, type AgreementView, type PartnerSettingsInput, type PartnerStatus, REFERENCING_MODES, type ReferencingMode } from '@/data';
import { partyIsSupplier } from '@/data/capabilities';
import { supplierDealLine } from '@/data/supplierDealLine';
import { useSession } from '@/session/SessionContext';
import { formatMonth } from '@/lib/format';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Card, CardHead } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { TenantsChecked } from '@/components/TenantsChecked';
import { Modal } from '@/components/ui/Modal';
import { Pill, type PillVariant } from '@/components/ui/Pill';
import { Tag } from '@/components/ui/Tag';
import { useToast } from '@/components/ui/Toast';
import '@/components/ui/opbar.css';
import './PartnerManagement.css';
import { plural } from '@/lib/plural';

const STATUS_PILL: Record<PartnerStatus, [string, PillVariant]> = {
  active: ['Active', 'deed'],
  onboarding: ['Onboarding', 'warn'],
  paused: ['Paused', 'muted'],
};
const initials = (n: string) => n.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();



interface RateChange { label: string; from: string; to: string; }

export function PartnerManagement() {
  usePageMeta('partners', 'Suppliers', ['Home', 'Relationships', 'Suppliers']);
  const navigate = useNavigate();
  const toast = useToast();
  const { refresh: refreshData, dataVersion } = useSession();
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
  const [saving, setSaving] = useState(false);
  // Pending rate change awaiting confirmation (current -> new), or null.
  const [confirm, setConfirm] = useState<{ input: PartnerSettingsInput; changes: RateChange[] } | null>(null);
  // #114 Referrer-leaderboard change awaiting confirmation (Manage partner is the single lever).

  /* ONLY REAL SUPPLIERS. Matt, 2026-10-02: "Harbour Lets shows as a
     supplier, but it's an agency (Opndoor-referenced). Only real
     suppliers appear here; agencies appear under Agencies."

     THE SAME THREE-WAY SPLIT AS THE ESTATES WORK, and the same
     predicate. This page asked a two-way question -- every row in
     `partners` is a supplier -- and `partners` holds three kinds:
     Opndoor's own house rails, suppliers, and partners of ours on the
     AGENCY rail. Harbour Lets is the third: referencing_mode is
     'opndoor_referenced', so it is one of our agencies that happens to
     carry its own partner record.

     WHERE IT GOES INSTEAD: nowhere new. The agency "Harbour Lets" is
     already on the Agencies screen, under its own partner, because that
     screen lists AGENCY rows. Nothing is hidden by this filter -- the
     company is in exactly one place now rather than two.

     `partyIsSupplier` also refuses the house partners, which never
     belonged on a customer-facing list either. */
  const partners = getPartners().filter((p) => partyIsSupplier(p.id));

  /* EACH SUPPLIER'S DEAL, FOR THE LINE UNDER ITS NAME. Matt, 2026-10-02:
     "replace 'Total 25.0%, agents' share 10.0%' with the plain one-line
     summary of its current deal from its Commission tab ... so it never
     shows a rate that isn't in force."

     ONE ROUND OF PARALLEL CALLS, not one per render. `supplier_deal` is
     scope-exact and takes a slug, so a list needs one call per supplier
     per kind; they go out together and the line falls back to the
     standard columns until they land, which is what it said before and
     is never wrong for a supplier on standard terms.

     Keyed on the slug list and dataVersion, so adding a supplier or
     saving a deal re-reads rather than leaving a stale rate on screen. */
  const slugs = partners.map((p) => p.id).join(',');
  const [deals, setDeals] = useState<Record<string, { commission: AgreementView | null; agentShare: AgreementView | null }>>({});
  useEffect(() => {
    let alive = true;
    const ids = slugs ? slugs.split(',') : [];
    void Promise.all(ids.map(async (slug) => {
      const [commission, agentShare] = await Promise.all([
        getSupplierDeal(slug, 'commission').catch(() => null),
        getSupplierDeal(slug, 'agent_share').catch(() => null),
      ]);
      return [slug, { commission, agentShare }] as const;
    })).then((pairs) => { if (alive) setDeals(Object.fromEntries(pairs)); });
    return () => { alive = false; };
  }, [slugs, dataVersion]);

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
    setConfirm(null);
    setOpen(true);
  }

  // #88 The referrer-leaderboard setting saves immediately (not via the rate save,
  // which has a rate-confirmation early-return). Same governed RPC + audit.

  const modeLabel = (m: ReferencingMode): string =>
    /* THE ANSWER, NOT THE FIELD'S OLD NAME. The form no longer shows
       'Pre-referenced, screened' anywhere, so a confirmation saying the
       change was "to Pre-referenced, screened" would name words the reader
       has never seen. `choice` is the line they clicked. */
    REFERENCING_MODES.find((x) => x.id === m)?.choice ?? m;

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
      toast(`Updated ${input.name}.`);
      setConfirm(null);
      setOpen(false);
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the supplier.', 'error');
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
      /* THE STORED RATES, UNCHANGED. update_partner_settings still takes
         both -- narrowing a nine-argument RPC is a migration of its own
         and is listed for the morning -- so this screen passes back
         exactly what is there rather than a value from a box it no
         longer has. Without this, saving a name change on Manage would
         write whatever the (now absent) rate state happened to hold and
         silently undo the Commission tab. */
      const input: PartnerSettingsInput = {
        name: name.trim(), status, since,
        partnerRate: cur.partnerRate ?? 0.25, agentRate: cur.agentRate ?? 0.1,
        referencingMode: refMode, portalReferralsEnabled: portalOn, apiAccessEnabled: apiOn,
      };
      const changes: RateChange[] = [];
      if ((cur.referencingMode ?? 'pre_referenced_screened') !== refMode) {
        changes.push({
          /* NAMED AS THE FORM NAMES IT. The field was labelled "Referencing
             mode" while it was a dropdown of that name; the form now asks
             "How are this supplier's tenants checked?", so a confirmation
             headed "Referencing mode" would name a control that is no longer
             on the page. changeSentence calls the same field "Referencing" in
             the audit trail, which is the same vocabulary. */
          label: 'How tenants are checked',
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
              ? `Off. ${activeKeys} active ${plural(activeKeys, 'key')} stop working immediately`
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
          /* NAMES THE NEXT STEP, because commission is no longer set
             here and a supplier created silently on a default rate is a
             money default nobody chose. */
          toast(`Supplier "${rec.name}" created. Set its commission on the Commission tab, then add users, agencies and branches.`);
          setOpen(false);
          refresh();
        })
        .catch((e) => toast(e instanceof Error ? e.message : 'Could not create the supplier.', 'error'))
        .finally(() => setSaving(false));
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="rec-eyebrow"><span className="opx">opndoor</span> · internal admin</div>
          <h1 className="page-head__title" style={{ marginTop: 10 }}>Suppliers</h1>
          <p className="page-head__sub">Every supplier on the portal. A supplier sits at the top of the hierarchy, with its own users, agencies, branches and applications beneath it. Click a supplier to open its page, where its people, settings, commission and integration are.</p>
        </div>
        <div className="page-head__actions">
          <Button variant="primary" size="sm" onClick={openAdd}><Icon name="plus" /> Add supplier</Button>
        </div>
      </div>

      <div className="card opbar">
        <Icon name="shield" />
        <span>Visible to <b>opndoor admins</b> only. Suppliers never see each other; each supplier only sees its own data.</span>
      </div>

      <Card>
        <CardHead
          title="All suppliers"
          sub={`${partners.length} ${plural(partners.length, 'supplier')}`}
          /* NO "ALL USERS" LINK. Matt, 2026-10-02: "Remove the 'All users
             · all suppliers' link if it leads to the old Users page;
             each supplier's people are on its People tab." It did: /users
             is the estate-wide list this page's own buttons were taken
             off for on 2026-10-01, and leaving one link to it at the top
             kept the screen it was replaced by one click away. */
        />
        <div className="table-wrap">
          <table className="dt ptable">
            <thead>
              <tr>
                <th>Supplier</th>
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
                  /* THE ROW OPENS THE SUPPLIER. Matt, 2026-10-01:
                     "remove the Users and Manage buttons; clicking a
                     supplier opens its page." Keyboard too: a row that
                     only responds to a mouse is a link somebody cannot
                     reach. The name is still its own <Link>, so the
                     browser's own "open in new tab" keeps working. */
                  <tr
                    key={p.id}
                    className="prow"
                    tabIndex={0}
                    role="link"
                    aria-label={`Open ${p.name}`}
                    onClick={() => navigate(`/partners/${encodeURIComponent(p.id)}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(`/partners/${encodeURIComponent(p.id)}`);
                      }
                    }}
                  >
                    <td>
                      <div className="pco">
                        <span className="pco__logo">{initials(p.name)}</span>
                        <div>
                          <div className="pco__name"><Link className="pco__namelink" to={`/partners/${encodeURIComponent(p.id)}`} title={`Open ${p.name}`}>{p.name}</Link>{p.primary && <> <Tag variant="primary">Primary</Tag></>}</div>
                          {/* THE DEAL THAT IS ACTUALLY IN FORCE. This read the
                              partner_rate and agent_rate COLUMNS, which are the
                              standard terms -- what a supplier would be charged
                              with no deal of their own -- so a supplier on a
                              negotiated agreement was shown a pair of percentages
                              that appear in no agreement and match no statement
                              line. `supplierDealLine` prefers the agreement and
                              falls back to the columns only where nothing else is
                              in force. */}
                          <div className="pco__since">
                            Live from {formatMonth(p.since) || '-'} ·{' '}
                            {supplierDealLine({
                              commission: deals[p.id]?.commission ?? null,
                              agentShare: deals[p.id]?.agentShare ?? null,
                              standardTotal: p.partnerRate ?? null,
                              standardShare: p.agentRate ?? null,
                            })}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}><span className="pnum">{p.users}</span></td>
                    <td style={{ textAlign: 'right' }}><span className="pnum">{c.agencies}</span></td>
                    <td style={{ textAlign: 'right' }}><span className="pnum">{c.branches}</span></td>
                    <td style={{ textAlign: 'right' }}><span className="pnum">{p.apps.toLocaleString('en-GB')}</span></td>
                    <td><Pill variant={sp[1]}>{sp[0]}</Pill></td>
                    {/* NO BUTTONS. Users went to a filtered list of
                        every user in the estate; it is the supplier's
                        own People tab now. Manage opened a modal of the
                        settings that are on the supplier's Settings tab.
                        Both were a second way to somewhere the row
                        already goes. */}
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Icon name="chevronRight" className="prow__go" />
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
        /* CREATE ONLY. Matt, 2026-10-01: "Keep 'Add supplier' working
           with its own create form." Everything this modal used to EDIT
           is on the supplier's own Settings tab now, so the edit half is
           gone rather than kept as a second way to the same fields. */
        title="Add supplier"
        sub="Onboard a new supplier. Its people, agencies and branches are added on its own page afterwards."
        footer={<><Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button><Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Create supplier'}</Button></>}
      >
        <Field label="Supplier company name" htmlFor="pm-name"><input id="pm-name" type="text" placeholder="e.g. Acme Property Group" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} /></Field>
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
          {/* THE QUESTION, NOT THE FIELD NAME. Matt, 2026-10-03: "replace the
              'Referencing mode' dropdown with the same plain-English radio
              question as the agency page". Shared with Supplier Settings,
              which set the same field through its own copy of this select. */}
          <TenantsChecked name="pm-refmode" value={refMode} onChange={setRefMode} />
        </div>

        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16, marginTop: 16 }}>
          <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 14, marginBottom: 3 }}>Capabilities</div>
          {/* MATT'S OWN SENTENCE, 2026-10-03: "Rewrite the Capabilities intro
              as: 'How this supplier sends referrals: through the portal,
              through the API, or both.' Remove the line about agencies and
              CRMs." The old one explained the DESIGN -- why these are two
              independent settings rather than one supplier type -- which is a
              note to whoever built the form, not to whoever is filling it in.
              It also used "an agency" to mean a kind of supplier, which is not
              what the word means here. Supplier Settings already carried the
              corrected version; this form did not. */}
          <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginBottom: 12 }}>
            How this supplier sends referrals: through the portal, through the API, or both.
          </div>

          <label className="pmcap">
            <input type="checkbox" checked={portalOn} onChange={(e) => setPortalOn(e.target.checked)} />
            <div>
              <div className="pmcap__name">Portal referrals</div>
              <div className="pmcap__desc">
                Their staff can create referrals in the portal. Turning this off refuses new referrals for
                this supplier, including ones an opndoor admin makes on their behalf. Existing applications
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
                    Turning this off stops {activeKeys} active {plural(activeKeys, 'key')} working
                    immediately, not just new ones. A live integration will start failing as soon as you save.
                  </b>
                ) : (
                  <>Off by default, so enabling the API is always a deliberate act.</>
                )}
              </div>
            </div>
          </label>
        </div>

        {/* THE TWO FLAT COMMISSION BOXES ARE GONE. Matt, 2026-09-30:
            "Supplier commission is edited only on the supplier's
            Commission tab, under the new model ... Remove the two flat
            commission boxes from Manage."

            They were flat because the model was: one rate for the
            supplier and a separate one for agents, added together. It is
            one TOTAL now with the agents' share carved out of it and
            volume tiers inside that, which is more than two boxes can
            say, and two screens editing one number is how they come to
            disagree. */}
        

        {/* #88 Referrer leaderboard visibility (per-partner policy, saves immediately). */}
        

        
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

    </>
  );
}
