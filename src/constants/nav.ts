/* =====================================================================
   Sidebar navigation model (ported from portal.js NAV).
   Each item declares the roles allowed to see it; the sidebar filters by
   the active role. Routes replace the prototype's .html hrefs.
   ===================================================================== */
import type { Role } from '@/data';
import type { IconName } from '@/components/ui/Icon';

export interface NavItem {
  id: string;
  label: string;
  to: string;
  icon: IconName;
  roles: Role[];
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
      { id: 'dashboard', label: 'Reporting', to: '/dashboard', icon: 'dashboard', roles: ['superadmin', 'opndoor_manager', 'management', 'referrer', 'developer'] },
      { id: 'applications', label: 'Applications', to: '/applications', icon: 'apps', roles: ['superadmin', 'opndoor_manager', 'management', 'referrer', 'developer'] },
      { id: 'league', label: 'League', to: '/league', icon: 'trend', roles: ['superadmin', 'opndoor_manager', 'management', 'referrer', 'developer'] },
      { id: 'new', label: 'New application', to: '/new-application', icon: 'plus', roles: ['superadmin', 'management', 'referrer'] },
    ],
  },
  {
    // Developers see this and nothing else. Management is included ONLY so a
    // leaked API key can be revoked by whoever notices, rather than waiting for
    // a developer who may have left; the screen shows them the keys panel alone.
    group: 'Integration',
    items: [
      // superadmin is deliberately NOT capability-gated below: an opndoor admin
      // needs to reach the Dev Centre for a partner they are about to enable,
      // which is the moment the capability is still off.
      // ROLE ONLY, deliberately. This item briefly also required the partner's
      // api_access_enabled capability, on the reasoning that a developer at a
      // portal-only partner has no API to develop against. Three things were
      // wrong with that:
      //
      //   1. The capability defaults FALSE and is never backfilled, so "a
      //      developer at a portal-only partner" was every developer at every
      //      partner. The role lost the only screen it exists for.
      //   2. It hid the door without locking it. The route guard in App.tsx is
      //      role-based, so /dev-centre still rendered if you typed it. Hiding
      //      that enforces nothing costs usability and buys no safety.
      //   3. The capability's own exemption disproved it: opndoor admin was
      //      exempted because "they need the Dev Centre for a partner they are
      //      about to enable, which is exactly when the capability is off". That
      //      is the developer's situation too, and more often.
      //
      // api_access_enabled is enforced where it means something: it gates key
      // AUTHENTICATION and minting in SQL. The Dev Centre reports that state
      // rather than being hidden by it.
      { id: 'devcentre', label: 'Dev Centre', to: '/dev-centre', icon: 'book', roles: ['developer', 'superadmin', 'management'] },
    ],
  },
  {
    group: 'Organisation',
    items: [{ id: 'org', label: 'Agencies & branches', to: '/agencies', icon: 'org', roles: ['superadmin', 'opndoor_manager', 'management', 'referrer'] }],
  },
  {
    group: 'Administration',
    adminGroup: true,
    items: [
      { id: 'partners', label: 'Partners', to: '/partners', icon: 'partners', roles: ['superadmin'] },
      { id: 'users', label: 'Users', to: '/users', icon: 'users', roles: ['management'] },
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
      { id: 'reconcile', label: 'Reconciliation', to: '/reconciliation', icon: 'reconcile', roles: ['superadmin', 'opndoor_manager'], badge: 'reconcile' },
      { id: 'health', label: 'Health', to: '/health', icon: 'shield', roles: ['superadmin'] },
    ],
  },
];
