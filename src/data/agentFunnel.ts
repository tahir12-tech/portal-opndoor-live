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

export async function getAgentRailFunnel(slug?: string): Promise<AgentRailFunnel | null> {
  if (!SUPABASE_ENABLED) return null;
  const { data, error } = await sb().rpc('agent_rail_funnel', slug ? { p_slug: slug } : {});
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as AgentRailFunnel | null;
}
