/* =====================================================================
   The tenant journey.

   SIX TABS, as the process document specifies: Your details, ID check,
   Financials, Documents, Payment, Your guarantee. The first is where the long
   form lives and carries its own steps: Property, About you, Address history,
   Income, Nationality, Declaration.

   THREE THINGS THIS IS BUILT AROUND, beyond the fields.

   1. It saves as they go. Every section autosaves a patch after they stop
      typing, on blur, on tab change and on the page being hidden. There is no
      save button because there is nothing for it to do. The status is always
      on screen: somebody who cannot see that it saved does not believe it did.

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
  EMPLOYMENT_TYPES, NATIONALITY_FIELDS, PROPERTY_FIELDS, REQUIRED_HISTORY_MONTHS,
  addressFields, additionalIncomeFields, employmentFields, fieldsComplete, historyMonths, incomeDocKinds,
} from '@/tenant/formSpec';
import * as api from '@/tenant/tenantApi';
import { currentTenant } from '@/tenant/tenantAuth';
import { useAutosave, type SaveStatus } from '@/tenant/useAutosave';
import { TenantShell, type TenantNavItem } from './TenantShell';
import { ApplicationStatus, statusView } from './ApplicationStatus';
import { DocUpload, DocumentsPanel, FinancialsPanel, IdCheckPanel, StepFooter } from './Sections';
import { SUPABASE_ENABLED } from '@/lib/supabase';
import { useTenantDocumentTitle } from '@/hooks/useDocumentTitle';
import { formatLongDate } from '@/lib/format';
import { Field } from '@/components/ui/Field';
import './Apply.css';

type Tab = 'details' | 'id' | 'financials' | 'documents' | 'payment' | 'guarantee';
type Step = 'property' | 'about' | 'fee' | 'address' | 'income' | 'nationality' | 'declaration';
/* The post-payment return is a STATE, not a route: land here deterministically
   after Checkout rather than wherever a fresh mount defaults to. */
type PayReturn = 'none' | 'confirming' | 'confirmed' | 'stuck';

const TABS: { id: Tab; label: string }[] = [
  { id: 'details', label: 'Your details' },
  { id: 'id', label: 'ID check' },
  { id: 'financials', label: 'Financials' },
  { id: 'documents', label: 'Documents' },
  { id: 'payment', label: 'Payment' },
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
  { id: 'income',       label: 'Income',          icon: 'trend' },
  { id: 'nationality',  label: 'Nationality',     icon: 'shield' },
  { id: 'declaration',  label: 'Declaration',     icon: 'pen' },
];

const TAB_ICON: Record<Tab, TenantNavItem['icon']> = {
  details: 'edit', id: 'eye', financials: 'trend',
  documents: 'file', payment: 'building', guarantee: 'shield',
};

/** Everything after the fee. Locked until it clears. */
const LOCKED_UNTIL_PAID: Step[] = ['address', 'income', 'nationality', 'declaration'];

function SaveBadge({ status }: { status: SaveStatus }) {
  if (status === 'idle') return null;
  const map: Record<SaveStatus, { t: string; c: string }> = {
    idle: { t: '', c: '' },
    dirty: { t: 'Unsaved changes', c: 'ap-save--dirty' },
    saving: { t: 'Saving…', c: 'ap-save--saving' },
    saved: { t: 'Saved', c: 'ap-save--ok' },
    error: { t: 'Could not save. We will try again as you type.', c: 'ap-save--err' },
  };
  const m = map[status];
  return (
    <span className={`ap-save ${m.c}`} role={status === 'error' ? 'alert' : 'status'}>
      {status === 'saved' && <Icon name="check" />} {m.t}
    </span>
  );
}

export function Apply() {
  const [tab, setTab] = useState<Tab>('details');
  const [step, setStep] = useState<Step>('property');
  const [bundle, setBundle] = useState<api.ApplicationBundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const appId = bundle?.application.id ?? 'demo-application';

  const [signedOut, setSignedOut] = useState(false);
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

  const load = useCallback(async () => {
    try {
      // A tenant with no session gets the front door rather than an error. This
      // page is reachable by URL and by an old bookmark, and "could not load"
      // is the wrong answer to "you are not signed in".
      const me = await currentTenant();
      if (!me) { setSignedOut(true); return; }
      const list = await api.listApplications();
      const first = list.applications[0];
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
    const fee = new URLSearchParams(window.location.search).get('fee');
    if (fee === 'paid' || fee === 'cancelled') window.history.replaceState({}, '', '/apply');
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

  const propertySave = useAutosave(useCallback((p) => api.saveProperty(appId, p), [appId]));
  const agentSave = useAutosave(useCallback((p) => api.saveAgent(appId, { ...agent, ...p }), [appId, agent]));
  const profileSave = useAutosave(useCallback((p) => api.saveProfile(appId, p), [appId]));

  const status: SaveStatus = [propertySave.status, agentSave.status, profileSave.status]
    .includes('error') ? 'error'
    : [propertySave.status, agentSave.status, profileSave.status].includes('saving') ? 'saving'
    : [propertySave.status, agentSave.status, profileSave.status].includes('dirty') ? 'dirty'
    : [propertySave.status, agentSave.status, profileSave.status].includes('saved') ? 'saved' : 'idle';

  const flushAll = useCallback(async () => {
    await Promise.all([propertySave.flush(), agentSave.flush(), profileSave.flush()]);
  }, [propertySave, agentSave, profileSave]);

  // A locked step sends you to the fee rather than doing nothing, because a
  // button that ignores you reads as broken.
  const goStep = async (s: Step) => { await flushAll(); setStep(locked(s) ? 'fee' : s); };
  const goTab = async (t: Tab) => { await flushAll(); setTab(t); };

  /* ---- rows ------------------------------------------------------------- */
  const setAddressField = (seq: number, name: string, v: unknown) => {
    setAddresses((rows) => rows.map((r) => (Number(r.seq) === seq ? { ...r, [name]: v } : r)));
    void api.saveRow(appId, 'addresses', seq, { [name]: v });
  };
  const setIncomeField = (seq: number, name: string, v: unknown) => {
    setIncomes((rows) => rows.map((r) => (Number(r.seq) === seq ? { ...r, [name]: v } : r)));
    void api.saveRow(appId, 'incomes', seq, { [name]: v });
  };

  const months = useMemo(() => historyMonths(addresses), [addresses]);
  const historyPct = Math.min(100, Math.round((months / REQUIRED_HISTORY_MONTHS) * 100));

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
    // Three years of history AND every address actually filled in, including the
    // rental-arrears question, which used to read done while it was unanswered.
    address: months >= REQUIRED_HISTORY_MONTHS && addresses.length > 0
             && addresses.every((row, i) => fieldsComplete(addressFields(i === 0), row)),
    // A main income that is actually filled in, not just a row with a type.
    income: incomes.length > 0 && incomes.some((i) => !i.is_additional)
            && incomes.every((row) => !!row.income_type && fieldsComplete(
                 row.is_additional ? additionalIncomeFields(String(row.income_type))
                                   : employmentFields(String(row.income_type)), row)),
    nationality: fieldsComplete(NATIONALITY_FIELDS, profile),
    declaration: !!profile.declared_name && !!profile.declared_at,
  }), [property, agent, profile, months, addresses, incomes, feePaid]);

  const doneCount = Object.values(stepDone).filter(Boolean).length;
  // The other sections still to finish, shown on the final screen as a
  // blocker. The declaration itself is excluded: its fields are right there.
  const missing = STEPS.filter((st) => st.id !== 'declaration' && !stepDone[st.id]);
  const sumLine = (k: string, v: unknown) =>
    v ? <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div> : null;

  const payFee = async () => {
    setBusy(true); setErr(null);
    await flushAll();
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
    await flushAll();
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

  if (signedOut) {
    return (
      <div className="ap ap--narrow">
        <header className="ap-head"><div>
          <div className="ap-brand">opndoor</div>
          <h1>Sign in to continue</h1>
          <p className="ap-sub">Your application is saved. Sign in and it will be exactly where you left it.</p>
        </div></header>
        <div className="ap-actions">
          <Button variant="primary" onClick={() => { window.location.href = '/login?tab=tenant'; }}>Sign in</Button>
          <a className="ap-link" href="/apply/register">I have not started yet</a>
        </div>
      </div>
    );
  }
  if (err && !bundle) return <div className="ap"><div className="ap-alert">{err}</div></div>;
  if (!bundle) return <div className="ap"><p className="soft">Loading your application…</p></div>;

  // The answer to "Who manages the property?", so a terminal message can name
  // the right party instead of assuming a letting agent.
  const view = statusView(bundle.application.status, feePaid, doneCount, STEPS.length,
    (bundle.agent as { kind?: string } | null)?.kind ?? null);

  /* ONCE IT IS SENT, THE FORM FOLDS AWAY.
     Everything before submission is about filling something in; everything
     after is about waiting, paying and receiving. Leaving seven form steps in
     the sidebar of somebody who has finished implies there is still something
     to do, and the one honest answer at that point is "nothing, we will email
     you". The answers are still readable, behind one link, because somebody who
     is waiting does sometimes want to check what they said. */
  const submitted = bundle.application.status !== 'draft';

  const payGuarantee = async () => {
    // The guarantee fee is the referral path's existing Stripe flow, reached
    // from the tokenised payment page. A tenant with an account gets there the
    // same way rather than through a second implementation of the same payment.
    //
    // It needs the application's OWN token: /pay without one renders the
    // invalid-link state, which is where this button used to send people.
    setBusy(true); setErr(null);
    try {
      const url = await api.guaranteePaymentUrl(appId);
      if (url) { window.location.href = url; return; }
      setErr('Payment is not available in this demo. Use the demo controls to see what follows.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not open the payment page.');
    } finally { setBusy(false); }
  };

  /* The step footer needs to know where "next" goes and what is outstanding.
     Order comes from STEPS, so inserting a step does not need this updated. */
  const stepIndex = STEPS.findIndex((st) => st.id === step);
  const nextStep = STEPS[stepIndex + 1];
  const OUTSTANDING: Record<Step, string> = {
    property: 'Add the property, the rent, the start date and who manages it.',
    about: 'We still need your date of birth, phone and the adverse credit question.',
    fee: 'The fee unlocks the rest of the form.',
    address: `We need three years. You have given us ${months} month${months === 1 ? '' : 's'}.`,
    income: 'Tell us your situation and the amounts for your primary source.',
    nationality: 'Tell us your nationality and which description fits you.',
    declaration: 'Confirm your name and tick the declaration.',
  };

  const goNext = async () => {
    setBusy(true);
    await flushAll();
    setBusy(false);
    if (nextStep) void goStep(nextStep.id);
  };

  const footer = (id: Step) => (
    <StepFooter
      done={stepDone[id]}
      outstanding={OUTSTANDING[id]}
      nextLabel={nextStep ? `Save and continue to ${nextStep.label.toLowerCase()}` : null}
      onNext={() => void goNext()}
      onBack={stepIndex > 0 ? () => void goStep(STEPS[stepIndex - 1].id) : undefined}
      isLast={!nextStep}
      busy={busy}
    />
  );

  const shellNav = submitted
    ? [{
        group: 'Your application',
        items: [
          { id: 'details', label: 'Status', icon: 'dashboard' as const, done: true },
          ...TABS.filter((t) => t.id !== 'details' && t.id !== 'id' && t.id !== 'financials')
            .map((t) => ({ id: t.id, label: t.label, icon: TAB_ICON[t.id] })),
        ],
      }]
    : [
        {
          group: 'Your application',
          items: STEPS.map((st) => ({
            id: `details:${st.id}`, label: st.label, icon: st.icon,
            done: stepDone[st.id], locked: locked(st.id),
          })),
        },
        {
          group: 'Before you send',
          items: TABS.filter((t) => t.id === 'id' || t.id === 'financials' || t.id === 'documents')
            .map((t) => ({ id: t.id, label: t.label, icon: TAB_ICON[t.id] })),
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
      actions={<SaveBadge status={status} />}
    >
      <div className="page-head">
        <div>
          <h1 className="page-head__title">{currentLabel}</h1>
          <p className="page-head__sub">
            {bundle.application.guarantee_ref} · Everything saves as you go, so you can stop and come back.
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

      {!editable && (
        <div className="ap-note">
          Your eligibility check is under way. You can still read everything,
          and we will email you as soon as there is news.
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
                ? 'Answer these in any order. Everything saves as you go.'
                : 'Fill in the first two, then the application fee unlocks the rest.'}
            </p>
          </aside>

          <div className="ap-panel">
            {step === 'property' && (
              <Card><CardHead title="The property you are renting" /><CardBody>
                <FieldList fields={PROPERTY_FIELDS} values={property} disabled={!editable}
                  onChange={(n, v) => { setProperty((p) => ({ ...p, [n]: v })); propertySave.set(n, v); }} />
                <h3 className="ap-h3">Who manages it?</h3>
                <p className="ap-p">
                  We send the finished Deed of Guarantee to whoever manages the property.
                  We do not contact them before that.
                </p>
                <FieldList fields={AGENT_FIELDS} values={agent} disabled={!editable}
                  onChange={(n, v) => { setAgent((p) => ({ ...p, [n]: v })); agentSave.set(n, v); }} />
                {editable && footer('property')}
              </CardBody></Card>
            )}

            {step === 'about' && (
              <Card><CardHead title="About you" /><CardBody>
                <p className="ap-p">
                  We have your name and number from when you signed up. Change them here if they are wrong.
                </p>
                <FieldList fields={BASIC_FIELDS} values={profile} disabled={!editable}
                  onChange={(n, v) => { setProfile((p) => ({ ...p, [n]: v })); profileSave.set(n, v); }} />
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
                    {months >= REQUIRED_HISTORY_MONTHS
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
                      onChange={(n, v) => setAddressField(Number(row.seq), n, v)} />
                    {i === 0 && (
                      <DocUpload applicationId={appId} documents={bundle.documents}
                        kind="proof_of_address" label="Proof of address"
                        editable={editable} onChanged={() => { seeded.current = false; void load(); }} />
                    )}
                  </section>
                ))}
                {editable && months < REQUIRED_HISTORY_MONTHS && (
                  <Button variant="quiet"
                    onClick={() => setAddresses((rs) => [...rs, { seq: (rs.at(-1)?.seq as number ?? -1) + 1 }])}>
                    <Icon name="plus" /> Add an earlier address
                  </Button>
                )}
                {editable && footer('address')}
              </CardBody></Card>
            )}

            {step === 'income' && (
              <Card><CardHead title="Your income" /><CardBody>
                <p className="ap-p">
                  Tell us your situation, then the amounts. Start with your main source, then add anything else.
                  {property.monthly_rent ? <> The rent here is £{String(property.monthly_rent)} a month.</> : null}
                </p>
                {incomes.map((row, i) => {
                  const type = String(row.income_type ?? '');
                  const additional = row.is_additional === true;
                  const fields = additional ? additionalIncomeFields(type) : employmentFields(type);
                  return (
                    <section key={String(row.seq)} className="ap-row">
                      <header className="ap-row__head">
                        <h3 className="ap-h3">
                          {additional ? 'Additional income' : 'Primary source'}
                          {i > 0 ? ` ${i + 1}` : ''}
                        </h3>
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
                      {type && (
                        <FieldList fields={fields} values={row} disabled={!editable}
                          onChange={(n, v) => setIncomeField(Number(row.seq), n, v)} />
                      )}
                      {type && incomeDocKinds(row).map((doc) => (
                        <DocUpload key={doc.kind} applicationId={appId} documents={bundle.documents}
                          kind={doc.kind} label={doc.label}
                          link={row.id ? { income_id: String(row.id) } : undefined}
                          editable={editable} onChanged={() => { seeded.current = false; void load(); }} />
                      ))}
                    </section>
                  );
                })}
                {editable && (
                  <div className="ap-actions">
                    <Button variant="quiet"
                      onClick={() => {
                        const seq = (incomes.at(-1)?.seq as number ?? -1) + 1;
                        setIncomes((rs) => [...rs, { seq, is_additional: false }]);
                        void api.saveRow(appId, 'incomes', seq, { is_additional: false });
                      }}>
                      <Icon name="plus" /> Add a primary source
                    </Button>
                    <Button variant="quiet"
                      onClick={() => {
                        const seq = (incomes.at(-1)?.seq as number ?? -1) + 1;
                        setIncomes((rs) => [...rs, { seq, is_additional: true }]);
                        void api.saveRow(appId, 'incomes', seq, { is_additional: true });
                      }}>
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
                  onChange={(n, v) => { setProfile((p) => ({ ...p, [n]: v })); profileSave.set(n, v); }} />
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
                  {sumLine('Property', [property.prop_addr1, property.prop_city, property.prop_postcode].filter(Boolean).join(', '))}
                  {sumLine('Tenancy starts', property.tenancy_start ? formatLongDate(String(property.tenancy_start)) : '')}
                  {sumLine('Monthly rent', property.monthly_rent ? `£${String(property.monthly_rent)}` : '')}
                  {sumLine('Address history', `${months} month${months === 1 ? '' : 's'} of 36`)}
                  {sumLine('Income sources', incomes.length ? String(incomes.length) : '')}
                  {sumLine('Nationality', profile.nationality)}
                  {sumLine('Application fee', feePaid ? 'Paid' : '')}
                </dl>

                {missing.length > 0 && (
                  <div className="ap-pre ap-pre--wait ap-blocking">
                    <strong>Before you can send, finish:</strong>
                    <ul>
                      {missing.map((st) => (
                        <li key={st.id}>
                          <button type="button" className="ap-link" onClick={() => void goStep(st.id)}>{st.label}</button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* The declaration and its signature, together: the statement, the
                    typed name, and the tick that stamps declared_at, as one act. */}
                <div className="ap-sign">
                  <p className="ap-sign__statement">
                    Everything I have given is true and complete to the best of my knowledge.
                  </p>
                  <Field label="Type your full name to confirm" htmlFor="declared_name">
                    <input id="declared_name" className="input" type="text" autoComplete="name"
                      disabled={!editable} value={String(profile.declared_name ?? '')}
                      onChange={(e) => { setProfile((p) => ({ ...p, declared_name: e.target.value })); profileSave.set('declared_name', e.target.value); }} />
                  </Field>
                  <label className="ap-check">
                    <input type="checkbox"
                      disabled={!editable || !String(profile.declared_name ?? '').trim()}
                      checked={!!profile.declared_at}
                      onChange={(e) => {
                        const at = e.target.checked;
                        setProfile((p) => ({ ...p, declared_at: at ? new Date().toISOString() : null }));
                        profileSave.set('declared_true', at);
                      }} />
                    <span>I confirm the details above are what I want to send, and that this declaration is true.</span>
                  </label>
                </div>

                <details className="ap-more">
                  <summary>Anything else you want to tell us? (optional)</summary>
                  <textarea className="input" rows={3} disabled={!editable}
                    value={String(profile.declaration_note ?? '')}
                    onChange={(e) => { setProfile((p) => ({ ...p, declaration_note: e.target.value })); profileSave.set('declaration_note', e.target.value); }} />
                </details>

                {editable && (
                  <>
                    <p className="ap-p">
                      Sending this starts your eligibility check. We will email you either way, and if
                      you are approved the next thing you will hear about is the guarantee fee.
                    </p>
                    <div className="ap-actions">
                      <Button variant="primary" disabled={busy || doneCount < STEPS.length} onClick={() => void submit()}>
                        {busy ? 'Sending…' : 'Send my application'}
                      </Button>
                    </div>
                  </>
                )}
              </CardBody></Card>
            )}
          </div>
        </div>
      )}

      {tab === 'documents' && (
        <DocumentsPanel applicationId={appId} documents={bundle.documents}
          editable={editable} onChanged={() => { seeded.current = false; void load(); }} />
      )}
      {tab === 'id' && (
        <IdCheckPanel applicationId={appId} documents={bundle.documents}
          editable={editable} onChanged={() => { seeded.current = false; void load(); }} />
      )}
      {tab === 'financials' && (
        <FinancialsPanel applicationId={appId} documents={bundle.documents}
          editable={editable} onChanged={() => { seeded.current = false; void load(); }} />
      )}
      {(tab === 'payment' || tab === 'guarantee') && (
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
            {line('Tenancy starts', property.tenancy_start)}
            {line('Managed by', agent.agency_name || [agent.first_name, agent.last_name].filter(Boolean).join(' '))}
            {line('Name', [profile.first_name, profile.last_name].filter(Boolean).join(' '))}
            {line('Date of birth', profile.dob)}
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

/* The five tabs after the form are each gated on something outside this piece:
   identity and financial verification run on the provider's vendor accounts,
   payment needs the eligibility fee wired to Checkout, and the guarantee tab
   needs a deed to exist. Each says what it is waiting for rather than showing
   an empty panel, because an empty panel reads as broken. */
function PlaceholderTab({ tab, status }: { tab: Tab; status: string }) {
  const copy: Record<string, { title: string; body: string }> = {
    id: { title: 'Identity check', body: 'After your application is sent we confirm your identity with a photo of your ID and a short selfie.' },
    financials: { title: 'Financials', body: 'You can link your bank securely instead of uploading statements, which is faster and means fewer documents to find.' },
    documents: { title: 'Documents', body: 'Anything still outstanding is listed here. Documents you attach on the income and address steps appear here too.' },
    payment: { title: 'Payment', body: 'Two payments, and they are separate. The £20 application fee sits inside your details, part way through. The guarantee fee is one month\u2019s rent and is only ever asked for after you are approved.' },
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
