/* The mock submit must reject exactly what the SQL gate rejects, or mock testing
   is not testing production. These drive the mock submitApplication (SUPABASE is
   off in test mode) over a complete state and each way it can be incomplete,
   including the new "three statements OR a bank connection" branch. */
import { afterEach, describe, expect, it } from 'vitest';
import { submitApplication } from './tenantApi';

const KEY = 'opndoor.tenant.demo.v1';
const now = new Date();

type Doc = { id: string; kind: string; filename: string; bytes: number | null; income_id: string | null; address_id: string | null };
function complete() {
  return {
    applicant: { email: 's@example.invalid', first_name: 'Sam', last_name: 'Okafor' },
    fee_paid: true,
    application: {
      id: 'app-1', guarantee_ref: 'GR-1', status: 'draft',
      monthly_rent: 1200, tenancy_start: '2026-10-01',
      prop_addr1: '1 Road', prop_city: 'Sheffield', prop_postcode: 'S1 1AA',
      tenant_first_name: 'Sam', tenant_last_name: 'Okafor', tenant_email: 's@example.invalid',
    },
    profile: {
      first_name: 'Sam', last_name: 'Okafor',
      title: 'Mr', dob: '1990-05-14', phone: '07700900000',
      nationality: 'British', right_to_rent_category: 'uk_or_irish',
      declared_name: 'Sam Okafor', declared_at: now.toISOString(),
    },
    addresses: [{
      seq: 0, id: 'addr-1', proof_type: 'utility_bill', address_1: '1 Road', city: 'Sheffield',
      residency_type: 'renting', rental_arrears: 'no',
      moved_in_year: String(now.getFullYear() - 4), moved_in_month: String(now.getMonth() + 1),
    }],
    incomes: [{ seq: 0, is_additional: false, income_type: 'permanent' }],
    documents: [
      { id: 'p1', kind: 'proof_of_address', filename: 'bill.pdf', bytes: 1, income_id: null, address_id: 'addr-1' },
      { id: 'b1', kind: 'bank_statement', filename: 's1.pdf', bytes: 1, income_id: null, address_id: null },
      { id: 'b2', kind: 'bank_statement', filename: 's2.pdf', bytes: 1, income_id: null, address_id: null },
      { id: 'b3', kind: 'bank_statement', filename: 's3.pdf', bytes: 1, income_id: null, address_id: null },
    ] as Doc[],
    agent: null,
  };
}
const seed = (state: unknown) => localStorage.setItem(KEY, JSON.stringify(state));
afterEach(() => localStorage.removeItem(KEY));

describe('the mock submit gate mirrors the SQL gate', () => {
  it('accepts a complete application', async () => {
    seed(complete());
    expect(await submitApplication('app-1')).toEqual({ ok: true });
  });

  it('refuses without nationality, naming it', async () => {
    const s = complete(); s.profile.nationality = '';
    seed(s);
    expect((await submitApplication('app-1')).error).toMatch(/still needed: nationality/i);
  });

  it('refuses without the declaration tick', async () => {
    const s = complete(); s.profile.declared_at = '';
    seed(s);
    expect((await submitApplication('app-1')).error).toMatch(/declaration tick/i);
  });

  it('refuses without a proof of address for an address', async () => {
    const s = complete(); s.documents = s.documents.filter((d) => d.kind !== 'proof_of_address');
    seed(s);
    expect((await submitApplication('app-1')).error).toMatch(/proof of address/i);
  });

  it('refuses without three statements and no connection', async () => {
    const s = complete(); s.documents = s.documents.filter((d) => d.kind !== 'bank_statement');
    seed(s);
    expect((await submitApplication('app-1')).error).toMatch(/three months of bank statements, or a connected bank/i);
  });

  it('accepts a completed bank connection instead of statements', async () => {
    const s = complete();
    s.documents = s.documents.filter((d) => d.kind !== 'bank_statement');
    s.documents.push({ id: 'c1', kind: 'bank_connection', filename: 'connection', bytes: null, income_id: null, address_id: null });
    seed(s);
    expect(await submitApplication('app-1')).toEqual({ ok: true });
  });
});
