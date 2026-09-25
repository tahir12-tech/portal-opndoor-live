/* =====================================================================
   RequireRole — route guard for opndoor-admin-only screens (Partners,
   Reconciliation, the opndoor team view). Non-admin roles are redirected
   to the dashboard. Nav items for these screens are already hidden by role;
   this stops direct-URL access too.

   NOTE: the prototype only hid the nav and relied on the back end to
   enforce access. This guard is the front-end half of that enforcement;
   the back end must still check every request.
   ===================================================================== */
import { Navigate, Outlet } from 'react-router-dom';
import type { Role } from '@/data';
import { NAV_CAPABILITY, type NavCapability } from '@/constants/nav';
import { useSession } from '@/session/SessionContext';

export function RequireRole({ roles, redirectTo = '/dashboard' }: { roles: Role[]; redirectTo?: string }) {
  const { role } = useSession();
  if (!roles.includes(role)) return <Navigate to={redirectTo} replace />;
  return <Outlet />;
}

/**
 * The lock for a nav item hidden by a capability.
 *
 * Reads the SAME predicate the sidebar reads, from NAV_CAPABILITY, so the two
 * cannot answer differently. A capability-hidden item whose route still renders
 * is not a hidden screen, it is an unlisted one, and the Dev Centre's history
 * (see constants/nav.ts) is a record of that distinction being got wrong.
 *
 * Role first, then the capability, because a role failure is the blunter answer
 * and the redirect target differs: a role that is not allowed anywhere near a
 * screen goes to /help, a party that has simply not been set up for one goes
 * back to its own book.
 */
export function RequireCapability(
  { roles, capability, redirectTo = '/dashboard' }:
  { roles: Role[]; capability: NavCapability; redirectTo?: string },
) {
  const { role, partnerScope } = useSession();
  if (!roles.includes(role)) return <Navigate to={redirectTo} replace />;
  if (!NAV_CAPABILITY[capability](role, partnerScope)) return <Navigate to={redirectTo} replace />;
  return <Outlet />;
}
