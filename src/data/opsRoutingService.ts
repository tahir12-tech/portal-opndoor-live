/* =====================================================================
   WHERE OPNDOOR'S OWN ALERTS GO.

   Q-04. Every internal alert used to go to one address out of an environment
   variable, and if that variable was unset the alert was dropped. This is the
   client side of the routing table.

   THE SERVER DECIDES EVERYTHING. Which types exist, which group each is in,
   which are critical, who can be routed to, how many live recipients a type
   has, and whether this reader may edit at all. `ops_routing_matrix` returns
   all of it in one read, and `set_ops_route` refuses a non-superadmin, refuses
   an unknown type, and audits the change. The floor on a critical type is a
   TRIGGER, not a rule in this file or in the screen: there are three ways to
   empty a route -- turn the last one off, delete it, or deactivate the person
   holding it -- and only a trigger catches all three.
   ===================================================================== */
import { SUPABASE_ENABLED, sb } from '@/lib/supabase';

export interface OpsRouteCell {
  alertType: string;
  label: string;
  group: string;
  critical: boolean;
  typeOrd: number;
  recipientKind: 'person' | 'inbox';
  recipientId: string;
  recipientName: string;
  recipientEmail: string;
  enabled: boolean;
  /** How many LIVE recipients this type has in total, across all cells. */
  liveCount: number;
}

export async function getOpsRoutingMatrix(): Promise<OpsRouteCell[]> {
  if (!SUPABASE_ENABLED) return [];
  const { data, error } = await sb().rpc('ops_routing_matrix');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    alertType: String(r.alert_type),
    label: String(r.label),
    group: String(r.grp),
    critical: r.critical === true,
    typeOrd: Number(r.type_ord),
    recipientKind: String(r.recipient_kind) as 'person' | 'inbox',
    recipientId: String(r.recipient_id),
    recipientName: String(r.recipient_name ?? ''),
    recipientEmail: String(r.recipient_email ?? ''),
    enabled: r.enabled === true,
    liveCount: Number(r.live_count ?? 0),
  }));
}

export async function setOpsRoute(
  alertType: string, kind: 'person' | 'inbox', recipientId: string, enabled: boolean,
): Promise<void> {
  if (!SUPABASE_ENABLED) return;
  const { error } = await sb().rpc('set_ops_route', {
    p_type: alertType, p_kind: kind, p_recipient: recipientId, p_enabled: enabled,
  });
  if (error) throw new Error(error.message);
}

/** The four groups, in the order the instruction names them. Severity order,
 *  which is also the order somebody scanning the page wants. */
export const OPS_GROUPS = ['Critical', 'Operations', 'Commercial', 'Information'] as const;

export const OPS_ROUTING_NOTE =
  'Where opndoor’s own alerts go. Everything here is internal: none of it '
  + 'reaches an agency, a supplier or a tenant. A critical alert can be '
  + 'rerouted but never left with nobody to receive it, and if one ever is, it '
  + 'goes to support@opndoor.co marked UNROUTED rather than being lost.';

export const OPS_FLOOR_REASON =
  'This is the last person or inbox receiving a critical alert. Add another '
  + 'before removing this one.';

export interface OpsRoutingGroup {
  group: string;
  types: Array<{
    alertType: string; label: string; critical: boolean; liveCount: number;
    cells: OpsRouteCell[];
  }>;
}

/** Grouped for the page, in the server's order within each group. */
export function toGroups(cells: OpsRouteCell[]): OpsRoutingGroup[] {
  const byType = new Map<string, OpsRoutingGroup['types'][number] & { group: string; typeOrd: number }>();
  for (const c of cells) {
    const t = byType.get(c.alertType) ?? {
      alertType: c.alertType, label: c.label, critical: c.critical,
      liveCount: c.liveCount, cells: [], group: c.group, typeOrd: c.typeOrd,
    };
    t.cells.push(c);
    byType.set(c.alertType, t);
  }
  const types = [...byType.values()].sort((a, b) => a.typeOrd - b.typeOrd);
  return OPS_GROUPS
    .map((group) => ({ group, types: types.filter((t) => t.group === group) }))
    .filter((g) => g.types.length > 0);
}

/** Everyone who can be routed to, from the matrix itself: the page holds no
 *  list of its own, so a new inbox appears without a client change. */
export function toRecipients(cells: OpsRouteCell[]): Array<{
  kind: 'person' | 'inbox'; id: string; name: string; email: string;
}> {
  const seen = new Map<string, { kind: 'person' | 'inbox'; id: string; name: string; email: string }>();
  for (const c of cells) {
    if (!seen.has(c.recipientId)) {
      seen.set(c.recipientId, {
        kind: c.recipientKind, id: c.recipientId,
        name: c.recipientName, email: c.recipientEmail,
      });
    }
  }
  // Shared inboxes first: they are the durable route, a person is the
  // exception, and a page read in a hurry should show the durable one first.
  return [...seen.values()].sort((a, b) => (
    a.kind === b.kind ? a.name.localeCompare(b.name) : (a.kind === 'inbox' ? -1 : 1)
  ));
}

/** True when turning this cell OFF would leave a critical type with nobody. */
export function isLastCritical(cell: OpsRouteCell): boolean {
  return cell.critical && cell.enabled && cell.liveCount <= 1;
}
