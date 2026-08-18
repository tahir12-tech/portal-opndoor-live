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
  ADDITIONAL_INCOME_TYPES, AGENT_FIELDS, BASIC_FIELDS, DECLARATION_FIELDS,
  EMPLOYMENT_TYPES, NATIONALITY_FIELDS, PROPERTY_FIELDS, REQUIRED_HISTORY_MONTHS,
  addressFields, additionalIncomeFields, employmentFields, historyMonths,
} from '@/tenant/formSpec';
import * as api from '@/tenant/tenantApi';
import { useAutosave, type SaveStatus } from '@/tenant/useAutosave';
import './Apply.css';

type Tab = 'details' | 'id' | 'financials' | 'documents' | 'payment' | 'guarantee';
type Step = 'property' | 'about' | 'address' | 'income' | 'nationality' | 'declaration';

const TABS: { id: Tab; label: string }[] = [
  { id: 'details', label: 'Your details' },
  { id: 'id', label: 'ID check' },
  { id: 'financials', label: 'Financials' },
  { id: 'documents', label: 'Documents' },
  { id: 'payment', label: 'Payment' },
  { id: 'guarantee', label: 'Your guarantee' },
];

const STEPS: { id: Step; label: string }[] = [
  { id: 'property', label: 'Property' },
  { id: 'about', label: 'About you' },
  { id: 'address', label: 'Address history' },
  { id: 'income', label: 'Income' },
  { id: 'nationality', label: 'Nationality' },
  { id: 'declaration', label: 'Declaration' },
];

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
  const [pre, setPre] = useState<api.Prequalification | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const appId = bundle?.application.id ?? 'demo-application';

  const load = useCallback(async () => {
    try {
      const list = await api.listApplications();
      const first = list.applications[0];
      if (!first) { setErr('No application found for this account.'); return; }
      const b = await api.getApplication(first.id);
      setBundle(b);
      setPre(await api.prequalify(first.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load your application.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

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

  const goStep = async (s: Step) => { await flushAll(); setStep(s); };
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
    property: !!property.prop_addr1 && !!property.monthly_rent && !!property.tenancy_start
              && !!agent.email && !!agent.kind,
    about: !!profile.first_name && !!profile.last_name && !!profile.dob && !!profile.phone
           && profile.adverse_credit !== undefined && profile.adverse_credit !== '',
    address: months >= REQUIRED_HISTORY_MONTHS,
    income: incomes.length > 0 && incomes.some((i) => !i.is_additional),
    nationality: !!profile.nationality && !!profile.right_to_rent_category,
    declaration: !!profile.declared_name && profile.declared_true === true,
  }), [property, agent, profile, months, incomes]);

  const doneCount = Object.values(stepDone).filter(Boolean).length;
  const pct = Math.round((doneCount / STEPS.length) * 100);

  const submit = async () => {
    setBusy(true); setErr(null);
    await flushAll();
    const r = await api.submitApplication(appId);
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? 'Could not submit.'); return; }
    await load(); seeded.current = false;
    setTab('id');
  };

  if (err && !bundle) return <div className="ap"><div className="ap-alert">{err}</div></div>;
  if (!bundle) return <div className="ap"><p className="soft">Loading your application…</p></div>;

  return (
    <div className="ap">
      <header className="ap-head">
        <div>
          <div className="ap-brand">opndoor</div>
          <h1>Your guarantor application</h1>
          <p className="ap-sub">
            {bundle.application.guarantee_ref} · Everything saves as you go, so you can stop and come back.
          </p>
        </div>
        <SaveBadge status={status} />
      </header>

      <nav className="ap-tabs" aria-label="Application sections">
        {TABS.map((t) => (
          <button key={t.id} type="button"
            className={`ap-tab${t.id === tab ? ' is-active' : ''}`}
            aria-current={t.id === tab ? 'page' : undefined}
            onClick={() => void goTab(t.id)}>{t.label}</button>
        ))}
      </nav>

      {!editable && (
        <div className="ap-note">
          Your application is with our referencing partner. You can still read everything,
          and we will email you as soon as there is news.
        </div>
      )}
      {err && <div className="ap-alert" role="alert">{err}</div>}

      {tab === 'details' && (
        <div className="ap-body">
          <aside className="ap-steps" aria-label="Your details, steps">
            <div className="ap-progress">
              <div className="ap-progress__bar"><span style={{ width: `${pct}%` }} /></div>
              <span className="ap-progress__label">{doneCount} of {STEPS.length} done</span>
            </div>
            {STEPS.map((s) => (
              <button key={s.id} type="button"
                className={`ap-step${s.id === step ? ' is-active' : ''}${stepDone[s.id] ? ' is-done' : ''}`}
                onClick={() => void goStep(s.id)}>
                <span className="ap-step__tick" aria-hidden="true">{stepDone[s.id] ? <Icon name="check" /> : null}</span>
                {s.label}
              </button>
            ))}
            <p className="ap-hint">
              Answer these in any order. Nothing is locked until you send it.
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
              </CardBody></Card>
            )}

            {step === 'about' && (
              <Card><CardHead title="About you" /><CardBody>
                <p className="ap-p">
                  We have your name and number from when you signed up. Change them here if they are wrong.
                </p>
                <FieldList fields={BASIC_FIELDS} values={profile} disabled={!editable}
                  onChange={(n, v) => { setProfile((p) => ({ ...p, [n]: v })); profileSave.set(n, v); }} />
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
                  </section>
                ))}
                {editable && (
                  <Button variant="quiet"
                    onClick={() => setAddresses((rs) => [...rs, { seq: (rs.at(-1)?.seq as number ?? -1) + 1 }])}>
                    <Icon name="plus" /> Add an earlier address
                  </Button>
                )}
              </CardBody></Card>
            )}

            {step === 'income' && (
              <Card><CardHead title="Your income" /><CardBody>
                <p className="ap-p">
                  Start with your main income, then add anything else you receive.
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
                          {additional ? 'Additional income' : 'Main income'}
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
                          label: additional ? 'What kind of income?' : 'What best describes you?',
                          kind: 'select', required: true,
                          options: (additional ? ADDITIONAL_INCOME_TYPES : EMPLOYMENT_TYPES).map((o) => ({ ...o })),
                        }]}
                        values={row} disabled={!editable}
                        onChange={(n, v) => setIncomeField(Number(row.seq), n, v)} />
                      {type && (
                        <FieldList fields={fields} values={row} disabled={!editable}
                          onChange={(n, v) => setIncomeField(Number(row.seq), n, v)} />
                      )}
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
                      <Icon name="plus" /> Add main income
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
              </CardBody></Card>
            )}

            {step === 'nationality' && (
              <Card><CardHead title="Nationality and right to rent" /><CardBody>
                <FieldList fields={NATIONALITY_FIELDS} values={profile} disabled={!editable}
                  onChange={(n, v) => { setProfile((p) => ({ ...p, [n]: v })); profileSave.set(n, v); }} />
              </CardBody></Card>
            )}

            {step === 'declaration' && (
              <Card><CardHead title="Declaration" /><CardBody>
                {/* Asked once, on Property. The legacy form asked again here. */}
                <p className="ap-p">
                  Your tenancy starts <strong>{String(property.tenancy_start || 'not set yet')}</strong> at{' '}
                  <strong>{String(property.prop_addr1 || 'the property above')}</strong>.
                  Change it on the Property step if that is wrong.
                </p>
                <FieldList fields={DECLARATION_FIELDS} values={profile} disabled={!editable}
                  onChange={(n, v) => { setProfile((p) => ({ ...p, [n]: v })); profileSave.set(n, v); }} />

                {pre && (
                  <div className={`ap-pre ${pre.outcome === 'ruled_out' ? 'ap-pre--no' : 'ap-pre--ok'}`}>
                    {pre.outcome === 'ruled_out'
                      ? <>On what you have told us, the income here is under what this rent needs.
                          You can still send it, and our referencing partner makes the decision.</>
                      : <><strong>Nothing here rules you out.</strong> That is not a decision:
                          our referencing partner makes it, and they see things we cannot.</>}
                  </div>
                )}

                {editable && (
                  <div className="ap-actions">
                    <Button variant="primary" disabled={busy || doneCount < STEPS.length} onClick={() => void submit()}>
                      {busy ? 'Sending…' : 'Send my application'}
                    </Button>
                    {doneCount < STEPS.length && (
                      <span className="soft">
                        {STEPS.filter((s) => !stepDone[s.id]).map((s) => s.label).join(', ')} still to finish.
                      </span>
                    )}
                  </div>
                )}
              </CardBody></Card>
            )}
          </div>
        </div>
      )}

      {tab !== 'details' && (
        <div className="ap-panel">
          <Card><CardHead title={TABS.find((t) => t.id === tab)!.label} /><CardBody>
            <PlaceholderTab tab={tab} status={bundle.application.status} />
          </CardBody></Card>
        </div>
      )}
    </div>
  );
}

/* The five tabs after the form are each gated on something outside this piece:
   identity and financial verification run on the provider's vendor accounts,
   payment needs the eligibility fee wired to Checkout, and the guarantee tab
   needs a deed to exist. Each says what it is waiting for rather than showing
   an empty panel, because an empty panel reads as broken. */
function PlaceholderTab({ tab, status }: { tab: Tab; status: string }) {
  const copy: Record<string, { title: string; body: string }> = {
    id: { title: 'Identity check', body: 'Once your details are in, we will ask you to confirm your identity with a photo of your ID and a short selfie. It takes about two minutes.' },
    financials: { title: 'Financials', body: 'You can link your bank securely instead of uploading statements, which is faster and means fewer documents to find.' },
    documents: { title: 'Documents', body: 'Anything still outstanding will be listed here. Documents you attach on the income and address steps appear here too.' },
    payment: { title: 'Payment', body: 'There are two payments: £20 when we send your application for referencing, and one month\'s rent for the guarantee itself, only if you are approved.' },
    guarantee: { title: 'Your guarantee', body: 'When your Deed of Guarantee is issued it appears here, and we send a copy to whoever manages the property.' },
  };
  const c = copy[tab];
  return (
    <>
      <p className="ap-p">{c.body}</p>
      <p className="soft">
        {status === 'draft'
          ? 'This opens once you have sent your details.'
          : 'We will email you when this step is ready.'}
      </p>
    </>
  );
}
