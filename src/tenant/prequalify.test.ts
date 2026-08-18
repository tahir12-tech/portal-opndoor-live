/* The prequalification's rules, and the one thing it is never allowed to say.

   These run against the MOCK implementation in tenantAuth, which mirrors
   assess_eligibility in SQL. That mirroring is the risk the tests exist for: if
   the two drift, the front door tells somebody something the product does not
   agree with. Every case here has a matching assertion in the migration. */
import { describe, expect, it } from 'vitest';
import { prequalifyAnon } from './tenantAuth';

describe('the free prequalification', () => {
  it('does not rule out income at exactly 1.5x the rent', async () => {
    const r = await prequalifyAnon({ monthly_rent: 1000, annual_income: 18000, is_student: false, adverse_credit: false });
    expect(r.outcome).toBe('not_ruled_out');
    expect(r.reason).toBeNull();
  });

  it('rules out income a pound under', async () => {
    const r = await prequalifyAnon({ monthly_rent: 1000, annual_income: 17999, is_student: false, adverse_credit: false });
    expect(r.outcome).toBe('ruled_out');
    expect(r.reason).toBe('affordability_below_threshold');
  });

  it('exempts a student from the income rule entirely', async () => {
    const r = await prequalifyAnon({ monthly_rent: 2000, annual_income: 0, is_student: true, adverse_credit: false });
    expect(r.outcome).toBe('not_ruled_out');
  });

  it('assesses a sharer against their share, not the whole rent', async () => {
    const whole = await prequalifyAnon({ monthly_rent: 2400, annual_income: 16000, is_student: false, adverse_credit: false });
    expect(whole.outcome).toBe('ruled_out');

    const share = await prequalifyAnon({ monthly_rent: 2400, share_amount: 800, annual_income: 16000, is_student: false, adverse_credit: false });
    expect(share.outcome).toBe('not_ruled_out');
    expect(share.rent_basis).toBe(800);
  });

  it('NEVER rules somebody out for adverse credit alone', async () => {
    // It cannot see a credit file. Declaring adverse credit is recorded and
    // passed back so the copy can acknowledge it, and it decides nothing.
    const r = await prequalifyAnon({ monthly_rent: 1000, annual_income: 40000, is_student: false, adverse_credit: true });
    expect(r.outcome).toBe('not_ruled_out');
    expect(r.declared_adverse_credit).toBe(true);
  });

  it('reports what the income needs to be, so the copy can say it', async () => {
    const r = await prequalifyAnon({ monthly_rent: 1450, annual_income: 18000, is_student: false, adverse_credit: false });
    expect(r.income_needed_monthly).toBe(2175);
    expect(r.rent_basis).toBe(1450);
  });
});
