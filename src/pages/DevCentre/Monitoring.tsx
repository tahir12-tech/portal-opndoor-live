/* =====================================================================
   Monitoring — the Dev Centre landing tab.

   Counters, requests over time split success against failed, error distribution
   by method, and webhook health including delivery time.

   The charts are hand-drawn SVG rather than a charting dependency. package.json
   is tracked and the lockfile is already out of sync (DEFECTS.md 11), so adding
   a dependency is not a small act, and two bar charts do not justify one.

   EVERYTHING HERE COMES FROM partner_api_request_log, NOT partner_api_requests.
   The latter is the idempotency ledger: one row per idempotency key, only for
   POST /applications. Monitoring built on it would have shown a developer three
   requests where they made thirty, and looked authoritative while doing it.
   ===================================================================== */
import { useEffect, useState } from 'react';
import {
  PERIODS, getApiStats, getApiTimeseries, getErrorsByMethod, getWebhookStats,
  type ApiStats, type ErrorSlice, type TimePoint, type WebhookStats,
} from '@/data/devCentreService';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { BarChart } from '@/components/ui/BarChart';
import { PeriodSelect } from '@/components/ui/Select';
import { formatDate } from '@/lib/format';

const ms = (v: number | null) => (v == null ? '--' : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);
const day = (s: string) => formatDate(s);

function Counter({ label, value, tone, sub }: { label: string; value: string; tone?: 'bad'; sub?: string }) {
  return (
    <div className="devcount">
      <div className="devcount__label">{label}</div>
      <div className={`devcount__value${tone === 'bad' ? ' is-bad' : ''}`}>{value}</div>
      {sub && <div className="devcount__sub">{sub}</div>}
    </div>
  );
}

/** Stacked bars: successes below, failures above, so total height reads as volume. */
function RequestsChart({ points }: { points: TimePoint[] }) {
  const max = Math.max(1, ...points.map((p) => Number(p.succeeded) + Number(p.failed)));
  if (!points.length) return <p className="soft">No requests in this period.</p>;
  return (
    <div className="devchart">
      <div className="devchart__bars">
        {points.map((p) => {
          const ok = Number(p.succeeded), bad = Number(p.failed);
          return (
            <div key={p.bucket} className="devbar" title={`${day(p.bucket)}: ${ok} succeeded, ${bad} failed`}>
              <div className="devbar__stack">
                <div className="devbar__fail" style={{ height: `${(bad / max) * 100}%` }} />
                <div className="devbar__ok" style={{ height: `${(ok / max) * 100}%` }} />
              </div>
              <div className="devbar__label">{day(p.bucket)}</div>
            </div>
          );
        })}
      </div>
      <div className="devlegend">
        <span><i className="devswatch devswatch--ok" /> Succeeded</span>
        <span><i className="devswatch devswatch--fail" /> Failed</span>
      </div>
    </div>
  );
}

/**
 * Errors by method then code.
 *
 * Uses the portal BarChart rather than a bespoke one: label, track, value is
 * exactly its shape, and it already carries the app's bar styling and the
 * is-top emphasis. The method goes in `sub`, so "which call is failing" and
 * "why" read on one line.
 */
function ErrorChart({ slices }: { slices: ErrorSlice[] }) {
  if (!slices.length) return <p className="soft">No errors in this period.</p>;
  const rows = slices.map((s) => ({
    label: s.error_code,
    sub: s.method,
    value: Number(s.errors),
    display: String(s.errors),
  }));
  return <BarChart rows={rows} topIndex={0} />;
}

export function Monitoring({ partnerId }: { partnerId: string | null }) {
  const [days, setDays] = useState(7);
  const [stats, setStats] = useState<ApiStats | null>(null);
  const [points, setPoints] = useState<TimePoint[]>([]);
  const [errors, setErrors] = useState<ErrorSlice[]>([]);
  const [hooks, setHooks] = useState<WebhookStats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setErr(null);
    Promise.all([
      getApiStats(partnerId, days),
      getApiTimeseries(partnerId, days),
      getErrorsByMethod(partnerId, days),
      getWebhookStats(partnerId, days),
    ])
      .then(([s, t, e, w]) => { if (!live) return; setStats(s); setPoints(t); setErrors(e); setHooks(w); })
      .catch((x) => live && setErr(String(x.message ?? x)));
    return () => { live = false; };
  }, [partnerId, days]);

  const period = (
    <PeriodSelect
      ariaLabel="Period"
      value={String(days)}
      onChange={(v) => setDays(Number(v))}
      options={PERIODS.map((p) => ({ value: String(p.id), label: p.label }))}
    />
  );

  const failed = Number(stats?.failed_requests ?? 0);
  const total = Number(stats?.total_requests ?? 0);

  return (
    <>
      {err && <div className="devalert">{err}</div>}

      <Card>
        <CardHead title="API requests" sub="Every request to the partner API, including reads" actions={period} />
        <CardBody>
          <div className="devcounts">
            <Counter label="Total requests" value={String(total)} />
            <Counter label="Errors" value={String(failed)} tone={failed ? 'bad' : undefined}
                     sub={total ? `${((failed / total) * 100).toFixed(1)}% of requests` : undefined} />
            <Counter label="Endpoints used" value={String(stats?.distinct_paths ?? 0)} />
            <Counter label="Average response" value={ms(stats?.avg_duration_ms ?? null)} />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHead title="Requests over time" sub="Successful and failed, by day" />
        <CardBody><RequestsChart points={points} /></CardBody>
      </Card>

      <Card>
        <CardHead title="Error distribution" sub="By method, then by error code" />
        <CardBody><ErrorChart slices={errors} /></CardBody>
      </Card>

      <Card>
        <CardHead title="Webhooks" sub="Events sent to your endpoints, and how long they took to arrive" />
        <CardBody>
          <div className="devcounts">
            <Counter label="Events sent" value={String(hooks?.sent ?? 0)} />
          <Counter label="Delivered" value={String(hooks?.delivered ?? 0)} />
          <Counter label="Retrying" value={String(hooks?.failed ?? 0)}
                   tone={Number(hooks?.failed ?? 0) ? 'bad' : undefined} />
          <Counter label="Dead lettered" value={String(hooks?.dead ?? 0)}
                     tone={Number(hooks?.dead ?? 0) ? 'bad' : undefined} />
          </div>
          <div className="devcounts" style={{ marginTop: 12 }}>
            <Counter label="Fastest delivery" value={ms(hooks?.min_ms ?? null)} />
            <Counter label="Average delivery" value={ms(hooks?.avg_ms ?? null)} />
            <Counter label="Slowest delivery" value={ms(hooks?.max_ms ?? null)} />
          </div>
          <p className="soft" style={{ fontSize: 13, marginTop: 10 }}>
          Delivery time is measured from the event happening to your endpoint accepting it, so it includes the
          dispatcher&rsquo;s polling interval as well as your own response. It is the number that answers
            &ldquo;how long after the event did it actually arrive&rdquo;.
          </p>
        </CardBody>
      </Card>
    </>
  );
}
