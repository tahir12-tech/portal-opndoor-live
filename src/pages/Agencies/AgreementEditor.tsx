/* =====================================================================
   SETTING A PARTY'S COMMISSION, FROM THE SCREEN.

   Agreements were SQL-only. The reasoning was that a negotiated deal is signed
   on paper and typed in once, so a screen for it would be used twice a year.
   What actually happened is that a rate the commercial team had agreed sat
   un-entered until somebody with a psql prompt was free, and the Commission tab
   displayed a deal it could not change — the most confusing state a settings
   page can be in. This reverses that.

   FOUR PRICING MODELS, which are not four features: they are the four shapes a
   real deal takes, and each one is the same agreement with more of it filled in.

     Standard        no agreement at all. One month's rent, the Opndoor rate.
     Flat            one band: every referral, this fee basis, this rate.
     By tenant count bands. Regent's deal: 1 tenant 3 weeks at 20%, 2+ 5 weeks
                     at 25%. The band decides BOTH the fee and the rate.
     Volume tiered   bands for the fee, plus tiers that move the RATE as the
                     party's volume grows through the period.

   THE SCREEN OWNS NO RULES. The 50% cap, one-rate-per-party, the all-in guards
   in both directions and the audit all live in create_agreement, and every
   refusal it raises is shown here word for word. Two of those refusals have an
   answer — "this would replace N arrangements" and the all-in breach — so they
   are re-offered as a confirmation carrying the administrator's decision back to
   SQL, which audits it. Every other refusal is final and is simply stated.
   ===================================================================== */
import { useMemo, useState } from 'react';
import {
  agreementConfirmKind, createAgreement, endAgreement,
  type AgreementBandInput, type AgreementTierInput, type AgreementView,
} from '@/data/orgService';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { PeriodSelect } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import './AgreementEditor.css';

export type PricingModel = 'standard' | 'flat' | 'bands' | 'tiered';

const MODELS: { id: PricingModel; name: string; desc: string }[] = [
  { id: 'standard', name: 'Standard terms', desc: "One month's rent, at the Opndoor standard rate. No agreement: the party is priced by the partner's own terms." },
  { id: 'flat', name: 'Flat', desc: 'One fee basis and one rate for every referral, however many tenants and however many they send.' },
  { id: 'bands', name: 'By tenant count', desc: 'The fee and the rate both move with the number of tenants on the tenancy. A joint tenancy is priced once, at the band its tenant count falls in.' },
  { id: 'tiered', name: 'Volume tiered', desc: 'Priced by tenant count as above, with the rate stepping up as the party’s volume grows through the period.' },
];

/** A week is rent x 12 / 52; one month is therefore 52/12 weeks. */
const MONTH_WEEKS = Number((52 / 12).toFixed(4));

const pctOf = (r: number | null) => (r == null ? '' : String(Number((r * 100).toFixed(2))));
const toRate = (s: string) => (s.trim() === '' ? null : Number(s) / 100);

interface BandRow { min: string; max: string; weeks: string; rate: string }
interface TierRow { from: string; to: string; rate: string }

/** What model is this existing agreement? Read off its own shape rather than
    stored, because the shape IS the model and a stored label could disagree. */
function modelOf(a: AgreementView | null): PricingModel {
  if (!a || a.isStandard) return 'standard';
  if (a.tiers.length > 0) return 'tiered';
  if (a.bands.length > 1) return 'bands';
  return 'flat';
}

export function AgreementEditor({
  level, id, name, current, onClose, onSaved,
}: {
  level: 'group' | 'agency' | 'branch';
  id: string;
  name: string;
  current: AgreementView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [model, setModel] = useState<PricingModel>(modelOf(current));
  const live = current && !current.isStandard ? current : null;

  const [coverage, setCoverage] = useState<'additive' | 'all_in'>(live?.coverage ?? 'additive');
  const [period, setPeriod] = useState(live?.period ?? 'year');
  const [countingScope, setCountingScope] = useState(live?.countingScope ?? 'agency');
  const [note, setNote] = useState(live?.note ?? '');
  const [busy, setBusy] = useState(false);
  /* A refusal that has an answer. Held with the SQL's own words, which are what
     the dialog shows: the screen must not paraphrase a rule it does not own. */
  const [confirm, setConfirm] = useState<{ kind: 'replace' | 'breach'; message: string } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const [bands, setBands] = useState<BandRow[]>(() =>
    live && live.bands.length
      ? live.bands.map((b) => ({ min: String(b.min), max: b.max == null ? '' : String(b.max), weeks: String(b.weeks), rate: pctOf(b.rate) }))
      : [{ min: '1', max: '', weeks: String(MONTH_WEEKS), rate: '10' }]);
  const [tiers, setTiers] = useState<TierRow[]>(() =>
    live && live.tiers.length
      ? live.tiers.map((t) => ({ from: String(t.from), to: t.to == null ? '' : String(t.to), rate: pctOf(t.rate) }))
      : [{ from: '1', to: '50', rate: '20' }, { from: '51', to: '', rate: '25' }]);

  /* A flat deal is one open-ended band, so switching model narrows what is
     edited rather than throwing the numbers away: an administrator who clicks
     Flat to look at it and clicks back gets their bands returned. */
  const shownBands = model === 'flat' ? bands.slice(0, 1) : bands;

  const setBand = (i: number, patch: Partial<BandRow>) =>
    setBands((bs) => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const setTier = (i: number, patch: Partial<TierRow>) =>
    setTiers((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  /* WHAT THE PARTY WILL EARN, said in the same words the Commission tab uses, so
     the administrator reads the deal back before committing it rather than
     after. Not a rule: the arithmetic below is display only, and SQL prices the
     referral. */
  const preview = useMemo(() => {
    if (model === 'standard') return "One month's rent at the Opndoor standard rate.";
    const b = shownBands.map((x) => {
      const who = x.max === '' ? (x.min === '1' ? 'every tenancy' : `${x.min}+ tenants`)
        : x.min === x.max ? `${x.min} tenant${x.min === '1' ? '' : 's'}`
        : `${x.min}–${x.max} tenants`;
      const wk = Number(x.weeks);
      const fee = Math.abs(wk - MONTH_WEEKS) < 0.02 ? "one month's rent" : `${wk} weeks of rent`;
      return `${who}: ${fee}${x.rate === '' ? '' : ` at ${x.rate}%`}`;
    }).join(' · ');
    if (model !== 'tiered') return b;
    const t = tiers.map((x) => `${x.from}${x.to === '' ? '+' : `–${x.to}`} at ${x.rate}%`).join(' · ');
    return `${b}. Rate by volume: ${t}.`;
  }, [model, shownBands, tiers]);

  async function save(confirmReplace = false, confirmBreach = false) {
    setBusy(true);
    setRefusal(null);
    try {
      if (model === 'standard') {
        if (!live) { toast('Already on standard terms.'); onClose(); return; }
        await endAgreement(live.agreementId);
        toast(`${name} is back on standard terms from today. Referrals already sent keep the fee and commission frozen onto them.`);
        onSaved();
        return;
      }
      const bandInput: AgreementBandInput[] = shownBands.map((b) => ({
        min: Number(b.min) || 1,
        max: b.max.trim() === '' ? null : Number(b.max),
        weeks: Number(b.weeks),
        rate: toRate(b.rate),
      }));
      const tierInput: AgreementTierInput[] = model === 'tiered'
        ? tiers.map((t) => ({ from: Number(t.from), to: t.to.trim() === '' ? null : Number(t.to), rate: Number(t.rate) / 100 }))
        : [];
      await createAgreement({
        level, id, coverage, period: period as 'month' | 'quarter' | 'year',
        countingScope: countingScope as 'agency' | 'group' | 'branch',
        bands: bandInput, tiers: tierInput, note: note.trim() || null,
        confirmReplace, confirmBreach,
      });
      toast(`${name}’s agreement saved. It prices the next referral; everything already sent is unchanged.`);
      onSaved();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const kind = agreementConfirmKind(message);
      // A refusal with an answer is re-offered; every other refusal is final and
      // is shown exactly as SQL worded it — the 50% cap included.
      if (kind && !(kind === 'replace' ? confirmReplace : confirmBreach)) setConfirm({ kind, message });
      else setRefusal(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        width={720}
        title={`Commission for ${name}`}
        sub="What this party is paid, and on what. Saved changes price the NEXT referral: every application already sent keeps the fee and the commission frozen onto it."
        footer={<>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} arrow disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </>}
      >
        {refusal && (
          /* VERBATIM. SQL owns the rule and wrote the sentence; restating it here
             in friendlier words is how a screen and a database come to disagree
             about what is permitted. */
          <div className="agr-refusal" role="alert">
            <Icon name="shield" />
            <div><strong>Not saved.</strong><div className="agr-refusal__msg">{refusal}</div></div>
          </div>
        )}

        <div className="agr-models">
          {MODELS.map((m) => (
            <label key={m.id} className={`roleopt${model === m.id ? ' is-sel' : ''}`} onClick={() => setModel(m.id)}>
              <span className="roleopt__radio" />
              <div><div className="roleopt__name">{m.name}</div><div className="roleopt__desc">{m.desc}</div></div>
            </label>
          ))}
        </div>

        {model !== 'standard' && (
          <>
            <div className="agr-grid">
              <Field label="Coverage" hint={coverage === 'all_in'
                ? 'The entire commission for everything under this party. No branch below may hold a rate of its own.'
                : 'This party’s own line. Rates at other levels still add on top.'}>
                <select value={coverage} onChange={(e) => setCoverage(e.target.value as 'additive' | 'all_in')}>
                  <option value="additive">Additive: this party’s own line</option>
                  <option value="all_in" disabled={level === 'branch'}>All-in: everything underneath</option>
                </select>
              </Field>
              <Field label="Volume period" hint="When the counter resets.">
                <PeriodSelect ariaLabel="Volume period" value={period} onChange={setPeriod}
                  options={[{ value: 'month', label: 'Month' }, { value: 'quarter', label: 'Quarter' }, { value: 'year', label: 'Year' }]} />
              </Field>
              <Field label="Volume counted per" hint="Whose referrals move the counter.">
                <PeriodSelect ariaLabel="Counting scope" value={countingScope} onChange={setCountingScope}
                  options={[{ value: 'branch', label: 'Branch' }, { value: 'agency', label: 'Agency' }, { value: 'group', label: 'Group' }]} />
              </Field>
            </div>

            <div className="agr-sect">Fee and rate{model !== 'flat' ? ', by tenant count' : ''}</div>
            <table className="dt agr-table">
              <thead>
                <tr>
                  <th>From</th><th>To</th><th>Weeks of rent</th>
                  <th>Rate %</th>
                  {model !== 'flat' && <th aria-label="Remove" />}
                </tr>
              </thead>
              <tbody>
                {shownBands.map((b, i) => (
                  <tr key={i}>
                    <td><input inputMode="numeric" value={b.min} onChange={(e) => setBand(i, { min: e.target.value })} aria-label={`Band ${i + 1} from`} /></td>
                    {/* Blank = "and above". Exactly one band may be open-ended. */}
                    <td><input inputMode="numeric" value={b.max} placeholder="and above" onChange={(e) => setBand(i, { max: e.target.value })} aria-label={`Band ${i + 1} to`} /></td>
                    <td><input inputMode="decimal" value={b.weeks} onChange={(e) => setBand(i, { weeks: e.target.value })} aria-label={`Band ${i + 1} weeks`} /></td>
                    <td>
                      <input inputMode="decimal" value={b.rate}
                        placeholder={model === 'tiered' ? 'from the tiers' : ''}
                        onChange={(e) => setBand(i, { rate: e.target.value })} aria-label={`Band ${i + 1} rate`} />
                    </td>
                    {model !== 'flat' && (
                      <td>
                        {shownBands.length > 1 && (
                          <button type="button" className="ah-linkbtn" onClick={() => setBands((bs) => bs.filter((_, j) => j !== i))}>Remove</button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {model !== 'flat' && (
              <button type="button" className="ah-linkbtn agr-add"
                onClick={() => setBands((bs) => [...bs, { min: String(bs.length + 1), max: '', weeks: String(MONTH_WEEKS), rate: '' }])}>
                <Icon name="plus" size={12} /> Add a band
              </button>
            )}
            <p className="agr-hint">
              Weeks of rent is the FEE. {MONTH_WEEKS} weeks is one month, which is standard terms; 3 weeks
              and 5 weeks are the common negotiated bases. A tenancy is priced ONCE at the band its tenant
              count falls in, then split between the tenants by share.
            </p>

            {model === 'tiered' && (
              <>
                <div className="agr-sect">Rate by volume</div>
                <table className="dt agr-table">
                  <thead><tr><th>From referral</th><th>To</th><th>Rate %</th><th aria-label="Remove" /></tr></thead>
                  <tbody>
                    {tiers.map((t, i) => (
                      <tr key={i}>
                        <td><input inputMode="numeric" value={t.from} onChange={(e) => setTier(i, { from: e.target.value })} aria-label={`Tier ${i + 1} from`} /></td>
                        <td><input inputMode="numeric" value={t.to} placeholder="and above" onChange={(e) => setTier(i, { to: e.target.value })} aria-label={`Tier ${i + 1} to`} /></td>
                        <td><input inputMode="decimal" value={t.rate} onChange={(e) => setTier(i, { rate: e.target.value })} aria-label={`Tier ${i + 1} rate`} /></td>
                        <td>
                          {tiers.length > 1 && (
                            <button type="button" className="ah-linkbtn" onClick={() => setTiers((ts) => ts.filter((_, j) => j !== i))}>Remove</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button type="button" className="ah-linkbtn agr-add"
                  onClick={() => setTiers((ts) => [...ts, { from: '', to: '', rate: '' }])}>
                  <Icon name="plus" size={12} /> Add a tier
                </button>
              </>
            )}

            <Field label="Note" span2 hint="What was agreed, and with whom. Shown on the Commission tab and kept in the audit.">
              <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Agreed with …, signed …" />
            </Field>
          </>
        )}

        <div className="agr-preview">
          <span className="agr-preview__lbl">The next referral lands at</span>
          <span className="agr-preview__val">{preview}</span>
        </div>

        {/* EFFECTIVE DATES. An agreement runs from the day it is saved and until
            it is ended or replaced; create_agreement stamps effective_from =
            today and end_agreement closes it. There is no future-dated start,
            which is stated rather than implied by an absent field. */}
        <p className="agr-hint">
          {live
            ? <>In force since <b>{live.periodStart ?? 'the day it was agreed'}</b>. Saving replaces it from today; choose <b>Standard terms</b> to end it. An agreement cannot be future-dated, so enter it on the day it starts.</>
            : <>This takes effect today and runs until it is ended or replaced. An agreement cannot be future-dated, so enter it on the day it starts.</>}
        </p>
      </Modal>

      {confirm && (
        <Modal
          open
          onClose={() => setConfirm(null)}
          width={560}
          title={confirm.kind === 'replace' ? 'Replace what is there?' : 'This goes above a signed deal'}
          footer={<>
            <Button variant="ghost" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button>
            <Button variant="dark" disabled={busy}
              onClick={() => { const k = confirm.kind; setConfirm(null); void save(k === 'replace', k === 'breach'); }}>
              {confirm.kind === 'replace' ? 'Replace and save' : 'I understand, save anyway'}
            </Button>
          </>}
        >
          {/* SQL's words, unedited. It knows what it is about to clear and who
              signed what; the screen knows neither. */}
          <p className="agr-confirm">{confirm.message}</p>
          <p className="agr-hint">
            {confirm.kind === 'replace'
              ? 'Anything cleared is recorded against the party it belonged to, with your name on it.'
              : 'Overriding this is recorded against both parties, with your name on it.'}
          </p>
        </Modal>
      )}
    </>
  );
}
