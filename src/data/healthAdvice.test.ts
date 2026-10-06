/* WHAT A FAILING ROW MEANS, AND WHAT TO DO ABOUT IT.

   Health listed machinery. A row said "succeeded" next to "401" and the
   reader had to already know that a 401 from a cron is the Authorization
   header rather than a tenant problem; a green row with no HTTP response at
   all looked like the healthiest row on the page and was the worst.

   Two rules are asserted hardest here, because both are states that LOOK
   fine:

     the base-URL no-op   the job reports success having made no call
     the silent 401       the run says succeeded, the function refused

   and one rule about restraint: a row with nothing to act on is not an error.
   Painting a working system red teaches an operator to ignore red. */
import { describe, expect, it } from 'vitest';
import { jobAdvice, refInResponse, responseAdvice, type JobLike, type ResponseLike } from './healthAdvice';

function job(o: Partial<JobLike> = {}): JobLike {
  return {
    jobname: 'deed-sweep-hourly', active: true, last_status: 'succeeded',
    last_run: '2026-09-28T13:20:00Z', http_status_code: 200, http_ok: true,
    needs_base_url: false, ...o,
  };
}
function response(o: Partial<ResponseLike> = {}): ResponseLike {
  return { status_code: 200, ok: true, timed_out: false, content: null, error_msg: null, job: 'hubspot-sync', ...o };
}

describe('nothing to act on is not an error', () => {
  it('says nothing about a job that ran and was answered', () => {
    expect(jobAdvice(job(), true)).toBeNull();
  });

  /* A paused job is a decision somebody took. It was showing as a fault, so
     the page had a permanent red row that meant "working as intended". */
  it('says nothing about a paused job', () => {
    expect(jobAdvice(job({ active: false, last_status: 'failed' }), true)).toBeNull();
  });

  it('says nothing about a job that has simply not run yet', () => {
    expect(jobAdvice(job({ last_status: null, last_run: null, http_status_code: null, http_ok: null }), true)).toBeNull();
  });

  it('says nothing about a 2xx response', () => {
    expect(responseAdvice(response())).toBeNull();
  });
});

describe('the base-URL no-op, which reports success', () => {
  const gated = job({ needs_base_url: true, http_status_code: null, http_ok: null });

  it('names the secret and says the call was never made', () => {
    const a = jobAdvice(gated, false)!;
    expect(a.tone).toBe('error');
    expect(a.meaning).toContain('without making any call');
    expect(a.action).toContain('ops_secrets.functions_base_url');
  });

  /* IT IS CHECKED FIRST, deliberately. This state is also "ran, nothing came
     back", and that wording sends the operator looking for a timing problem
     when the answer is an unset secret. */
  it('beats the no-response reading, which describes the same row wrongly', () => {
    const a = jobAdvice(gated, false)!;
    expect(a.meaning).not.toContain('five-minute');
  });

  it('goes quiet once the secret is set and the job is answered', () => {
    expect(jobAdvice(job({ needs_base_url: true }), true)).toBeNull();
  });
});

describe('the silent 401, which is why this page exists', () => {
  it('explains why a refused call still reads as succeeded', () => {
    const a = jobAdvice(job({ last_status: 'succeeded', http_status_code: 401, http_ok: false }), true)!;
    expect(a.tone).toBe('error');
    expect(a.meaning).toContain('401');
    expect(a.meaning).toContain('queueing the call');
    expect(a.action).toContain('Authorization');
  });

  it('sends a 404 to the deployment rather than to the key', () => {
    const a = jobAdvice(job({ http_status_code: 404, http_ok: false }), true)!;
    expect(a.action).toContain('deployed');
    expect(a.action).not.toContain('Authorization');
  });

  it('names the function to open for any other status', () => {
    const a = jobAdvice(job({ jobname: 'hubspot-sync', http_status_code: 500, http_ok: false }), true)!;
    expect(a.action).toContain('hubspot-sync');
  });
});

describe('a job that failed at the database end', () => {
  it('says no call was attempted, and where the SQL is', () => {
    const a = jobAdvice(job({ last_status: 'failed', http_status_code: null, http_ok: null }), true)!;
    expect(a.meaning).toContain('no call was attempted');
    expect(a.action).toContain('cron.job');
  });
});

describe('a job that ran with nothing correlated', () => {
  /* A WARNING, NOT AN ERROR. Correlation is by time and can genuinely miss,
     so this says what is not known rather than asserting a failure. */
  it('is a warning, and says the matching is by a window', () => {
    const a = jobAdvice(job({ http_status_code: null, http_ok: null }), true)!;
    expect(a.tone).toBe('warn');
    expect(a.meaning).toContain('five-minute');
  });
});

describe('reading a response body', () => {
  /* THE REAL ONE, observed on dev: 63 of hubspot-sync's 205 calls in a day.
     Matching the body rather than the status is what lets the page name the
     secret instead of saying "500". */
  it('names the missing secret rather than the status code', () => {
    const a = responseAdvice(response({
      status_code: 500, ok: false, content: '{"ok":false,"error":"No HubSpot access token configured."}',
    }))!;
    expect(a.meaning).toContain('HubSpot');
    expect(a.action).toContain('HUBSPOT_ACCESS_TOKEN');
  });

  it('sends the missing partner map to the application, not to a secret', () => {
    const a = responseAdvice(response({
      status_code: 500, ok: false,
      content: 'hubspot-sync referral_created GR-20675: no partner map for partner_id 1f305284',
    }))!;
    expect(a.meaning).toContain('no CRM mapping');
    expect(a.action).toContain('Open the application');
  });

  /* AND THE ROW LINKS TO IT. A reference in the body is the one thing on this
     page that can be opened. */
  it('finds the application reference a body names', () => {
    expect(refInResponse({ content: 'hubspot-sync referral_created GR-20675: no partner map' })).toBe('GR-20675');
    expect(refInResponse({ content: '{"ok":false}' })).toBeNull();
    expect(refInResponse({ content: null })).toBeNull();
  });

  it('warns that a timeout leaves the outcome unknown, so it is not re-run blind', () => {
    const a = responseAdvice(response({
      status_code: null, ok: false, timed_out: true,
      error_msg: 'Timeout of 5000 ms reached.',
    }))!;
    expect(a.meaning).toContain('did not answer in time');
    expect(a.action).toContain('before re-running');
  });

  it('names the job on every reading, since a status alone says whose problem it is not', () => {
    const a = responseAdvice(response({ status_code: 503, ok: false, job: 'partner-webhooks' }))!;
    expect(a.meaning).toContain('partner-webhooks');
  });

  it('copes with a response nothing could be attributed to', () => {
    const a = responseAdvice(response({ status_code: 500, ok: false, job: null }))!;
    expect(a.meaning).toContain('A scheduled call');
  });
});

/* OFF ON PURPOSE IS NOT BROKEN.

   hubspot-sync answers 500 every two minutes on an environment with no
   HubSpot, which on dev is 68 failures in 211 calls a day for a state nobody
   intends to fix. An alert that fires for a deliberate condition is worse than
   none: it teaches the operator to skip that line, which is the habit that
   hides the real one.

   The environment says so explicitly (ops_secrets 'hubspot_disabled'). Nothing
   is inferred from the project ref or the hostname, so PRODUCTION, which has
   no such row, still alerts on a missing token exactly as before. Both
   directions are asserted, because only having the first is how a disabled
   flag quietly disables production too. */
describe('an environment with HubSpot deliberately off', () => {
  const hubspot = (o: Partial<JobLike> = {}): JobLike => job({
    jobname: 'hubspot-sync', last_status: 'succeeded',
    http_status_code: 500, http_ok: false, ...o,
  });

  it('reads as switched off rather than as failing', () => {
    const a = jobAdvice(hubspot({ disabled_here: true }), true)!;
    expect(a.tone).toBe('warn');
    expect(a.meaning).toContain('switched off for this environment');
    expect(a.action).toContain('Nothing to do here');
  });

  it('and its responses say the same, instead of naming a missing secret', () => {
    const a = responseAdvice(response({
      status_code: 500, ok: false, job: 'hubspot-sync', disabledHere: true,
      content: '{"ok":false,"error":"No HubSpot access token configured."}',
    }))!;
    expect(a.tone).toBe('warn');
    expect(a.meaning).toContain('switched off');
    expect(a.action).not.toContain('HUBSPOT_ACCESS_TOKEN');
  });

  /* THE OTHER DIRECTION, which is the one that matters on Monday. */
  it('still alerts on production, where the flag is absent', () => {
    const a = jobAdvice(hubspot(), true)!;
    expect(a.tone).toBe('error');
    expect(a.meaning).toContain('500');
  });

  it('and still names the missing secret there', () => {
    const a = responseAdvice(response({
      status_code: 500, ok: false, job: 'hubspot-sync',
      content: '{"ok":false,"error":"No HubSpot access token configured."}',
    }))!;
    expect(a.tone).toBe('error');
    expect(a.action).toContain('HUBSPOT_ACCESS_TOKEN');
  });

  /* AND IT IS NOT A BLANKET MUTE. A job that is off must not silence the ones
     beside it, which is the failure mode of a flag read too broadly. */
  it('does not quieten any other job', () => {
    const a = jobAdvice(job({ jobname: 'deed-sweep-hourly', http_status_code: 500, http_ok: false }), true)!;
    expect(a.tone).toBe('error');
  });
});
