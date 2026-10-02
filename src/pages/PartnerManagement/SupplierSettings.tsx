/* =====================================================================
   A SUPPLIER'S SETTINGS, ON THE SUPPLIER'S PAGE.

   Matt, 2026-10-01: "On the supplier's page, its settings (name, live
   from, status, referencing mode, capabilities) move into a Settings
   tab, with the same fields as Manage."

   WHY THE FIELDS LIVE IN ONE PLACE. "The same fields as Manage" is a
   promise that decays the moment there are two copies of them: somebody
   adds a capability to one and the other quietly stops being able to set
   it. So the fields are a component, `SupplierFields`, and both this tab
   and the Add form on the Suppliers list render it. The only difference
   between the two is what the button says and what happens when it is
   pressed.

   API ACCESS IS NOT HERE. Matt, same evening: "Supplier Integration tab:
   add the API access on/off switch here (moved from Settings), with a
   confirmation that says how many active API keys will stop working if
   it's turned off." So this tab owns the other capability (portal
   referrals) and the Integration tab owns that one, which is also where
   the keys it would break are listed.

   COMMISSION IS NOT HERE EITHER, and has not been since 2026-09-30: it
   is the Commission tab's, under a model two boxes cannot express.
   ===================================================================== */
import { useEffect, useState } from 'react';
import {
  getPartner, updatePartnerSettings, REFERENCING_MODES,
  getPartnerAudit, getReferrerLeaderboardMode, setReferrerLeaderboardMode,
  type PartnerAuditEntry, type PartnerSettingsInput, type PartnerStatus,
  type ReferencingMode, type LeaderboardMode,
} from '@/data';
import { Link } from 'react-router-dom';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { changeSentence, isNoOpChange } from '@/data/changeSentence';
import { useToast } from '@/components/ui/Toast';
import { formatDate } from '@/lib/format';

/* MOVED HERE WITH THE REST OF THE SETTINGS. These two lived only inside
   the Manage modal, which no longer exists: deleting the modal without
   them would have quietly deleted a per-supplier policy and the only
   record of who changed what. Matt's instruction moves "name, live from,
   status, referencing mode, capabilities"; these came with them because
   there was nowhere else for them to be. */
const LB_LABEL: Record<LeaderboardMode, string> = {
  full: 'Full (rankings and fees)',
  rankings: 'Rankings only (no fees)',
  private: 'Private (own performance only)',
};
/* `auditField` and `auditValue` are gone with the row that used them: the
   field label and the value wording both live in `changeSentence` now, which
   is what "same for agencies and anywhere else changes are listed" asks for.
   LB_SHORT went with them -- it was a second, shorter set of words for the
   leaderboard modes, and a change list that words a value differently from
   the control that sets it is how two screens come to disagree. */
/* ONE FORMAT, SHARED. See lib/format: dd/mm/yyyy is ambiguous and this
   product has an API with American integrators. */
const dmy = formatDate;

export interface SupplierDraft {
  name: string;
  since: string;
  status: PartnerStatus;
  refMode: ReferencingMode;
  portalOn: boolean;
}

export const EMPTY_DRAFT: SupplierDraft = {
  name: '',
  since: '',
  status: 'onboarding',
  /* NOT 'open'. Open means no criteria at all and is a commercial
     decision, not a default. The Add form started here and so does this. */
  refMode: 'pre_referenced_screened',
  portalOn: true,
};

/**
 * The fields themselves, controlled by whoever renders them.
 *
 * SHARED BY THE SETTINGS TAB AND THE ADD FORM, which is the whole point:
 * "the same fields as Manage" has to be true by construction rather than
 * by somebody remembering to change two files.
 */
export function SupplierFields({
  draft, onChange, disabled, idPrefix = 'ss',
}: {
  draft: SupplierDraft;
  onChange: (next: SupplierDraft) => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const set = <K extends keyof SupplierDraft>(k: K, v: SupplierDraft[K]) =>
    onChange({ ...draft, [k]: v });
  const id = (s: string) => `${idPrefix}-${s}`;

  return (
    <>
      <Field label="Supplier company name" htmlFor={id('name')}>
        <input
          id={id('name')} type="text" placeholder="e.g. Acme Property Group"
          autoComplete="off" disabled={disabled}
          value={draft.name} onChange={(e) => set('name', e.target.value)}
        />
      </Field>
      <Field label="Live from" htmlFor={id('since')} hint="Optional">
        <input
          id={id('since')} type="month" disabled={disabled}
          value={draft.since} onChange={(e) => set('since', e.target.value)}
        />
      </Field>
      <Field label="Status" htmlFor={id('status')}>
        <select
          id={id('status')} disabled={disabled}
          value={draft.status} onChange={(e) => set('status', e.target.value as PartnerStatus)}
        >
          <option value="active">Active</option>
          <option value="onboarding">Onboarding</option>
          <option value="paused">Paused</option>
        </select>
      </Field>

      <div className="ss-sect">
        <div className="ss-sect__head">Referencing</div>
        <p className="ss-sect__note">
          What happens to an application after it arrives. Each application records the mode in
          force when it was created, so changing this never rewrites the basis of applications
          already in flight.
        </p>
        <Field label="Referencing mode" htmlFor={id('refmode')}>
          <select
            id={id('refmode')} disabled={disabled}
            value={draft.refMode} onChange={(e) => set('refMode', e.target.value as ReferencingMode)}
          >
            {REFERENCING_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </Field>
        <p className="ss-sect__note ss-sect__note--tight">
          {REFERENCING_MODES.find((m) => m.id === draft.refMode)?.desc}
        </p>
      </div>

      <div className="ss-sect">
        <div className="ss-sect__head">Capabilities</div>
        {/* MATT'S OWN SENTENCE, 2026-10-02. The old one explained the
            DESIGN -- why these are two independent settings rather than
            one supplier type -- which is a note to whoever built the
            form, not to whoever is filling it in. It also used "an
            agency" to mean a kind of supplier, two days after the word
            was pinned to something else entirely. */}
        <p className="ss-sect__note">
          Some suppliers refer through the portal, some through the API, and some use both.
        </p>
        <label className="pmcap">
          <input
            type="checkbox" disabled={disabled}
            checked={draft.portalOn} onChange={(e) => set('portalOn', e.target.checked)}
          />
          <div>
            <div className="pmcap__name">Portal referrals</div>
            <div className="pmcap__desc">
              Their staff can create referrals in the portal. Turning this off refuses new referrals
              for this supplier, including ones an opndoor admin makes on their behalf. Existing
              applications are untouched.
            </div>
          </div>
        </label>
        {/* API ACCESS IS ON THE INTEGRATION TAB. Said here rather than
            left as an absence, because somebody who used to set it on
            Manage will come looking for it. */}
        <p className="ss-sect__note ss-sect__note--tight">
          API access is on the <b>Integration</b> tab, with the keys it would stop working.
        </p>
      </div>
    </>
  );
}

/** The Settings tab: the same fields, against a supplier that exists. */
export function SupplierSettings({ slug, canEdit, onSaved }: {
  slug: string;
  canEdit: boolean;
  onSaved?: () => void;
}) {
  const toast = useToast();
  const { ask, confirmEl } = useConfirm();
  const [draft, setDraft] = useState<SupplierDraft | null>(null);
  const [saved, setSaved] = useState<SupplierDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [lbMode, setLbMode] = useState<LeaderboardMode>('full');
  const [audit, setAudit] = useState<PartnerAuditEntry[]>([]);
  const [showAllAudit, setShowAllAudit] = useState(false);

  useEffect(() => {
    const p = getPartner(slug);
    if (!p) { setDraft(null); return; }
    const d: SupplierDraft = {
      name: p.name,
      since: p.since || '',
      status: (p.status as PartnerStatus) || 'active',
      refMode: p.referencingMode ?? 'pre_referenced_screened',
      portalOn: p.portalReferralsEnabled !== false,
    };
    setDraft(d);
    setSaved(d);
    setLbMode(getReferrerLeaderboardMode(slug));
    setShowAllAudit(false);
    /* HIDING THE ROWS THAT SAY NOTHING. Matt, 2026-10-02: "hide old
       entries where nothing actually changed (e.g. 'Live from changed
       from August to August 2026')." Filtered on arrival rather than at
       render, so the "View all changes (N)" count is the number of rows
       there are to read. */
    getPartnerAudit(slug)
      .then((rows) => setAudit(rows.filter((e) => !isNoOpChange(e))))
      .catch(() => setAudit([]));
  }, [slug]);

  if (!draft || !saved) {
    return (
      <Card>
        <CardBody><p className="ph-note muted">No such supplier.</p></CardBody>
      </Card>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const save = async () => {
    const p = getPartner(slug);
    if (!p || !draft.name.trim()) return;
    setBusy(true);
    try {
      /* THE STORED RATES AND THE API FLAG, PASSED BACK UNCHANGED.
         update_partner_settings still takes all of them -- narrowing a
         nine-argument RPC is a migration of its own -- so this screen
         sends exactly what is there for the things it does not own.
         Without it, saving a name here would write whatever this
         component happens to hold for commission and silently undo the
         Commission tab, which is the fault Manage already had to fix. */
      const input: PartnerSettingsInput = {
        name: draft.name.trim(),
        status: draft.status,
        since: draft.since,
        partnerRate: p.partnerRate ?? 0.25,
        agentRate: p.agentRate ?? 0.1,
        referencingMode: draft.refMode,
        portalReferralsEnabled: draft.portalOn,
        apiAccessEnabled: p.apiAccessEnabled === true,
      };
      await updatePartnerSettings(slug, input);
      setSaved(draft);
      toast(`Updated ${input.name}.`);
      onSaved?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the supplier.', 'error');
    } finally {
      setBusy(false);
    }
  };

  /* SAVES IMMEDIATELY, as it did on Manage: it is a policy rather than a
     field, it goes through its own governed RPC, and it is audited. A
     confirmation because it changes what every referrer at this supplier
     can see about their colleagues. */
  const changeLb = (next: LeaderboardMode) => {
    if (next === lbMode) return;
    ask({
      title: 'Change what referrers can see',
      body: (
        <>
          Referrers at <b>{draft.name}</b> will see <b>{LB_LABEL[next].toLowerCase()}</b> on the
          League Referrers tab. Commission is never shown to referrers either way.
        </>
      ),
      confirmLabel: 'Change visibility',
      run: async () => {
        const prev = lbMode;
        setLbMode(next);
        try {
          await setReferrerLeaderboardMode(slug, next);
          getPartnerAudit(slug).then(setAudit).catch(() => { /* keep prior */ });
          toast('Referrer leaderboard visibility updated.');
          onSaved?.();
        } catch (e) {
          setLbMode(prev);
          toast(e instanceof Error ? e.message : 'Could not update the setting.', 'error');
        }
      },
    });
  };

  return (
    <Card>
      <CardHead
        title="Settings"
        sub="This supplier's details and what it can do. Commission is on the Commission tab; API access is on Integration."
      />
      <CardBody>
        <div className="ss-form">
          <SupplierFields draft={draft} onChange={setDraft} disabled={!canEdit || busy} />
        </div>
        {canEdit && (
          <div className="ss-actions">
            <Button variant="dark" size="sm" disabled={busy || !dirty || !draft.name.trim()} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
            {dirty && (
              <Button variant="quiet" size="sm" disabled={busy} onClick={() => setDraft(saved)}>Cancel</Button>
            )}
          </div>
        )}
        {!canEdit && (
          <p className="ph-note muted">Only an opndoor admin can change these.</p>
        )}

        <div className="ss-sect">
          <div className="ss-sect__head">Commission</div>
          {/* "Set on the Commission tab." and a link, which is Matt's
              whole instruction. The three things it used to list are the
              Commission tab's own headings, so this said them twice and
              could fall behind -- it already named "the total rate and
              the agents' share within it", which is one of the two deal
              shapes rather than the model. */}
          <p className="ss-sect__note ss-sect__note--tight">
            Set on the <Link to={`/partners/${encodeURIComponent(slug)}`}>Commission tab</Link>.
          </p>
        </div>

        {/* #88 Referrer leaderboard visibility, a per-supplier policy. */}
        <div className="ss-sect">
          <div className="ss-sect__head">Referrer leaderboard</div>
          <p className="ss-sect__note">
            What referrers at this supplier see on the League Referrers tab. Commission is never
            shown to referrers.
          </p>
          <Field label="Visibility" htmlFor="ss-lb-mode">
            <select
              id="ss-lb-mode" value={lbMode} disabled={!canEdit}
              onChange={(e) => changeLb(e.target.value as LeaderboardMode)}
            >
              {(Object.keys(LB_LABEL) as LeaderboardMode[]).map((m) => (
                <option key={m} value={m}>{LB_LABEL[m]}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="ss-sect">
          <div className="ss-sect__head">Recent changes</div>
          {audit.length > 0 ? (
            <>
              <ul className="pm-audit">
                {(showAllAudit ? audit : audit.slice(0, 5)).map((e, i) => (
                  /* ONE SENTENCE, NOT A FIELD NAME AND AN ARROW. Matt,
                     2026-10-01: "show every change in plain English (e.g.
                     'API access turned on', 'Live from changed from August
                     to September 2026'), never raw field names." The row
                     used to print the column name, then the stored value,
                     then an arrow, then the stored value -- so it read
                     "api_access_enabled  off → on (existing keys work
                     again)" to somebody asking what an admin had done. */
                  <li key={i} className="pm-audit__row">
                    <span className="pm-audit__said">{changeSentence(e)}</span>
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
            <p className="ss-sect__note ss-sect__note--tight">
              No changes recorded yet. Edits to this supplier&rsquo;s name, status, go-live date or
              commission rates appear here.
            </p>
          )}
        </div>
      </CardBody>
      {confirmEl}
    </Card>
  );
}
