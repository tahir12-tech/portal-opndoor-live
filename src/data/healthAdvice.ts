/* =====================================================================
   WHAT THIS MEANS, AND WHAT TO DO ABOUT IT.

   Health listed machinery and left the reading of it to whoever was looking.
   A row said "succeeded" and "401", or "500", or nothing at all, and the
   operator had to already know that a 401 from a cron is the Authorization
   header, that a green run with no HTTP response is usually an unset secret,
   and that a webhook failure is an application to open rather than a service
   to restart.

   So every failing row now carries two sentences: what it means, and what to
   do about it, naming the secret, the function or the application.

   AND A ROW WITH NOTHING TO ACT ON IS NOT AN ERROR. A job that has never run
   because it is paused, and a response that came back 2xx, are facts about a
   working system. Showing them in red taught the operator to ignore red.

   PURE, so it can be asserted without a database. Everything here is a
   function of the row; nothing reads the clock or the network.
   ===================================================================== */

/** One row's diagnosis. Null from the helpers below means "nothing to act on",
    which is different from an empty string and is the whole point. */
export interface Advice {
  /** What the row means, in one line. */
  meaning: string;
  /** What to do, naming the thing: a secret, a function, an application. */
  action: string;
  /** How loudly to show it. 'error' is broken; 'warn' is working but wrong. */
  tone: 'error' | 'warn';
}

/** The fields of a cron row this reads. Structural, so a test needs no fixture
    of the whole snapshot. */
export interface JobLike {
  jobname: string;
  active: boolean;
  last_status: string | null;
  last_run: string | null;
  http_status_code: number | null;
  http_ok: boolean | null;
  /** True when the job's command is gated on ops_functions_base_url(). */
  needs_base_url?: boolean;
}

/**
 * What is wrong with this cron, if anything.
 *
 * The order matters: the base-URL case is checked before the silent-success
 * case, because it IS a silent success and naming it "no HTTP response could
 * be correlated" would send the operator looking for a timing problem when the
 * answer is an unset secret.
 */
export function jobAdvice(job: JobLike, baseUrlSet: boolean): Advice | null {
  // A paused job is a decision somebody took, not a fault.
  if (!job.active) return null;

  /* THE SILENT NO-OP. Four crons end their command with
     `where public.ops_functions_base_url() is not null`. With the secret
     unset the statement matches no rows, the job does nothing at all, and
     cron.job_run_details records SUCCEEDED. Nothing anywhere says the call
     was never made. */
  if (job.needs_base_url && !baseUrlSet) {
    return {
      tone: 'error',
      meaning: `${job.jobname} reports success without making any call: its command is gated on the functions base URL, which is not set.`,
      action: 'Set ops_secrets.functions_base_url to the project functions URL, then re-run this job and confirm an HTTP response appears against it.',
    };
  }

  if (job.last_status === 'failed') {
    return {
      tone: 'error',
      meaning: `${job.jobname} failed at the database end, so no call was attempted.`,
      action: `Read the run message on this row, then check the SQL in the job's command with select command from cron.job where jobname = '${job.jobname}'.`,
    };
  }

  /* THE SILENT 401 CLASS, which is why this page exists: the run says
     succeeded because the POST was queued, and the function answered 401. */
  if (job.last_status === 'succeeded' && job.http_ok === false) {
    const code = job.http_status_code;
    if (code === 401 || code === 403) {
      return {
        tone: 'error',
        meaning: `${job.jobname} ran and was refused: the function answered ${code}. The run says succeeded because queueing the call is all the database can see.`,
        action: `Check the Authorization header in this job's command against the service-role key, and confirm verify_jwt for the ${job.jobname} function.`,
      };
    }
    if (code === 404) {
      return {
        tone: 'error',
        meaning: `${job.jobname} called a URL that does not exist (404).`,
        action: 'Confirm the function is deployed under that name, and that ops_secrets.functions_base_url points at this project.',
      };
    }
    return {
      tone: 'error',
      meaning: `${job.jobname} ran and the function answered ${code ?? 'an error'}.`,
      action: `Open the ${job.jobname} function logs for that timestamp; the response body is listed under Recent responses below.`,
    };
  }

  /* RAN, BUT NOTHING CAME BACK. Only worth saying for a job that HAS run:
     correlation is by time and can genuinely miss, so this is a warning about
     what we know rather than an assertion that the call failed. */
  if (job.last_run && job.last_status === 'succeeded' && job.http_ok === null) {
    return {
      tone: 'warn',
      meaning: `${job.jobname} ran and no HTTP response could be matched to it. Either it made no call, or the response fell outside the five-minute window responses are matched in.`,
      action: 'Check Recent responses below for a response at that time; if there is none, the job made no call.',
    };
  }

  // Never run and active: a schedule that has not come round yet is not a
  // fault on a job that was only just registered.
  return null;
}

/** The fields of an HTTP response row this reads. */
export interface ResponseLike {
  status_code: number | null;
  ok: boolean;
  timed_out: boolean;
  content: string | null;
  error_msg: string | null;
  job: string | null;
}

/** What a failing response means. Null for a 2xx: there is nothing to do. */
export function responseAdvice(r: ResponseLike): Advice | null {
  if (r.ok) return null;
  const who = r.job ?? 'A scheduled call';

  if (r.timed_out || (r.status_code == null && r.error_msg)) {
    return {
      tone: 'error',
      meaning: `${who} did not answer in time, so the outcome is unknown: it may have completed after the timeout.`,
      action: `Open the ${r.job ?? 'function'} logs for that timestamp before re-running, so the work is not done twice.`,
    };
  }

  /* READ THE BODY. Edge functions answer with a JSON reason, and the reason is
     almost always a missing secret. Matching on the body rather than the code
     is what lets the page name the secret instead of saying "500". */
  const body = `${r.content ?? ''}`;
  const token = /No (\w+) access token configured/i.exec(body);
  if (token) {
    const service = token[1];
    return {
      tone: 'error',
      meaning: `${who} could not authenticate to ${service}: no access token is configured for it.`,
      action: `Set the ${service.toUpperCase()}_ACCESS_TOKEN secret on this project, then re-run the job.`,
    };
  }
  if (/no partner map/i.test(body)) {
    return {
      tone: 'error',
      meaning: `${who} reached an application whose partner has no CRM mapping, so its company was never attached.`,
      action: 'Open the application named in the response. The mapping is seeded by trigger; a gap means the partner predates it and the cursor needs winding back.',
    };
  }
  if (r.status_code === 401 || r.status_code === 403) {
    return {
      tone: 'error',
      meaning: `${who} was refused (${r.status_code}).`,
      action: 'Check the Authorization header in the job command against the service-role key.',
    };
  }
  if (r.status_code === 404) {
    return {
      tone: 'error',
      meaning: `${who} called a URL that does not exist (404).`,
      action: 'Confirm the function is deployed and that ops_secrets.functions_base_url points at this project.',
    };
  }
  return {
    tone: 'error',
    meaning: `${who} answered ${r.status_code ?? 'an error'}.`,
    action: `Open the ${r.job ?? 'function'} logs for that timestamp; the response body is shown on this row.`,
  };
}

/** The application reference a response body names, if it names one, so the
    row can link straight to it. */
export function refInResponse(r: { content: string | null }): string | null {
  const m = /\b(GR-\d{3,})\b/.exec(r.content ?? '');
  return m ? m[1] : null;
}
