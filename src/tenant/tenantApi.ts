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
import { SUPABASE_ENABLED, sb } from '@/lib/supabase';

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
  const { data, error } = await sb().functions.invoke('tenant-portal', { body: { action, ...payload } });
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
    addresses: [], incomes: [], documents: [], agent: null,
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
    const { error } = await sb().storage.from(r.bucket).uploadToSignedUrl(r.path, r.token, file);
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

  // The same rules as assess_eligibility, so the demo answers what production
  // would. Kept beside the SQL deliberately: if these drift, the mock is lying.
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
  const needed = Math.round(rent * 1.5 * 100) / 100;
  const months = (() => {
    const ds = s.addresses
      .map((a) => (Number(a.moved_in_year) > 1900 ? new Date(Number(a.moved_in_year), Number(a.moved_in_month) - 1, 1) : null))
      .filter(Boolean) as Date[];
    if (!ds.length) return 0;
    const e = new Date(Math.min(...ds.map((d) => d.getTime())));
    const n = new Date();
    return Math.max(0, (n.getFullYear() - e.getFullYear()) * 12 + (n.getMonth() - e.getMonth()));
  })();

  const ruledOut = !isStudent && rent > 0 && annual / 12 < needed;
  return {
    outcome: rent > 0 ? (ruledOut ? 'ruled_out' : 'not_ruled_out') : null,
    reason: ruledOut ? 'affordability_below_threshold' : null,
    annual_income: annual, income_needed_monthly: needed, history_months: months,
    adverse_credit: (s.profile.adverse_credit as boolean | null) ?? null,
  };
}

export async function submitApplication(applicationId: string): Promise<{ ok: boolean; error?: string; history_months?: number }> {
  if (SUPABASE_ENABLED) {
    try { await callFn('submit', { application_id: applicationId }); return { ok: true }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Could not submit.' }; }
  }
  const s = readMock();
  const pre = await prequalify(applicationId);
  if (pre.history_months < 36) {
    return { ok: false, error: 'We need three years of address history before we can send this.', history_months: pre.history_months };
  }
  // completed_at ONLY. Submitting marks the answers finished; it is the
  // eligibility payment that moves draft -> referencing, in
  // record_eligibility_payment. The mock moved the status here and production
  // does not, and a mock that models a different state machine is worse than no
  // mock: it teaches the wrong journey.
  s.profile = { ...s.profile, completed_at: new Date().toISOString() };
  writeMock(s);
  return { ok: true };
}
