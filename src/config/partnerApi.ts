/* =====================================================================
   The partner API base URL. One value, one place to change it.

   WHY THIS FILE EXISTS. Whatever we hand a partner gets hardcoded into their
   system and then survives for years. So the host and the path both have to be
   OURS to change, which rules out every URL that was previously in the
   documentation:

     <ref>.supabase.co   the project ref. Migrating projects, or moving off
                         Supabase, would break every integration at once.
     auth.opndoor.co     names the wrong thing. It is where the portal's auth
                         lives, and a partner reading it would reasonably assume
                         the API is an auth service.
     /functions/v1/...   leaks the hosting arrangement into the contract, and
                         contains a second `v1` that is Supabase's Edge Function
                         API version rather than ours. Two unrelated `v1`s in one
                         path is a support conversation waiting to happen.

   api.opndoor.co/v1 says what it is, is ours, and puts our version segment where
   a partner expects to find it.

   THE VALUE IS CONFIGURED, NOT HARDCODED IN THE DOCS. The getting-started
   snippets and the generated API documentation both render whatever is set here,
   so when the domain lands there is one line to change and no hunt through
   markdown for stale curl examples.

   NOTHING IN THIS APP CALLS THE PARTNER API. The portal talks to Postgres
   through supabase-js. This value is documentation only, which is exactly why it
   needs to be centralised: a wrong URL here produces no error anywhere, it just
   quietly ships to partners.
   ===================================================================== */

/**
 * What partners are given. Overridable per deployment so a staging environment
 * can document its own host without editing this file.
 */
export const PARTNER_API_BASE_URL: string =
  (import.meta.env?.VITE_PARTNER_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') ||
  'https://api.opndoor.co/v1';

/**
 * The canonical literal as it is written in PARTNER-API.md.
 *
 * The documentation generator rewrites this string to PARTNER_API_BASE_URL when
 * it extracts the partner-facing sections, so the markdown stays readable to a
 * human while the rendered documentation follows configuration. Keeping the
 * markdown canonical rather than templated means Balal reads a real URL rather
 * than a placeholder.
 */
export const PARTNER_API_CANONICAL_BASE = 'https://api.opndoor.co/v1';

/**
 * Where the request actually lands after the edge rewrite.
 *
 * Recorded here because it is needed for internal testing and for whoever
 * configures the rewrite, and because leaving it undocumented would mean the
 * next person rediscovers it by reading the router. It is NOT what a partner is
 * given. See HANDOVER.md for the DNS and rewrite Balal has to set up.
 */
export const PARTNER_API_UPSTREAM_PATH = '/functions/v1/partner-api/v1';
