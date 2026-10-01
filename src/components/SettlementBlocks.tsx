/* =====================================================================
   SETTLEMENTS, AS TWO BLOCKS.

   There are two questions and the surface only ever answered one.

     Payable now   the closed month, its total, and the date it is paid.
     Accruing      this month to date, its total, and when it becomes payable.

   Answering only the first meant printing "No commission is payable for
   August" on the 3rd of September, over a September that had already taken
   money. On the admin surface that was a wrong sentence; on the agency's own
   Reporting it was worse, because that section is hidden entirely when the
   closed month is empty, so a Director whose month had just started saw no
   settlement at all and nothing to tell them one was building.

   ONE COMPONENT, TWO HOMES, deliberately, like the commission statement: the
   admin surface and the agency's own Reporting show the same two blocks over
   the same two windows, so the figure an agency reads and the figure Opndoor
   reads for them cannot diverge.

   MODULE SCOPE with explicit props, and no hook: mounted normally by both
   callers, so there is no remount trap to fall into.
   ===================================================================== */
import { gbpPence, formatDate } from '@/lib/format';
import {
  getAgentCommissionSettlement, getCommissionSettlement, liveAvailable, maySeeCommission,
  type PartnerScope, type Role,
} from '@/data';

/** Money-reconciliation surface: pence on every row and total, so rows sum. */
// One format, shared. See lib/format.
const dayMonth = (d: Date) => formatDate(d);
const fullDate = (d: Date) => `${dayMonth(d)} ${d.getFullYear()}`;

interface SplitRow { key: string; name: string; amount: number }

/** One list over both rails. A split naming only agencies would leave the
    supplier's cut out of a total it is part of. */
function splitOf(
  partners: { partner: string; partnerName: string; commission: number }[],
  payees: { key: string; agency: string; commission: number }[],
): SplitRow[] {
  return [
    ...partners.map((p) => ({ key: `s-${p.partner}`, name: p.partnerName, amount: p.commission })),
    ...payees.map((a) => ({ key: `a-${a.key}`, name: a.agency, amount: a.commission })),
  ].filter((r) => r.amount > 0).sort((x, y) => y.amount - x.amount);
}

function Split({ rows }: { rows: SplitRow[] }) {
  if (!rows.length) return null;
  return (
    <div className="settle__split">
      {rows.map((r) => (
        <div key={r.key} className="settle__row">
          <span>{r.name}</span>
          <span className="settle__amt">{gbpPence(r.amount)}</span>
        </div>
      ))}
    </div>
  );
}

export function SettlementBlocks({ role, scope }: { role: Role; scope: PartnerScope }) {
  // Every figure here is money owed. The component asks rather than trusting
  // its callers to, which is the rule the commission statement follows.
  if (!maySeeCommission(role)) return null;

  const live = liveAvailable();
  const priorPartner = getCommissionSettlement(role, scope);
  const priorAgent = getAgentCommissionSettlement(role, scope);
  const openPartner = getCommissionSettlement(role, scope, 'current');
  const openAgent = getAgentCommissionSettlement(role, scope, 'current');

  const payableDue = priorPartner.partners.reduce((s, p) => s + p.commission, 0) + priorAgent.total;
  const accruingDue = openPartner.partners.reduce((s, p) => s + p.commission, 0) + openAgent.total;
  const payableSplit = splitOf(priorPartner.partners, priorAgent.payees);
  const accruingSplit = splitOf(openPartner.partners, openAgent.payees);

  return (
    <>
      <section className="card settle settle__block">
        <div className="settle__block-head">
          <div>
            <div className="kpi__label">Payable now</div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
              {live
                ? <>Commission on payments taken in <b>{priorPartner.monthLabel}</b>, net of refunds, payable on <b>{fullDate(priorPartner.settlementDate)}</b>.</>
                : 'Commission settlement appears here in live mode.'}
            </div>
          </div>
          {live && payableDue > 0 && <span className="settle__amt settle__block-amt">{gbpPence(payableDue)}</span>}
        </div>
        {/* NAMED, not "the prior month": a reader reconciling their own books
            wants to know which month has nothing in it. */}
        {live && payableDue === 0 && (
          <div className="muted" style={{ fontSize: 13 }}>Nothing accrued in {priorPartner.monthLabel}.</div>
        )}
        {live && <Split rows={payableSplit} />}
      </section>

      {/* THE BLOCK THAT DID NOT EXIST. Drawn whenever money is accruing, and
          also when nothing is payable, because "nothing accrued in August" on
          its own is the sentence that reads as "you have earned nothing". */}
      {live && (accruingDue > 0 || payableDue === 0) && (
        <section className="card settle settle__block">
          <div className="settle__block-head">
            <div>
              <div className="kpi__label">Accruing</div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
                <b>{openPartner.monthLabel}</b> to date. Becomes payable on <b>{dayMonth(openPartner.settlementDate)}</b>.
              </div>
            </div>
            <span className="settle__amt settle__block-amt">{gbpPence(accruingDue)}</span>
          </div>
          {accruingDue > 0
            ? <Split rows={accruingSplit} />
            : <div className="muted" style={{ fontSize: 13 }}>Nothing has accrued this month yet.</div>}
        </section>
      )}
    </>
  );
}
