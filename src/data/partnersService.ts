/* =====================================================================
   Partner service — the multi-partner model.
   Resolves partner scope centrally: opndoor admin uses a selected partner
   (which may be "all"); Management and Referrer are pinned to their home
   partner. Commission rates are per-partner and read from the partner
   record — never hard-coded.

   INTEGRATION: getPartners/addPartner/updatePartner map to
   GET/POST/PATCH /partners. getSelected/setSelected stay client-side
   (a UI preference). scopeFor mirrors the server's partner-isolation rule.
   ===================================================================== */
import type { CommissionRates, LeaderboardMode, Partner, PartnerScope, PartnerStatus, ReferencingMode, Role } from './types';
import { fmtRatePct } from '@/lib/format';
import { ALL_PARTNERS } from './types';
import { houseRouteLabel } from './channel';
import { KEYS, clone, loadJSON, loadString, saveJSON, saveString } from './storage';
import { DEFAULT_AGENT_RATE, DEFAULT_PARTNER_RATE, HOME_PARTNER, PARTNERS_SEED } from './mock/partners';
import { SUPABASE_ENABLED, sb } from '@/lib/supabase';

// Working copy, seeded from localStorage or the seed. The only place the list lives.
let PARTNERS: Partner[] = loadJSON<Partner[]>(KEYS.partners, clone(PARTNERS_SEED));
if (!PARTNERS.length) PARTNERS = clone(PARTNERS_SEED);

// The signed-in user's home partner. Defaults to the demo home partner; set from
// the real session profile in Supabase mode (see SessionContext / hydrate).
let HOME: string = HOME_PARTNER;

function persist(): void {
  saveJSON(KEYS.partners, PARTNERS);
}

/** Replace the partner list from the back end (Supabase mode). */
export function hydratePartners(rows: Partner[]): void {
  PARTNERS = rows.slice();
}

/** Set the signed-in user's home partner (Management/Referrer scope). */
export function setHomePartner(id: string): void {
  HOME = id;
}

// House / plumbing partners (opndoor-agents, opndoor-direct, referencing-partner)
// are never offered as a selectable partner: they are excluded from the list every
// picker and the Partners screen render from. They remain in the working copy
// (getPartner still resolves them) only so a row's partner can be named — as its
// route label, never the plumbing name (see partnerName).
export function getPartners(): Partner[] {
  return PARTNERS.filter((p) => !p.isHouse);
}

export function getPartner(id: string): Partner | null {
  return PARTNERS.find((p) => p.id === id) ?? null;
}

export function partnerName(id: string): string {
  const p = getPartner(id);
  if (p?.isHouse) return houseRouteLabel(p.id);
  return p ? p.name : id === ALL_PARTNERS ? 'All partners' : id;
}

export function homePartner(): string {
  return HOME;
}

export interface AddPartnerInput {
  name: string;
  weight?: number;
  status?: Partner['status'];
  since?: string;
  partnerRate?: number;
  agentRate?: number;
  referencingMode?: ReferencingMode;
  portalReferralsEnabled?: boolean;
  apiAccessEnabled?: boolean;
}

/**
 * Create a partner.
 *
 * THIS USED TO WRITE TO localStorage AND NOTHING ELSE. There was no
 * SUPABASE_ENABLED branch and no create_partner RPC anywhere in the schema for
 * it to call, so creating a partner through the product had never worked, and
 * the screen still reported success and told the admin to add users and
 * agencies underneath it.
 *
 * The slug is no longer minted here. The server derives it inside the same
 * transaction as the insert, so the uniqueness check and the insert cannot race.
 */
export async function addPartner(input: AddPartnerInput): Promise<Partner> {
  if (SUPABASE_ENABLED) {
    const { data, error } = await sb().rpc('create_partner', {
      p_name: input.name,
      p_status: input.status ?? 'onboarding',
      p_live_from: input.since ? `${input.since}-01` : null,
      p_partner_rate: input.partnerRate ?? DEFAULT_PARTNER_RATE,
      p_agent_rate: input.agentRate ?? DEFAULT_AGENT_RATE,
      p_referencing_mode: input.referencingMode ?? 'pre_referenced_screened',
      p_portal_referrals: input.portalReferralsEnabled ?? true,
      p_api_access: input.apiAccessEnabled ?? false,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('The partner was not created.');
    const rec: Partner = {
      id: row.slug,
      name: row.name,
      status: row.status,
      since: row.live_from ? String(row.live_from).slice(0, 7) : '',
      weight: 0.05,
      users: 0,
      apps: 0,
      partnerRate: Number(row.partner_rate),
      agentRate: Number(row.agent_rate),
      referencingMode: row.referencing_mode,
      // What the server says it was born as, not what this client asked
      // for. create_partner stamps 'supplier' and this is the button that
      // calls it; reading it back keeps the one source.
      kind: (row.partner_kind ?? 'supplier') as Partner['kind'],
      portalReferralsEnabled: row.portal_referrals_enabled !== false,
      apiAccessEnabled: row.api_access_enabled === true,
    };
    // Keep the working copy in step so the list updates before the next hydrate.
    PARTNERS.push(rec);
    persist();
    return rec;
  }
  return addPartnerLocal(input);
}

/** Mock-mode creation. Unchanged behaviour, now clearly labelled as such. */
function addPartnerLocal(input: AddPartnerInput): Partner {
  const base = (input.name || 'partner').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 18) || 'partner';
  let id = base;
  let n = 2;
  while (getPartner(id)) {
    id = base + n;
    n++;
  }
  const rec: Partner = {
    id,
    name: input.name,
    weight: input.weight != null ? input.weight : 0.08,
    status: input.status || 'active',
    users: 0,
    apps: 0,
    since: input.since || new Date().toISOString().slice(0, 7),
    partnerRate: input.partnerRate != null ? input.partnerRate : DEFAULT_PARTNER_RATE,
    agentRate: input.agentRate != null ? input.agentRate : DEFAULT_AGENT_RATE,
    // "Add supplier" makes a supplier, in both modes.
    kind: 'supplier',
  };
  PARTNERS.push(rec);
  persist();
  return rec;
}

export function updatePartner(id: string, changes: Partial<Partner>): Partner | null {
  const p = getPartner(id);
  if (!p) return null;
  (Object.keys(changes) as (keyof Partner)[]).forEach((k) => {
    const v = changes[k];
    if (v !== undefined) (p as Record<keyof Partner, unknown>)[k] = v;
  });
  persist();
  return p;
}

/* ---- Governed partner-settings edit (rates, status, live-from) with audit ----
   Rate edits change ONLY the partner's live rate, used by NEW applications from
   now on. Existing applications keep their snapshotted rate (see FullApp /
   create_referral), so no historical figure moves. Every changed field is
   recorded to an immutable audit trail (who, when, old -> new). */
export interface PartnerSettingsInput {
  name: string;
  status: PartnerStatus;
  since: string; // 'YYYY-MM' or ''
  partnerRate: number; // fraction of one month's rent
  agentRate: number;
  referencingMode: ReferencingMode;
  portalReferralsEnabled: boolean;
  apiAccessEnabled: boolean;
}

export interface PartnerAuditEntry {
  field: 'partner_rate' | 'agent_rate' | 'status' | 'live_from' | 'name' | string;
  oldValue: string;
  newValue: string;
  actor: string;
  at: Date;
}

// Mock/test audit store, keyed by partner id (slug). Supabase mode uses the
// partner_audit table + update_partner_settings RPC instead.
const PARTNER_AUDIT: Record<string, PartnerAuditEntry[]> = {};
const pct = (f: number): string => fmtRatePct(f);

/**
 * Persist a partner-settings edit. Supabase mode calls the update_partner_settings
 * RPC (admin + AAL2 enforced; writes the audit rows and updates the partner in one
 * transaction). Mock mode records the diffs to the in-memory audit and updates the
 * working copy. Existing applications are never touched, by design.
 */
export async function updatePartnerSettings(id: string, next: PartnerSettingsInput): Promise<void> {
  const cur = getPartner(id);
  if (!cur) throw new Error('Partner not found.');
  if (SUPABASE_ENABLED) {
    const { error } = await sb().rpc('update_partner_settings', {
      p_slug: id,
      p_name: next.name,
      p_status: next.status,
      p_live_from: next.since ? `${next.since}-01` : null,
      p_partner_rate: next.partnerRate,
      p_agent_rate: next.agentRate,
      p_referencing_mode: next.referencingMode,
      p_portal_referrals: next.portalReferralsEnabled,
      p_api_access: next.apiAccessEnabled,
    });
    if (error) throw new Error(error.message);
    return; // caller re-hydrates (session.refresh) to pick up the new live rate
  }
  // Mock mode: record the audit diffs, then update the working copy.
  const who = 'You';
  const entries: PartnerAuditEntry[] = [];
  const add = (field: PartnerAuditEntry['field'], oldValue: string, newValue: string) =>
    entries.push({ field, oldValue, newValue, actor: who, at: new Date() });
  if (cur.partnerRate !== next.partnerRate) add('partner_rate', pct(cur.partnerRate), pct(next.partnerRate));
  if (cur.agentRate !== next.agentRate) add('agent_rate', pct(cur.agentRate), pct(next.agentRate));
  if (cur.status !== next.status) add('status', cur.status, next.status);
  if ((cur.since || '') !== (next.since || '')) add('live_from', cur.since || '-', next.since || '-');
  if (cur.name !== next.name) add('name', cur.name, next.name);
  if ((cur.referencingMode ?? 'pre_referenced_screened') !== next.referencingMode) {
    add('referencing_mode', cur.referencingMode ?? 'pre_referenced_screened', next.referencingMode);
  }
  if ((cur.portalReferralsEnabled !== false) !== next.portalReferralsEnabled) {
    add('portal_referrals_enabled', cur.portalReferralsEnabled !== false ? 'on' : 'off', next.portalReferralsEnabled ? 'on' : 'off');
  }
  if ((cur.apiAccessEnabled === true) !== next.apiAccessEnabled) {
    add('api_access_enabled', cur.apiAccessEnabled ? 'on' : 'off', next.apiAccessEnabled ? 'on' : 'off');
  }
  if (entries.length) PARTNER_AUDIT[id] = [...entries, ...(PARTNER_AUDIT[id] ?? [])];
  // Pass since as-is (not `|| undefined`) so clearing Live-from actually clears it
  // and matches the audit entry recorded above.
  updatePartner(id, {
    name: next.name, status: next.status, since: next.since,
    partnerRate: next.partnerRate, agentRate: next.agentRate,
    referencingMode: next.referencingMode,
    portalReferralsEnabled: next.portalReferralsEnabled,
    apiAccessEnabled: next.apiAccessEnabled,
  });
}

/**
 * How many of a partner's API keys are live right now.
 *
 * Read before turning API access off, so the confirmation names a number. The
 * capability gates AUTHENTICATION, not just minting, so unticking it stops every
 * one of these working the moment it saves.
 */
export async function partnerActiveKeyCount(slug: string): Promise<number> {
  if (!SUPABASE_ENABLED) return 0;
  const { data, error } = await sb().rpc('partner_active_key_count', { p_slug: slug });
  if (error) return 0;
  return Number(data ?? 0);
}

/** #79 The referrer-leaderboard visibility mode for a partner (default full). */
export function getReferrerLeaderboardMode(id: string): LeaderboardMode {
  return getPartner(id)?.referrerLeaderboard ?? 'full';
}

/** #79 Set a partner's referrer-leaderboard mode. Live mode calls the governed
    RPC (AAL2 + opndoor admin or that partner's own Management); mock records the
    audit diff and updates the working copy. */
export async function setReferrerLeaderboardMode(id: string, mode: LeaderboardMode): Promise<void> {
  const cur = getPartner(id);
  if (!cur) throw new Error('Partner not found.');
  if (SUPABASE_ENABLED) {
    const { error } = await sb().rpc('set_referrer_leaderboard_mode', { p_slug: id, p_mode: mode });
    if (error) throw new Error(error.message);
    return; // caller re-hydrates to pick up the new mode
  }
  const prev = cur.referrerLeaderboard ?? 'full';
  if (prev !== mode) {
    PARTNER_AUDIT[id] = [
      { field: 'referrer_leaderboard', oldValue: prev, newValue: mode, actor: 'You', at: new Date() },
      ...(PARTNER_AUDIT[id] ?? []),
    ];
  }
  updatePartner(id, { referrerLeaderboard: mode });
}

/** Recent partner-change audit entries (most recent first). Admin-scoped. */
export async function getPartnerAudit(id: string): Promise<PartnerAuditEntry[]> {
  if (SUPABASE_ENABLED) {
    // Resolve the partner id from the slug first, then filter partner_audit by
    // partner_id directly. Filtering via an embedded resource (partner.slug on a
    // !inner join) is fragile and returned nothing, so the panel never rendered
    // (#70). A plain column filter is robust.
    const { data: p } = await sb().from('partners').select('id').eq('slug', id).maybeSingle();
    if (!p?.id) return [];
    const { data, error } = await sb()
      .from('partner_audit')
      .select('field, old_value, new_value, actor, at')
      .eq('partner_id', p.id)
      .order('at', { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((r: any) => ({
      field: r.field,
      oldValue: r.old_value ?? '',
      newValue: r.new_value ?? '',
      actor: r.actor ?? 'opndoor admin',
      at: new Date(r.at),
    }));
  }
  return PARTNER_AUDIT[id] ?? [];
}

/** Per-partner commission rates for a scope. For "all", returns the primary partner's rates. */
export function getRatesFor(scope: PartnerScope): CommissionRates {
  const p = scope && scope !== ALL_PARTNERS ? getPartner(scope) : PARTNERS.find((x) => x.primary) ?? PARTNERS[0];
  return {
    partner: p && p.partnerRate != null ? p.partnerRate : DEFAULT_PARTNER_RATE,
    agent: p && p.agentRate != null ? p.agentRate : DEFAULT_AGENT_RATE,
  };
}

/** Record a view-as entry (who, as whom, when). Non-blocking; the server refuses
    it for anyone who is not Opndoor staff, so it is safe to call optimistically. */
export async function logViewAs(kind: 'partner' | 'agency', label: string): Promise<void> {
  if (!SUPABASE_ENABLED) return;
  try { await sb().rpc('log_view_as', { p_kind: kind, p_label: label }); } catch { /* audit is best-effort */ }
}

/* ---- opndoor admin's selected partner scope (persisted UI preference) ---- */
export function getSelectedPartner(): PartnerScope {
  return loadString(KEYS.partner) || ALL_PARTNERS;
}
export function setSelectedPartner(id: PartnerScope): void {
  saveString(KEYS.partner, id);
}

/**
 * Central partner-isolation rule: admin follows the selector; others are
 * pinned home.
 *
 * EXCEPT OPNDOOR'S OPS STAFF, who have no home to be pinned to. The
 * users_partner_by_role constraint (20260922090000) requires partner_id to
 * be NULL for `opndoor_manager`, so HOME for them is whatever the module
 * default happens to be, which in mock is one arbitrary supplier. Every
 * export builder resolves its scope through this function, so leaving it
 * meant every document they could build was scoped to a partner they have
 * nothing to do with. Kept in step with SessionContext's `partnerScope`,
 * which answers the same question for the screens.
 */
export function scopeFor(role: Role): PartnerScope {
  if (role === 'superadmin') return getSelectedPartner();
  if (role === 'opndoor_manager') return ALL_PARTNERS;
  return HOME;
}

/** Demo analytics weight for a scope ("all" sums every partner's weight). */
export function weightFor(scope: PartnerScope): number {
  if (scope === ALL_PARTNERS) return PARTNERS.reduce((s, p) => s + (p.weight || 0), 0);
  const p = getPartner(scope);
  return p ? p.weight : 1;
}

/* =====================================================================
   THE NAMED ADDRESSES ON A SUPPLIER'S MONTHLY COMMISSION STATEMENT.

   Matt, 2026-09-30, verbatim: "Opndoor admin can also add named email
   addresses that aren't portal users (e.g. a finance inbox) to receive a
   supplier's statement."

   OPNDOOR ONLY, AND ENFORCED IN THE DATABASE, not here. All three RPCs
   are granted to `authenticated` with is_admin + is_aal2 inside them: the
   two writers raise 42501 and the reader answers an empty list, so a
   supplier who reached the screen would see nothing and change nothing.
   The screen being admin-routed is convenience, not the boundary.

   KEYED ON THE DATABASE UUID, which is what `dbId` is for. A partner's
   client-side `id` is its SLUG, and the table's foreign key is not that.
   ===================================================================== */

/** One address the monthly statement is posted to that is not a portal user. */
export interface StatementRecipient {
  id: string;
  email: string;
  /** Who it is, when the admin said. A bare finance inbox often has no name. */
  fullName: string | null;
}

// Mock-mode store, so the screen is usable without Supabase like every other
// list in this service. Keyed by the partner's dbId (or slug, in mock mode,
// where there is no dbId to key on).
const MOCK_STATEMENT_RECIPIENTS: Record<string, StatementRecipient[]> = {};
let mockRecipientSeq = 0;

export async function getStatementRecipients(partnerKey: string): Promise<StatementRecipient[]> {
  if (!SUPABASE_ENABLED) return clone(MOCK_STATEMENT_RECIPIENTS[partnerKey] ?? []);
  const { data, error } = await sb().rpc('partner_statement_recipient_list', { p_partner: partnerKey });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; email: string; full_name: string | null }[])
    .map((r) => ({ id: r.id, email: r.email, fullName: r.full_name }));
}

export async function addStatementRecipient(partnerKey: string, email: string, name?: string): Promise<void> {
  if (SUPABASE_ENABLED) {
    const { error } = await sb().rpc('add_partner_statement_recipient', {
      p_partner: partnerKey, p_email: email, p_name: name?.trim() || null,
    });
    if (error) throw new Error(error.message);
    return;
  }
  const clean = email.trim().toLowerCase();
  const list = MOCK_STATEMENT_RECIPIENTS[partnerKey] ?? [];
  if (list.some((r) => r.email === clean)) return;
  mockRecipientSeq += 1;
  MOCK_STATEMENT_RECIPIENTS[partnerKey] = [...list, {
    id: `mock-stmt-rec-${mockRecipientSeq}`, email: clean, fullName: name?.trim() || null,
  }].sort((a, b) => a.email.localeCompare(b.email));
}

export async function removeStatementRecipient(partnerKey: string, id: string): Promise<void> {
  if (SUPABASE_ENABLED) {
    const { error } = await sb().rpc('remove_partner_statement_recipient', { p_id: id });
    if (error) throw new Error(error.message);
    return;
  }
  MOCK_STATEMENT_RECIPIENTS[partnerKey] = (MOCK_STATEMENT_RECIPIENTS[partnerKey] ?? []).filter((r) => r.id !== id);
}

/* =====================================================================
   THE SUPPLIER'S COMMISSION, UNDER THE CARVE-OUT MODEL.

   Matt, 2026-09-30: "Supplier commission is one total rate, set per
   supplier on its Commission tab ... and that total includes the agents'
   share. The agent's share is carved out of it and can be volume-tiered
   per supplier using the existing tiers ... The supplier's own share is
   the total minus the agent's share, never more in total."

   ONE CALL, because the three settings are one decision: a total, what
   comes out of it, and who pays that out. Saving them separately would
   let an admin leave the share above the total between two requests,
   which is the state the database refuses.
   ===================================================================== */

/** A volume tier carving the agents' share out of a supplier's total. */
export interface SupplierTier {
  fromCount: number;
  toCount: number | null;
  agentRate: number;
  period: string;
  countingScope: string;
}

export async function setSupplierCommission(
  slug: string, total: number, agentShare: number, opndoorPaysAgents: boolean,
): Promise<void> {
  if (SUPABASE_ENABLED) {
    const { error } = await sb().rpc('set_supplier_commission', {
      p_slug: slug, p_total: total, p_agent_share: agentShare, p_pays_agents: opndoorPaysAgents,
    });
    if (error) throw new Error(error.message);
    return;
  }
  // Mock mode mirrors the database's one refusal, so the screen behaves the
  // same way without Supabase and the message is written once.
  if (agentShare > total) {
    throw new Error('The agents’ share comes out of the total, so it cannot be more than it. Raise the total or lower the share.');
  }
  updatePartner(slug, { partnerRate: total, agentRate: agentShare, opndoorPaysAgents });
}

export async function getSupplierTiers(slug: string): Promise<SupplierTier[]> {
  if (!SUPABASE_ENABLED) return [];
  const { data, error } = await sb().rpc('supplier_commission_tiers', { p_slug: slug });
  if (error) return [];
  return ((data ?? []) as {
    from_count: number; to_count: number | null; agent_rate: number;
    period: string; counting_scope: string;
  }[]).map((t) => ({
    fromCount: t.from_count, toCount: t.to_count, agentRate: t.agent_rate,
    period: t.period, countingScope: t.counting_scope,
  }));
}
