/* =====================================================================
   New application — create a referral.

   Enforces the required-field spec on the client (required markers, inline
   errors, submit disabled until valid) to match the database constraints and
   the create_referral RPC. Submitting posts through the service layer; RPC
   errors (which name the offending fields) are surfaced readably.

   Property entry is postcode-first when an address-lookup provider is
   configured (see addressService), and falls back to manual entry otherwise.
   Manual entry is always available via a toggle.

   ONE OFFICE, NOTHING ABOUT THE OFFICE. An agency user whose whole scope is one
   office is not asked which office and is not told which office either. The
   section, its number in the rail, its card and the line that once stated the
   fact under Tenancy have all gone: somebody filing from their only office knows
   where they work. See `oneOffice` below.

   MORE THAN ONE TENANT. A joint tenancy is one guarantee over one property, and
   the form says so: the same tenant fields repeat, the Tenancy section grows a
   share row per tenant, and the fee is shown at the count actually entered
   BEFORE anything is sent. A sole tenant sees none of it — no share fields, no
   rows, no repeat card — because a sole tenant carries 100% and should not have
   to say so.
   ===================================================================== */
import { useEffect, useState, type ClipboardEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEFAULT_SHARE_PERCENT, amountFromPercent, duplicateEmailIndex, equalSharePercents, percentFromAmount, shareSumError } from './shareMath';
import { addressLookupAvailable, ALL_PARTNERS, createReferral, feeBasisLabel, findActiveReferralByTenantProperty, lookupAddresses, originIsAgentEstate, previewReferralFee, type AddressOption, type DuplicateMatch, type FeePreview, UNRESOLVED, orgSectionCopy, type OrgShape } from '@/data';
import { Modal } from '@/components/ui/Modal';
import { TITLE_OPTIONS, validateReferral, validateTenant, parseFlexibleDate, toISODate, type ReferralValues, type TenantErrors, type TenantValues } from '@/lib/validation';
import { useSession } from '@/session/SessionContext';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Field } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { AgentBranchPicker } from '@/components/AgentBranchPicker';
import './NewApplication.css';

const Req = () => <span className="req" aria-hidden="true">*</span>;

const money = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const EMPTY: ReferralValues = {
  title: '', first: '', middle: '', last: '', dob: '', email: '', phone: '',
  addr1: '', addr2: '', city: '', county: '', postcode: '',
  rent: '', tenancyStart: '', agency: '', branch: '',
  // 100%: one applicant responsible for the whole rent is the common case by a
  // distance, and a sole tenant should not have to say so.
  sharePercent: String(DEFAULT_SHARE_PERCENT), shareAmount: '',
};

const EMPTY_TENANT: TenantValues = { title: '', first: '', middle: '', last: '', dob: '', email: '', phone: '' };

/* Extra tenants carry an id of their own.
   Keying their fields by array index means removing the middle of three shifts
   every one below it: React reuses the DOM node, and the "you have touched this
   field" flags — which are keyed by the same index — light up validation errors
   against a tenant whose box nobody has been near. */
let tenantSeq = 0;
type ExtraTenant = TenantValues & { key: string };
const newTenant = (): ExtraTenant => { tenantSeq += 1; return { ...EMPTY_TENANT, key: `t${tenantSeq}` }; };

export function NewApplication() {
  usePageMeta('new', 'New application', ['Home', 'Applications', 'New']);
  const navigate = useNavigate();
  const { refresh, role, partnerScope } = useSession();
  const toast = useToast();

  const [values, setValues] = useState<ReferralValues>(EMPTY);
  // Tenants 2 and up. Empty is the overwhelmingly common case and is what makes
  // the sole-tenant path identical: no shares, no rows, the same RPC.
  const [extra, setExtra] = useState<ExtraTenant[]>([]);
  // Every tenant's share of the rent as a percentage, index 0 being tenant 1.
  // Held as strings because a half-typed "3" must not become 3%.
  const [percents, setPercents] = useState<string[]>([String(DEFAULT_SHARE_PERCENT)]);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dupWarn, setDupWarn] = useState<DuplicateMatch | null>(null); // #5 duplicate soft warning
  const [fee, setFee] = useState<FeePreview | null>(null);
  // THE RAIL the selected origin runs on. A joint tenancy is an agent-rail
  // thing: a pre-referenced referral arrives with its references already done
  // and covers one tenant, and create_joint_referral refuses the rest.
  //
  // Three states, not two, and the difference matters: "no origin chosen yet"
  // and "asked, and the answer is not the agent rail" must not be confused,
  // because only the second is grounds for throwing away tenants somebody typed.
  const [estate, setEstate] = useState(false);
  const [railState, setRailState] = useState<'none' | 'loading' | 'ready'>('none');
  // Said once, when adding a tenant stops being possible and tenants were
  // already entered. Silence would be worse than the interruption.
  const [railNote, setRailNote] = useState('');

  // On-the-fly org creation extras from the AgentBranchPicker (contact capture
  // and, for an admin, the target partner the referral lands under).
  // The shape the picker resolved. Held here only so the section heading can
  // ask the right question: a supplier is telling us whose property this is, an
  // agent is telling us which of their own offices it is.
  // UNRESOLVED, not FULL_PICKER. This drives the section 4 heading, and
  // FULL_PICKER's heading is the SUPPLIER's question ("Which agency is letting
  // this property... You can add either on the fly"), which is the wrong thing to
  // print at an agency user for even one frame. See orgShapeService.
  const [orgShape, setOrgShape] = useState<OrgShape>(UNRESOLVED);
  const orgCopy = orgSectionCopy(orgShape);
  /* ONE OFFICE: THE SECTION GOES, AND SO DOES THE FACT.
     A section heading, a number in the rail and a bordered card, all to tell
     somebody the name of the only office they work at. That furniture went first
     and the fact followed it: the one-line note under Tenancy is withdrawn too,
     so this flag now only decides what is NOT drawn. The picker still mounts
     (below) because it is
     what resolves the office and reports it back through onChange, and it mounts
     in the SAME PLACE either way: giving it two positions, one per branch of this
     flag, put the form in a remount loop. The long note at the section's JSX has
     the whole story, and it is worth reading before touching that markup.

     Read off the picker's own shape, from my_org_shape, and not off
     viewerShape: see the note at the top of AgentBranchPicker. One counts the
     org, the other counts the book, and only the first can tell a quiet new
     branch from no branch.

     Still keyed on the NAME and not only the counts, even with nothing printed:
     a shape claiming one office without saying which one has not resolved the
     office, and collapsing on it would file the referral against whatever the
     picker happened to settle on. The picker makes the same call on the same
     field. */
  const oneOffice = orgShape.collapseAgency && orgShape.collapseBranch && !!orgShape.onlyAgencyName;
  const [org, setOrg] = useState({
    agencyNew: false, branchNew: false,
    agencyContactEmail: '', agencyContactName: '', agencyContactPhone: '', branchContactEmail: '',
    partner: '', singleOffice: null as boolean | null,
  });

  // address lookup
  const lookupAvailable = addressLookupAvailable();
  const [addrMode, setAddrMode] = useState<'lookup' | 'manual'>(lookupAvailable ? 'lookup' : 'manual');
  const [lookupPostcode, setLookupPostcode] = useState('');
  const [lookupResults, setLookupResults] = useState<AddressOption[]>([]);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupMsg, setLookupMsg] = useState('');

  const joint = extra.length > 0;
  const tenantCount = 1 + extra.length;
  const jointAllowed = railState === 'ready' && estate;
  const rentNum = Number(values.rent);
  const pctNums = percents.map((p) => Number(p));

  const errors = validateReferral(values);
  // Every additional applicant is checked by the same function tenant 1 is.
  const extraErrors: TenantErrors[] = extra.map((t) => validateTenant(t, values.tenancyStart));
  const allEmails = [values.email, ...extra.map((t) => t.email)];
  const dupIdx = duplicateEmailIndex(allEmails);
  const shareErr = joint ? shareSumError(pctNums) : null;

  // A newly-created agency must capture a contact email (its default contact).
  const agencyEmailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(org.agencyContactEmail);
  const orgContactError = org.agencyNew && !agencyEmailOk;
  // An admin fly-creating an agency must choose the partner it lands under (#66).
  const orgPartnerError = org.agencyNew && role === 'superadmin' && !org.partner;
  // A new agency must answer the single-office question before submit (#74).
  const orgOfficeError = org.agencyNew && org.singleOffice === null;
  const isValid = Object.keys(errors).length === 0
    && extraErrors.every((e) => Object.keys(e).length === 0)
    && dupIdx < 0 && !shareErr
    && !orgContactError && !orgPartnerError && !orgOfficeError;

  const set = (k: keyof ReferralValues, v: string) => setValues((prev) => ({ ...prev, [k]: v }));
  const setExtraField = (i: number, k: keyof TenantValues, v: string) =>
    setExtra((prev) => prev.map((t, j) => (j === i ? { ...t, [k]: v } : t)));

  /* ---- adding and removing tenants ------------------------------------
     Adding a tenant RE-SPREADS the shares equally, because the agent who just
     said "there are two of them" means an even split until they say otherwise;
     leaving tenant 1 on 100% and the new one on 0% would be a form that starts
     invalid. Removing does the same, so the shares are never left summing to
     something nobody chose. */
  function addTenant() {
    const n = tenantCount + 1;
    setExtra((prev) => [...prev, newTenant()]);
    setPercents(equalSharePercents(n).map(String));
  }
  function removeTenant(i: number) {
    const n = tenantCount - 1;
    setExtra((prev) => prev.filter((_, j) => j !== i));
    setPercents(equalSharePercents(n).map(String));
  }
  function setPercent(i: number, v: string) {
    setPercents((prev) => prev.map((p, j) => (j === i ? v : p)));
  }
  /** The £ field writes back through the percentage, so there is one stored fact. */
  function setShareAmount(i: number, v: string) {
    const p = percentFromAmount(rentNum, Number(v));
    if (p !== null) setPercent(i, String(p));
  }

  // #103 Native date inputs reject pasted text in common formats; parse it and
  // normalise to yyyy-mm-dd so Rightmove's copy-paste workflow just works.
  const onPasteDate = (field: 'dob' | 'tenancyStart') => (e: ClipboardEvent<HTMLInputElement>) => {
    const parsed = parseFlexibleDate(e.clipboardData.getData('text'));
    if (parsed) { e.preventDefault(); set(field, toISODate(parsed)); }
  };
  const onPasteExtraDob = (i: number) => (e: ClipboardEvent<HTMLInputElement>) => {
    const parsed = parseFlexibleDate(e.clipboardData.getData('text'));
    if (parsed) { e.preventDefault(); setExtraField(i, 'dob', toISODate(parsed)); }
  };
  const markTouched = (k: string) => setTouched((t) => new Set(t).add(k));
  const err = (k: keyof ReferralValues) => ((submitted || touched.has(k)) ? errors[k] : undefined);
  const errX = (i: number, key: string, k: keyof TenantValues) =>
    ((submitted || touched.has(`${key}.${k}`)) ? extraErrors[i]?.[k] : undefined);

  // Native date-input bounds (dd/mm/yyyy display in en-GB; value is yyyy-mm-dd).
  const isoOf = (dd: Date) => `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`;
  const nowD = new Date();
  const dobMax = isoOf(nowD);
  const dobMin = isoOf(new Date(nowD.getFullYear() - 100, nowD.getMonth(), nowD.getDate()));
  const startMin = isoOf(new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate() - 7));
  const startMax = isoOf(new Date(nowD.getFullYear() + 2, nowD.getMonth(), nowD.getDate()));

  /* ---- the price, at the count actually entered -------------------------
     Asked of the server, because the agreement, the band and the penny-exact
     split all live there and a second implementation here is how the form and
     the invoice come to disagree. Debounced: this changes on every keystroke in
     the rent box. */
  /* ---- which rail the chosen origin runs on ----------------------------
     Asked of the server in live mode (origin_referencing_mode), which resolves
     through the very functions create_joint_referral uses, so the form cannot
     offer a button the RPC would refuse. */
  useEffect(() => {
    let live = true;
    if (!values.agency || !values.branch) { setEstate(false); setRailState('none'); return; }
    setRailState('loading');
    void originIsAgentEstate(values.agency, values.branch, org.partner || (partnerScope === ALL_PARTNERS ? undefined : partnerScope))
      .then((v: boolean) => { if (live) { setEstate(v); setRailState('ready'); } });
    return () => { live = false; };
  }, [values.agency, values.branch, org.partner, partnerScope]);

  /* The origin can change AFTER tenants have been added — section 4 sits below
     section 1 — and then the form would be carrying tenants the RPC will refuse.
     They are dropped, and the reason is said out loud.

     ONLY ON A SETTLED ANSWER. Typing in the Branch box clears the picker's
     selection on every keystroke, so keying on "not allowed" threw away
     everything the moment somebody touched that field to correct a typo. The
     tenants survive an incomplete or in-flight origin and are removed only when
     the rail has actually come back as something that cannot carry them. */
  useEffect(() => {
    if (railState !== 'ready') return;
    if (estate) { setRailNote(''); return; }
    if (extra.length === 0) return;
    setExtra([]);
    setPercents([String(DEFAULT_SHARE_PERCENT)]);
    setRailNote('This supplier\u2019s referrals cover one tenant each, so the additional tenants were removed.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railState, estate]);

  const pctKey = percents.join(',');
  useEffect(() => {
    let live = true;
    if (!values.agency || !values.branch || !(rentNum > 0)) { setFee(null); return; }
    const t = setTimeout(() => {
      void previewReferralFee({
        agency: values.agency, branch: values.branch,
        partner: org.partner || (partnerScope === ALL_PARTNERS ? undefined : partnerScope),
        rent: rentNum,
        sharePercents: pctKey.split(',').map(Number),
      }).then((p) => { if (live) setFee(p); });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [values.agency, values.branch, org.partner, partnerScope, rentNum, pctKey]);

  async function runLookup() {
    setLookupBusy(true);
    setLookupMsg('');
    setLookupResults([]);
    const r = await lookupAddresses(lookupPostcode);
    setLookupBusy(false);
    if (!r.available) { setAddrMode('manual'); return; }
    if (r.error) { setLookupMsg(r.error); return; }
    if (!r.addresses.length) { setLookupMsg('No addresses found for that postcode.'); return; }
    setLookupResults(r.addresses);
  }

  function pickAddress(a: AddressOption) {
    setValues((prev) => ({ ...prev, addr1: a.line1, addr2: a.line2, city: a.city, county: a.county, postcode: a.postcode }));
    setTouched((t) => new Set([...t, 'addr1', 'city', 'postcode']));
    setLookupResults([]);
    setAddrMode('manual');
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitted(true);
    setFormError('');
    if (!isValid || busy) return;
    // #5 Soft duplicate guard: warn (never block) if an active referral already
    // exists for this tenant + property. Continue anyway proceeds unconditionally.
    const dup = findActiveReferralByTenantProperty({ role, scope: partnerScope }, values.email.trim(), values.postcode.trim());
    if (dup) { setDupWarn(dup); return; }
    void doCreate();
  }

  async function doCreate() {
    if (busy) return;
    setBusy(true);
    try {
      const tenants = [
        {
          title: values.title, firstName: values.first.trim(), lastName: values.last.trim(),
          middleName: values.middle.trim() || undefined,
          dob: values.dob.trim(), email: values.email.trim(), phone: values.phone.trim(),
          sharePercent: pctNums[0],
          shareAmount: amountFromPercent(rentNum, pctNums[0]) ?? undefined,
        },
        ...extra.map((t, i) => ({
          title: t.title, firstName: t.first.trim(), lastName: t.last.trim(),
          middleName: t.middle.trim() || undefined,
          dob: t.dob.trim(), email: t.email.trim(), phone: t.phone.trim(),
          sharePercent: pctNums[i + 1],
          shareAmount: amountFromPercent(rentNum, pctNums[i + 1]) ?? undefined,
        })),
      ];
      const res = await createReferral({
        ...tenants[0],
        dob: values.dob.trim(),
        addr1: values.addr1.trim(), addr2: values.addr2.trim(), city: values.city.trim(),
        county: values.county.trim(), postcode: values.postcode.trim(),
        rent: rentNum, tenancyStart: values.tenancyStart.trim(),
        agency: values.agency, branch: values.branch,
        // Only ever sent where a joint tenancy is real. createReferral drops a
        // single-entry array anyway, so a sole tenant takes the untouched path.
        tenants: jointAllowed ? tenants : [tenants[0]],
        agencyNew: org.agencyNew, branchNew: org.branchNew,
        agencyContactEmail: org.agencyContactEmail, agencyContactName: org.agencyContactName,
        agencyContactPhone: org.agencyContactPhone, branchContactEmail: org.branchContactEmail,
        // The partner the referral belongs to, resolved by the picker (the
        // chosen agency's own partner, or the admin's selected partner for a
        // fly-created agency). Server ignores it for partner users, whose own
        // partner is authoritative. Fall back to a specific ambient scope.
        partner: org.partner || (partnerScope === ALL_PARTNERS ? undefined : partnerScope),
      });
      await refresh();
      if (res.tenancy?.length) {
        const sent = res.tenancy.filter((t) => t.emailSent).length;
        toast(sent === res.tenancy.length
          ? `Tenancy created. All ${res.tenancy.length} tenants have been emailed.`
          : `Tenancy created. ${sent} of ${res.tenancy.length} tenants were emailed${res.emailError ? ': ' + res.emailError : '.'}`);
      } else {
        toast(res.emailSent
          ? 'Application sent. The tenant payment email was delivered to the review address.'
          : `Application created. Tenant email not sent${res.emailError ? ': ' + res.emailError : '.'}`);
      }
      navigate(`/applications/${res.ref}`);
    } catch (e2) {
      const msg = e2 instanceof Error ? e2.message : 'Could not send the application.';
      setFormError(msg);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || (submitted && !isValid);

  /* ---- one tenant's fields, used for every tenant ----------------------
     The same markup for the first applicant and the fourth, so a rule added to
     one is added to all of them. */
  function tenantFields(opts: {
    idPrefix: string;
    v: TenantValues;
    onField: (k: keyof TenantValues, val: string) => void;
    onBlurField: (k: keyof TenantValues) => void;
    fieldError: (k: keyof TenantValues) => string | undefined;
    onPasteDob: (e: ClipboardEvent<HTMLInputElement>) => void;
    emailError?: string;
  }) {
    const { idPrefix: p, v, onField, onBlurField, fieldError, onPasteDob, emailError } = opts;
    return (
      <div className="form-grid">
        <Field label={<>Title <Req /></>} htmlFor={`${p}-title`} style={{ maxWidth: 140 }} error={fieldError('title')}>
          <select id={`${p}-title`} name={`${p}-title`} value={v.title} onChange={(e) => onField('title', e.target.value)} onBlur={() => onBlurField('title')}>
            <option value="" disabled>Select…</option>
            {TITLE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <div className="field span-2" style={{ gridColumn: '2 / 3' }} />
        <Field label={<>First name <Req /></>} htmlFor={`${p}-first`} error={fieldError('first')}>
          <input id={`${p}-first`} type="text" placeholder="Amelia" value={v.first} onChange={(e) => onField('first', e.target.value)} onBlur={() => onBlurField('first')} />
        </Field>
        <Field label="Middle name" htmlFor={`${p}-middle`} hint="If they have one. The eligibility check runs against their legal name.">
          <input id={`${p}-middle`} type="text" placeholder="Rose" value={v.middle} onChange={(e) => onField('middle', e.target.value)} />
        </Field>
        <Field label={<>Last name <Req /></>} htmlFor={`${p}-last`} error={fieldError('last')}>
          <input id={`${p}-last`} type="text" placeholder="Hartley" value={v.last} onChange={(e) => onField('last', e.target.value)} onBlur={() => onBlurField('last')} />
        </Field>
        <Field label={<>Date of birth <Req /></>} htmlFor={`${p}-dob`} error={fieldError('dob')}>
          <input id={`${p}-dob`} type="date" min={dobMin} max={dobMax} value={v.dob} onChange={(e) => onField('dob', e.target.value)} onPaste={onPasteDob} onBlur={() => onBlurField('dob')} />
        </Field>
        <Field label={<>Email <Req /></>} htmlFor={`${p}-email`} error={emailError ?? fieldError('email')}>
          <input id={`${p}-email`} type="email" placeholder="amelia@example.com" value={v.email} onChange={(e) => onField('email', e.target.value)} onBlur={() => onBlurField('email')} />
        </Field>
        <Field label={<>Phone <Req /></>} htmlFor={`${p}-phone`} error={fieldError('phone')}>
          <input id={`${p}-phone`} type="tel" placeholder="07700 900000" value={v.phone} onChange={(e) => onField('phone', e.target.value)} onBlur={() => onBlurField('phone')} />
        </Field>
      </div>
    );
  }

  const tenantNames = [values.first.trim() || 'Tenant 1', ...extra.map((t, i) => t.first.trim() || `Tenant ${i + 2}`)];

  /* One element, two homes: inside section 4 where there is a question to ask,
     and bare in the form where there is not. Written once so the two cannot
     drift on what the form does with the answer. */
  const picker = (
    <AgentBranchPicker onChange={(v) => {
      setOrgShape(v.shape);
      setValues((prev) => ({ ...prev, agency: v.agency, branch: v.branch }));
      setOrg({ agencyNew: v.agencyNew, branchNew: v.branchNew, agencyContactEmail: v.agencyContactEmail, agencyContactName: v.agencyContactName, agencyContactPhone: v.agencyContactPhone, branchContactEmail: v.branchContactEmail, partner: v.partner, singleOffice: v.singleOffice });
    }} />
  );

  return (
    <>
      <div className="page-head">
        <div>
          <Eyebrow>New referral</Eyebrow>
          <h1 className="page-head__title" style={{ marginTop: 10 }}>New application</h1>
          <p className="page-head__sub">Refer a failed-referencing tenant to opndoor's professional guarantor service, where opndoor provides a Deed of Guarantee in favour of the property. Complete each section, then send the application. Fields marked <span className="req">*</span> are required.</p>
        </div>
        <div className="page-head__actions">
          <Button variant="ghost" size="sm" to="/applications">Cancel</Button>
          <Button variant="primary" size="sm" type="submit" form="na-form" arrow disabled={disabled}>{busy ? 'Sending…' : 'Send application'}</Button>
        </div>
      </div>

      <div className="na-grid">
        <form className="na-form" id="na-form" onSubmit={submit} noValidate>
          {/* 1. TENANTS */}
          <section className="card sec" id="sec-tenant">
            <div className="sec__head"><span className="sec__num">1</span><div>
              <div className="sec__title">{joint ? 'Tenants' : 'Tenant'}</div>
              <div className="sec__sub">{joint ? `${tenantCount} tenants on one tenancy, one guarantee` : 'The tenant being referred'}</div>
            </div></div>
            <CardBody>
              {joint && <div className="tn-label">Tenant 1</div>}
              {tenantFields({
                idPrefix: 't',
                v: values,
                onField: (k, val) => set(k as keyof ReferralValues, val),
                onBlurField: (k) => markTouched(k),
                fieldError: (k) => err(k as keyof ReferralValues),
                onPasteDob: onPasteDate('dob'),
                emailError: dupIdx === 0 ? 'Two tenants cannot share an email address.' : undefined,
              })}

              {extra.map((t, i) => (
                <div className="tn-extra" key={t.key}>
                  <div className="tn-label">
                    <span>Tenant {i + 2}</span>
                    <button type="button" className="tn-remove" onClick={() => removeTenant(i)}>Remove</button>
                  </div>
                  {tenantFields({
                    idPrefix: `x${i}`,
                    v: t,
                    onField: (k, val) => setExtraField(i, k, val),
                    onBlurField: (k) => markTouched(`${t.key}.${k}`),
                    fieldError: (k) => errX(i, t.key, k),
                    onPasteDob: onPasteExtraDob(i),
                    emailError: dupIdx === i + 1 ? 'Two tenants cannot share an email address.' : undefined,
                  })}
                </div>
              ))}

              {/* MULTI-TENANT IS OFFERED ONLY WHERE A JOINT TENANCY IS REAL.
                  On a pre-referenced rail the references are done before the
                  referral reaches us and each one covers a single tenant, so
                  the control is not offered rather than offered and refused.
                  Before an origin is chosen the rail is not yet knowable, so the
                  control is present but disabled and says what is missing. */}
              {jointAllowed ? (
                <button type="button" className="tn-add" onClick={addTenant}>
                  <Icon name="plus" /> Add another tenant
                </button>
              ) : (
                <div className="tn-gate">
                  <button type="button" className="tn-add" disabled aria-describedby="tn-gate-why">
                    <Icon name="plus" /> Add another tenant
                  </button>
                  <p className="tn-gate__why" id="tn-gate-why">
                    {railState === 'none'
                      ? 'Choose the agent and branch first: whether a referral can cover more than one tenant depends on who it is for.'
                      : railState === 'loading'
                        ? 'Checking this agent\u2026'
                        : 'This supplier sends us referrals one tenant at a time. Refer each tenant separately.'}
                  </p>
                </div>
              )}
              {railNote && <p className="tn-gate__why" role="status">{railNote}</p>}
            </CardBody>
          </section>

          {/* 2. PROPERTY */}
          <section className="card sec" id="sec-property">
            <div className="sec__head"><span className="sec__num">2</span><div><div className="sec__title">Property</div><div className="sec__sub">The address being let</div></div></div>
            <CardBody>
              {addrMode === 'lookup' ? (
                <div className="addr-lookup">
                  <div className="addr-lookup__row">
                    <Field label="Find address by postcode" htmlFor="addr-pc" style={{ flex: 1 }}>
                      <input id="addr-pc" type="text" placeholder="e.g. SW7 3LA" value={lookupPostcode}
                        onChange={(e) => setLookupPostcode(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runLookup(); } }} />
                    </Field>
                    <Button type="button" variant="dark" onClick={() => void runLookup()} disabled={lookupBusy || !lookupPostcode.trim()}>
                      {lookupBusy ? 'Searching…' : 'Find address'}
                    </Button>
                  </div>
                  {lookupMsg && <p className="addr-lookup__msg">{lookupMsg}</p>}
                  {lookupResults.length > 0 && (
                    <div className="addr-results" role="listbox" aria-label="Addresses">
                      {lookupResults.map((a, i) => (
                        <button type="button" className="addr-result" key={i} onClick={() => pickAddress(a)}>
                          <Icon name="home" /> <span>{a.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <button type="button" className="addr-toggle" onClick={() => setAddrMode('manual')}>Enter address manually</button>
                </div>
              ) : (
                <>
                  <div className="form-grid">
                    <Field label={<>Address line 1 <Req /></>} htmlFor="p-l1" span2 error={err('addr1')}>
                      <input id="p-l1" type="text" placeholder="Flat 4, 18 Onslow Gardens" value={values.addr1} onChange={(e) => set('addr1', e.target.value)} onBlur={() => markTouched('addr1')} />
                    </Field>
                    <Field label="Address line 2" htmlFor="p-l2" hint="Optional" span2>
                      <input id="p-l2" type="text" value={values.addr2} onChange={(e) => set('addr2', e.target.value)} />
                    </Field>
                    <Field label={<>City / town <Req /></>} htmlFor="p-city" error={err('city')}>
                      <input id="p-city" type="text" placeholder="London" value={values.city} onChange={(e) => set('city', e.target.value)} onBlur={() => markTouched('city')} />
                    </Field>
                    <Field label="County" htmlFor="p-county" hint="Optional">
                      <input id="p-county" type="text" placeholder="Greater London" value={values.county} onChange={(e) => set('county', e.target.value)} />
                    </Field>
                    <Field label={<>Postcode <Req /></>} htmlFor="p-post" style={{ maxWidth: 220 }} error={err('postcode')}>
                      <input id="p-post" type="text" placeholder="SW7 3LA" value={values.postcode} onChange={(e) => set('postcode', e.target.value)} onBlur={() => markTouched('postcode')} />
                    </Field>
                  </div>
                  {lookupAvailable && (
                    <button type="button" className="addr-toggle" onClick={() => { setAddrMode('lookup'); setLookupResults([]); setLookupMsg(''); }}>Find address by postcode instead</button>
                  )}
                </>
              )}
            </CardBody>
          </section>

          {/* 3. TENANCY */}
          <section className="card sec" id="sec-tenancy">
            <div className="sec__head"><span className="sec__num">3</span><div><div className="sec__title">Tenancy</div><div className="sec__sub">Rent{joint ? ', shares' : ''} and start date</div></div></div>
            <CardBody>
              <div className="form-grid">
                <Field label={<>Monthly rent (£) <Req /></>} htmlFor="ty-rent" error={err('rent')}
                  hint={joint ? 'The whole property. Each tenant’s share is set below.' : undefined}>
                  <input id="ty-rent" type="number" min="1" step="1" placeholder="2450" value={values.rent}
                    onChange={(e) => set('rent', e.target.value)}
                    onBlur={() => markTouched('rent')} />
                </Field>
                <Field label={<>Tenancy start date <Req /></>} htmlFor="ty-start" error={err('tenancyStart')}>
                  <input id="ty-start" type="date" min={startMin} max={startMax} value={values.tenancyStart} onChange={(e) => set('tenancyStart', e.target.value)} onPaste={onPasteDate('tenancyStart')} onBlur={() => markTouched('tenancyStart')} />
                </Field>
              </div>

              {/* THE SHARES, and only when there is something to share.
                  A sole tenant carries 100% and is never asked. Each row's %
                  and £ derive from one another as you type, and the PERCENTAGE
                  is what is stored: it is the commercial fact the tenants
                  agreed, and re-deriving it later against a corrected rent
                  would restate the basis of a decision already made. */}
              {joint && (
                <div className="shares">
                  <div className="shares__head">
                    <span>Each tenant’s share of the rent</span>
                    <span className="shares__tot">{pctNums.reduce((s, p) => s + (Number.isFinite(p) ? p : 0), 0).toFixed(3).replace(/\.?0+$/, '')}% of 100%</span>
                  </div>
                  {tenantNames.map((name, i) => {
                    const amt = amountFromPercent(rentNum, pctNums[i]);
                    return (
                      <div className="shares__row" key={i}>
                        <span className="shares__who">{name}</span>
                        <label className="shares__in">
                          <input type="number" min="0" max="100" step="0.001" aria-label={`${name} share percent`}
                            value={percents[i] ?? ''} onChange={(e) => setPercent(i, e.target.value)} />
                          <span>%</span>
                        </label>
                        <label className="shares__in">
                          <span>£</span>
                          <input type="number" min="0" step="0.01" aria-label={`${name} share amount`}
                            value={amt === null ? '' : String(amt)} onChange={(e) => setShareAmount(i, e.target.value)} />
                        </label>
                      </div>
                    );
                  })}
                  {shareErr && <p className="field-error" style={{ marginTop: 8 }}>{shareErr}</p>}
                </div>
              )}

              {/* WHAT IT COSTS, at the tenant count actually entered, before it
                  is sent. The agreement's band can change the price when a
                  second tenant is added, and the agent should see that here
                  rather than on the tenant's checkout page. */}
              {fee && (
                <div className="feebox">
                  <div className="feebox__head">
                    <span>Guarantee fee{joint ? ' for this tenancy' : ''}</span>
                    <strong>{money(fee.feeAmount)}</strong>
                  </div>
                  <div className="feebox__basis">
                    {feeBasisLabel(fee)}{fee.isStandard ? '' : ` · agreed terms at ${tenantCount} tenant${tenantCount === 1 ? '' : 's'}`}
                  </div>
                  {joint && (
                    <div className="feebox__rows">
                      {tenantNames.map((name, i) => (
                        <div className="feebox__row" key={i}>
                          <span>{name}</span>
                          <span>{pctNums[i]}%</span>
                          <strong>{fee.shares[i] === undefined ? '-' : money(fee.shares[i])}</strong>
                        </div>
                      ))}
                      <p className="feebox__note">Each tenant pays their own share through their own payment link.</p>
                    </div>
                  )}
                </div>
              )}

              {/* NOTHING ABOUT THE OFFICE HERE, and nothing anywhere else on the
                  form either. A line reading "This referral is against Regent's
                  Lettings, Regent's Park" used to sit here, on the principle that
                  the fact was worth keeping even once the section asking for it had
                  gone. It is not: somebody filing a referral from their only office
                  knows which office they work at, and the line was the last of the
                  furniture that section 4 used to be. Withdrawn.

                  What remains for a single-office user is the submit-time error
                  below, which is a different thing: it fires only when the office
                  could not be resolved at all, and without it Send would refuse
                  silently with no field to hang the reason on. */}
            </CardBody>
          </section>

          {/* 4. AGENT & BRANCH, when there is more than one answer to give.

              ONE SLOT FOR THE PICKER, ALWAYS, AND THIS IS LOAD BEARING.

              This used to be a ternary: the picker inside this <section> when
              there was a question to ask, and bare in a fragment when there was
              not. Two positions in the tree for one element, so the moment the
              shape resolved and oneOffice flipped, React unmounted the picker and
              mounted a new one. A fresh picker has no shape, so oneOffice flipped
              straight back, which moved it again. The form sat in a remount loop,
              thousands of rounds a second.

              Every symptom reported from the walk was that loop:

                section 4 showed the full admin picker with an agency search and
                an add-on-the-fly option, because a newly mounted picker has not
                been told who is reading yet and that was the state it spent most
                of its life in;

                "Checking this agent..." never finished and "Add another tenant"
                never enabled, because each remount cleared the agency and branch
                and restarted the rail check;

                the fee panel never appeared, because it needs an agency and a
                branch and those were being wiped several times a frame.

              So the section's CHROME is conditional and the picker's position is
              not. When there is nothing to ask, the whole section is display:none
              (it contains only the picker, which renders null then anyway) and
              the office is stated as one line under Tenancy instead. */}
          <section className={oneOffice ? 'sec-quiet' : 'card sec'} id="sec-branch">
            {!oneOffice && (
              <div className="sec__head"><span className="sec__num">4</span><div><div className="sec__title">{orgCopy.title} <Req /></div><div className="sec__sub">{orgCopy.sub}</div></div></div>
            )}
            <CardBody>
              {picker}
              {!oneOffice && <>
                {submitted && orgPartnerError && <p className="na-form-error" style={{ marginTop: 8 }}>Select the partner this new agency belongs to.</p>}
                {submitted && orgOfficeError && <p className="na-form-error" style={{ marginTop: 8 }}>Tell us whether this is a single-office agency.</p>}
                {submitted && orgContactError && <p className="na-form-error" style={{ marginTop: 8 }}>Enter a contact email for the new agency.</p>}
                {submitted && !orgOfficeError && (errors.agency || errors.branch) && (
                  <span className="field-error" style={{ marginTop: 10 }}>Select an agent and a branch.</span>
                )}
              </>}
            </CardBody>
          </section>
          {/* Outside the hidden section, because it has to be readable. The
              reader cannot fix this and still has to be told: with the section
              gone there is no field to hang an error on, and a Send button that
              quietly does nothing is the worse failure. */}
          {oneOffice && submitted && (errors.agency || errors.branch) && (
            <p className="na-form-error">We could not work out which office this referral is against. Reload the page, and tell us if it happens again.</p>
          )}

          <div style={{ marginTop: 6 }}>
            <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', margin: '0 0 12px' }}>Guarantee reference, issue date and expiry are assigned automatically.</p>
            {formError && <p className="na-form-error">{formError}</p>}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <Button variant="ghost" to="/applications">Cancel</Button>
              <Button variant="primary" type="submit" arrow disabled={disabled}>{busy ? 'Sending…' : 'Send application'}</Button>
            </div>
          </div>
        </form>

        {/* RAIL */}
        <aside className="na-rail">
          <Card>
            <CardBody style={{ padding: 16 }}>
              <div className="navrail">
                <a href="#sec-tenant" className="is-active"><span className="dot" />{joint ? 'Tenants' : 'Tenant'}</a>
                <a href="#sec-property"><span className="dot" />Property</a>
                <a href="#sec-tenancy"><span className="dot" />Tenancy</a>
                {/* No link to a section that is not on the page. */}
                {!oneOffice && <a href="#sec-branch"><span className="dot" />Agent &amp; branch</a>}
              </div>
            </CardBody>
          </Card>
        </aside>
      </div>

      {/* #5 Duplicate-referral soft warning (never blocks). */}
      <Modal
        open={!!dupWarn}
        onClose={() => setDupWarn(null)}
        width={460}
        title="Possible duplicate referral"
        footer={<>
          <Button variant="ghost" onClick={() => setDupWarn(null)}>Go back</Button>
          <Button variant="primary" onClick={() => { setDupWarn(null); void doCreate(); }}>Continue anyway</Button>
        </>}
      >
        <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.6, margin: 0 }}>
          A referral for this tenant at this property already exists ({dupWarn?.ref}, {dupWarn?.statusLabel}). Continue anyway?
        </p>
      </Modal>
    </>
  );
}
