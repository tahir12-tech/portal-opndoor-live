/* =====================================================================
   Health service (opndoor admin only). #7.
   A single read of the cron_health() RPC: cron liveness plus the REAL HTTP
   outcome of each cron call. The point is the silent-401 class: a cron whose
   job_run_details says "succeeded" while the edge function actually answered
   401. That HTTP status lives in net._http_response (a non-public schema), so
   only the SECURITY DEFINER, admin-gated RPC can read it.

   Returns null in mock/test mode (no back end) so the page renders a friendly
   placeholder and the render smoke test stays meaningful.
   ===================================================================== */
import { SUPABASE_ENABLED, sb } from '@/lib/supabase';

/** One cron job: schedule, its latest run, and a best-effort HTTP outcome. */
export interface CronJobHealth {
  jobname: string;
  schedule: string;
  active: boolean;
  /** cron.job_run_details.status. WARNING: "succeeded" even on a silent 401. */
  last_status: string | null;
  last_return_message: string | null;
  /** ISO timestamp of the last run start, or null if it has never run. */
  last_run: string | null;
  last_end: string | null;
  /** Best-effort correlated net._http_response status (by time). null if none. */
  http_status_code: number | null;
  http_created: string | null;
  /** true = 2xx, false = non-2xx, null = no correlated response. */
  http_ok: boolean | null;
  /** True when this job's command is gated on ops_functions_base_url(). Read
      off the command text by the RPC, so a job that gains or loses the guard
      describes itself correctly without anything here being edited. */
  needs_base_url: boolean;
  /** True when this job is switched off for this environment on purpose. A
      job that is off by choice is not a job that is failing. */
  disabled_here: boolean;
}

/** A recent net._http_response row: the authoritative HTTP signal. */
export interface RecentHttp {
  id: number;
  status_code: number | null;
  ok: boolean;
  created: string;
  content: string | null;
  error_msg: string | null;
  timed_out: boolean;
  /** The job this response is attributed to, or null when none could be.
      CORRELATED, NOT KNOWN: pg_net deletes the request row (and its URL) when
      the response lands, so the RPC matches a response to the job whose run
      started most recently before it, within five minutes. Two jobs firing in
      the same minute are ambiguous; null means no run window contained it. */
  job: string | null;
}

/** One job's HTTP traffic over the window, so a chatty job does not drown the
    rest of the list. */
export interface HttpByJob {
  job: string | null;
  total: number;
  errors: number;
  /** Switched off for this environment on purpose. */
  disabled_here?: boolean;
  latest: RecentHttp | null;
}

/** 24h failure/volume counts drawn from signals the system already records. */
export interface HealthCounts {
  window_hours: number;
  email_sends: number;
  email_failures: number;
  webhook_failures: number;
  deed_failures: number;
  anomalies: number;
  /** Non-2xx (or errored) HTTP responses in the window: the silent-401 tally. */
  http_errors: number;
}

export interface CronHealth {
  generated_at: string;
  /** true when the single most recent HTTP response was not a 2xx. */
  http_alert: boolean;
  /** The secret four crons are gated on. Null means those jobs report
      "succeeded" having made no call at all, which is the single most
      misleading state this page can be in. */
  functions_base_url: string | null;
  /** HubSpot is deliberately off on this environment (an explicit
      ops_secrets row, never inferred). Its failures are expected and are
      reported as "disabled" rather than alerted on. */
  hubspot_disabled: boolean;
  jobs: CronJobHealth[];
  /** Errors first, then newest: what the page exists for, at the top. */
  recent_http: RecentHttp[];
  http_by_job: HttpByJob[];
  counts: HealthCounts;
}

/**
 * Read the operational health snapshot. Returns null in mock/test mode
 * (no back end); otherwise calls the admin-gated cron_health() RPC. The RPC
 * self-gates to an AAL2 admin, so a non-admin caller gets a thrown error.
 */
export async function getCronHealth(): Promise<CronHealth | null> {
  if (!SUPABASE_ENABLED) return null;
  const { data, error } = await sb().rpc('cron_health');
  if (error) throw new Error(error.message);
  return (data ?? null) as CronHealth | null;
}
