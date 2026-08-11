/* =====================================================================
   Dev Centre — the partner integrator's screen.

   Four tabs, following PandaDoc's Dev Center: Monitoring (the landing tab),
   Logs, Webhooks history, and Configuration. The getting-started guide and the
   generated API documentation sit behind cards on Configuration rather than
   being tabs of their own, as PandaDoc does.

   SANDBOX AND LIVE ARE ONE SYSTEM, as PandaDoc and Stripe do it. An earlier
   version of this file said the opposite, because the plan was two Supabase
   projects; that was abandoned in favour of a livemode flag inside the live
   system, so keys, endpoints and applications for both modes are listed side by
   side here and each says which it is. A developer rehearses against a sandbox
   key and then swaps it for a live one with nothing else changing.

   WHO SEES WHAT. Developer and opndoor admin see everything. Management sees the
   API keys panel ONLY, and only so a leaked key can be killed by whoever notices
   rather than waiting for the developer who may have left. That is a deliberate
   departure from "the tab is for developers and opndoor admin": revoke has to be
   reachable or it is not a control.

   The tab is not a security boundary. Every RPC scopes itself (20260810220000)
   and the Edge Function re-checks the role with a caller-scoped client. This
   file decides what to render, not what is permitted.

   THE BANNER SAYS WHICH PROJECT, NOT WHICH MODE. Those were the same question
   when sandbox was going to be a second Supabase project. They are unrelated
   now: sandbox and live sit side by side in one database, told apart by
   livemode and by the key prefix, and both are listed on every tab here.
   ===================================================================== */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  API_SCOPES, WEBHOOK_EVENTS, createWebhookEndpoint, deleteApiKey, deleteWebhookEndpoint,
  endpointDeleteBlockedReason, getApiKeys, keyDeleteBlockedReason,
  getPartnerOptions, getWebhookEndpoints, mintApiKey, portalEnvironment, revokeApiKey,
  updateWebhookEndpoint,
  type DevApiKey, type DevPartnerOption, type DevWebhookEndpoint,
} from '@/data/devCentreService';
import { useSession } from '@/session/SessionContext';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { FilterTabs } from '@/components/ui/FilterTabs';
import { PartnerSelect } from '@/components/ui/Select';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { ApiDocsPanel } from './ApiDocsPanel';
import { Configuration } from './Configuration';
import { Logs } from './Logs';
import { Monitoring } from './Monitoring';
import { LiveApplications } from './LiveApplications';
import { Sandbox } from './Sandbox';
import { WebhookHistory } from './WebhookHistory';
import { GettingStarted } from './GettingStarted';
import './DevCentre.css';

type Tab = 'monitoring' | 'logs' | 'webhooks' | 'applications' | 'sandbox' | 'config';

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
  // Sandbox is the default for a NEW key, which is the opposite of the default
  // for the livemode column and deliberately so. A column default protects data
  // already in flight, so it fails towards live; a form default is a suggestion
  // to a human starting an integration, and the safe suggestion there is the one
  // that cannot charge anybody. The server accepts no default either way.
  const [mintLive, setMintLive] = useState(false);
  const [mintedKey, setMintedKey] = useState<string | null>(null);

  // endpoint modal
  const [epOpen, setEpOpen] = useState(false);
  const [epUrl, setEpUrl] = useState('');
  const [epEvents, setEpEvents] = useState<string[]>([]);
  const [epLive, setEpLive] = useState(false);

  /* One confirmation model for every destructive action on this screen.
     Previously revoke used the browser's native confirm(), which is the same
     class of mistake as the bare selects: a new panel not picking up a
     convention the rest of the app already has. It also cannot be styled,
     cannot show a count, and on some browsers is suppressed entirely, which
     would have made revoke silently do nothing. */
  const [confirmAsk, setConfirmAsk] = useState<{
    title: string;
    body: ReactNode;
    confirmLabel: string;
    run: () => Promise<void>;
  } | null>(null);

  async function runConfirm() {
    if (!confirmAsk) return;
    setBusy(true);
    try {
      await confirmAsk.run();
      setConfirmAsk(null);
    } catch (x) {
      toast(String((x as Error).message ?? x), 'error');
    } finally {
      setBusy(false);
    }
  }
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
        // Applications and Sandbox sit together, after the three observability
        // tabs, because they are data rather than diagnosis. Live comes first:
        // once an integration is live, "did my POST land" is asked far more often
        // than anything about sandbox.
        { id: 'applications', label: 'Applications' },
        { id: 'sandbox', label: 'Sandbox' },
        { id: 'config', label: 'Configuration' },
      ];

  async function doMint() {
    const target = isAdmin ? partnerId : 'self';
    if (isAdmin && !target) { toast('Choose a partner first.'); return; }
    if (!mintName.trim()) { toast('Give the key a label.', 'error'); return; }
    if (!mintScopes.length) { toast('Choose at least one scope.', 'error'); return; }
    setBusy(true);
    try {
      const r = await mintApiKey({ partnerId: isAdmin ? partnerId : '', name: mintName.trim(), scopes: mintScopes, livemode: mintLive });
      setMintedKey(r.key);          // shown once, right here, and never again
      setMintName('');
      await load();
    } catch (x) { toast(String((x as Error).message ?? x), 'error'); }
    finally { setBusy(false); }
  }

  function doRevoke(k: DevApiKey) {
    setConfirmAsk({
      title: `Revoke ${k.name}?`,
      confirmLabel: 'Revoke key',
      body: (
        <>
          <p>
            Any integration using this key stops working <strong>immediately</strong>. If it is in
            production, requests will start failing as soon as you confirm.
          </p>
          <p className="soft">
            The key is kept, greyed out, so the record of what it did survives. It cannot be
            un-revoked: mint a new one and swap it in.
          </p>
        </>
      ),
      run: async () => { await revokeApiKey(k.id); toast(`Revoked ${k.name}.`); await load(); },
    });
  }

  function doDeleteKey(k: DevApiKey) {
    const blocked = keyDeleteBlockedReason(k);
    if (blocked) { toast(blocked, 'error'); return; }
    setConfirmAsk({
      title: `Delete ${k.name}?`,
      confirmLabel: 'Delete key',
      body: (
        <>
          <p>
            This removes the key entirely. <strong>It cannot be undone.</strong>
          </p>
          <p className="soft">
            Offered because this key has never been used and has made no requests, so there is no
            history to lose. A key that has been used can only be revoked.
          </p>
        </>
      ),
      run: async () => { await deleteApiKey(k.id); toast(`Deleted ${k.name}.`); await load(); },
    });
  }

  function doDeleteEndpoint(e: DevWebhookEndpoint) {
    const blocked = endpointDeleteBlockedReason(e);
    if (blocked) { toast(blocked, 'error'); return; }
    setConfirmAsk({
      title: 'Delete this endpoint?',
      confirmLabel: 'Delete endpoint',
      body: (
        <>
          <p>
            <code>{e.url}</code> will be removed entirely, along with its signing secret.{' '}
            <strong>It cannot be undone.</strong>
          </p>
          <p className="soft">
            Offered because nothing has ever been delivered to it, so there is no history to lose.
            An endpoint with deliveries can only be disabled.
          </p>
        </>
      ),
      run: async () => { await deleteWebhookEndpoint(e.id); toast('Endpoint deleted.'); await load(); },
    });
  }

  async function doCreateEndpoint() {
    if (!epUrl.startsWith('https://')) { toast('The URL must use https.', 'error'); return; }
    setBusy(true);
    try {
      const r = await createWebhookEndpoint({ partnerId: isAdmin ? partnerId : '', url: epUrl.trim(), events: epEvents, livemode: epLive });
      setEpSecret(r.secret);        // shown once
      setEpUrl('');
      await load();
    } catch (x) { toast(String((x as Error).message ?? x), 'error'); }
    finally { setBusy(false); }
  }

  async function toggleEndpoint(e: DevWebhookEndpoint) {
    setBusy(true);
    try { await updateWebhookEndpoint(e.id, { active: !e.active }); await load(); }
    catch (x) { toast(String((x as Error).message ?? x), 'error'); }
    finally { setBusy(false); }
  }

  // Developers are pinned to their own partner; an admin picks. One value, so no
  // tab can accidentally query across partners.
  const scopedPartner = isAdmin ? (partnerId || null) : null;

  return (
    <>
      <div className="page-head">
        <div>
          <Eyebrow>Integration</Eyebrow>
          <h1 className="page-head__title" style={{ marginTop: 10 }}>Dev Centre</h1>
          <p className="page-head__sub">
            API keys, webhook endpoints, delivery history and the documentation for the partner API.
          </p>
        </div>
      </div>

      {/* Which project this deployment is. Deliberately loud, but it is no longer
          the answer to "am I in sandbox": that is per key, per endpoint and per
          application now, and it is shown on each row. */}
      <div className={`devenv devenv--${env.id}`}>
        <Icon name={env.id === 'production' ? 'shield' : 'info'} />
        <div>
          <strong>{env.label}.</strong>{' '}
          {env.id === 'production'
            ? 'Live keys minted here move real money and issue real deeds.'
            : 'A disposable project. Nothing here reaches a real tenant, an agent or a real card, whichever mode you use.'}
          <div className="devenv__note">
            Sandbox and live are <strong>both here</strong>, in this one database. A key&rsquo;s prefix says which
            it is: <code>opnd_test_</code> creates sandbox applications, <code>opnd_live_</code> creates real
            ones. Sandbox uses sandbox Stripe and PandaDoc credentials, sends no opndoor email and never reaches
            HubSpot, and its applications appear on the Sandbox tab and nowhere else in the portal. Going live is
            swapping the key, and nothing else.
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="devpartner">
          <Icon name="shield" /> Partner:{' '}
          <PartnerSelect
            ariaLabel="Partner"
            value={partnerId}
            onChange={setPartnerId}
            options={[{ value: '', label: 'All partners' }, ...partners.map((p) => ({ value: p.id, label: p.name }))]}
          />
          {!partnerId && <span className="soft"> Choose one to mint a key or add an endpoint.</span>}
        </div>
      )}

      {keysOnly && (
        <p className="soft devnote">
          You can see and revoke this partner&rsquo;s API keys so a leaked key can be killed quickly.
          Endpoints, delivery history and the documentation are for the partner&rsquo;s developers.
        </p>
      )}

      {/* The app's own tab component, so these look and behave like the filter
          tabs on Applications rather than a second bespoke tab strip. */}
      <div style={{ marginBottom: 16 }}>
        <FilterTabs tabs={tabs} active={tab} onChange={(id) => setTab(id as Tab)} />
      </div>

      {err && <div className="devalert">{err}</div>}

      {tab === 'monitoring' && <Monitoring partnerId={scopedPartner} />}
      {tab === 'logs' && <Logs partnerId={scopedPartner} />}
      {tab === 'webhooks' && <WebhookHistory partnerId={scopedPartner} />}
      {tab === 'applications' && <LiveApplications partnerId={scopedPartner} />}
      {tab === 'sandbox' && <Sandbox partnerId={scopedPartner} />}

      {tab === 'config' && panel === 'none' && (
        <Configuration
          keys={keys}
          endpoints={endpoints}
          canManage={isDeveloper || isAdmin}
          busy={busy}
          onMint={() => { setMintedKey(null); setMintOpen(true); }}
          onRevoke={(k) => doRevoke(k)}
          onDeleteKey={(k) => doDeleteKey(k)}
          onDeleteEndpoint={(e) => doDeleteEndpoint(e)}
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
          {panel === 'guide' ? <GettingStarted /> : <ApiDocsPanel />}
        </>
      )}

      {/* ---- one confirmation modal for every destructive action ---- */}
      <Modal
        open={!!confirmAsk}
        onClose={() => setConfirmAsk(null)}
        title={confirmAsk?.title ?? ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmAsk(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" className="btn--danger" onClick={() => void runConfirm()} disabled={busy}>
              {busy ? 'Working…' : confirmAsk?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      >
        {confirmAsk?.body}
      </Modal>

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
            {/* Mode first, above the label and the scopes. It is the decision
                with consequences: a live key charges real cards, and it is the
                one thing about a key that cannot be changed afterwards. Reusing
                the .devscope styling so this reads as the same kind of choice as
                the scope list below it rather than a stray pair of radios. */}
            <Field label="Mode">
              <div className="devscopes">
                <label className={`devscope${!mintLive ? ' is-sel' : ''}`}>
                  <input type="radio" name="mintmode" checked={!mintLive} onChange={() => setMintLive(false)} />
                  <div>
                    <div className="devscope__name">Sandbox</div>
                    <div className="devscope__desc">
                      Prefix opnd_test_. Test cards, watermarked deeds, no HubSpot and no opndoor email.
                      Nothing it creates is visible outside the Dev Centre.
                    </div>
                  </div>
                </label>
                <label className={`devscope${mintLive ? ' is-sel' : ''}`}>
                  <input type="radio" name="mintmode" checked={mintLive} onChange={() => setMintLive(true)} />
                  <div>
                    <div className="devscope__name">Live</div>
                    <div className="devscope__desc">
                      Prefix opnd_live_. Real cards, real deeds, real email to tenants and agents, and real
                      commission.
                    </div>
                  </div>
                </label>
              </div>
            </Field>
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
            {/* Sandbox and live are separate endpoint registries. Pointing both
                at the SAME url is fine and expected: each endpoint gets its own
                signing secret, so a receiver tells them apart by which secret
                verifies, or by the livemode field in the payload. */}
            <Field label="Mode">
              <div className="devscopes">
                <label className={`devscope${!epLive ? ' is-sel' : ''}`}>
                  <input type="radio" name="epmode" checked={!epLive} onChange={() => setEpLive(false)} />
                  <div>
                    <div className="devscope__name">Sandbox</div>
                    <div className="devscope__desc">Receives events from sandbox applications only.</div>
                  </div>
                </label>
                <label className={`devscope${epLive ? ' is-sel' : ''}`}>
                  <input type="radio" name="epmode" checked={epLive} onChange={() => setEpLive(true)} />
                  <div>
                    <div className="devscope__name">Live</div>
                    <div className="devscope__desc">Receives events from real applications.</div>
                  </div>
                </label>
              </div>
            </Field>
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
