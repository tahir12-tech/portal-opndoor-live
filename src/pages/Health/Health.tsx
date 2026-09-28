/* =====================================================================
   Health (opndoor admin only, enforced by the route guard) - #7.
   MACHINERY ONLY, for whoever operates the deployment. It answers: is every
   cron alive, did its call actually succeed, and what should I do about the
   ones that did not.

   IT USED TO CARRY THE HUMAN WORK QUEUE TOO ("Needs attention": applications
   stuck at sent, awaiting signature, pending reconciliation). That is a
   person's backlog, it lives on Home, and having it here invited whoever was
   holding the deployment to think the backlog was theirs.

   AND EVERY FAILING ROW NOW SAYS WHAT TO DO. A row said "succeeded" and
   "401", and the reader had to already know that a 401 from a cron is the
   Authorization header. The reading is in src/data/healthAdvice.ts, which is
   pure and asserted without a database.

   The headline concern is the silent-401 class: a cron whose run details say
   "succeeded" while the edge function actually answered 401. cron.job_run_details
   only reports that the `net.http_post(...)` was queued; the REAL HTTP status
   lives in net._http_response. The cron_health() RPC surfaces both, so a green
   "succeeded" sitting next to a red 401 is impossible to miss.

   Mock/test mode has no back end, so we show a friendly placeholder and the
   render smoke test stays meaningful.
   ===================================================================== */
import { useCallback, useEffect, useState } from 'react';
import { getCronHealth, type CronHealth, type RecentHttp } from '@/data';
import { jobAdvice, refInResponse, responseAdvice, type Advice } from '@/data/healthAdvice';
import { Link } from 'react-router-dom';
import { SUPABASE_ENABLED } from '@/lib/supabase';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Card, CardHead } from '@/components/ui/Card';
import { Pill, type PillVariant } from '@/components/ui/Pill';
import { useToast } from '@/components/ui/Toast';
import '@/components/ui/opbar.css';
import './Health.css';

/** dd/mm/yyyy HH:MM in local time; 'Never' when there is no timestamp. */
function fmtDateTime(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Never';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A short label for a run status, plus the pill colour to show it in. */
function runPill(status: string | null): { label: string; variant: PillVariant } {
  if (!status) return { label: 'Never run', variant: 'muted' };
  if (status === 'succeeded') return { label: 'Succeeded', variant: 'deed' };
  if (status === 'failed') return { label: 'Failed', variant: 'danger' };
  return { label: status, variant: 'warn' };
}

interface StatDef {
  label: string;
  value: number;
  /** Highlight in red when the value is non-zero (a failure metric). */
  bad?: boolean;
  /** Where the count goes when clicked. A tally of failures that cannot be
      opened is a number to worry about with nowhere to go. */
  href?: string;
}

/** The two sentences a failing row carries. Nothing is drawn when there is
    nothing to act on, which is the rule that stops a working system being
    painted red. */
function AdviceRow({ advice, ref: appRef }: { advice: Advice | null; ref?: string | null }) {
  if (!advice) return null;
  return (
    <div className={`hadvice hadvice--${advice.tone}`}>
      <div className="hadvice__means">{advice.meaning}</div>
      <div className="hadvice__do">
        {advice.action}
        {appRef && (
          <> <Link className="hadvice__link" to={`/applications/${encodeURIComponent(appRef)}`}>Open {appRef}</Link></>
        )}
      </div>
    </div>
  );
}

/** One HTTP response, with its reading under it. */
function ResponseRow({ r, disabledHere }: { r: RecentHttp; disabledHere?: boolean }) {
  return (
    <div className={`hresp${r.ok ? '' : ' hresp--bad'}`}>
      <div className="hresp__line">
        <span className={`hhttp${r.ok ? ' hhttp--ok' : ' hhttp--bad'}`}>
          {r.status_code != null ? r.status_code : r.timed_out ? 'timeout' : 'error'}
        </span>
        <span className="hresp__job">{r.job ?? 'unattributed'}</span>
        <span className="hresp__when">{fmtDateTime(r.created)}</span>
      </div>
      {(r.content || r.error_msg) && <div className="hsnippet">{r.content ?? r.error_msg}</div>}
      <AdviceRow advice={responseAdvice({ ...r, disabledHere })} ref={refInResponse(r)} />
    </div>
  );
}

function StatGrid({ stats }: { stats: StatDef[] }) {
  return (
    <div className="hstat">
      {stats.map((s) => {
        const cls = `hstat__card${s.bad && s.value > 0 ? ' hstat__card--bad' : ''}`;
        const body = <><div className="hstat__n">{s.value}</div><div className="hstat__l">{s.label}</div></>;
        return s.href && s.value > 0
          ? <a key={s.label} className={`${cls} hstat__card--link`} href={s.href}>{body}</a>
          : <div key={s.label} className={cls}>{body}</div>;
      })}
    </div>
  );
}

export function Health() {
  usePageMeta('health', 'Health', ['Home', 'opndoor', 'Health']);
  const toast = useToast();
  const [data, setData] = useState<CronHealth | null>(null);
  const [loading, setLoading] = useState(true);
  // #108 A visible "snapshot" time so Refresh has an observable effect even when the
  // underlying cron figures are unchanged.
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const reload = useCallback(async () => {
    if (!SUPABASE_ENABLED) { setLoading(false); return; }
    setLoading(true);
    try {
      setData(await getCronHealth());
      setRefreshedAt(new Date());
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not load the health metrics.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void reload(); }, [reload]);

  const head = (
    <div className="page-head">
      <div>
        <div className="rec-eyebrow"><span className="opx">opndoor</span> · operational health</div>
        <h1 className="page-head__title" style={{ marginTop: 10 }}>Health</h1>
        <p className="page-head__sub">Machinery, for whoever runs the deployment. Cron liveness, the real HTTP outcome of each scheduled call, and what to do about the ones that failed. The human work queue is on Home.</p>
      </div>
      {SUPABASE_ENABLED && (
        <div className="page-head__actions" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {refreshedAt && (
            <span style={{ fontSize: 12.5, color: 'var(--ink-mute)' }}>
              Snapshot {refreshedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <Button variant="ghost" size="sm" disabled={loading} onClick={() => void reload()}><Icon name="refresh" /> {loading ? 'Refreshing…' : 'Refresh'}</Button>
        </div>
      )}
    </div>
  );

  const opbar = (
    <div className="card opbar">
      <Icon name="shield" />
      <span>Visible to <b>opndoor admins</b> only. This is internal operational telemetry, not a partner-facing view.</span>
    </div>
  );

  // Mock/test mode: no back end to read. Keep the smoke test meaningful.
  if (!SUPABASE_ENABLED) {
    return (
      <>
        {head}
        {opbar}
        <div className="hplaceholder">Health metrics are available in the live environment.</div>
      </>
    );
  }

  if (loading && !data) {
    return (<>{head}{opbar}<div className="hplaceholder">Loading health metrics…</div></>);
  }

  if (!data) {
    return (<>{head}{opbar}<div className="hplaceholder">No health metrics are available right now.</div></>);
  }

  const c = data.counts;
  const baseUrlSet = !!data.functions_base_url;
  const gatedJobs = data.jobs.filter((j) => j.needs_base_url && j.active);
  // The RPC already returns errors first; this is the same rows, named.
  /* A JOB THAT IS OFF ON PURPOSE IS NOT FAILING. Its responses keep their
     status, so the page still shows what happened, but they are not counted
     as failures and they carry the "disabled here" reading instead. */
  const disabledJobs = new Set(data.jobs.filter((j) => j.disabled_here).map((j) => j.jobname));
  const isDisabled = (job: string | null) => !!job && disabledJobs.has(job);
  const failures = data.recent_http.filter((r) => !r.ok && !isDisabled(r.job));
  // Any silent-success job (run said succeeded, HTTP said non-2xx) or a non-2xx
  // most-recent response, or any non-2xx in the window: make it loud.
  const silentJobs = data.jobs.filter((j) => j.last_status === 'succeeded' && j.http_ok === false);
  const showAlert = data.http_alert || c.http_errors > 0 || silentJobs.length > 0;

  return (
    <>
      {head}
      {opbar}

      {/* THE ONE STATE THIS PAGE MUST NOT BE QUIET ABOUT. With the secret
          unset, the gated jobs report "succeeded" having made no call: every
          row above is green and nothing has run. */}
      {!baseUrlSet && gatedJobs.length > 0 && (
        <div className="halert" role="alert">
          <Icon name="alert" />
          <div>
            <div className="halert__title">
              The functions base URL is not set, so {gatedJobs.length} {gatedJobs.length === 1 ? 'job does' : 'jobs do'} nothing and report success
            </div>
            <div className="halert__sub">
              {gatedJobs.map((j) => j.jobname).join(', ')} end their command with{' '}
              <code className="hcode">where public.ops_functions_base_url() is not null</code>, which matches no rows,
              so cron records <b>succeeded</b> for a job that made no call.
              <br />
              <b>What to do:</b> set <code className="hcode">ops_secrets.functions_base_url</code> to this project's functions URL,
              then re-run one of these jobs and confirm a response appears against it below.
            </div>
          </div>
        </div>
      )}

      {showAlert && (
        <div className="halert" role="alert">
          <Icon name="alert" />
          <div>
            <div className="halert__title">HTTP errors detected in the last 24 hours ({c.http_errors})</div>
            <div className="halert__sub">
              A cron can report <b>succeeded</b> while its edge function actually returned a non-2xx (the silent-401 class).
              Check the <b>Last HTTP</b> column and the recent responses below - the run status alone is not proof of success.
            </div>
          </div>
        </div>
      )}

      <Card style={{ marginBottom: 18 }}>
        <CardHead title="Scheduled jobs" sub="The last run of each cron, and the real HTTP status of its call." />
        <div className="table-wrap">
          <table className="dt hdt">
            <thead>
              <tr>
                <th>Job</th>
                <th>Schedule</th>
                <th>Active</th>
                <th>Last run</th>
                <th>Last outcome</th>
                <th>Last HTTP</th>
              </tr>
            </thead>
            <tbody>
              {data.jobs.map((j) => {
                const rp = runPill(j.last_status);
                const httpBad = j.http_ok === false;
                const silent = j.last_status === 'succeeded' && httpBad;
                const advice = jobAdvice(j, baseUrlSet);
                return (
                  <tr key={j.jobname} className={advice ? `hrow hrow--${advice.tone}` : undefined}>
                    <td>
                      <div className="dt__name">{j.jobname}</div>
                      {j.last_return_message && <div className="dt__sub">{j.last_return_message}</div>}
                      <AdviceRow advice={advice} />
                    </td>
                    <td><code className="hcode">{j.schedule}</code></td>
                    <td>{j.active ? <Pill variant="deed">Active</Pill> : <Pill variant="muted">Paused</Pill>}</td>
                    <td className="dt__num">{fmtDateTime(j.last_run)}</td>
                    <td>
                      <Pill variant={rp.variant}>{rp.label}</Pill>
                      {silent && <div className="hsilent">reported success</div>}
                    </td>
                    <td>
                      {j.http_status_code != null ? (
                        <span className={`hhttp${httpBad ? ' hhttp--bad' : ' hhttp--ok'}`}>{j.http_status_code}</span>
                      ) : j.http_ok === null && j.last_run ? (
                        <span className="hhttp hhttp--none" title="No HTTP response could be correlated to this run by time.">no match</span>
                      ) : (
                        <span className="hhttp hhttp--none">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card style={{ marginBottom: 18 }}>
        <CardHead title="Last 24 hours" sub="Failures the system already records, plus HTTP errors from the cron calls." />
        <div className="card__body">
          <StatGrid stats={[
            { label: 'Email sends', value: c.email_sends },
            { label: 'Email failures', value: c.email_failures, bad: true },
            { label: 'Webhook failures', value: c.webhook_failures, bad: true },
            { label: 'Deed failures', value: c.deed_failures, bad: true },
            { label: 'Anomalies', value: c.anomalies, bad: true },
            { label: 'HTTP errors', value: c.http_errors, bad: true, href: '#responses' },
          ]} />
        </div>
      </Card>


      <div id="responses" />
      <Card style={{ marginBottom: 18 }}>
        <CardHead
          title="Recent responses"
          sub="The authoritative HTTP signal, straight from net._http_response. Failures first, then one line per job. A job name here is CORRELATED by run window, not recorded: pg_net discards the request URL when the response lands, so two jobs firing in the same second can be attributed to each other."
        />
        <div className="card__body">
          {/* FAILURES FIRST AND IN FULL. This is what the HTTP errors count
              links to, and what the page exists for; a 2xx needs no reading. */}
          {failures.length > 0 && (
            <div className="hresp-group">
              <div className="hresp-group__head">
                <b>{failures.length}</b> failing {failures.length === 1 ? 'response' : 'responses'} in the last 24 hours
              </div>
              {failures.map((r) => <ResponseRow key={r.id} r={r} />)}
            </div>
          )}

          {/* GROUPED BY JOB, LATEST PER JOB. partner-webhooks answers every
              minute; ungrouped it filled the whole list on its own and the
              other five jobs were simply not on the page. */}
          {data.http_by_job.length === 0 && failures.length === 0 && (
            <div className="dt__sub">No HTTP responses recorded in the last 24 hours.</div>
          )}
          {data.http_by_job.map((g) => (
            <details key={g.job ?? 'unattributed'} className="hresp-group">
              <summary className="hresp-group__head">
                <span className="hresp__job">{g.job ?? 'unattributed'}</span>
                <span className="muted">
                  {g.total} {g.total === 1 ? 'response' : 'responses'}
                  {g.errors > 0 && (g.disabled_here
                    ? <>, {g.errors} expected while off</>
                    : <>, <b className="hresp__errs">{g.errors} failing</b></>)}
                </span>
                {g.disabled_here && <span className="hresp__off">disabled on this environment</span>}
                {g.latest && (
                  <span className={`hhttp${g.latest.ok ? ' hhttp--ok' : ' hhttp--bad'}`}>
                    {g.latest.status_code != null ? g.latest.status_code : g.latest.timed_out ? 'timeout' : 'error'}
                  </span>
                )}
                {g.latest && <span className="hresp__when">{fmtDateTime(g.latest.created)}</span>}
              </summary>
              {g.latest ? <ResponseRow r={g.latest} disabledHere={g.disabled_here} /> : <div className="dt__sub">Nothing recorded.</div>}
              {/* Every response for this job that the snapshot carried. */}
              {data.recent_http.filter((r) => r.job === g.job && r.id !== g.latest?.id)
                .map((r) => <ResponseRow key={r.id} r={r} disabledHere={g.disabled_here} />)}
            </details>
          ))}
        </div>
      </Card>

      <div className="hgenerated">Snapshot generated {fmtDateTime(data.generated_at)}.</div>
    </>
  );
}
