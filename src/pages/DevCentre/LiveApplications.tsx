/* =====================================================================
   Live applications, metadata only.

   THE QUESTION THIS ANSWERS is the first one anyone asks after go-live: did my
   POST actually produce an application, and what happened to it? Before this a
   developer could see sandbox and nothing else, so verifying a live integration
   meant asking somebody in another team to look at Applications for them.

   WHAT IS NOT HERE, AND WHY THAT IS THE DESIGN. No tenant name, date of birth,
   email, phone or address. No rent. No commission rates. No referrer identity, no
   payment link. The server returns a projection on a written-down allowlist
   rather than the row, so this screen cannot show those fields even by accident:
   they never arrive.

   That is deliberate rather than cautious. The alternative considered was a
   `developer` arm on the applications RLS policy, which would have been one line
   and would have handed over the whole record, because RLS grants rows and not
   columns.
   ===================================================================== */
import { useCallback, useEffect, useState } from 'react';
import {
  getLiveApplications, getLiveCounts,
  type LiveApplication, type LiveCounts,
} from '@/data/devCentreService';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Pill, type PillVariant } from '@/components/ui/Pill';

const when = (s: string | null) =>
  s ? new Date(s).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—';

/** The partner vocabulary comes back from the server; map it to the app's pills. */
function statusVariant(s: string): PillVariant {
  if (s === 'deed_issued') return 'deed';
  if (s === 'paid') return 'paid';
  if (s === 'sent') return 'sent';
  if (s === 'withdrawn' || s === 'lapsed') return 'muted';
  return 'warn';
}

export function LiveApplications({ partnerId }: { partnerId: string | null }) {
  const [rows, setRows] = useState<LiveApplication[]>([]);
  const [counts, setCounts] = useState<LiveCounts | null>(null);
  const [search, setSearch] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const [list, c] = await Promise.all([
        getLiveApplications({ partnerId, search: search.trim() || null }),
        getLiveCounts(partnerId),
      ]);
      setRows(list); setCounts(c); setLoadedAt(new Date());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [partnerId, search]);

  useEffect(() => { const t = setTimeout(() => { void load(); }, 250); return () => clearTimeout(t); }, [load]);

  return (
    <>
      <div className="sbxhead">
        <div className="sbxcounts">
          {counts && (
            <>
              <Pill variant="muted">{counts.total} live</Pill>
              {/* The most useful number on the screen. A developer whose
                  integration is live and whose from_api count is zero has their
                  answer without reading a single row. */}
              <Pill variant={counts.from_api > 0 ? 'paid' : 'warn'}>{counts.from_api} via the API</Pill>
              <Pill variant="sent">{counts.sent} awaiting payment</Pill>
              <Pill variant="paid">{counts.paid} paid</Pill>
              <Pill variant="deed">{counts.deed} deed issued</Pill>
              <Pill variant="muted">{counts.closed} closed</Pill>
            </>
          )}
        </div>
        <div className="sbxacts">
          <div className="toolbar__search">
            <Icon name="search" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Reference, idempotency key or status"
              aria-label="Search live applications"
            />
          </div>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={busy}>
            <Icon name="refresh" /> {busy ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {err && <div className="devalert">{err}</div>}

      <Card>
        <CardHead
          title="Live applications"
          sub={`References, status and timing only${loadedAt ? ` · updated ${loadedAt.toLocaleTimeString('en-GB')}` : ''}`}
        />

        <CardBody style={{ paddingBottom: 0 }}>
          <div className="devopenapi">
            <Icon name="lock" />
            <div>
              <strong>Metadata only, by design</strong>
              <p>
                Tenant details, the rent and commission are not shown here and are not sent to this
                screen: the server returns a fixed set of columns rather than the application. If you need
                one of those to debug something, the <strong>Logs</strong> tab shows the request body you
                sent, with values masked and field names kept.
              </p>
            </div>
          </div>
        </CardBody>

        {rows.length === 0 ? (
          <CardBody>
            <p className="soft">
              No live applications yet
              {search.trim() ? ' matching that search' : ''}. Applications created with an{' '}
              <code>opnd_live_</code> key appear here, alongside any created in the portal by your
              colleagues.
            </p>
          </CardBody>
        ) : (
          <table className="dt">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Status</th>
                <th>Created</th>
                <th>Paid</th>
                <th>Deed issued</th>
                <th>Your request</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td><code>{a.guarantee_ref}</code></td>
                  <td><Pill variant={statusVariant(a.status)}>{a.status}</Pill></td>
                  <td className="soft">{when(a.created_at)}</td>
                  <td className="soft">{when(a.paid_at)}</td>
                  <td className="soft">{when(a.deed_issued_at)}</td>
                  <td>
                    {a.idempotency_key ? (
                      <>
                        <code className="devid">{a.idempotency_key}</code>
                        <div className="soft">
                          {a.api_key_name ?? 'key deleted'}
                          {a.request_status != null && <> · HTTP {a.request_status}</>}
                          {a.request_at && <> · {when(a.request_at)}</>}
                        </div>
                      </>
                    ) : (
                      // Not a gap. Somebody typed it into the portal, which is
                      // worth distinguishing from a request that failed.
                      <span className="soft">Created in the portal</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
