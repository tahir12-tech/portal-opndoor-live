/* =====================================================================
   THE API ACCESS SWITCH, WHERE THE KEYS IT BREAKS ARE.

   Matt, 2026-10-01: "Supplier Integration tab: add the API access on/off
   switch here (moved from Settings), with a confirmation that says how
   many active API keys will stop working if it's turned off."

   IT USED TO BE A TICKBOX ON A MODAL with the warning in grey text
   beside it, which meant the sentence that matters -- "this stops N live
   keys working, now, not just new ones" -- was read while looking at a
   list of unrelated settings, and acted on by pressing Save at the
   bottom. Here it is the only thing being changed, the count is read
   fresh when the switch is flipped, and turning it OFF asks.

   TURNING IT ON DOES NOT ASK. Nothing breaks: no key starts working that
   was not already issued, and the partner's developer still has to mint
   one. A confirmation on a harmless action is how people learn to press
   through the one that is not.
   ===================================================================== */
import { useEffect, useState } from 'react';
import {
  getPartner, partnerActiveKeyCount, updatePartnerSettings,
  type PartnerSettingsInput, type PartnerStatus,
} from '@/data';
import { Button } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { useToast } from '@/components/ui/Toast';

export function ApiAccessSwitch({ slug, canEdit, onChanged }: {
  slug: string;
  canEdit: boolean;
  onChanged?: () => void;
}) {
  const toast = useToast();
  const { ask, confirmEl } = useConfirm();
  const [keys, setKeys] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const p = getPartner(slug);
  const on = p?.apiAccessEnabled === true;

  useEffect(() => {
    let cancelled = false;
    void partnerActiveKeyCount(slug)
      .then((n) => { if (!cancelled) setKeys(n); })
      .catch(() => { if (!cancelled) setKeys(null); });
    return () => { cancelled = true; };
  }, [slug, on]);

  if (!p) return null;

  const write = async (next: boolean) => {
    setBusy(true);
    try {
      /* EVERYTHING ELSE PASSED BACK AS IT STANDS. The RPC still takes
         all nine fields, so a switch that sent defaults for the rest
         would quietly rewrite the commission and the referencing mode. */
      const input: PartnerSettingsInput = {
        name: p.name,
        status: (p.status as PartnerStatus) || 'active',
        since: p.since || '',
        partnerRate: p.partnerRate ?? 0.25,
        agentRate: p.agentRate ?? 0.1,
        referencingMode: p.referencingMode ?? 'pre_referenced_screened',
        portalReferralsEnabled: p.portalReferralsEnabled !== false,
        apiAccessEnabled: next,
      };
      await updatePartnerSettings(slug, input);
      toast(next ? `API access enabled for ${p.name}.` : `API access disabled for ${p.name}.`);
      onChanged?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change API access.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => {
    if (!on) { void write(true); return; }
    /* THE COUNT IS THE WHOLE POINT OF THE BOX. Read when the switch is
       flipped rather than when the page loaded, because a key minted in
       between is a key this sentence would otherwise not be counting. */
    void partnerActiveKeyCount(slug).then((n) => {
      setKeys(n);
      ask({
        title: 'Turn off API access',
        body: n > 0 ? (
          <>
            <b>{n} active API key{n === 1 ? '' : 's'}</b> stop{n === 1 ? 's' : ''} working
            immediately, not just new ones. Any live integration {p.name} has will start failing as
            soon as this is saved.
            {' '}Their developer keeps the keys and they work again if access is turned back on.
          </>
        ) : (
          <>
            {p.name} holds no active API keys, so nothing stops working today. They will not be able
            to mint one, and the Dev Centre disappears for their developers.
          </>
        ),
        confirmLabel: 'Turn off API access',
        run: () => write(false),
      });
    }).catch(() => {
      /* A COUNT WE COULD NOT READ IS NOT A COUNT OF NOUGHT. Saying "no
         keys stop working" when the question failed is the one wrong
         thing this box could say. */
      ask({
        title: 'Turn off API access',
        body: (
          <>
            We could not check how many API keys {p.name} has live, so this may stop a working
            integration immediately. Their developer keeps the keys and they work again if access
            is turned back on.
          </>
        ),
        confirmLabel: 'Turn off API access',
        run: () => write(false),
      });
    });
  };

  return (
    <>
      <div className="apisw">
        <div className="apisw__state">
          <span className={`ph-dot ph-dot--${on ? 'on' : 'off'}`} />
          <span>API access <b>{on ? 'enabled' : 'disabled'}</b></span>
          {on && (
            <span className="apisw__keys">
              {keys == null ? 'active keys unknown' : `${keys} active key${keys === 1 ? '' : 's'}`}
            </span>
          )}
        </div>
        {canEdit && (
          <Button variant={on ? 'quiet' : 'dark'} size="sm" disabled={busy} onClick={toggle}>
            {busy ? 'Saving…' : on ? 'Turn off' : 'Turn on'}
          </Button>
        )}
      </div>
      {confirmEl}
    </>
  );
}
