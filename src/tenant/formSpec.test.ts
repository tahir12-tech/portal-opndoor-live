/* Locks the parts of the tenant form spec that are easy to break silently:
   the conditional reveals, the per-type field sets, and the three-year rule. */
import { describe, expect, it } from 'vitest';
import {
  ADDITIONAL_INCOME_TYPES, BASIC_FIELDS, EMPLOYMENT_TYPES, REQUIRED_HISTORY_MONTHS,
  addressFields, additionalIncomeFields, employmentFields, historyMonths,
} from './formSpec';

const shown = (fields: ReturnType<typeof employmentFields>, values: Record<string, unknown>) =>
  fields.filter((f) => !f.when || f.when(values)).map((f) => f.name);

describe('the document’s type lists are complete', () => {
  it('nine employment types and eighteen additional income types', () => {
    expect(EMPLOYMENT_TYPES).toHaveLength(9);
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

  it('a homemaker is asked for a start date and nothing else', () => {
    expect(shown(employmentFields('homemaker'), {})).toEqual(['start_date']);
  });

  it('a student is asked for a start date and nothing else', () => {
    expect(shown(employmentFields('student'), {})).toEqual(['start_date']);
  });

  it('hourly pay reveals the hours question, salary does not', () => {
    const hourly = shown(employmentFields('permanent'), { pay_basis: 'hourly_rate' });
    expect(hourly).toEqual(expect.arrayContaining(['hourly_rate', 'weekly_hours']));
    expect(hourly).not.toContain('annual_salary');

    const salaried = shown(employmentFields('permanent'), { pay_basis: 'annual_salary' });
    expect(salaried).toContain('annual_salary');
    expect(salaried).not.toContain('weekly_hours');
  });

  it('self-employed without an accountant is asked for tax returns instead of a referee email', () => {
    const noAcc = shown(employmentFields('self_employed'), { has_accountant: 'no' });
    expect(noAcc).toContain('doc_tax_return');
    expect(noAcc).not.toContain('accountant_name');
  });

  it('retired is asked for pension income and the award letter', () => {
    const names = shown(employmentFields('retired'), {});
    expect(names).toEqual(expect.arrayContaining(['pension_income', 'doc_p60_or_pension_award']));
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

  it('asks for proof of address on the current address only', () => {
    expect(shown(addressFields(true), {})).toContain('doc_proof_of_address');
    expect(shown(addressFields(false), {})).not.toContain('doc_proof_of_address');
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
});
