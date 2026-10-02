/* =====================================================================
   ONE DIALOG: WHICH AGENCIES, THEN WHAT THEY GET, ONE SAVE.

   Matt, 2026-10-01, verbatim: "'Add' opens one dialog that asks which
   agencies first (searchable list of this supplier's agencies, pick one
   or several), titled with them, e.g. 'Deal for Frost Partnership and 2
   others', then the agencies' % editor below, one Save."

   =====================================================================
   WHY THE AGENCIES COME FIRST, AND WHY THEY ARE IN THE TITLE
   =====================================================================

   It was two steps before: write a deal, then find it in the list and
   add agencies to it. That leaves a real intermediate state -- a deal
   that prices nothing, which the server treats as a second default --
   and it asks the question in the wrong order. Nobody agrees a
   percentage and then decides who it is for.

   The title is how the dialog stays honest once it is scrolled: by the
   time somebody is typing percentages, the list of agencies is above
   the fold and the title is the only thing still saying who this deal
   is for.

   ONE SAVE IS NOT COSMETIC. `save_share_deal` takes the terms and the
   agencies together, because the difference between "the default deal"
   and "a deal for named agencies" is exactly which agencies are named,
   and that decides which other deals it may end. Two calls could leave a
   deal written with nobody on it if the second failed.
   ===================================================================== */
import { useMemo, useState } from 'react';
import { saveShareDeal, type ShareDealView } from '@/data/orgService';
import { AgencyPercentEditorTitles } from './dealTitles';
import { PercentFields, percentShape, usePercentDraft } from './AgencyPercentEditor';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { TypeAhead, highlightMatch, type TypeAheadOption } from '@/components/ui/TypeAhead';
import { useToast } from '@/components/ui/Toast';
import { plural } from '@/lib/plural';
import { suspectTenantCounts, TENANT_BAND_WARN_ABOVE } from '@/pages/Agencies/AgreementEditor';

export interface DialogAgency { id: string; name: string }

export function ShareDealDialog({
  partnerId, agencies, current, whereNow, onClose, onSaved,
}: {
  /** The supplier's uuid: a partner-scope agreement is keyed on partners.id. */
  partnerId: string;
  /** This supplier's agencies, which is what the search looks through. */
  agencies: DialogAgency[];
  /** The deal being changed, or null to agree a new one. */
  current: ShareDealView | null;
  /** The name of the deal an agency is on now, for the line under its row. */
  whereNow: (agencyId: string) => string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const d = usePercentDraft(current);
  const [picked, setPicked] = useState<DialogAgency[]>(
    () => (current?.members ?? []).map((m) => ({ id: m.agencyId, name: m.name })),
  );
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const pickedIds = useMemo(() => new Set(picked.map((a) => a.id)), [picked]);

  /* THE SEARCH SHOWS AGENCIES ALREADY ON ANOTHER DEAL, and says so on the
     row. Hiding them would make a move a three-step: find out where it is,
     open that deal, take it off, come back. */
  const rows: TypeAheadOption[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    return agencies
      .filter((a) => !pickedIds.has(a.id))
      .filter((a) => !q || a.name.toLowerCase().includes(q))
      .slice(0, 40)
      .map((a) => {
        const on = whereNow(a.id);
        return {
          id: a.id,
          icon: <Icon name="org" size={14} />,
          main: highlightMatch(a.name, query),
          sub: on ? `on ${on}, so this moves it` : 'on the default deal',
          onSelect: () => { setPicked((xs) => [...xs, a]); setQuery(''); },
        };
      });
  }, [agencies, pickedIds, query, whereNow]);

  const title = AgencyPercentEditorTitles.dealFor(picked.map((a) => a.name));

  /** Tenant steps that look like a referral volume. Null is the usual answer. */
  const [tenantWarn, setTenantWarn] = useState<number[] | null>(null);

  async function save(confirmTenants = false) {
    if (busy) return;
    if (picked.length === 0) {
      setRefusal('Pick at least one agency. A deal with nobody on it would price nothing.');
      return;
    }
    const shape = percentShape(d);
    if (!shape.ok) { setRefusal(shape.why); return; }

    /* THE SAME WARNING AS THE DEFAULT DEAL'S EDITOR. Matt, 2026-10-02,
       named both: "the agencies' % editor (supplier Commission tab,
       DEFAULT AND BESPOKE DEALS)". The two share `PercentFields` and
       `percentShape` and not their save, which is why one guard would
       have covered one of them -- the same way the editor and the
       agreement editor came apart in the first place. */
    if (!confirmTenants && d.model === 'tenants') {
      const odd = suspectTenantCounts(d.bands);
      if (odd.length) { setTenantWarn(odd); return; }
    }

    setBusy(true);
    setRefusal(null);
    try {
      await saveShareDeal({
        partnerId,
        bands: shape.bands,
        tiers: shape.tiers,
        note: d.note.trim() || null,
        period: d.period as 'week' | 'month' | 'year' | 'lifetime',
        countingScope: d.countingScope as 'agency' | 'group' | 'branch',
        agencies: picked.map((a) => a.id),
        agreementId: current?.agreementId ?? null,
      });
      toast(current ? 'Saved. It applies to new referrals.' : 'Deal agreed. It applies to new referrals.');
      onSaved();
    } catch (e) {
      setRefusal(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      width={660}
      title={title}
      sub="These agencies are paid on these terms. Every other agency keeps the percentage above."
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} arrow disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      )}
    >
      <Field label="Which agencies is this deal for?" hint="Pick one or several.">
        {picked.length > 0 && (
          <ul className="sd-chips">
            {picked.map((a) => (
              <li key={a.id} className="sd-chip">
                <span>{a.name}</span>
                <button
                  type="button" className="sd-chip__x" aria-label={`Remove ${a.name}`}
                  title={`Take ${a.name} off this deal`}
                  onClick={() => setPicked((xs) => xs.filter((x) => x.id !== a.id))}
                >
                  <Icon name="x" size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <TypeAhead
          value={query}
          onChange={setQuery}
          options={rows}
          ariaLabel="Find an agency"
          placeholder="Type to find one of this supplier’s agencies"
          emptyText="No agency of that name under this supplier"
        />
        <p className="ph-note muted">
          {picked.length === 0
            ? 'Nobody picked yet.'
            : `${picked.length} ${plural(picked.length, 'agency')} on this deal.`}
        </p>
      </Field>

      <PercentFields d={d} />

      {refusal && <p className="auth__error" role="alert">{refusal}</p>}
      <p className="ph-note muted">Changes apply to new referrals only.</p>
      {tenantWarn && (
        <Modal
          open
          onClose={() => setTenantWarn(null)}
          width={560}
          title="Did you mean referrals sent?"
          footer={<>
            <Button variant="ghost" disabled={busy}
              onClick={() => { setTenantWarn(null); d.setModel('volume'); }}>
              Switch to % grows with referrals sent
            </Button>
            <Button variant="dark" disabled={busy}
              onClick={() => { setTenantWarn(null); void save(true); }}>
              Save anyway
            </Button>
          </>}
        >
          <p className="agr-confirm">
            A tenancy rarely has more than {TENANT_BAND_WARN_ABOVE} tenants, and you have entered{' '}
            <b>{tenantWarn.join(', ')}</b>.
          </p>
          <p className="agr-hint">
            This deal steps by the number of TENANTS on one tenancy. If you meant the number of
            REFERRALS they send, switch below; if you really do mean a tenancy that size, save it.
          </p>
        </Modal>
      )}
    </Modal>
  );
}
