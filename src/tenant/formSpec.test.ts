/* Locks the parts of the tenant form spec that are easy to break silently:
   the conditional reveals, the per-type field sets, and the three-year rule. */
import { describe, expect, it } from 'vitest';
import {
  ADDITIONAL_INCOME_TYPES, BASIC_FIELDS, EMPLOYMENT_TYPES, REQUIRED_HISTORY_MONTHS,
  addressFields, additionalIncomeFields, employmentFields, fieldsComplete, incomeDocKinds, historyMonths,
  validatePhone, validateUkPostcode,
  type FieldSpec,
} from './formSpec';

const shown = (fields: ReturnType<typeof employmentFields>, values: Record<string, unknown>) =>
  fields.filter((f) => !f.when || f.when(values)).map((f) => f.name);

describe('the document’s type lists are complete', () => {
  it('eleven situations (nine employment plus savings and benefits) and eighteen additional', () => {
    expect(EMPLOYMENT_TYPES).toHaveLength(11);
    expect(EMPLOYMENT_TYPES.map((t) => t.value)).toContain('savings');
    expect(EMPLOYMENT_TYPES.map((t) => t.value)).toContain('universal_credit');
    expect(ADDITIONAL_INCOME_TYPES).toHaveLength(18);
  });
});

describe('adverse credit reveals in a ladder, not all at once', () => {
  it('asks nothing further until adverse credit is yes', () => {
    const names = shown(BASIC_FIELDS, {});
    expect(names).toContain('adverse_credit');
    expect(names).not.toContain('ccjs');
    expect(names).not.toContain('bankrupt');
  });

  it('asks the three headlines on yes, and their detail only on their own yes', () => {
    const headline = shown(BASIC_FIELDS, { adverse_credit: 'yes' });
    expect(headline).toEqual(expect.arrayContaining(['ccjs', 'bankrupt', 'iva']));
    expect(headline).not.toContain('ccjs_count');

    const withCcj = shown(BASIC_FIELDS, { adverse_credit: 'yes', ccjs: 'yes' });
    expect(withCcj).toEqual(expect.arrayContaining(['ccjs_count', 'ccjs_total_value', 'ccjs_most_recent']));
    // A CCJ answer must not drag the bankruptcy detail out with it.
    expect(withCcj).not.toContain('bankrupt_date');
  });
});

describe('employment field sets follow the type', () => {
  it('a permanent employee is asked for an employer and a referee', () => {
    const names = shown(employmentFields('permanent'), {});
    expect(names).toEqual(expect.arrayContaining(['employer_name', 'referee_name', 'referee_email', 'pay_basis']));
  });

  it('a homemaker is asked for income, not a start date', () => {
    // The wage assumption is gone: a non-employment situation has no start date.
    const shownFields = shown(employmentFields('homemaker'), {});
    expect(shownFields).not.toContain('start_date');
    expect(shownFields).toContain('amount');
  });

  it('a student is asked for a maintenance loan, family support and part-time, not a start date', () => {
    const shownFields = shown(employmentFields('student'), {});
    expect(shownFields).toEqual(['maintenance_loan', 'family_support', 'amount']);
  });

  it('a savings-route applicant is asked only for savings, no income', () => {
    const shownFields = shown(employmentFields('savings'), {});
    expect(shownFields).toEqual(['savings_amount']);
    // Complete on savings alone, no wage.
    expect(fieldsComplete(employmentFields('savings'), { savings_amount: 20000 })).toBe(true);
  });

  it('benefits collect an amount and a frequency', () => {
    const shownFields = shown(employmentFields('universal_credit'), {});
    expect(shownFields).toEqual(['amount', 'amount_frequency']);
  });

  it('a retiree is asked for a pension, not a start date', () => {
    const shownFields = shown(employmentFields('retired'), {});
    expect(shownFields).not.toContain('start_date');
    expect(shownFields).toContain('pension_income');
  });

  it('hourly pay reveals the hours question, salary does not', () => {
    const hourly = shown(employmentFields('permanent'), { pay_basis: 'hourly_rate' });
    expect(hourly).toEqual(expect.arrayContaining(['hourly_rate', 'weekly_hours']));
    expect(hourly).not.toContain('annual_salary');

    const salaried = shown(employmentFields('permanent'), { pay_basis: 'annual_salary' });
    expect(salaried).toContain('annual_salary');
    expect(salaried).not.toContain('weekly_hours');
  });

  it('self-employed without an accountant states income, no referee, and needs tax returns as a document', () => {
    const noAcc = shown(employmentFields('self_employed'), { has_accountant: 'no' });
    expect(noAcc).toContain('annual_salary');
    expect(noAcc).not.toContain('accountant_name');
    // The upload is a real Documents-flow doc now, not a dead kind:'file' field.
    expect(noAcc).not.toContain('doc_tax_return');
    expect(incomeDocKinds({ income_type: 'self_employed', has_accountant: 'no' }).map((d) => d.kind))
      .toContain('tax_return');
  });

  it('retired states pension income; the P60 and a bank statement are Documents-flow uploads', () => {
    const names = shown(employmentFields('retired'), {});
    expect(names).toContain('pension_income');
    expect(names).not.toContain('doc_p60_or_pension_award');
    const kinds = incomeDocKinds({ income_type: 'retired' }).map((d) => d.kind);
    expect(kinds).toContain('p60_or_pension_award');
    expect(kinds).toContain('bank_statement');
  });

  it('savings and benefits need no supporting document', () => {
    expect(incomeDocKinds({ income_type: 'savings' })).toEqual([]);
    expect(incomeDocKinds({ income_type: 'universal_credit' })).toEqual([]);
  });

  it('second job repeats the employment shape; other additional income does not', () => {
    expect(shown(additionalIncomeFields('second_job'), {})).toContain('employer_name');
    const bonus = shown(additionalIncomeFields('bonus'), {});
    expect(bonus).toEqual(['guaranteed', 'amount', 'amount_frequency']);
  });
});

describe('address history', () => {
  it('asks about arrears only where arrears can exist', () => {
    expect(shown(addressFields(true), { residency_type: 'renting' })).toContain('rental_arrears');
    expect(shown(addressFields(true), { residency_type: 'homeowner' })).not.toContain('rental_arrears');
  });

  it('asks which proof of address on every address, and requires it', () => {
    // The tenant states the kind of proof and uploads a document for each address,
    // so the dropdown is required and present on current and previous alike.
    expect(shown(addressFields(true), {})).toContain('proof_type');
    expect(shown(addressFields(false), {})).toContain('proof_type');
    expect(addressFields(true).find((f) => f.name === 'proof_type')?.required).toBe(true);
    expect(addressFields(false).find((f) => f.name === 'proof_type')?.required).toBe(true);
    // The file itself is a Documents-flow upload, not a broken kind:'file' field.
    expect(shown(addressFields(true), {})).not.toContain('doc_proof_of_address');
  });

  it('counts months from the EARLIEST move-in, not the latest', () => {
    const now = new Date();
    const fiveYearsAgo = now.getFullYear() - 5;
    const oneYearAgo = now.getFullYear() - 1;
    const months = historyMonths([
      { moved_in_year: oneYearAgo, moved_in_month: now.getMonth() + 1 },
      { moved_in_year: fiveYearsAgo, moved_in_month: now.getMonth() + 1 },
    ]);
    expect(months).toBeGreaterThanOrEqual(59);
  });

  it('one recent address does not satisfy three years', () => {
    const now = new Date();
    const months = historyMonths([{ moved_in_year: now.getFullYear(), moved_in_month: now.getMonth() + 1 }]);
    expect(months).toBeLessThan(REQUIRED_HISTORY_MONTHS);
  });

  it('an empty history is zero rather than a crash', () => {
    expect(historyMonths([])).toBe(0);
    expect(historyMonths([{}])).toBe(0);
  });

  it('a half-entered address counts for nothing, not invented coverage', () => {
    // The selects arrive as '' when unset, and Number('') is 0: a blank month used
    // to become December of the year before (a spurious early date), and a blank
    // year silently dropped the row. A partial date must contribute zero.
    expect(historyMonths([{ moved_in_month: '', moved_in_year: '2021' }])).toBe(0);
    expect(historyMonths([{ moved_in_month: '3', moved_in_year: '' }])).toBe(0);
    // A complete address alongside a half-entered one is not pulled off its anchor.
    const now = new Date();
    expect(historyMonths([
      { moved_in_month: String(now.getMonth() + 1), moved_in_year: String(now.getFullYear() - 4) },
      { moved_in_month: '', moved_in_year: '2010' },
    ])).toBe(48);
  });
});

describe('fieldsComplete — a step is done when its required questions are answered', () => {
  const spec: FieldSpec[] = [
    { name: 'a', label: 'A', kind: 'text', required: true },
    { name: 'b', label: 'B', kind: 'text' },
    { name: 'c', label: 'C', kind: 'text', required: true, when: (v) => v.a === 'show' },
  ];

  it('is false while a required field is empty, whitespace, null or missing', () => {
    expect(fieldsComplete(spec, {})).toBe(false);
    expect(fieldsComplete(spec, { a: '' })).toBe(false);
    expect(fieldsComplete(spec, { a: '   ' })).toBe(false);
    expect(fieldsComplete(spec, { a: null })).toBe(false);
  });

  it('is true once every visible required field is answered', () => {
    expect(fieldsComplete(spec, { a: 'x' })).toBe(true);       // c is hidden, b optional
  });

  it('requires a conditional field only once its condition is met', () => {
    expect(fieldsComplete(spec, { a: 'show' })).toBe(false);   // c now visible and required
    expect(fieldsComplete(spec, { a: 'show', c: 'y' })).toBe(true);
  });
});


describe('a tenant phone: UK, UK landline or international, but not an email', () => {
  it('accepts a UK mobile, a UK landline, and an international number in + form', () => {
    for (const ok of ['07700 900123', '07700900123', '020 7946 0000', '0161 496 0000',
                      '+44 7700 900123', '+33 6 12 34 56 78', '+1 (415) 555 2671', '00 33 612345678']) {
      expect(validatePhone(ok)).toBeNull();
    }
  });

  it('rejects an email and obvious nonsense, with a UK-or-international message', () => {
    expect(validatePhone('saddassa@shshs.com')).toMatch(/UK or international/);
    expect(validatePhone('not a phone')).toMatch(/UK or international/);
    expect(validatePhone('123')).toMatch(/UK or international/);
  });

  it('treats an empty phone as a required-check concern, not its own', () => {
    expect(validatePhone('')).toBeNull();
    expect(validatePhone('   ')).toBeNull();
  });

  it('the postcode check takes a full UK postcode and refuses a half-typed one', () => {
    for (const ok of ['S1 1AA', 's11aa', 'SW1A 1AA', 'EC1A1BB']) expect(validateUkPostcode(ok)).toBeNull();
    expect(validateUkPostcode('SW1')).toMatch(/UK postcode/);
    expect(validateUkPostcode('')).toBeNull();
  });
});

describe('fieldsComplete also blocks on a present-but-invalid value', () => {
  const spec: FieldSpec[] = [
    { name: 'phone', label: 'Mobile number', kind: 'tel', required: true, validate: validatePhone },
  ];
  it('is not done while a required phone is present but malformed', () => {
    expect(fieldsComplete(spec, { phone: 'saddassa@shshs.com' })).toBe(false);
  });
  it('is done once the phone is a real number, UK or international', () => {
    expect(fieldsComplete(spec, { phone: '07700 900123' })).toBe(true);
    expect(fieldsComplete(spec, { phone: '+33 6 12 34 56 78' })).toBe(true);
  });
  it('blocks a present-but-invalid OPTIONAL value too', () => {
    const opt: FieldSpec[] = [{ name: 'p', label: 'Contact', kind: 'tel', validate: validatePhone }];
    expect(fieldsComplete(opt, { p: 'not a phone' })).toBe(false);
    expect(fieldsComplete(opt, {})).toBe(true);            // empty optional is fine
    expect(fieldsComplete(opt, { p: '020 7946 0000' })).toBe(true);
  });
});
