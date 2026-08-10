/* =====================================================================
   Dev Centre — the partner integrator's screen.

   Four tabs, following PandaDoc's Dev Center: Monitoring (the landing tab),
   Logs, Webhooks history, and Configuration. The getting-started guide and the
   generated API documentation sit behind cards on Configuration rather than
   being tabs of their own, as PandaDoc does.

   ONE HONEST DIFFERENCE FROM PANDADOC. They list sandbox and production keys
   side by side, because theirs is one system with two kinds of key. Ours are two
   SEPARATE PROJECTS with separate databases, so this Dev Centre can only ever
   see its own: there is no cross-project plumbing and deliberately so. The
   banner says which environment this is and where the other set lives, because
   the failure mode is somebody hunting for keys that were never going to be
   here.

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
import { useCallback, useEffect, useState } from 'react';
import {
  API_SCOPES, WEBHOOK_EVENTS, createWebhookEndpoint, getApiKeys,
  getPartnerOptions, getWebhookEndpoints, mintApiKey, portalEnvironment, revokeApiKey,
  updateWebhookEndpoint,
  type DevApiKey, type DevPartnerOption, type DevWebhookEndpoint,
} from '@/data/devCentreService';
import { useSession } from '@/session/SessionContext';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { ApiDocsPanel } from './ApiDocsPanel';
import { Configuration } from './Configuration';
import { Logs } from './Logs';
import { Monitoring } from './Monitoring';
import { WebhookHistory } from './WebhookHistory';
import { GettingStarted } from './GettingStarted';
import './DevCentre.css';

type Tab = 'monitoring' | 'logs' | 'webhooks' | 'config';

export function DevCentre() {
  const { role } = useSession();
  const toast = useToast();
  usePageMeta('devcentre', 'Dev Centre', ['Home', 'Dev Centre']);

  const env = portalEnvironment();
  const isAdmin = role === 'superadmin';
  const isDeveloper = role === 'developer';
  // Management reaches this screen for one reason only.
  const keysOnly = role === 'management';

  // Monitoring is the landing tab: the first question is "is it working", and
  // only then "what happened to this one call".
  const [tab, setTab] = useState<Tab>(keysOnly ? 'config' : 'monitoring');
  // Getting started and the docs open from Configuration rather than being tabs.
  const [panel, setPanel] = useState<'none' | 'guide' | 'docs'>('none');
  const [partners, setPartners] = useState<DevPartnerOption[]>([]);
  const [partnerId, setPartnerId] = useState<string>('');
  const [keys, setKeys] = useState<DevApiKey[]>([]);
  const [endpoints, setEndpoints] = useState<DevWebhookEndpoint[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const tabs: { id: Tab; label: string }[] = keysOnly
    ? [{ id: 'config', label: 'Configuration' }]
    : [
        { id: 'monitoring', label: 'Monitoring' },
        { id: 'logs', label: 'Logs' },
        { id: 'webhooks', label: 'Webhooks history' },
        { id: 'config', label: 'Configuration' },
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

  // Developers are pinned to their own partner; an admin picks. One value, so no
  // tab can accidentally query across partners.
  const scopedPartner = isAdmin ? (partnerId || null) : null;

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
            ? 'Keys minted here move real money and issue real deeds. This Dev Centre shows LIVE keys, endpoints and history only.'
            : 'Keys minted here are sandbox keys. Nothing here moves real money. This Dev Centre shows SANDBOX keys, endpoints and history only.'}
          <div className="devenv__note">
            Sandbox and live are separate projects with separate databases, so neither can show the other&rsquo;s
            keys, endpoints or delivery history. For the {env.id === 'live' ? 'sandbox' : 'live'} set, sign in to
            the {env.id === 'live' ? 'sandbox' : 'live'} portal. Nothing is missing here; it was never going to be
            in one place.
          </div>
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

      {tab === 'monitoring' && <Monitoring partnerId={scopedPartner} />}
      {tab === 'logs' && <Logs partnerId={scopedPartner} />}
      {tab === 'webhooks' && <WebhookHistory partnerId={scopedPartner} />}

      {tab === 'config' && panel === 'none' && (
        <Configuration
          keys={keys}
          endpoints={endpoints}
          canManage={isDeveloper || isAdmin}
          busy={busy}
          onMint={() => { setMintedKey(null); setMintOpen(true); }}
          onRevoke={(k) => void doRevoke(k)}
          onCreateEndpoint={() => { setEpSecret(null); setEpOpen(true); }}
          onToggleEndpoint={(e) => void toggleEndpoint(e)}
          onOpenGuide={() => setPanel('guide')}
          onOpenDocs={() => setPanel('docs')}
        />
      )}

      {tab === 'config' && panel !== 'none' && (
        <>
          <Button variant="ghost" size="sm" onClick={() => setPanel('none')}>
            <Icon name="arrowLeft" /> Back to configuration
          </Button>
          <div style={{ height: 12 }} />
          {panel === 'guide' ? <GettingStarted env={env.id} /> : <ApiDocsPanel />}
        </>
      )}

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
