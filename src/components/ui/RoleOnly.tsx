/* =====================================================================
   RoleOnly — replaces the prototype's data-role-only attribute.
   Renders its children only when the active role is in `roles`.
   (Role gating here is UI-side; the back end must enforce access too.)

   AND, FOR A COMMISSION SURFACE, WHETHER THIS READER MAY SEE A FIGURE.

   THE DEFECT THIS CLOSES. An agency has three levels, and Director and Manager
   are both role 'management': same screens, same reach, same team, and the only
   difference between them is whether they are shown what the agency earns. Every
   gate on this file said `roles={['superadmin', 'management']}`, which a Manager
   satisfies, so a Manager was shown every commission figure on the client. The
   database was right the whole time (may_see_commission, and the four rate routes
   gated in 20261005170000 return nothing for them) but the SCREEN read those
   figures out of analytics the server was happy to serve, so the level meant
   nothing to the person actually using it.

   WHY A FLAG AND NOT AUTOMATIC. This component cannot tell whether what it wraps
   is a commission figure or a volume chart, and guessing in either direction is
   wrong: gate everything and a Manager loses the referrals and the team they are
   supposed to see, gate nothing and we are back here. So the surface declares
   itself, once, at the point where somebody can see what is inside it:

     <RoleOnly roles={['superadmin', 'management']} commission>

   WHAT COUNTS AS A COMMISSION SURFACE: anything stating what the agency earns or
   is owed, at any grain. Settlements, payout splits, statements, rates, effective
   percentages. NOT the fee a tenant was charged, which is the price of the
   product and a fact about the referral a Manager owns; not volumes, conversion
   or expiries. The test that decides it: would this number let somebody work out
   the agency's income? If yes it is a commission surface.
   ===================================================================== */
import type { ReactNode } from 'react';
import { maySeeCommission, type Role } from '@/data';
import { useSession } from '@/session/SessionContext';

export function RoleOnly({
  roles, commission = false, children,
}: {
  roles: Role[];
  /** This surface states what the agency earns. A Manager is refused it even
      though their role is on the allowlist. See the note above. */
  commission?: boolean;
  children: ReactNode;
}) {
  const { role } = useSession();
  if (!roles.includes(role)) return null;
  if (commission && !maySeeCommission(role)) return null;
  return <>{children}</>;
}
