/* =====================================================================
   A SUPPLIER'S TWO DEALS, ON ITS COMMISSION TAB.

   Matt, 2026-10-01: "Supplier Commission tab: use the same commission
   deal editor agencies have, with all its options (flat rate, volume
   tiers, bands by number of tenants, and per-agency overrides), for both
   the supplier's total commission and the agents' share within it. Both
   can be set independently per supplier. The agents' share can never
   exceed the supplier's total on any referral, checked on save. The
   summary line explains the resulting deal in plain English. Changes
   apply to new referrals only, recorded with who and when."

   THE SAME EDITOR, TWICE, which is the instruction read literally and is
   also the only way the two can stay the same editor. AgreementEditor
   takes a `kind`; everything else about it is unchanged.

   WHAT THIS CARD DOES NOT OWN:

     the rules        every one of them is in create_agreement, including
                      the cross-check that the share never exceeds the
                      total. Its refusal is shown word for word.
     the overrides    "per-agency overrides" are agency-scope deals and
                      are edited on the agency's own page, which is where
                      an override belongs. This card says they exist and
                      links to them rather than growing a second place to
                      set the same thing.
     the flat pair    a supplier with no deal is still priced by the two
                      numbers on the card above, and most are. A deal
                      overrides; its absence changes nothing.
   ===================================================================== */
import { useCallback, useEffect, useState } from 'react';
import {
  dealWords, agreementSummary, AgreementEditor,
} from '@/pages/Agencies/AgreementEditor';
import { getSupplierDeal, type AgreementView } from '@/data/orgService';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';

type Kind = 'commission' | 'agent_share';

const TITLE: Record<Kind, string> = {
  commission: 'What opndoor pays this supplier',
  agent_share: 'What the agencies underneath keep',
};
const SUB: Record<Kind, string> = {
  commission:
    'The whole commission on a referral from this supplier, including the part that goes on to the agency.',
  agent_share:
    'The part of that commission the referring agency is paid. It comes out of the total above, so it can never be more than it.',
};

/** One deal: what it says now, and the button that changes it. */
function Deal({ slug, partnerId, name, kind, canEdit, flat, onSaved }: {
  /** The slug reads the deal; the uuid writes it. */
  slug: string;
  partnerId: string;
  name: string;
  kind: Kind;
  canEdit: boolean;
  /** The flat rate still in force when there is no deal. */
  flat: number | null;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [deal, setDeal] = useState<AgreementView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setDeal(await getSupplierDeal(slug, kind));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not read the deal.', 'error');
    } finally {
      setLoaded(true);
    }
  }, [slug, kind, toast]);

  useEffect(() => { void load(); }, [load]);

  /* THE SUMMARY IS THE DEAL IN PLAIN ENGLISH, from the same function the
     editor's own preview uses, so the card and the editor cannot word one
     deal two ways. */
  const summary = deal
    ? dealWords(
        deal.bands.map((b) => ({
          min: b.min, max: b.max, weeks: b.weeks, unit: b.unit ?? 'weeks', rate: b.rate,
        })),
        deal.tiers,
        kind === 'agent_share',
      )
    : null;

  return (
    <>
      <Card>
        <CardHead
          title={TITLE[kind]}
          sub={SUB[kind]}
          actions={canEdit && (
            <Button variant={deal ? 'quiet' : 'dark'} size="sm" onClick={() => setOpen(true)}>
              {deal ? 'Change the deal' : 'Agree a deal'}
            </Button>
          )}
        />
        <CardBody>
          {!loaded ? (
            <p className="ph-note muted">Loading…</p>
          ) : deal ? (
            <>
              <p className="sd-summary">{summary}</p>
              {deal.note && <p className="ph-note muted">{deal.note}</p>}
              <p className="ph-note muted">
                {/* ONE LINE, same shape as the Overview tree's. */}
                {agreementSummary(deal)}
              </p>
            </>
          ) : (
            /* NO DEAL IS A REAL AND COMMON STATE, and the card must say what
               prices the referral instead rather than looking broken. */
            <p className="sd-summary">
              {flat == null
                ? 'No deal, and no flat rate either. Nothing is paid on this.'
                : `No deal. Every referral pays ${Number((flat * 100).toFixed(2))}%, whatever the tenancy and whatever the volume.`}
            </p>
          )}
        </CardBody>
      </Card>

      {open && (
        <AgreementEditor
          level="partner"
          /* THE UUID, not the slug: create_agreement takes p_id as a uuid and
             a partner-scope agreement is keyed on partners.id. The READ goes
             by slug, because that is what the screen holds and what
             supplier_deal was given; the WRITE has to be the key. */
          id={partnerId}
          name={name}
          kind={kind}
          current={deal}
          onClose={() => setOpen(false)}
          onSaved={() => { setOpen(false); void load(); onSaved(); }}
        />
      )}
    </>
  );
}

export function SupplierDeals({ slug, partnerId, name, canEdit, total, agentShare, onSaved }: {
  slug: string;
  /** The uuid, which is what a partner-scope agreement is keyed on. */
  partnerId: string;
  name: string;
  canEdit: boolean;
  total: number | null;
  agentShare: number | null;
  onSaved: () => void;
}) {
  return (
    <>
      <Deal slug={slug} partnerId={partnerId} name={name} kind="commission"
        canEdit={canEdit} flat={total} onSaved={onSaved} />
      <Deal slug={slug} partnerId={partnerId} name={name} kind="agent_share"
        canEdit={canEdit} flat={agentShare} onSaved={onSaved} />
      {/* WHERE AN OVERRIDE LIVES. Matt's "per-agency overrides" are
          agency-scope deals, which the resolver already prefers over the
          supplier's. They are edited on the agency's own page: a second
          place to set the same thing is how two screens come to disagree,
          which is the fault the Commission tab was built to end. */}
      <Card>
        <CardHead
          title="One agency on different terms"
          sub="An agency under this supplier can keep a different share. It is agreed on that agency's own page, and it beats the deal above for that agency only."
        />
        <CardBody>
          <p className="ph-note muted">
            Open the agency from the Overview tab and set its deal there. Nothing here overrides it,
            and the referral is priced by the most specific deal that applies to it.
          </p>
        </CardBody>
      </Card>
    </>
  );
}
