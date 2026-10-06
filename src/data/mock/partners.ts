/* =====================================================================
   Seed partner list (ported from portal-partners.js).
   Northwind Property is the primary, fully-populated partner; Harbourside Homes and
   Meridian Lettings carry lighter data to show the multi-partner structure.

   Commission is a two-part, per-partner model. partnerRate and agentRate
   are fractions of the guarantor fee (one month's rent) and live on each
   partner record — they are NOT global constants.
   ===================================================================== */
import type { Partner } from '../types';

export const DEFAULT_PARTNER_RATE = 0.25;
export const DEFAULT_AGENT_RATE = 0.1;

/** The signed-in partner user's own partner (Management + Referrer are Northwind Property staff here). */
export const HOME_PARTNER = 'northwind';

export const PARTNERS_SEED: Partner[] = [
  // THE ESTATE. Northwind stands for the Opndoor agency estate: an org tree,
  // negotiated agreements, joint tenancies. One of its agencies (Foxglove) also
  // references its own tenants, which is a DIFFERENT question and is set on the
  // agency, not here. Harbourside and Meridian have no mode: they introduce
  // referrals one tenant at a time, the way a supplier does.
  //
  // AND SINCE 2026-10-02 EACH SAYS WHICH IT IS. `kind` is the fact the portal
  // reads for supplier-vs-agency; the mode above is only the journey.
  // Harbourside and Meridian were suppliers by the ABSENCE of a mode, which is
  // exactly the inference that had to go.
  { id: 'northwind', name: 'Northwind Property', weight: 1.0, primary: true, status: 'active', users: 11, apps: 342, since: '2024-09', partnerRate: 0.25, agentRate: 0.1, referencingMode: 'opndoor_referenced', kind: 'agency' },
  { id: 'harbourside', name: 'Harbourside Homes', weight: 0.34, status: 'active', users: 4, apps: 54, since: '2025-11', partnerRate: 0.25, agentRate: 0.1, kind: 'supplier' },
  { id: 'meridian', name: 'Meridian Lettings', weight: 0.16, status: 'active', users: 3, apps: 26, since: '2026-02', partnerRate: 0.25, agentRate: 0.1, kind: 'supplier' },
];
