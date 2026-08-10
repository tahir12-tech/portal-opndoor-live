/* =====================================================================
   Webhooks history — deliveries, filterable by status.

   Failures are the reason anybody opens this, so the status filter defaults to
   everything but puts the failing states first, and a failed row shows the
   response and the error inline rather than behind a click.
   ===================================================================== */
import { useCallback, useEffect, useState } from 'react';
import {
  PERIODS, WEBHOOK_EVENTS, deliveryState, getDeliveries, getWebhookEndpoints,
  type DevDelivery, type DevWebhookEndpoint,
} from '@/data/devCentreService';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { PeriodSelect } from '@/components/ui/Select';

const when = (s: string | null) => (s ? new Date(s).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'medium' }) : '--');

/** Enqueue to acceptance, which is what "how late was it" means to a partner. */
function deliveryMs(d: DevDelivery): string {
  if (!d.delivered_at) return '--';
  const v = new Date(d.delivered_at).getTime() - new Date(d.created_at).getTime();
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`;
}

type StatusFilter = 'all' | 'delivered' | 'retrying' | 'dead';

export function WebhookHistory({ partnerId }: { partnerId: string | null }) {
  const [rows, setRows] = useState<DevDelivery[]>([]);
  const [endpoints, setEndpoints] = useState<DevWebhookEndpoint[]>([]);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [event, setEvent] = useState('');
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const [d, e] = await Promise.all([
        getDeliveries({ partnerId, eventType: event || null, limit: 300 }),
        getWebhookEndpoints(partnerId),
      ]);
      setRows(d); setEndpoints(e);
    } catch (x) { setErr(String((x as Error).message ?? x)); }
    finally { setBusy(false); }
  }, [partnerId, event]);

  useEffect(() => { void load(); }, [load]);

  const cutoff = Date.now() - days * 86400000;
  const shown = rows.filter((r) => {
    if (new Date(r.created_at).getTime() < cutoff) return false;
    const s = deliveryState(r).tone;
    if (status === 'delivered') return s === 'ok';
    if (status === 'dead') return s === 'dead';
    if (status === 'retrying') return s === 'retry' || s === 'pending';
    return true;
  });

  const nameFor = (d: DevDelivery) =>
    endpoints.find((e) => e.id === d.endpoint_id)?.description
    ?? endpoints.find((e) => e.id === d.endpoint_id)?.url
    ?? d.endpoint_url;

  return (
    <Card>
      <CardHead
        title="Webhook deliveries"
        sub={`${shown.length} of ${rows.length} shown`}
        actions={
          <div className="devfilters">
            <PeriodSelect
              ariaLabel="Status"
              value={status}
              onChange={(v) => setStatus(v as StatusFilter)}
              options={[
                { value: 'all', label: 'Every status' },
                { value: 'dead', label: 'Dead lettered' },
                { value: 'retrying', label: 'Retrying or queued' },
                { value: 'delivered', label: 'Delivered' },
              ]}
            />
            <PeriodSelect
              ariaLabel="Event type"
              value={event}
              onChange={setEvent}
              options={[{ value: '', label: 'Every event' }, ...WEBHOOK_EVENTS.map((e) => ({ value: e.id, label: e.id }))]}
            />
            <PeriodSelect
              ariaLabel="Date range"
              value={String(days)}
              onChange={(v) => setDays(Number(v))}
              options={PERIODS.map((p) => ({ value: String(p.id), label: p.label }))}
            />
            <Button variant="ghost" size="sm" onClick={() => void load()} disabled={busy}>
              <Icon name="check" /> Refresh
            </Button>
          </div>
        }
      />
      {err && <CardBody style={{ paddingBottom: 0 }}><div className="devalert">{err}</div></CardBody>}
      <table className="dt">
        <thead>
          <tr><th>Event id</th><th>Event</th><th>Endpoint</th><th>Sent</th><th>Delivery time</th><th>Attempts</th><th>Status</th></tr>
        </thead>
        <tbody>
          {shown.map((d) => {
            const s = deliveryState(d);
            return (
              <tr key={d.id}>
                <td><code className="devid">{d.event_id.slice(0, 8)}</code></td>
                <td><code>{d.event_type}</code>{d.guarantee_ref && <div className="soft">{d.guarantee_ref}</div>}</td>
                <td className="soft">{nameFor(d)}</td>
                <td className="soft">{when(d.created_at)}</td>
                <td className="soft">{deliveryMs(d)}</td>
                <td className="soft">{d.attempts}</td>
                <td>
                  <span className={`devstate devstate--${s.tone}`}>{s.label}</span>
                  {d.last_error && <div className="devfail" title={d.last_error}>{d.last_error.slice(0, 60)}</div>}
                  {d.last_status != null && !d.delivered_at && <div className="soft">HTTP {d.last_status}</div>}
                </td>
              </tr>
            );
          })}
          {!shown.length && !busy && (
            <tr><td colSpan={7} className="soft">
              No deliveries match. If you expected some, check on Configuration that an endpoint is enabled and
              subscribed to that event.
            </td></tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
