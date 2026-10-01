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
// Walk fix 19: the possessive is formed in one place.
import { possessive } from '@/lib/format';
import { useMemo, useState } from 'react';
import {
  agreementConfirmKind, createAgreement, endAgreement,
  type AgreementBandInput, type AgreementTierInput, type AgreementView, type FeeBasisUnit,
} from '@/data/orgService';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { PeriodSelect } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import './AgreementEditor.css';

export type PricingModel = 'standard' | 'flat' | 'bands' | 'tiered';

/* THE FOUR SHAPES A DEAL TAKES, named and described for the person
   agreeing one rather than for the table they are stored in. */
const MODELS: { id: PricingModel; name: string; desc: string }[] = [
  {
    id: 'standard',
    name: 'Standard terms',
    desc: 'No special deal. The tenant pays one month’s rent and we pay our usual commission.',
  },
  {
    id: 'flat',
    name: 'One price for everything',
    desc: 'The same fee and the same commission on every referral, however many tenants and however many they send. For example: the tenant pays one month’s rent, we pay 20% of it.',
  },
  {
    id: 'bands',
    name: 'Price by number of tenants',
    desc: 'The fee and the commission both change with how many tenants are on the tenancy. For example: 1 tenant pays one month’s rent, 2 tenants pay 5 weeks’ rent. A joint tenancy is priced once, then split between the tenants.',
  },
  {
    id: 'tiered',
    name: 'Commission grows with volume',
    desc: 'Price by number of tenants as above, and pay more commission the more they send. For example: referrals 1 to 50 at 20%, 51 and over at 25%.',
  },
];

/* A week is rent x 12 / 52, so one month is 52/12 weeks, which does not
   terminate. MONTH_WEEKS used to live here and be seeded into every new band,
   and the summary recognised a month by comparing against it within a tolerance.
   Both are gone: a month is a UNIT now and prices at exactly the rent. See
   20261006120000. */

/** How a fee basis reads in a sentence. "1 month's rent", "3 weeks of rent". */
export function feeBasisWords(qty: number, unit: FeeBasisUnit): string {
  if (!Number.isFinite(qty) || qty <= 0) return 'no fee';
  if (unit === 'months') return qty === 1 ? "one month's rent" : `${qty} months' rent`;
  return qty === 1 ? 'one week of rent' : `${qty} weeks of rent`;
}

/** The terse form, for a summary that lists several bands side by side.
    feeBasisWords writes the basis into a sentence ("3 weeks of rent"); this
    names it in a list ("3 weeks"). Same unit rule, deliberately kept beside its
    long form so the two cannot drift apart on what a month is. */
export function feeBasisShort(qty: number, unit: FeeBasisUnit): string {
  if (!Number.isFinite(qty) || qty <= 0) return 'no fee';
  if (unit === 'months') return qty === 1 ? 'one month' : `${qty} months`;
  return qty === 1 ? 'one week' : `${qty} weeks`;
}

const pctOf = (r: number | null) => (r == null ? '' : String(Number((r * 100).toFixed(2))));

/* =====================================================================
   PLAIN ENGLISH, FOR SOMEBODY AGREEING A COMMERCIAL DEAL

   Matt, 2026-10-01: "rewrite every heading and description in plain
   English for someone agreeing a commercial deal, with a short example
   where it helps. No internal terms ('party', 'additive', 'own line',
   'coverage', 'fee basis', 'lands at') ... Show bands as '1 tenant',
   '2 tenants', '3 or more', and tiers as 'Referrals 1 to 50: 20%, 51
   and over: 25%'."

   THE WORDS WERE THE DATA MODEL'S. A band is a row with `min`, `max`,
   `weeks` and `unit`, and the screen said so: "From 1 To (blank) Fee
   basis 1 Unit months". Every one of those is the right name for the
   column in the table and the wrong name for the thing being agreed,
   which is "1 tenant pays one month's rent". These three functions are
   the translation, in one place, so the summary on the Overview tree
   and the summary in the editor cannot word the same deal differently.
   ===================================================================== */

/** Who a band applies to: "1 tenant", "2 tenants", "3 or more". */
export function tenantsWords(min: number, max: number | null): string {
  const lo = Number.isFinite(min) && min > 0 ? min : 1;
  /* OPEN-ENDED FROM ONE IS EVERY TENANCY, and saying "1 or more" there
     would invite the reader to look for the band above it. */
  if (max == null) return lo <= 1 ? 'any number of tenants' : `${lo} or more`;
  if (max === lo) return `${lo} tenant${lo === 1 ? '' : 's'}`;
  return `${lo} to ${max} tenants`;
}

/** A volume tier: "Referrals 1 to 50", "51 and over". */
export function tierWords(from: number, to: number | null): string {
  /* THE STORED LOWEST TIER STARTS AT 0, because the volume counter is 0
     before the first referral of a period. Nobody agreeing a deal says
     "referrals 0 to 50", so the words start at 1 while the number
     stored stays 0. The two differ on purpose and the comment is here
     so the next person does not "fix" one of them. */
  const lo = Number.isFinite(from) ? Math.max(from, 1) : 1;
  if (to == null) return `${lo} and over`;
  return `${lo} to ${to}`;
}

/**
 * The whole deal in a sentence, for somebody who is agreeing it.
 *
 * Replaces "The next referral lands at", which named a mechanism rather
 * than a deal and used a word nobody outside this file would use.
 */
export function dealWords(
  bands: { min: number; max: number | null; weeks: number; unit: FeeBasisUnit; rate: number | null }[],
  tiers: { from: number; to: number | null; rate: number }[],
): string {
  if (!bands.length) return 'Nothing agreed yet.';
  const tiered = tiers.length > 0;
  const feeParts = bands.map((b) => {
    const who = tenantsWords(b.min, b.max);
    /* THE VERB AGREES. "1 tenant pay 3 weeks of rent" is the shape you
       get from building a sentence out of a table row, and Matt's own
       example says "1 tenant pays one month's rent, 2 tenants pay 5
       weeks' rent". One band of exactly one tenant is the only singular
       case; "any number of tenants" and "3 or more" are both plural. */
    const verb = b.max === b.min && b.min === 1 ? 'pays' : 'pay';
    const fee = feeBasisWords(b.weeks, b.unit);
    if (tiered || b.rate == null) return `${who} ${verb} ${fee}`;
    return `${who} ${verb} ${fee}, and we pay ${pctOf(b.rate)}% of that`;
  });
  const fee = feeParts.join('; ');
  if (!tiered) return `${fee}.`;
  const rates = tiers
    .map((t) => `${tierWords(t.from, t.to)}: ${pctOf(t.rate)}%`)
    .join(', ');
  /* THE STEPS, AND NOTHING ELSE. A sentence explaining that commission
     steps up with volume, immediately above a list of the steps, is the
     list said twice. */
  return `${fee}. We pay by volume. Referrals ${rates}.`;
}

/**
 * A negotiated agreement in one line, for the Overview tree.
 *
 * "Agreement: 3 weeks at 20%, 5 weeks at 25%" — which is Regent's deal.
 *
 * NULL FOR STANDARD TERMS, because standard terms are not an agreement and the
 * node should go on offering Set rate. Null also when there are no bands: a row
 * with nothing in it must not print the word "Agreement" and nothing else.
 *
 * A VOLUME-TIERED AGREEMENT HAS NO BAND RATE, by design (the rate lives on the
 * tiers alone). Naming one would contradict the tiers, and reading the band's
 * null as a figure is how "at standard" would appear next to a negotiated deal,
 * so the tiered form names the basis and then the tier range.
 */
export function agreementSummary(a: AgreementView | null | undefined): string | null {
  if (!a || a.isStandard || !a.bands.length) return null;
  const tiered = a.tiers.length > 0;
  /* NAMED BY WHO THEY APPLY TO, not just by the fee. "Agreement: 3
     weeks, 5 weeks" left the reader to work out which was which; "1
     tenant: 3 weeks at 20%" says it. Matt, 2026-10-01: "Show bands as
     '1 tenant', '2 tenants', '3 or more'." */
  const parts = a.bands.map((b) => {
    const who = tenantsWords(b.min, b.max);
    const basis = feeBasisShort(b.weeks, b.unit ?? 'weeks');
    return tiered || b.rate == null ? `${who}: ${basis}` : `${who}: ${basis} at ${pctOf(b.rate)}%`;
  });
  const head = `Deal: ${parts.join(', ')}`;
  if (!tiered) return head;
  /* THE TIERS IN FULL, in Matt's own shape: "Referrals 1 to 50: 20%, 51
     and over: 25%". It used to collapse them to a range ("20% to 25% by
     volume"), which hid where the step actually falls -- the one number
     a commercial reader is checking. */
  const rates = a.tiers.map((t) => `${tierWords(t.from, t.to)}: ${pctOf(t.rate)}%`).join(', ');
  return `${head}. Referrals ${rates}`;
}
const toRate = (s: string) => (s.trim() === '' ? null : Number(s) / 100);

interface BandRow { min: string; max: string; weeks: string; unit: FeeBasisUnit; rate: string }
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
      ? live.bands.map((b) => ({ min: String(b.min), max: b.max == null ? '' : String(b.max), weeks: String(b.weeks), unit: b.unit ?? 'weeks', rate: pctOf(b.rate) }))
      // One month, said as one month. This used to seed 4.3333 weeks, which is
      // what standard terms had to be written as before the unit existed.
      : [{ min: '1', max: '', weeks: '1', unit: 'months', rate: '10' }]);
  const [tiers, setTiers] = useState<TierRow[]>(() =>
    live && live.tiers.length
      ? live.tiers.map((t) => ({ from: String(t.from), to: t.to == null ? '' : String(t.to), rate: pctOf(t.rate) }))
      /* FROM ZERO, not from one. agreement_volume is 0 before the first referral
         of a period, so a lowest tier starting at 1 matches nothing at all on
         the very referral that opens the period. That used to be invisible
         because the rate fell back to the BAND's, which is the fallback this
         model is removing: with the bands carrying fee only, an uncovered
         volume has no rate to fall back to. */
      : [{ from: '0', to: '50', rate: '20' }, { from: '51', to: '', rate: '25' }]);

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
  /* THE WHOLE DEAL, IN A SENTENCE. Matt, 2026-10-01: "Replace 'The next
     referral lands at' with a plain summary of the whole deal."

     It used to read "1 tenant: 3 weeks of rent at 20% · 2+ tenants: 5
     weeks of rent at 25%", which is the table again with punctuation
     between the cells. The reader already has the table; what they
     cannot get from it is the deal read back to them as a sentence. */
  const preview = useMemo(() => {
    if (model === 'standard') {
      return 'No special deal. The tenant pays one month’s rent and we pay our usual commission.';
    }
    return dealWords(
      shownBands.map((x) => ({
        min: Number(x.min) || 1,
        max: x.max.trim() === '' ? null : Number(x.max),
        weeks: Number(x.weeks),
        unit: x.unit,
        rate: model === 'tiered' || x.rate.trim() === '' ? null : Number(x.rate) / 100,
      })),
      model === 'tiered'
        ? tiers.map((t) => ({
            from: Number(t.from) || 0,
            to: t.to.trim() === '' ? null : Number(t.to),
            rate: Number(t.rate) / 100,
          }))
        : [],
    );
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
        unit: b.unit,
        /* NULL ON A TIERED AGREEMENT, so the band states no rate at all rather
           than storing one the tiers then override. A stored-but-ignored rate
           is the thing that makes an agreement unreadable a year later: the row
           says 20% and every referral was priced at 25%. */
        rate: model === 'tiered' ? null : toRate(b.rate),
      }));
      const tierInput: AgreementTierInput[] = model === 'tiered'
        ? tiers.map((t) => ({ from: Number(t.from), to: t.to.trim() === '' ? null : Number(t.to), rate: Number(t.rate) / 100 }))
        : [];

      /* THE TIERS MUST COVER ZERO, or the first referral of every period has no
         rate. The bands no longer carry one on this model, so there is nothing
         behind the tiers to catch a volume they miss: resolve_pricing_agreement
         coalesces the tier's rate over the band's, and the band's is now null.
         Refused rather than quietly rewritten, because the lowest number in a
         pricing table is not ours to change. */
      if (model === 'tiered') {
        const lowest = Math.min(...tierInput.map((t) => t.from));
        if (!Number.isFinite(lowest) || lowest > 0) {
          setRefusal('The lowest volume tier must start at 0, or the first referral of each period has no rate. The bands set the fee on this model and the tiers set the rate, so nothing else can price it.');
          setBusy(false);
          return;
        }
      }
      await createAgreement({
        level, id, coverage, period: period as 'month' | 'quarter' | 'year',
        countingScope: countingScope as 'agency' | 'group' | 'branch',
        bands: bandInput, tiers: tierInput, note: note.trim() || null,
        confirmReplace, confirmBreach,
      });
      toast(`${possessive(name)} agreement saved. It prices the next referral; everything already sent is unchanged.`);
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
        title={`Commission deal for ${name}`}
        sub="What the tenant pays, and what we pay this agency out of it. A change applies to the next referral: anything already sent keeps the fee and commission it was created with."
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
              {/* "ADDITIVE" EXPLAINED, OR HIDDEN. Matt, 2026-10-01: 'Explain
                  "Additive" in one sentence, or hide it if it isn't needed.'

                  HIDDEN FOR A BRANCH, where it never was a choice: all-in
                  is disabled at that level because there is nothing below
                  a branch to cover, so the control offered one option and
                  called it a decision.

                  EXPLAINED EVERYWHERE ELSE, in the only terms that matter
                  commercially: does this one deal settle the whole bill,
                  or can the office below and the group above add their own
                  on top. The words "additive", "coverage" and "own line"
                  are gone; the stored values are untouched. */}
              {level !== 'branch' && (
                <Field
                  label="Does this cover everyone?"
                  hint={coverage === 'all_in'
                    ? 'Yes. This is the whole commission on these referrals and no office underneath can be paid separately.'
                    : 'No. Offices underneath and the group above can be paid their own commission on the same referral, on top of this.'}
                >
                  <select value={coverage} onChange={(e) => setCoverage(e.target.value as 'additive' | 'all_in')}>
                    <option value="additive">No, others can also be paid</option>
                    <option value="all_in">Yes, this is the whole commission</option>
                  </select>
                </Field>
              )}
              <Field label="Count referrals over" hint="How long before the count starts again at nought. Only matters if commission grows with volume.">
                <PeriodSelect ariaLabel="Count referrals over" value={period} onChange={setPeriod}
                  options={[{ value: 'month', label: 'A month' }, { value: 'quarter', label: 'A quarter' }, { value: 'year', label: 'A year' }]} />
              </Field>
              <Field label="Count referrals from" hint="Whose referrals add to the count: one office, the whole agency, or the whole group.">
                <PeriodSelect ariaLabel="Count referrals from" value={countingScope} onChange={setCountingScope}
                  options={[{ value: 'branch', label: 'This office only' }, { value: 'agency', label: 'The whole agency' }, { value: 'group', label: 'The whole group' }]} />
              </Field>
            </div>

            <div className="agr-sect">
              {model === 'flat' ? 'What the tenant pays, and what we pay' : 'Pricing by number of tenants'}
            </div>
            <p className="agr-hint agr-hint--lead">
              {model === 'flat'
                ? 'The fee is what the tenant pays for the guarantee. The commission is the share of that fee we pay the agency.'
                : 'For example: 1 tenant pays one month’s rent, 2 tenants pay 5 weeks’ rent. A joint tenancy is priced once and then split between the tenants.'}
            </p>
            <table className="dt agr-table">
              <thead>
                <tr>
                  {/* NAMED FOR WHAT THEY ARE, not for the columns they are
                      stored in. "Fee basis" and "Unit" are two halves of
                      one idea -- how much rent the tenant pays -- so they
                      are headed as one. */}
                  <th>Tenants from</th><th>to</th><th>Fee</th><th aria-label="Weeks or months" />
                  {/* UNDER VOLUME TIERED THE BANDS CARRY THE FEE ONLY. The rate
                      comes from the tiers, which is what the model MEANS, and
                      the column was an editable box whose value the pricing
                      ignored: resolve_pricing_agreement coalesces the tier's
                      rate over the band's, so a number typed here on a tiered
                      agreement changed nothing and read as though it had. */}
                  {model !== 'tiered' && <th>Commission %</th>}
                  {model !== 'flat' && <th aria-label="Remove" />}
                </tr>
              </thead>
              <tbody>
                {shownBands.map((b, i) => (
                  <tr key={i}>
                    <td><input className="inp" inputMode="numeric" value={b.min} onChange={(e) => setBand(i, { min: e.target.value })} aria-label={`Band ${i + 1} from`} /></td>
                    {/* Blank = "and above". Exactly one band may be open-ended. */}
                    <td><input className="inp" inputMode="numeric" value={b.max} placeholder="and above" onChange={(e) => setBand(i, { max: e.target.value })} aria-label={`Band ${i + 1} to`} /></td>
                    <td><input className="inp" inputMode="decimal" value={b.weeks} onChange={(e) => setBand(i, { weeks: e.target.value })} aria-label={`Band ${i + 1} fee`} /></td>
                    {/* THE UNIT, on Flat and on every band. A month is not
                        4.3333 weeks: 52/12 does not terminate, so "one month"
                        written as weeks priced at 0.99999 of the rent, twopence
                        under on a £2,000 tenancy. Months are stored as an exact
                        multiple of the rent instead. */}
                    <td>
                      <select value={b.unit} onChange={(e) => setBand(i, { unit: e.target.value as FeeBasisUnit })} aria-label={`Band ${i + 1} unit`}>
                        <option value="weeks">weeks’ rent</option>
                        <option value="months">months’ rent</option>
                      </select>
                    </td>
                    {model !== 'tiered' && (
                      <td>
                        <input className="inp" inputMode="decimal" value={b.rate}
                          onChange={(e) => setBand(i, { rate: e.target.value })} aria-label={`Band ${i + 1} commission percent`} />
                      </td>
                    )}
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
                onClick={() => setBands((bs) => [...bs, { min: String(bs.length + 1), max: '', weeks: '1', unit: 'months', rate: '' }])}>
                <Icon name="plus" size={12} /> Add another tenant count
              </button>
            )}
            <p className="agr-hint">
              One month’s rent is our standard; 3 weeks and 5 weeks are the usual negotiated prices.
              Leave <b>to</b> empty for the last row to mean &ldquo;and above&rdquo;.
            </p>

            {model === 'tiered' && (
              <>
                <div className="agr-sect">Commission by volume</div>
                <p className="agr-hint agr-hint--lead">
                  How much we pay as they send more. For example: referrals 1 to 50 at 20%,
                  51 and over at 25%. Leave <b>to</b> empty on the last row to mean
                  &ldquo;and over&rdquo;.
                </p>
                <table className="dt agr-table">
                  <thead><tr><th>Referrals from</th><th>to</th><th>Commission %</th><th aria-label="Remove" /></tr></thead>
                  <tbody>
                    {tiers.map((t, i) => (
                      <tr key={i}>
                        <td><input className="inp" inputMode="numeric" value={t.from} onChange={(e) => setTier(i, { from: e.target.value })} aria-label={`Tier ${i + 1} from`} /></td>
                        <td><input className="inp" inputMode="numeric" value={t.to} placeholder="and above" onChange={(e) => setTier(i, { to: e.target.value })} aria-label={`Tier ${i + 1} to`} /></td>
                        <td><input className="inp" inputMode="decimal" value={t.rate} onChange={(e) => setTier(i, { rate: e.target.value })} aria-label={`Tier ${i + 1} commission percent`} /></td>
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
                  <Icon name="plus" size={12} /> Add another volume step
                </button>
              </>
            )}

            <Field label="What was agreed, and with whom" span2 hint="Shown on the Commission tab and kept with the record of changes.">
              <input className="inp" type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Agreed with …, signed …" />
            </Field>
          </>
        )}

        {/* THE DEAL, READ BACK. Matt, 2026-10-01: "Replace 'The next
            referral lands at' with a plain summary of the whole deal." */}
        <div className="agr-preview">
          <span className="agr-preview__lbl">This deal, in plain English</span>
          <span className="agr-preview__val">{preview}</span>
        </div>

        {/* EFFECTIVE DATES. An agreement runs from the day it is saved and until
            it is ended or replaced; create_agreement stamps effective_from =
            today and end_agreement closes it. There is no future-dated start,
            which is stated rather than implied by an absent field. */}
        <p className="agr-hint">
          {live
            ? <>Agreed on <b>{live.periodStart ?? 'the day it was signed'}</b>. Saving replaces it from today; choose <b>Standard terms</b> to end it. A deal cannot be dated in the future, so enter it on the day it starts.</>
            : <>This starts today and runs until it is ended or replaced. A deal cannot be dated in the future, so enter it on the day it starts.</>}
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
              ? 'Whatever is cleared is recorded against the agency or office it belonged to, with your name on it.'
              : 'Going ahead is recorded against both the agency and the office, with your name on it.'}
          </p>
        </Modal>
      )}
    </>
  );
}
