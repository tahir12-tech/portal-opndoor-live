/* HEALTH SAYS WHY A COLUMN IS EMPTY, RATHER THAN WARNING ABOUT IT.
 *
 * Matt, 2026-10-03:
 *   1. "weekly-digest-0700/0800 show 'no match' for 28 Sep. Tell me whether
 *       the weekly digest actually sent on 28 Sep, to whom, and whether it
 *       makes an HTTP call at all."
 *   2. "For jobs that run purely inside the database and make no call
 *       (job-log-trim-nightly, and any others), show 'Runs in the database;
 *       no call expected' instead of the 'no HTTP response could be matched'
 *       warning. Keep the warning only for jobs that are meant to make a
 *       call."
 *
 * THE ANSWER TO 1, MEASURED ON DEV: it ran, it called, and it sent. Both
 * cron jobs succeeded on 28 Sep (07:00 and 08:00 UTC), the function
 * self-gates to 08:00 Europe/London so the second no-opped, and
 * `partner_digest_sends` holds exactly one row for 28 Sep 07:00 UTC. No
 * `cron_error:weekly-digest` alert has ever been raised.
 *
 * AND WHY THERE WAS NO MATCHED RESPONSE: `pg_net` keeps
 * `net._http_response` for `pg_net.ttl`, which is SIX HOURS here -- the
 * oldest row in that table is six hours old, always. A WEEKLY job's response
 * is therefore gone long before anybody opens Health, and no amount of
 * correlating could ever find it. Nothing was broken; the page was warning
 * about a row the database deletes on purpose.
 *
 * SO THERE ARE TWO KINDS OF HONEST EMPTINESS, and this file is both.
 */
import { describe, expect, it } from 'vitest';
import { jobAdvice, type JobLike } from './healthAdvice';

const ranAt = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

const job = (over: Partial<JobLike> = {}): JobLike => ({
  jobname: 'some-job',
  active: true,
  last_status: 'succeeded',
  last_run: ranAt(1),
  http_status_code: null,
  http_ok: null,
  makes_call: true,
  ...over,
});

describe('a job that runs in the database and calls nothing', () => {
  /* job-log-trim-nightly and rate-limit-cleanup, the only two today. The RPC
     reads `net.http_post` out of the command rather than matching names, so a
     third is covered the day it is added. */
  it('says so, instead of warning about a response it was never going to have', () => {
    const a = jobAdvice(job({ jobname: 'job-log-trim-nightly', makes_call: false }), true, 6);
    expect(a?.meaning).toBe('job-log-trim-nightly runs in the database; no call expected.');
    expect(a?.tone).toBe('ok');
  });

  it('and has nothing to do, which is a real answer rather than a blank', () => {
    expect(jobAdvice(job({ makes_call: false }), true, 6)?.action).toBeNull();
  });
});

describe('a job whose response the database has already deleted', () => {
  /* THE WEEKLY DIGEST. Seven days old, responses kept six hours. */
  it('says the response expired, rather than warning', () => {
    const a = jobAdvice(job({ jobname: 'weekly-digest-0700', last_run: ranAt(24 * 7) }), true, 6);
    expect(a?.tone).toBe('ok');
    expect(a?.meaning).toContain('7 days ago');
    expect(a?.meaning).toContain('only kept for 6 hours');
  });

  /* AND THE WARNING SURVIVES FOR A JOB THAT SHOULD HAVE ONE. A daily job that
     ran an hour ago and has no response is a real question, and this change
     must not have silenced it. */
  it('while a recent run with no response is still a warning', () => {
    const a = jobAdvice(job({ jobname: 'payment-reminders-0700', last_run: ranAt(1) }), true, 6);
    expect(a?.tone).toBe('warn');
    expect(a?.meaning).toContain('no HTTP response could be matched');
  });

  /* NO TTL, NO GUESS. If the page cannot read `pg_net.ttl` the age test is
     skipped: a wrong number would silence a genuinely missing response, which
     is the failure this page exists to catch. */
  it('and with no retention known it warns rather than assuming', () => {
    const a = jobAdvice(job({ last_run: ranAt(24 * 7) }), true, null);
    expect(a?.tone).toBe('warn');
  });
});

describe('what must not have moved', () => {
  it('a failed job is still an error', () => {
    expect(jobAdvice(job({ last_status: 'failed' }), true)?.tone).toBe('error');
  });

  /* THE SILENT NO-OP, which is the single most misleading state this page can
     show and is checked before everything above. */
  it('and a job gated on a base URL that is not set is still an error', () => {
    const a = jobAdvice(job({ needs_base_url: true }), false);
    expect(a?.tone).toBe('error');
    expect(a?.meaning).toContain('without making any call');
  });

  it('and a paused job still says nothing at all', () => {
    expect(jobAdvice(job({ active: false, makes_call: false }), true)).toBeNull();
  });
});
