/* =====================================================================
   THE NOTIFICATION MATRIX, client side.

   Q-03: "Each supplier and each agency has a matrix: notification types
   against recipients, each on or off."

   THE SCREEN DRAWS WHAT THE SERVER RETURNS AND NOTHING ELSE. The cells that
   exist depend on the kind of party -- an agency has a referrer and its ticked
   users, a supplier has a referrer and a branch agent contact -- and that
   belongs in one place, which is `notification_recipient_classes` in SQL.
   `notification_matrix` returns the cross product a party actually has, with
   each cell's current value, whether that value is a stored choice or the
   default, and whether it is locked. A screen that held its own list of types
   or classes would eventually draw a switch that does nothing, which is the
   defect this whole item exists to avoid.

   AND THE SERVER IS THE RULE. `set_notification_setting` refuses a caller who
   may not edit that party, refuses a locked cell, and audits the change.
   Nothing here restates any of that: the calls are thin, and a refusal
   arrives as its own sentence.
   ===================================================================== */
import { SUPABASE_ENABLED, sb } from '@/lib/supabase';

export interface MatrixCell {
  notificationType: string;
  typeLabel: string;
  typeOrd: number;
  recipient: string;
  recipientLabel: string;
  recipientOrd: number;
  enabled: boolean;
  /** True when no row is stored and this is the computed default. */
  isDefault: boolean;
  /** Not switchable. The executed deed to its own recipient. */
  locked: boolean;
}

/** Exactly one party: a supplier partner, or an agency. */
export interface Party { partnerId?: string | null; agencyId?: string | null }

/* Mock mode has no matrix: it has no party ids to key one on, and inventing
   one would let the screen be developed against a shape the server does not
   have. The card renders its own "not available here" state instead. */
export async function getNotificationMatrix(p: Party): Promise<MatrixCell[]> {
  if (!SUPABASE_ENABLED) return [];
  const { data, error } = await sb().rpc('notification_matrix', {
    p_partner: p.partnerId ?? null,
    p_agency: p.agencyId ?? null,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    notificationType: String(r.notification_type),
    typeLabel: String(r.type_label),
    typeOrd: Number(r.type_ord),
    recipient: String(r.recipient),
    recipientLabel: String(r.recipient_label),
    recipientOrd: Number(r.recipient_ord),
    enabled: r.enabled === true,
    isDefault: r.is_default === true,
    locked: r.locked === true,
  }));
}

export async function setNotificationSetting(
  p: Party, notificationType: string, recipient: string, enabled: boolean,
): Promise<void> {
  if (!SUPABASE_ENABLED) return;
  const { error } = await sb().rpc('set_notification_setting', {
    p_partner: p.partnerId ?? null,
    p_agency: p.agencyId ?? null,
    p_type: notificationType,
    p_recipient: recipient,
    p_enabled: enabled,
  });
  if (error) throw new Error(error.message);
}

/** May this reader edit this party's matrix at all? Asked so the card can be
 *  read-only rather than a grid of controls that each refuse. */
export async function mayEditNotificationMatrix(p: Party): Promise<boolean> {
  if (!SUPABASE_ENABLED) return false;
  const { data, error } = await sb().rpc('may_edit_notification_matrix', {
    p_partner: p.partnerId ?? null,
    p_agency: p.agencyId ?? null,
  });
  if (error) return false;
  return data === true;
}

export const LOCKED_REASON =
  'The executed deed always reaches its recipient. That one cannot be turned off.';

export const MATRIX_NOTE =
  'Who is told about each thing that happens to a referral. A person is only '
  + 'ever told about referrals their own position covers, so this narrows that '
  + 'and never widens it. Every email to the tenant, and delivery of the '
  + 'executed deed to its recipient, are not switchable.';

/** Rows of the grid, in the server's order, each with its cells by class. */
export function toRows(cells: MatrixCell[]): Array<{
  notificationType: string; typeLabel: string; cells: MatrixCell[];
}> {
  const byType = new Map<string, { notificationType: string; typeLabel: string; typeOrd: number; cells: MatrixCell[] }>();
  for (const c of cells) {
    const row = byType.get(c.notificationType)
      ?? { notificationType: c.notificationType, typeLabel: c.typeLabel, typeOrd: c.typeOrd, cells: [] };
    row.cells.push(c);
    byType.set(c.notificationType, row);
  }
  return [...byType.values()]
    .sort((a, b) => a.typeOrd - b.typeOrd)
    .map((r) => ({ ...r, cells: r.cells.slice().sort((a, b) => a.recipientOrd - b.recipientOrd) }));
}

/** The column headers, in the server's order. */
export function toColumns(cells: MatrixCell[]): Array<{ recipient: string; label: string }> {
  const seen = new Map<string, { recipient: string; label: string; ord: number }>();
  for (const c of cells) {
    if (!seen.has(c.recipient)) seen.set(c.recipient, { recipient: c.recipient, label: c.recipientLabel, ord: c.recipientOrd });
  }
  return [...seen.values()].sort((a, b) => a.ord - b.ord).map(({ recipient, label }) => ({ recipient, label }));
}
