/* =====================================================================
   The tenant journey.

   SIX TABS, as the process document specifies: Your details, ID check,
   Financials, Documents, Payment, Your guarantee. The first is where the long
   form lives and carries its own steps: Property, About you, Address history,
   Income, Nationality, Declaration.

   THREE THINGS THIS IS BUILT AROUND, beyond the fields.

   1. It saves when they continue, and only then. Each step's button writes that
      step; nothing autosaves behind them. A half-finished value never reaches a
      database that only accepts finished ones, which was the cause of every
      "Could not save". A failed save is shown against the step, and they press
      the button again.

   2. It does not feel its length. Progress is per step and in the header, every
      step is reachable in any order rather than gated behind the one before,
      and the address history shows how much of the three years is covered so
      the end is visible from the middle.

   3. It never asks twice. Name, email and phone come from signup. The tenancy
      start date is captured once on Property and shown read-only on
      Declaration, where the legacy form asked for it a second time. The rent is
      entered once and referenced everywhere else.
   ===================================================================== */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { FieldList } from './FieldInput';
import {
  ADDITIONAL_INCOME_TYPES, AGENT_FIELDS, BASIC_FIELDS,
  EMPLOYMENT_TYPES, NATIONALITY_FIELDS, PROPERTY_FIELDS, REQUIRED_BANK_STATEMENTS, REQUIRED_HISTORY_MONTHS, SITUATION_COPY,
  addressFields, additionalIncomeFields, employmentFields, fieldsComplete, firstMissingField, historyMonths, incomeDocKinds,
} from '@/tenant/formSpec';
import * as api from '@/tenant/tenantApi';
import { currentTenant } from '@/tenant/tenantAuth';
import { TenantShell, type TenantNavItem } from './TenantShell';
import { ApplicationStatus, statusView, type StatusView } from './ApplicationStatus';
import { DocUpload, FinancialsPanel, ID_CHECK_ENABLED, IdCheckPanel, ProofUpload, StepFooter } from './Sections';
import { RevealMissingContext } from './reveal';
import { SUPABASE_ENABLED } from '@/lib/supabase';
import { useTenantDocumentTitle } from '@/hooks/useDocumentTitle';
import { formatLongDate } from '@/lib/format';
import { Field } from '@/components/ui/Field';
import './Apply.css';

type Tab = 'details' | 'id' | 'financials' | 'guarantee';
type Step = 'property' | 'about' | 'fee' | 'address' | 'income' | 'nationality' | 'declaration';
/* The post-payment return is a STATE, not a route: land here deterministically
   after Checkout rather than wherever a fresh mount defaults to. */
type PayReturn = 'none' | 'confirming' | 'confirmed' | 'stuck';

const TABS: { id: Tab; label: string }[] = [
  { id: 'details', label: 'Your details' },
  { id: 'id', label: 'ID check' },
  { id: 'financials', label: 'Financials' },
  { id: 'guarantee', label: 'Your guarantee' },
];

/* THE ORDER IS THE PRODUCT DECISION, not a layout one.
   Basic details, then the fee, then the rest. The fee sits there because that
   is when somebody has committed enough to be worth charging and before the
   bulk of the typing, and because referencing them is what costs us. Everything
   after it is LOCKED until it clears, and the lock is in SQL as well as here. */
const STEPS: { id: Step; label: string; icon: TenantNavItem['icon'] }[] = [
  { id: 'property',     label: 'Property',        icon: 'home' },
  { id: 'about',        label: 'About you',       icon: 'users' },
  { id: 'fee',          label: 'Application fee',  icon: 'building' },
  { id: 'address',      label: 'Address history', icon: 'org' },
  { id: 'income',       label: 'Paying the rent', icon: 'trend' },
  { id: 'nationality',  label: 'Nationality',     icon: 'shield' },
  { id: 'declaration',  label: 'Declaration',     icon: 'pen' },
];

const TAB_ICON: Record<Tab, TenantNavItem['icon']> = {
  details: 'edit', id: 'eye', financials: 'trend',
  guarantee: 'shield',
};

/** Everything after the fee. Locked until it clears. */
const LOCKED_UNTIL_PAID: Step[] = ['address', 'income', 'nationality', 'declaration'];

/* The one order the whole journey runs in, and the order the sidebar lists it: the
   detail steps, then the before-you-send tabs, then the declaration. Every screen's
   Continue names the NEXT stop here, so after Nationality it weaves through ID check,
   Financials and Documents rather than jumping straight to the Declaration. */
export type Stop = { kind: 'step'; id: Step } | { kind: 'tab'; id: Tab };
export const JOURNEY: Stop[] = [
  { kind: 'step', id: 'property' },
  { kind: 'step', id: 'about' },
  { kind: 'step', id: 'fee' },
  { kind: 'step', id: 'address' },
  { kind: 'step', id: 'income' },
  { kind: 'step', id: 'nationality' },
  { kind: 'tab',  id: 'id' },
  { kind: 'tab',  id: 'financials' },
  { kind: 'step', id: 'declaration' },
];
export const stopLabel = (s: Stop): string =>
  s.kind === 'step'
    ? STEPS.find((st) => st.id === s.id)!.label
    : TABS.find((t) => t.id === s.id)!.label;
/** The label as it reads mid-sentence: lowercased, but the ID acronym kept. */
export const stopPhrase = (s: Stop): string => {
  const l = stopLabel(s);
  return l === 'ID check' ? l : l.toLowerCase();
};

export function Apply() {
  const [tab, setTab] = useState<Tab>('details');
  const [step, setStep] = useState<Step>('property');
  const [bundle, setBundle] = useState<api.ApplicationBundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const appId = bundle?.application.id ?? 'demo-application';

  // Persist the current form step (progress only, never content) so a scoped
  // manager can see how far a mid-way tenant has got. Draft only, and
  // fire-and-forget: it must never block or fail the form.
  useEffect(() => {
    if (!bundle || bundle.application.status !== 'draft') return;
    void api.setStep(bundle.application.id, step).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, bundle?.application.id, bundle?.application.status]);

  // Declared here with the rest of the state, NOT beside the code that uses it.
  // It lived below the `if (!bundle) return` guard, so it did not run on the
  // first render and did on the second: "rendered more hooks than during the
  // previous render", which is a white page. Every hook in this component must
  // sit above every early return.
  const [showAnswers, setShowAnswers] = useState(false);
  const [payReturn, setPayReturn] = useState<PayReturn>(
    () => (new URLSearchParams(window.location.search).get('fee') === 'paid' ? 'confirming' : 'none'),
  );
  const [feeCancelled, setFeeCancelled] = useState(
    () => new URLSearchParams(window.location.search).get('fee') === 'cancelled',
  );
  // Back from the guarantee-fee checkout, landing on the status screen.
  const [guaranteeReturn, setGuaranteeReturn] = useState(
    () => new URLSearchParams(window.location.search).get('paid') === 'guarantee',
  );

  const load = useCallback(async () => {
    try {
      // A tenant with no session gets the front door rather than an error. This
      // page is reachable by URL and by an old bookmark, and "could not load"
      // is the wrong answer to "you are not signed in".
      const me = await currentTenant();
      // A signed-out visitor on the live site goes straight to the one sign-in
      // page, which already offers both sign in and apply, with no interstitial
      // /apply page in between. The demo has no real session, so it falls through
      // to the demo application rather than a sign-in it cannot perform.
      if (!me && SUPABASE_ENABLED) { window.location.href = '/login?tab=tenant'; return; }
      const list = await api.listApplications();
      // A tenant should have one live application. If several exist (a stray draft
      // left beside a submitted one, say), land on the one furthest along its
      // lifecycle, never a newer empty draft over a live application.
      const RANK: Record<string, number> = { deed: 5, paid: 4, sent: 3, referencing: 2, draft: 1 };
      const first = [...list.applications]
        .filter((a) => !['withdrawn', 'expired', 'declined'].includes(a.status))
        .sort((a, b) => (RANK[b.status] ?? 0) - (RANK[a.status] ?? 0))[0]
        ?? list.applications[0];
      // Signed in with nothing started. That is not an error, it is somebody
      // who has an account and has not begun, so send them to the front of the
      // journey rather than telling them their application is missing.
      if (!first) { window.location.href = '/apply/register'; return; }
      const b = await api.getApplication(first.id);
      setBundle(b);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load your application.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Back from Checkout. Strip the one-shot ?fee= param immediately so a refresh
  // cannot re-enter these states, and land a cancelled tenant back on the fee
  // step with the payment still there. The paid path is driven by the polling
  // and confirmation effects below, once feePaid is in scope.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fee = params.get('fee');
    if (fee === 'paid' || fee === 'cancelled' || params.get('paid')) window.history.replaceState({}, '', '/apply');
    if (fee === 'cancelled') setStep('fee');
  }, []);

  /* ---- local mirrors, so typing is instant and the save is behind it ------ */
  const [property, setProperty] = useState<Record<string, unknown>>({});
  const [agent, setAgent] = useState<Record<string, unknown>>({});
  const [profile, setProfile] = useState<Record<string, unknown>>({});
  const [addresses, setAddresses] = useState<Record<string, unknown>[]>([]);
  const [incomes, setIncomes] = useState<Record<string, unknown>[]>([]);
  const seeded = useRef(false);

  useEffect(() => {
    if (!bundle || seeded.current) return;
    seeded.current = true;
    const a = bundle.application;
    setProperty({
      prop_addr1: a.prop_addr1 ?? '', prop_addr2: a.prop_addr2 ?? '', prop_city: a.prop_city ?? '',
      prop_county: a.prop_county ?? '', prop_postcode: a.prop_postcode ?? '',
      monthly_rent: a.monthly_rent ?? '', tenancy_start: a.tenancy_start ?? '',
    });
    setAgent(bundle.agent ?? {});
    setProfile(bundle.profile ?? {});
    setAddresses(bundle.addresses.length ? bundle.addresses : [{ seq: 0 }]);
    setIncomes(bundle.incomes.length ? bundle.incomes : []);
  }, [bundle]);

  const editable = bundle?.editable !== false;
  const feePaid = bundle?.fee_paid === true;
  const locked = (id: Step) => !feePaid && LOCKED_UNTIL_PAID.includes(id);

  // While confirming, POLL for the webhook to record the payment. A single fixed
  // wait was a guess; a slow webhook left a paying tenant on a locked form,
  // which reads as "charged for nothing". Poll for a real bounded wait, then
  // hand off to a "we have your payment" state, never silence and a lock.
  useEffect(() => {
    if (payReturn !== 'confirming') return;
    let stopped = false;
    const start = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (stopped) return;
      seeded.current = false;
      void load();
      const elapsed = Date.now() - start;
      if (elapsed >= 120000) {
        // Two minutes of trying on its own. Hand off to the "we have your
        // payment" state, where Check again is the manual nudge.
        setPayReturn((cur) => (cur === 'confirming' ? 'stuck' : cur));
        return;
      }
      // Fast while it is most likely to land, then a calm background cadence, so
      // a payment that clears thirty seconds late advances without the tenant
      // having to press anything.
      timer = setTimeout(tick, elapsed < 20000 ? 2000 : 8000);
    };
    timer = setTimeout(tick, 0);
    return () => { stopped = true; clearTimeout(timer); };
  }, [payReturn, load]);

  // The webhook has landed. Move to the confirmed state and SET the step, so the
  // "Continue" button lands them on the next section deterministically.
  useEffect(() => {
    if (payReturn === 'confirming' && feePaid) { setPayReturn('confirmed'); setStep('address'); }
  }, [payReturn, feePaid]);

  // Back from the guarantee-fee checkout (?paid=guarantee): poll the same bounded
  // wait as the eligibility fee while the webhook moves the application to paid,
  // so the status screen advances to "ready to sign" on its own.
  useEffect(() => {
    if (!guaranteeReturn) return;
    let stopped = false;
    const start = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (stopped) return;
      seeded.current = false;
      void load();
      if (Date.now() - start >= 120000) return;
      timer = setTimeout(tick, Date.now() - start < 20000 ? 2000 : 8000);
    };
    timer = setTimeout(tick, 0);
    return () => { stopped = true; clearTimeout(timer); };
  }, [guaranteeReturn, load]);
  useEffect(() => {
    const st = bundle?.application.status;
    if (guaranteeReturn && (st === 'paid' || st === 'deed')) setGuaranteeReturn(false);
  }, [guaranteeReturn, bundle]);

  // A status-gated tab can leave the sidebar when the status advances or lapses
  // (Your guarantee shows only once the deed exists, and ID/Financials never show
  // after submission). If the tenant is sitting on one that is no longer offered,
  // send them back to Status rather than stranding them on content the sidebar no
  // longer lists.
  useEffect(() => {
    if (!bundle) return;
    const st = bundle.application.status;
    const allowed = st === 'draft'
      ? ['details', 'id', 'financials']
      : ['details',
         ...(st === 'deed' ? ['guarantee'] : [])];
    if (!allowed.includes(tab)) setTab('details');
  }, [bundle, tab]);

  // Saving happens when a step's button is pressed, never behind the tenant.
  // A failed save is recorded here and shown against the step, not swallowed.
  const [stepError, setStepError] = useState<string | null>(null);

  // The keys of a field group that are actually present, so a step writes only
  // its own answers and never nulls one it does not carry.
  const sliceProfile = (fields: { name: string }[]): Record<string, unknown> =>
    Object.fromEntries(fields.map((f) => f.name).filter((k) => k in profile).map((k) => [k, profile[k]]));

  const saveStep = async (s: Step): Promise<boolean> => {
    setStepError(null);
    try {
      if (s === 'property') { await api.saveProperty(appId, property); await api.saveAgent(appId, agent); }
      else if (s === 'about') { await api.saveProfile(appId, sliceProfile(BASIC_FIELDS)); }
      else if (s === 'address') { for (const r of addresses) await api.saveRow(appId, 'addresses', Number(r.seq), r); }
      else if (s === 'income') { for (const r of incomes) await api.saveRow(appId, 'incomes', Number(r.seq), r); }
      else if (s === 'nationality') { await api.saveProfile(appId, sliceProfile(NATIONALITY_FIELDS)); }
      else if (s === 'declaration') {
        // The tick is sent as declared_true; the server stamps declared_at.
        await api.saveProfile(appId, {
          declared_name: profile.declared_name ?? '',
          declared_true: !!profile.declared_at,
          declaration_note: profile.declaration_note ?? '',
        });
      }
      return true;
    } catch (e) {
      setStepError(e instanceof Error ? e.message : 'Could not save. Please try again.');
      return false;
    }
  };

  // Every data-bearing step at once, for the two moments that need all of it:
  // paying the fee and sending. Idempotent, so re-saving a step already written
  // by its own button costs nothing.
  const saveAll = async (): Promise<boolean> => {
    for (const s of ['property', 'about', 'address', 'income', 'nationality', 'declaration'] as Step[]) {
      if (!(await saveStep(s))) return false;
    }
    return true;
  };

  // Navigation no longer saves: a step is kept only when its own button is
  // pressed. A locked step still routes to the fee rather than doing nothing.
  // Revealed by a blocked Continue press: required-but-empty fields on the current
  // step show themselves as missing. Reset whenever the step changes.
  const [reveal, setReveal] = useState(false);
  const goStep = (s: Step) => { setStepError(null); setReveal(false); setStep(locked(s) ? 'fee' : s); };
  // Pressing a blocked Continue reveals the missing fields and scrolls to the first
  // one, so the reason the press did nothing is on the field, not only in the footer.
  const revealMissing = () => {
    setReveal(true);
    requestAnimationFrame(() => {
      const el = document.querySelector('.ap-panel .field.is-invalid, .ap-panel .ap-proof.is-invalid');
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.remove('is-flash'); void el.offsetWidth; el.classList.add('is-flash');
      }
    });
  };
  const goTab = (t: Tab) => {
    setStepError(null);
    // ID check and Financials sit behind the £20 fee, the same as the
    // address/income/nationality steps: a locked tab bounces to the fee step.
    if (!feePaid && (t === 'id' || t === 'financials')) { setTab('details'); setStep('fee'); return; }
    setTab(t);
  };

  /* ---- rows ------------------------------------------------------------- */
  // Local only. Rows are written when the step's Save and continue is pressed.
  const setAddressField = (seq: number, name: string, v: unknown) => {
    setAddresses((rows) => rows.map((r) => (Number(r.seq) === seq ? { ...r, [name]: v } : r)));
  };
  // A proof of address is stored against its address row, so the row must exist in
  // the database (have an id) before the file can attach to it. This saves the row
  // if it has none yet and returns the id, the same "create the row so a document
  // can attach" move addIncome makes. The typed fields still write on continue.
  const ensureAddressId = async (seq: number): Promise<string | null> => {
    const row = addresses.find((r) => Number(r.seq) === seq);
    if (row?.id) return String(row.id);
    const res = await api.saveRow(appId, 'addresses', seq, row ?? { seq });
    const id = (res as { id?: string | null } | undefined)?.id ?? null;
    if (id) setAddresses((rs) => rs.map((r) => (Number(r.seq) === seq ? { ...r, id } : r)));
    return id;
  };
  const setIncomeField = (seq: number, name: string, v: unknown) => {
    setIncomes((rows) => rows.map((r) => (Number(r.seq) === seq ? { ...r, [name]: v } : r)));
  };

  // Adding an income creates its row now, so a document can attach to it. The
  // typed amounts are still written when the step's button is pressed; only the
  // id is needed early, and it is captured here for the document link.
  const addIncome = async (additional: boolean) => {
    const seq = (incomes.at(-1)?.seq as number ?? -1) + 1;
    setIncomes((rs) => [...rs, { seq, is_additional: additional }]);
    try {
      const r = await api.saveRow(appId, 'incomes', seq, { is_additional: additional });
      const id = (r as { id?: string } | undefined)?.id;
      if (id) setIncomes((rs) => rs.map((row) => (Number(row.seq) === seq ? { ...row, id } : row)));
    } catch { /* the row's fields are written with the rest of the step on continue */ }
  };

  const months = useMemo(() => historyMonths(addresses), [addresses]);
  const historyPct = Math.min(100, Math.round((months / REQUIRED_HISTORY_MONTHS) * 100));

  // The proof of address for a row: a document stored against that address, so
  // one address's proof never counts for another. A row with no id yet (not saved)
  // can have no proof.
  const proofDocFor = (row: Record<string, unknown>) => {
    const rid = row.id ? String(row.id) : null;
    return rid ? (bundle?.documents ?? []).find((d) => d.kind === 'proof_of_address' && d.address_id === rid) ?? null : null;
  };
  // A row is complete only when its fields are filled AND its proof is uploaded,
  // so proof is enforced exactly like every other required field. proof_type is
  // itself a required field now, so fieldsComplete already covers "chose the type".
  const addrComplete = (row: Record<string, unknown>, i: number) =>
    fieldsComplete(addressFields(i === 0), row) && !!proofDocFor(row);

  // The first address row that is not complete (rows are current-first), so the
  // footer names what it needs and the "add earlier" offer waits until EVERY row
  // is done. historyMonths counts dates alone, so a row can reach 36 months while
  // a field is blank; keying on completeness across all rows keeps the copy honest.
  const firstIncompleteAddrIdx = addresses.findIndex((row, i) => !addrComplete(row, i));
  const allAddrsComplete = addresses.length > 0 && firstIncompleteAddrIdx === -1;
  // What that row still needs, named the way the other fields are: a missing form
  // field (proof_type included), or the document itself once the fields are done.
  const incompleteAddrMissing: string | null = (() => {
    if (firstIncompleteAddrIdx < 0) return null;
    const row = addresses[firstIncompleteAddrIdx];
    const missing = firstMissingField(addressFields(firstIncompleteAddrIdx === 0), row);
    if (missing) return missing.label;
    if (!proofDocFor(row)) return 'Proof of address document';
    return null;
  })();

  /* ---- progress ---------------------------------------------------------
     Counted from what is actually answered rather than from which tabs have
     been visited, so it cannot say 80% while eight fields are empty. */
  const stepDone = useMemo((): Record<Step, boolean> => ({
    // Counted from the answered questions, not a proxy. property needs the
    // property fields AND the delivery contact (agency name for an agent, a
    // surname for a landlord, an email either way), which the old check missed.
    property: fieldsComplete(PROPERTY_FIELDS, property) && fieldsComplete(AGENT_FIELDS, agent),
    about: fieldsComplete(BASIC_FIELDS, profile),
    fee: feePaid,
    // Three years of history AND every address complete: fields filled (including
    // the required proof type) and the proof document uploaded for each one.
    address: months >= REQUIRED_HISTORY_MONTHS && allAddrsComplete,
    // A main income that is actually filled in, not just a row with a type.
    income: incomes.length > 0 && incomes.some((i) => !i.is_additional)
            && incomes.every((row) => !!row.income_type && fieldsComplete(
                 row.is_additional ? additionalIncomeFields(String(row.income_type))
                                   : employmentFields(String(row.income_type)), row)),
    nationality: fieldsComplete(NATIONALITY_FIELDS, profile),
    declaration: !!profile.declared_name && !!profile.declared_at,
  }), [property, agent, profile, months, addresses, incomes, feePaid, allAddrsComplete]);

  const doneCount = Object.values(stepDone).filter(Boolean).length;
  // Financials is required: three months of bank statements. Open banking is off,
  // so this is the only route. Any bank_statement doc counts (income-step uploads
  // included), so a tenant is never asked for the same statements twice.
  const financialsDone = (bundle?.documents ?? []).some((d) => d.kind === 'bank_connection')
    || (bundle?.documents ?? []).filter((d) => d.kind === 'bank_statement').length >= REQUIRED_BANK_STATEMENTS;
  // The other sections still to finish, shown on the final screen as a
  // blocker. The declaration itself is excluded: its fields are right there.
  // ID check runs on the partner's credentials, not in this repo, so it cannot
  // complete yet: no done-signal, no upload route. It must still show as
  // outstanding rather than vanish, so it is listed with a note. A noted row is
  // shown but does NOT gate Send (the tenant cannot act on it). When
  // ID_CHECK_ENABLED is flipped true it drops the note and gates on idDone like
  // the rest; wire idDone to the vendor's completion signal at that point.
  const idDone = false;
  const missing: { label: string; go: () => void; note?: string }[] = [
    ...STEPS.filter((st) => st.id !== 'declaration' && !stepDone[st.id]).map((st) => ({ label: st.label, go: () => goStep(st.id) })),
    ...(financialsDone ? [] : [{ label: 'Financials', go: () => goTab('financials') }]),
    ...(ID_CHECK_ENABLED
         ? (idDone ? [] : [{ label: 'ID check', go: () => goTab('id') }])
         : [{ label: 'ID check', go: () => goTab('id'), note: 'Not switched on yet. We will come back to you.' }]),
  ];
  // Send gets the same press-reveal as the step Continues: pressable while blocked,
  // but a press scrolls to and flashes the reason (the unfinished list, or the
  // signature) rather than doing nothing.
  const sendBlockRef = useRef<HTMLDivElement>(null);
  const signRef = useRef<HTMLDivElement>(null);
  // Send is gated by the rows a tenant can actually finish: those WITHOUT a note.
  // A noted row (ID check today) is outstanding but not a blocker.
  const blocking = missing.some((m) => !m.note);
  const canSend = !blocking && stepDone.declaration;
  const revealSend = () => {
    const el = blocking ? sendBlockRef.current : signRef.current;
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.remove('is-flash'); void el.offsetWidth; el.classList.add('is-flash'); }
  };
  const sumLine = (k: string, v: unknown) =>
    v ? <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div> : null;

  const payFee = async () => {
    setBusy(true); setErr(null);
    // The fee buys the rest of the form, so the property and About answers have
    // to be on the server before we take the payment.
    if (!(await saveStep('property')) || !(await saveStep('about'))) {
      setErr('We could not save your answers. Please try again.'); setBusy(false); return;
    }
    try {
      const url = await api.startFeePayment(appId);
      // A URL means Stripe. No URL means it was already paid, or mock mode,
      // and either way the answer is to reload and let the lock lift.
      if (url) { window.location.href = url; return; }
      await load(); seeded.current = false; setStep('address');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start the payment.');
    } finally { setBusy(false); }
  };

  const submit = async () => {
    setBusy(true); setErr(null);
    if (!(await saveAll())) {
      setErr('We could not save your answers. Please try again.'); setBusy(false); return;
    }
    const r = await api.submitApplication(appId);
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? 'Could not submit.'); return; }
    await load(); seeded.current = false;
    setStep('declaration');
  };

  /* The tab title follows the journey. /apply set none, so after registration
     it kept "Check your email" from the code screen and never moved as the
     tenant went step to step. Derived from tab and step, which exist before the
     loading and signed-out guards below, so the hook stays unconditional. */
  const journeyTitle =
    tab === 'details'
      ? (bundle && bundle.application.status !== 'draft'
          ? 'Status'
          : STEPS.find((st) => st.id === step)?.label ?? 'Your application')
      : TABS.find((t) => t.id === tab)?.label ?? 'Your application';
  useTenantDocumentTitle(journeyTitle);

  if (err && !bundle) return <div className="ap"><div className="ap-alert">{err}</div></div>;
  if (!bundle) return <div className="ap"><p className="soft">Loading your application…</p></div>;

  // The answer to "Who manages the property?", so a terminal message can name
  // the right party instead of assuming a letting agent.
  const view: StatusView = (guaranteeReturn && bundle.application.status === 'sent')
    // Do not flash "Approved, pay" at a tenant who has just paid while the webhook
    // is still settling. This clears itself once the status reaches paid.
    ? {
        reached: 5, terminated: false, tone: 'waiting',
        headline: 'Confirming your payment',
        detail: 'Thank you. We are confirming your payment now. This page updates on its own, so there is nothing you need to do.',
      }
    : statusView(bundle.application.status, feePaid, doneCount, STEPS.length,
        (bundle.agent as { kind?: string } | null)?.kind ?? null, bundle.application.deed_state);

  /* ONCE IT IS SENT, THE FORM FOLDS AWAY.
     Everything before submission is about filling something in; everything
     after is about waiting, paying and receiving. Leaving seven form steps in
     the sidebar of somebody who has finished implies there is still something
     to do, and the one honest answer at that point is "nothing, we will email
     you". The answers are still readable, behind one link, because somebody who
     is waiting does sometimes want to check what they said. */
  const submitted = bundle.application.status !== 'draft';

  const payGuarantee = async () => {
    // A direct tenant pays FROM the portal. This reuses the referral pay page's
    // one checkout implementation (payment-page), but asks for a portal return,
    // so Stripe lands them back on their own status screen at /apply, not on /pay.
    setBusy(true); setErr(null);
    try {
      const url = await api.guaranteeCheckoutUrl(appId);
      if (url) { window.location.href = url; return; }
      setErr('Payment is not available in this demo. Use the demo controls to see what follows.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not open the payment page.');
    } finally { setBusy(false); }
  };

  // Sign the deed from the status screen (a PandaDoc signing session), until it
  // is signed. Not only on the Stripe return page.
  const onSignDeed = async () => {
    setBusy(true); setErr(null);
    try {
      const url = await api.signDeedLink(appId);
      if (url) { window.location.href = url; return; }
      setErr('We could not open the signing session. We will email your signing link shortly.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'We could not open the signing session.');
    } finally { setBusy(false); }
  };

  // View or download the executed deed once the guarantee is in place.
  const onViewDeed = async () => {
    setBusy(true); setErr(null);
    try {
      const url = await api.tenantDeedUrl(appId);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The deed is not ready to download yet.');
    } finally { setBusy(false); }
  };

  /* The step footer needs to know where "next" goes and what is outstanding.
     Order comes from STEPS, so inserting a step does not need this updated. */
  const stepIndex = STEPS.findIndex((st) => st.id === step);
  // The next stop in the JOURNEY, not just the next STEP: after Nationality that is the
  // ID check tab, so the Continue chain reads in the same order as the sidebar.
  const journeyIdx = JOURNEY.findIndex((s) => s.kind === 'step' && s.id === step);
  const nextStop = journeyIdx >= 0 ? JOURNEY[journeyIdx + 1] : undefined;
  const goStop = (s: Stop) => { if (s.kind === 'tab') goTab(s.id); else { setTab('details'); goStep(s.id); } };
  // Every step's blocker names the field its own completeness check flags, the
  // way the address step already does, so the footer can never claim a filled
  // field is missing (dob and phone were, when only the adverse-credit answer
  // was). firstMissingField shares fieldsComplete's logic, and so stepDone's, so
  // the message and the gate can never disagree.
  const stillNeeded = (f: ReturnType<typeof firstMissingField>): string | null =>
    f ? (f.label.trim().endsWith('?')
          ? `We still need an answer to: ${f.label}`
          : `${f.label} is still needed.`)
      : null;
  const propertyMissing = firstMissingField(PROPERTY_FIELDS, property) ?? firstMissingField(AGENT_FIELDS, agent);
  const incompleteIncome = incomes.find((row) => !row.income_type || !fieldsComplete(
    row.is_additional ? additionalIncomeFields(String(row.income_type)) : employmentFields(String(row.income_type)), row));
  const incomeMissing = incompleteIncome && incompleteIncome.income_type
    ? firstMissingField(
        incompleteIncome.is_additional ? additionalIncomeFields(String(incompleteIncome.income_type)) : employmentFields(String(incompleteIncome.income_type)),
        incompleteIncome)
    : null;
  const OUTSTANDING: Record<Step, string> = {
    property: stillNeeded(propertyMissing) ?? 'Add the property, the rent, the start date and who manages it.',
    about: stillNeeded(firstMissingField(BASIC_FIELDS, profile)) ?? 'We still need a couple of details.',
    fee: 'The fee unlocks the rest of the form.',
    address: !allAddrsComplete
      ? `Finish your ${firstIncompleteAddrIdx === 0 ? 'current' : 'previous'} address: ${incompleteAddrMissing ?? 'a required field'} is still needed.`
      : `We need three years. You have given us ${months} month${months === 1 ? '' : 's'}, so add where you lived before this one.`,
    income: incomes.length === 0 || !incomes.some((i) => !i.is_additional)
      ? 'Tell us how you will be paying the rent and the amounts for your main source.'
      : incompleteIncome && !incompleteIncome.income_type
        ? 'Choose a type for every income source you have added.'
        : stillNeeded(incomeMissing) ?? 'Fill in the amounts for your income.',
    nationality: stillNeeded(firstMissingField(NATIONALITY_FIELDS, profile)) ?? 'Tell us your nationality and which description fits you.',
    declaration: !profile.declared_name
      ? 'We still need your name on the declaration.'
      : !profile.declared_at ? 'Tick the box to confirm the declaration.' : 'Confirm your name and tick the declaration.',
  };

  const goNext = async () => {
    setBusy(true);
    const ok = await saveStep(step);
    setBusy(false);
    if (ok && nextStop) goStop(nextStop);
  };

  const footer = (id: Step) => (
    <StepFooter
      done={stepDone[id]}
      outstanding={OUTSTANDING[id]}
      nextLabel={nextStop ? `Save and continue to ${stopPhrase(nextStop)}` : null}
      onNext={() => void goNext()}
      onBack={stepIndex > 0 ? () => goStep(STEPS[stepIndex - 1].id) : undefined}
      isLast={!nextStop}
      busy={busy}
      saveError={stepError}
      onBlocked={revealMissing}
    />
  );

  // The before-you-send tabs get the same Continue, weaving forward (ID check ->
  // Financials -> Documents -> Declaration) and back. Their uploads save as they
  // happen, so it reads "Continue to", not "Save and continue to".
  const tabFooter = (t: Tab) => {
    const idx = JOURNEY.findIndex((s) => s.kind === 'tab' && s.id === t);
    const next = JOURNEY[idx + 1];
    const prev = JOURNEY[idx - 1];
    return (
      <StepFooter
        done
        nextLabel={next ? `Continue to ${stopPhrase(next)}` : null}
        onNext={() => { if (next) goStop(next); }}
        onBack={prev ? () => goStop(prev) : undefined}
        isLast={!next}
      />
    );
  };

  const shellNav = submitted
    ? [{
        group: 'Your application',
        items: [
          { id: 'details', label: 'Status', icon: 'dashboard' as const, done: true },
          // Your guarantee appears once the deed exists. Pay, Sign and View all live
          // on the Status card, so there is no separate Payment item. No Documents
          // surface after submission either: the eligibility check asks the tenant
          // for anything further directly, not through the portal.
          ...(bundle.application.status === 'deed'
            ? [{ id: 'guarantee', label: 'Your guarantee', icon: TAB_ICON['guarantee'] }] : []),
        ],
      }]
    : [
        {
          group: 'Your application',
          items: STEPS.filter((st) => st.id !== 'declaration').map((st) => ({
            id: `details:${st.id}`, label: st.label, icon: st.icon,
            done: stepDone[st.id], locked: locked(st.id),
          })),
        },
        {
          group: 'Before you send',
          items: TABS.filter((t) => t.id === 'id' || t.id === 'financials')
            .map((t) => ({ id: t.id, label: t.label, icon: TAB_ICON[t.id], done: t.id === 'financials' ? financialsDone : undefined, locked: !feePaid })),
        },
        {
          // Declaration is the review and the signature, so it sits AFTER the work
          // to finish, as the last thing a tenant does.
          group: 'Review and send',
          items: [{ id: 'details:declaration', label: 'Declaration', icon: 'pen' as const, done: stepDone.declaration, locked: locked('declaration') }],
        },
      ];

  const activeNav = tab === 'details' ? (submitted ? 'details' : `details:${step}`) : tab;
  const currentLabel = tab === 'details'
    ? (submitted ? 'Status' : STEPS.find((st) => st.id === step)?.label ?? 'Your details')
    : TABS.find((t) => t.id === tab)?.label ?? '';

  return (
    <TenantShell
      nav={shellNav}
      active={activeNav}
      onNavigate={(id) => {
        // Navigating away from the payment-return takeover dismisses it, so the
        // sidebar is never trapped behind the confirmed/confirming panel.
        setPayReturn('none');
        if (id.startsWith('details:')) { setTab('details'); void goStep(id.slice(8) as Step); }
        else void goTab(id as Tab);
      }}
      name={[profile.first_name, profile.last_name].filter(Boolean).join(' ')}
      email={String(bundle.application.tenant_email ?? '')}
      title={currentLabel}
      crumbs={['Your application', currentLabel]}
    >
      <div className="page-head">
        <div>
          <h1 className="page-head__title">{currentLabel}</h1>
          <p className="page-head__sub">
            {submitted
              ? 'Where your application is up to.'
              : `${bundle.application.guarantee_ref} · Each section is saved when you continue, so you can stop and come back.`}
          </p>
        </div>
      </div>

      {/* The five-stage lifecycle timeline only moves from submission onwards; on
          a draft it reads "1 of 5" however much of the form is done and fights
          the sidebar ticks. Show it once it carries real information. */}
      {submitted && (
        <ApplicationStatus
          view={view}
          guaranteeRef={bundle.application.guarantee_ref}
          onPayGuarantee={view.cta === 'pay_guarantee' ? () => void payGuarantee() : undefined}
          onSignDeed={view.cta === 'sign_deed' ? () => void onSignDeed() : undefined}
          onViewDeed={view.cta === 'view_deed' ? () => void onViewDeed() : undefined}
          busy={busy}
        />
      )}

      {!SUPABASE_ENABLED && (
        <div className="apdemo">
          <p className="apdemo__title">Demo controls</p>
          <p className="ap-p" style={{ marginBottom: 0 }}>
            The states after submission are driven by the eligibility check, Stripe and PandaDoc,
            none of which exist here. These jump straight to them so the whole journey can be walked.
            They do nothing against a real database.
          </p>
          <div className="apdemo__row">
            {([
              ['draft', 'Back to in progress'],
              ['referencing', 'Submitted, awaiting decision'],
              ['sent', 'Approved'],
              ['declined', 'Declined'],
              ['paid', 'Guarantee fee paid'],
              ['deed', 'Guarantee issued'],
            ] as const).map(([st, label]) => (
              <Button key={st} variant="quiet" size="sm"
                onClick={async () => { await api.demoSetStatus(st); seeded.current = false; await load(); }}>
                {label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {err && <div className="ap-alert" role="alert">{err}</div>}

      {tab === 'details' && submitted && (
        <ReadOnlyAnswers
          open={showAnswers}
          onToggle={() => setShowAnswers((v) => !v)}
          property={property} agent={agent} profile={profile}
          addresses={addresses} incomes={incomes} />
      )}

      {tab === 'details' && !submitted && payReturn !== 'none' && (
        <PaymentReturn
          state={payReturn}
          onContinue={() => { setPayReturn('none'); void goStep('address'); }}
          onCheckAgain={() => setPayReturn('confirming')}
        />
      )}

      {tab === 'details' && !submitted && payReturn === 'none' && (
        <div className="ap-body ap-body--full">
          <aside className="ap-steps ap-steps--hidden" aria-label="Your details, steps">
            {STEPS.map((s) => (
              <button key={s.id} type="button"
                className={`ap-step${s.id === step ? ' is-active' : ''}${stepDone[s.id] ? ' is-done' : ''}${locked(s.id) ? ' is-locked' : ''}`}
                onClick={() => void goStep(s.id)}>
                <span className="ap-step__tick" aria-hidden="true">
                  {stepDone[s.id] ? <Icon name="check" /> : locked(s.id) ? <Icon name="lock" /> : null}
                </span>
                {s.label}
              </button>
            ))}
            <p className="ap-hint">
              {feePaid
                ? 'Each section is saved when you press continue.'
                : 'Fill in the first two, then the application fee unlocks the rest.'}
            </p>
          </aside>

          <RevealMissingContext.Provider value={reveal}>
          <div className="ap-panel">
            {step === 'property' && (
              <Card><CardHead title="The property you are renting" /><CardBody>
                <FieldList fields={PROPERTY_FIELDS} values={property} disabled={!editable}
                  onChange={(n, v) => setProperty((p) => ({ ...p, [n]: v }))} />
                <h3 className="ap-h3">Who manages it?</h3>
                <p className="ap-p">
                  We send the finished Deed of Guarantee to whoever manages the property.
                  We do not contact them before that.
                </p>
                <FieldList fields={AGENT_FIELDS} values={agent} disabled={!editable}
                  onChange={(n, v) => setAgent((p) => ({ ...p, [n]: v }))} />
                {editable && footer('property')}
              </CardBody></Card>
            )}

            {step === 'about' && (
              <Card><CardHead title="About you" /><CardBody>
                <p className="ap-p">
                  We have your name and number from when you signed up. Change them here if they are wrong.
                </p>
                <FieldList fields={BASIC_FIELDS} values={profile} disabled={!editable}
                  onChange={(n, v) => setProfile((p) => ({ ...p, [n]: v }))} />
                {editable && footer('about')}
              </CardBody></Card>
            )}

            {step === 'fee' && (
              <Card><CardHead title="Application fee" /><CardBody>
                {feePaid ? (
                  <>
                    <div className="ap-pre ap-pre--ok">
                      <strong>Paid.</strong> The rest of your application is unlocked.
                    </div>
                    <p className="ap-p">
                      Nothing has been sent for checking yet. That happens when you have
                      finished the remaining sections and press send.
                    </p>
                    <div className="ap-actions">
                      <Button variant="primary" onClick={() => void goStep('address')}>Continue to address history</Button>
                    </div>
                  </>
                ) : (
                  <>
                    {feeCancelled && (
                      <div className="ap-pre">
                        No payment was taken. You can pay whenever you are ready, and nothing has changed.
                      </div>
                    )}
                    <p className="ap-p">
                      <strong>£20, once.</strong> It covers the eligibility check on your application,
                      and it is not the guarantee fee. If you are approved, the guarantee itself is one month&rsquo;s
                      rent and we will tell you before anything is due.
                    </p>
                    <p className="ap-p">
                      We ask for it now because the next step is the long one, and because the
                      eligibility check is what costs us. Nothing is sent until this clears.
                    </p>
                    <ul className="ap-list">
                      <li>The sections after this unlock as soon as it goes through.</li>
                      <li>You can still stop and come back at any point.</li>
                      <li>It is not refunded if the reference comes back declined, so read the
                          two sections above once more if you are unsure.</li>
                    </ul>
                    {!stepDone.property || !stepDone.about ? (
                      <div className="ap-pre ap-pre--wait">
                        Finish <strong>Property</strong> and <strong>About you</strong> first.
                        We would rather you did not pay for an application that is missing something.
                      </div>
                    ) : null}
                    <div className="ap-actions">
                      <Button variant="primary"
                        disabled={busy || !stepDone.property || !stepDone.about}
                        onClick={() => { setFeeCancelled(false); void payFee(); }}>
                        {busy ? 'Taking you to payment…' : 'Pay £20 and continue'}
                      </Button>
                    </div>
                  </>
                )}
              </CardBody></Card>
            )}

            {step === 'address' && (
              <Card><CardHead title="Where you have lived" /><CardBody>
                <div className="ap-hist">
                  <div className="ap-progress__bar"><span style={{ width: `${historyPct}%` }} /></div>
                  <p className="ap-p">
                    {!allAddrsComplete
                      ? <>Finish this address first. We work out the coverage once it is complete.</>
                      : months >= REQUIRED_HISTORY_MONTHS
                        ? <>That is the full three years. Thank you.</>
                        : <>We need three years. You have given us <strong>{months} month{months === 1 ? '' : 's'}</strong>, so add
                           where you lived before this one.</>}
                  </p>
                </div>
                {addresses.map((row, i) => (
                  <section key={String(row.seq)} className="ap-row">
                    <header className="ap-row__head">
                      <h3 className="ap-h3">{i === 0 ? 'Current address' : `Previous address ${i}`}</h3>
                      {i > 0 && editable && (
                        <Button variant="ghost" size="sm"
                          onClick={() => {
                            setAddresses((rs) => rs.filter((r) => r.seq !== row.seq));
                            void api.deleteRow(appId, 'addresses', Number(row.seq));
                          }}>Remove</Button>
                      )}
                    </header>
                    <FieldList fields={addressFields(i === 0)} values={row} disabled={!editable}
                      onChange={(n, v) => setAddressField(Number(row.seq), n, v)}
                      after={
                        <ProofUpload applicationId={appId} documents={bundle.documents}
                          addressId={row.id ? String(row.id) : null}
                          ensureId={() => ensureAddressId(Number(row.seq))}
                          editable={editable} onChanged={() => load()} />
                      } />
                  </section>
                ))}
                {editable && allAddrsComplete && months < REQUIRED_HISTORY_MONTHS && (
                  <Button variant="quiet"
                    onClick={() => setAddresses((rs) => [...rs, { seq: (rs.at(-1)?.seq as number ?? -1) + 1 }])}>
                    <Icon name="plus" /> Add an earlier address
                  </Button>
                )}
                {editable && footer('address')}
              </CardBody></Card>
            )}

            {step === 'income' && (
              <Card><CardHead title="How you'll pay the rent" /><CardBody>
                <p className="ap-p">
                  Pick your situation and we'll only ask what fits.
                  {property.monthly_rent ? <> The rent here is £{String(property.monthly_rent)} a month.</> : null}
                </p>
                {incomes.map((row) => {
                  const type = String(row.income_type ?? '');
                  const additional = row.is_additional === true;
                  const fields = additional ? additionalIncomeFields(type) : employmentFields(type);
                  return (
                    <section key={String(row.seq)} className="ap-row">
                      <header className="ap-row__head">
                        {/* No fixed "Primary source" heading: before a situation is
                            picked there is none, and once picked the heading follows
                            the situation. The empty span keeps Remove on the right. */}
                        {(additional || type)
                          ? <h3 className="ap-h3">{additional ? 'Additional income' : SITUATION_COPY[type]?.heading}</h3>
                          : <span />}
                        {editable && (
                          <Button variant="ghost" size="sm"
                            onClick={() => {
                              setIncomes((rs) => rs.filter((r) => r.seq !== row.seq));
                              void api.deleteRow(appId, 'incomes', Number(row.seq));
                            }}>Remove</Button>
                        )}
                      </header>
                      <FieldList
                        fields={[{
                          name: 'income_type',
                          label: additional ? 'What kind of income?' : 'What is your situation?',
                          kind: 'select', required: true,
                          options: (additional ? ADDITIONAL_INCOME_TYPES : EMPLOYMENT_TYPES).map((o) => ({ ...o })),
                        }]}
                        values={row} disabled={!editable}
                        onChange={(n, v) => setIncomeField(Number(row.seq), n, v)} />
                      {!additional && type && SITUATION_COPY[type]?.lead && (
                        <p className="ap-p">{SITUATION_COPY[type]!.lead}</p>
                      )}
                      {type && (
                        <FieldList fields={fields} values={row} disabled={!editable}
                          onChange={(n, v) => setIncomeField(Number(row.seq), n, v)} />
                      )}
                      {type && incomeDocKinds(row).map((doc) => (
                        <DocUpload key={doc.kind} applicationId={appId} documents={bundle.documents}
                          kind={doc.kind} label={doc.label}
                          link={row.id ? { income_id: String(row.id) } : undefined}
                          editable={editable} onChanged={() => void load()} />
                      ))}
                    </section>
                  );
                })}
                {editable && (
                  <div className="ap-actions">
                    <Button variant="quiet"
                      onClick={() => void addIncome(false)}>
                      <Icon name="plus" /> Add another source
                    </Button>
                    <Button variant="quiet"
                      onClick={() => void addIncome(true)}>
                      <Icon name="plus" /> Add additional income
                    </Button>
                  </div>
                )}
                {editable && footer('income')}
              </CardBody></Card>
            )}

            {step === 'nationality' && (
              <Card><CardHead title="Nationality and right to rent" /><CardBody>
                <FieldList fields={NATIONALITY_FIELDS} values={profile} disabled={!editable}
                  onChange={(n, v) => setProfile((p) => ({ ...p, [n]: v }))} />
                {editable && footer('nationality')}
              </CardBody></Card>
            )}

            {step === 'declaration' && (
              <Card><CardHead title="Review and send" /><CardBody>
                <p className="ap-p">
                  This is what we will send for your eligibility check. Check it over, then sign below.
                </p>
                <dl className="ap-summary">
                  {sumLine('Name', [profile.first_name, profile.last_name].filter(Boolean).join(' '))}
                  {sumLine('Date of birth', profile.dob ? formatLongDate(String(profile.dob)) : '')}
                  {sumLine('Property', [property.prop_addr1, property.prop_city, property.prop_postcode].filter(Boolean).join(', '))}
                  {sumLine('Monthly rent', property.monthly_rent ? `£${String(property.monthly_rent)}` : '')}
                </dl>

                {missing.length > 0 && (
                  <div className="ap-pre ap-pre--wait ap-blocking" ref={sendBlockRef}>
                    <strong>Before you can send, finish:</strong>
                    <ul>
                      {missing.map((m) => (
                        <li key={m.label}>
                          <button type="button" className="ap-link" onClick={() => void m.go()}>{m.label}</button>
                          {m.note && <div className="soft">{m.note}</div>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* The declaration and its signature, together: the statement, the
                    typed name, and the tick that stamps declared_at, as one act. */}
                <div className="ap-sign" ref={signRef}>
                  <p className="ap-sign__statement">
                    Everything I have given is true and complete to the best of my knowledge.
                  </p>
                  <Field label="Type your full name to confirm" htmlFor="declared_name">
                    <input id="declared_name" className="input" type="text" autoComplete="name"
                      disabled={!editable} value={String(profile.declared_name ?? '')}
                      onChange={(e) => setProfile((p) => ({ ...p, declared_name: e.target.value }))} />
                  </Field>
                  <label className="ap-check">
                    <input type="checkbox"
                      disabled={!editable || !String(profile.declared_name ?? '').trim()}
                      checked={!!profile.declared_at}
                      onChange={(e) => {
                        const at = e.target.checked;
                        setProfile((p) => ({ ...p, declared_at: at ? new Date().toISOString() : null }));
                      }} />
                    <span>I confirm the details above are what I want to send, and that this declaration is true.</span>
                  </label>
                </div>

                <details className="ap-more">
                  <summary>Anything else you want to tell us? (optional)</summary>
                  <textarea className="input" rows={3} disabled={!editable}
                    value={String(profile.declaration_note ?? '')}
                    onChange={(e) => setProfile((p) => ({ ...p, declaration_note: e.target.value }))} />
                </details>

                {editable && (
                  <>
                    <p className="ap-p">
                      Sending this starts your eligibility check. We will email you either way, and if
                      you are approved the next thing you will hear about is the guarantee fee.
                    </p>
                    <div className="ap-actions">
                      <Button variant="primary" disabled={busy} aria-disabled={!canSend || undefined}
                        onClick={() => { if (!canSend) { revealSend(); return; } void submit(); }}>
                        {busy ? 'Sending…' : 'Send my application'}
                      </Button>
                    </div>
                  </>
                )}
              </CardBody></Card>
            )}
          </div>
          </RevealMissingContext.Provider>
        </div>
      )}

      {tab === 'id' && (<>
        <IdCheckPanel />
        {editable && tabFooter('id')}
      </>)}
      {tab === 'financials' && (<>
        <FinancialsPanel applicationId={appId} documents={bundle.documents}
          editable={editable} onChanged={() => void load()} />
        {editable && tabFooter('financials')}
      </>)}
      {tab === 'guarantee' && (
        <div className="ap-panel">
          <Card><CardHead title={TABS.find((t) => t.id === tab)!.label} /><CardBody>
            <PlaceholderTab tab={tab} status={bundle.application.status} />
          </CardBody></Card>
        </div>
      )}
    </TenantShell>
  );
}


/* What they told us, once the form has folded away.

   Collapsed by default: somebody waiting for a decision does not need seven
   sections in front of them, but they do sometimes want to check what they put.
   Read-only, because editing after submission would change the basis of a
   decision already in flight, which the server refuses anyway. */
/* The post-payment return, as a state the tenant lands on. It names the amount,
   what it bought and what is next, and it never claims an assessment has
   happened. While confirming it polls; if the webhook is slow it says we have
   the payment and are checking, with a way to reach us, rather than a lock. */
function PaymentReturn({ state, onContinue, onCheckAgain }: {
  state: PayReturn;
  onContinue: () => void;
  onCheckAgain: () => void;
}) {
  if (state === 'confirming') {
    return (
      <Card><CardBody>
        <div className="ap-pre ap-pre--wait">
          <strong>Confirming your payment…</strong> This is usually a few seconds. It can
          occasionally take up to a minute, and it continues on its own.
        </div>
      </CardBody></Card>
    );
  }
  if (state === 'stuck') {
    return (
      <Card><CardBody>
        <div className="ap-pre ap-pre--wait">
          <strong>We have your payment and we are checking it.</strong>
        </div>
        <p className="ap-p">
          This is taking a little longer than usual. It does not need anything from
          you, and the rest of your application unlocks the moment it clears.
        </p>
        <p className="ap-p">
          If it has not cleared in a few minutes, email us at{' '}
          <a href="mailto:hello@opndoor.co">hello@opndoor.co</a> and we will sort it.
        </p>
        <div className="ap-actions">
          <Button variant="primary" onClick={onCheckAgain}>Check again</Button>
        </div>
      </CardBody></Card>
    );
  }
  return (
    <Card><CardBody>
      <div className="ap-pre ap-pre--ok">
        <strong>Payment received.</strong> £20 for your eligibility check.
      </div>
      <p className="ap-p">
        Next: your address history. Nothing has been sent for checking yet. That
        happens once you have finished the remaining sections and press send.
      </p>
      <div className="ap-actions">
        <Button variant="primary" onClick={onContinue}>Continue to address history</Button>
      </div>
    </CardBody></Card>
  );
}

function ReadOnlyAnswers({
  open, onToggle, property, agent, profile, addresses, incomes,
}: {
  open: boolean;
  onToggle: () => void;
  property: Record<string, unknown>;
  agent: Record<string, unknown>;
  profile: Record<string, unknown>;
  addresses: Record<string, unknown>[];
  incomes: Record<string, unknown>[];
}) {
  const line = (k: string, v: unknown) =>
    v ? <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div> : null;

  return (
    <Card>
      <CardHead
        title="What you told us"
        actions={
          <Button variant="quiet" size="sm" onClick={onToggle}>
            {open ? 'Hide' : 'Show'}
          </Button>
        }
      />
      {open && (
        <CardBody>
          <dl className="ap-summary">
            {line('Property', [property.prop_addr1, property.prop_city, property.prop_postcode].filter(Boolean).join(', '))}
            {line('Monthly rent', property.monthly_rent ? `£${String(property.monthly_rent)}` : '')}
            {line('Tenancy starts', property.tenancy_start ? formatLongDate(String(property.tenancy_start)) : '')}
            {line('Managed by', agent.agency_name || [agent.first_name, agent.last_name].filter(Boolean).join(' '))}
            {line('Name', [profile.first_name, profile.last_name].filter(Boolean).join(' '))}
            {line('Date of birth', profile.dob ? formatLongDate(String(profile.dob)) : '')}
            {line('Nationality', profile.nationality)}
            {line('Addresses given', addresses.length ? `${addresses.length}` : '')}
            {line('Income sources', incomes.length ? `${incomes.length}` : '')}
          </dl>
          <p className="soft">
            These cannot be changed now. If something here is wrong, tell us and we will
            sort it out rather than you starting again.
          </p>
        </CardBody>
      )}
    </Card>
  );
}

/* The tabs after the form are each gated on something outside this piece:
   identity and financial verification run on the provider's vendor accounts, and
   the guarantee tab needs a deed to exist. Each says what it is waiting for rather
   than showing an empty panel, because an empty panel reads as broken. */
function PlaceholderTab({ tab, status }: { tab: Tab; status: string }) {
  const copy: Record<string, { title: string; body: string }> = {
    id: { title: 'Identity check', body: 'After your application is sent we confirm your identity with a photo of your ID and a short selfie.' },
    financials: { title: 'Financials', body: 'Upload the last three months of your bank statements so we can see your income. Three statements, one for each month.' },
    guarantee: { title: 'Your guarantee', body: 'When your Deed of Guarantee is issued it appears here, and we send a copy to whoever manages the property.' },
  };
  const c = copy[tab];
  return (
    <>
      <p className="ap-p">{c.body}</p>
      <p className="soft">
        {status === 'draft'
          ? 'This opens once you have sent your details.'
          : status === 'referencing'
            ? 'Your eligibility check is under way. We will email you as soon as there is a decision.'
            : 'We will email you when this step is ready.'}
      </p>
    </>
  );
}
