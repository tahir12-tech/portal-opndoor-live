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
  /** What to do, naming the thing: a secret, a function, an application.
      Null where there is nothing to do, which is a real answer and not an
      omission: 'ok' lines explain an absence rather than ask for work. */
  action: string | null;
  /** How loudly to show it. 'error' is broken; 'warn' is working but wrong;
      'ok' is working and explains why a column is empty, which a reader
      scanning for faults would otherwise stop on. Added 2026-10-03 for the
      two jobs that make no call and for a response the database has already
      deleted. */
  tone: 'error' | 'warn' | 'ok';
}

/** The fields of a cron row this reads. Structural, so a test needs no fixture
    of the whole snapshot. */
export interface JobLike {
  jobname: string;
  active: boolean;
  /** Switched off for this environment on purpose. */
  disabled_here?: boolean;
  last_status: string | null;
  last_run: string | null;
  http_status_code: number | null;
  http_ok: boolean | null;
  /** True when the job's command is gated on ops_functions_base_url(). */
  needs_base_url?: boolean;
  /** True when the job's command actually calls something
      (`net.http_post`). False for a job that is a bare DELETE and will
      never have an HTTP response to match. Read off the command by
      cron_health, not from a list of names. */
  makes_call?: boolean;
}

/**
 * What is wrong with this cron, if anything.
 *
 * The order matters: the base-URL case is checked before the silent-success
 * case, because it IS a silent success and naming it "no HTTP response could
 * be correlated" would send the operator looking for a timing problem when the
 * answer is an unset secret.
 */
export function jobAdvice(
  job: JobLike,
  baseUrlSet: boolean,
  /* How long `net._http_response` keeps a row, from `pg_net.ttl`. Null when
     the caller does not know, and then the age test is skipped rather than
     guessed: a wrong number here would silence a real missing response. */
  ttlHours?: number | null,
): Advice | null {
  // A paused job is a decision somebody took, not a fault.
  if (!job.active) return null;

  /* OFF ON PURPOSE IS NOT BROKEN. An environment with no HubSpot says so
     explicitly, and its sync then fails every two minutes for a reason nobody
     intends to fix. Reporting that as an error teaches the operator to skip
     the line, which is exactly the habit that hides a real one. */
  if (job.disabled_here) {
    return {
      tone: 'warn',
      meaning: `${job.jobname} is switched off for this environment, so its failures are expected.`,
      action: 'Nothing to do here. On production this is on, and a failure there is real.',
    };
  }

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

  /* A JOB THAT CALLS NOTHING CANNOT HAVE A RESPONSE. Matt, 2026-10-03:
     "For jobs that run purely inside the database and make no call
     (job-log-trim-nightly, and any others), show 'Runs in the database;
     no call expected' instead of the 'no HTTP response could be matched'
     warning."

     NOT A WARNING, AND NOT NOTHING. A line saying so is worth keeping:
     the absence of a response is the ordinary state here, and a reader
     scanning the column needs to know that rather than wonder. */
  if (job.makes_call === false) {
    return {
      tone: 'ok',
      meaning: `${job.jobname} runs in the database; no call expected.`,
      action: null,
    };
  }

  /* RAN, BUT NOTHING CAME BACK. Only worth saying for a job that HAS run:
     correlation is by time and can genuinely miss, so this is a warning about
     what we know rather than an assertion that the call failed.

     AND NOT WHEN THE RESPONSE IS SIMPLY TOO OLD TO EXIST. `pg_net` keeps
     `net._http_response` for `pg_net.ttl`, six hours on this project, so a
     WEEKLY job's response is always gone before anybody looks -- which is
     why `weekly-digest-0700/0800` showed "no match" for 28 Sep and why no
     amount of correlating could ever have found one. It had in fact run,
     succeeded and sent: `partner_digest_sends` holds the row. Warning
     about a response the database deleted on purpose is the same fault as
     warning about a job that was never going to call. */
  if (job.last_run && job.last_status === 'succeeded' && job.http_ok === null) {
    const ageHours = (Date.now() - new Date(job.last_run).getTime()) / 3_600_000;
    if (ttlHours != null && ageHours > ttlHours) {
      return {
        tone: 'ok',
        meaning: `${job.jobname} last ran ${Math.round(ageHours / 24) >= 1
          ? `${Math.round(ageHours / 24)} days ago`
          : `${Math.round(ageHours)} hours ago`}, and responses are only kept for ${ttlHours} hours, so there is nothing left to match.`,
        action: null,
      };
    }
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
  /** The job this came from is switched off for this environment on purpose. */
  disabledHere?: boolean;
}

/** What a failing response means. Null for a 2xx: there is nothing to do. */
export function responseAdvice(r: ResponseLike): Advice | null {
  if (r.ok) return null;
  const who = r.job ?? 'A scheduled call';

  // Off on purpose: the failure is the expected shape of "there is nothing to
  // sync to here", and saying what to do about it would be saying nothing.
  if (r.disabledHere) {
    return {
      tone: 'warn',
      meaning: `${who} is switched off for this environment, so this failure is expected.`,
      action: 'Nothing to do here. On production this is on.',
    };
  }

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
