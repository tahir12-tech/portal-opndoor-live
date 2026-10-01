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
import { setSupplierCommission } from '@/data/partnersService';
import { fmtRatePct } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { useToast } from '@/components/ui/Toast';
/* THE STYLESHEET IT USES, imported by the file that uses it. `.sc-switch` and
   `.sd-summary` live in PartnerHome.css and this card only ever renders inside
   PartnerHome, which imports it -- so it works today and would break silently
   the first time this card is mounted anywhere else. That is the exact fault
   the Add agency form hit with `.ac-*` in AgencyHome.css. */
import './PartnerHome.css';

type Kind = 'commission' | 'agent_share';

const TITLE: Record<Kind, string> = {
  commission: 'What opndoor pays this supplier',
  agent_share: 'What the agencies underneath keep',
};

/* =====================================================================
   THE SAME TWO CARDS MEAN DIFFERENT THINGS UNDER THE TWO SHAPES.

   Matt, 2026-10-01: "two deal shapes chosen by the 'Opndoor pays the
   agents directly' switch. Off (paid through the supplier): one total
   commission, all paid to the supplier, which settles with its agents;
   the agents' share sits within that total and is only used for the
   per-agency statements. On (paid directly by Opndoor): the supplier's
   own commission and the agents' commission are separate deals, each can
   be flat or tiered, and Opndoor pays each party its own; the total is
   the sum. The plain-English summary explains whichever applies."

   So the DESCRIPTIONS are per shape, not fixed. Under OFF the second
   card is a carve-out and says so, including that it cannot exceed the
   first. Under ON it is a deal in its own right and the sentence about
   not exceeding would be a lie: the guard that enforced it is off under
   this shape, deliberately, because a supplier on 5% introducing
   agencies on 20% is the arrangement ON exists for.
   ===================================================================== */
const SUB: Record<'carved' | 'siblings', Record<Kind, string>> = {
  carved: {
    commission:
      'The whole commission on a referral from this supplier, including the part that goes on to the agency. Opndoor pays all of it to the supplier.',
    agent_share:
      'The part of that total the referring agency is owed. The supplier pays it, not opndoor, so it is only used for the per-agency schedules. It comes out of the total above, so it can never be more than it.',
  },
  siblings: {
    commission:
      'What the supplier itself is paid on a referral. Opndoor pays this to the supplier and nothing passes through it.',
    agent_share:
      'What the referring agency is paid, as a deal of its own. Opndoor pays this to the agency directly, so it is not taken out of the supplier’s commission and may be more than it.',
  },
};

/** What a deal prices at for the commonest referral: one tenant, no volume
    behind it. Used for the combined sentence, which has to name a figure. */
function headlineRate(deal: AgreementView | null, flat: number | null): number | null {
  if (!deal) return flat;
  const band = deal.bands.find((b) => b.min <= 1 && (b.max == null || b.max >= 1)) ?? deal.bands[0];
  const tier = deal.tiers.find((t) => t.from <= 0 && (t.to == null || t.to > 0)) ?? deal.tiers[0];
  return tier?.rate ?? band?.rate ?? flat;
}

/** One deal: what it says now, and the button that changes it. */
function Deal({ partnerId, name, kind, shape, canEdit, flat, deal, loaded, onSaved }: {
  partnerId: string;
  name: string;
  kind: Kind;
  /** Which of the two deal shapes is in force, from the pays-agents switch. */
  shape: 'carved' | 'siblings';
  canEdit: boolean;
  /** The flat rate still in force when there is no deal. */
  flat: number | null;
  deal: AgreementView | null;
  loaded: boolean;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);

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
          sub={SUB[shape][kind]}
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
          onSaved={() => { setOpen(false); onSaved(); }}
        />
      )}
    </>
  );
}

export function SupplierDeals({
  slug, partnerId, name, canEdit, total, agentShare, paysAgents, onSaved,
}: {
  slug: string;
  /** The uuid, which is what a partner-scope agreement is keyed on. */
  partnerId: string;
  name: string;
  canEdit: boolean;
  total: number | null;
  agentShare: number | null;
  /** Whether Opndoor settles the agents instead of the supplier doing it. */
  paysAgents: boolean;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { ask, confirmEl } = useConfirm();
  const [deals, setDeals] = useState<{ commission: AgreementView | null; agent_share: AgreementView | null }>(
    { commission: null, agent_share: null });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  /* BOTH READ HERE, not in each card, because the combined sentence below
     needs them together: "Opndoor pays 35%, of which the agents get 15%"
     cannot be written by either card alone. */
  const load = useCallback(async () => {
    try {
      const [c, a] = await Promise.all([
        getSupplierDeal(slug, 'commission'),
        getSupplierDeal(slug, 'agent_share'),
      ]);
      setDeals({ commission: c, agent_share: a });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not read the deals.', 'error');
    } finally {
      setLoaded(true);
    }
  }, [slug, toast]);
  useEffect(() => { void load(); }, [load]);

  const saved = () => { void load(); onSaved(); };

  /* THE SHAPE, from the one switch that chooses it. Named here rather
     than tested inline at each site so the two cards, the sentence and
     the switch's own note cannot drift into describing different
     arrangements. */
  const shape: 'carved' | 'siblings' = paysAgents ? 'siblings' : 'carved';

  const effTotal = headlineRate(deals.commission, total);
  const effShare = headlineRate(deals.agent_share, agentShare);
  const banded = !!(deals.commission?.bands.length ?? 0 > 1)
    || !!deals.commission?.tiers.length
    || !!(deals.agent_share?.bands.length ?? 0 > 1)
    || !!deals.agent_share?.tiers.length;

  /* ===================================================================
     WHO ENDS UP WITH WHAT, AND IT IS A DIFFERENT SENTENCE PER SHAPE.

     Matt, 2026-10-01: "The plain-English summary explains whichever
     applies."

     The two shapes do not differ in wording only; they differ in which
     number is the total and in whether one rate is subtracted from the
     other. Writing one sentence that covered both would mean writing
     the vaguer of the two, and this line exists because two rates on
     two cards do not say how they relate.

       carved     opndoor pays ONE figure, the supplier's total, and the
                  agents' share comes out of it. The arithmetic is a
                  subtraction and the supplier keeps the remainder.
       siblings   opndoor pays TWO figures and the total is their sum.
                  There is no remainder; nothing is subtracted.

     Where a deal varies by tenant count or volume the sentence names
     the commonest referral and says so, rather than printing a figure
     that is only sometimes true. */
  const carried = banded && <> on a single-tenant referral; it changes with the deals below</>;
  const combined = shape === 'carved'
    ? (effTotal == null ? null : (
      <>
        Opndoor pays <b>{fmtRatePct(effTotal)}</b> of the fee to {name}
        {effShare != null && <>, which passes <b>{fmtRatePct(Math.min(effShare, effTotal))}</b> of it on to the
          referring agency and keeps{' '}
          <b>{fmtRatePct(Math.max(effTotal - effShare, 0))}</b></>}
        {carried}.
      </>
    ))
    : (effTotal == null && effShare == null ? null : (
      <>
        Opndoor pays {name} <b>{fmtRatePct(effTotal ?? 0)}</b> of the fee and the referring agency{' '}
        <b>{fmtRatePct(effShare ?? 0)}</b>, separately. That is{' '}
        <b>{fmtRatePct((effTotal ?? 0) + (effShare ?? 0))}</b> in total
        {carried}.
      </>
    ));

  /* IMMEDIATE, WITH A CONFIRMATION, like the API switch. It changes who
     Opndoor sends money to, which is not a thing to flip on the way past.
     The two rates are passed back exactly as stored: set_supplier_commission
     takes all three, and sending anything else here would rewrite a rate
     from a card that no longer shows one. */
  const togglePays = (next: boolean) => ask({
    title: next ? 'Opndoor pays the agents directly' : 'The supplier pays its own agents',
    body: next ? (
      <>
        <p>
          The two deals below stop being a total and a share of it, and become separate deals.
          opndoor will pay <b>{name}</b> its own commission in full, and each agency its own
          beside it, so what opndoor pays in total becomes the <b>sum</b> of the two rather
          than the first of them.
        </p>
        <p>
          Each agency becomes an opndoor payee with its own commission statement from us.
          The agencies&rsquo; deal is no longer capped by the supplier&rsquo;s.
        </p>
        <p className="muted">
          Referrals already taken keep the rates frozen onto them. This applies to new ones.
        </p>
      </>
    ) : (
      <>
        <p>
          opndoor will pay the whole commission to <b>{name}</b>, which settles with its own
          agencies. The agencies&rsquo; deal becomes a share carved out of that total, used for
          the per-agency schedules {name} forwards, and it may no longer be more than the total.
        </p>
        <p>
          No agency under it appears as an opndoor payee, and none receives a statement from us.
        </p>
        <p className="muted">
          Referrals already taken keep the rates frozen onto them. This applies to new ones.
        </p>
      </>
    ),
    confirmLabel: next ? 'Opndoor pays the agents' : `${name} pays its agents`,
    run: async () => {
      setBusy(true);
      try {
        await setSupplierCommission(slug, total ?? 0, agentShare ?? 0, next);
        toast(next ? 'Opndoor now pays the agents directly.' : `${name} now settles its own agents.`);
        onSaved();
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not change that.', 'error');
      } finally { setBusy(false); }
    },
  });

  return (
    <>
      {/* ONE SENTENCE FOR THE WHOLE ARRANGEMENT, and the switch that
          decides who hands the money over. Matt, 2026-10-01: the switch
          and the plain-English summary move into this layout. */}
      <Card>
        <CardHead
          title="What a referral costs"
          sub="The whole arrangement in one line, and who pays the agencies. The switch below chooses between the two shapes, and the deals underneath are read accordingly."
        />
        <CardBody>
          {!loaded ? (
            <p className="ph-note muted">Loading…</p>
          ) : (
            <p className="sd-summary">{combined ?? 'No commission is set for this supplier.'}</p>
          )}
          <label className="sc-switch">
            <input
              type="checkbox" checked={paysAgents} disabled={!canEdit || busy}
              onChange={(e) => togglePays(e.target.checked)}
            />
            <span>
              <b>Opndoor pays the agents directly</b>
              <span className="sc-switch__note">
                {shape === 'carved'
                  ? <>Off, as now: one total commission, paid in full to {name}, which settles with
                      its own agencies. The agencies&rsquo; deal is a share carved out of that total
                      and is used only for the per-agency schedules {name} forwards on.</>
                  : <>On: the two deals below are separate, opndoor pays each party its own, and the
                      total is their sum. Each agency gets its own statement from opndoor.</>}
              </span>
            </span>
          </label>
        </CardBody>
      </Card>

      <Deal partnerId={partnerId} name={name} kind="commission" shape={shape} canEdit={canEdit}
        flat={total} deal={deals.commission} loaded={loaded} onSaved={saved} />
      <Deal partnerId={partnerId} name={name} kind="agent_share" shape={shape} canEdit={canEdit}
        flat={agentShare} deal={deals.agent_share} loaded={loaded} onSaved={saved} />
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
      {confirmEl}
    </>
  );
}
