/* =====================================================================
   THE SUPPLIER'S STATEMENT, ON THE PAGE AS WELL AS IN THE POST.

   Matt, 2026-10-01: "If the zip would be over 10MB, don't attach it;
   instead the email links to download it from the supplier's Reporting
   page, where it's always available."

   WHY THIS IS A FETCH AND NOT A CALCULATION. Every other statement on
   screen is derived here, in the browser, from the hydrated book: the
   agency rail's commission is on the application rows the reader can
   already see. A SUPPLIER'S is not. Its three-way split (the total, the
   agents' share carved out of it, the supplier's share as the
   subtraction) lives in supplier_statement_lines, which is service_role
   only and deliberately so: it carries every agency's fee under that
   supplier.

   So the page asks the same edge function that posts the month, and the
   bytes it gets back are the bytes that were emailed. A supplier holding
   June's attachment beside October's download must not find two
   documents that disagree about June.
   ===================================================================== */
import { sb } from '@/lib/supabase';
import { functionErrorMessage } from './paymentService';

export interface SupplierDocument {
  filename: string;
  /** base64, as the edge function built it. */
  content: string;
}

export interface SupplierBundleResult {
  ok: boolean;
  error?: string;
  month?: string;
  monthLabel?: string;
  reference?: string;
  payeeName?: string;
  applications?: number;
  total?: number;
  /** How many agencies have a schedule in the zip. */
  agencies?: number;
  documents?: SupplierDocument[];
  zipName?: string;
}

/**
 * The supplier's own statement, its CSV, and the zip of every agency
 * schedule, for one month.
 *
 * `partner` may be the slug a screen holds or the uuid the run holds;
 * the function resolves either. A month with no supplier commission
 * answers `ok: false` with a sentence rather than an empty bundle, so a
 * caller never offers a download of nothing.
 */
export async function getSupplierBundle(partner: string, month: string): Promise<SupplierBundleResult> {
  /* EVERY FAILURE COMES BACK AS A SENTENCE, including the ones that are
     thrown rather than returned. sb() THROWS when there is no client at
     all, and invoke() rejects on a dead network: both arrive here, and
     neither has an `error` field to look at. Without this the caller's
     effect ends in an unhandled rejection and the card sits on
     "Building..." forever, which is how a reader finds out we never
     handled it. The suite found it: mounting the card added eight
     unhandled errors to two dashboard render tests that run with no
     Supabase client on purpose. */
  try {
    const { data, error } = await sb().functions.invoke('commission-statements', {
      body: { action: 'supplier_bundle', partner, month },
    });
    if (error) return { ok: false, error: await functionErrorMessage(error, 'Could not build the statement.') };
    if (!data?.ok) return { ok: false, error: data?.error || 'Could not build the statement.' };
    return data as SupplierBundleResult;
  } catch {
    return { ok: false, error: 'Could not reach the statement service. Try again in a moment.' };
  }
}

/** What a filename's extension means to a browser. The three the bundle
    can contain, and a safe default rather than a guess. */
const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  csv: 'text/csv;charset=utf-8;',
  zip: 'application/zip',
};

/**
 * Save one of the bundle's documents.
 *
 * NO BOM ADDED HERE, unlike downloadCsv: these bytes came from the edge
 * function, which already wrote one into the CSV. Adding a second would
 * put a visible "ï»¿" in Excel's first cell, which is the exact fault the
 * BOM is there to prevent.
 */
export function downloadSupplierDocument(doc: SupplierDocument): void {
  const bin = atob(doc.content);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = doc.filename.split('.').pop()?.toLowerCase() ?? '';
  const url = URL.createObjectURL(new Blob([bytes], { type: MIME[ext] ?? 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = doc.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
