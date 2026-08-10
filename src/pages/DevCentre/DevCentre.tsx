/* =====================================================================
   Dev Centre — the partner integrator's screen.

   Five panels: API keys, webhook endpoints, delivery history, the API
   documentation generated from PARTNER-API.md, and a getting-started guide.

   WHO SEES WHAT. Developer and opndoor admin see everything. Management sees the
   API keys panel ONLY, and only so a leaked key can be killed by whoever notices
   rather than waiting for the developer who may have left. That is a deliberate
   departure from "the tab is for developers and opndoor admin": revoke has to be
   reachable or it is not a control.

   The tab is not a security boundary. Every RPC scopes itself (20260810220000)
   and the Edge Function re-checks the role with a caller-scoped client. This
   file decides what to render, not what is permitted.

   ENVIRONMENT IS SHOWN LOUDLY. Sandbox and live are separate projects with
   separate keys and separate delivery history. A partner reading sandbox
   deliveries while debugging live is a long, confusing afternoon.
   ===================================================================== */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  API_SCOPES, WEBHOOK_EVENTS, createWebhookEndpoint, deliveryState, getApiKeys, getDeliveries,
  getPartnerOptions, getWebhookEndpoints, mintApiKey, portalEnvironment, revokeApiKey,
  updateWebhookEndpoint,
  type DevApiKey, type DevDelivery, type DevPartnerOption, type DevWebhookEndpoint,
} from '@/data/devCentreService';
import { useSession } from '@/session/SessionContext';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Card, CardHead } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Pill } from '@/components/ui/Pill';
import { useToast } from '@/components/ui/Toast';
import { ApiDocsPanel } from './ApiDocsPanel';
import { GettingStarted } from './GettingStarted';
import './DevCentre.css';

type Tab = 'keys' | 'endpoints' | 'deliveries' | 'docs' | 'start';

const dt = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '--';

export function DevCentre() {
  const { role } = useSession();
  const toast = useToast();
  usePageMeta('devcentre', 'Dev Centre', ['Home', 'Dev Centre']);

  const env = portalEnvironment();
  const isAdmin = role === 'superadmin';
  const isDeveloper = role === 'developer';
  // Management reaches this screen for one reason only.
  const keysOnly = role === 'management';

  const [tab, setTab] = useState<Tab>('keys');
  const [partners, setPartners] = useState<DevPartnerOption[]>([]);
  const [partnerId, setPartnerId] = useState<string>('');
  const [keys, setKeys] = useState<DevApiKey[]>([]);
  const [endpoints, setEndpoints] = useState<DevWebhookEndpoint[]>([]);
  const [deliveries, setDeliveries] = useState<DevDelivery[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // delivery filters
  const [fEndpoint, setFEndpoint] = useState('');
  const [fEvent, setFEvent] = useState('');

  // mint modal
  const [mintOpen, setMintOpen] = useState(false);
  const [mintName, setMintName] = useState('');
  const [mintScopes, setMintScopes] = useState<string[]>(['applications:write', 'orgs:read']);
  const [mintedKey, setMintedKey] = useState<string | null>(null);

  // endpoint modal
  const [epOpen, setEpOpen] = useState(false);
  const [epUrl, setEpUrl] = useState('');
  const [epEvents, setEpEvents] = useState<string[]>([]);
  const [epSecret, setEpSecret] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const scope = isAdmin ? (partnerId || null) : null;
      const [k, e] = await Promise.all([getApiKeys(scope), keysOnly ? Promise.resolve([]) : getWebhookEndpoints(scope)]);
      setKeys(k);
      setEndpoints(e as DevWebhookEndpoint[]);
    } catch (x) { setErr(String((x as Error).message ?? x)); }
  }, [isAdmin, partnerId, keysOnly]);

  useEffect(() => { if (isAdmin) getPartnerOptions().then(setPartners).catch(() => setPartners([])); }, [isAdmin]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (tab !== 'deliveries' || keysOnly) return;
    getDeliveries({
      partnerId: isAdmin ? (partnerId || null) : null,
      endpointId: fEndpoint || null,
      eventType: fEvent || null,
    }).then(setDeliveries).catch((x) => setErr(String(x.message ?? x)));
  }, [tab, fEndpoint, fEvent, partnerId, isAdmin, keysOnly]);

  const tabs: { id: Tab; label: string }[] = keysOnly
    ? [{ id: 'keys', label: 'API keys' }]
    : [
        { id: 'keys', label: 'API keys' },
        { id: 'endpoints', label: 'Webhook endpoints' },
        { id: 'deliveries', label: 'Delivery history' },
        { id: 'docs', label: 'API documentation' },
        { id: 'start', label: 'Getting started' },
      ];

  async function doMint() {
    const target = isAdmin ? partnerId : 'self';
    if (isAdmin && !target) { toast('Choose a partner first.'); return; }
    if (!mintName.trim()) { toast('Give the key a label.'); return; }
    if (!mintScopes.length) { toast('Choose at least one scope.'); return; }
    setBusy(true);
    try {
      const r = await mintApiKey({ partnerId: isAdmin ? partnerId : '', name: mintName.trim(), scopes: mintScopes });
      setMintedKey(r.key);          // shown once, right here, and never again
      setMintName('');
      await load();
    } catch (x) { toast(String((x as Error).message ?? x)); }
    finally { setBusy(false); }
  }

  async function doRevoke(k: DevApiKey) {
    if (!confirm(`Revoke "${k.name}"? Any integration using it stops working immediately, and this cannot be undone.`)) return;
    setBusy(true);
    try { await revokeApiKey(k.id); toast(`Revoked ${k.name}.`); await load(); }
    catch (x) { toast(String((x as Error).message ?? x)); }
    finally { setBusy(false); }
  }

  async function doCreateEndpoint() {
    if (!epUrl.startsWith('https://')) { toast('The URL must use https.'); return; }
    setBusy(true);
    try {
      const r = await createWebhookEndpoint({ partnerId: isAdmin ? partnerId : '', url: epUrl.trim(), events: epEvents });
      setEpSecret(r.secret);        // shown once
      setEpUrl('');
      await load();
    } catch (x) { toast(String((x as Error).message ?? x)); }
    finally { setBusy(false); }
  }

  async function toggleEndpoint(e: DevWebhookEndpoint) {
    setBusy(true);
    try { await updateWebhookEndpoint(e.id, { active: !e.active }); await load(); }
    catch (x) { toast(String((x as Error).message ?? x)); }
    finally { setBusy(false); }
  }

  const endpointById = useMemo(
    () => new Map(endpoints.map((e) => [e.id, e])), [endpoints],
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow"><span className="eyebrow__dot" /><span>Integration</span></div>
          <h1 className="page-head__title" style={{ marginTop: 10 }}>Dev Centre</h1>
          <p className="page-head__sub">
            API keys, webhook endpoints, delivery history and the documentation for the partner API.
          </p>
        </div>
      </div>

      {/* Environment. Deliberately the loudest thing on the page. */}
      <div className={`devenv devenv--${env.id}`}>
        <Icon name={env.id === 'live' ? 'shield' : 'info'} />
        <div>
          <strong>{env.label} environment.</strong>{' '}
          {env.id === 'live'
            ? 'Keys minted here move real money and issue real deeds. Sandbox keys will not work against this portal, and these will not work against sandbox.'
            : 'Keys minted here are sandbox keys and are separate from live. Nothing here moves real money. Sign in to the live portal for live keys.'}
        </div>
      </div>

      {isAdmin && (
        <div className="devpartner">
          <Icon name="shield" /> Partner:{' '}
          <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
            <option value="">All partners</option>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {!partnerId && <span className="soft"> Choose one to mint a key or add an endpoint.</span>}
        </div>
      )}

      {keysOnly && (
        <p className="soft devnote">
          You can see and revoke this partner&rsquo;s API keys so a leaked key can be killed quickly.
          Endpoints, delivery history and the documentation are for the partner&rsquo;s developers.
        </p>
      )}

      <div className="devtabs">
        {tabs.map((t) => (
          <button key={t.id} className={`devtab${tab === t.id ? ' is-sel' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {err && <div className="devalert">{err}</div>}

      {tab === 'keys' && (
        <Card>
          <CardHead
            title="API keys"
            sub="A key is shown once when it is created and cannot be recovered afterwards."
            actions={(isDeveloper || isAdmin) && (
              <Button variant="primary" size="sm" onClick={() => { setMintedKey(null); setMintOpen(true); }}>
                <Icon name="plus" /> Mint a key
              </Button>
            )}
          />
          <table className="dt">
            <thead>
              <tr><th>Label</th><th>Prefix</th><th>Scopes</th><th>Created</th><th>Last used</th><th>Expires</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className={k.revoked_at ? 'is-revoked' : ''}>
                  <td><strong>{k.name}</strong></td>
                  <td><code>{k.key_prefix}…</code></td>
                  <td className="soft">{k.scopes.join(', ') || '--'}</td>
                  <td className="soft">{dt(k.created_at)}</td>
                  <td className="soft">{k.last_used_at ? dt(k.last_used_at) : 'Never'}</td>
                  <td className="soft">{k.expires_at ? dt(k.expires_at) : 'No expiry'}</td>
                  <td>{k.revoked_at ? <Pill variant="muted">Revoked</Pill> : <Pill variant="deed">Live</Pill>}</td>
                  <td style={{ textAlign: 'right' }}>
                    {!k.revoked_at && (
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void doRevoke(k)}>Revoke</Button>
                    )}
                  </td>
                </tr>
              ))}
              {!keys.length && <tr><td colSpan={8} className="soft">No keys yet.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'endpoints' && (
        <Card>
          <CardHead
            title="Webhook endpoints"
            sub="The signing secret is shown once, when the endpoint is created."
            actions={<Button variant="primary" size="sm" onClick={() => { setEpSecret(null); setEpOpen(true); }}><Icon name="plus" /> Add endpoint</Button>}
          />
          <table className="dt">
            <thead><tr><th>URL</th><th>Events</th><th>Last success</th><th>Failures</th><th>Status</th><th /></tr></thead>
            <tbody>
              {endpoints.map((e) => (
                <tr key={e.id}>
                  <td><code>{e.url}</code></td>
                  <td className="soft">{e.events.length ? e.events.join(', ') : 'All events'}</td>
                  <td className="soft">{dt(e.last_success_at)}</td>
                  <td className="soft">{e.consecutive_failures || 0}</td>
                  <td>{e.active ? <Pill variant="deed">Active</Pill> : <Pill variant="muted">Inactive</Pill>}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => void toggleEndpoint(e)}>
                      {e.active ? 'Deactivate' : 'Activate'}
                    </Button>
                  </td>
                </tr>
              ))}
              {!endpoints.length && <tr><td colSpan={6} className="soft">No endpoints yet.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'deliveries' && (
        <Card>
          <CardHead
            title="Delivery history"
            sub="What was sent, where, and what happened. Start here when an event is not arriving."
            actions={
              <div style={{ display: 'flex', gap: 8 }}>
                <select value={fEndpoint} onChange={(e) => setFEndpoint(e.target.value)}>
                  <option value="">Every endpoint</option>
                  {endpoints.map((e) => <option key={e.id} value={e.id}>{e.url}</option>)}
                </select>
                <select value={fEvent} onChange={(e) => setFEvent(e.target.value)}>
                  <option value="">Every event</option>
                  {WEBHOOK_EVENTS.map((e) => <option key={e.id} value={e.id}>{e.id}</option>)}
                </select>
              </div>
            }
          />
          <table className="dt">
            <thead><tr><th>When</th><th>Event</th><th>Reference</th><th>Endpoint</th><th>Attempts</th><th>Response</th><th>State</th></tr></thead>
            <tbody>
              {deliveries.map((d) => {
                const s = deliveryState(d);
                return (
                  <tr key={d.id}>
                    <td className="soft">{dt(d.created_at)}</td>
                    <td><code>{d.event_type}</code></td>
                    <td>{d.guarantee_ref ?? '--'}</td>
                    <td className="soft">{endpointById.get(d.endpoint_id)?.url ?? d.endpoint_url}</td>
                    <td className="soft">{d.attempts}</td>
                    <td className="soft">
                      {d.last_status ?? '--'}
                      {d.last_error && <div className="devfail" title={d.last_error}>{d.last_error.slice(0, 80)}</div>}
                    </td>
                    <td><span className={`devstate devstate--${s.tone}`}>{s.label}</span></td>
                  </tr>
                );
              })}
              {!deliveries.length && (
                <tr><td colSpan={7} className="soft">
                  No deliveries. If you expected some, check that an endpoint is active and subscribed to that event.
                </td></tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'docs' && <ApiDocsPanel />}
      {tab === 'start' && <GettingStarted env={env.id} />}

      {/* ---- mint modal ---- */}
      <Modal
        open={mintOpen}
        onClose={() => { setMintOpen(false); setMintedKey(null); }}
        title="Mint an API key"
        sub={`${env.label} environment`}
        footer={mintedKey
          ? <Button variant="primary" onClick={() => { setMintOpen(false); setMintedKey(null); }}>Done</Button>
          : <><Button variant="ghost" onClick={() => setMintOpen(false)}>Cancel</Button>
             <Button variant="primary" onClick={() => void doMint()} disabled={busy}>Mint key</Button></>}
      >
        {mintedKey ? (
          <>
            <div className="devkeybox">
              <code>{mintedKey}</code>
              <Button variant="ghost" size="sm" onClick={() => { void navigator.clipboard?.writeText(mintedKey); toast('Copied.'); }}>Copy</Button>
            </div>
            <div className="devwarn">
              <strong>Copy this now. It cannot be shown again.</strong> Only a hash is stored, so nobody,
              including opndoor, can recover it. If it is lost, revoke this key and mint another.
            </div>
          </>
        ) : (
          <>
            <Field label="Label"><input type="text" placeholder="Rightmove production" value={mintName} onChange={(e) => setMintName(e.target.value)} /></Field>
            <Field label="Scopes">
              <div className="devscopes">
                {API_SCOPES.map((s) => (
                  <label key={s.id} className={`devscope${mintScopes.includes(s.id) ? ' is-sel' : ''}`}>
                    <input
                      type="checkbox"
                      checked={mintScopes.includes(s.id)}
                      onChange={(e) => setMintScopes((prev) => e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id))}
                    />
                    <div><div className="devscope__name">{s.label}</div><div className="devscope__desc">{s.desc}</div></div>
                  </label>
                ))}
              </div>
            </Field>
          </>
        )}
      </Modal>

      {/* ---- endpoint modal ---- */}
      <Modal
        open={epOpen}
        onClose={() => { setEpOpen(false); setEpSecret(null); }}
        title="Add a webhook endpoint"
        sub={`${env.label} environment`}
        footer={epSecret
          ? <Button variant="primary" onClick={() => { setEpOpen(false); setEpSecret(null); }}>Done</Button>
          : <><Button variant="ghost" onClick={() => setEpOpen(false)}>Cancel</Button>
             <Button variant="primary" onClick={() => void doCreateEndpoint()} disabled={busy}>Add endpoint</Button></>}
      >
        {epSecret ? (
          <>
            <div className="devkeybox"><code>{epSecret}</code>
              <Button variant="ghost" size="sm" onClick={() => { void navigator.clipboard?.writeText(epSecret); toast('Copied.'); }}>Copy</Button>
            </div>
            <div className="devwarn">
              <strong>Copy this signing secret now. It cannot be shown again.</strong> You need it to verify
              the <code>X-Opndoor-Signature</code> header on every delivery. See Getting started.
            </div>
          </>
        ) : (
          <>
            <Field label="URL"><input type="text" placeholder="https://your-system.example/opndoor/webhooks" value={epUrl} onChange={(e) => setEpUrl(e.target.value)} /></Field>
            <Field label="Events">
              <div className="devscopes">
                {WEBHOOK_EVENTS.map((ev) => (
                  <label key={ev.id} className={`devscope${epEvents.includes(ev.id) ? ' is-sel' : ''}`}>
                    <input
                      type="checkbox"
                      checked={epEvents.includes(ev.id)}
                      onChange={(e) => setEpEvents((prev) => e.target.checked ? [...prev, ev.id] : prev.filter((x) => x !== ev.id))}
                    />
                    <div><div className="devscope__name">{ev.id}</div><div className="devscope__desc">{ev.desc}</div></div>
                  </label>
                ))}
              </div>
              <p className="soft" style={{ fontSize: 13, marginTop: 6 }}>Subscribe to nothing and you receive every event.</p>
            </Field>
          </>
        )}
      </Modal>
    </>
  );
}
