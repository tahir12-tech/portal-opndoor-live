/* =====================================================================
   WHAT THE AGENCIES GET, AS A PERCENTAGE AND NOTHING ELSE.

   Matt, 2026-10-01: "Its editor sets only the agency's %, no fee
   options: 'Same % on every referral', '% depends on number of tenants'
   (e.g. 1 tenant 10%, 2 or more 15%), or '% grows with referrals sent'
   (e.g. first 5 a month 10%, then 15%), with the count period and whose
   referrals count shown only for that last one. Volume steps start at
   referral 1, not 0."

   WHY NOT THE AGENCY EDITOR. `AgreementEditor` asks what the TENANT
   pays as well as what the party earns, and for the agencies' share
   that second question has no answer: the tenant's fee is set once, by
   the supplier's own deal, and a share band naming another one would be
   two deals disagreeing about the same referral. The shared editor hid
   the fee column for `kind='agent_share'`, which left a form built
   around a question it was not asking.

   =====================================================================
   THE FORM IS EXPORTED, NOT JUST THE DIALOG
   =====================================================================

   Matt's part 4 is "one dialog that asks which agencies first ... then
   the agencies' % editor below, one Save". So the same fields appear in
   two places: this dialog, for the default deal, and `ShareDealDialog`
   under its list of agencies. They are one component and one validator
   (`usePercentDraft`, `PercentFields`, `percentShape`) so the two cannot
   drift into asking the same question differently.

   =====================================================================
   VOLUME STEPS SHOW 1 AND STORE 0, WHICH IS THE ONE REAL TRAP IN HERE
   =====================================================================

   `resolve_pricing_agreement` matches a tier with `volume >=
   from_count`, where volume is how many referrals have been counted
   SO FAR in the period -- nought when the first one arrives. So the
   lowest tier must store 0 or the first referral of every period has
   no rate at all, and the door refuses an agreement whose lowest tier
   starts higher.

   Nobody writing a deal thinks that way. "The first five referrals a
   month" starts at referral ONE. So the editor shows 1 and stores 0,
   and every row after it shows `from + 1`. The translation is in
   `toStored`/`toShown` below and nowhere else.
   ===================================================================== */
import { useMemo, useState } from 'react';
import {
  saveShareDeal,
  type AgreementBandInput, type AgreementTierInput, type AgreementView,
} from '@/data/orgService';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { countOf } from '@/lib/plural';
import { suspectTenantCounts, TENANT_BAND_WARN_ABOVE } from '@/pages/Agencies/AgreementEditor';

export type PercentModel = 'flat' | 'tenants' | 'volume';

/** A tier as the EDITOR holds it: `from` is the referral number a person
    would say out loud, so the first row reads 1. */
interface ShownTier { from: string; to: string; rate: string }
interface ShownBand { min: string; max: string; rate: string }

/** Stored 0 is shown as 1, and so on up. */
const toShown = (stored: number): number => stored + 1;
/** And back, which is the only place the product's 0 is written. */
const toStored = (shown: number): number => Math.max(0, shown - 1);

const pct = (rate: number | null | undefined): string =>
  (rate == null ? '' : String(Number((rate * 100).toFixed(2))));

function modelOf(deal: AgreementView | null): PercentModel {
  if (!deal) return 'flat';
  if (deal.tiers.length) return 'volume';
  if (deal.bands.length > 1) return 'tenants';
  return 'flat';
}

/* ---------------------------------------------------------------------
   THE DRAFT: every answer the form holds, and nothing about where it is
   shown. Opened filled in from `current`, which is the instruction:
   "Every editor opens filled in with the current deal."
   --------------------------------------------------------------------- */
export interface PercentDraft {
  model: PercentModel;
  setModel: (m: PercentModel) => void;
  flatRate: string;
  setFlatRate: (v: string) => void;
  bands: ShownBand[];
  setBands: (f: (xs: ShownBand[]) => ShownBand[]) => void;
  tiers: ShownTier[];
  setTiers: (f: (xs: ShownTier[]) => ShownTier[]) => void;
  note: string;
  setNote: (v: string) => void;
  period: string;
  setPeriod: (v: string) => void;
  countingScope: string;
  setCountingScope: (v: string) => void;
  /** The sentence their own deal comes to, recomputed as they type. */
  preview: string;
}

export function usePercentDraft(current: AgreementView | null): PercentDraft {
  const [model, setModel] = useState<PercentModel>(() => modelOf(current));
  const [note, setNote] = useState(current?.note ?? '');
  const [period, setPeriod] = useState<string>(current?.period ?? 'month');
  const [countingScope, setCountingScope] = useState<string>(current?.countingScope ?? 'agency');

  /* A deal that is flat today and is being made tiered keeps its rate as
     the first step's, rather than opening on an empty table. */
  const [flatRate, setFlatRate] = useState(() => pct(current?.bands[0]?.rate) || '10');
  const [bands, setBands] = useState<ShownBand[]>(() => {
    const b = (current?.bands ?? []).filter((x) => x.rate != null);
    return b.length > 1
      ? b.map((x) => ({ min: String(x.min), max: x.max == null ? '' : String(x.max), rate: pct(x.rate) }))
      : [{ min: '1', max: '1', rate: pct(current?.bands[0]?.rate) || '10' },
         { min: '2', max: '', rate: pct(current?.bands[0]?.rate) || '15' }];
  });
  const [tiers, setTiers] = useState<ShownTier[]>(() => {
    const t = current?.tiers ?? [];
    return t.length
      ? t.map((x) => ({ from: String(toShown(x.from)), to: x.to == null ? '' : String(x.to), rate: pct(x.rate) }))
      : [{ from: '1', to: '5', rate: '10' }, { from: '6', to: '', rate: '15' }];
  });

  const preview = useMemo(() => {
    if (model === 'flat') return `${flatRate || '0'}% of the fee on every referral.`;
    if (model === 'tenants') {
      return bands
        .map((b) => {
          const who = b.max === '' ? `${b.min || '1'} or more`
            : b.min === b.max ? countOf(Number(b.min) || 1, 'tenant')
            : `${b.min} to ${b.max} tenants`;
          return `${who}: ${b.rate || '0'}%`;
        })
        .join(', ') + '.';
    }
    return tiers
      .map((t) => {
        const span = t.to === '' ? `from referral ${t.from || '1'}`
          : `referrals ${t.from || '1'} to ${t.to}`;
        return `${span}: ${t.rate || '0'}%`;
      })
      .join(', ') + '.';
  }, [model, flatRate, bands, tiers]);

  return {
    model, setModel, flatRate, setFlatRate, bands, setBands, tiers, setTiers,
    note, setNote, period, setPeriod, countingScope, setCountingScope, preview,
  };
}

/** What the draft comes to in the shape the door takes, or why it cannot. */
export function percentShape(d: PercentDraft):
  | { ok: true; bands: AgreementBandInput[]; tiers: AgreementTierInput[] }
  | { ok: false; why: string } {
  if (d.model === 'volume') {
    const lowest = Math.min(...d.tiers.map((t) => Number(t.from) || 1));
    if (lowest !== 1) {
      return { ok: false, why: 'The first step has to start at referral 1, or the first referral of each period has no percentage.' };
    }
  }

  /* ONE BAND, NO FEE, ON EVERY MODEL BUT "by tenants". The fee is the
     supplier's deal's business; these bands exist only to carry a rate,
     and the door stores no fee on a share band. */
  const bands: AgreementBandInput[] = d.model === 'tenants'
    ? d.bands.map((b) => ({
        min: Number(b.min) || 1,
        max: b.max.trim() === '' ? null : Number(b.max),
        weeks: 0,
        unit: 'weeks' as const,
        rate: Number(b.rate) / 100,
      }))
    : [{ min: 1, max: null, weeks: 0, unit: 'weeks' as const,
         /* NULL ON A VOLUME DEAL, so the band states no rate the steps
            would then override. A stored-but-ignored rate is what makes a
            deal unreadable a year later. */
         rate: d.model === 'volume' ? null : Number(d.flatRate) / 100 }];

  const tiers: AgreementTierInput[] = d.model === 'volume'
    ? d.tiers.map((t) => ({
        from: toStored(Number(t.from) || 1),
        to: t.to.trim() === '' ? null : Number(t.to),
        rate: Number(t.rate) / 100,
      }))
    : [];

  return { ok: true, bands, tiers };
}

const MODELS: { id: PercentModel; name: string; eg: string }[] = [
  { id: 'flat', name: 'Same % on every referral', eg: 'e.g. 10% of the fee, whoever the tenants are and however many they send' },
  { id: 'tenants', name: '% depends on number of tenants', eg: 'e.g. 1 tenant 10%, 2 or more 15%' },
  { id: 'volume', name: '% grows with referrals sent', eg: 'e.g. first 5 a month 10%, then 15%' },
];

/** The fields themselves, which both dialogs show. */
export function PercentFields({ d }: { d: PercentDraft }) {
  const setBand = (i: number, patch: Partial<ShownBand>) =>
    d.setBands((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const setTier = (i: number, patch: Partial<ShownTier>) =>
    d.setTiers((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <>
      <Field label="How the percentage works">
        <div className="roleopts">
          {MODELS.map((m) => (
            <label
              key={m.id}
              className={`roleopt${d.model === m.id ? ' is-sel' : ''}`}
              onClick={() => d.setModel(m.id)}
            >
              <span className="roleopt__radio" />
              <div>
                <div className="roleopt__name">{m.name}</div>
                <div className="roleopt__eg">{m.eg}</div>
              </div>
            </label>
          ))}
        </div>
      </Field>

      {d.model === 'flat' && (
        <Field label="The agencies get" hint="Of the fee the tenant pays.">
          <div className="agr-pctrow">
            <input
              className="inp" inputMode="decimal" value={d.flatRate} aria-label="Percentage"
              onChange={(e) => d.setFlatRate(e.target.value)}
            />
            <span>% of the fee</span>
          </div>
        </Field>
      )}

      {d.model === 'tenants' && (
        <Field label="By number of tenants on the tenancy">
          <table className="dt agr-table">
            <thead><tr><th>From</th><th>To</th><th>They get</th><th /></tr></thead>
            <tbody>
              {d.bands.map((b, i) => (
                <tr key={i}>
                  <td><input className="inp" inputMode="numeric" value={b.min} aria-label={`Step ${i + 1} from tenants`} onChange={(e) => setBand(i, { min: e.target.value })} /></td>
                  <td><input className="inp" inputMode="numeric" value={b.max} placeholder="and above" aria-label={`Step ${i + 1} to tenants`} onChange={(e) => setBand(i, { max: e.target.value })} /></td>
                  <td><input className="inp" inputMode="decimal" value={b.rate} aria-label={`Step ${i + 1} percentage`} onChange={(e) => setBand(i, { rate: e.target.value })} /></td>
                  <td>{d.bands.length > 1 && (
                    <button type="button" className="ah-linkbtn ah-linkbtn--quiet" onClick={() => d.setBands((xs) => xs.filter((_, j) => j !== i))}>Remove</button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button variant="quiet" size="sm" onClick={() => d.setBands((xs) => [...xs, { min: '', max: '', rate: '' }])}>Add a step</Button>
          <p className="ph-note muted">Leave <b>&lsquo;to&rsquo;</b> empty on the last row to mean &ldquo;and above&rdquo;.</p>
        </Field>
      )}

      {d.model === 'volume' && (
        <>
          <Field label="By referrals sent">
            <table className="dt agr-table">
              <thead><tr><th>From referral</th><th>To</th><th>They get</th><th /></tr></thead>
              <tbody>
                {d.tiers.map((t, i) => (
                  <tr key={i}>
                    <td><input className="inp" inputMode="numeric" value={t.from} aria-label={`Step ${i + 1} from referral`} onChange={(e) => setTier(i, { from: e.target.value })} /></td>
                    <td><input className="inp" inputMode="numeric" value={t.to} placeholder="and above" aria-label={`Step ${i + 1} to referral`} onChange={(e) => setTier(i, { to: e.target.value })} /></td>
                    <td><input className="inp" inputMode="decimal" value={t.rate} aria-label={`Step ${i + 1} percentage`} onChange={(e) => setTier(i, { rate: e.target.value })} /></td>
                    <td>{d.tiers.length > 1 && (
                      <button type="button" className="ah-linkbtn ah-linkbtn--quiet" onClick={() => d.setTiers((xs) => xs.filter((_, j) => j !== i))}>Remove</button>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Button variant="quiet" size="sm" onClick={() => d.setTiers((xs) => [...xs, { from: '', to: '', rate: '' }])}>Add a step</Button>
            <p className="ph-note muted">
              Counting starts at referral <b>1</b>. Leave <b>&lsquo;to&rsquo;</b> empty on the last row to
              mean &ldquo;and above&rdquo;.
            </p>
          </Field>

          {/* ONLY FOR THIS MODEL, which is the instruction: the period and
              whose referrals count mean nothing to a flat or per-tenant
              deal, and a form that shows them anyway invites somebody to
              set them and wonder why nothing changed. */}
          <div className="form-grid">
            <Field label="Counted over" hint="The steps reset at the start of each one.">
              <select value={d.period} aria-label="Counting period" onChange={(e) => d.setPeriod(e.target.value)}>
                <option value="week">Each week</option>
                <option value="month">Each month</option>
                <option value="year">Each year</option>
                <option value="lifetime">Since the deal started</option>
              </select>
            </Field>
            <Field label="Whose referrals count" hint="Which referrals add up towards the next step.">
              <select value={d.countingScope} aria-label="Whose referrals count" onChange={(e) => d.setCountingScope(e.target.value)}>
                <option value="agency">The agency&rsquo;s own</option>
                <option value="group">Everyone in their group</option>
                <option value="branch">That branch only</option>
              </select>
            </Field>
          </div>
        </>
      )}

      <p className="sd-summary">{d.preview}</p>

      <Field label="What was agreed, and with whom" span2 hint="Shown on the Commission tab and kept with the record of changes.">
        <input className="inp" type="text" value={d.note} placeholder="Agreed with …, signed …" onChange={(e) => d.setNote(e.target.value)} />
      </Field>
    </>
  );
}

/** The default deal's editor: what every agency not named on another gets. */
export function AgencyPercentEditor({
  partnerId, current, title, sub, onClose, onSaved,
}: {
  /** The uuid: a partner-scope agreement is keyed on partners.id. */
  partnerId: string;
  current: AgreementView | null;
  title: string;
  sub?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const d = usePercentDraft(current);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  /** Tenant steps that look like a referral volume. Null is the usual answer. */
  const [tenantWarn, setTenantWarn] = useState<number[] | null>(null);

  async function save(confirmTenants = false) {
    if (busy) return;
    const shape = percentShape(d);
    if (!shape.ok) { setRefusal(shape.why); return; }

    /* A TENANT STEP THIS HIGH IS ALMOST CERTAINLY A VOLUME, and this
       editor did not ask. Matt, 2026-10-02: "The agencies' % editor
       (supplier Commission tab, default and bespoke deals) saved a
       tenant step of '1 to 10 tenants' with no warning. Add the same
       warning the main deal editor has."

       THE SAME WARNING MEANS THE SAME PREDICATE, not a second copy of
       the rule. `suspectTenantCounts` and `TENANT_BAND_WARN_ABOVE` are
       the agreement editor's, imported rather than re-derived: two
       editors disagreeing about what counts as suspicious is how one of
       them ends up silent, which is exactly what happened here.

       WHY IT WAS MISSED. The two editors look alike and are not the
       same component -- the agreement editor prices a FEE in weeks of
       rent and this one prices a PERCENTAGE -- so the control was
       rebuilt and the guard beside it was not.

       A WARNING, NOT A REFUSAL, as there: a five-tenant HMO is real,
       just rare, and the one thing this must not do is make a true deal
       impossible to enter. */
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
        /* NOBODY NAMED, which is what makes this the default deal: the
           terms for every agency not named on one of the others. */
        agencies: [],
        agreementId: current?.agreementId ?? null,
      });
      toast('Saved. It applies to new referrals.');
      onSaved();
    } catch (e) {
      /* SQL'S OWN WORDS. It knows what it is about to replace and who
         agreed what; the screen knows neither. */
      setRefusal(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      width={620}
      title={title}
      sub={sub}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} arrow disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      )}
    >
      <PercentFields d={d} />
      {refusal && <p className="auth__error" role="alert">{refusal}</p>}
      <p className="ph-note muted">Changes apply to new referrals only.</p>

      {/* MATT'S OWN QUESTION AND HIS TWO OPTIONS. "Did you mean
          referrals sent? A tenancy rarely has more than 4 tenants."
          with options to switch to "% grows with referrals sent" or
          save anyway.

          THE FIRST OPTION DOES THE SWITCH rather than telling them
          where to find it. The agreement editor says "go back and
          choose ..." because its two models are radio buttons on the
          screen behind; here the fix is one state change and offering
          it is cheaper for the reader than describing it. */}
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
