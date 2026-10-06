import { SUPABASE_ENABLED, sb } from '@/lib/supabase';
import { functionErrorMessage } from './paymentService';

/** A tenant-uploaded document as staff see it: the index row plus a label. The
 *  bytes are never sent here; opening one asks the edge function for a signed
 *  URL, the same way the deed download works. This is the staff-side view of the
 *  files the tenant uploaded on the Address and Financials steps, now that the
 *  tenant no longer has a Documents page of their own. */
export interface StaffDocument {
  id: string;
  kind: string;
  label: string;
  filename: string;
  bytes: number | null;
  createdAt: string;
}

// Applicant uploads only. Provider reports live in a different bucket with their
// own retention and were never what the tenant's Documents tab listed as theirs.
const LABELS: Record<string, string> = {
  bank_statement: 'Bank statement',
  proof_of_address: 'Proof of address',
  p60_or_pension_award: 'P60 or pension award letter',
  tax_return: 'Tax return',
  other_upload: 'Other document',
};
const APPLICANT_FILE_KINDS = Object.keys(LABELS);

// The demo has no database. A representative set keeps the card reviewable there;
// downloads are live-data only, so opening one in the demo says so rather than
// failing silently.
const MOCK_DOCS: StaffDocument[] = [
  { id: 'mock-proof', kind: 'proof_of_address', label: LABELS.proof_of_address, filename: 'council-tax-bill.pdf', bytes: 148_000, createdAt: '2026-08-20T10:00:00Z' },
  { id: 'mock-bank-jun', kind: 'bank_statement', label: LABELS.bank_statement, filename: 'statement-june.pdf', bytes: 262_000, createdAt: '2026-08-20T10:01:00Z' },
  { id: 'mock-bank-jul', kind: 'bank_statement', label: LABELS.bank_statement, filename: 'statement-july.pdf', bytes: 271_000, createdAt: '2026-08-20T10:02:00Z' },
  { id: 'mock-bank-aug', kind: 'bank_statement', label: LABELS.bank_statement, filename: 'statement-august.pdf', bytes: 268_000, createdAt: '2026-08-20T10:03:00Z' },
];

/** The applicant's uploaded documents for an application, by reference. RLS on
 *  application_documents scopes this to applications the caller may already see,
 *  returning [] when they may not. */
export async function listApplicationDocuments(ref: string): Promise<StaffDocument[]> {
  if (!SUPABASE_ENABLED) return MOCK_DOCS;
  const client = sb();
  const { data: app } = await client.from('applications').select('id').eq('guarantee_ref', ref).maybeSingle();
  if (!app) return [];
  const { data, error } = await client
    .from('application_documents')
    .select('id, kind, filename, bytes, created_at')
    .eq('application_id', app.id)
    .in('kind', APPLICANT_FILE_KINDS)
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id as string,
    kind: r.kind as string,
    label: LABELS[r.kind as string] ?? (r.kind as string),
    filename: r.filename as string,
    bytes: r.bytes != null ? Number(r.bytes) : null,
    createdAt: r.created_at as string,
  }));
}

/** A short-lived signed URL for one document, minted by the edge function after
 *  it re-checks the caller may see it. */
export async function applicationDocumentUrl(docId: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!SUPABASE_ENABLED) return { ok: false, error: 'Document downloads are available on live data only.' };
  const { data, error } = await sb().functions.invoke('application-document-url', { body: { docId } });
  if (error) return { ok: false, error: await functionErrorMessage(error, 'Could not open the document.') };
  if (!data?.ok) return { ok: false, error: data?.error || 'Could not open the document.' };
  return { ok: true, url: data.url };
}
