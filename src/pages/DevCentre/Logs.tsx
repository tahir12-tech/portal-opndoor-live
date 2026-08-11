/* =====================================================================
   Logs — the filterable API request table.

   What an integrator opens when a call did not do what they expected: path,
   method, status, error code, duration and which key made it.

   Search matches path, method, error code and an exact status, because those are
   the four things somebody actually types. "422" and "validation_failed" and
   "/orgs" all work.
   ===================================================================== */
import { Fragment, useCallback, useEffect, useState } from 'react';
import { PERIODS, getApiLogs, type ApiLogRow } from '@/data/devCentreService';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { PeriodSelect } from '@/components/ui/Select';

const when = (s: string) => new Date(s).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'medium' });

/** Bodies arrive already redacted from the server; this only formats them. */
function pretty(v: unknown): string {
  if (v === null || v === undefined) return 'No body.';
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function statusTone(code: number): string {
  if (code >= 500) return 'devstatus--server';
  if (code >= 400) return 'devstatus--client';
  return 'devstatus--ok';
}

export function Logs({ partnerId }: { partnerId: string | null }) {
  const [rows, setRows] = useState<ApiLogRow[]>([]);
  const [search, setSearch] = useState('');
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  // A set, not a single id. Comparing a failing call against the one before it
  // is the main thing anybody does here, and an accordion that closes the
  // previous row makes exactly that impossible.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try { setRows(await getApiLogs({ partnerId, search, days })); setLoadedAt(new Date()); }
    catch (x) { setErr(String((x as Error).message ?? x)); }
    finally { setBusy(false); }
  }, [partnerId, search, days]);

  // Debounced so typing does not fire a query per keystroke.
  useEffect(() => { const t = setTimeout(() => { void load(); }, 250); return () => clearTimeout(t); }, [load]);

  return (
    <Card>
      <CardHead
        title="API requests"
        sub={`${rows.length} request${rows.length === 1 ? '' : 's'}${loadedAt ? ` · updated ${loadedAt.toLocaleTimeString('en-GB')}` : ''}`}
        actions={
          <div className="devfilters">
            {/* The app's search pattern: .toolbar__search with a leading icon,
                as Applications, League and Users all use. */}
            <div className="toolbar__search">
              <Icon name="search" />
              <input
                type="text"
                placeholder="Search path, method, status or error"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <PeriodSelect
              ariaLabel="Date range"
              value={String(days)}
              onChange={(v) => setDays(Number(v))}
              options={PERIODS.map((p) => ({ value: String(p.id), label: p.label }))}
            />
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
          <tr><th /><th>Time</th><th>Method</th><th>Path</th><th>Status</th><th>Error</th><th>Duration</th><th>Key</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const hasBodies = r.request_body != null || r.response_body != null;
            const isOpen = expanded.has(r.id);
            return (
            <Fragment key={r.id}>
            <tr>
              <td>
                {hasBodies && (
                  <button
                    className="devicon"
                    aria-expanded={isOpen}
                    title={isOpen ? 'Hide bodies' : 'Show bodies'}
                    aria-label={isOpen ? 'Hide bodies' : 'Show bodies'}
                    onClick={() => toggle(r.id)}
                  >
                    <Icon name={isOpen ? 'minus' : 'plus'} />
                  </button>
                )}
              </td>
              <td className="soft">{when(r.created_at)}</td>
              <td><span className="devmethod">{r.method}</span></td>
              <td><code>{r.path}</code></td>
              <td><span className={`devstatus ${statusTone(r.status_code)}`}>{r.status_code}</span></td>
              <td className="soft">{r.error_code ?? '--'}</td>
              <td className="soft">{r.duration_ms == null ? '--' : `${r.duration_ms}ms`}</td>
              <td className="soft">{r.key_name ?? 'unauthenticated'}</td>
            </tr>
            {isOpen && (
              <tr className="devbodies">
                <td colSpan={8}>
                  <div className="devbodies__grid">
                    <div>
                      <div className="devbodies__label">Request</div>
                      <pre className="devcode"><code>{pretty(r.request_body)}</code></pre>
                    </div>
                    <div>
                      <div className="devbodies__label">Response</div>
                      <pre className="devcode"><code>{pretty(r.response_body)}</code></pre>
                    </div>
                  </div>
                  <p className="devbodies__note">
                    Field names are kept, values are masked. A field showing{' '}
                    <code>&quot;[redacted]&quot;</code> <strong>was</strong> sent, so this shows you the
                    shape of your payload without us holding anyone&rsquo;s details. Masking happens
                    before the row is written, so the real values were never stored.
                  </p>
                </td>
              </tr>
            )}
            </Fragment>
            );
          })}
          {!rows.length && !busy && (
            <tr><td colSpan={8} className="soft">
              No requests match. Requests appear here as soon as they are made, including ones that failed
              authentication, which show as unauthenticated with no key.
            </td></tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
