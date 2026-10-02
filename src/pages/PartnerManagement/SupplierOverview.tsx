/* =====================================================================
   THE SUPPLIER'S OVERVIEW, WHICH WAS BLANK.

   Matt, 2026-10-02: "Overview tab is blank. Give it a short summary:
   the commission deal in one line (as on the Commission tab), who gets
   the statements, any warnings (e.g. an agency with no agency email,
   linking to it), and the supplier's Recent changes."

   BLANK LITERALLY. The page had no `tab === 'overview'` branch at all,
   so the default tab drew nothing: eight tabs, and the one everybody
   lands on was empty. That is worse than a thin page, because it reads
   as broken rather than as new.

   FOUR THINGS, IN THE ORDER HE LISTED THEM, and the order is the right
   one for the question an overview answers: what are we charging, who
   gets told about it, what is wrong, what changed. The warning is third
   rather than first on purpose -- it is often absent, and a card that
   is usually missing at the top makes the page jump.

   NOTHING HERE IS A SECOND COPY. The deal line is `supplierDealLine`,
   the same one the Suppliers list uses; the statement addresses are
   `StatementRecipients`, the same component the Commission tab draws;
   the warning is `agenciesNeedingAnEmail`, the same predicate as the
   Agencies tab, the page banner and the Reconciliation list; and the
   changes are `getPartnerAudit` with `changeSentence`, as the Settings
   tab reads them. An overview that said any of it in its own words
   would be a fifth place for the same fact to drift.
   ===================================================================== */
import { useEffect, useState } from 'react';
import { getPartnerAudit, type PartnerAuditEntry } from '@/data/partnersService';
import { getAgencies, getSupplierDeal, type AgreementView } from '@/data';
import { agenciesNeedingAnEmail } from '@/data/deedContact';
import { supplierDealLine } from '@/data/supplierDealLine';
import { changeSentence } from '@/data/changeSentence';
import { StatementRecipients } from '@/components/StatementRecipients';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { formatDate } from '@/lib/format';
import { plural } from '@/lib/plural';
import './PartnerHome.css';

export function SupplierOverview({ slug, partnerDbId, name, standardTotal, standardShare, onOpenAgencies, dataVersion }: {
  slug: string;
  partnerDbId: string | null;
  name: string;
  standardTotal: number | null;
  standardShare: number | null;
  /** The Agencies tab, which the warning links to. */
  onOpenAgencies: () => void;
  dataVersion: number;
}) {
  const [commission, setCommission] = useState<AgreementView | null>(null);
  const [agentShare, setAgentShare] = useState<AgreementView | null>(null);
  const [audit, setAudit] = useState<PartnerAuditEntry[]>([]);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    void getSupplierDeal(slug, 'commission').then((d) => { if (alive) setCommission(d); }).catch(() => {});
    void getSupplierDeal(slug, 'agent_share').then((d) => { if (alive) setAgentShare(d); }).catch(() => {});
    void getPartnerAudit(slug).then((a) => { if (alive) setAudit(a); }).catch(() => { if (alive) setAudit([]); });
    return () => { alive = false; };
  }, [slug, dataVersion]);

  /* THE SUPPLIER'S OWN AGENCIES, and which of them have no address.
     Read from the hydrated org rather than fetched: the Agencies tab
     beside this is drawn from the same list, and two readers would be
     two answers to "how many need one". */
  const needEmail = agenciesNeedingAnEmail(getAgencies(slug));

  return (
    <div className="ph-grid">
      <Card>
        <CardHead title="Commission" sub="What opndoor charges on a referral through this supplier." />
        <CardBody>
          <p className="ph-lede">
            {supplierDealLine({ commission, agentShare, standardTotal, standardShare })}
          </p>
          <p className="ph-note muted">The full deal, and any deals for named agencies, are on the Commission tab.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHead title="Who gets the statements" sub={`Where ${name}’s monthly commission statement is sent.`} />
        <CardBody style={{ padding: 0 }}>
          <StatementRecipients partnerKey={partnerDbId ?? slug} supplierName={name} />
        </CardBody>
      </Card>

      {/* THIRD, AND ONLY WHEN THERE IS ONE. A warning card that is
          usually absent would make the page jump if it led; a warning
          that is never absent stops being read. */}
      {needEmail.length > 0 && (
        <Card>
          <CardHead title="Needs attention" />
          <CardBody>
            <div className="ph-warn">
              <Icon name="alert" />
              <div>
                <b>
                  {needEmail.length} {needEmail.length === 1 ? 'agency has' : 'agencies have'} no agency email
                </b>
                <p className="ph-note">
                  It is the address a signed deed goes to, and the default every office of theirs
                  inherits. {needEmail.slice(0, 5).map((a) => a.name).join(', ')}
                  {needEmail.length > 5 && ` and ${needEmail.length - 5} more`}.
                </p>
                <button type="button" className="ph-addemail" onClick={onOpenAgencies}>
                  Open the Agencies tab to add {plural(needEmail.length, 'one')}
                </button>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHead title="Recent changes" />
        <CardBody>
          {audit.length === 0 ? (
            <p className="ph-note muted">
              No changes recorded yet. Edits to this supplier&rsquo;s name, status, go-live date or
              commission appear here.
            </p>
          ) : (
            <>
              <ul className="pm-audit">
                {(showAll ? audit : audit.slice(0, 5)).map((e, i) => (
                  <li key={i} className="pm-audit__row">
                    <span className="pm-audit__said">{changeSentence(e)}</span>
                    <span className="pm-audit__meta">{e.actor} · {formatDate(e.at)}</span>
                  </li>
                ))}
              </ul>
              {audit.length > 5 && (
                <button type="button" className="pm-audit__more" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? 'Show fewer' : `View all changes (${audit.length})`}
                </button>
              )}
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
