/* =====================================================================
   Agent-rail dashboard funnel (referencing_mode = 'opndoor_referenced').

   The nine-stage counts (Invited to Deed) plus the early "stuck" counts for one
   partner, from the agent_rail_funnel RPC. Progress only: counts of applications
   at each stage, never any content. Management calls it for their own partner
   (no arg); a superadmin passes the partner slug they are viewing.
   ===================================================================== */
import { SUPABASE_ENABLED, sb } from '@/lib/supabase';

export interface AgentRailFunnel {
  invited: number;
  registered: number;
  details: number;
  fee: number;
  documents: number;
  submitted: number;
  approved: number;
  declined: number;
  guarantee: number;
  deed: number;
  stuck_invited: number;
  stuck_fee: number;
  stuck_referencing: number;
}

/**
 * Does anything this viewer can see run the nine-stage eligibility journey?
 *
 * The dashboard used to ask the PARTNER, which is the estate question, not the
 * journey one. Regent's partner is opndoor-agents, so it answered yes, and their
 * manager would have met nine stages with seven of them permanently zero and no
 * way to tell "not yet" from "never". Their tenants are pre-referenced: their
 * journey is Sent, Paid, Deed.
 *
 * Resolved server-side, scoped like everything else, and keyed on the agency's
 * own referencing route falling back to its partner's — the same precedence a
 * referral follows.
 */
export async function viewerRunsEligibilityJourney(slug?: string): Promise<boolean> {
  if (!SUPABASE_ENABLED) return false;
  const { data, error } = await sb().rpc('viewer_runs_eligibility_journey',
    slug ? { p_partner_slug: slug } : {});
  if (error) return false;
  return data === true;
}

export async function getAgentRailFunnel(slug?: string): Promise<AgentRailFunnel | null> {
  if (!SUPABASE_ENABLED) return null;
  const { data, error } = await sb().rpc('agent_rail_funnel', slug ? { p_slug: slug } : {});
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as AgentRailFunnel | null;
}
