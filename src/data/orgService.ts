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

/**
 * THE AGENCIES THIS VIEWER CAN REACH, as the server already decided.
 *
 * In Supabase mode the org is hydrated through RLS, so the agencies in the
 * working copy ARE the caller's reachable set: agencies_select was converted
 * to app_scoped_agencies in 20260924120000 and has no partner-wide fallback.
 * Measured on dev as a Regent Director: agencies returns Regent's Lettings and
 * nothing else.
 *
 * WHY THE CLIENT FILTERS AT ALL, when the server already has. Because the
 * client should not be the reason a leak is invisible OR the reason one is
 * possible. Every list the portal draws is built from one book, and a book
 * that widens for any reason -- a definer RPC added later, a hydrate query
 * that forgets a filter -- would widen every figure with it silently. This
 * makes the client say the same thing the server says, so the two have to
 * disagree out loud rather than quietly.
 *
 * NULL MEANS "DO NOT NARROW", and there are two ways to get it.
 *
 * MOCK MODE, because the demo book is not RLS-filtered and its agencies are
 * the whole seed: filtering by them would be filtering by everything, and a
 * test that seeds one agency and asserts over another's rows would fail for a
 * reason that has nothing to do with what it is testing.
 *
 * AN EMPTY ORG, because that means the org has not arrived yet rather than
 * that the viewer reaches nothing. hydrate loads the applications and the org
 * in one pass but a caller can read the book between them, and narrowing to an
 * org that is not there would blank every figure on the page mid-load. It is
 * also safe: a viewer who genuinely reaches no agency is given no applications
 * by RLS either, so there is nothing for this to have narrowed.
 */
export function reachableAgencyNames(): Set<string> | null {
  if (!SUPABASE_ENABLED) return null;
  const names = AGENCIES.filter((a) => !a.isPlaceholder).map((a) => a.name);
  return names.length ? new Set(names) : null;
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
/* =====================================================================
   BY ID, BECAUSE A NAME IS NOT AN IDENTITY ANY MORE.

   Matt, 2026-10-02: "Every link from an agency or branch to
   Applications filters by name (e.g. ?agency=Frost Partnership), so
   with two Frosts in different estates it can show the other one's
   applications. Links must filter by the agency's or branch's id,
   everywhere."

   The last piece of the separate-estates work, and the one that was
   left as a known gap: `agencies.partner_id` has always made two
   estates two rows, and the links kept addressing them by the one
   thing the two rows share.

   WHAT A LINK NEEDS BACK is not the row but the pair the applications
   list can filter on -- the NAME, which is what a summary carries, and
   the ESTATE, which is what tells the two Frosts apart. So these
   return both, and the caller turns them into the filter it already
   understands.
   ===================================================================== */

/**
 * The id of the ONE agency with this name, or null if the name is not
 * unique across the estates.
 *
 * FOR A CALLER THAT HAS ONLY A NAME, and there is one: a League row is
 * an aggregate built from application summaries, which carry their
 * agency as a string. Resolving it here lets that link be
 * estate-correct in the ordinary case, and REFUSES rather than guesses
 * in the case the whole separate-estates change is about. A link that
 * falls back to the name is no worse than it was; one that picked the
 * first match would be the bug with a new coat on.
 */
export function uniqueAgencyIdByName(name: string): string | null {
  const hits = AGENCIES.filter((a) => a.name === name);
  return hits.length === 1 ? hits[0].id ?? null : null;
}

/** The same, for a branch name across every agency. */
export function uniqueBranchIdByName(name: string): string | null {
  const hits: string[] = [];
  for (const a of AGENCIES) {
    for (const b of a.branches ?? []) if (b.name === name && b.id) hits.push(b.id);
  }
  return hits.length === 1 ? hits[0] : null;
}

/** An agency by its id, with the estate it belongs to. */
export function agencyRefById(id: string): { name: string; partner: string } | null {
  const a = AGENCIES.find((x) => x.id === id);
  return a ? { name: a.name, partner: a.partner ?? '' } : null;
}

/** A branch by its id, with its agency and the estate both belong to. */
export function branchRefById(id: string): { name: string; agency: string; partner: string } | null {
  for (const a of AGENCIES) {
    const b = (a.branches ?? []).find((x) => x.id === id);
    if (b) return { name: b.name, agency: a.name, partner: a.partner ?? '' };
  }
  return null;
}

function findAgencyByName(name: string, estate?: string | null): Agency | null {
  /* THE ESTATE PICKS BETWEEN TWO RECORDS OF ONE NAME. Matt, 2026-10-01:
     "Signed deeds on supplier referrals go to the branch contact in the
     supplier's estate." The same real company can be a record of ours and
     a record under a supplier, and by name alone this returned whichever
     came first -- which, for a deed, is the wrong company's mailbox.

     The SEND has always been right: `deed_delivery_target` resolves off
     the application's agency_id and branch_id, which are rows and not
     names. This is the client's PREDICTION of where it will go, and a
     prediction that names the other estate's contact is a screen lying
     about an email that has not been sent yet.

     Optional, because a caller holding a bare name is still better served
     by the first match than by nothing. */
  const all = AGENCIES.filter((a) => a.name === name);
  return (estate ? all.find((a) => a.partner === estate) : undefined) ?? all[0] ?? null;
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

/** Resolve the deed recipient for an application at (agency, branch), in the
    application's own estate. */
export function contactForApplication(agencyName: string, branchName: string, estate?: string | null): { contact: AgentContact | null; inherited: boolean; agency: Agency | null; branch: Branch | null } {
  const agency = findAgencyByName(agencyName, estate);
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
  // Empty, not a dash: see the note in hydrate.ts. Mock mode and live
  // have to agree about what "no address" looks like.
  const branch: Branch = { name: input.name, area: input.area || '', referrers: 0, referrals: 0, guaranteed: '£0' };
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
  const branch: Branch = { name, area: '-', referrers: 0, referrals: 0, guaranteed: '£0', unreviewed: true };
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
/** Whether the pickers should ask the server rather than filter the
    hydrated array. Exported because the picker has to choose a code
    path, and it must make that choice on the same answer these
    functions do. */
export const pickerSearchesOnServer = (): boolean => orgLive();

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
  /** OPTIONAL ON OUR OWN ESTATE, REQUIRED IN A SUPPLIER'S. Matt,
      2026-10-02: "Opndoor's own agencies (like Regent): no email
      required ... leave it blank and nothing is missing", and, about the
      supplier's own tab, "name, address, agency email required". The
      caller does not decide which: `admin_create_agency_and_branch` asks
      the estate, so a blank one is accepted here and refused there. */
  contactEmail?: string;
  contactName?: string;
  contactPhone?: string;
  /** WHICH ESTATE THIS LANDS IN. Matt, 2026-10-02, about the supplier's
      Agencies tab: "Both create the agency or branch in this supplier's
      estate, never in Opndoor's." Absent means our own, which is what
      both existing callers want: the Add agency wizard and the grow
      modal are Opndoor's. */
  partnerSlug?: string;
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
      p_partner_slug: input.partnerSlug ?? 'opndoor-agents',
      p_agency_email: input.contactEmail?.trim() || null,
      p_agency_contact_name: input.contactName?.trim() || null,
      p_agency_phone: input.contactPhone?.trim() || null,
    });
    if (error) throw new Error(cleanRpcError(error.message));
    const row = Array.isArray(data) ? data[0] : data;
    return { agencyId: String(row?.agency_id ?? ''), branchId: String(row?.branch_id ?? '') };
  }
  const ag = addAgency({ name: input.agencyName }, input.partnerSlug ?? 'opndoor-agents');
  /* Mock mode makes the same contact the RPC does, and only when there is
     one: an empty contact row is a mailbox with no address in it, and the
     two modes must agree about whether this agency has one. */
  if (input.contactEmail?.trim()) {
    addContact(ag.name, null, {
      name: input.contactName?.trim() || '', email: input.contactEmail.trim(),
      phone: input.contactPhone?.trim() || '', role: '', primary: true,
    });
  }
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
 * WHICH JOURNEY a referral against this origin runs, resolved by the server.
 *
 * The companion to originIsAgentEstate, and a different question: the ESTATE is
 * who we are (one of our agencies, or a supplier's), the MODE is who checked the
 * tenant. Regent is one of ours AND pre-referenced, so the two answers disagree
 * for them, which is the whole reason both exist.
 *
 * Asked of origin_referencing_mode rather than resolved from the hydrated store
 * by agencyReferencingMode. That helper is right for labelling a row already on
 * screen, and wrong here: it falls back to the PARTNER's mode when the agency's
 * own is not hydrated, and Regent is pre_referenced_open under a partner that is
 * opndoor_referenced. The fallback would therefore tell a Regent tenant's referrer
 * the opposite of the truth. The RPC resolves through the same function
 * create_referral uses, so the form and the write agree by construction.
 *
 * Returns null when it cannot be resolved (no origin chosen yet, or the call
 * failed), and every caller must treat null as "do not claim either journey".
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
  // Mock mode: the same precedence the SQL applies, the agency's own choice over
  // its partner's, read off the seeded tree.
  const agency = findAgency(agencyName);
  if (!agency) return null;
  return agencyReferencingMode(agency, getPartner(agency.partner || homePartner())?.referencingMode ?? null);
}

/**
 * IS THIS ONE OF OUR AGENCIES — the estate question, not the journey one.
 *
 * A joint tenancy needs an agency of ours to sit under: an org tree to split
 * commission across and one guarantee over one property. Whether OPNDOOR or the
 * agency checked the tenants is a different question entirely, and answering
 * this one with that one is what made Regent impossible to express — our
 * agency, our agreement, our joint tenancies, their own referencing.
 *
 * Live mode asks the server, which answers with the same function
 * create_joint_referral enforces, so the form cannot offer a button the RPC
 * would refuse nor withhold one it would allow.
 */
export async function originIsAgentEstate(
  agencyName: string, branchName: string, partnerSlug: string | null | undefined,
): Promise<boolean> {
  if (!agencyName) return false;
  if (orgLive()) {
    const { data, error } = await sb().rpc('origin_is_agent_estate', {
      p_agency: agencyName, p_branch: branchName, p_partner_slug: partnerSlug || null,
    });
    if (error) return false;
    return data === true;
  }
  // Mock mode resolves the same way: the ESTATE is the partner's KIND,
  // never the agency's own referencing choice and never the partner's
  // referencing mode, which is_our_estate_partner stopped reading too.
  const within = partnerSlug
    ? AGENCIES.find((a) => a.name === agencyName && partnerOf(a) === partnerSlug)
    : undefined;
  const a = within ?? AGENCIES.find((x) => x.name === agencyName);
  const slug = a ? partnerOf(a) : (partnerSlug ?? '');
  return getPartner(slug)?.kind === 'agency';
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
  /** ONE ENTRY PER ROUTE the agency has paid business on.

      WRITTEN FOR A MODEL THAT NO LONGER EXISTS, and kept because the shape
      is harmless and the history is worth reading. It was built on Matt's
      ruling of 2026-08-17, that an agency exists once and is never
      duplicated per supplier, so one party could hold two counters. On
      2026-10-01 he replaced that with separate estates: an agency record
      belongs to exactly one partner, so there is exactly one route and
      exactly one counter. The array holds one entry now. */
  volumes: { routeId: string; route: string; count: number }[];
  bands: { min: number; max: number | null; weeks: number; unit?: FeeBasisUnit; rate: number | null }[];
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
    volumes: ((r.volumes ?? []) as { route_id: string; route: string; count: number }[])
      .map((v) => ({ routeId: String(v.route_id), route: String(v.route), count: Number(v.count ?? 0) })),
    bands: (r.bands ?? []) as AgreementView['bands'],
    tiers: (r.tiers ?? []) as AgreementView['tiers'],
    nextRate: r.next_rate == null ? null : Number(r.next_rate),
    nextBasis: r.next_basis == null ? null : Number(r.next_basis),
  };
}

/* ---------- WRITING AN AGREEMENT FROM THE SCREEN ----------

   Agreements were created in SQL only, on the reasoning that a negotiated deal
   is signed on paper and typed in once. In practice that meant a rate the
   commercial team had agreed sat un-entered until somebody with a psql prompt
   was free, and the screen that displayed it could not change it — the single
   most confusing state a settings page can be in.

   These carry the administrator's answers to create_agreement and nothing else.
   Every rule — admin only, the 50% cap, one rate per party, the all-in guards
   both directions, the audit — stays in SQL, and every refusal is surfaced
   VERBATIM. The screen does not restate a rule it does not own. */

/** One tenant-count band: "2 or more tenants pay 5 weeks of rent at 25%". */
/** Weeks of rent, or whole months of it. A month is NOT 4.3333 weeks: 52/12 does
    not terminate, so "one month" priced as weeks came out at 0.99999 of the rent.
    See 20261006120000. */
export type FeeBasisUnit = 'weeks' | 'months';

export interface AgreementBandInput {
  min: number;
  /** null = "and above". Exactly one band may be open-ended, and it must be last. */
  max: number | null;
  /** How many of `unit`, not necessarily weeks. Named for the column it writes. */
  weeks: number;
  /** Absent means weeks, which is what every band held before months existed. */
  unit?: FeeBasisUnit;
  /** null on a band that only changes the FEE and leaves the rate to the tiers. */
  rate: number | null;
}

/** One volume tier: "from the 51st referral in the period, 22%". */
export interface AgreementTierInput {
  from: number;
  to: number | null;
  rate: number;
}

export interface CreateAgreementInput {
  /* 'partner' IS A SUPPLIER, and it is the scope its Commission tab writes
     at. The three below are the agency rail's ladder. */
  level: 'partner' | 'group' | 'agency' | 'branch';
  id: string;
  coverage: 'additive' | 'all_in';
  /* THE FOUR THE DATABASE ALLOWS. `pricing_agreements.period` checks
     against week / month / year / lifetime, and agreement_period_start
     has an arm for each. 'quarter' was in this type and on the screen
     and in neither of those: the insert was refused by the check
     constraint, and had it got through, the period start would have
     been NULL and the volume count nought for ever. */
  period: 'week' | 'month' | 'year' | 'lifetime';
  countingScope: 'agency' | 'group' | 'branch';
  bands: AgreementBandInput[];
  tiers?: AgreementTierInput[];
  note?: string | null;
  /** The administrator has read "this would replace N arrangements" and meant it. */
  confirmReplace?: boolean;
  /** The administrator has read the all-in breach detail and meant it. Audited
      against both parties by SQL; this only carries the answer. */
  confirmBreach?: boolean;
  /** Which of a supplier's two deals this is. Everything on the agency rail
      is a 'commission'; only a supplier has an 'agent_share'. */
  kind?: 'commission' | 'agent_share';
}

export async function createAgreement(input: CreateAgreementInput): Promise<string> {
  if (!orgLive()) throw new Error('Agreements can only be set against live data.');
  const { data, error } = await sb().rpc('create_agreement', {
    p_level: input.level,
    p_id: input.id,
    p_coverage: input.coverage,
    p_period: input.period,
    p_counting_scope: input.countingScope,
    // Sent as strings because the SQL reads them with ->> and casts: an empty
    // string is how "and above" and "no rate on this band" are spelled there.
    p_bands: input.bands.map((b) => ({
      min: b.min, max: b.max == null ? '' : b.max,
      weeks: b.weeks, unit: b.unit ?? 'weeks', rate: b.rate == null ? '' : b.rate,
    })),
    p_tiers: (input.tiers ?? []).map((t) => ({ from: t.from, to: t.to == null ? '' : t.to, rate: t.rate })),
    p_note: input.note ?? null,
    p_confirm_replace: input.confirmReplace ?? false,
    p_confirm_breach: input.confirmBreach ?? false,
    p_kind: input.kind ?? 'commission',
  });
  if (error) throw new Error(cleanRpcError(error.message));
  return String(data);
}

/**
 * A supplier's own live deal of one kind, for its Commission tab.
 *
 * NOT getAgreementForAgency. That one asks the resolver through the agency's
 * first branch, which answers with whichever deal is most SPECIFIC: for a
 * supplier whose agency holds an override it would return the agency's, and
 * the supplier's own tab would show, and then save, terms belonging to one of
 * its agencies. supplier_deal is scope-exact for that reason.
 */
export async function getSupplierDeal(
  slug: string, kind: 'commission' | 'agent_share',
): Promise<AgreementView | null> {
  if (!orgLive()) return null;
  const { data, error } = await sb().rpc('supplier_deal', { p_slug: slug, p_kind: kind });
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
    volumes: [],
    bands: (r.bands ?? []) as AgreementView['bands'],
    tiers: (r.tiers ?? []) as AgreementView['tiers'],
    nextRate: null,
    nextBasis: null,
  };
}

/* ===========================================================================
   THE PICKERS ASK THE SERVER.

   Matt (dg): "with a large supplier (Rightmove could have thousands of
   agencies), don't list everything on click ... Make sure search is
   done on the server, not by loading every agency into the page."

   `searchAgencies` filters an array the browser already holds, which
   means the browser holds every agency. These three replace that at
   scale. They return [] in mock mode, where the caller keeps using the
   in-memory search: there the whole book IS the fixture, and routing
   it through a server that is not there would turn every picker test
   into a test of nothing.
   =========================================================================== */
export interface PickerAgency {
  id: string;
  name: string;
  address: string | null;
  /** How many offices it has, for the option's second line. */
  offices: number;
  /** 'name' | 'office' | 'address' -- why it matched, so the row can say. */
  matchedOn?: string;
  lastUsed?: string | null;
}

/** The fewest characters worth asking the database about. One letter
    matches most of the book and is a scan dressed up as a search; the
    SQL enforces the same floor, and this stops the round trip. */
export const PICKER_MIN_QUERY = 2;
/** Matt's number. The SQL returns one more so the caller can say there
    are more without a second counting query. */
export const PICKER_LIMIT = 20;

const pickerRow = (r: Record<string, unknown>): PickerAgency => ({
  id: String(r.id),
  name: String(r.name ?? ''),
  address: (r.address as string) ?? null,
  offices: Number(r.offices ?? 0),
  matchedOn: (r.matched_on as string) ?? undefined,
  lastUsed: (r.last_used as string) ?? null,
});

/**
 * Best matches for what was typed, plus whether there are more.
 *
 * `more` is true when the server returned one over the limit, which is
 * how "Keep typing to narrow it down" is decided without counting the
 * whole set twice.
 */
export async function searchAgenciesOnServer(
  partner: string, query: string, limit = PICKER_LIMIT,
): Promise<{ rows: PickerAgency[]; more: boolean }> {
  if (!orgLive() || query.trim().length < PICKER_MIN_QUERY) return { rows: [], more: false };
  const { data, error } = await sb().rpc('search_agencies_for_referral',
    {  p_partner: partner === ALL_PARTNERS ? null : partner,
      p_query: query, p_limit: limit });
  if (error) throw new Error(cleanRpcError(error.message));
  const all = ((data ?? []) as Record<string, unknown>[]).map(pickerRow);
  return { rows: all.slice(0, limit), more: all.length > limit };
}

/** The ten this person last referred for, which is the empty state. */
export async function recentAgenciesForPicker(partner: string, limit = 10): Promise<PickerAgency[]> {
  if (!orgLive()) return [];
  const { data, error } = await sb().rpc('recent_agencies_for_referral',
    { p_partner: partner, p_limit: limit });
  if (error) throw new Error(cleanRpcError(error.message));
  return ((data ?? []) as Record<string, unknown>[]).map(pickerRow);
}

export interface PickerBranch { id: string; name: string; address: string | null; area: string | null }

/** Offices within one agency. An empty query is allowed here and not on
    agencies: an agency's office list is bounded by that agency, where
    the agency list is bounded by the supplier and is the thing that can
    be thousands. */
export async function searchBranchesOnServer(
  agencyId: string, query: string, limit = PICKER_LIMIT,
): Promise<{ rows: PickerBranch[]; more: boolean }> {
  if (!orgLive()) return { rows: [], more: false };
  const { data, error } = await sb().rpc('search_branches_for_referral',
    { p_agency: agencyId, p_query: query, p_limit: limit });
  if (error) throw new Error(cleanRpcError(error.message));
  const all = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id), name: String(r.name ?? ''),
    address: (r.address as string) ?? null, area: (r.area as string) ?? null,
  }));
  return { rows: all.slice(0, limit), more: all.length > limit };
}

/* ===========================================================================
   THE SUPPLIER'S DEAL, AS ONE OF ITS AGENCIES' PAGES READS IT.

   Matt (kk)/(cj): "show the supplier's deal for this agency ('On Kestrel
   Lettings' agency deal: 10% (1 to 5 tenants), 15% (6 to 10)'), not
   'Opndoor standard'; say who pays per the frozen setting".

   `getAgreementForAgency` cannot answer this and is not wrong: it
   resolves the 'commission' kind, which on the agency rail IS the
   agency's deal and on the supplier rail is what opndoor pays the
   SUPPLIER. The agency's own money there is the 'agent_share' kind,
   and it belongs to the supplier and is shared with its other
   agencies.

   EMPTY ON OUR OWN ESTATE, by design: there the agency's own deal is
   the answer and this would be a second, emptier one on the same tab.
   =========================================================================== */
export interface SupplierDealForAgency {
  supplierName: string;
  supplierSlug: string;
  /** The supplier's CURRENT setting, which is what a deal page describes. */
  opndoorPaysAgents: boolean;
  agreementId: string | null;
  /** The supplier's default deal, or one this agency is named on. */
  isDefault: boolean;
  bands: AgreementView['bands'];
  tiers: AgreementView['tiers'];
  /** Where there is no deal at all: the rate a referral would price at. */
  flatRate: number | null;
}

export async function getSupplierDealForAgency(agencyId: string): Promise<SupplierDealForAgency | null> {
  if (!orgLive()) return null;
  const { data, error } = await sb().rpc('supplier_deal_for_agency', { p_agency: agencyId });
  if (error) throw new Error(cleanRpcError(error.message));
  const r = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    supplierName: String(r.supplier_name ?? ''),
    supplierSlug: String(r.supplier_slug ?? ''),
    opndoorPaysAgents: r.opndoor_pays_agents === true,
    agreementId: (r.agreement_id as string) ?? null,
    isDefault: r.is_default === true,
    bands: (r.bands ?? []) as AgreementView['bands'],
    tiers: (r.tiers ?? []) as AgreementView['tiers'],
    flatRate: r.flat_rate == null ? null : Number(r.flat_rate),
  };
}

/* ===========================================================================
   DEALS IN THIS SUPPLIER'S ESTATE THAT THIS TAB DID NOT WRITE.

   Matt (gg): "The Commission tab must also still show any agency- or
   group-scope deal that already exists, so nothing can be hidden."

   `getSupplierShareDeals` cannot answer this. It asks the supplier's own
   partner-scope agents'-share deals, which is precisely the set this tab
   writes -- so it is the one set that cannot contain a deal written
   somewhere else. The agency page's own editor could write a deal against
   an agency inside a supplier's estate, and nothing then showed it: not
   this tab, not the agency's, only the resolver, which priced from it.
   =========================================================================== */
export interface OfftabDeal {
  agreementId: string;
  /** 'agency' or 'group' -- never 'partner', which this tab already shows. */
  scopeLevel: 'agency' | 'group';
  /** The agency or group the deal is written against. */
  scopeName: string;
  /** 'commission' is what opndoor pays; 'agent_share' is the agency's cut. */
  kind: 'commission' | 'agent_share';
  coverage: string;
  period: string;
  effectiveFrom: string | null;
  note: string | null;
  bands: AgreementView['bands'];
  tiers: AgreementView['tiers'];
}

export async function getSupplierOfftabDeals(slug: string): Promise<OfftabDeal[]> {
  if (!orgLive()) return [];
  const { data, error } = await sb().rpc('supplier_offtab_deals', { p_slug: slug });
  if (error) throw new Error(cleanRpcError(error.message));
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    agreementId: String(r.agreement_id),
    scopeLevel: r.scope_level === 'group' ? 'group' : 'agency',
    scopeName: String(r.scope_name ?? ''),
    kind: r.kind === 'agent_share' ? 'agent_share' : 'commission',
    coverage: String(r.coverage ?? ''),
    period: String(r.period ?? ''),
    effectiveFrom: (r.effective_from as string) ?? null,
    note: (r.note as string) ?? null,
    bands: (r.bands ?? []) as AgreementView['bands'],
    tiers: (r.tiers ?? []) as AgreementView['tiers'],
  }));
}

/* ===========================================================================
   SEVERAL AGENTS' SHARE DEALS, AND WHO IS ON EACH.

   Matt, 2026-10-01: "One default deal for all agencies, plus extra deals
   that each apply to agencies picked from a searchable list of that
   supplier's agencies (several agencies can share one deal). Show which
   agencies are on which deal, and every agency not picked uses the default."

   `getSupplierDeal` above still exists and still answers "the supplier's
   commission deal", which is a single thing. It cannot answer this one:
   it is built on `active_agreement_of_kind`, which returns one row, and
   WHICH row depends on effective_from.
   =========================================================================== */
export interface ShareDealMember {
  agencyId: string;
  name: string;
  /** "Recorded with who and when", for the line under each agency. */
  addedAt: string | null;
  addedBy: string | null;
}

export interface ShareDealView extends AgreementView {
  /** The deal every agency not named on another is priced by. */
  isDefault: boolean;
  members: ShareDealMember[];
}

export async function getSupplierShareDeals(slug: string): Promise<ShareDealView[]> {
  if (!orgLive()) return [];
  const { data, error } = await sb().rpc('supplier_share_deals', { p_slug: slug });
  if (error) throw new Error(cleanRpcError(error.message));
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    agreementId: String(r.agreement_id),
    scopeLevel: 'partner',
    coverage: 'additive',
    period: String(r.period),
    countingScope: String(r.counting_scope),
    isStandard: false,
    note: (r.note as string) ?? null,
    periodStart: (r.period_start as string) ?? null,
    volume: Number(r.volume ?? 0),
    volumes: [],
    bands: (r.bands ?? []) as AgreementView['bands'],
    tiers: (r.tiers ?? []) as AgreementView['tiers'],
    nextRate: null,
    nextBasis: null,
    isDefault: !!r.is_default,
    members: ((r.members ?? []) as Record<string, unknown>[]).map((m) => ({
      agencyId: String(m.agencyId),
      name: String(m.name),
      addedAt: (m.addedAt as string) ?? null,
      addedBy: (m.addedBy as string) ?? null,
    })),
  }));
}

export interface SaveShareDealInput {
  /** The supplier's uuid: a partner-scope agreement is keyed on partners.id. */
  partnerId: string;
  bands: AgreementBandInput[];
  tiers?: AgreementTierInput[];
  note?: string | null;
  period: 'week' | 'month' | 'year' | 'lifetime';
  countingScope: 'agency' | 'group' | 'branch';
  /** The agencies this deal applies to, and the WHOLE set of them: one named
      that was not on it moves onto it, one on it that is not named goes back
      to the default. Empty is the default deal, which names nobody. */
  agencies: string[];
  /** The live deal being changed. Omitted writes a new one. */
  agreementId?: string | null;
}

/**
 * Write one of a supplier's agents'-share deals and the agencies it applies
 * to, in one call.
 *
 * NOT createAgreement, and this is the correction 20261007300000 makes.
 * create_agreement takes no agencies, so it cannot tell the supplier's
 * default deal from a deal for named agencies -- and the difference decides
 * what it may end. Asked to write a second deal it reported a conflict, and
 * confirming that ended the default AND every other named deal before
 * inserting the new one as the default. The agencies and the terms arriving
 * together is what makes the question answerable, which is exactly what
 * Matt's one dialog sends.
 */
export async function saveShareDeal(input: SaveShareDealInput): Promise<string> {
  if (!orgLive()) throw new Error('Deals can only be set against live data.');
  const { data, error } = await sb().rpc('save_share_deal', {
    p_partner: input.partnerId,
    // Strings for the same reason create_agreement takes them: an empty string
    // is how "and above" and "no rate on this band" are spelled in the SQL.
    p_bands: input.bands.map((b) => ({
      min: b.min, max: b.max == null ? '' : b.max, rate: b.rate == null ? '' : b.rate,
    })),
    p_tiers: (input.tiers ?? []).map((t) => ({ from: t.from, to: t.to == null ? '' : t.to, rate: t.rate })),
    p_note: input.note ?? null,
    p_period: input.period,
    p_counting_scope: input.countingScope,
    p_agencies: input.agencies,
    p_agreement: input.agreementId ?? null,
  });
  if (error) throw new Error(cleanRpcError(error.message));
  return String(data);
}

/** Put an agency on a deal, moving it off whichever it was on. ONE call:
    the server does it as an upsert, so it cannot leave the agency on none. */
export async function setAgencyShareDeal(agreementId: string, agencyId: string): Promise<void> {
  if (!orgLive()) throw new Error('Deals can only be set against live data.');
  const { error } = await sb().rpc('set_agency_share_deal', {
    p_agreement: agreementId, p_agency: agencyId,
  });
  if (error) throw new Error(cleanRpcError(error.message));
}

/** Take an agency off its named deal, which returns it to the default. */
export async function clearAgencyShareDeal(agencyId: string): Promise<void> {
  if (!orgLive()) throw new Error('Deals can only be set against live data.');
  const { error } = await sb().rpc('clear_agency_share_deal', { p_agency: agencyId });
  if (error) throw new Error(cleanRpcError(error.message));
}

/* ===========================================================================
   WHAT CHANGED ABOUT ONE AGENCY.

   Matt, 2026-10-01: "Agency page: add a 'Recent changes' list like the
   supplier's, showing every change to the agency's details, branches,
   people's levels and commission deals in plain English, with who and when,
   using the shared builder."

   Four sources in two shapes; see agency_changes in
   20261007270000. The wording is `changeSentence`, which this does not
   touch: the list and the supplier's must read the same.
   =========================================================================== */
export interface AgencyChange {
  at: Date;
  actor: string;
  /** What the change was about, for the chip at the start of the row. */
  subjectKind: 'agency' | 'branch' | 'person' | 'deal';
  /** The branch or person; null where it is the agency itself. */
  subject: string | null;
  action: string | null;
  detail: string | null;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
}

export async function getAgencyChanges(agencyId: string, limit = 50): Promise<AgencyChange[]> {
  if (!orgLive()) return [];
  const { data, error } = await sb().rpc('agency_changes', { p_agency: agencyId, p_limit: limit });
  if (error) throw new Error(cleanRpcError(error.message));
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    at: new Date(String(r.at)),
    actor: String(r.actor ?? 'somebody'),
    subjectKind: (r.subject_kind as AgencyChange['subjectKind']) ?? 'agency',
    subject: (r.subject as string) ?? null,
    action: (r.action as string) ?? null,
    detail: (r.detail as string) ?? null,
    field: (r.field as string) ?? null,
    oldValue: (r.old_value as string) ?? null,
    newValue: (r.new_value as string) ?? null,
  }));
}

/** End an agreement, returning the party to standard terms from now on.
    History does not move: every application already created keeps the fee and
    the commission lines frozen onto it. */
export async function endAgreement(agreementId: string): Promise<void> {
  if (!orgLive()) throw new Error('Agreements can only be set against live data.');
  const { error } = await sb().rpc('end_agreement', { p_agreement: agreementId });
  if (error) throw new Error(cleanRpcError(error.message));
}

/** Does this refusal have a confirm behind it, and which one?
    Matched on the SQL's own wording, which is the contract: these two messages
    exist precisely to be answered, and every other refusal is final. */
export function agreementConfirmKind(message: string): 'replace' | 'breach' | null {
  if (/would replace \d+ existing arrangement/i.test(message)) return 'replace';
  if (/all-in/i.test(message) && /signed|covers|above/i.test(message)) return 'breach';
  return null;
}

/** One payee line for a branch, as SQL resolved it. */
export interface SplitLine {
  branchId: string;
  level: 'group' | 'agency' | 'branch';
  orgId: string | null;
  orgName: string;
  rate: number;
  /** Where this rate came from, as the RULE reports it — never inferred here.
      'standard' the partner's rate, 'agreement' a negotiated one, 'rate' an
      explicit rate set on that party. A screen that infers it gets an agreement
      party wrong, because their explicit rate is null by design. */
  source: 'standard' | 'agreement' | 'rate';
  /** Every tenant-count band of the deal behind this line, in tenant
      order, or null where one rate covers every count. (v): the payout
      table has to show "20% (1 tenant), 25% (2 or more)" rather than the
      one-tenant rate of a deal that charges differently at two. */
  bands?: { from: number; to: number | null; rate: number }[] | null;
}

/* THE BANDS AS A SENTENCE. Matt (v)'s own example: "20% (1 tenant), 25%
 * (2 or more)".
 *
 * "2 OR MORE" RATHER THAN "2+", and "1 tenant" rather than "1": this sits
 * in a table an agency reads, beside a rate it is owed, and the compact
 * forms read as notation. The existing deal editor already says "2 or
 * more", so this is reaching that wording rather than inventing one.
 *
 * NULL FOR A FLAT DEAL, which the RPC already decides by returning no
 * bands: a caller that rendered "25% (1 or more)" on every ordinary line
 * would make every agency look banded.
 */
export function bandSentence(
  bands: { from: number; to: number | null; rate: number }[] | null | undefined,
  pct: (r: number) => string,
): string | null {
  if (!bands || bands.length < 2) return null;
  return bands
    .map((b, i) => {
      const last = i === bands.length - 1;
      const count = b.to != null && b.to !== b.from
        ? `${b.from} to ${b.to} tenants`
        : last
          ? `${b.from} or more`
          : b.from === 1 ? '1 tenant' : `${b.from} tenants`;
      return `${pct(b.rate)} (${count})`;
    })
    .join(', ');
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
      bands: (r.bands as SplitLine['bands']) ?? null,
      branchId: id,
      level: r.level as SplitLine['level'],
      orgId: (r.org_id as string) ?? null,
      orgName: String(r.org_name ?? ''),
      rate: Number(r.rate ?? 0),
      source: (r.source as SplitLine['source']) ?? 'standard',
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

/* CORRECTING AN AGENCY'S OR OFFICE'S OWN DETAILS.
 *
 * Matt: "Supplier Management (not Referrers) can edit their own agencies'
 * and offices' name, address and email, from the agency's Overview."
 *
 * THERE WAS NO WAY TO EDIT ANY OF THE THREE before 20261008190000: every
 * set_agency_* function on dev changed a SETTING -- group, level, rates,
 * referencing mode, share deal -- and an agency created with a typo stayed
 * that way. Most of them are created by a Referrer filling in a referral
 * form, which is exactly where typos come from.
 *
 * THE SERVER DECIDES WHO, not this. mayEditOwnEstateOrg is the screen's
 * answer and set_agency_details is the database's, and they agree rather
 * than one standing in for the other.
 */
export async function setAgencyDetails(
  agencyId: string, name: string, address: string, email: string,
): Promise<void> {
  if (!SUPABASE_ENABLED) return;
  const { error } = await sb().rpc('set_agency_details', {
    p_agency: agencyId, p_name: name, p_address: address, p_email: email,
  });
  if (error) throw new Error(error.message);
}

/** The same for one office. Its email is an OVERRIDE of its agency's, so
 *  clearing it is a real act and means "use the agency's". */
export async function setBranchDetails(
  branchId: string, name: string, address: string, email: string,
): Promise<void> {
  if (!SUPABASE_ENABLED) return;
  const { error } = await sb().rpc('set_branch_details', {
    p_branch: branchId, p_name: name, p_address: address, p_email: email,
  });
  if (error) throw new Error(error.message);
}
