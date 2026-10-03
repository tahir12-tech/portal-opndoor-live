/* =====================================================================
   THE SUPPLIER'S COMMISSION TAB, IN PLAIN ENGLISH.

   Matt, 2026-10-01, rebuilt this tab and banned the vocabulary the
   previous version used: no "shapes", no "deals underneath", no
   "frozen", no "carved", no "Standard terms". Every one of those was a
   word I introduced here, and each of them describes the MODEL rather
   than the money. `noJargonOnTheCommissionTab.test.ts` keeps them out.

   The order on the page is his:

     1. Who does opndoor pay?
     2. <Supplier> gets
     3. Agencies get
     4. Agencies on different terms
     5. A worked example on a GBP 1,000 fee, updating as you change things
     6. Changes apply to new referrals only

   WHAT THE READER IS DOING HERE. Agreeing commercial terms with a
   supplier, then checking they read back the way they were agreed. So
   every card leads with what is true NOW, in a sentence, and the
   editor is behind a Change button -- rather than a form you have to
   read backwards to find out what the deal is.
   ===================================================================== */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { dealWords, pctOf, AgreementEditor } from '@/pages/Agencies/AgreementEditor';
import { AgencyPercentEditor } from './AgencyPercentEditor';
import { ShareDeals, type ShareDealAgency } from './ShareDeals';
import {
  getSupplierDeal, getSupplierShareDeals,
  type AgreementView, type ShareDealView,
} from '@/data/orgService';
import { setSupplierCommission } from '@/data/partnersService';
import { gbpPence } from '@/lib/format';
import { plural } from '@/lib/plural';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { useToast } from '@/components/ui/Toast';
import './PartnerHome.css';

/** The fee the worked example is built on. A round number, because the
    point of it is the arithmetic between the parties and not the fee. */
const EXAMPLE_FEE = 1000;

/** What a deal prices at for the commonest referral: one tenant, no
    volume behind it. The sentences have to name a figure. */
function headlineRate(deal: AgreementView | null, flat: number | null): number | null {
  if (!deal) return flat;
  const band = deal.bands.find((b) => b.min <= 1 && (b.max == null || b.max >= 1)) ?? deal.bands[0];
  const tier = deal.tiers.find((t) => t.from <= 0 && (t.to == null || t.to > 0)) ?? deal.tiers[0];
  return tier?.rate ?? band?.rate ?? flat;
}

/** The one-line answer a card leads with: "25% of the fee". */
/** True when neither a negotiated deal nor a standard rate is in force: this
    supplier has had no commission agreed at all. Matt, 2026-10-03: "a new
    supplier starts with no deal at all: the Commission tab and Overview say
    'No commission deal set' as a warning". */
export function hasNoDeal(deal: AgreementView | null, flat: number | null): boolean {
  return !deal && flat == null;
}

function oneLine(deal: AgreementView | null, flat: number | null, share: boolean): string {
  if (!deal) {
    /* "Nothing is set" WAS ALREADY HERE AND WAS UNREACHABLE. The columns
       were NOT NULL with a default of 25% and 10%, so `flat` could never
       be null and every supplier had a rate whether or not anybody had
       agreed one. Since 20261007680000 a new supplier genuinely has none,
       this branch is the ordinary case for one, and it is a WARNING rather
       than a remark -- nothing can be paid until it is answered. */
    return flat == null
      ? 'No commission deal set.'
      : `${pctOf(flat)}% of the fee, on every referral.`;
  }
  return dealWords(
    deal.bands.map((b) => ({ min: b.min, max: b.max, weeks: b.weeks, unit: b.unit ?? 'weeks', rate: b.rate })),
    deal.tiers,
    share,
  );
}

export function SupplierDeals({
  slug, partnerId, name, canEdit, total, agentShare, paysAgents, agencies, onSaved,
}: {
  slug: string;
  /** The uuid, which is what a partner-scope agreement is keyed on. */
  partnerId: string;
  name: string;
  canEdit: boolean;
  total: number | null;
  agentShare: number | null;
  /** Whether opndoor pays each agency itself. */
  paysAgents: boolean;
  agencies: ShareDealAgency[];
  onSaved: () => void;
}) {
  const toast = useToast();
  const { ask, confirmEl } = useConfirm();
  const [commission, setCommission] = useState<AgreementView | null>(null);
  /* EVERY SHARE DEAL FROM ONE READER. `supplier_deal` answers "the
     supplier's share deal", which is a question with one answer, and with
     bespoke deals in play it returns whichever is newest by effective_from
     -- so the "Agencies get" card could show a deal belonging to three
     named agencies and call it everybody's. `supplier_share_deals` marks
     the default, so this card and the list below cannot disagree. */
  const [shares, setShares] = useState<ShareDealView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<'supplier' | 'agencies' | null>(null);

  /* BOTH READ HERE, because the worked example needs them together:
     "opndoor pays X and the agency Y" cannot be written by either card
     on its own. */
  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([
        getSupplierDeal(slug, 'commission'),
        getSupplierShareDeals(slug),
      ]);
      setCommission(c);
      setShares(s);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not read the deals.', 'error');
    } finally {
      setLoaded(true);
    }
  }, [slug, toast]);
  useEffect(() => { void load(); }, [load]);

  const saved = () => { setEditing(null); void load(); onSaved(); };

  const defaultShare = shares.find((d) => d.isDefault) ?? null;
  const bespoke = shares.filter((d) => !d.isDefault);
  /** Everybody not named on one of the deals below, which is who the
      default's percentage is actually for. */
  const onTheseTerms = agencies.filter(
    (a) => !bespoke.some((d) => d.members.some((m) => m.agencyId === a.id)),
  );

  const supplierRate = headlineRate(commission, total);
  const agencyRate = headlineRate(defaultShare, agentShare);

  /* THE WORKED EXAMPLE, which is the only place the two deals are added
     up. Matt's own two sentences, one per arrangement -- and they differ
     by more than wording: under the first, opndoor hands over one figure
     and the agency's share comes out of it; under the second, opndoor
     pays two and the total is their sum. */
  /* A DEAL THAT VARIES CANNOT BE WORKED THROUGH IN ONE SENTENCE, so the
     example says which referral it is of rather than printing a figure
     that is true some of the time. Bands or tiers on either side is what
     makes it vary. */
  const varies = (commission?.bands.length ?? 0) > 1 || (commission?.tiers.length ?? 0) > 0
    || (defaultShare?.bands.length ?? 0) > 1 || (defaultShare?.tiers.length ?? 0) > 0
    || bespoke.length > 0;

  const example = useMemo(() => {
    /* POUNDS, NOT PENCE. `gbpPence` is named for the two decimal places it
       always prints, not for the unit it takes: every caller passes pounds.
       Multiplying by 100 first put a £1,000 fee on screen as £100,000.00,
       which the render test caught and no amount of reading would have. */
    const supplier = EXAMPLE_FEE * (supplierRate ?? 0);
    const agency = EXAMPLE_FEE * (agencyRate ?? 0);
    if (paysAgents) {
      return (
        <>
          On a <b>{gbpPence(EXAMPLE_FEE)}</b> fee: opndoor pays {name}{' '}
          <b>{gbpPence(supplier)}</b> and the agency <b>{gbpPence(agency)}</b>.
          {' '}Total <b>{gbpPence(supplier + agency)}</b>.
          {varies && <span className="muted"> On a single-tenant referral; it changes with the deals below.</span>}
        </>
      );
    }
    return (
      <>
        On a <b>{gbpPence(EXAMPLE_FEE)}</b> fee: opndoor pays {name}{' '}
        <b>{gbpPence(supplier)}</b>, of which <b>{gbpPence(Math.min(agency, supplier))}</b> goes to the
        agency.
        {varies && <span className="muted"> On a single-tenant referral; it changes with the deals below.</span>}
      </>
    );
  }, [paysAgents, supplierRate, agencyRate, name, varies]);

  /* IMMEDIATE, WITH A CONFIRMATION, like the API switch. It changes who
     opndoor sends money to, which is not a thing to flip on the way
     past. The two rates go back exactly as stored: set_supplier_commission
     takes all three, and sending anything else would rewrite a rate from
     a card that is not being edited. */
  const choosePayment = (next: boolean) => {
    if (next === paysAgents) return;
    ask({
      title: next ? 'opndoor pays each agency' : `${name} pays its own agencies`,
      body: next ? (
        <>
          <p>
            opndoor will pay {name} its own commission, and each agency its own beside it. What
            opndoor pays in total becomes the two added together.
          </p>
          {/* THE SAME SENTENCE AS THE SWITCH, which Matt asked to be
              checked: a confirmation that promises something the line
              under the control does not is the one somebody acts on. */}
          <p>Each agency becomes an opndoor payee. All statements still go to {name}.</p>
          <p className="muted">Referrals already sent keep the rates they were given. This applies to new ones.</p>
        </>
      ) : (
        <>
          <p>
            opndoor will pay the whole commission to <b>{name}</b>, which settles with its own
            agencies. What the agencies get comes out of that total and is used for the statements
            {' '}{name} passes on.
          </p>
          <p>No agency under {name} is paid by opndoor, and none gets a statement from us.</p>
          <p className="muted">Referrals already sent keep the rates they were given. This applies to new ones.</p>
        </>
      ),
      confirmLabel: next ? 'opndoor pays each agency' : `${name} pays its agencies`,
      run: async () => {
        setBusy(true);
        try {
          await setSupplierCommission(slug, total ?? 0, agentShare ?? 0, next);
          toast('Saved. It applies to new referrals.');
          onSaved();
        } catch (e) {
          toast(e instanceof Error ? e.message : 'Could not change that.', 'error');
        } finally { setBusy(false); }
      },
    });
  };

  const OPTIONS: { value: boolean; label: string }[] = [
    { value: false, label: `${name} only. They pay their agencies themselves.` },
    { value: true, label: `${name} and each agency, separately.` },
  ];

  return (
    <>
      {/* 1. WHO DOES OPNDOOR PAY? */}
      <Card>
        <CardHead title="Who does opndoor pay?" />
        <CardBody>
          <div className="roleopts">
            {OPTIONS.map((o) => (
              <label
                key={String(o.value)}
                className={`roleopt${paysAgents === o.value ? ' is-sel' : ''}`}
                onClick={() => canEdit && !busy && choosePayment(o.value)}
              >
                <span className="roleopt__radio" />
                <div><div className="roleopt__name">{o.label}</div></div>
              </label>
            ))}
          </div>
          {/* WHAT THE CHOICE DOES TO THE PAPERWORK, which is the half of
              it that is not arithmetic and which nothing else on the page
              says. It used to be the description under the old switch; it
              is still true and still the thing a finance reader needs. */}
          {/* AND IT WAS FALSE AS WELL AS UNCLEAR, which is why Matt's
              replacement is the behaviour and not a tidier sentence.
              20261007410000 stopped sending a statement to an agency in
              a supplier's estate at all: the money may be paid to the
              agency, and the paperwork goes to the supplier either way.
              This line promised each agency a statement from us. */}
          <p className="ph-note muted">
            {paysAgents
              ? `opndoor pays each agency its share directly. All statements still go to ${name}.`
              : `opndoor sends one statement to ${name}, with per-agency schedules for them to forward on.`}
          </p>

          {/* 5. THE WORKED EXAMPLE, here rather than at the bottom: it is
              the answer to the question the radio buttons ask. */}
          <p className="sd-worked">{example}</p>
          {/* 6. */}
          <p className="ph-note muted">Changes apply to new referrals only.</p>
        </CardBody>
      </Card>

      {/* 2. WHAT THE SUPPLIER GETS */}
      <Card>
        <CardHead
          title={`${name} gets`}
          sub="What the tenant pays, and the supplier's share of it."
          actions={canEdit && <Button variant="quiet" size="sm" onClick={() => setEditing('supplier')}>Change</Button>}
        />
        <CardBody>
          <p className={`sd-summary${loaded && hasNoDeal(commission, total) ? ' sd-summary--warn' : ''}`}>
            {loaded && hasNoDeal(commission, total) && <Icon name="alert" size={14} />}
            {loaded ? oneLine(commission, total, false) : 'Loading…'}
          </p>
          {loaded && hasNoDeal(commission, total) && (
            <p className="ph-note muted">
              Nothing is charged and nothing is owed on this supplier&rsquo;s referrals until a deal
              is set. Press Change to set one.
            </p>
          )}
          {commission?.note && <p className="ph-note muted">{commission.note}</p>}
        </CardBody>
      </Card>

      {/* 3. WHAT THE AGENCIES GET. The heading says which arrangement is
          in force, because the same percentage means two different things
          under the two. */}
      <Card>
        <CardHead
          title={paysAgents
            ? 'Opndoor pays each agency'
            : `Of that, agencies get (shown on the statements ${name} passes on)`}
          actions={canEdit && <Button variant="quiet" size="sm" onClick={() => setEditing('agencies')}>Change</Button>}
        />
        <CardBody>
          <p className="sd-summary">{loaded ? oneLine(defaultShare, agentShare, true) : 'Loading…'}</p>
          {defaultShare?.note && <p className="ph-note muted">{defaultShare.note}</p>}

          {/* WHO THAT ACTUALLY IS, once some agencies are on terms of their
              own. Matt's earlier instruction, which this rebuild does not
              replace: "Show which agencies are on which deal, and every
              agency not picked uses the default."

              DERIVED, NOT READ. The default deal has no membership rows on
              purpose, because "everybody not named" cannot be kept correct
              as a list. With no bespoke deals the answer is "every agency"
              and naming them all is noise, so the list appears exactly when
              it stops being obvious. */}
          {/* WHETHER THIS MAY BE MORE THAN THE SUPPLIER'S OWN, which is a
              real rule and not a reassurance: under the first arrangement
              the share is taken OUT of the supplier's commission and the
              database refuses a share above it at any tenant count or
              volume, and under the second they are paid separately and a
              bigger agency percentage is the point of the shape. */}
          <p className="ph-note muted">
            {paysAgents
              ? `This may be more than ${name} gets: opndoor pays each of them separately.`
              : `This comes out of what ${name} gets, so it can never be more than it.`}
          </p>

          {bespoke.length > 0 && (
            <div className="sd-members">
              {onTheseTerms.length === 0 ? (
                <p className="ph-note muted">
                  Every agency is named on a deal below, so nothing is paid on these terms today.
                </p>
              ) : (
                <>
                  <p className="ph-note muted">
                    {onTheseTerms.length} {plural(onTheseTerms.length, 'agency')}, being everyone not
                    named on a deal below.
                  </p>
                  <ul className="sd-memberlist">
                    {onTheseTerms.map((a) => (
                      <li key={a.id} className="sd-member">
                        <span className="sd-member__name">{a.name}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {/* 4. AGENCIES ON DIFFERENT TERMS */}
      <div className="sd-sharehead">
        <h3 className="sd-sharehead__t">Agencies on different terms</h3>
        <p className="sd-sharehead__s">
          Every agency gets the percentage above unless it is named on one of these.
        </p>
      </div>
      <ShareDeals partnerId={partnerId} deals={bespoke} agencies={agencies}
        canEdit={canEdit} onChanged={saved} />

      {editing === 'supplier' && (
        <AgreementEditor
          level="partner"
          /* THE UUID, not the slug: create_agreement takes p_id as a uuid
             and a partner-scope agreement is keyed on partners.id. */
          id={partnerId}
          name={name}
          kind="commission"
          current={commission}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}
      {editing === 'agencies' && (
        <AgencyPercentEditor
          partnerId={partnerId}
          current={defaultShare}
          title="What the agencies get"
          sub={paysAgents
            ? 'opndoor pays this to each agency directly.'
            : `This comes out of what ${name} is paid, and is shown on the statements they pass on.`}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}
      {confirmEl}
    </>
  );
}
