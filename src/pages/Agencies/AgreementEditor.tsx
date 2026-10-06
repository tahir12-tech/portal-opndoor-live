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
import { formatDate, possessive } from '@/lib/format';
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
import { plural } from '@/lib/plural';

export type PricingModel = 'standard' | 'flat' | 'bands' | 'tiered';

/* =====================================================================
   THE FOUR SHAPES A DEAL TAKES, named and described for the person
   agreeing one rather than for the table they are stored in.

   AND THE TWO IN THE MIDDLE ARE THE ONES PEOPLE CONFUSE. Matt,
   2026-10-01: "make the choice between pricing by number of tenants and
   pricing by number of referrals unmistakable, each with a one-line
   example ('e.g. 1 tenant 3 weeks' rent, 2 tenants 5 weeks'' vs 'e.g.
   first 5 referrals a month at 10%, then 15%')."

   They were "Price by number of tenants" and "Commission grows with
   volume", which name the same kind of thing two different ways: one
   says what it varies BY, the other says what HAPPENS. Side by side
   that reads as a difference of degree, and the numbers in both boxes
   are small integers, so a 5 typed in the wrong one is invisible.

   Now both are named for the thing counted -- tenants on one tenancy
   against referrals they send -- and both carry a one-line example in
   Matt's own words. `contrast` is the sentence that says what the other
   one is, which is the part a name alone cannot do.
   ===================================================================== */
/* WHAT "OUR STANDARD" ACTUALLY IS, in one place.
   Matt, 2026-10-03: "'Standard terms' should say the actual figures: 'No
   special deal. The tenant pays one month's rent and we pay our standard
   10%.'" "Our usual commission" named a figure without giving it, so the one
   option somebody picks when they do NOT want to think about numbers was the
   only one that would not tell them what the numbers are.

   The band seed below already writes 10 as the standard rate, so the sentence
   and the seeded row read off the same constant and cannot drift. */
const STANDARD_AGENT_PCT = '10';
const STANDARD_TERMS = `No special deal. The tenant pays one month’s rent and we pay our standard ${STANDARD_AGENT_PCT}%.`;

const MODELS: { id: PricingModel; name: string; desc: string; eg?: string; contrast?: string }[] = [
  {
    id: 'standard',
    name: 'Standard terms',
    desc: STANDARD_TERMS,
  },
  {
    id: 'flat',
    name: 'One price for everything',
    desc: 'The same fee and the same commission on every referral, however many tenants and however many they send.',
    eg: 'e.g. the tenant pays one month’s rent, we pay 20% of it',
  },
  {
    id: 'bands',
    name: 'Price by number of TENANTS on the tenancy',
    desc: 'The fee changes with how many people are named on one tenancy. A joint tenancy is priced once, then split between them.',
    eg: 'e.g. 1 tenant 3 weeks’ rent, 2 tenants 5 weeks’',
    contrast: 'Counts people on a tenancy, not referrals sent. Two or three is normal here.',
  },
  {
    id: 'tiered',
    name: 'Price by number of REFERRALS they send',
    desc: 'The commission grows as they send more. The fee is still set by number of tenants.',
    eg: 'e.g. first 5 referrals a month at 10%, then 15%',
    contrast: 'Counts referrals in a period, not people on a tenancy. Fifty or a hundred is normal here.',
  },
];

/* A TENANT COUNT THIS HIGH IS ALMOST CERTAINLY A VOLUME. Matt: "Warn
   before saving a tenant band above 4 tenants, since that's almost
   certainly meant as referral volume."

   FOUR, because a four-bedroom share is an ordinary joint tenancy and a
   five is not quite. A WARNING AND NOT A REFUSAL: a five-tenant HMO is
   real, just rare, and the one thing this must not do is make a true
   deal impossible to enter. */
export const TENANT_BAND_WARN_ABOVE = 4;

/** Every band edge that looks like a referral volume rather than a tenancy. */
export function suspectTenantCounts(bands: { min: string | number; max: string | number }[]): number[] {
  const out: number[] = [];
  for (const b of bands) {
    for (const v of [b.min, b.max]) {
      const n = typeof v === 'number' ? v : Number(String(v).trim());
      if (Number.isFinite(n) && n > TENANT_BAND_WARN_ABOVE && !out.includes(n)) out.push(n);
    }
  }
  return out.sort((a, b) => a - b);
}

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

/** A rate as a reader says it: 0.25 is "25", 0.125 is "12.5". Exported
    because the Commission tab's summary cards have to print the flat
    percentage the same way a deal's sentence prints a negotiated one, and
    `fmtRatePct` pads a whole number to one decimal ("25.0%"). */
export const pctOf = (r: number | null) => (r == null ? '' : String(Number((r * 100).toFixed(2))));

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
  if (max === lo) return `${lo} ${plural(lo, 'tenant')}`;
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
 * The typed lowest edge, as the database wants it.
 *
 * The inverse of `tierWords`' Math.max(from, 1): the screen counts referrals
 * from 1 and `agreement_volume` counts from 0, so the opening row -- whether
 * it was typed as 1 or left as 0 -- is stored as 0 and everything above it is
 * stored as typed. Without this the first referral of each period would match
 * no tier and have no rate at all.
 */
export function toStoredFrom(typed: string | number): number {
  const n = typeof typed === 'number' ? typed : Number(String(typed).trim());
  if (!Number.isFinite(n)) return NaN;
  return n <= 1 ? 0 : n;
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
  /* AN AGENTS' SHARE SETS NO FEE, so its sentence cannot name one. "1 tenant
     pays one month's rent, and we pay 20% of that" is the commission deal;
     the share deal says only what proportion goes on to the agency. */
  share = false,
): string {
  if (!bands.length) return 'Nothing agreed yet.';
  const tiered = tiers.length > 0;
  if (share) {
    const parts = bands.map((b) => {
      const who = tenantsWords(b.min, b.max);
      return tiered || b.rate == null
        ? `${who}`
        : `${who}: ${pctOf(b.rate)}% of the fee goes to the agency`;
    });
    if (!tiered) {
      return bands.every((b) => b.rate == null)
        ? 'Nothing agreed yet.'
        : `${parts.join('; ')}.`;
    }
    const rates = tiers.map((t) => `${tierWords(t.from, t.to)}: ${pctOf(t.rate)}%`).join(', ');
    return `The agency's share grows with volume. Referrals ${rates} of the fee.`;
  }
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
  if (!tiered) return sentence(`${fee}.`);
  const rates = tiers
    .map((t) => `${tierWords(t.from, t.to)}: ${pctOf(t.rate)}%`)
    .join(', ');
  /* THE STEPS, AND NOTHING ELSE. A sentence explaining that commission
     steps up with volume, immediately above a list of the steps, is the
     list said twice. */
  return sentence(`${fee}. We pay by volume. Referrals ${rates}.`);
}

/* IT IS A SENTENCE, SO IT STARTS LIKE ONE. Matt, 2026-10-03: "The
   plain-English summary starts lowercase ('any number of tenants…');
   capitalise it." It is built from a table row -- "any number of tenants",
   "1 tenant", "3 or more" -- and those read correctly in the middle of a
   list and wrongly at the front of a paragraph. Capitalised here, at the
   one exit, rather than at the three call sites that print it. */
function sentence(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
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
  level, id, name, current, onClose, onSaved, kind = 'commission',
}: {
  level: 'partner' | 'group' | 'agency' | 'branch';
  id: string;
  name: string;
  current: AgreementView | null;
  onClose: () => void;
  onSaved: () => void;
  /* WHICH OF A SUPPLIER'S TWO DEALS. Matt, 2026-10-01: the same editor, "for
     both the supplier's total commission and the agents' share within it".
     Everything on the agency rail is a commission and says nothing. */
  kind?: 'commission' | 'agent_share';
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
  /** Band edges that look like a referral volume. Empty is the usual answer. */
  const [tenantWarn, setTenantWarn] = useState<number[] | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const [bands, setBands] = useState<BandRow[]>(() =>
    live && live.bands.length
      ? live.bands.map((b) => ({ min: String(b.min), max: b.max == null ? '' : String(b.max), weeks: String(b.weeks), unit: b.unit ?? 'weeks', rate: pctOf(b.rate) }))
      // One month, said as one month. This used to seed 4.3333 weeks, which is
      // what standard terms had to be written as before the unit existed.
      : [{ min: '1', max: '', weeks: '1', unit: 'months', rate: STANDARD_AGENT_PCT }]);
  const [tiers, setTiers] = useState<TierRow[]>(() =>
    live && live.tiers.length
      // A stored 0 is the opening referral and reads as 1, the same rule tierWords prints.
      ? live.tiers.map((t) => ({ from: String(Math.max(t.from, 1)), to: t.to == null ? '' : String(t.to), rate: pctOf(t.rate) }))
      /* ONE ON SCREEN, ZERO IN THE DATABASE, and the two differ on purpose.

         agreement_volume is 0 before the first referral of a period, so a
         STORED lowest tier of 1 matches nothing at all on the very referral
         that opens the period -- and with the bands carrying fee only on this
         model, an uncovered volume has no rate to fall back to.

         But nobody agreeing a deal says "referrals 0 to 50", which is why
         tierWords has printed the first row as 1 since it was written. Matt,
         2026-10-03: "the first row starts at 0 but the plain-English line
         says 'Referrals 1 to 50'. Start the first row at 1." So the FORM now
         reads 1, matching its own sentence, and `toStoredFrom` below puts the
         0 back on the way to the database. */
      : [{ from: '1', to: '50', rate: '20' }, { from: '51', to: '', rate: '25' }]);

  /* A flat deal is one open-ended band, so switching model narrows what is
     edited rather than throwing the numbers away: an administrator who clicks
     Flat to look at it and clicks back gets their bands returned. */
  const shownBands = model === 'flat' ? bands.slice(0, 1) : bands;

  /* AN AGENTS' SHARE SETS NO FEE. The tenant's price is set once, by the
     supplier's commission deal; a share band that also named one would be
     two deals disagreeing about what the tenant pays. The column is hidden
     and create_agreement stores NULL whatever is sent, so this is the
     screen agreeing with the rule rather than being it. */
  const share = kind === 'agent_share';

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
  /* "STANDARD TERMS" IS NOT A THING A SUPPLIER HAS. Matt, 2026-10-01,
     rebuilding the supplier Commission tab: plain English only, and
     'Standard terms' is on his list of words to go. For an agency it is
     the name of a real published position; for a supplier the words say
     nothing, because what happens with no deal is that the flat
     percentage on its own page prices the referral. Same option, named
     for whoever is reading it. */
  const models = useMemo(() => MODELS.map((m) => (
    m.id === 'standard' && level === 'partner'
      ? {
          ...m,
          name: 'No special deal',
          desc: 'The supplier is paid the percentage set on its own page, on every referral.',
        }
      : m
  )), [level]);

  const preview = useMemo(() => {
    if (model === 'standard') {
      return share
        ? 'No special arrangement. The agencies under this supplier keep whatever its flat share says.'
        : STANDARD_TERMS;
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
      share,
    );
  }, [model, shownBands, tiers, share]);

  async function save(confirmReplace = false, confirmBreach = false, confirmTenants = false) {
    /* THE TENANT-COUNT WARNING COMES FIRST, before anything is sent.
       Matt, 2026-10-01: "Warn before saving a tenant band above 4
       tenants, since that's almost certainly meant as referral volume."

       Raised HERE and not by the server, because the server cannot tell:
       a band of 1 to 50 tenants is a perfectly valid row and the database
       has no opinion about household size. What makes it a mistake is
       that the number is the shape of a referral volume, and the only
       place that knows the two controls sit next to each other is the
       screen they sit on.

       A WARNING, NOT A REFUSAL. A five-tenant HMO is real, just rare. */
    if (!confirmTenants && model !== 'standard') {
      const odd = suspectTenantCounts(shownBands);
      if (odd.length) {
        setTenantWarn(odd);
        return;
      }
    }
    setBusy(true);
    setRefusal(null);
    try {
      if (model === 'standard') {
        if (!live) { toast('Already on our usual terms.'); onClose(); return; }
        await endAgreement(live.agreementId);
        toast(`${name} is back on our usual terms from today. Referrals already sent keep the fee and commission they were given.`);
        onSaved();
        return;
      }
      /* ONE PRICE MEANS EVERY TENANCY, AND THE RANGE HAS TO SAY SO.

         Matt, 2026-10-04: "switching to 'One price for everything' keeps the
         first tenant band ('1 to 1'), so the deal only prices single
         tenancies. One price must cover any number of tenants: a single row
         with no tenant range."

         `shownBands` narrows a banded deal to its FIRST row, deliberately, so
         an administrator who looks at Flat and clicks back still has their
         bands. What it cannot do is carry that row's RANGE into a flat save:
         a first band of "1 to 1" then stored min 1 max 1, and
         resolve_pricing_agreement matches a band with
         `min_tenants <= n and (max_tenants is null or max_tenants >= n)`,
         which matches NOTHING at two tenants. The fee basis and the rate both
         resolve null and the referral falls back to standard terms without a
         word: the wrong fee charged and the wrong commission paid, from a
         deal that reads as "one price for everything".

         So a flat deal states the range it means rather than inheriting one.
         `tenantsWords(1, null)` already words that as "any number of
         tenants", so the plain English follows from the stored row instead of
         being a second description of it. */
      const flatBand = shownBands[0];
      const bandInput: AgreementBandInput[] = model === 'flat' && flatBand
        ? [{
            min: 1,
            max: null,
            weeks: Number(flatBand.weeks),
            unit: flatBand.unit,
            rate: toRate(flatBand.rate),
          }]
        : shownBands.map((b) => ({
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
        ? tiers.map((t) => ({ from: toStoredFrom(t.from), to: t.to.trim() === '' ? null : Number(t.to), rate: Number(t.rate) / 100 }))
        : [];

      /* THE TIERS MUST STILL COVER ZERO, or the first referral of every period
         has no rate. The bands no longer carry one on this model, so there is
         nothing behind the tiers to catch a volume they miss:
         resolve_pricing_agreement coalesces the tier's rate over the band's,
         and the band's is now null.

         WHAT CHANGED ON 2026-10-03 is where the 0 comes from, not whether
         there is one. The form reads 1 -- "referrals 1 to 50" is what somebody
         agreeing a deal says -- and `toStoredFrom` writes the opening row as
         0. So the refusal can only fire now on a lowest row of 2 or more,
         which really is a gap the administrator typed, and it says so in
         their numbers rather than in the database's. */
      if (model === 'tiered') {
        const lowest = Math.min(...tierInput.map((t) => t.from));
        if (!Number.isFinite(lowest) || lowest > 0) {
          setRefusal('The lowest volume tier must start at 1, or the first referrals of each period have no rate. The bands set the fee on this model and the tiers set the rate, so nothing else can price them.');
          setBusy(false);
          return;
        }
      }
      await createAgreement({
        level, id, kind, coverage, period: period as 'week' | 'month' | 'year' | 'lifetime',
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
        title={share ? `Agents' share for ${name}` : `Commission deal for ${name}`}
        sub={share
          ? "How much of this supplier's commission belongs to the agencies underneath it. The tenant's price is set on the supplier's own commission deal, not here. A change applies to the next referral."
          : "What the tenant pays, and what we pay this agency out of it. A change applies to the next referral: anything already sent keeps the fee and commission it was created with."}
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
          {models.map((m) => (
            <label key={m.id} className={`roleopt${model === m.id ? ' is-sel' : ''}`} onClick={() => setModel(m.id)}>
              <span className="roleopt__radio" />
              <div>
                <div className="roleopt__name">{m.name}</div>
                <div className="roleopt__desc">{m.desc}</div>
                {/* THE EXAMPLE ON ITS OWN LINE, because it is the thing a
                    reader checks their intention against and it should not
                    have to be found inside a paragraph. */}
                {m.eg && <div className="roleopt__eg">{m.eg}</div>}
                {m.contrast && <div className="roleopt__vs">{m.contrast}</div>}
              </div>
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
              {level !== 'branch' && !share && (
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
              {/* THE PERIODS THE SYSTEM ACTUALLY HAS, which is not what
                  this offered. It listed Month, Quarter and Year.

                  QUARTER WAS REFUSED BY THE DATABASE: the check on
                  pricing_agreements.period allows week, month, year and
                  lifetime, so choosing it and pressing Save produced a
                  raw constraint error. And it would not have worked if
                  it had saved: agreement_period_start has no quarter
                  arm, so the period start would be NULL, the volume
                  comparison would match nothing, and the count would
                  read nought for ever -- the lowest tier applying to
                  every referral, silently.

                  WEEK AND LIFETIME WERE MISSING, and both are real. So
                  the control was wrong in both directions. Verified
                  against dev by trying the insert. */}
              <Field label="Count referrals over" hint="How long before the count starts again at nought. Only matters if commission grows with volume.">
                <PeriodSelect ariaLabel="Count referrals over" value={period} onChange={setPeriod}
                  options={[
                    { value: 'week', label: 'A week' },
                    { value: 'month', label: 'A month' },
                    { value: 'year', label: 'A year' },
                    { value: 'lifetime', label: 'Never, count them all' },
                  ]} />
              </Field>
              <Field label="Count referrals from" hint="Whose referrals add to the count: one office, the whole agency, or the whole group.">
                <PeriodSelect ariaLabel="Count referrals from" value={countingScope} onChange={setCountingScope}
                  options={[{ value: 'branch', label: 'This office only' }, { value: 'agency', label: 'The whole agency' }, { value: 'group', label: 'The whole group' }]} />
              </Field>
            </div>

            <div className="agr-sect">
              {share
                ? (model === 'flat' ? 'The agencies’ share' : 'The agencies’ share, by number of tenants')
                : (model === 'flat' ? 'What the tenant pays, and what we pay' : 'Pricing by number of tenants')}
            </div>
            <p className="agr-hint agr-hint--lead">
              {share
                ? 'The part of this supplier’s commission that goes to the agency that referred. The tenant’s price is set on the supplier’s commission deal.'
                : model === 'flat'
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
                  <th>Tenants from</th><th>to</th>
                  {!share && <><th>Fee</th><th aria-label="Weeks or months" /></>}
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
                    {!share && (
                      <td><input className="inp" inputMode="decimal" value={b.weeks} onChange={(e) => setBand(i, { weeks: e.target.value })} aria-label={`Band ${i + 1} fee`} /></td>
                    )}
                    {/* THE UNIT, on Flat and on every band. A month is not
                        4.3333 weeks: 52/12 does not terminate, so "one month"
                        written as weeks priced at 0.99999 of the rent, twopence
                        under on a £2,000 tenancy. Months are stored as an exact
                        multiple of the rent instead. */}
                    {!share && (
                      <td>
                        {/* AND THE UNIT AGREES WITH THE NUMBER BESIDE IT.
                            Matt, 2026-10-03: "'1 months' rent' should be '1
                            month's rent' when the number is 1." The row is a
                            number input and a unit dropdown read as one
                            phrase, and the dropdown was a fixed plural, so a
                            standard deal -- the commonest one there is --
                            read "1 months' rent". feeBasisWords has had this
                            rule since it was written; the control did not. */}
                        <select className="sel" value={b.unit} onChange={(e) => setBand(i, { unit: e.target.value as FeeBasisUnit })} aria-label={`Band ${i + 1} unit`}>
                          <option value="weeks">{Number(b.weeks) === 1 ? 'week’s rent' : 'weeks’ rent'}</option>
                          <option value="months">{Number(b.weeks) === 1 ? 'month’s rent' : 'months’ rent'}</option>
                        </select>
                      </td>
                    )}
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
              {!share && <>One month’s rent is our standard; 3 weeks and 5 weeks are the usual negotiated prices. </>}
              Leave <b>&lsquo;to&rsquo;</b> empty on the last row to mean &ldquo;and above&rdquo;.
            </p>

            {model === 'tiered' && (
              <>
                <div className="agr-sect">Commission by volume</div>
                <p className="agr-hint agr-hint--lead">
                  How much we pay as they send more. For example: referrals 1 to 50 at 20%,
                  51 and over at 25%. Leave <b>&lsquo;to&rsquo;</b> empty on the last row to mean
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
            /* "23 Sep 2026", NOT "2026-09-23". Matt (w): "Agency deal dialog:
               dates as '23 Sep 2026', not '2026-09-23'."

               `periodStart` is `effective_from` straight off the row, so
               this printed the database's own spelling at the reader. The
               shared formatter takes a bare YYYY-MM-DD apart rather than
               parsing it, which matters here: `new Date('2026-10-01')` is
               midnight UTC and reads as 30 September once the clocks go
               back, so a deal would appear to start the day before it did. */
            ? <>Agreed on <b>{live.periodStart ? formatDate(live.periodStart) : 'the day it was signed'}</b>. Saving replaces it from today; choose <b>Standard terms</b> to end it. A deal cannot be dated in the future, so enter it on the day it starts.</>
            : <>This starts today and runs until it is ended or replaced. A deal cannot be dated in the future, so enter it on the day it starts.</>}
        </p>
      </Modal>

      {/* IS THAT A TENANT COUNT OR A REFERRAL VOLUME? Named after the
          question it asks rather than after the rule it enforces, because
          the answer "yes, five tenants" is a perfectly good one and the
          dialog must not read as a telling-off. */}
      {tenantWarn && (
        <Modal
          open
          onClose={() => setTenantWarn(null)}
          width={560}
          title={plural(tenantWarn.length, 'Is that a tenant count?', 'Are those tenant counts?')}
          footer={<>
            <Button variant="ghost" onClick={() => setTenantWarn(null)} disabled={busy}>
              Go back and change it
            </Button>
            <Button variant="dark" disabled={busy}
              onClick={() => { setTenantWarn(null); void save(false, false, true); }}>
              Yes, save it
            </Button>
          </>}
        >
          <p className="agr-confirm">
            This deal prices by the number of TENANTS on one tenancy, and you have entered{' '}
            <b>{tenantWarn.join(', ')}</b>. A tenancy with more than {TENANT_BAND_WARN_ABOVE} people on
            it is unusual.
          </p>
          <p className="agr-hint">
            If you meant the number of REFERRALS they send, go back and choose{' '}
            <b>Price by number of REFERRALS they send</b> instead. If you really do mean a
            tenancy that size, save it.
          </p>
        </Modal>
      )}

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
