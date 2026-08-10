/* =====================================================================
   Logs — the filterable API request table.

   What an integrator opens when a call did not do what they expected: path,
   method, status, error code, duration and which key made it.

   Search matches path, method, error code and an exact status, because those are
   the four things somebody actually types. "422" and "validation_failed" and
   "/orgs" all work.
   ===================================================================== */
import { useCallback, useEffect, useState } from 'react';
import { PERIODS, getApiLogs, type ApiLogRow } from '@/data/devCentreService';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Card, CardHead } from '@/components/ui/Card';

const when = (s: string) => new Date(s).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'medium' });

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

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try { setRows(await getApiLogs({ partnerId, search, days })); }
    catch (x) { setErr(String((x as Error).message ?? x)); }
    finally { setBusy(false); }
  }, [partnerId, search, days]);

  // Debounced so typing does not fire a query per keystroke.
  useEffect(() => { const t = setTimeout(() => { void load(); }, 250); return () => clearTimeout(t); }, [load]);

  return (
    <Card>
      <CardHead
        title="API requests"
        sub={`${rows.length} request${rows.length === 1 ? '' : 's'}`}
        actions={
          <div className="devfilters">
            <input
              type="text"
              placeholder="Search path, method, status or error"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Date range">
              {PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <Button variant="ghost" size="sm" onClick={() => void load()} disabled={busy}>
              <Icon name="check" /> Refresh
            </Button>
          </div>
        }
      />
      {err && <div className="devalert">{err}</div>}
      <table className="dt">
        <thead>
          <tr><th>Time</th><th>Method</th><th>Path</th><th>Status</th><th>Error</th><th>Duration</th><th>Key</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="soft">{when(r.created_at)}</td>
              <td><span className="devmethod">{r.method}</span></td>
              <td><code>{r.path}</code></td>
              <td><span className={`devstatus ${statusTone(r.status_code)}`}>{r.status_code}</span></td>
              <td className="soft">{r.error_code ?? '--'}</td>
              <td className="soft">{r.duration_ms == null ? '--' : `${r.duration_ms}ms`}</td>
              <td className="soft">{r.key_name ?? 'unauthenticated'}</td>
            </tr>
          ))}
          {!rows.length && !busy && (
            <tr><td colSpan={7} className="soft">
              No requests match. Requests appear here as soon as they are made, including ones that failed
              authentication, which show as unauthenticated with no key.
            </td></tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
