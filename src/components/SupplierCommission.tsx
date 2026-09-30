/* =====================================================================
   A SUPPLIER'S COMMISSION, SET IN ONE PLACE.

   Matt, 2026-09-30, verbatim: "Supplier commission is one total rate, set
   per supplier on its Commission tab (nothing hardcoded; Rightmove's
   happens to be 35%), and that total includes the agents' share. The
   agent's share is carved out of it and can be volume-tiered per supplier
   using the existing tiers ... The supplier's own share is the total
   minus the agent's share, never more in total. Opndoor pays the whole
   total to the supplier, who pays its agents, unless the supplier's
   setting says Opndoor pays agents directly."

   THE CARD SHOWS THE SUBTRACTION AS YOU TYPE, which is the whole reason
   it is one card and not three fields. The old pair of boxes could not
   be read wrongly because the two numbers were unrelated; these two are
   a total and a slice of it, and an admin needs to see the supplier's
   own share move when they change either. The arithmetic here is a
   PREVIEW: the database does it again on every referral, and nothing on
   this screen is what a statement reads.

   NOTHING HARDCODED. 35% is Rightmove's number. The fields are empty of
   defaults and seeded from what the supplier already has.

   ONE CALL, because the three settings are one decision. Saving the
   total and the share separately would leave the share above the total
   in between, which is the state `set_supplier_commission` refuses.
   ===================================================================== */
import { useEffect, useState } from 'react';
import { getSupplierTiers, setSupplierCommission, type SupplierTier } from '@/data';
import { Card, CardHead, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { fmtRatePct } from '@/lib/format';

interface Props {
  slug: string;
  supplierName: string;
  total: number;
  agentShare: number;
  opndoorPaysAgents: boolean;
  canEdit: boolean;
  onSaved: () => void | Promise<void>;
}

/** A percentage typed into a box, as a rate. Blank reads as zero rather
    than NaN, so a half-cleared field never saves a broken number. */
function readPct(v: string): number {
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n / 100 : 0;
}
const asPct = (r: number) => String(Math.round(r * 1000) / 10);

export function SupplierCommission({
  slug, supplierName, total, agentShare, opndoorPaysAgents, canEdit, onSaved,
}: Props) {
  const toast = useToast();
  const { ask, confirmEl } = useConfirm();
  const [totalPct, setTotalPct] = useState(asPct(total));
  const [sharePct, setSharePct] = useState(asPct(agentShare));
  const [paysAgents, setPaysAgents] = useState(opndoorPaysAgents);
  const [tiers, setTiers] = useState<SupplierTier[]>([]);
  const [busy, setBusy] = useState(false);

  // Re-seeded when the subject changes, so moving between two suppliers
  // never shows the previous one's figures in the boxes.
  useEffect(() => {
    setTotalPct(asPct(total)); setSharePct(asPct(agentShare)); setPaysAgents(opndoorPaysAgents);
  }, [slug, total, agentShare, opndoorPaysAgents]);

  useEffect(() => {
    let alive = true;
    getSupplierTiers(slug).then((t) => { if (alive) setTiers(t); }).catch(() => { if (alive) setTiers([]); });
    return () => { alive = false; };
  }, [slug]);

  const t = readPct(totalPct);
  const a = readPct(sharePct);
  const over = a > t;
  const dirty = t !== total || a !== agentShare || paysAgents !== opndoorPaysAgents;

  const save = () => ask({
    title: 'Change this supplier’s commission',
    body: (
      <>
        {supplierName} will earn <b>{fmtRatePct(t)}</b> of the fee on new referrals, with <b>{fmtRatePct(a)}</b> of
        that going to the agents and <b>{fmtRatePct(t - a)}</b> to {supplierName}.{' '}
        {paysAgents
          ? 'Opndoor will pay the agents their share directly.'
          : `Opndoor will pay the whole ${fmtRatePct(t)} to ${supplierName}, which pays its own agents.`}{' '}
        Referrals already created keep the rate recorded when they were created.
      </>
    ),
    confirmLabel: 'Save commission',
    run: async () => {
      setBusy(true);
      try {
        await setSupplierCommission(slug, t, a, paysAgents);
        await onSaved();
        toast('Commission saved.');
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not save the commission.', 'error');
      } finally { setBusy(false); }
    },
  });

  return (
    <Card>
      <CardHead
        title="Commission"
        sub="One total rate, with the agents' share carved out of it. Snapshotted onto each referral at creation."
      />
      <CardBody>
        <div className="sc-grid">
          <Field label="Total commission %" htmlFor="sc-total">
            <input id="sc-total" type="number" step="0.5" min="0" max="100" value={totalPct}
                   disabled={!canEdit} onChange={(e) => setTotalPct(e.target.value)} />
          </Field>
          <Field label="Agents' share %" htmlFor="sc-share">
            <input id="sc-share" type="number" step="0.5" min="0" max="100" value={sharePct}
                   disabled={!canEdit} onChange={(e) => setSharePct(e.target.value)} />
          </Field>
        </div>

        {/* THE SUBTRACTION, SHOWN. Two boxes cannot say "one of these comes
            out of the other"; this line can, and it is the sentence an
            admin is actually deciding. */}
        <div className={`sc-sum${over ? ' sc-sum--bad' : ''}`}>
          {over ? (
            <>
              <Icon name="alert" size={14} />
              <span>
                The agents&rsquo; share comes out of the total, so it cannot be more than it.
                Raise the total or lower the share.
              </span>
            </>
          ) : (
            <span>
              Opndoor pays <b>{fmtRatePct(t)}</b> of the fee. Of that, the agents get <b>{fmtRatePct(a)}</b> and{' '}
              {supplierName} keeps <b>{fmtRatePct(t - a)}</b>.
            </span>
          )}
        </div>

        <label className="sc-switch">
          <input type="checkbox" checked={paysAgents} disabled={!canEdit}
                 onChange={(e) => setPaysAgents(e.target.checked)} />
          <span>
            <b>Opndoor pays the agents directly</b>
            <span className="sc-switch__note">
              Off: Opndoor pays the whole total to {supplierName}, which settles with its own agents, and no agency
              appears as an Opndoor payee. On: the agents&rsquo; share is paid to the agency instead.
            </span>
          </span>
        </label>

        {/* THE TIERS, READ-ONLY, AND SAID SO. They are the existing
            pricing-agreement machinery, and an editor for them is a build
            of its own rather than a box on this card. Showing them
            without saying they cannot be changed here would read as a
            broken control. */}
        <div className="sc-tiers">
          <div className="sc-tiers__head">Volume tiers on the agents&rsquo; share</div>
          {tiers.length === 0 ? (
            <p className="ph-note muted">
              None. Every referral carries the flat agents&rsquo; share above.
            </p>
          ) : (
            <>
              <ul className="sc-tierlist">
                {tiers.map((x) => (
                  <li key={`${x.fromCount}-${x.toCount ?? 'up'}`}>
                    <span>
                      {x.toCount == null
                        ? `From referral ${x.fromCount + 1} onwards`
                        : `Referrals ${x.fromCount + 1} to ${x.toCount}`}
                      {' '}per {x.countingScope} per {x.period}
                    </span>
                    <b>{fmtRatePct(x.agentRate)}</b>
                  </li>
                ))}
              </ul>
              <p className="ph-note muted">
                Read-only here. Tiers are set on the supplier&rsquo;s pricing agreement.
              </p>
            </>
          )}
        </div>

        {canEdit && (
          <div className="sc-actions">
            <Button variant="dark" size="sm" disabled={busy || over || !dirty} onClick={save}>
              Save commission
            </Button>
            {!dirty && <span className="ph-note muted">No changes.</span>}
          </div>
        )}
      </CardBody>
      {confirmEl}
    </Card>
  );
}
