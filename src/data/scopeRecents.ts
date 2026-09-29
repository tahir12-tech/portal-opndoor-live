/* =====================================================================
   THE PARTIES THIS READER HAS RECENTLY LOOKED AT.

   Matt's C text asks for "recent selections remembered" on the scope picker,
   and his later answer settles that Reporting and Applications share ONE
   remembered choice. So this is one list of PARTIES, not two lists of page
   preferences: having looked at Regent on Applications, Regent is what you
   are most likely to want on Reporting.

   WHAT DOES NOT EARN A SLOT. Everything, the two rails and Direct are always
   one click away at the top of the picker, so remembering them would spend
   the list on the choices that need it least.

   CLEARED WITH THE PARTNER SCOPE, at both places the session resets it. The
   list names real customers; the next person in that seat should not inherit
   it, and the reason is the same one that resets selectedPartner to All.
   ===================================================================== */
import { KEYS, loadJSON, saveJSON } from './storage';
import { ORIGIN_ALL, RAIL_AGENCY, RAIL_SUPPLIER, type OriginScope } from './origin';

const CAP = 5;

/** The quick choices, which are never remembered. */
const NEVER = new Set<OriginScope>([ORIGIN_ALL, RAIL_AGENCY, RAIL_SUPPLIER, 'direct', 'provider']);

export function recentScopes(): OriginScope[] {
  const raw = loadJSON<unknown>(KEYS.scopeRecents, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string' && v !== '').slice(0, CAP);
}

export function rememberScope(v: OriginScope): void {
  if (NEVER.has(v)) return;
  const next = [v, ...recentScopes().filter((x) => x !== v)].slice(0, CAP);
  saveJSON(KEYS.scopeRecents, next);
}

export function clearScopeRecents(): void {
  saveJSON(KEYS.scopeRecents, []);
}
