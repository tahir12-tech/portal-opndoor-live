/* =====================================================================
   Organisation service — agencies + branches.
   Backed by a working copy persisted to localStorage so additions made on
   the new-application form appear on the Agencies & branches screen and
   vice versa.

   INTEGRATION: getAgencies -> GET /agencies?partner=; search* -> scoped
   search endpoints; createAgency/BranchOnTheFly -> POST that returns the
   new id and FLAGS the record for reconciliation (unreviewed = true).
   ===================================================================== */
import type { Agency, AgencyGroup, AgentContact, Branch, PartnerScope } from './types';
import { ALL_PARTNERS } from './types';
import { KEYS, clone, loadJSON, saveJSON } from './storage';
import { ORG_SEED } from './mock/org';
import { getPartner, homePartner } from './partnersService';
import { SUPABASE_ENABLED, sb } from '@/lib/supabase';
import { isHydrated } from './applicationsService';

let AGENCIES: Agency[] = loadJSON<Agency[]>(KEYS.org, clone(ORG_SEED));
if (!AGENCIES.length) AGENCIES = clone(ORG_SEED);

function persist(): void {
  saveJSON(KEYS.org, AGENCIES);
}

/** Replace the agencies/branches/contacts tree from the back end (Supabase mode). */
export function hydrateOrg(agencies: Agency[]): void {
  AGENCIES = agencies.slice();
}

function partnerOf(a: Agency): string {
  return a.partner || homePartner();
}

/** All agencies within a partner scope ("all" returns every partner's agencies).
    House-partner placeholders ("Unattached", is_placeholder) are never real agencies
    and are excluded everywhere — the list, the detail page, branch pickers and
    position targets. Unmatched direct signups live in the Reconciliation match queue. */
export function getAgencies(scope: PartnerScope): Agency[] {
  const real = AGENCIES.filter((a) => !a.isPlaceholder);
  if (scope === ALL_PARTNERS) return real.slice();
  return real.filter((a) => partnerOf(a) === scope);
}

export function findAgency(name: string): Agency | undefined {
  return AGENCIES.find((a) => a.name === name);
}

/* ---- Agency groups (the top commission tier + "whole group" position target) ----
   Hydrated from agency_groups in Supabase mode; empty in mock unless created. */
let GROUPS: AgencyGroup[] = [];

/** Replace the agency-groups working copy from the back end (Supabase mode). */
export function hydrateGroups(groups: AgencyGroup[]): void {
  GROUPS = groups.slice();
}

/** Groups within a partner scope ("all" returns every partner's groups). */
export function getGroups(scope: PartnerScope): AgencyGroup[] {
  if (scope === ALL_PARTNERS) return GROUPS.slice();
  return GROUPS.filter((g) => g.partner === scope);
}

export function getGroup(id: string): AgencyGroup | undefined {
  return GROUPS.find((g) => g.id === id);
}

/* ---- Commission overrides + group management (Phase 5) --------------------
   The write path for the tiers resolve_rates already reads (group -> agency ->
   partner). Commission edits are superadmin-only server-side (set_*_rates);
   group create/attach is org management. The working copy is updated on success
   so the screen reflects the change before the next re-hydrate. A null rate means
   "inherit the next tier up". */
export async function setAgencyRates(agencyId: string, partnerRate: number | null, agentRate: number | null): Promise<void> {
  if (SUPABASE_ENABLED) {
    const { error } = await sb().rpc('set_agency_rates', { p_agency: agencyId, p_partner_rate: partnerRate, p_agent_rate: agentRate });
    if (error) throw new Error(error.message);
  }
  const a = AGENCIES.find((x) => x.id === agencyId);
  if (a) { a.partnerRate = partnerRate; a.agentRate = agentRate; persist(); }
}

export async function setGroupRates(groupId: string, partnerRate: number | null, agentRate: number | null): Promise<void> {
  if (SUPABASE_ENABLED) {
    const { error } = await sb().rpc('set_group_rates', { p_group: groupId, p_partner_rate: partnerRate, p_agent_rate: agentRate });
    if (error) throw new Error(error.message);
  }
  const g = GROUPS.find((x) => x.id === groupId);
  if (g) { g.partnerRate = partnerRate; g.agentRate = agentRate; }
}

export async function createAgencyGroup(partnerSlug: string, name: string): Promise<AgencyGroup> {
  let id: string;
  if (SUPABASE_ENABLED) {
    const { data, error } = await sb().rpc('create_agency_group', { p_partner_slug: partnerSlug, p_name: name });
    if (error) throw new Error(error.message);
    id = String(data);
  } else {
    id = `grp-${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}-${GROUPS.length + 1}`;
  }
  const rec: AgencyGroup = { id, partner: partnerSlug, name: name.trim(), partnerRate: null, agentRate: null };
  GROUPS.push(rec);
  return rec;
}

export async function setAgencyGroup(agencyId: string, groupId: string | null): Promise<void> {
  if (SUPABASE_ENABLED) {
    const { error } = await sb().rpc('set_agency_group', { p_agency: agencyId, p_group: groupId });
    if (error) throw new Error(error.message);
  }
  const a = AGENCIES.find((x) => x.id === agencyId);
  if (a) { a.groupId = groupId ?? undefined; persist(); }
}

/** Same as findAgency but returns null. Internal helper for createBranchOnTheFly. */
function findAgencyByName(name: string): Agency | null {
  return AGENCIES.find((a) => a.name === name) ?? null;
}

/* =====================================================================
   Agent contacts. A branch uses its own contacts if it has any, otherwise
   it inherits the parent agency's (the agency is the default). Exactly one
   contact is primary per owner. These resolvers are pure; the mutations
   persist and enforce the one-primary-per-owner invariant.
   ===================================================================== */

/** The flagged primary contact, else the first, else null. Internal helper. */
function primaryOf(contacts?: AgentContact[]): AgentContact | null {
  if (!contacts || !contacts.length) return null;
  return contacts.find((c) => c.primary) ?? contacts[0];
}

/** The contacts that apply to a branch: its own if any, otherwise the agency's. */
export function effectiveContacts(agency: Agency | null, branch?: Branch | null): { list: AgentContact[]; inherited: boolean } {
  const own = branch && branch.contacts ? branch.contacts : [];
  if (own.length) return { list: own, inherited: false };
  return { list: agency && agency.contacts ? agency.contacts : [], inherited: true };
}

export function effectivePrimary(agency: Agency | null, branch?: Branch | null): { contact: AgentContact | null; inherited: boolean } {
  const eff = effectiveContacts(agency, branch);
  return { contact: primaryOf(eff.list), inherited: eff.inherited };
}

/** Resolve the deed recipient for an application at (agency, branch). */
export function contactForApplication(agencyName: string, branchName: string): { contact: AgentContact | null; inherited: boolean; agency: Agency | null; branch: Branch | null } {
  const agency = findAgencyByName(agencyName);
  if (!agency) return { contact: null, inherited: false, agency: null, branch: null };
  const branch = (agency.branches || []).find((b) => b.name === branchName) ?? null;
  const ep = effectivePrimary(agency, branch);
  return { contact: ep.contact, inherited: ep.inherited, agency, branch };
}

/* ---- contact mutations (used by the org contact-management UI) ---- */

/** The owner object to mutate: a branch when branchName is given, else the agency. */
function contactOwner(agencyName: string, branchName: string | null): Agency | Branch | null {
  const agency = findAgency(agencyName);
  if (!agency) return null;
  if (!branchName) return agency;
  return (agency.branches || []).find((b) => b.name === branchName) ?? null;
}
function ownerList(owner: Agency | Branch): AgentContact[] {
  if (!owner.contacts) owner.contacts = [];
  return owner.contacts;
}

export function addContact(agencyName: string, branchName: string | null, contact: AgentContact): void {
  const owner = contactOwner(agencyName, branchName);
  if (!owner) return;
  const list = ownerList(owner);
  const rec: AgentContact = { ...contact };
  if (rec.primary) list.forEach((c) => (c.primary = false));
  if (!list.length) rec.primary = true; // the first contact is always primary
  list.push(rec);
  persist();
}

export function updateContact(agencyName: string, branchName: string | null, index: number, contact: AgentContact): void {
  const owner = contactOwner(agencyName, branchName);
  if (!owner) return;
  const list = ownerList(owner);
  if (index < 0 || index >= list.length) return;
  const rec: AgentContact = { ...contact };
  if (rec.primary) list.forEach((c) => (c.primary = false));
  list[index] = rec;
  // Keep exactly one primary: if this edit demoted the owner's only primary,
  // promote the oldest remaining (list is insertion/oldest-first), mirroring the
  // live org_update_contact backstop so mock and live never diverge.
  if (list.length && !list.some((c) => c.primary)) list[0].primary = true;
  persist();
}

export function removeContact(agencyName: string, branchName: string | null, index: number): void {
  const owner = contactOwner(agencyName, branchName);
  if (!owner || !owner.contacts) return;
  const list = owner.contacts;
  if (index < 0 || index >= list.length) return;
  const wasPrimary = list[index].primary;
  list.splice(index, 1);
  if (wasPrimary && list.length) list[0].primary = true; // promote the first remaining
  persist();
}

export function setPrimaryContact(agencyName: string, branchName: string | null, index: number): void {
  const owner = contactOwner(agencyName, branchName);
  if (!owner || !owner.contacts) return;
  owner.contacts.forEach((c, i) => (c.primary = i === index));
  persist();
}

/** Type-ahead: agencies within scope whose name matches the query. */
export function searchAgencies(query: string, scope: PartnerScope): Agency[] {
  const ql = query.trim().toLowerCase();
  return getAgencies(scope).filter((a) => !ql || a.name.toLowerCase().includes(ql));
}

/** Type-ahead: branches of an agency whose name matches the query. */
export function searchBranches(agencyName: string, query: string): Branch[] {
  const agency = findAgency(agencyName);
  if (!agency) return [];
  const ql = query.trim().toLowerCase();
  return agency.branches.filter((b) => !ql || b.name.toLowerCase().includes(ql));
}

export interface AddAgencyInput {
  name: string;
  group?: string;
}

/** Add an agency from the Agencies & branches screen (stamped to the active partner). */
export function addAgency(input: AddAgencyInput, scope: PartnerScope): Agency {
  const partner = scope === ALL_PARTNERS ? homePartner() : scope;
  /* A LOCAL id, even in mock mode. Everything that re-parents, nominates or sets
     a rate addresses an agency by id, and without one those calls silently found
     nothing and did nothing — so the grow path appeared to work and changed
     nothing. Supabase mode overwrites this with the real row id on hydrate. */
  const id = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const agency: Agency = { id, name: input.name, partner, users: 0, referrals: 0, guaranteed: '£0', fees: 0, open: true, branches: [] };
  if (input.group) agency.group = input.group;
  AGENCIES.push(agency);
  persist();
  return agency;
}

export interface AddBranchInput {
  name: string;
  area?: string;
}

export function addBranch(agencyName: string, input: AddBranchInput): Branch | null {
  const agency = findAgency(agencyName);
  if (!agency) return null;
  const branch: Branch = { name: input.name, area: input.area || '—', referrers: 0, referrals: 0, guaranteed: '£0' };
  agency.branches.push(branch);
  agency.open = true;
  persist();
  return branch;
}

/** Create an agency on the fly from the referral form. Flagged unreviewed for reconciliation. */
export function createAgencyOnTheFly(name: string, scope: PartnerScope): Agency {
  const partner = scope === ALL_PARTNERS ? homePartner() : scope;
  const agency: Agency = { name, partner, users: 0, referrals: 0, guaranteed: '£0', fees: 0, branches: [], unreviewed: true };
  AGENCIES.push(agency);
  persist();
  return agency;
}

/** Create a branch on the fly under an agency. Flagged unreviewed for reconciliation. */
export function createBranchOnTheFly(agencyName: string, name: string): Branch | null {
  const agency = findAgency(agencyName);
  if (!agency) return null;
  const branch: Branch = { name, area: '—', referrers: 0, referrals: 0, guaranteed: '£0', unreviewed: true };
  agency.branches.push(branch);
  persist();
  return branch;
}

/* =====================================================================
   Live-aware org mutations (Agencies & branches screen). In Supabase mode
   every change persists through a gated RPC (AAL2 + role-checked, admin
   creations land confirmed, partner-user creations pending_review); the
   caller then re-hydrates so the working copy mirrors the server and nothing
   an admin saves can vanish on the next hydration. In mock/test mode the same
   edits apply to the local working copy so the demo behaves identically.
   ===================================================================== */
const orgLive = (): boolean => SUPABASE_ENABLED && isHydrated();

/**
 * Never surface a raw Postgres internal error to the UI (#67). Our RPCs raise
 * friendly, sentence-cased messages; anything that reads like a database
 * internal (mentions tuple/constraint/relation/permission, or a raw errcode) is
 * replaced with a generic, safe message.
 */
function cleanRpcError(msg?: string): string {
  const m = (msg || '').trim();
  if (!m) return 'Something went wrong. Please try again.';
  if (/tuple|constraint|violates|duplicate key|relation "|column "|operator |syntax error|permission denied for|out of range|deadlock|current command/i.test(m)) {
    return 'Something went wrong saving that change. Please try again.';
  }
  return m;
}

export interface CreateAgencyInput {
  name: string;
  group?: string;
  /** Required: the agency default contact (no bare agencies through any door). */
  contactEmail: string;
  contactName?: string;
  contactPhone?: string;
}

/** Persist a new agency (with its required default contact) for the given scope. */
export async function createAgencyLive(input: CreateAgencyInput, scope: PartnerScope): Promise<void> {
  if (orgLive()) {
    const { error } = await sb().rpc('admin_add_agency', {
      p_name: input.name,
      p_group: input.group ?? null,
      p_partner_slug: scope === ALL_PARTNERS ? null : scope,
      p_contact_email: input.contactEmail,
      p_contact_name: input.contactName ?? null,
      p_contact_phone: input.contactPhone ?? null,
    });
    if (error) throw new Error(cleanRpcError(error.message));
    return;
  }
  const ag = addAgency({ name: input.name, group: input.group }, scope);
  addContact(ag.name, null, {
    name: input.contactName?.trim() || '',
    email: input.contactEmail, phone: input.contactPhone?.trim() || '', role: '', primary: true,
  });
}

export interface CreateBranchInput {
  name: string;
  area?: string;
  /** Optional: a branch with no contact inherits the agency default. */
  contactEmail?: string;
  contactName?: string;
  contactPhone?: string;
}

/** Persist a new branch under an agency, with an optional own contact. */
export async function createBranchLive(agency: Agency, input: CreateBranchInput): Promise<void> {
  if (orgLive()) {
    if (!agency.id) throw new Error('This agency is not yet saved. Refresh and try again.');
    const { error } = await sb().rpc('admin_add_branch', {
      p_agency_id: agency.id,
      p_name: input.name,
      p_area: input.area ?? null,
      p_contact_email: input.contactEmail?.trim() || null,
      p_contact_name: input.contactName ?? null,
      p_contact_phone: input.contactPhone ?? null,
    });
    if (error) throw new Error(cleanRpcError(error.message));
    return;
  }
  const br = addBranch(agency.name, { name: input.name, area: input.area });
  if (br && input.contactEmail?.trim()) {
    addContact(agency.name, br.name, {
      name: input.contactName?.trim() || '',
      email: input.contactEmail.trim(), phone: input.contactPhone?.trim() || '', role: '', primary: true,
    });
  }
}

export interface CreateAgencyFlowInput {
  agencyName: string;
  /** Optional: a skeleton agency whose manager adds branches on first login. */
  branchName?: string;
  /** Parent the agency at creation. Same result as creating it independent and
      re-parenting, which is what the grow path does. */
  groupId?: string;
  branchArea?: string;
  /** Commission overrides as fractions (null = inherit the Opndoor standard). */
  partnerRate?: number | null;
  agentRate?: number | null;
}

/** Admin onboarding: create an independent agent-rail agency + its first branch in
    one call, returning the new ids so the caller can send the first invite. No group;
    the agency is independent until it grows. */
export async function createAgencyWithBranch(input: CreateAgencyFlowInput): Promise<{ agencyId: string; branchId: string }> {
  if (orgLive()) {
    const { data, error } = await sb().rpc('admin_create_agency_and_branch', {
      p_agency_name: input.agencyName,
      p_branch_name: input.branchName ?? null,
      p_branch_area: input.branchArea ?? null,
      p_partner_rate: input.partnerRate ?? null,
      p_agent_rate: input.agentRate ?? null,
      p_group_id: input.groupId ?? null,
    });
    if (error) throw new Error(cleanRpcError(error.message));
    const row = Array.isArray(data) ? data[0] : data;
    return { agencyId: String(row?.agency_id ?? ''), branchId: String(row?.branch_id ?? '') };
  }
  const ag = addAgency({ name: input.agencyName }, 'opndoor-agents');
  if (input.partnerRate != null) ag.partnerRate = input.partnerRate;
  if (input.agentRate != null) ag.agentRate = input.agentRate;
  if (input.groupId) ag.groupId = input.groupId;
  const br = input.branchName ? addBranch(ag.name, { name: input.branchName, area: input.branchArea }) : null;
  persist();
  return { agencyId: ag.id ?? ag.name, branchId: br?.id ?? br?.name ?? '' };
}

/** Undo what a creation flow made, when a later step of it failed. Admin only;
    refuses to remove anything that already carries applications. */
export async function deleteOrgShape(agencyIds: string[], groupId?: string): Promise<void> {
  if (!orgLive()) {
    AGENCIES = AGENCIES.filter((a) => !a.id || !agencyIds.includes(a.id));
    if (groupId) GROUPS = GROUPS.filter((g) => g.id !== groupId);
    persist();
    return;
  }
  const { error } = await sb().rpc('admin_delete_org_shape', {
    p_agency_ids: agencyIds, p_group_id: groupId ?? null,
  });
  if (error) throw new Error(cleanRpcError(error.message));
}

/** An agency's effective referencing route: its own if set, else its partner's.
    Mirrors resolve_referencing_mode in SQL, which is what actually decides the
    journey; this exists so a screen can label a row without a round trip. */
export function agencyReferencingMode(agency: Agency, partnerMode: string | null | undefined): string | null {
  return agency.referencingMode ?? partnerMode ?? null;
}

/**
 * THE RAIL a referral against this agent and branch would actually run on.
 *
 * The form asks before it offers multi-tenant, because a joint tenancy is an
 * agent-rail thing: a pre-referenced referral arrives with its references
 * already done and covers one tenant. create_joint_referral refuses the rest,
 * and this is what stops the form offering a button that would be refused.
 *
 * Partner-qualified, because an admin on "all partners" can name an agency that
 * exists under two — the ambiguity the partner label on the picker options
 * exists to avoid. An agency that does not exist yet inherits its partner's
 * mode, which is what a fly-created one will get.
 *
 * Live mode asks the server (origin_referencing_mode), which resolves through
 * the same functions create_joint_referral uses, so the form and the RPC cannot
 * disagree. Mock mode resolves from the hydrated store.
 */
export async function originReferencingMode(
  agencyName: string, branchName: string, partnerSlug: string | null | undefined,
): Promise<string | null> {
  if (!agencyName) return null;
  if (orgLive()) {
    const { data, error } = await sb().rpc('origin_referencing_mode', {
      p_agency: agencyName, p_branch: branchName, p_partner_slug: partnerSlug || null,
    });
    if (error) return null;
    return (data as string | null) ?? null;
  }
  const within = partnerSlug
    ? AGENCIES.find((a) => a.name === agencyName && partnerOf(a) === partnerSlug)
    : undefined;
  const a = within ?? AGENCIES.find((x) => x.name === agencyName);
  const partnerMode = (slug: string) => getPartner(slug)?.referencingMode ?? null;
  if (!a) return partnerSlug ? partnerMode(partnerSlug) : null;
  return agencyReferencingMode(a, partnerMode(partnerOf(a)));
}

/** Set or clear an agency's own referencing route. Admin only. */
export async function setAgencyReferencingMode(agencyId: string, mode: string | null): Promise<void> {
  if (!orgLive()) {
    const a = AGENCIES.find((x) => x.id === agencyId);
    if (a) { a.referencingMode = mode; persist(); }
    return;
  }
  const { error } = await sb().rpc('set_agency_referencing_mode', { p_agency: agencyId, p_mode: mode });
  if (error) throw new Error(cleanRpcError(error.message));
}

/** A negotiated agreement as the admin panel shows it. */
export interface AgreementView {
  agreementId: string;
  scopeLevel: string;
  /** 'additive' — the party's own line, everything else still adds — or 'all_in',
      the whole commission for everything under the party. */
  coverage: 'additive' | 'all_in';
  period: string;
  countingScope: string;
  isStandard: boolean;
  note: string | null;
  periodStart: string | null;
  volume: number;
  bands: { min: number; max: number | null; weeks: number; rate: number | null }[];
  tiers: { from: number; to: number | null; rate: number }[];
  nextRate: number | null;
  nextBasis: number | null;
}

/** The agreement pricing this agency, with its bands, tiers and where its volume
    counter currently sits. Null when the party is on standard terms. */
export async function getAgreementForAgency(agencyId: string): Promise<AgreementView | null> {
  if (!orgLive()) return null;
  const { data, error } = await sb().rpc('agreement_for_agency', { p_agency: agencyId });
  if (error) throw new Error(cleanRpcError(error.message));
  const r = Array.isArray(data) ? data[0] : data;
  if (!r) return null;
  return {
    agreementId: String(r.agreement_id),
    scopeLevel: String(r.scope_level),
    coverage: r.coverage === 'all_in' ? 'all_in' : 'additive',
    period: String(r.period),
    countingScope: String(r.counting_scope),
    isStandard: !!r.is_standard,
    note: (r.note as string) ?? null,
    periodStart: (r.period_start as string) ?? null,
    volume: Number(r.volume ?? 0),
    bands: (r.bands ?? []) as AgreementView['bands'],
    tiers: (r.tiers ?? []) as AgreementView['tiers'],
    nextRate: r.next_rate == null ? null : Number(r.next_rate),
    nextBasis: r.next_basis == null ? null : Number(r.next_basis),
  };
}

/** One payee line for a branch, as SQL resolved it. */
export interface SplitLine {
  branchId: string;
  level: 'group' | 'agency' | 'branch';
  orgId: string | null;
  orgName: string;
  rate: number;
}

/** Every payee line for a page of branches, in ONE call.

    There is deliberately no client-side copy of the additive rule: SQL
    (commission_split) is the only implementation, and it is the same function
    create_referral freezes onto an application, so the page cannot show a split
    that differs from the one that would actually be paid. */
export async function getCommissionSplits(branchIds: string[]): Promise<Map<string, SplitLine[]>> {
  const out = new Map<string, SplitLine[]>();
  if (!orgLive() || !branchIds.length) return out;
  const { data, error } = await sb().rpc('commission_split_batch', { p_branches: branchIds });
  if (error) throw new Error(cleanRpcError(error.message));
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const id = String(r.branch_id);
    const list = out.get(id) ?? [];
    list.push({
      branchId: id,
      level: r.level as SplitLine['level'],
      orgId: (r.org_id as string) ?? null,
      orgName: String(r.org_name ?? ''),
      rate: Number(r.rate ?? 0),
    });
    out.set(id, list);
  }
  return out;
}

/** What a pending rate change WOULD produce, without writing it. Same rule, same
    function: the preview and the save cannot disagree. */
export async function previewNodeRate(
  level: 'group' | 'agency' | 'branch', id: string, rate: number | null,
): Promise<{ worstTotal: number; worstBranch: string | null } | null> {
  if (!orgLive()) return null;
  const { data, error } = await sb().rpc('commission_preview', { p_level: level, p_id: id, p_rate: rate });
  if (error) throw new Error(cleanRpcError(error.message));
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return { worstTotal: Number(row.worst_total ?? 0), worstBranch: (row.worst_branch as string) ?? null };
}

/** Set or clear ONE node's commission line (group, agency or branch).
    Returns the worst branch total the change produces, which the editor shows
    before the user commits. The 50% refusal is raised by SQL and surfaced
    verbatim: the rule lives in one place and the screen does not restate it. */
/**
 * Set or clear one party's explicit rate.
 *
 * confirmBreach is the administrator saying, deliberately, that they mean to put
 * a line over an all-in agreement below — which takes that agency's branches
 * above the number it signed. SQL refuses without it and audits the override
 * against both parties with it; this only carries the answer.
 */
export async function setNodeRate(level: 'group' | 'agency' | 'branch', id: string, rate: number | null, confirmBreach = false): Promise<number> {
  if (!orgLive()) {
    // Mock mode: apply locally so the screen still reflects the edit.
    if (level === 'agency') { const a = AGENCIES.find((x) => x.id === id); if (a) a.agentRate = rate; }
    else if (level === 'group') { const g = GROUPS.find((x) => x.id === id); if (g) g.agentRate = rate; }
    else { for (const a of AGENCIES) { const b = (a.branches ?? []).find((x) => x.id === id); if (b) b.agentRate = rate; } }
    persist();
    return 0;
  }
  const { data, error } = await sb().rpc('set_node_rate', {
    p_level: level, p_id: id, p_rate: rate, p_confirm_breach: confirmBreach,
  });
  if (error) throw new Error(cleanRpcError(error.message));
  return Number(data ?? 0);
}

/** Add a contact to an agency (branch = null) or a branch. */
export async function addContactLive(agency: Agency, branch: Branch | null, rec: AgentContact): Promise<void> {
  if (orgLive()) {
    const ownerId = branch ? branch.id : agency.id;
    if (!ownerId) throw new Error('This record is not yet saved. Refresh and try again.');
    const { error } = await sb().rpc('org_add_contact', {
      p_agency_id: branch ? null : agency.id,
      p_branch_id: branch ? branch.id : null,
      p_name: rec.name, p_role: rec.role || null, p_email: rec.email, p_phone: rec.phone || null, p_primary: rec.primary,
    });
    if (error) throw new Error(cleanRpcError(error.message));
    return;
  }
  addContact(agency.name, branch?.name ?? null, rec);
}

/** Update an existing contact by its DB id (index used only in mock mode). */
export async function updateContactLive(agency: Agency, branch: Branch | null, index: number, contactId: string | undefined, rec: AgentContact): Promise<void> {
  if (orgLive()) {
    if (!contactId) throw new Error('This contact is not yet saved. Refresh and try again.');
    const { error } = await sb().rpc('org_update_contact', {
      p_id: contactId, p_name: rec.name, p_role: rec.role || null, p_email: rec.email, p_phone: rec.phone || null, p_primary: rec.primary,
    });
    if (error) throw new Error(cleanRpcError(error.message));
    return;
  }
  updateContact(agency.name, branch?.name ?? null, index, rec);
}

/** Remove a contact by its DB id (index used only in mock mode). */
export async function removeContactLive(agency: Agency, branch: Branch | null, index: number, contactId: string | undefined): Promise<void> {
  if (orgLive()) {
    if (!contactId) throw new Error('This contact is not yet saved. Refresh and try again.');
    const { error } = await sb().rpc('org_remove_contact', { p_id: contactId });
    if (error) throw new Error(cleanRpcError(error.message));
    return;
  }
  removeContact(agency.name, branch?.name ?? null, index);
}

/** Set a contact as its owner's primary, by DB id (index used only in mock mode). */
export async function setPrimaryLive(agency: Agency, branch: Branch | null, index: number, contactId: string | undefined): Promise<void> {
  if (orgLive()) {
    if (!contactId) throw new Error('This contact is not yet saved. Refresh and try again.');
    const { error } = await sb().rpc('org_set_primary_contact', { p_id: contactId });
    if (error) throw new Error(cleanRpcError(error.message));
    return;
  }
  setPrimaryContact(agency.name, branch?.name ?? null, index);
}

/** Derived counts for a partner (used by the Partners screen). */
export function orgCounts(partnerId: string): { agencies: number; branches: number } {
  let agencies = 0;
  let branches = 0;
  AGENCIES.forEach((a) => {
    if (partnerOf(a) === partnerId) {
      agencies++;
      branches += a.branches ? a.branches.length : 0;
    }
  });
  return { agencies, branches };
}
