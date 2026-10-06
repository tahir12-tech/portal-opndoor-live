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
  endpointDeleteBlockedReason, keyDeleteBlockedReason,
  type DevApiKey, type DevWebhookEndpoint,
} from '@/data/devCentreService';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
import { useToast } from '@/components/ui/Toast';
import { formatDate } from '@/lib/format';

const dt = (s: string | null | undefined) =>
  s ? formatDate(s) : '--';

export function Configuration(props: {
  keys: DevApiKey[];
  endpoints: DevWebhookEndpoint[];
  canManage: boolean;          // developer or opndoor admin; management is keys-only
  busy: boolean;
  onMint: () => void;
  onRevoke: (k: DevApiKey) => void;
  /** False for an opndoor admin: no key list, no endpoint registry, no secrets. */
  canSeeCredentials: boolean;
  isAdmin: boolean;
  onBreakGlass: () => void;
  onDeleteKey: (k: DevApiKey) => void;
  onDeleteEndpoint: (e: DevWebhookEndpoint) => void;
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
    } catch (x) { toast(String((x as Error).message ?? x), 'error'); }
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

      {/* An opndoor admin gets this instead of the panels. It is deliberately
          not a disabled key table: an empty or greyed inventory still tells you
          how many keys a partner has, and the point is that we do not know. */}
      {props.isAdmin && (
        <Card>
          <CardHead title="Credentials" sub="Not visible to opndoor" />
          <CardBody>
            {/* WHAT THIS SCREEN SHOWS, EXACTLY. Matt, 2026-10-01: "say
                exactly what admin can see on that screen ... No screen
                should claim more or less than it shows."

                It said "not how many there are", which is true HERE and
                was read as a rule about the product -- the supplier's
                Integration tab prints the live count on its API access
                line. Two screens describing one boundary differently is
                how a reader stops believing either. So this one says what
                is true of this screen and names where the count is. */}
            <p>
              <strong>You cannot see this supplier&rsquo;s API keys or webhook endpoints here.</strong> Not
              the list, not the prefixes, not how many, and never a signing secret. Their developers manage
              their own credentials.
            </p>
            <p>
              <strong>You can revoke one key by its prefix</strong>, below, if you have the prefix from
              wherever it was exposed. <strong>You can never see or create a full key.</strong>
            </p>
            <p className="soft">
              How many keys are live is on the supplier&rsquo;s Integration tab, beside the API access
              switch.
            </p>
            <p className="soft">
              This is deliberate rather than an oversight. A key inventory is a target, and after an
              exposure the question &ldquo;who could have seen this&rdquo; should have a one-name answer.
              It is enforced in the database, not by this screen: the queries behind these panels refuse
              an opndoor caller outright.
            </p>
            <p className="soft">
              Everything diagnostic is still yours: Monitoring, Logs with request and response bodies,
              Webhooks history including replay, and live application metadata.
            </p>
            <div style={{ marginTop: 14 }}>
              <Button variant="primary" className="btn--danger" size="sm" onClick={props.onBreakGlass}>
                <Icon name="alert" /> Break glass: revoke a key
              </Button>
              <div className="soft" style={{ marginTop: 8, fontSize: 12.5 }}>
                For an exposed credential that cannot wait for the supplier. You will need the key prefix
                from wherever it was exposed, and a reason. Both are recorded against your name.
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {props.canSeeCredentials && (
      <Card>
        <CardHead
          title="API keys"
          sub="Shown once when created. Only a hash is stored, so the full key cannot be shown again."
          actions={props.canManage && (
            <Button variant="primary" size="sm" onClick={props.onMint}><Icon name="plus" /> Mint a key</Button>
          )}
        />
        <table className="dt">
          <thead><tr><th>Label</th><th>Key</th><th>Scopes</th><th>Created</th><th>Last used</th><th>Status</th><th>Mode</th><th /></tr></thead>
          <tbody>
            {props.keys.map((k) => (
              <tr key={k.id} className={k.revoked_at ? 'is-revoked' : ''}>
                <td><strong>{k.name}</strong></td>
                <td>
                  <div className="devsecret">
                    <code>{k.key_prefix}{'•'.repeat(20)}</code>
                    <button className="devicon" title="Copy the prefix" onClick={() => copy(k.key_prefix, 'Prefix')}>
                      <Icon name="file" />
                    </button>
                  </div>
                  <div className="soft devsecret__note">Prefix only. The key itself is not stored.</div>
                </td>
                <td className="soft">{k.scopes.join(', ') || '--'}</td>
                <td className="soft">{dt(k.created_at)}</td>
                <td className="soft">{k.last_used_at ? dt(k.last_used_at) : 'Never'}</td>
                {/* Two different questions that used to share one column. "Live" here meant
    "not revoked", which now collides with live vs sandbox mode, so the state
    column says active or revoked and the mode column says which credentials it
    carries. */}
                <td>{k.revoked_at ? <Pill variant="muted">Revoked</Pill> : <Pill variant="deed">Active</Pill>}</td>
                <td>
                  <span className={`devmode devmode--${k.livemode ? 'live' : 'sandbox'}`}>
                    {k.livemode ? 'Live' : 'Sandbox'}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <div className="devrowacts">
                    {!k.revoked_at && (
                      <Button variant="ghost" size="sm" disabled={props.busy} onClick={() => props.onRevoke(k)}>Revoke</Button>
                    )}
                    {/* Always rendered, never hidden. When delete is unavailable
                        the button says why on click rather than vanishing, because
                        a missing option sends somebody hunting for a feature that
                        is there. title carries the reason for anyone hovering. */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className={keyDeleteBlockedReason(k) ? 'is-unavailable' : undefined}
                      title={keyDeleteBlockedReason(k) ?? 'Delete this key permanently'}
                      disabled={props.busy}
                      onClick={() => props.onDeleteKey(k)}
                    >
                      <Icon name="trash" /> Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {!props.keys.length && <tr><td colSpan={8} className="soft">No keys yet.</td></tr>}
          </tbody>
        </table>
      </Card>
      )}

      {props.canManage && (
        <Card>
          <CardHead
            title="Webhook endpoints"
            sub="The signing secret can be revealed here, because signing needs it stored."
            actions={<Button variant="primary" size="sm" onClick={props.onCreateEndpoint}><Icon name="plus" /> Add endpoint</Button>}
          />
          <table className="dt">
            <thead><tr><th>Name</th><th>URL</th><th>Mode</th><th>Signing secret</th><th>Events</th><th>Enabled</th></tr></thead>
            <tbody>
              {props.endpoints.map((e) => (
                <tr key={e.id}>
                  <td><strong>{e.description || 'Endpoint'}</strong>
                    {e.consecutive_failures > 0 && <div className="devfail">{e.consecutive_failures} consecutive failures</div>}
                  </td>
                  <td><code>{e.url}</code></td>
                  {/* Pointing sandbox and live at the same URL is expected: each
                      endpoint has its own signing secret, so a receiver tells
                      them apart by which secret verifies. Without this column the
                      two rows would be indistinguishable. */}
                  <td>
                    <span className={`devmode devmode--${e.livemode ? 'live' : 'sandbox'}`}>
                      {e.livemode ? 'Live' : 'Sandbox'}
                    </span>
                  </td>
                  <td>
                    <div className="devsecret">
                      <code>{shown[e.id] ? shown[e.id] : maskSecret('whsec_', 6)}</code>
                      <button className="devicon" title={shown[e.id] ? 'Hide' : 'Show'} onClick={() => void reveal(e)}>
                        <Icon name={shown[e.id] ? 'x' : 'search'} />
                      </button>
                      {shown[e.id] && (
                        <button className="devicon" title="Copy" onClick={() => copy(shown[e.id], 'Signing secret')}>
                          <Icon name="file" />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="soft">{e.events.length ? e.events.join(', ') : 'All events'}</td>
                  <td>
                    <div className="devrowacts">
                      <button
                        className={`devtoggle${e.active ? ' is-on' : ''}`}
                        disabled={props.busy}
                        aria-label={e.active ? 'Disable endpoint' : 'Enable endpoint'}
                        onClick={() => props.onToggleEndpoint(e)}
                      >
                        <span className="devtoggle__knob" />
                      </button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={endpointDeleteBlockedReason(e) ? 'is-unavailable' : undefined}
                        title={endpointDeleteBlockedReason(e) ?? 'Delete this endpoint permanently'}
                        disabled={props.busy}
                        onClick={() => props.onDeleteEndpoint(e)}
                      >
                        <Icon name="trash" /> Delete
                      </Button>
                    </div>
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
          <CardBody style={{ paddingTop: 0 }}>
          <p className="soft" style={{ fontSize: 13, margin: 0 }}>
            Subscribing to nothing means every event. The full list is on the API documentation card above.
            {WEBHOOK_EVENTS.length > 0 && ` There are ${WEBHOOK_EVENTS.length} event types.`}
          </p>
          </CardBody>
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
