/* =====================================================================
   Session context — the seam between authentication and the app.

   Mock mode (no Supabase / tests): the demo role switcher drives role and
   the mock service data is used. Status is always "ready", no gate.

   Supabase mode: the real session drives everything. Password sign-in is
   AAL1; only after TOTP step-up (AAL2) do we load the user's profile, pin the
   home partner, seed the role, and hydrate the service layer from the DB. The
   dev role switcher remains (a UI lens; data stays RLS-scoped to the session).
   ===================================================================== */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ALL_PARTNERS, authService, getSelectedPartner, homePartner, setHomePartner,
  setSelectedPartner as persistPartner, getSelectedPeriod, setSelectedPeriod as persistPeriod,
  logViewAs, partnerName,
  LEAST_PRIVILEGED_ROLE, type PartnerScope, type Period, type Role, hydrateCommissionVisibility, commissionVisibility,
  agencyLevelOf, maySeeCommission,
} from '@/data';
import { topLevelSeesCommission, isAgencyUser } from '@/data/capabilities';
import { KEYS, loadString, saveString } from '@/data/storage';
import { ORIGIN_ALL, figuresFollow, partnerFor, type OriginScope } from '@/data/origin';
import { clearScopeRecents, rememberScope } from '@/data/scopeRecents';
import { forgetTheSignedOutUser } from '@/data/forgetTheSignedOutUser';
import { ROLES, type RoleIdentity } from '@/constants/roles';
import { SUPABASE_ENABLED, supabase } from '@/lib/supabase';
import { hydrateFromSupabase } from '@/lib/hydrate';
import { anyTabAlive, clearSessionAlive, sessionRecentlyAlive, startHeartbeat, stopHeartbeat } from '@/session/browserSession';

export type SessionStatus = 'loading' | 'signedOut' | 'needsMfa' | 'ready';

interface Profile {
  userId: string;
  role: Role;
  name: string;
  email: string;
  partner: string | null;
  /** The Director / Manager bit, off the signed-in user's own row. Role alone
      cannot tell the two apart, so anything that compares levels needs this. */
  seesCommission: boolean;
}

interface SessionValue {
  role: Role;
  /** Demo/dev switcher — a UI lens in Supabase mode (data stays RLS-scoped). */
  setRole: (role: Role) => void;
  /** The signed-in identity (sidebar footer, activity). */
  user: RoleIdentity;
  /** The signed-in user's id (Supabase mode), for self-action guards. Null in mock mode. */
  currentUserId: string | null;
  /* THE VIEWER'S OWN HALF OF THEIR LEVEL, exposed as the raw bit beside `role`
     rather than as a precomputed level.

     Needed because Director and Manager are the same role and differ only here, so
     "may I act on this person" cannot be answered from `role`. The two things that
     look like they would do instead both fail: `user.label` is display copy that
     falls back to "Management" whenever isAgencyUser is false, and
     maySeeCommission() reads a module singleton that DEFAULTS TRUE, so in mock,
     demo and every vitest run a Manager would read as a Director.

     Raw pair, and no isAgencyUser gate: gating it would silently treat a
     supplier's management staff as Directors of an agency. Like `role`, this is a
     lens for deciding what to draw. The ladder in SQL is the boundary. */
  seesCommission: boolean;
  partnerScope: PartnerScope;
  /** THE PARTY AN OPNDOOR ADMIN HAS NARROWED TO, or null when they are not
      narrowed to anybody and for every non-admin reader.

      One definition, here, because it was computed inline in Topbar to draw
      the exit pill and would otherwise have been computed a second time in
      Reporting to decide what Reporting draws. Two copies of "am I looking at
      somebody else's screen" is how the two screens come to disagree. */
  viewingAs: OriginScope | null;
  selectedPartner: PartnerScope;
  setSelectedPartner: (id: PartnerScope) => void;
  /** THE ONE SCOPE SELECTION, shared by Reporting and Applications.

      Matt, 2026-09-29: "Reporting and Applications share one remembered scope
      choice." It is richer than `selectedPartner` -- it can be a rail, an
      agency by name or a group -- and `selectedPartner` continues to hold the
      real partner slug the isolation rule speaks in. See partnerFor(). */
  scopeSel: OriginScope;
  setScopeSel: (v: OriginScope) => void;
  period: Period;
  setPeriod: (id: string) => void;
  /** Auth (Supabase mode). In mock mode: status is always "ready". */
  status: SessionStatus;
  authError: string | null;
  /** Mark TOTP as freshly verified in this runtime (called by Login on a
      successful code). Grants AAL2 trust that a restored session cannot forge. */
  markMfaVerified: () => void;
  signOut: () => Promise<void>;
  /** Re-load the RLS-scoped datasets after a mutation (no-op in mock mode). */
  refresh: () => Promise<void>;
  /** Bumped whenever the working copies re-hydrate; use in memo deps to recompute
      derived views (e.g. an application detail) after a mutation + refresh(). */
  dataVersion: number;
}

const SessionContext = createContext<SessionValue | null>(null);

/* 'opndoor_manager' WAS MISSING FROM HERE, and the list is doing exactly what
   it was built to do about that: failing an unknown role to the least
   privileged one. The cost was still real and had two shapes. In Supabase
   mode the profile arrives a moment later and calls setRole, so Opndoor's
   ops staff got a Negotiator's page on every load until it landed. In mock
   and test mode there IS no profile, so the role never corrected: staging
   `grp_role = 'opndoor_manager'` produced a referrer for good, which means
   no render test of this role could say anything true, and one of mine
   quietly did not. Found while fixing their blank Reporting page. */
const KNOWN_ROLES: Role[] = ['superadmin', 'opndoor_manager', 'management', 'referrer', 'developer'];

/**
 * The role cached in localStorage, used before the profile loads.
 *
 * The membership test was never the bug. The FALLBACK was: an unrecognised value
 * resolved to 'superadmin', so any role this list did not know about was
 * promoted to the most privileged one. In mock, demo and test mode, where the
 * session is ready immediately, that rendered the full opndoor-admin lens.
 *
 * Failing to the least privileged role is correct for any future role, not just
 * 'developer'. Adding a role to KNOWN_ROLES is now the only thing that grants it
 * anything, and forgetting to costs the user access rather than granting it.
 */
function initialRole(): Role {
  const r = loadString(KEYS.role);
  return KNOWN_ROLES.includes(r as Role) ? (r as Role) : LEAST_PRIVILEGED_ROLE;
}

function initialsOf(name: string): string {
  return name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const emb = (x: any): any => (Array.isArray(x) ? x[0] : x);

// In-memory (per-runtime, NON-persisted) proof that this runtime's AAL2 session
// is trusted — set once we either resume a still-live browser session or verify
// a fresh TOTP. It resets on every fresh page load, so it can never be restored
// from storage; the shared token in localStorage is inert without it.
let mfaTrustedThisRuntime = false;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>(initialRole);
  const [selectedPartner, setSelectedPartnerState] = useState<PartnerScope>(() => getSelectedPartner());
  const [scopeSel, setScopeSelState] = useState<OriginScope>(() => loadString(KEYS.scopeSel) ?? ORIGIN_ALL);
  const [period, setPeriodState] = useState<Period>(() => getSelectedPeriod());
  const [status, setStatus] = useState<SessionStatus>(SUPABASE_ENABLED ? 'loading' : 'ready');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  // Bumped once hydration completes so any background re-hydration (session
  // refresh, a mutation's refresh()) forces consumers to re-read live data.
  const [dataVersion, setDataVersion] = useState(0);
  const hydratedFor = useRef<string | null>(null);
  // The single in-flight hydration for a user. Concurrent resolve() calls (mount
  // + onAuthStateChange) await THIS promise rather than racing ahead to 'ready'
  // while the working copies still hold mock data.
  const hydration = useRef<{ userId: string; promise: Promise<void> } | null>(null);

  const setRole = useCallback((next: Role) => {
    saveString(KEYS.role, next);
    setRoleState(next);
  }, []);

  const setSelectedPartner = useCallback((id: PartnerScope) => {
    persistPartner(id);
    setSelectedPartnerState(id);
    // Entering a partner's view is an audited "view as" (the server refuses the
    // log for non-staff, so this is safe to fire for the superadmin selector).
    if (id !== ALL_PARTNERS) void logViewAs('partner', partnerName(id));
  }, []);

  const setScopeSel = useCallback((v: OriginScope) => {
    saveString(KEYS.scopeSel, v);
    setScopeSelState(v);
    rememberScope(v);
    /* THE PARTNER SCOPE FOLLOWS, and only for a supplier. partnerScope mirrors
       the server's isolation rule, so it must keep holding a real partner slug
       or nothing; a rail, an agency or a group leaves it open and the
       selection narrows afterwards, in scopeFull, where it cannot be mistaken
       for an authorisation test. setSelectedPartner also writes the view-as
       audit row, which is why the call goes through it rather than the setter
       beneath it. */
    setSelectedPartner(partnerFor(v));
  }, [setSelectedPartner]);

  const setPeriod = useCallback((id: string) => {
    persistPeriod(id);
    setPeriodState(getSelectedPeriod());
  }, []);

  // Resolve the Supabase session -> status, and hydrate once at AAL2.
  const resolve = useCallback(async () => {
    if (!SUPABASE_ENABLED || !supabase) {
      setStatus('ready');
      return;
    }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setProfile(null);
        setStatus('signedOut');
        return;
      }
      const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if ((aalData?.currentLevel ?? 'aal1') !== 'aal2') {
        setStatus('needsMfa');
        return;
      }
      // The token in localStorage is shared across tabs and survives a browser
      // quit, so a stored AAL2 level is not sufficient on its own. Trust it only
      // when this runtime already verified TOTP, OR when a tab was recently alive
      // (a same-tab refresh or a new tab of a still-live session): a fresh heartbeat
      // stamp, or — if the stamp looks stale because a backgrounded tab's timer was
      // throttled — a live tab answering the liveness ping. A cold start after a
      // full quit has neither, so we force a fresh TOTP challenge.
      if (!mfaTrustedThisRuntime) {
        if (sessionRecentlyAlive() || (await anyTabAlive())) {
          mfaTrustedThisRuntime = true;
        } else {
          setStatus('needsMfa');
          return;
        }
      }
      // Trusted: keep the heartbeat fresh so other tabs and the next refresh resume.
      startHeartbeat();
      const userId = session.user.id;
      const { data, error } = await supabase
        .from('users')
        .select('role, full_name, email, status, sees_commission, partner:partners(slug)')
        .eq('id', userId)
        .single();
      if (error || !data) {
        setAuthError(error?.message ?? 'Could not load your profile.');
        setStatus('needsMfa');
        return;
      }
      // Deactivated mid-session: the ban revoked their refresh token, but a
      // still-valid access token could otherwise linger until it expires. Sign
      // out immediately on any app load so deactivation takes effect at once.
      if ((data.status as string) === 'deactivated') {
        await supabase.auth.signOut();
        mfaTrustedThisRuntime = false;
        stopHeartbeat();
        clearSessionAlive();
        hydratedFor.current = null;
        hydration.current = null;
        setProfile(null);
        setAuthError('This account has been deactivated. Contact your administrator.');
        setStatus('signedOut');
        return;
      }
      const prof: Profile = {
        userId,
        role: data.role as Role,
        name: data.full_name as string,
        email: data.email as string,
        partner: emb(data.partner)?.slug ?? null,
        // Already in the select above, so this costs no extra round trip.
        seesCommission: data.sees_commission === true,
      };
      /* THE DIRECTOR / MANAGER BIT, set before anything renders.
         Both are management scope and the only difference is whether they are
         shown what the agency earns, so this has to be in place before the
         first Reporting paint or a Manager sees the figures flash. The client
         gate decides what to DRAW; may_see_commission() in SQL decides what is
         ANSWERED, and a Manager's commission RPCs return nothing either way. */
      hydrateCommissionVisibility(data.sees_commission === true);
      if (prof.partner) setHomePartner(prof.partner);
      setProfile(prof);
      setRole(prof.role);
      if (hydratedFor.current !== userId) {
        // #100 A seat change within the same runtime (a DIFFERENT user resolves
        // without an in-app sign-out, e.g. the auth token was swapped) must not
        // inherit the prior admin's persisted partner scope. Reset to All. (A
        // first-ever hydration has hydratedFor.current === null, so a same-user
        // reload keeps their own saved selection.)
        if (hydratedFor.current !== null && hydratedFor.current !== userId) {
          persistPartner(ALL_PARTNERS);
          setSelectedPartnerState(ALL_PARTNERS);
          // The recents name real customers; a new seat does not inherit them.
          saveString(KEYS.scopeSel, ORIGIN_ALL);
          setScopeSelState(ORIGIN_ALL);
          clearScopeRecents();
          /* AND NOT THE PREVIOUS SEAT'S BOOK EITHER. This branch already
             reset the PREFERENCES a new seat must not inherit and left
             the DATA standing: the org working copy carries agent
             contacts for every agency the last user could reach. The
             hydrate below will overwrite it, but not until it returns,
             and it is only started when the user actually changes. */
          forgetTheSignedOutUser();
        }
        // Start hydration exactly once per user; concurrent resolves reuse and
        // await the same promise. Critically, 'ready' is only set AFTER this
        // resolves, so the app never renders the mock working copies in live mode.
        if (hydration.current?.userId !== userId) {
          hydration.current = { userId, promise: hydrateFromSupabase(userId, prof.role) };
        }
        try {
          await hydration.current.promise;
        } catch (e) {
          hydration.current = null; // allow a later resolve() to retry
          throw e;
        }
        hydratedFor.current = userId;
        setDataVersion((v) => v + 1);
      }
      setAuthError(null);
      setStatus('ready');
    } catch (e) {
      hydratedFor.current = null;
      hydration.current = null; // drop any cached promise so the next resolve() re-hydrates
      setAuthError(e instanceof Error ? e.message : 'Sign-in failed.');
      setStatus('needsMfa');
    }
  }, [setRole]);

  useEffect(() => {
    if (!SUPABASE_ENABLED || !supabase) return;
    void resolve();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void resolve();
    });
    return () => sub.subscription.unsubscribe();
  }, [resolve]);

  const markMfaVerified = useCallback(() => {
    mfaTrustedThisRuntime = true;
    // Fresh TOTP verified: begin the heartbeat so a new tab or the next refresh
    // resumes without re-authenticating (until the browser is fully closed).
    startHeartbeat();
  }, []);

  const signOut = useCallback(async () => {
    if (SUPABASE_ENABLED) {
      hydratedFor.current = null;
      // Drop the cached hydration promise: signing back in (even as the same
      // user, in-page with no reload) must re-fetch, not replay a stale snapshot.
      hydration.current = null;
      // Revoke AAL2 trust and stop/forget the heartbeat: a fresh sign-in must
      // re-verify TOTP, and a new tab must not resume off a stale liveness stamp.
      mfaTrustedThisRuntime = false;
      stopHeartbeat();
      clearSessionAlive();
      // #100 Reset the partner scope to All on sign-out. It is persisted in
      // localStorage, so without this the next seat (a different opndoor admin
      // signing in) inherits the prior admin's scope. Clear BOTH the persisted
      // value and the React state, since init re-reads localStorage.
      persistPartner(ALL_PARTNERS);
      setSelectedPartnerState(ALL_PARTNERS);
      saveString(KEYS.scopeSel, ORIGIN_ALL);
      setScopeSelState(ORIGIN_ALL);
      clearScopeRecents();
      /* ROUND 6's LAST LOW. The four lines above reset the preferences a
         next seat must not inherit; none of them touched the DATA.
         `grp_org_v3` holds every agency and branch this user could reach
         WITH their agent contacts on them, and `grp_partners_v2` holds
         every partner's commission rates, and both survived a sign-out
         on whatever machine that was. */
      forgetTheSignedOutUser();
      await authService.signOut();
      setProfile(null);
      setStatus('signedOut');
    }
  }, []);

  const refresh = useCallback(async () => {
    if (SUPABASE_ENABLED && hydratedFor.current) {
      await hydrateFromSupabase(hydratedFor.current, role);
    }
    // #10 Always bump dataVersion so memoised derived views (e.g. the application
    // detail) recompute after a mutation. In mock/demo mode there is nothing to
    // re-hydrate, but the working copies were mutated in place, so the bump is what
    // makes every surface reflect the change.
    setDataVersion((v) => v + 1);
  }, []);

  // Expose the role on <html> for role-scoped CSS (mirrors portal.js).
  useEffect(() => {
    document.documentElement.setAttribute('data-role', role);
  }, [role]);

  /* THE READER'S BOOK.
     `homePartner()` is the right answer for everybody who HAS a home
     partner, and Opndoor's ops staff do not have one: 20260922090000's
     users_partner_by_role constraint requires partner_id to be NULL for
     the role, so nothing ever calls setHomePartner for them and the module
     default stands. In mock that default is the string 'northwind', so
     Opndoor's own operations staff were scoped to one arbitrary supplier
     and scopeFull's FIRST filter emptied their book before the role
     allowlist below was even consulted. They read the whole estate, which
     is what ALL_PARTNERS says; they have no partner switch, which is why
     they take the constant rather than `selectedPartner`. */
  const partnerScope = role === 'superadmin' ? selectedPartner
    : role === 'opndoor_manager' ? ALL_PARTNERS
      : homePartner();
  /* VIEWING AS A PARTY MEANS THE PAGE IS THAT PARTY'S PAGE, so it may only
     be true where the figures are actually theirs. `figuresFollow` is that
     test and today it admits `partner:<slug>` alone: see its note in
     origin.ts for why an `agency:` or `group:` selection currently changes
     the wording and the gates without moving a single number.

     Matt's stopgap, 2026-09-30: "make sure no banner can claim a party the
     figures don't reflect." Narrowed HERE rather than on the button,
     because the button is only one of the doors: Applications' own Origin
     picker writes the same shared `scopeSel`, and the value is restored
     from localStorage on every load.

     `isOneParty` has no caller left after this change. It is kept, and kept
     exported, because it is the question this line SHOULD be asking and
     will ask again the moment the figures follow the selection. Deleting it
     and re-deriving it later is how the distinction gets lost. */
  const viewingAs = role === 'superadmin' && figuresFollow(scopeSel) ? scopeSel : null;

  /* AND WHILE VIEWING AS SOMEBODY, COMMISSION IS THEIR ANSWER, NOT OURS.

     Matt, 2026-10-03: "fix View as to read the viewed person's access, not the
     admin's."

     WHAT WAS WRONG. `maySeeCommission` answers true for `superadmin`
     unconditionally and reads the signed-in user's own `sees_commission` for
     management. Under View as the ROLE does not change -- only the scope does
     -- so an admin viewing Kestrel was answered as an admin. Kestrel's own
     Management users hold sees_commission false (the invite defect fixed the
     same day), so View as showed a page no real Kestrel user could open. View
     as exists to check what a customer sees, and it was showing more.

     WHAT IT READS INSTEAD: the TOP LEVEL OF THAT PARTY'S OWN RAIL, which is
     the most any of their people can be shown. A supplier's is Management and
     an agency's is Director, and since the same day both see commission -- so
     today this answers true for every party and the fix is a no-op on screen.
     That is the point: it is now true BY CONSTRUCTION rather than by the
     admin's own level happening to be generous, and a rail whose management
     does not see commission would be reflected rather than overridden.

     NOT "DO THIS PARTY'S USERS SEE IT", which was the other candidate and is
     worse: it would make View as depend on whether a customer happens to have
     invited a Director yet, so the same page would answer differently on
     Monday and Tuesday. The level is a property of the rail; the people are
     not. */
  /* RESTORED ON THE WAY OUT, BY THE EFFECT'S OWN CLEANUP.

     RESTORED, NOT RECOMPUTED. Recomputing the reader's answer from their
     profile looked equivalent and is not: in mock and demo mode there is no
     row to recompute from, and the default this file documents as deliberate
     ("blanking the figures for every Director in mock and demo mode is a
     visible fault to fix a risk that does not exist") would have been
     overwritten with false on every mount.

     AND CLEANUP RATHER THAN AN else ARM, because `SEES_COMMISSION` is MODULE
     state and this effect mutates it. An else arm restores it when View as is
     switched off and leaves it swapped when the provider UNMOUNTS while
     viewing -- so the next reader in the same runtime inherits a stranger's
     answer. Caught by two render tests in this repo that mount a provider per
     case: an agency reading its own Reporting lost "Your commission" because
     an earlier case in the same file had been viewing as somebody. The same
     leak is reachable in the product by signing out from inside View as. */
  useEffect(() => {
    if (!viewingAs) return undefined;
    const own = commissionVisibility();
    hydrateCommissionVisibility(topLevelSeesCommission(viewingAs));
    return () => { hydrateCommissionVisibility(own); };
  }, [viewingAs]);

  /* THE LABEL UNDER THE NAME, in the words the agency uses for itself.

     It read ROLES[role].label, which is our vocabulary: "Management" and
     "Referrer". Nobody at an agency holds either. They hold one of three levels,
     Director, Manager or Negotiator, which is what the invite dialog offers, what
     Team prints beside each person and what the admin screens call them, so the
     sidebar was the one surface still naming them by the role underneath.

     Only for an agency user. A supplier's staff are also role 'management' and
     are not Directors of anything, and Opndoor's own staff are not agency people
     at all, so both keep their own label. agencyLevelOf answers null for anyone
     with no level, and the fallback is the label it always was.

     maySeeCommission rather than a field on the profile: it is the same hydrated
     source every other commission decision reads, so the sidebar cannot disagree
     with the screens about whether this person is a Director or a Manager. `user`
     is recomputed on every render, and dataVersion bumps after hydration, so the
     label follows the flag rather than freezing before it arrives. */
  const base: RoleIdentity = profile
    ? { name: profile.name, label: ROLES[profile.role].label, initials: initialsOf(profile.name) }
    : ROLES[role];

  /* BOTH PATHS, and the first attempt at this only did one. The level was applied
     inside the `profile` branch, which exists only in Supabase mode, so the mock
     and demo shell carried on calling people Management and Referrer. The rule is
     about what an agency person is called, not about which back end is answering. */
  const levelRole = profile?.role ?? role;
  const agencyLevel = isAgencyUser(levelRole, partnerScope)
    ? agencyLevelOf(levelRole, maySeeCommission(levelRole))
    : null;

  const user: RoleIdentity = agencyLevel ? { ...base, label: agencyLevel } : base;

  const value = useMemo<SessionValue>(
    () => ({ role, setRole, user, currentUserId: profile?.userId ?? null,
             /* Mock and demo have no profile, so they fall back to the singleton and
                keep behaving exactly as they do today (a mock management viewer
                reads as a Director). */
             seesCommission: profile ? profile.seesCommission : maySeeCommission(role),
             partnerScope, viewingAs, selectedPartner, setSelectedPartner, scopeSel, setScopeSel, period, setPeriod, status, authError, markMfaVerified, signOut, refresh, dataVersion }),
    // dataVersion is intentionally a dep: bumping it after (re-)hydration changes
    // the context identity so consumers re-read the refreshed working copies.
    [role, setRole, user, profile, partnerScope, viewingAs, selectedPartner, setSelectedPartner, scopeSel, setScopeSel, period, setPeriod, status, authError, markMfaVerified, signOut, refresh, dataVersion],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}

export { ALL_PARTNERS };
