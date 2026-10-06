/* =====================================================================
   Webhooks history — deliveries, filterable by status.

   Failures are the reason anybody opens this, so the status filter defaults to
   everything but puts the failing states first, and a failed row shows the
   response and the error inline rather than behind a click.
   ===================================================================== */
import { useCallback, useEffect, useState } from 'react';
import {
  PERIODS, WEBHOOK_EVENTS, deliveryState, getDeliveries, getWebhookEndpoints,
  replayDelivery, sendTestEvent, type TestEventResult,
  type DevDelivery, type DevWebhookEndpoint,
} from '@/data/devCentreService';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { PeriodSelect } from '@/components/ui/Select';

const when = (s: string | null) => (s ? new Date(s).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'medium' }) : '--');

/** Enqueue to acceptance, which is what "how late was it" means to a partner. */
function deliveryMs(d: DevDelivery): string {
  if (!d.delivered_at) return '--';
  const v = new Date(d.delivered_at).getTime() - new Date(d.created_at).getTime();
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`;
}

type StatusFilter = 'all' | 'delivered' | 'retrying' | 'dead';

export function WebhookHistory({ partnerId, readOnly = false }: {
  partnerId: string | null;
  /* READ-ONLY, FOR A SUPPLIER'S INTEGRATION TAB. The history is a
     reading; sending a test event and replaying a delivery both put
     traffic on somebody else's endpoint, which is their developer's to
     do. Matt, 2026-10-01: "read-only for Opndoor admin ... webhook
     delivery history". */
  readOnly?: boolean;
}) {
  const [rows, setRows] = useState<DevDelivery[]>([]);
  const [endpoints, setEndpoints] = useState<DevWebhookEndpoint[]>([]);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [event, setEvent] = useState('');
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const toast = useToast();

  // Test-event modal.
  const [testOpen, setTestOpen] = useState(false);
  const [testEndpoint, setTestEndpoint] = useState('');
  const [testEvent, setTestEvent] = useState(WEBHOOK_EVENTS[0]?.id ?? 'application.created');
  const [testResult, setTestResult] = useState<TestEventResult | null>(null);

  async function doReplay(id: string) {
    setBusy(true);
    try {
      const r = await replayDelivery(id);
      toast(r.replayCount === 1 ? 'Queued for delivery.' : `Queued again, replay ${r.replayCount}.`);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function doTest() {
    if (!testEndpoint) { toast('Choose an endpoint.', 'error'); return; }
    setBusy(true);
    setTestResult(null);
    try {
      setTestResult(await sendTestEvent(testEndpoint, testEvent));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const [d, e] = await Promise.all([
        getDeliveries({ partnerId, eventType: event || null, limit: 300 }),
        getWebhookEndpoints(partnerId),
      ]);
      setRows(d); setEndpoints(e); setLoadedAt(new Date());
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
        sub={`${shown.length} of ${rows.length} shown${loadedAt ? ` · updated ${loadedAt.toLocaleTimeString('en-GB')}` : ''}`}
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
            {!readOnly && (
              <Button variant="ghost" size="sm" onClick={() => setTestOpen(true)} disabled={busy}>
                <Icon name="send" /> Send test event
              </Button>
            )}
            {/* A refresh icon, not a tick. The button was labelled Refresh and
                showed a permanent green check, so a click that DID refetch looked
                identical to one that did nothing. The stamp below is the actual
                evidence the fetch happened, since the rows are usually unchanged. */}
            <Button variant="ghost" size="sm" onClick={() => void load()} disabled={busy}>
              <Icon name="refresh" /> {busy ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        }
      />
      {err && <CardBody style={{ paddingBottom: 0 }}><div className="devalert">{err}</div></CardBody>}
      <table className="dt">
        <thead>
          <tr><th>Event id</th><th>Event</th><th>Endpoint</th><th>Sent</th><th>Delivery time</th><th>Attempts</th><th>Status</th>{!readOnly && <th />}</tr>
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
                  {/* Replays are shown rather than hidden. A row on its third
                      attempt after two replays reads very differently from a
                      fresh failure, and that distinction is the whole reason the
                      history is appended to rather than overwritten. */}
                  {d.replay_count > 0 && (
                    <div className="soft" title={`Last replayed ${when(d.last_replay_at ?? '')}`}>
                      replayed {d.replay_count}&times;, {d.prior_attempts.reduce((t, p) => t + (p.attempts ?? 0), 0)} earlier attempts
                    </div>
                  )}
                </td>
                {/* REPLAY IS THE DEVELOPER'S, not an onlooker's: it puts
                    traffic on their endpoint. The column is not drawn at
                    all on a read-only view rather than drawn empty. */}
                {!readOnly && (
                  <td>
                    {/* Offered only where there is something to replay. A delivered
                        row is excluded here and refused by the RPC as well:
                        resending a success fixes nothing, and the button would
                        eventually be pressed on the wrong row. */}
                    {!d.delivered_at && (
                      <Button variant="ghost" size="sm" onClick={() => void doReplay(d.id)} disabled={busy}>
                        <Icon name="refresh" /> Replay
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
          {/* TWO READERS, TWO SENTENCES. Matt, 2026-10-02: the admin view
              reads "No webhook deliveries in this period", and "check on
              Configuration" stays in the developer's own Dev Centre.
              Configuration is a screen an admin cannot open since the
              Dev Centre became developers-only the same day, so the old
              line would have sent them to a locked door. */}
          {!shown.length && !busy && (
            <tr><td colSpan={readOnly ? 7 : 8} className="soft">
              {readOnly ? 'No webhook deliveries in this period.' : (
                <>
                  No deliveries match. If you expected some, check on Configuration that an endpoint is enabled and
                  subscribed to that event.
                </>
              )}
            </td></tr>
          )}
        </tbody>
      </table>

      {/* ---- send a test event ---- */}
      <Modal
        open={testOpen}
        onClose={() => { setTestOpen(false); setTestResult(null); }}
        title="Send a test event"
        sub="Signed exactly like a real one, delivered straight to your endpoint"
        width={720}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setTestOpen(false); setTestResult(null); }} disabled={busy}>
              Close
            </Button>
            <Button variant="primary" onClick={() => void doTest()} disabled={busy || !testEndpoint}>
              {busy ? 'Sending…' : testResult ? 'Send again' : 'Send'}
            </Button>
          </>
        }
      >
        <p className="soft">
          This bypasses the retry queue and posts once, so you see the response here rather than having to
          find it in this table. It is signed with the same code path a real delivery uses, so if your
          verification accepts this it will accept the real thing. The payload carries{' '}
          <code>&quot;test&quot;: true</code> so your handler can drop it without a human deciding later
          which rows were tests.
        </p>

        {/* The app's own select, not a bare <select>. A native one here would
            miss the chevron, the focus ring and the sizing every other dropdown
            in the portal has. */}
        <Field label="Endpoint">
          <PeriodSelect
            ariaLabel="Endpoint"
            value={testEndpoint}
            onChange={setTestEndpoint}
            options={[
              { value: '', label: 'Choose an endpoint' },
              ...endpoints.filter((e) => e.active).map((e) => ({
                value: e.id,
                label: `${e.livemode ? 'Live' : 'Sandbox'} - ${e.url}`,
              })),
            ]}
          />
        </Field>

        <Field label="Event type">
          <PeriodSelect
            ariaLabel="Event type"
            value={testEvent}
            onChange={setTestEvent}
            options={WEBHOOK_EVENTS.map((e) => ({ value: e.id, label: e.id }))}
          />
        </Field>

        {testResult && (
          <div className="devtest">
            <div className={`devtest__verdict devtest__verdict--${testResult.response.ok ? 'ok' : 'bad'}`}>
              <Icon name={testResult.response.ok ? 'check' : 'alert'} />
              <div>
                <strong>
                  {testResult.response.ok
                    ? `Accepted, HTTP ${testResult.response.status}`
                    : testResult.response.status
                      ? `Rejected, HTTP ${testResult.response.status}`
                      : 'No response'}
                </strong>
                <div className="soft">
                  {testResult.response.duration_ms}ms.{' '}
                  {testResult.response.ok
                    ? 'A real delivery would be marked delivered and never retried.'
                    : 'A real delivery would be retried on the backoff schedule, then dead-lettered.'}
                </div>
              </div>
            </div>

            <div className="devbodies__label">Signature headers we sent</div>
            <pre className="devcode"><code>{Object.entries(testResult.request.headers)
              .map(([k, v]) => `${k}: ${v}`).join('\n')}</code></pre>

            <div className="devbodies__label">Body we signed</div>
            <pre className="devcode"><code>{JSON.stringify(testResult.request.body, null, 2)}</code></pre>

            <div className="devbodies__label">Your response</div>
            <pre className="devcode"><code>{testResult.response.body || '(empty)'}</code></pre>
          </div>
        )}
      </Modal>
    </Card>
  );
}
