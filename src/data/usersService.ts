/* =====================================================================
   Users service.
   Enforces the visibility rules: opndoor admin accounts never appear in a
   partner user list; the opndoor team view shows only opndoor staff;
   Management sees only its own partner. Held in memory (the prototype did
   not persist users), so it resets on reload.

   INTEGRATION: getUsers -> GET /users with scope/team; addUser, updateRole,
   reset password, reset 2FA, resend invite and deactivate -> the matching
   mutations. Every rule here must also be enforced server-side.
   ===================================================================== */
import type { AgencyLevel, Role, User, UserStatus } from './types';
import { AGENCY_LEVELS, ALL_PARTNERS, agencyLevelOf } from './types';
import { getSelectedPartner, homePartner, partnerName } from './partnersService';
import { functionErrorMessage } from './paymentService';
import { SUPABASE_ENABLED, sb } from '@/lib/supabase';

// [name, role, lastActive, status, partner] — ported from user-management.html
const SEED: [string, Role, string, UserStatus, string][] = [
  ['Maya Holloway', 'superadmin', '2 minutes ago', 'active', 'opndoor'],
  ['Tom Sefton', 'management', '1 hour ago', 'active', 'northwind'],
  ['Priya Nair', 'referrer', '12 minutes ago', 'active', 'northwind'],
  ['James Okafor', 'referrer', 'Yesterday', 'active', 'northwind'],
  ['Sophie Bennett', 'referrer', '3 hours ago', 'active', 'northwind'],
  ['Rachel Adeyemi', 'management', 'Yesterday', 'active', 'northwind'],
  ['Daniel Wright', 'referrer', '2 days ago', 'active', 'northwind'],
  ['Aisha Khan', 'referrer', '5 hours ago', 'active', 'northwind'],
  ['Marcus Lin', 'referrer', '1 day ago', 'active', 'northwind'],
  ['Eleanor Voss', 'management', '4 days ago', 'active', 'northwind'],
  ['Oliver Grant', 'referrer', '6 hours ago', 'active', 'northwind'],
  ['Naomi Clarke', 'referrer', 'Pending invite', 'pending', 'northwind'],
  ['Greg Mason', 'management', 'Yesterday', 'active', 'harbourside'],
  ['Hannah Pryce', 'referrer', '2 days ago', 'active', 'harbourside'],
  ['Owen Black', 'management', '3 days ago', 'active', 'meridian'],
  ['Ruth Findlay', 'referrer', '1 week ago', 'active', 'meridian'],
];

export interface ManagedUser extends User {
  id: string;
  /** Director if true, Manager if false, on a management user. Meaningless on
      a Negotiator, whose role already withholds commission, and on Opndoor's
      own roles. See agencyLevelOf in types.ts. */
  seesCommission?: boolean;
}

export function emailOf(name: string): string {
  return `${name.toLowerCase().replace(/ /g, '.')}@brackenhouse.co.uk`;
}

let USERS: ManagedUser[] = SEED.map((u, i) => ({ id: `u${i}`, name: u[0], email: emailOf(u[0]), role: u[1], lastActive: u[2], status: u[3], partner: u[4] }));

/** Replace the users working copy from the back end (Supabase mode). */
export function hydrateUsers(users: ManagedUser[]): void {
  USERS = users.slice();
}

/** Display email for a managed user (real in Supabase mode, derived otherwise). */
export function userEmail(u: ManagedUser): string {
  return u.email || emailOf(u.name);
}

export interface GetUsersOpts {
  viewer: Role;
  /** true for the ?team=opndoor view (opndoor admin only). */
  team: boolean;
  /** opndoor admin's selected partner scope; defaults to the persisted selection. */
  scope?: string;
}

/** Users visible to the viewer, following the partner-isolation and team rules. */
export function getUsers(opts: GetUsersOpts): ManagedUser[] {
  const scope = opts.viewer === 'superadmin' ? opts.scope ?? getSelectedPartner() : homePartner();
  const isOpndoorStaff = (r: ManagedUser['role']) => r === 'superadmin' || r === 'opndoor_manager';
  return USERS.filter((u) => {
    if (opts.team) return isOpndoorStaff(u.role); // opndoor team: opndoor's own staff (admin + manager)
    if (isOpndoorStaff(u.role)) return false; // partner lists never include opndoor staff
    if (opts.viewer === 'superadmin') return scope === ALL_PARTNERS || u.partner === scope;
    // Default deny. Every non-superadmin viewer is confined to their own partner,
    // including any role added later. The previous `return true` fallthrough meant
    // a viewer matching none of the branches above skipped partner isolation
    // entirely and saw every partner's users.
    return u.partner === homePartner();
  });
}

/* ---- User lifecycle actions (Supabase RPCs in live mode; working copy + audit
   in mock mode). Every rule (role wall, self/last-admin guard) is enforced
   server-side in the RPC; the client mirrors it for a clean UX. ---- */

export type UserAction = 'status' | 'role' | 'reset_mfa' | 'name' | 'agency level changed' | 'password_reset_sent';
export interface UserAuditEntry {
  action: UserAction | string;
  oldValue: string;
  newValue: string;
  actor: string;
  at: Date;
}

// Mock/test audit store, keyed by user id. Supabase mode uses the user_audit table.
const USER_AUDIT: Record<string, UserAuditEntry[]> = {};
function recordUserAudit(id: string, action: UserAction, oldValue: string, newValue: string): void {
  USER_AUDIT[id] = [{ action, oldValue, newValue, actor: 'You', at: new Date() }, ...(USER_AUDIT[id] ?? [])];
}

/** Change a user's role (Referrer/Management/opndoor admin), behind the role wall. */
export async function updateUserRole(id: string, role: Role): Promise<void> {
  const u = USERS.find((x) => x.id === id);
  if (!u) throw new Error('User not found.');
  if (SUPABASE_ENABLED) {
    const { error } = await sb().rpc('admin_update_user_role', { p_user: id, p_role: role });
    if (error) throw new Error(error.message);
    return; // caller re-hydrates
  }
  const old = u.role;
  if (old !== role) recordUserAudit(id, 'role', old, role);
  u.role = role;
}

/**
 * Set a user's display name.
 *
 * Exists mainly for users the partner API auto-provisions: a partner is not asked
 * to send a referrer name, so an unmatched referrer email creates a user whose
 * full_name is that email. Naming them matters early, because
 * applications.referrer_name is snapshotted at creation and never backfilled, so
 * every application referred before the rename keeps the email for good.
 *
 * Same permission model as updateUserRole: management within their own partner,
 * opndoor admin anywhere. Enforced in admin_update_user_name, not here.
 */
export async function updateUserName(id: string, fullName: string): Promise<void> {
  const u = USERS.find((x) => x.id === id);
  if (!u) throw new Error('User not found.');
  const name = fullName.trim();
  if (!name) throw new Error('A name is required.');
  if (SUPABASE_ENABLED) {
    const { error } = await sb().rpc('admin_update_user_name', { p_user: id, p_full_name: name });
    if (error) throw new Error(error.message);
    return; // caller re-hydrates
  }
  const old = u.name;
  if (old !== name) recordUserAudit(id, 'name', old, name);
  u.name = name;
}

/** Deactivate or reactivate a user (ban/unban + revoke sessions in live mode). */
export async function setUserStatus(id: string, status: 'active' | 'deactivated'): Promise<void> {
  const u = USERS.find((x) => x.id === id);
  if (!u) throw new Error('User not found.');
  if (SUPABASE_ENABLED) {
    const { error } = await sb().rpc('admin_set_user_status', { p_user: id, p_status: status });
    if (error) throw new Error(error.message);
    return;
  }
  const old = u.status;
  if (old !== status) recordUserAudit(id, 'status', old, status);
  u.status = status;
}

/** Cancel a pending invite: removes the pending user, invalidates their invite
    link and frees the email to be invited again. Same authority as inviting
    (the RPC re-checks). No-op-safe in mock mode. */
export async function cancelInvite(id: string): Promise<void> {
  const u = USERS.find((x) => x.id === id);
  if (!u) throw new Error('User not found.');
  if (SUPABASE_ENABLED) {
    const { error } = await sb().rpc('admin_cancel_invite', { p_user: id });
    if (error) throw new Error(error.message || 'Could not cancel the invitation.');
    return;
  }
  const idx = USERS.findIndex((x) => x.id === id);
  if (idx >= 0) USERS.splice(idx, 1);
}

/** Reset a user's 2FA: they re-enrol at next sign in. */
/** Reset somebody's two-factor, and tell them.

    THE EMAIL IS SENT AFTER, AND ITS FAILURE IS NOT THE RESET'S. The reset
    is the thing that had to happen and it is irreversible by the time the
    send is attempted; reporting "could not reset" because an email bounced
    would be a lie that sends an administrator round again. The caller gets
    `emailed: false` and says so. */
export async function resetUserMfa(id: string): Promise<{ emailed: boolean; emailError?: string }> {
  const u = USERS.find((x) => x.id === id);
  if (!u) throw new Error('User not found.');
  if (SUPABASE_ENABLED) {
    const { error } = await sb().rpc('admin_reset_user_mfa', { p_user: id });
    if (error) throw new Error(error.message);
    /* AND NOW TELL THEM. Matt, 2026-10-01, asked for a sentence in "the
       two-factor reset email"; there was no such email at all. A reset
       destroys every factor and every session, and said nothing -- which
       from the person's side is indistinguishable from being attacked.

       THE USER ID, NOT THE ADDRESS. `authorise_mfa_reset_notice` judges
       the caller and hands the address to the edge function, so the
       browser cannot make us email somewhere else. */
    try {
      const { data, error: mailErr } = await sb().functions.invoke('send-mfa-reset-notice', { body: { user: id } });
      if (mailErr || !data?.ok) {
        return { emailed: false, emailError: data?.error ?? mailErr?.message ?? 'Could not send the email.' };
      }
    } catch (e) {
      return { emailed: false, emailError: e instanceof Error ? e.message : 'Could not send the email.' };
    }
    return { emailed: true };
  }
  recordUserAudit(id, 'reset_mfa', 'enrolled', 'reset');
  return { emailed: false };
}

/** Send a password-reset link to a user's email (live mode). No-op in mock mode.
    Routes through the send-password-reset Edge Function (branded Resend email,
    redirected to the review address in this test build) rather than GoTrue's
    built-in mailer, so it honours the review-redirect convention and lands on
    the app's /reset-password screen. */
export async function resetUserPassword(id: string): Promise<void> {
  const u = USERS.find((x) => x.id === id);
  if (!u) throw new Error('User not found.');
  if (SUPABASE_ENABLED) {
    /* AUTHORISED IN SQL FIRST, and this is the whole reason it is two calls.
       send-password-reset is the anonymous Forgot-password endpoint: it takes an
       email address, reads no Authorization header and is verify_jwt false, by
       design. So an admin-initiated reset used to be a byte-identical anonymous
       request, which meant there was nothing to apply the level rule to and no
       record that a member of staff had triggered it.

       authorise_password_reset takes a USER ID, judges the caller against the
       ladder, writes the password_reset_sent audit row and hands back the address.
       The address is not new knowledge for the client (it is already on the
       hydrated row); what is new is that SQL has agreed, and said so in the audit
       trail, before any email is minted. */
    const { data: email, error: authErr } = await sb().rpc('authorise_password_reset', { p_user: id });
    if (authErr) throw new Error(authErr.message);
    if (!email) throw new Error('Could not authorise that reset.');
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const { error } = await sb().functions.invoke('send-password-reset', { body: { email, origin } });
    // The function now answers 503 when the send itself failed, where it used
    // to answer ok. supabase-js turns that into "non-2xx status code", which
    // tells an admin nothing, so say the useful thing instead.
    if (error) throw new Error('We could not send that just now. Try again in a moment.');
  }
}

/* THE LEVEL, WHICH MOVES role AND sees_commission TOGETHER.
   updateUserRole moves only `role`, so using it to demote a Director would leave
   the commission bit behind and produce a Negotiator who still reads as entitled
   to the money. set_agency_level is the one that cannot do that, and it is what
   the Change level control calls. */
export async function setAgencyLevel(id: string, level: AgencyLevel): Promise<void> {
  const u = USERS.find((x) => x.id === id);
  if (!u) throw new Error('User not found.');
  if (SUPABASE_ENABLED) {
    const { error } = await sb().rpc('set_agency_level', { p_user: id, p_level: level });
    if (error) throw new Error(error.message);
    return; // caller re-hydrates
  }
  const spec = AGENCY_LEVELS.find((l) => l.level === level);
  if (!spec) throw new Error('An agency level is Director, Manager or Negotiator.');
  const old = agencyLevelOf(u.role, u.seesCommission === true);
  if (old !== level) recordUserAudit(id, 'agency level changed', old ?? u.role, level);
  u.role = spec.role;
  u.seesCommission = spec.seesCommission;
}

/** Recent lifecycle changes for a user (most recent first). Admin/management scoped. */
export async function getUserAudit(id: string): Promise<UserAuditEntry[]> {
  if (SUPABASE_ENABLED) {
    const { data, error } = await sb()
      .from('user_audit')
      .select('action, old_value, new_value, actor, at')
      .eq('target_user', id)
      .order('at', { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((r: any) => ({
      action: r.action,
      oldValue: r.old_value ?? '',
      newValue: r.new_value ?? '',
      actor: r.actor ?? 'an administrator',
      at: new Date(r.at),
    }));
  }
  return USER_AUDIT[id] ?? [];
}

export interface AddUserInput {
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  /** The commission half of the LEVEL. role says what they reach, this says
      whether they are shown what it earned; together they are Director,
      Manager or Negotiator. Always sent, so the two cannot drift apart. */
  seesCommission?: boolean;
  partner: string;
  /** For a negotiator invite: the branch they will work at, recorded as their home
      branch so the inviting manager sees them from day one. Ignored for other roles. */
  branch?: string;
  /** Invite-from-level: grant this org position on creation, so a brand/group
      manager (or a branch manager) is placed immediately rather than in a second
      step on Users. Omitted for a plain negotiator (placed by their home branch). */
  scopeKind?: 'group' | 'agency' | 'branch';
  scopeTarget?: string;
}

export function addUser(input: AddUserInput): ManagedUser {
  const name = `${input.firstName || 'New'} ${input.lastName || 'User'}`;
  const partner = input.role === 'superadmin' ? 'opndoor' : input.partner || homePartner();
  // A negotiator (referrer) invited to a branch carries it as their home branch, so
  // mock mode shows them on that branch node just as live mode does.
  const homeBranchId = input.role === 'referrer' ? (input.branch ?? null) : null;
  const rec: ManagedUser = { id: `u${USERS.length}_${Math.round(performance.now())}`, name, email: input.email.trim() || emailOf(name), role: input.role, lastActive: 'Pending invite', status: 'pending', partner, homeBranchId };
  USERS.push(rec);
  return rec;
}

/** Invite a new user: in live mode the invite-user Edge Function creates the
    auth user + public.users row and sends a branded invite email (redirected to
    the review address in test mode) that lands on /accept-invite. Mock mode just
    adds the local pending record. The real row appears on the next hydration. */
export async function inviteUser(input: AddUserInput): Promise<ManagedUser> {
  if (SUPABASE_ENABLED) {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const { data, error } = await sb().functions.invoke('invite-user', {
      body: { firstName: input.firstName.trim(), lastName: input.lastName.trim(), email: input.email.trim(), role: input.role, seesCommission: input.seesCommission === true, partner: input.partner, branch: input.role === 'referrer' ? (input.branch ?? '') : '', scopeKind: input.scopeKind ?? '', scopeTarget: input.scopeTarget ?? '', origin },
    });
    if (error) throw new Error(await functionErrorMessage(error, 'Could not send the invitation.'));
    if (!data?.ok) throw new Error(data?.error || 'Could not send the invitation.');
    const partner = input.role === 'superadmin' ? 'opndoor' : input.partner || homePartner();
    const name = `${input.firstName} ${input.lastName}`.trim() || input.email.trim();
    return { id: `pending_${input.email.trim()}`, name, email: input.email.trim(), role: input.role, lastActive: 'Pending invite', status: 'pending', partner };
  }
  return addUser(input);
}

/** Resend an invitation (a fresh set-password link) to a pending/known user. */
export async function resendInvite(id: string): Promise<void> {
  const u = USERS.find((x) => x.id === id);
  if (!u) throw new Error('User not found.');
  if (SUPABASE_ENABLED) {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const parts = (u.name || '').trim().split(/\s+/);
    const { data, error } = await sb().functions.invoke('invite-user', {
      body: { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' '), email: userEmail(u), role: u.role, partner: u.partner === 'opndoor' ? '' : u.partner, origin },
    });
    if (error) throw new Error(await functionErrorMessage(error, 'Could not resend the invitation.'));
    if (!data?.ok) throw new Error(data?.error || 'Could not resend the invitation.');
  }
}

/** Display name of a user's partner (or "opndoor"). */
export function userPartnerName(partner: string): string {
  return partner === 'opndoor' ? 'opndoor' : partnerName(partner);
}
