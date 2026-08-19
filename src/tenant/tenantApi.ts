/* =====================================================================
   The tenant journey's data access.

   TWO BACKENDS, ONE INTERFACE. In Supabase mode every call goes to the
   tenant-portal Edge Function, because a tenant has no public.users row and so
   reads nothing through PostgREST by design. In mock mode the same interface is
   served from localStorage, which is how every other surface in this app is
   walkable without credentials, and is the only way to demonstrate a journey
   whose real form needs a real tenant account.

   The mock is not a stub. It persists, it resumes, and it enforces the same
   submission rules, because the point of walking the journey is to find out
   whether it feels right, and a mock that forgets between tabs would answer a
   different question.
   ===================================================================== */
import { SUPABASE_ENABLED } from '@/lib/supabase';
import { prequalifyAnon, tenantAccessToken, tsb } from './tenantAuth';

export interface TenantApplication {
  id: string;
  guarantee_ref: string;
  status: string;
  monthly_rent: number | null;
  tenancy_start: string | null;
  prop_addr1: string | null;
  prop_addr2: string | null;
  prop_city: string | null;
  prop_county: string | null;
  prop_postcode: string | null;
  tenant_first_name?: string | null;
  tenant_last_name?: string | null;
  tenant_email?: string | null;
}

export interface ApplicationBundle {
  application: TenantApplication;
  editable: boolean;
  /** Has the application fee cleared? The sections after the basics lock on this. */
  fee_paid: boolean;
  profile: Record<string, unknown> | null;
  addresses: Record<string, unknown>[];
  incomes: Record<string, unknown>[];
  documents: { id: string; kind: string; filename: string; bytes: number | null; income_id: string | null; address_id: string | null }[];
  agent: Record<string, unknown> | null;
}

/* ---------------------------------------------------------------------------
   Supabase mode
   --------------------------------------------------------------------------- */
async function callFn(action: string, payload: Record<string, unknown> = {}) {
  // The TENANT client's token, never the staff one. They are separate sessions
  // with separate storage keys, and invoking through the staff client here would
  // send a member of staff's bearer to a tenant endpoint, which refuses it with
  // a 403 that would look like a bug in the tenant's account.
  const token = await tenantAccessToken();
  if (!token) throw new Error('Your session has expired. Please sign in again.');
  const { data, error } = await tsb().functions.invoke('tenant-portal', {
    body: { action, ...payload },
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) throw new Error(error.message);
  if (data && (data as any).ok === false) throw new Error((data as any).error ?? 'Request failed.');
  return data as any;
}

/* ---------------------------------------------------------------------------
   Mock mode. One key, one shape, so a reload resumes exactly where it stopped.
   --------------------------------------------------------------------------- */
const MOCK_KEY = 'opndoor.tenant.demo.v1';

interface MockState {
  applicant: { email: string; first_name: string; last_name: string };
  fee_paid?: boolean;
  application: TenantApplication;
  profile: Record<string, unknown>;
  addresses: Record<string, unknown>[];
  incomes: Record<string, unknown>[];
  documents: ApplicationBundle['documents'];
  agent: Record<string, unknown> | null;
}

function seed(): MockState {
  return {
    applicant: { email: 'demo.tenant@example.invalid', first_name: 'Sam', last_name: 'Okafor' },
    application: {
      id: 'demo-application', guarantee_ref: 'GR-DEMO', status: 'draft',
      monthly_rent: null, tenancy_start: null,
      prop_addr1: null, prop_addr2: null, prop_city: null, prop_county: null, prop_postcode: null,
      tenant_first_name: 'Sam', tenant_last_name: 'Okafor', tenant_email: 'demo.tenant@example.invalid',
    },
    // Pre-filled from signup, which is the whole point of not asking twice.
    profile: { first_name: 'Sam', last_name: 'Okafor', phone: '07700 900123' },
    addresses: [], incomes: [], documents: [], agent: null, fee_paid: false,
  };
}

function readMock(): MockState {
  try {
    const raw = localStorage.getItem(MOCK_KEY);
    if (raw) return { ...seed(), ...JSON.parse(raw) };
  } catch { /* fall through to a fresh seed */ }
  return seed();
}
function writeMock(s: MockState) {
  try { localStorage.setItem(MOCK_KEY, JSON.stringify(s)); } catch { /* private mode: session-only */ }
}

export function resetDemo() {
  try { localStorage.removeItem(MOCK_KEY); } catch { /* nothing to clear */ }
}

function upsertRow(list: Record<string, unknown>[], seq: number, patch: Record<string, unknown>) {
  const i = list.findIndex((r) => Number(r.seq) === seq);
  if (i >= 0) list[i] = { ...list[i], ...patch, seq };
  else list.push({ id: `row-${seq}-${Date.now()}`, ...patch, seq });
  return list.find((r) => Number(r.seq) === seq)!;
}

/* ---------------------------------------------------------------------------
   The interface both modes implement.
   --------------------------------------------------------------------------- */
export async function getApplication(applicationId: string): Promise<ApplicationBundle> {
  if (SUPABASE_ENABLED) return await callFn('get_application', { application_id: applicationId });
  const s = readMock();
  return {
    application: s.application,
    editable: s.application.status === 'draft' || s.application.status === 'referencing',
    fee_paid: s.fee_paid === true,
    profile: s.profile, addresses: s.addresses, incomes: s.incomes,
    documents: s.documents, agent: s.agent,
  };
}

export async function listApplications(): Promise<{ applicant: MockState['applicant']; applications: TenantApplication[] }> {
  if (SUPABASE_ENABLED) {
    const r = await callFn('list_applications');
    return { applicant: r.applicant, applications: r.applications ?? [] };
  }
  const s = readMock();
  return { applicant: s.applicant, applications: [s.application] };
}

export async function saveProfile(applicationId: string, patch: Record<string, unknown>) {
  if (SUPABASE_ENABLED) return await callFn('save_profile', { application_id: applicationId, patch });
  const s = readMock(); s.profile = { ...s.profile, ...patch }; writeMock(s);
}

export async function saveProperty(applicationId: string, patch: Record<string, unknown>) {
  if (SUPABASE_ENABLED) return await callFn('save_property', { application_id: applicationId, patch });
  const s = readMock(); s.application = { ...s.application, ...patch } as TenantApplication; writeMock(s);
}

export async function saveAgent(applicationId: string, patch: Record<string, unknown>) {
  if (SUPABASE_ENABLED) return await callFn('save_agent', { application_id: applicationId, patch });
  const s = readMock(); s.agent = { ...(s.agent ?? {}), ...patch }; writeMock(s);
}

export async function saveRow(applicationId: string, table: 'addresses' | 'incomes', seq: number, patch: Record<string, unknown>) {
  if (SUPABASE_ENABLED) return await callFn('save_row', { application_id: applicationId, table, seq, patch });
  const s = readMock();
  upsertRow(table === 'addresses' ? s.addresses : s.incomes, seq, patch);
  writeMock(s);
}

export async function deleteRow(applicationId: string, table: 'addresses' | 'incomes', seq: number) {
  if (SUPABASE_ENABLED) return await callFn('delete_row', { application_id: applicationId, table, seq });
  const s = readMock();
  const list = table === 'addresses' ? s.addresses : s.incomes;
  const i = list.findIndex((r) => Number(r.seq) === seq);
  if (i >= 0) list.splice(i, 1);
  writeMock(s);
}

/** Upload straight to Storage with a signed URL: an Edge Function is a poor file pipe. */
export async function uploadDocument(
  applicationId: string, kind: string, file: File,
  link?: { income_id?: string | null; address_id?: string | null },
): Promise<void> {
  if (SUPABASE_ENABLED) {
    const r = await callFn('upload_url', { application_id: applicationId, kind, filename: file.name });
    const { error } = await tsb().storage.from(r.bucket).uploadToSignedUrl(r.path, r.token, file);
    if (error) throw new Error(error.message);
    await callFn('confirm_upload', {
      application_id: applicationId, kind, path: r.path, filename: file.name,
      content_type: file.type, bytes: file.size, ...link,
    });
    return;
  }
  const s = readMock();
  s.documents.push({
    id: `doc-${Date.now()}`, kind, filename: file.name, bytes: file.size,
    income_id: link?.income_id ?? null, address_id: link?.address_id ?? null,
  });
  writeMock(s);
}

export async function deleteDocument(applicationId: string, documentId: string) {
  if (SUPABASE_ENABLED) return await callFn('delete_document', { application_id: applicationId, document_id: documentId });
  const s = readMock();
  s.documents = s.documents.filter((d) => d.id !== documentId);
  writeMock(s);
}

export interface Prequalification {
  outcome: 'not_ruled_out' | 'ruled_out' | null;
  reason: string | null;
  annual_income: number;
  income_needed_monthly: number | null;
  history_months: number;
  adverse_credit: boolean | null;
}

export async function prequalify(applicationId: string): Promise<Prequalification> {
  if (SUPABASE_ENABLED) return await callFn('prequalify', { application_id: applicationId });

  // ONE mirror of the rules, not two. The standalone prequalification screen is
  // gone, but prequalifyAnon is still the mock implementation of
  // assess_eligibility, so the in-form check reuses it rather than keeping a
  // second copy that can drift from it and from the SQL.
  const s = readMock();
  const rent = Number(s.application.monthly_rent ?? 0);
  const isStudent = s.incomes.some((i) => i.income_type === 'student');
  const annual = s.incomes.reduce((sum, i) => {
    const basis = String(i.pay_basis ?? '');
    if (basis === 'annual_salary') return sum + Number(i.annual_salary ?? 0);
    if (basis === 'hourly_rate') return sum + Number(i.hourly_rate ?? 0) * Number(i.weekly_hours ?? 0) * 52;
    if (i.income_type === 'retired') return sum + Number(i.pension_income ?? 0) * 12;
    if (i.is_additional) {
      if (i.guaranteed === 'no') return sum;             // declared, not counted
      const amt = Number(i.amount ?? 0);
      return sum + (i.amount_frequency === 'weekly' ? amt * 52 : i.amount_frequency === 'monthly' ? amt * 12 : amt);
    }
    return sum + Number(i.annual_salary ?? 0);
  }, 0);

  const months = (() => {
    const ds = s.addresses
      .map((a) => (Number(a.moved_in_year) > 1900 ? new Date(Number(a.moved_in_year), Number(a.moved_in_month) - 1, 1) : null))
      .filter(Boolean) as Date[];
    if (!ds.length) return 0;
    const e = new Date(Math.min(...ds.map((d) => d.getTime())));
    const n = new Date();
    return Math.max(0, (n.getFullYear() - e.getFullYear()) * 12 + (n.getMonth() - e.getMonth()));
  })();

  if (rent <= 0) {
    return { outcome: null, reason: null, annual_income: annual, income_needed_monthly: null,
             history_months: months, adverse_credit: (s.profile.adverse_credit as boolean | null) ?? null };
  }

  const r = await prequalifyAnon({
    monthly_rent: rent, annual_income: annual, is_student: isStudent,
    adverse_credit: s.profile.adverse_credit === true,
  });
  return {
    outcome: r.outcome, reason: r.reason,
    annual_income: annual, income_needed_monthly: r.income_needed_monthly,
    history_months: months,
    adverse_credit: (s.profile.adverse_credit as boolean | null) ?? null,
  };
}

export async function startFeePayment(applicationId: string): Promise<string | null> {
  if (SUPABASE_ENABLED) {
    const r = await callFn('start_eligibility_payment', {
      application_id: applicationId, origin: window.location.origin,
    });
    return r.already_paid ? null : (r.url as string);
  }
  // Mock mode has no Stripe. The fee is marked paid so the journey past it can
  // be walked, and the screen says plainly that no money moved.
  const s = readMock();
  s.fee_paid = true;
  writeMock(s);
  return null;
}

export async function submitApplication(applicationId: string): Promise<{ ok: boolean; error?: string; history_months?: number }> {
  if (SUPABASE_ENABLED) {
    try { await callFn('submit', { application_id: applicationId }); return { ok: true }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Could not submit.' }; }
  }
  const s = readMock();
  if (!s.fee_paid) return { ok: false, error: 'The application fee has not been paid.' };
  const pre = await prequalify(applicationId);
  if (pre.history_months < 36) {
    return { ok: false, error: `We need three years of address history. You have given us ${pre.history_months} months.`, history_months: pre.history_months };
  }
  if (!s.incomes.some((i) => !i.is_additional)) {
    return { ok: false, error: 'We need at least one main income.' };
  }
  // completed_at ONLY. Submitting marks the answers finished; it is the
  // eligibility payment that moves draft -> referencing, in
  // record_eligibility_payment. The mock moved the status here and production
  // does not, and a mock that models a different state machine is worse than no
  // mock: it teaches the wrong journey.
  s.profile = { ...s.profile, completed_at: new Date().toISOString() };
  s.application = { ...s.application, status: 'referencing' };
  writeMock(s);
  return { ok: true };
}

/** Attach an application an agent created to this account. */
export async function claimInvite(token: string): Promise<string> {
  if (SUPABASE_ENABLED) {
    const r = await callFn('claim_invite', { token });
    return r.application_id as string;
  }
  return 'demo-application';
}

/** Create the draft, carrying the prequalification answers in with it. */
export async function startApplication(input: Record<string, unknown>): Promise<string> {
  if (SUPABASE_ENABLED) {
    const r = await callFn('start_application', input);
    return r.application_id as string;
  }
  const s = readMock();
  s.application = {
    ...s.application,
    monthly_rent: Number(input.monthly_rent) || null,
    tenancy_start: (input.tenancy_start as string) || null,
    prop_addr1: (input.prop_addr1 as string) || null,
    prop_addr2: (input.prop_addr2 as string) || null,
    prop_city: (input.prop_city as string) || null,
    prop_county: (input.prop_county as string) || null,
    prop_postcode: (input.prop_postcode as string) || null,
  };
  // Seed what the prequalification already asked, so the form does not ask again.
  if (input.adverse_credit !== undefined) s.profile = { ...s.profile, adverse_credit: input.adverse_credit === true };
  if (Number(input.annual_income) > 0 && !s.incomes.length) {
    s.incomes.push({
      id: 'row-0-seed', seq: 0, is_additional: false,
      income_type: input.is_student === true ? 'student' : 'permanent',
      pay_basis: 'annual_salary', annual_salary: Number(input.annual_income),
    });
  }
  writeMock(s);
  return 'demo-application';
}
