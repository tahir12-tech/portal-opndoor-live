/* =====================================================================
   Role identities (ported from portal.js ROLES).
   In the prototype these are the demo users shown in the sidebar footer and
   role switcher. In production the signed-in user comes from the session.
   ===================================================================== */
import type { Role } from '@/data';

export interface RoleIdentity {
  name: string;
  label: string;
  initials: string;
}

export const ROLES: Record<Role, RoleIdentity> = {
  superadmin: { name: 'Maya Holloway', label: 'opndoor admin', initials: 'MH' },
  management: { name: 'Tom Sefton', label: 'Management', initials: 'TS' },
  referrer: { name: 'Priya Nair', label: 'Referrer', initials: 'PN' },
  developer: { name: 'Dev Integrator', label: 'Developer', initials: 'DI' },
};

/** The order + short labels used by the demo role switcher. */
export const ROLE_SWITCH: { id: Role; label: string }[] = [
  { id: 'superadmin', label: 'opndoor admin' },
  { id: 'management', label: 'Management' },
  { id: 'referrer', label: 'Referrer' },
  { id: 'developer', label: 'Developer' },
];
