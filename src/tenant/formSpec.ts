/* =====================================================================
   The tenant application form, as data.

   WHY A SPEC AND NOT COMPONENTS. The documents specify nine employment types
   whose field sets overlap heavily, eighteen additional income types that mostly
   share one shape, and three years of address history that repeats a block an
   unknown number of times. Written as JSX that is a thousand lines of
   near-duplicate markup, and the day somebody adds a tenth employment type they
   edit it in four places and miss one. Written as data it is a list, the
   renderer is one component, and a new type is one entry.

   THE SOURCE IS THE PROCESS DOCUMENT, not invention. Where it is ambiguous the
   choice is marked DECIDED with the reason.
   ===================================================================== */

export type FieldKind =
  | 'text' | 'email' | 'tel' | 'number' | 'money' | 'date' | 'month' | 'year'
  | 'select' | 'yesno' | 'yesnodk' | 'textarea' | 'postcode' | 'file' | 'checkbox';

export interface FieldSpec {
  name: string;
  label: string;
  kind: FieldKind;
  options?: { value: string; label: string }[];
  /** Shown only when this predicate passes. The conditional reveals in the doc. */
  when?: (v: Record<string, unknown>) => boolean;
  required?: boolean;
  help?: string;
  placeholder?: string;
  /** Accepted upload types, for kind: 'file'. */
  accept?: string;
  /**
   * For kind 'postcode': which fields a chosen address fills in.
   *
   * The lookup returns a whole address, so the control has to write several
   * fields, not just its own. Naming them here rather than hard-coding them in
   * the renderer means the same control serves the property, each address in
   * the history and an employer's address, which have three different field
   * names for the same five things.
   *
   * `single` collapses the address into ONE field, for places that hold it as
   * free text rather than as parts.
   */
  fills?: {
    line1?: string; line2?: string; city?: string; county?: string; postcode?: string;
    single?: string;
  };
}

const YES_NO_NA = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'not_applicable', label: 'Not applicable' },
];

/* ---------------------------------------------------------------------------
   Employment and income types. Nine of the first, eighteen of the second.
   --------------------------------------------------------------------------- */
export const EMPLOYMENT_TYPES = [
  { value: 'permanent',            label: 'Permanent employee' },
  { value: 'self_employed',        label: 'Self-employed or business owner' },
  { value: 'contract',             label: 'Contract worker' },
  { value: 'temporary',            label: 'Temporary employee' },
  { value: 'retired',              label: 'Retired' },
  { value: 'homemaker',            label: 'Homemaker' },
  { value: 'unemployed_or_other',  label: 'Unemployed or other income' },
  { value: 'zero_hours',           label: 'Zero-hours employee' },
  { value: 'student',              label: 'Student' },
  { value: 'savings',              label: 'Living on savings' },
  { value: 'universal_credit',     label: 'Universal Credit or benefits' },
] as const;

export const ADDITIONAL_INCOME_TYPES = [
  { value: 'second_job',           label: 'Second job' },
  { value: 'bonus',                label: 'Bonus' },
  { value: 'commission',           label: 'Commission' },
  { value: 'overtime',             label: 'Overtime' },
  { value: 'pension',              label: 'Pension' },
  { value: 'working_tax_credit',   label: 'Working Tax Credit' },
  { value: 'child_tax_credit',     label: 'Child Tax Credit' },
  { value: 'disability_or_pip',    label: 'Disability Living Allowance or PIP' },
  { value: 'child_maintenance',    label: 'Child maintenance' },
  { value: 'bursary',              label: 'Bursary' },
  { value: 'stipends',             label: 'Stipends' },
  { value: 'sponsorship',          label: 'Sponsorship' },
  { value: 'carers_allowance',     label: "Carer's Allowance" },
  { value: 'housing_benefit',      label: 'Housing benefit' },
  { value: 'income_support',       label: 'Income Support' },
  { value: 'jobseekers_allowance', label: "Jobseeker's Allowance" },
  { value: 'universal_credit',     label: 'Universal Credit' },
  { value: 'student_loan',         label: 'Student loan' },
] as const;

export const RESIDENCY_TYPES = [
  { value: 'renting',                        label: 'Renting from a landlord or letting agent' },
  { value: 'council_or_housing_association', label: 'Council, social or housing association' },
  { value: 'living_with_family_or_friends',  label: 'Living with family or friends' },
  { value: 'student_accommodation',          label: 'Student accommodation' },
  { value: 'homeowner',                      label: 'Homeowner' },
  { value: 'other',                          label: 'Other' },
];

/** The doc only asks about arrears for tenures where arrears can exist. */
const ARREARS_APPLIES = ['renting', 'council_or_housing_association', 'student_accommodation', 'other'];

/* ---------------------------------------------------------------------------
   The employment block, built once and varied by type.

   DECIDED: the document lists a bank statement upload for permanent, contract,
   self-employed, retired and zero-hours but omits it for temporary. That reads
   as an oversight rather than a rule, since a temporary employee's income needs
   the same evidence as a contract worker's, so it is included for temporary
   too. Noted here rather than silently.
   --------------------------------------------------------------------------- */
const WITH_EMPLOYER = ['permanent', 'contract', 'temporary', 'zero_hours'];
const WITH_PAY_BASIS = ['permanent', 'self_employed', 'contract', 'temporary', 'zero_hours'];
const WITH_QUALITY_QS = ['permanent', 'contract', 'temporary', 'zero_hours'];
const WITH_BANK_STATEMENT = ['permanent', 'self_employed', 'contract', 'temporary', 'retired', 'zero_hours'];
const WITH_END_DATE = ['contract', 'temporary'];
const WITH_JOB_TITLE = ['contract', 'temporary', 'zero_hours'];
const WITH_REFEREE = ['permanent', 'self_employed', 'contract', 'temporary', 'zero_hours'];
const WITH_START_DATE = ['permanent', 'self_employed', 'contract', 'temporary', 'zero_hours'];
const AMOUNT_FREQUENCY = [{ value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'annually', label: 'Annually' }];

export function employmentFields(type: string): FieldSpec[] {
  const f: FieldSpec[] = [];
  const has = (list: string[]) => list.includes(type);

  if (has(WITH_EMPLOYER)) {
    f.push({ name: 'employer_name', label: "Your employer's business name", kind: 'text', required: true });
  }
  if (has(WITH_START_DATE)) {
    f.push({ name: 'start_date', label: 'Start date', kind: 'date', required: true });
  }
  if (has(WITH_END_DATE)) {
    f.push({ name: 'end_date', label: 'Contract end date', kind: 'date' });
  }

  if (type === 'self_employed') {
    f.push({ name: 'has_accountant', label: 'Do you have an accountant?', kind: 'yesno' });
    f.push({ name: 'accountant_name', label: 'Accountant name', kind: 'text',
             when: (v) => v.has_accountant === 'yes' });
    f.push({ name: 'accountant_email', label: "Accountant's email address", kind: 'email',
             when: (v) => v.has_accountant === 'yes' });
    // The doc's "no accountant" branch asks for a stated total and two years of
    // tax returns instead of a referee.
    f.push({ name: 'annual_salary', label: 'Your total annual income', kind: 'money',
             when: (v) => v.has_accountant === 'no', required: true });
    f.push({ name: 'doc_tax_return', label: "Your last 2 years' tax returns", kind: 'file',
             accept: '.pdf,.png,.jpg,.jpeg', when: (v) => v.has_accountant === 'no' });
  }

  if (has(WITH_EMPLOYER) || type === 'self_employed') {
    f.push({ name: 'employer_in_uk', label: 'Is that address in the UK?', kind: 'yesno' });
    f.push({ name: 'employer_postcode', label: 'Postcode', kind: 'postcode',
             when: (v) => v.employer_in_uk === 'yes',
             fills: { single: 'employer_address', postcode: 'employer_postcode' } });
    f.push({ name: 'employer_address', label: 'Address', kind: 'textarea' });
  }

  if (has(WITH_JOB_TITLE)) {
    f.push({ name: 'job_title', label: 'Your job title or position', kind: 'text' });
  }

  if (has(WITH_REFEREE)) {
    f.push({ name: 'referee_name', label: 'An appropriate referee', kind: 'text', required: true,
             help: 'Somebody who can confirm this income. We contact them, not you.' });
    f.push({ name: 'referee_email', label: "Their business email address", kind: 'email', required: true });
    f.push({ name: 'referee_phone', label: 'Their telephone number', kind: 'tel' });
  }

  if (has(WITH_PAY_BASIS)) {
    f.push({ name: 'pay_basis', label: 'Is your income an annual salary or paid by the hour?', kind: 'select',
             options: [{ value: 'annual_salary', label: 'Annual salary' }, { value: 'hourly_rate', label: 'Hourly rate' }] });
    f.push({ name: 'annual_salary', label: 'Basic annual salary', kind: 'money',
             when: (v) => v.pay_basis === 'annual_salary' });
    f.push({ name: 'hourly_rate', label: 'Basic hourly rate', kind: 'money',
             when: (v) => v.pay_basis === 'hourly_rate' });
    f.push({ name: 'weekly_hours', label: 'Guaranteed minimum hours each week', kind: 'number',
             when: (v) => v.pay_basis === 'hourly_rate' });
  }

  if (type === 'student') {
    // A student's income is a maintenance loan, help from family and any
    // part-time work. Collected, not judged: the loan is the primary figure.
    f.push({ name: 'maintenance_loan', label: 'Your maintenance loan', kind: 'money', required: true,
             help: 'The amount for the year. Enter 0 if you do not receive one.' });
    f.push({ name: 'family_support', label: 'Money from family or others', kind: 'money',
             help: 'For the year, if anyone helps with your rent or living costs. Optional.' });
    f.push({ name: 'amount', label: 'Part-time income, if you have any', kind: 'money' });
    f.push({ name: 'amount_frequency', label: 'How often', kind: 'select', options: AMOUNT_FREQUENCY,
             when: (v) => Number(v.amount) > 0 });
  }

  if (type === 'savings') {
    // Savings alone, no income. We collect the figure; Lettings decide what it
    // means. No affordability rule is applied here.
    f.push({ name: 'savings_amount', label: 'Total savings or capital available', kind: 'money', required: true });
  }

  if (type === 'universal_credit') {
    f.push({ name: 'amount', label: 'Your benefit income', kind: 'money', required: true });
    f.push({ name: 'amount_frequency', label: 'How often do you receive it?', kind: 'select',
             required: true, options: AMOUNT_FREQUENCY });
  }

  if (type === 'homemaker' || type === 'unemployed_or_other') {
    f.push({ name: 'amount', label: 'Any income you receive', kind: 'money' });
    f.push({ name: 'amount_frequency', label: 'How often', kind: 'select', options: AMOUNT_FREQUENCY,
             when: (v) => Number(v.amount) > 0 });
  }

  if (type === 'retired') {
    f.push({ name: 'pension_income', label: 'Total monthly pension income', kind: 'money', required: true });
    f.push({ name: 'doc_p60_or_pension_award', label: 'Most recent P60 or DWP pension award letter',
             kind: 'file', accept: '.pdf,.png,.jpg,.jpeg' });
  }

  if (has(WITH_BANK_STATEMENT)) {
    f.push({ name: 'doc_bank_statement', label: 'Bank statement', kind: 'file', accept: '.pdf,.png,.jpg,.jpeg',
             help: 'Or link your bank on the Financials tab instead, which is faster.' });
  }

  if (has(WITH_QUALITY_QS)) {
    f.push({ name: 'probation', label: 'Are you subject to a probationary period?', kind: 'yesno' });
    f.push({ name: 'probation_months', label: 'How long is the probationary period, in months?', kind: 'number',
             when: (v) => v.probation === 'yes' });
    f.push({ name: 'disciplinary', label: 'Are you subject to disciplinary action?', kind: 'yesnodk' });
    f.push({ name: 'foreseeable_future', label: 'Is your employment likely to continue for the foreseeable future?', kind: 'yesnodk' });
  }

  return f;
}

/** Additional income. `second_job` repeats the employment shape; the rest share one. */
export function additionalIncomeFields(type: string): FieldSpec[] {
  if (type === 'second_job') return employmentFields('permanent');
  return [
    { name: 'guaranteed', label: 'Is this income guaranteed?', kind: 'select', required: true,
      options: [{ value: 'yes', label: 'Guaranteed' }, { value: 'no', label: 'Not guaranteed' }],
      help: 'Income that is not guaranteed is recorded, but we do not count it towards affordability.' },
    { name: 'amount', label: 'Amount', kind: 'money', required: true },
    { name: 'amount_frequency', label: 'How often do you receive it?', kind: 'select', required: true,
      options: [{ value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'annually', label: 'Annually' }] },
  ];
}

/* ---------------------------------------------------------------------------
   One address in the history.
   --------------------------------------------------------------------------- */
export function addressFields(isCurrent: boolean): FieldSpec[] {
  const f: FieldSpec[] = [
    { name: 'in_uk', label: 'Is this address in the UK?', kind: 'yesno' },
    { name: 'postcode', label: 'Postcode', kind: 'postcode', when: (v) => v.in_uk !== 'no',
      fills: { line1: 'address_1', line2: 'address_2', city: 'city', county: 'county', postcode: 'postcode' } },
    { name: 'flat_number', label: 'Flat number', kind: 'text' },
    { name: 'house_number', label: 'House number', kind: 'text' },
    { name: 'house_name', label: 'House name', kind: 'text' },
    { name: 'address_1', label: 'Address line 1', kind: 'text', required: true },
    { name: 'address_2', label: 'Address line 2', kind: 'text' },
    { name: 'city', label: 'Town or city', kind: 'text', required: true },
    { name: 'county', label: 'County', kind: 'text' },
    { name: 'residency_type', label: 'Type of residency', kind: 'select', options: RESIDENCY_TYPES, required: true },
    { name: 'residency_other_detail', label: 'Tell us more', kind: 'textarea',
      when: (v) => v.residency_type === 'other' },
    { name: 'moved_in_month', label: 'Moved in, month', kind: 'month', required: true },
    { name: 'moved_in_year', label: 'Moved in, year', kind: 'year', required: true },
  ];
  if (isCurrent) {
    f.push({ name: 'proof_type', label: 'Proof of address', kind: 'select',
             options: [
               { value: 'mobile_phone_bill', label: 'Mobile phone bill' },
               { value: 'utility_bill', label: 'Utility bill' },
               { value: 'council_tax', label: 'Council tax bill' },
               { value: 'bank_statement', label: 'Bank statement' },
               { value: 'tenancy_agreement', label: 'Tenancy agreement' },
             ] });
    // The file is uploaded through the real Documents flow (kind
    // proof_of_address) on the address step, not a kind:'file' form field, which
    // has no renderer. The proof_type dropdown above stays, asking which kind.
  }
  f.push({ name: 'rental_arrears', label: 'Have you had any rental arrears in the past 3 years?',
           kind: 'select', options: YES_NO_NA, required: true,
           when: (v) => ARREARS_APPLIES.includes(String(v.residency_type ?? '')) });
  f.push({ name: 'rental_arrears_detail', label: 'Please tell us about your rental arrears', kind: 'textarea',
           when: (v) => v.rental_arrears === 'yes' });
  return f;
}

/* ---------------------------------------------------------------------------
   Basic information, including the adverse credit ladder.
   --------------------------------------------------------------------------- */
export const BASIC_FIELDS: FieldSpec[] = [
  { name: 'title', label: 'Title', kind: 'select', required: true, options:
      ['Mr', 'Mrs', 'Miss', 'Ms', 'Mx', 'Dr'].map((t) => ({ value: t, label: t })) },
  { name: 'first_name', label: 'First name', kind: 'text', required: true },
  { name: 'last_name', label: 'Last name', kind: 'text', required: true },
  { name: 'other_names', label: 'Have you been known by any other name?', kind: 'yesno' },
  { name: 'maiden_name', label: 'Other name or maiden name', kind: 'text',
    when: (v) => v.other_names === 'yes' },
  { name: 'phone', label: 'Mobile number', kind: 'tel', required: true },
  { name: 'dob', label: 'Date of birth', kind: 'date', required: true },
  { name: 'marital_status', label: 'Marital status', kind: 'select', options: [
      { value: 'single', label: 'Single' }, { value: 'married', label: 'Married' },
      { value: 'civil_partnership', label: 'Civil partnership' }, { value: 'divorced', label: 'Divorced' },
      { value: 'widowed', label: 'Widowed' }, { value: 'prefer_not_to_say', label: 'Prefer not to say' } ] },

  { name: 'adverse_credit', label: 'Have you had any adverse credit in the last six years?', kind: 'yesno',
    required: true, help: 'Answering yes does not rule you out. It tells us what to expect.' },

  { name: 'ccjs', label: 'Have you received any CCJs or decrees?', kind: 'yesno',
    when: (v) => v.adverse_credit === 'yes' },
  { name: 'ccjs_count', label: 'How many?', kind: 'number', when: (v) => v.ccjs === 'yes' },
  { name: 'ccjs_total_value', label: 'Total combined value', kind: 'money', when: (v) => v.ccjs === 'yes' },
  { name: 'ccjs_most_recent', label: 'Date of the most recent one', kind: 'date', when: (v) => v.ccjs === 'yes' },

  { name: 'bankrupt', label: 'Have you ever been declared bankrupt or sequestrated?', kind: 'yesno',
    when: (v) => v.adverse_credit === 'yes' },
  { name: 'bankrupt_date', label: 'Date of the latest bankruptcy or sequestration', kind: 'date',
    when: (v) => v.bankrupt === 'yes' },

  { name: 'iva', label: 'Have you entered into any IVAs or trust deeds?', kind: 'yesno',
    when: (v) => v.adverse_credit === 'yes' },
  { name: 'iva_date', label: 'Date you entered it', kind: 'date', when: (v) => v.iva === 'yes' },
  { name: 'iva_value', label: 'Total value', kind: 'money', when: (v) => v.iva === 'yes' },
];

/* DECIDED: the document collects nationality as a free select and separately
   asks a right-to-rent category. Both are kept, because they answer different
   questions: nationality is a fact about the person and the category is what
   the referencing provider needs to run the check. */
export const NATIONALITY_FIELDS: FieldSpec[] = [
  { name: 'nationality', label: 'Your nationality', kind: 'text', required: true },
  { name: 'right_to_rent_category', label: 'Which describes you?', kind: 'select', required: true, options: [
      { value: 'uk_or_irish',     label: 'I am a British or Irish citizen' },
      { value: 'eea_or_swiss',    label: 'I am an EEA or Swiss national' },
      { value: 'settled_status',  label: 'I have settled or pre-settled status' },
      { value: 'visa',            label: 'I have a visa or biometric residence permit' },
      { value: 'other',           label: 'Something else' },
    ] },
];

/* DECIDED: the legacy system captured a drawn signature on a canvas here. That
   is dropped along with the rest of the canvas capture, because the deed is
   signed in PandaDoc and a second, weaker signature on the declaration would
   look like it carried the same weight. This is a typed confirmation instead,
   which is what it always was: an assertion that the answers are true. */
export const DECLARATION_FIELDS: FieldSpec[] = [
  { name: 'declaration_note', label: 'Is there anything else you want to tell us?', kind: 'textarea',
    help: 'Optional. Context here can only help.' },
  { name: 'declared_name', label: 'Type your full name to confirm', kind: 'text', required: true },
  { name: 'declared_true', label: 'Everything I have given is true and complete to the best of my knowledge.',
    kind: 'checkbox', required: true },
];

export const AGENT_FIELDS: FieldSpec[] = [
  { name: 'kind', label: 'Who manages the property?', kind: 'select', required: true, options: [
      { value: 'letting_agent',    label: 'A letting agent' },
      { value: 'private_landlord', label: 'A private landlord' } ] },
  { name: 'agency_name', label: 'Letting agency name', kind: 'text', required: true,
    when: (v) => v.kind === 'letting_agent' },
  { name: 'title', label: 'Title', kind: 'select', when: (v) => v.kind === 'private_landlord',
    options: ['Mr', 'Mrs', 'Miss', 'Ms', 'Mx', 'Dr'].map((t) => ({ value: t, label: t })) },
  { name: 'first_name', label: 'First name', kind: 'text', when: (v) => v.kind === 'private_landlord' },
  { name: 'last_name', label: 'Last name', kind: 'text', required: true,
    when: (v) => v.kind === 'private_landlord' },
  { name: 'email', label: 'Email address', kind: 'email', required: true,
    help: 'We send the completed Deed of Guarantee here.' },
  { name: 'phone', label: 'Contact number', kind: 'tel' },
];

export const PROPERTY_FIELDS: FieldSpec[] = [
  { name: 'prop_postcode', label: 'Property postcode', kind: 'postcode', required: true,
    fills: { line1: 'prop_addr1', line2: 'prop_addr2', city: 'prop_city', county: 'prop_county', postcode: 'prop_postcode' } },
  { name: 'prop_addr1', label: 'Address line 1', kind: 'text', required: true },
  { name: 'prop_addr2', label: 'Address line 2', kind: 'text' },
  { name: 'prop_city', label: 'Town or city', kind: 'text', required: true },
  { name: 'prop_county', label: 'County', kind: 'text' },
  { name: 'monthly_rent', label: 'Monthly rent', kind: 'money', required: true },
  { name: 'tenancy_start', label: 'Tenancy start date', kind: 'date', required: true },
];

/** Months of history a set of addresses covers, mirroring address_history_months in SQL. */
export function historyMonths(addresses: Record<string, unknown>[]): number {
  const dates = addresses
    .map((a) => {
      const y = Number(a.moved_in_year); const m = Number(a.moved_in_month);
      return Number.isFinite(y) && Number.isFinite(m) && y > 1900 ? new Date(y, m - 1, 1) : null;
    })
    .filter(Boolean) as Date[];
  if (!dates.length) return 0;
  const earliest = new Date(Math.min(...dates.map((d) => d.getTime())));
  const now = new Date();
  return Math.max(0, (now.getFullYear() - earliest.getFullYear()) * 12 + (now.getMonth() - earliest.getMonth()));
}

export const REQUIRED_HISTORY_MONTHS = 36;

/**
 * Whether every REQUIRED, currently-visible field in a spec list is answered.
 *
 * This is what a step's completeness must be counted from: a step is done when
 * its questions are answered, not when a related metric (address months, an
 * income row existing) crosses a line. Honouring `when` means a field hidden by
 * an earlier answer is not required, and honouring `required` means only the
 * fields that must be filled gate the step. Empty string, null and undefined
 * are all "not answered".
 */
export function fieldsComplete(fields: FieldSpec[], values: Record<string, unknown>): boolean {
  return fields.every((f) => {
    if (f.when && !f.when(values)) return true;
    if (!f.required) return true;
    const v = values[f.name];
    return v !== undefined && v !== null && String(v).trim() !== '';
  });
}
