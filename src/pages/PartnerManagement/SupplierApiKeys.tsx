/* =====================================================================
   THE SUPPLIER'S ACTIVE KEYS, AND A REVOKE BESIDE EACH.

   Matt, 2026-10-02: "Supplier Integration tab: Opndoor admin can revoke
   a single key here. List each active key by its name, when it was
   created and when it was last used, each with a Revoke button and a
   confirmation ('This key stops working immediately. Their other keys
   keep working.'). Admin still never sees or creates a full key."

   WHAT IS SHOWN, AND WHAT IS NOT. The name, the created date, the last
   used date. Not the prefix: Matt lists three things and the prefix is
   not one of them. It is not left off by this component's restraint
   either -- `admin_supplier_api_keys` cannot return one, so "admin
   never sees a key" is a property of the function. The prefix is still
   written into the security event the revoke records, because that is
   the log a supplier's own developer reads, where a name alone does not
   identify the row.

   AND NOT `dev_api_keys`, which is the developer's own reader and
   returns nothing at all to an admin by design.

   NEVER A CREATE. There is no mint here and there is not going to be:
   the key is shown once at creation and only its holder should ever
   have held it.

   ACTIVE ONLY. A revoked key is not an action and not a risk; listing
   it would put a disabled button next to every historical row and bury
   the ones that matter.
   ===================================================================== */
import { useCallback, useEffect, useState } from 'react';
import { adminRevokeApiKey, adminSupplierApiKeys, type AdminApiKey } from '@/data/devCentreService';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { formatDate } from '@/lib/format';
import { plural } from '@/lib/plural';

/** Live means not revoked and not past its expiry. */
const isActive = (k: AdminApiKey) =>
  !k.revoked_at && (!k.expires_at || new Date(k.expires_at).getTime() > Date.now());

export function SupplierApiKeys({ partnerId, canRevoke }: {
  /** The partner's database id, which is what `dev_api_keys` filters on. */
  partnerId: string | null;
  canRevoke: boolean;
}) {
  const toast = useToast();
  const { ask, confirmEl } = useConfirm();
  const [keys, setKeys] = useState<AdminApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!partnerId) { setKeys([]); setLoading(false); return; }
    try { setKeys((await adminSupplierApiKeys(partnerId)).filter(isActive)); }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not load the keys.', 'error'); }
    finally { setLoading(false); }
  }, [partnerId, toast]);

  useEffect(() => { void load(); }, [load]);

  const revoke = (k: AdminApiKey) => {
    const others = keys.length - 1;
    ask({
      title: `Revoke “${k.name}”?`,
      /* MATT'S OWN SENTENCE, and the second half of it is the one that
         stops this being frightening: revoking one key is not turning
         the integration off. The count is added only where there ARE
         others, because "Their other keys keep working" over a list of
         one is a promise about nothing -- and the one-key case is the
         one where the warning is real. */
      body: others > 0
        ? `This key stops working immediately. Their other ${others} ${plural(others, 'key')} keep working.`
        : 'This key stops working immediately. It is their only active key, so their integration stops until they create another.',
      confirmLabel: 'Revoke key',
      danger: true,
      run: async () => {
        setBusy(k.id);
        try {
          const r = await adminRevokeApiKey(k.id);
          toast(r.revoked
            ? `“${k.name}” revoked. It stops working immediately.`
            : `“${k.name}” was already revoked.`, r.revoked ? 'ok' : 'error');
          await load();
        } catch (e) {
          toast(e instanceof Error ? e.message : 'Could not revoke the key.', 'error');
        } finally { setBusy(null); }
      },
    });
  };

  if (loading) return <div className="ph-empty">Loading.</div>;
  if (!keys.length) return <><div className="ph-empty">No active API keys.</div>{confirmEl}</>;

  return (
    <div className="ph-keys">
      {confirmEl}
      {keys.map((k) => (
        <div className="ph-key" key={k.id}>
          <div className="ph-key__main">
            <b className="ph-key__name">{k.name}</b>
            <span className="ph-key__meta">
              Created {formatDate(k.created_at)}
              {' · '}
              {/* A KEY THAT HAS NEVER BEEN USED SAYS SO. "Last used —" reads
                  as a missing value; "Never used" is the fact, and it is the
                  one that makes a key safe to revoke. */}
              {k.last_used_at ? `last used ${formatDate(k.last_used_at)}` : 'never used'}
            </span>
          </div>
          {canRevoke && (
            <Button variant="quiet" size="sm" disabled={busy === k.id} onClick={() => revoke(k)}>
              <Icon name="alert" size={13} /> {busy === k.id ? 'Revoking…' : 'Revoke'}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
