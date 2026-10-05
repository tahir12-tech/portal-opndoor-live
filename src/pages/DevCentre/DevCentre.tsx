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

   THE BANNER CARRIES ONE FACT: the key prefix decides the mode. Off production
   it carries a second, that this project reaches nothing real. Everything else
   it used to say is documentation and now lives in the getting-started guide.
   "Which project is this" and "which mode am I in" were the same question when
   sandbox was going to be a second Supabase project; they are unrelated now, and
   a banner answering both at once read as two stacked messages.

   NO SUPPLIER NAMES ON THIS SCREEN. A partner's developer sees Stripe and
   PandaDoc in the payment and signing flows, so naming those is describing their
   own integration. Our CRM and our email provider are not part of it, and naming
   them tells a partner which tools we buy. Same rule as never showing one
   partner another partner's name. The built-artefact check in REGRESSION.md
   section C enforces this.
   ===================================================================== */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  API_SCOPES, WEBHOOK_EVENTS, breakGlassRevoke, createWebhookEndpoint, deleteApiKey, deleteWebhookEndpoint,
  endpointDeleteBlockedReason, getApiKeys, keyDeleteBlockedReason, getMyPartner,
  getPartnerOptions, getWebhookEndpoints, mintApiKey, portalEnvironment, revokeApiKey,
  updateWebhookEndpoint,
  type DevApiKey, type DevMyPartner, type DevPartnerOption, type DevWebhookEndpoint,
} from '@/data/devCentreService';
import { useSession } from '@/session/SessionContext';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { FilterTabs } from '@/components/ui/FilterTabs';
import { PartnerSelect } from '@/components/ui/Select';
import { ALL_PARTNERS, getPartner } from '@/data';
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
  const { role, partnerScope } = useSession();
  const toast = useToast();
  usePageMeta('devcentre', 'Dev Centre', ['Home', 'Dev Centre']);

  const env = portalEnvironment();
  const isAdmin = role === 'superadmin';

  /*
   * AN OPNDOOR ADMIN HAS NO CREDENTIAL ACCESS.
   *
   * Not the key list, not prefixes, not the endpoint registry, and never a
   * signing secret. A key inventory is a target, and "who could have seen this
   * key" should have a one-name answer.
   *
   * They keep everything diagnostic: Monitoring, Logs with the redacted bodies,
   * Webhooks history including replay, and live application metadata.
   *
   * This flag hides the panels. It is NOT the enforcement: every dev_ RPC
   * touching keys or endpoints had its is_admin() arm removed
   * (20260811160000), so an admin calling them with fetch gets zero rows or a
   * refusal. Hiding is the courtesy; the SQL is the rule.
   */
  const canSeeCredentials = !isAdmin;
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
  // The caller's own partner, for the roles with no picker. Null for an admin,
  // who has no single home partner and reads the selected one from `partners`.
  const [myPartner, setMyPartner] = useState<DevMyPartner | null>(null);
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
  // Break-glass revoke. Deliberately its own modal rather than a row action:
  // there is no row to attach it to, because an admin cannot see the keys.
  const [bgOpen, setBgOpen] = useState(false);
  const [bgPrefix, setBgPrefix] = useState('');
  const [bgReason, setBgReason] = useState('');
  const [bgResult, setBgResult] = useState<{ ok: boolean; partner: string | null; key: string | null } | null>(null);

  async function doBreakGlass() {
    if (bgPrefix.trim().length < 10) { toast('Paste the full key prefix.', 'error'); return; }
    if (bgReason.trim().length < 10) { toast('Give a reason. It is recorded against your name.', 'error'); return; }
    setBusy(true);
    try {
      const r = await breakGlassRevoke(bgPrefix.trim(), bgReason.trim());
      setBgResult(r);
      if (r.ok) toast(`Revoked. Recorded against your name.`);
      else toast('No matching active key. The attempt has been recorded.', 'error');
    } catch (x) {
      toast(String((x as Error).message ?? x), 'error');
    } finally { setBusy(false); }
  }

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
      // An admin fetches neither. The server would return nothing anyway; not
      // asking keeps the intent visible in the client too.
      const [k, e] = await Promise.all([
        canSeeCredentials ? getApiKeys(scope) : Promise.resolve([]),
        canSeeCredentials && !keysOnly ? getWebhookEndpoints(scope) : Promise.resolve([]),
      ]);
      setKeys(k);
      setEndpoints(e as DevWebhookEndpoint[]);
    } catch (x) { setErr(String((x as Error).message ?? x)); }
  }, [isAdmin, partnerId, keysOnly, canSeeCredentials]);

  useEffect(() => { if (isAdmin) getPartnerOptions().then(setPartners).catch(() => setPartners([])); }, [isAdmin]);
  useEffect(() => { if (!isAdmin) getMyPartner().then(setMyPartner).catch(() => setMyPartner(null)); }, [isAdmin]);
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

  /*
   * WHETHER THIS PARTNER MAY HOLD API KEYS, AND WHY IT IS SAID RATHER THAN ACTED ON.
   *
   * api_access_enabled defaults false and is never backfilled, so for now this is
   * every partner. The sidebar used to respond to that by hiding the Dev Centre,
   * which took the only screen the developer role exists for away from every
   * developer, and hid it without locking it: the route guard is role-based, so
   * typing /dev-centre still worked. See constants/nav.ts.
   *
   * So the screen renders and states the position. Minting still refuses in SQL,
   * which is where the rule lives; this is the sentence that turns that refusal
   * from a confusing error into an expected one.
   *
   * === false, not a falsy test. Undefined means the flag did not load, and a
   * banner announcing API access is off is worse than no banner when we do not
   * actually know.
   */
  const selectedOption = isAdmin ? partners.find((p) => p.id === partnerId) : undefined;
  const apiOff = isAdmin
    ? (!!partnerId && selectedOption?.api_access_enabled === false)
    : myPartner?.api_access_enabled === false;
  const apiOffPartnerName = isAdmin ? selectedOption?.name : myPartner?.name;
  /* (dj) THE CHECKING SETTING OF THE ORGANISATION THESE DOCS ARE FOR.
     An admin with a supplier selected gets that supplier's; a
     supplier's own developer gets their own; an admin with nothing
     selected gets null, and the panel then shows all three rather
     than guessing. */
  const docsMode = getPartner(isAdmin ? (partnerId || ALL_PARTNERS) : partnerScope)?.referencingMode ?? null;

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

      {/* ONE THING, PLUS ONE MORE OFF PRODUCTION.
          A banner is read once, before minting a key, so it carries the single
          fact needed at that moment: the prefix decides the mode. It used to
          stack that with a paragraph about this being a disposable project,
          which is true for us and irrelevant to a supplier's developer looking
          at production, and then a third sentence listing what sandbox does not
          touch. Two of those are documentation, and they now live in the
          getting-started guide where they can be read in full. */}
      <div className={`devenv devenv--${env.id}`}>
        <Icon name={env.id === 'production' ? 'shield' : 'info'} />
        <div>
          A key&rsquo;s prefix decides the mode: <code>opnd_test_</code> creates sandbox applications,{' '}
          <code>opnd_live_</code> creates real ones. Going live is swapping the key, and nothing else changes.
          {env.id !== 'production' && (
            <div className="devenv__note">
              This project reaches nothing real. No card is charged and no tenant or agent is contacted,
              whichever key you use.
            </div>
          )}
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

      {/* Said, not hidden. The panels below stay visible so the documentation,
          the webhook catalogue and the getting-started guide are readable while
          somebody waits for API access to be switched on, which is exactly when
          a developer needs to read them. */}
      {apiOff && (
        <div className="devwarn" style={{ marginTop: 0, marginBottom: 14 }}>
          <strong>API access is off for {apiOffPartnerName ?? 'this supplier'}.</strong>{' '}
          Keys cannot be minted while it is off, and any key that already exists will be refused at
          authentication rather than only at creation. Everything else here still works: read the
          documentation, plan the integration, and ask an opndoor administrator to enable API access on the
          partner record when you are ready to build.
        </div>
      )}

      {keysOnly && (
        <p className="soft devnote">
          You can see and revoke this supplier&rsquo;s API keys so a leaked key can be killed quickly.
          Endpoints, delivery history and the documentation are for the supplier&rsquo;s developers.
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
          canManage={isDeveloper}
          canSeeCredentials={canSeeCredentials}
          onBreakGlass={() => { setBgResult(null); setBgOpen(true); }}
          isAdmin={isAdmin}
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
          {/* (dj) WHOSE SETTING. An admin viewing a supplier's Dev
              Centre must see THAT supplier's journey, so the mode is
              resolved from the partner being viewed and only falls
              back to the reader's own scope when they are reading
              their own. */}
          {panel === 'guide'
            ? <GettingStarted mode={docsMode} orgName={apiOffPartnerName ?? null} />
            : <ApiDocsPanel mode={docsMode} orgName={apiOffPartnerName ?? null} />}
        </>
      )}

      {/* ---- break glass ---- */}
      <Modal
        open={bgOpen}
        onClose={() => { setBgOpen(false); setBgResult(null); setBgPrefix(''); setBgReason(''); }}
        title="Break glass: revoke a supplier's API key"
        sub="Exceptional. Recorded against your name."
        width={640}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setBgOpen(false); setBgResult(null); }} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" className="btn--danger" onClick={() => void doBreakGlass()} disabled={busy}>
              {busy ? 'Revoking…' : 'Revoke this key'}
            </Button>
          </>
        }
      >
        <div className="sbxwarn sbxwarn--tight">
          <Icon name="alert" />
          <div>
            <strong>This stops a supplier's integration immediately.</strong>
            <p>
              Use it when a key has been exposed and the supplier's own developers cannot act quickly
              enough. They can mint a replacement themselves; you cannot do it for them.
            </p>
          </div>
        </div>

        <p className="soft">
          You cannot see this partner&rsquo;s keys, deliberately, so there is nothing to browse, and you
          can never see or create a full key. Paste the prefix from wherever the key was exposed: the
          ticket, the scanner alert, or the partner&rsquo;s message. It is the first 18 characters, like{' '}
          <code>opnd_live_XXXXXXXX</code>.
        </p>

        <Field label="Key prefix">
          <input
            type="text"
            placeholder="opnd_live_XXXXXXXX"
            autoComplete="off"
            value={bgPrefix}
            onChange={(e) => setBgPrefix(e.target.value)}
          />
        </Field>

        <Field label="Reason">
          <input
            type="text"
            placeholder="Posted in a public repository, reported by the supplier at 14:20"
            value={bgReason}
            onChange={(e) => setBgReason(e.target.value)}
          />
        </Field>

        {bgResult && (
          <div className={`devtest__verdict devtest__verdict--${bgResult.ok ? 'ok' : 'bad'}`}>
            <Icon name={bgResult.ok ? 'check' : 'alert'} />
            <div>
              <strong>
                {bgResult.ok
                  ? `Revoked "${bgResult.key}" for ${bgResult.partner}.`
                  : 'No matching active key.'}
              </strong>
              <div className="soft">
                {bgResult.ok
                  ? 'Their integration is failing now. Tell them to mint a replacement.'
                  : 'Either the prefix is wrong or the key was already revoked. The attempt has been recorded either way.'}
              </div>
            </div>
          </div>
        )}
      </Modal>

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
                      Prefix opnd_test_. Test cards, watermarked deeds, and no opndoor email to anyone.
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
            {/* NEVER a real or potential partner's name. This placeholder said
                "Rightmove production", which told any other partner's developer
                who our customers are. Invented names only, here and everywhere a
                partner can see. */}
            <Field label="Label"><input type="text" placeholder="Production integration" value={mintName} onChange={(e) => setMintName(e.target.value)} /></Field>
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
