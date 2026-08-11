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
  /**
   * A partner capability this item also requires.
   *
   * Separate from `roles` because they answer different questions: the role says
   * whether this PERSON may use the screen, the capability says whether their
   * PARTNER has the thing the screen is about. A developer at a portal-only
   * partner passes the role test and should still not see a Dev Centre, because
   * there is no API for them to develop against.
   *
   * Hiding is not the enforcement. Every Dev Centre RPC scopes itself and key
   * minting refuses when the capability is off. This keeps a dead item out of
   * the sidebar; it is not what stops anybody doing anything.
   */
  requiresCapability?: 'api';
  /** Set on the reconciliation item; the sidebar fills the count from the queue. */
  badge?: 'reconcile';
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
      { id: 'dashboard', label: 'Dashboard', to: '/dashboard', icon: 'dashboard', roles: ['superadmin', 'management', 'referrer', 'developer'] },
      { id: 'applications', label: 'Applications', to: '/applications', icon: 'apps', roles: ['superadmin', 'management', 'referrer', 'developer'] },
      { id: 'league', label: 'League', to: '/league', icon: 'trend', roles: ['superadmin', 'management', 'referrer', 'developer'] },
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
      { id: 'devcentre', label: 'Dev Centre', to: '/dev-centre', icon: 'book', roles: ['developer', 'superadmin', 'management'], requiresCapability: 'api' },
    ],
  },
  {
    group: 'Organisation',
    items: [{ id: 'org', label: 'Agencies & branches', to: '/agencies', icon: 'org', roles: ['superadmin', 'management', 'referrer'] }],
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
      { id: 'opteam', label: 'opndoor team', to: '/users?team=opndoor', icon: 'users', roles: ['superadmin'] },
      { id: 'reconcile', label: 'Reconciliation', to: '/reconciliation', icon: 'reconcile', roles: ['superadmin'], badge: 'reconcile' },
      { id: 'health', label: 'Health', to: '/health', icon: 'shield', roles: ['superadmin'] },
    ],
  },
];
