/* =====================================================================
   Configuration — keys, endpoints, and the way in to the docs.

   Two cards at the top open the getting-started guide and the API
   documentation, which live behind here rather than as tabs of their own.

   THE ASYMMETRY BETWEEN THE TWO SECRETS IS REAL AND IS STATED, not smoothed
   over. A webhook signing secret can be revealed because it is stored: signing
   requires it. An API key cannot, because only its SHA-256 is stored and the key
   itself exists nowhere. Showing a masked prefix and pretending the two work the
   same way would teach a developer the wrong thing about what we hold.
   ===================================================================== */
import { useState } from 'react';
import {
  API_SCOPES, WEBHOOK_EVENTS, maskSecret, revealEndpointSecret,
  type DevApiKey, type DevWebhookEndpoint,
} from '@/data/devCentreService';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Card, CardHead } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
import { useToast } from '@/components/ui/Toast';

const dt = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString('en-GB', { dateStyle: 'medium' }) : '--';

export function Configuration(props: {
  keys: DevApiKey[];
  endpoints: DevWebhookEndpoint[];
  canManage: boolean;          // developer or opndoor admin; management is keys-only
  busy: boolean;
  onMint: () => void;
  onRevoke: (k: DevApiKey) => void;
  onCreateEndpoint: () => void;
  onToggleEndpoint: (e: DevWebhookEndpoint) => void;
  onOpenGuide: () => void;
  onOpenDocs: () => void;
}) {
  const toast = useToast();
  const [shown, setShown] = useState<Record<string, string>>({});

  async function reveal(e: DevWebhookEndpoint) {
    if (shown[e.id]) { setShown((p) => { const n = { ...p }; delete n[e.id]; return n; }); return; }
    try {
      const secret = await revealEndpointSecret(e.id);
      setShown((p) => ({ ...p, [e.id]: secret }));
    } catch (x) { toast(String((x as Error).message ?? x)); }
  }

  const copy = (v: string, what: string) => { void navigator.clipboard?.writeText(v); toast(`${what} copied.`); };

  return (
    <>
      {props.canManage && (
        <div className="devlinks">
          <button className="devlink" onClick={props.onOpenGuide}>
            <Icon name="book" />
            <div>
              <div className="devlink__title">Getting started</div>
              <div className="devlink__sub">Mint a key, call the API, register a webhook, verify a signature</div>
            </div>
            <Icon name="chevronRight" />
          </button>
          <button className="devlink" onClick={props.onOpenDocs}>
            <Icon name="file" />
            <div>
              <div className="devlink__title">API documentation</div>
              <div className="devlink__sub">Endpoints, payloads, error codes, status vocabulary and signing</div>
            </div>
            <Icon name="chevronRight" />
          </button>
        </div>
      )}

      <Card>
        <CardHead
          title="API keys"
          sub="Shown once when created. Only a hash is stored, so the full key cannot be shown again."
          actions={props.canManage && (
            <Button variant="primary" size="sm" onClick={props.onMint}><Icon name="plus" /> Mint a key</Button>
          )}
        />
        <table className="dt">
          <thead><tr><th>Label</th><th>Key</th><th>Scopes</th><th>Created</th><th>Last used</th><th>Status</th><th /></tr></thead>
          <tbody>
            {props.keys.map((k) => (
              <tr key={k.id} className={k.revoked_at ? 'is-revoked' : ''}>
                <td><strong>{k.name}</strong></td>
                <td>
                  <div className="devsecret">
                    <code>{k.key_prefix}{'•'.repeat(20)}</code>
                    <button className="devicon" title="Copy the prefix" onClick={() => copy(k.key_prefix, 'Prefix')}>
                      <Icon name="file" size={14} />
                    </button>
                  </div>
                  <div className="soft devsecret__note">Prefix only. The key itself is not stored.</div>
                </td>
                <td className="soft">{k.scopes.join(', ') || '--'}</td>
                <td className="soft">{dt(k.created_at)}</td>
                <td className="soft">{k.last_used_at ? dt(k.last_used_at) : 'Never'}</td>
                <td>{k.revoked_at ? <Pill variant="muted">Revoked</Pill> : <Pill variant="deed">Live</Pill>}</td>
                <td style={{ textAlign: 'right' }}>
                  {!k.revoked_at && (
                    <Button variant="ghost" size="sm" disabled={props.busy} onClick={() => props.onRevoke(k)}>Revoke</Button>
                  )}
                </td>
              </tr>
            ))}
            {!props.keys.length && <tr><td colSpan={7} className="soft">No keys yet.</td></tr>}
          </tbody>
        </table>
      </Card>

      {props.canManage && (
        <Card>
          <CardHead
            title="Webhook endpoints"
            sub="The signing secret can be revealed here, because signing needs it stored."
            actions={<Button variant="primary" size="sm" onClick={props.onCreateEndpoint}><Icon name="plus" /> Add endpoint</Button>}
          />
          <table className="dt">
            <thead><tr><th>Name</th><th>URL</th><th>Signing secret</th><th>Events</th><th>Enabled</th></tr></thead>
            <tbody>
              {props.endpoints.map((e) => (
                <tr key={e.id}>
                  <td><strong>{e.description || 'Endpoint'}</strong>
                    {e.consecutive_failures > 0 && <div className="devfail">{e.consecutive_failures} consecutive failures</div>}
                  </td>
                  <td><code>{e.url}</code></td>
                  <td>
                    <div className="devsecret">
                      <code>{shown[e.id] ? shown[e.id] : maskSecret('whsec_', 6)}</code>
                      <button className="devicon" title={shown[e.id] ? 'Hide' : 'Show'} onClick={() => void reveal(e)}>
                        <Icon name={shown[e.id] ? 'x' : 'search'} size={14} />
                      </button>
                      {shown[e.id] && (
                        <button className="devicon" title="Copy" onClick={() => copy(shown[e.id], 'Signing secret')}>
                          <Icon name="file" size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="soft">{e.events.length ? e.events.join(', ') : 'All events'}</td>
                  <td>
                    <button
                      className={`devtoggle${e.active ? ' is-on' : ''}`}
                      disabled={props.busy}
                      aria-label={e.active ? 'Disable endpoint' : 'Enable endpoint'}
                      onClick={() => props.onToggleEndpoint(e)}
                    >
                      <span className="devtoggle__knob" />
                    </button>
                  </td>
                </tr>
              ))}
              {!props.endpoints.length && (
                <tr><td colSpan={5} className="soft">
                  No endpoints. Add one to start receiving events, then check Webhooks history to see deliveries.
                </td></tr>
              )}
            </tbody>
          </table>
          <p className="soft" style={{ fontSize: 13, marginTop: 10 }}>
            Subscribing to nothing means every event. The full list is on the API documentation card above.
            {WEBHOOK_EVENTS.length > 0 && ` There are ${WEBHOOK_EVENTS.length} event types.`}
          </p>
        </Card>
      )}

      {props.canManage && (
        <p className="soft devnote">
          Scopes available when minting: {API_SCOPES.map((s) => s.id).join(', ')}.
        </p>
      )}
    </>
  );
}
