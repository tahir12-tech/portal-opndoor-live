/* =====================================================================
   The ONLY module in the app that touches localStorage.
   The prototype used localStorage as a back-end stand-in. Screens never
   import this directly — they go through the service layer, which uses
   these helpers to persist mock data across reloads.

   INTEGRATION: when a real back end lands, the services that persist via
   these helpers become fetch() calls. This module can then be deleted or
   kept only for genuinely client-side preferences (selected partner/period).
   ===================================================================== */

/** Namespaced localStorage keys used by the prototype data layer. */
export const KEYS = {
  partners: 'grp_partners_v2',
  org: 'grp_org_v3', // v3 adds agent contacts to agencies and branches
  help: 'grp_help_v9', // v9 (#110): real PDFs served + three role-specific portal guides
  role: 'grp_role',
  partner: 'grp_partner',
  period: 'grp_period',
  notifRead: 'grp_notif_read_v1', // per-user "notifications last read" timestamps
  scopeSel: 'grp_scope_sel_v1', // the one scope selection Reporting and Applications share
  scopeRecents: 'grp_scope_recents_v1', // the parties recently looked at, most recent first
} as const;

/**
 * WHAT A SIGN-OUT HAS TO TAKE WITH IT.
 *
 * ROUND 6, THE LAST OF THE EIGHT LOWS. Sign-out already reset the partner
 * scope, the shared selection and the recents, and removed the
 * session-alive marker and Supabase's own token -- somebody had thought
 * about what the next seat inherits. They thought about the PREFERENCES
 * and not about the DATA: `grp_org_v3` is the whole agencies-and-branches
 * working copy INCLUDING agent contacts (names, emails, phone numbers at
 * every agency the signed-out user could reach) and `grp_partners_v2`
 * carries every partner's commission rates. Both survived, on whatever
 * machine that was.
 *
 * A NAMED LIST, so adding a tenth key is a decision somebody makes rather
 * than one they forget. A key holding another party's data that is not
 * here is the same defect again.
 *
 * WHAT IS DELIBERATELY ABSENT.
 *   `period`   a display preference with nobody's data in it. A sign-out
 *              that wipes it is one that annoys people into not signing out.
 *   `help`     admin-authored SHARED content, the same for every reader,
 *              so clearing it costs a re-download and protects nothing.
 *              It is the one genuine judgement here, because it can hold
 *              uploaded PDFs as data URLs, and it is an open question for
 *              Matt rather than a call taken quietly.
 *   `partner`, `scopeSel`, `scopeRecents` are already handled by signOut
 *              itself, which RESETS them to a value rather than removing
 *              the key. Left there so this list does not fight it.
 */
export const CLEAR_ON_SIGNOUT: readonly string[] = [
  KEYS.org,
  KEYS.partners,
  KEYS.role,
  KEYS.notifRead,
];

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Over quota (e.g. a large uploaded help file). Callers surface this to the user.
    return false;
  }
}

export function loadString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function saveString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** Deep clone a seed so callers can mutate their working copy without touching the seed. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * REMOVE THE SIGNED-OUT USER'S PERSISTED WORKING COPIES.
 *
 * STORAGE ONLY. Emptying the in-memory copies has to happen in the same
 * synchronous breath and cannot happen here: orgService and partnersService
 * both import this module, so importing them back is a cycle. That half
 * lives in ./forgetTheSignedOutUser, which imports all three.
 *
 * WRAPPED, because a sign-out that throws is a sign-out that does not
 * finish. localStorage throws outright in a private window and wherever
 * site data is blocked, and the caller is mid-way through tearing down a
 * session when it does. Same reason loadJSON and saveString are wrapped.
 */
export function clearStoredWorkingCopies(): void {
  for (const key of CLEAR_ON_SIGNOUT) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore: a sign-out must finish even where storage is refused */
    }
  }
}
