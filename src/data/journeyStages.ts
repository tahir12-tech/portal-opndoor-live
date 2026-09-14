/* =====================================================================
   Agent-rail journey stages (referencing_mode = 'opndoor_referenced').

   The application-detail timeline shows nine stages for an agent-rail application
   instead of the supplier rail's three. This turns the progress markers from the
   application_journey RPC into the timeline's steps + a `reached` index, reusing
   the same StatusTimeline component.

   PROGRESS ONLY, never content: every field here is a timestamp or a done/not-done
   fact (or which form step the tenant is on). No answer, document or figure.
   ===================================================================== */
import { SUPABASE_ENABLED, sb } from '@/lib/supabase';

/** The raw markers from public.application_journey (one row per application). */
export interface ApplicationJourney {
  referencing_mode: string;
  status: string;
  invited_at: string | null;
  registered_at: string | null;
  property_done: boolean;
  about_done: boolean;
  fee_paid_at: string | null;
  id_done: boolean;
  financials_done: boolean;
  submitted_at: string | null;
  decided_at: string | null;
  decision: 'approved' | 'declined' | null;
  decline_reason: string | null;
  guarantee_paid_at: string | null;
  deed_at: string | null;
  deed_state: string | null;
  current_step: string | null;
}

/** The journey for one agent-rail application, or null (mock mode / not found /
    not permitted). Read by the detail page for the nine-stage timeline. */
export async function getApplicationJourney(ref: string): Promise<ApplicationJourney | null> {
  if (!SUPABASE_ENABLED) return null;
  const { data, error } = await sb().rpc('application_journey', { p_ref: ref });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as ApplicationJourney | null;
}

const STEP_LABEL: Record<string, string> = {
  property: 'Property',
  about: 'About you',
  fee: 'Application fee',
  address: 'Address history',
  income: 'Income',
  nationality: 'Nationality and right to rent',
  declaration: 'Declaration',
};

export interface JourneyView {
  steps: { label: string; date: string; note: string }[];
  reached: number;
  terminated: boolean;
  currentInProgress: boolean;
}

/** The nine stages group into three named bands for the phased timeline:
    Onboarding (1-3), Application (4-6), Outcome (7-9). */
export const AGENT_JOURNEY_BANDS: { label: string; count: number }[] = [
  { label: 'Onboarding', count: 3 },
  { label: 'Application', count: 3 },
  { label: 'Outcome', count: 3 },
];

/**
 * Build the nine-stage timeline from the journey markers. `fmt` turns an ISO
 * timestamp (or null) into a display string. Stages with no timestamp (Details,
 * Documents) carry their progress in the note instead. A declined application is
 * a termination at the Decision stage; every other state has a current stage that
 * stays un-ticked until it truly completes (the deed is issued).
 */
export function buildAgentJourney(
  j: ApplicationJourney,
  fmt: (iso: string | null) => string,
  fees?: { guarantee?: string },
): JourneyView {
  const declined = j.status === 'declined';

  // The current stage within a draft (1..6), read from the markers in order.
  const draftReached = (): number => {
    if (!j.registered_at) return 2;                    // invited, not yet registered
    if (!(j.property_done && j.about_done)) return 3;  // registered, details incomplete
    if (!j.fee_paid_at) return 4;                      // details done, application fee unpaid
    if (!(j.id_done && j.financials_done)) return 5;   // fee paid, documents incomplete
    return 6;                                          // documents done, not yet submitted
  };

  let reached: number;
  let terminated = false;
  if (declined) { reached = 6; terminated = true; }    // 1-6 done, stage 7 terminates (declined)
  else if (j.status === 'draft') reached = draftReached();
  else if (j.status === 'referencing') reached = 7;    // submitted, awaiting the decision
  else if (j.status === 'sent') reached = 8;           // approved, guarantee fee is current
  else reached = 9;                                    // paid (deed current) or deed (issued)
  // Every non-final current stage is in progress, so it does not tick until it
  // truly completes; only an issued deed (status 'deed') ticks the final stage.
  const currentInProgress = !terminated && j.status !== 'deed';

  const stepPhrase = j.current_step ? ` On the ${STEP_LABEL[j.current_step] ?? j.current_step} step.` : '';
  const detailsNote = j.status === 'draft' && reached === 3
    ? `${j.property_done ? 'Property added' : 'Property outstanding'}, ${j.about_done ? 'about-you done' : 'about-you outstanding'}.${stepPhrase}`
    : 'Property and about-you completed';
  const docsNote = j.status === 'draft' && reached === 5
    ? `${j.financials_done ? 'Financials in' : 'Financials outstanding'}, ${j.id_done ? 'ID in' : 'ID outstanding'}.`
    : 'ID check and financials completed';
  const decisionNote = j.decision === 'approved'
    ? 'Approved'
    : j.decision === 'declined'
      ? `Declined${j.decline_reason ? ': ' + j.decline_reason : ''}`
      : 'Awaiting the eligibility decision';
  const deedNote = j.status === 'deed'
    ? 'Signed by the tenant and issued'
    : j.deed_state === 'awaiting_tenant'
      ? "Awaiting the tenant's signature"
      : 'Deed not yet issued';
  // The stage label follows the state: it only reads "signed and issued" once the
  // deed is executed. While it is out for signature the label says so, so it can
  // never claim the deed is done over a note that says it is still awaiting.
  const deedLabel = j.status === 'deed'
    ? 'Deed signed and issued'
    : j.deed_state === 'awaiting_tenant'
      ? 'Deed awaiting tenant'
      : 'Deed signed and issued';

  // The application fee stage carries no note: its paid date on the row says it
  // all, and the amount (a fixed price) was noise. The guarantee fee keeps its
  // amount — one month's rent, already on this page — since that figure varies.
  const guarFeeNote = fees?.guarantee ? `${fees.guarantee} · one month's rent` : "One month's rent";

  const steps = [
    { label: 'Invited', date: fmt(j.invited_at), note: 'Invite link sent to the tenant' },
    { label: 'Registered', date: fmt(j.registered_at), note: 'Tenant claimed the invite and created an account' },
    { label: 'Details', date: '', note: detailsNote },
    { label: 'Application fee paid', date: fmt(j.fee_paid_at), note: '' },
    { label: 'Documents', date: '', note: docsNote },
    { label: 'Submitted', date: fmt(j.submitted_at), note: 'Sent for the eligibility check' },
    { label: 'Decision', date: fmt(j.decided_at), note: decisionNote },
    { label: 'Guarantee fee paid', date: fmt(j.guarantee_paid_at), note: guarFeeNote },
    { label: deedLabel, date: fmt(j.deed_at), note: deedNote },
  ];
  return { steps, reached, terminated, currentInProgress };
}
