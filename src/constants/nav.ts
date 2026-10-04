/* =====================================================================
   Sidebar navigation model (ported from portal.js NAV).
   Each item declares the roles allowed to see it; the sidebar filters by
   the active role. Routes replace the prototype's .html hrefs.
   ===================================================================== */
import type { PartnerScope, Role } from '@/data';
import { isAgencyUser, mayUseDevCentre } from '@/data/capabilities';
import type { IconName } from '@/components/ui/Icon';

/**
 * A gate beyond the role: what the user's own PARTY is, or has been set up for.
 *
 * Every one of these is evaluated in two places — the sidebar, to decide what
 * is listed, and App.tsx, to decide what renders when the address is typed. An
 * item hidden by a capability whose route is not also closed by it is a door
 * with no lock, which is the mistake the Dev Centre's own history records
 * below. NAV_CAPABILITY is the single predicate both read.
 */
export type NavCapability = 'devCentre' | 'agencyTeam' | 'orgSection';

export const NAV_CAPABILITY: Record<NavCapability, (role: Role, scope: PartnerScope) => boolean> = {
  devCentre: mayUseDevCentre,
  agencyTeam: isAgencyUser,
  // The admin org section. Its inverse: an agency user gets Team instead, which
  // is the same people under the structure they actually have.
  orgSection: (role, scope) => !isAgencyUser(role, scope),
};

export interface NavItem {
  id: string;
  label: string;
  to: string;
  icon: IconName;
  roles: Role[];
  /** An extra gate beyond the role, checked by the sidebar and the route guard. */
  capability?: NavCapability;
  /** The sidebar fills the count from the matching queue: 'reconcile' from the
      org-review queue, 'decisions' from applications awaiting the decision. */
  badge?: 'reconcile' | 'decisions';
}

export interface NavGroup {
  group: string;
  adminGroup?: boolean;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    group: 'Tracking',
    items: [
      // A developer is partner staff and reads these, scoped to their partner.
      // They are NOT on 'new': a developer creates nothing, and create_referral
      // refuses them in SQL regardless of what the nav shows.
      // opndoor staff land here (queues first); partners land on Reporting.
      { id: 'home', label: 'Home', to: '/home', icon: 'home', roles: ['superadmin', 'opndoor_manager'] },
      /* NO REPORTING OR LEAGUE FOR A DEVELOPER. Matt (at): "they're for
         referral performance and show nothing useful to a developer; keep
         Applications and Dev Centre."

         A DEVELOPER IS NOT ON THE REFERRAL LADDER AT ALL, which is the
         reason rather than the tidiness: they create nothing (the comment
         above this block already notes they are not on 'new'), so every
         figure on both screens is somebody else's work counted for them.
         Applications stays because they are the person debugging what the
         API produced. */
      { id: 'dashboard', label: 'Reporting', to: '/dashboard', icon: 'dashboard', roles: ['superadmin', 'opndoor_manager', 'management', 'referrer'] },
      { id: 'applications', label: 'Applications', to: '/applications', icon: 'apps', roles: ['superadmin', 'opndoor_manager', 'management', 'referrer', 'developer'] },
      { id: 'league', label: 'League', to: '/league', icon: 'trend', roles: ['superadmin', 'opndoor_manager', 'management', 'referrer'] },
      { id: 'new', label: 'New application', to: '/new-application', icon: 'plus', roles: ['superadmin', 'management', 'referrer'] },
    ],
  },
  {
    // Developers see this and nothing else. Management is included ONLY so a
    // leaked API key can be revoked by whoever notices, rather than waiting for
    // a developer who may have left; the screen shows them the keys panel alone.
    group: 'Integration',
    items: [
      // CAPABILITY-GATED, and the route in App.tsx is gated by the same
      // predicate. This item was role-only for a while, for three reasons that
      // were recorded here and that the current rule answers one at a time:
      //
      //   1. "api_access_enabled defaults FALSE, so hiding on it hides the
      //      Dev Centre from every developer." True, and that is now the
      //      intended answer for a party with no API: there is nothing on the
      //      screen for them. A supplier being onboarded gets it the moment an
      //      admin enables API access, which is the same moment their keys
      //      would start working.
      //   2. "It hid the door without locking it." That was the real objection
      //      and it is fixed rather than avoided: NAV_CAPABILITY is read by the
      //      sidebar AND by the route guard, so /dev-centre typed by hand
      //      redirects for exactly the users it is not listed for.
      //   3. "The admin exemption disproves the rule." The admin exemption
      //      stands — they need the screen for a partner they are about to
      //      enable — and mayUseDevCentre is the one place it lives.
      //
      // The reason it could not stay role-only: an agency manager is
      // 'management', and the screen names the party it is showing keys for. On
      // the agent rail that party is opndoor-agents, the house partner, which
      // must never appear on a customer's screen. See mayUseDevCentre.
      { id: 'devcentre', label: 'Dev Centre', to: '/dev-centre', icon: 'book', roles: ['developer', 'superadmin', 'management'], capability: 'devCentre' },
    ],
  },
  {
    // Two relationships, two homes. Suppliers are the partners at the top of the
    // tree (Rightmove, RMT); direct agencies live in Agencies (the house partner
    // that plumbs them never appears). Supplier settings stay superadmin-only.
    group: 'Relationships',
    items: [
      { id: 'partners', label: 'Suppliers', to: '/partners', icon: 'partners', roles: ['superadmin'] },
      // Opndoor and a SUPPLIER's staff see Agencies: a supplier has a book of
      // agencies under it and a real reason to browse them. One of OUR agencies
      // does not — it IS the agency — and the screen it was being shown is an
      // admin's view of an estate, complete with rate cards and other people's
      // branches. It gets Team instead.
      { id: 'org', label: 'Agencies', to: '/agencies', icon: 'org', roles: ['superadmin', 'opndoor_manager', 'management', 'referrer'], capability: 'orgSection' },
    ],
  },
  {
    group: 'Your organisation',
    items: [
      // ONE PAGE FOR AN AGENCY, replacing Agencies and Users both. Their people,
      // grouped by the structure they actually have, with the invites and
      // positions a manager needs. Structure itself is read-only: Opndoor sets
      // up and changes branches and agencies from the admin Agencies section.
      // A NEGOTIATOR HAS NO TEAM. Their level is their own referrals only, so the
      // team is somebody else's list of people: the manager who invited them and
      // the colleagues they do not manage. 'referrer' came off the roles here and
      // off the /team route in the same change, because an item hidden by a role
      // whose route still renders is an unlisted screen, not a hidden one.
      { id: 'team', label: 'Team', to: '/team', icon: 'users', roles: ['management'], capability: 'agencyTeam' },
      /* AND A SUPPLIER'S MANAGEMENT GETS THE SAME WORD FOR THE SAME THING.

         Matt, 2026-10-03: "Replace it with the shared People table, with the
         supplier's levels, 'Sees' column and the same confirmed actions, and
         the sidebar label 'Team' to match agencies."

         IT WAS "Users" UNDER "Administration", which is Opndoor's own section:
         the group is `adminGroup` and sits with Reconciliation and Health. A
         supplier's Management is not in Opndoor's admin section, they are
         looking at their own colleagues, and the page they land on is the same
         shared people table the agency Team page draws.

         THE TWO ITEMS ARE MUTUALLY EXCLUSIVE, which is why they can share a
         group with no further gate: `agencyTeam` is `isAgencyUser` and
         `orgSection` is its exact inverse, so a reader sees one Team item or
         the other and never both. The id stays 'users' because that is the
         route and the highlight key; only the word changes. */
      { id: 'users', label: 'Team', to: '/users', icon: 'users', roles: ['management'], capability: 'orgSection' },
    ],
  },
  {
    group: 'opndoor',
    adminGroup: true,
    items: [
      { id: 'opteam', label: 'opndoor team', to: '/opndoor-team', icon: 'users', roles: ['superadmin'] },
      // Applications awaiting the eligibility decision. Deep-links to the list's
      // Awaiting-decision cohort; the badge counts how many are waiting.
      { id: 'decisions', label: 'Awaiting decision', to: '/applications?status=referencing', icon: 'clock', roles: ['superadmin', 'opndoor_manager'], badge: 'decisions' },
      /* ADMINS ONLY, matching the route. Matt (cc). An opndoor manager
         works the eligibility decision above; reconciliation is where
         money and org records are corrected, and that stayed with us. */
      { id: 'reconcile', label: 'Reconciliation', to: '/reconciliation', icon: 'reconcile', roles: ['superadmin'], badge: 'reconcile' },
      { id: 'health', label: 'Health', to: '/health', icon: 'shield', roles: ['superadmin'] },
      // Internal notifications stood here. Walk fix 10: "Remove the separate
      // Internal notifications page from the menu." Which internal alerts a
      // person receives is on their own row on the opndoor team page now.
    ],
  },
];
