/* =====================================================================
   App settings service. Currently the bordereau underwriter insurance rate,
   persisted so it defaults to the last applied value instead of silently
   reverting, with every change audited (who, when, old -> new) via the
   set_app_setting_num RPC. Admin-only (the bordereau is admin-only).
   ===================================================================== */
import { SUPABASE_ENABLED, sb } from '@/lib/supabase';
import { DEFAULT_INSURANCE_RATE } from './mock/analyticsModel';

export interface BordereauRateMeta {
  rate: number;
  changedAt: Date | null;
  changedBy: string | null;
}

let BORDEREAU: BordereauRateMeta = { rate: DEFAULT_INSURANCE_RATE, changedAt: null, changedBy: null };

/** Replace the settings working copy from the back end (Supabase mode). */
export function hydrateSettings(meta: Partial<BordereauRateMeta>): void {
  BORDEREAU = {
    rate: meta.rate ?? DEFAULT_INSURANCE_RATE,
    changedAt: meta.changedAt ?? null,
    changedBy: meta.changedBy ?? null,
  };
}

/** The stored bordereau insurance rate (defaults until hydrated/changed). */
export function getBordereauRate(): number {
  return BORDEREAU.rate;
}

/** The stored rate plus who last changed it and when (for the modal caption). */
export function getBordereauRateMeta(): BordereauRateMeta {
  return { ...BORDEREAU };
}

/** Persist the bordereau insurance rate. Live mode calls the audited RPC; mock
    mode updates the working copy. A no-op change writes no audit entry. */
export async function setBordereauRate(rate: number): Promise<void> {
  if (SUPABASE_ENABLED) {
    const { data, error } = await sb().rpc('set_app_setting_num', { p_key: 'bordereau_insurance_rate', p_value: rate });
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = (Array.isArray(data) ? data[0] : data) as any;
    if (row) {
      BORDEREAU = {
        rate: Number(row.num_value),
        changedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
        changedBy: row.updated_by_name ?? null,
      };
    }
    return;
  }
  if (BORDEREAU.rate !== rate) BORDEREAU = { rate, changedAt: new Date(), changedBy: 'You' };
}

/* =====================================================================
   WHERE OPNDOOR'S INVOICES ARE SENT.

   Matt, 2026-10-01, in two messages: "The invoice email is not hardcoded
   and has no default: make it a setting Opndoor admin fills in. Until
   it's set, don't send statements; show a clear warning on Home and
   Health saying the invoice email needs setting. Tell me where the
   setting lives." Then: "Invoice email: default it to
   accounts@opndoor.co, as a setting Opndoor admin can change later. No
   warning needed while it's set."

   WHY IT IS A SETTING AND NOT A CONSTANT. Every commission statement
   says "Please send an invoice to opndoor for [total], quoting statement
   reference [reference], to [invoice email]". A hardcoded address is one
   nobody can change when finance moves inbox, and the first thing anyone
   would notice is invoices arriving nowhere.

   AND IT HAS NO FALLBACK IN CODE. The default is a SEEDED ROW, not a
   `?? 'accounts@opndoor.co'` in a template. Matt's first message refused
   a code fallback and his reason is the better one: a fallback that
   works is a fallback nobody replaces, and the run would go on quietly
   sending statements to an address that had been wrong for a year. With
   the row empty the run refuses to post and the screens say why.
   ===================================================================== */

export interface InvoiceEmailSetting {
  /** The address, or null when the setting is empty. Null stops the run. */
  email: string | null;
  changedAt: Date | null;
  changedBy: string | null;
}

/** Read the address and who last set it. Null email means statements cannot
    be posted; `statements_can_be_posted()` is the same question in SQL. */
export async function getInvoiceEmail(): Promise<InvoiceEmailSetting> {
  if (!SUPABASE_ENABLED) return { email: 'accounts@opndoor.co', changedAt: null, changedBy: null };
  const { data, error } = await sb()
    .from('app_settings')
    .select('text_value, updated_at, updated_by_name')
    .eq('key', 'statement_invoice_email')
    .maybeSingle();
  if (error) throw new Error(error.message);
  const value = (data?.text_value ?? '').trim();
  return {
    email: value || null,
    changedAt: data?.updated_at ? new Date(data.updated_at) : null,
    changedBy: data?.updated_by_name ?? null,
  };
}

/**
 * Change it. Opndoor admin only and MFA, enforced by the RPC rather than
 * by the screen: the shape of the address is checked there too, so a
 * typo without an @ is refused before it can reach a statement.
 *
 * AN EMPTY STRING IS A REAL CHOICE, and it is how the setting is cleared.
 * The RPC stores NULL for it, the run then refuses to post, and the
 * warnings come back. That is the state Matt's first message described,
 * and it has to stay reachable or the "until it's set" behaviour is
 * unreachable and therefore untested in practice.
 */
export async function setInvoiceEmail(email: string): Promise<void> {
  if (!SUPABASE_ENABLED) return;
  const { error } = await sb().rpc('set_app_setting_text', {
    p_key: 'statement_invoice_email', p_value: email,
  });
  if (error) throw new Error(error.message);
}

/**
 * Whether a statement run could post today, which is the question the
 * warnings ask.
 *
 * THROUGH THE RPC, NOT THE TABLE, and the difference matters. app_settings
 * is readable only by an admin or an opndoor_manager, and only at aal2:
 * anybody else selecting from it gets no rows, which looks exactly like
 * "the setting is empty". A warning driven off the table would appear for
 * every agency user on Home, about a setting they cannot see, cannot
 * change and have no business knowing about.
 *
 * statements_can_be_posted() is SECURITY DEFINER and answers the same
 * question for everyone, so the screens can gate on WHO SHOULD ACT
 * instead of on who happens to be able to read a row.
 */
export async function canPostStatements(): Promise<boolean> {
  if (!SUPABASE_ENABLED) return true;
  const { data, error } = await sb().rpc('statements_can_be_posted');
  if (error) throw new Error(error.message);
  return data === true;
}
