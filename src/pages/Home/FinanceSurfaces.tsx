/* =====================================================================
   FinanceSurfaces — the opndoor money-operations surfaces, lifted out of the
   Reporting dashboard so they live on the ops Home (the single Operations home):
   the partner commission settlement, the agent commission settlement, and the
   underwriter bordereau.

   Reads the SAME settlement services the dashboard does (getCommissionSettlement /
   getAgentCommissionSettlement, same role + scope), so a figure here and a
   downloaded statement foot to exactly the same numbers. This is the opndoor-staff
   (superadmin) view of settlement; a partner still sees its own payable on its
   own Reporting dashboard (management-gated there).

   Styling reuses the dashboard's .settle / .bdx classes (Dashboard.css is global).

   WHO MAY READ IT. Every figure below is money owed to somebody: the supplier's
   cut, each agency's cut, and the bordereau the underwriter is invoiced against.
   There is no part of it a Manager may hold, so the surface asks maySeeCommission
   itself instead of trusting its caller to ask. See the gate below.
   ===================================================================== */
import { CardHead } from '@/components/ui/Card';
import { useState } from 'react';
import {
  exportBranded, buildPartnerStatementDoc, buildAgentStatementDoc, exportBordereauFile,
  getCommissionSettlement, getAgentCommissionSettlement, liveAvailable, maySeeCommission,
  getBordereauRate, getBordereauRateMeta, setBordereauRate,
  type PartnerScope, type Role,
} from '@/data';
import { formatLondonDate, gbpPence } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { useToast } from '@/components/ui/Toast';
import { SettlementBlocks } from '@/components/SettlementBlocks';
import '@/pages/Dashboard/Dashboard.css';

type FinanceProps = { role: Role; partnerScope: PartnerScope };

/* =====================================================================
   THE GATE, in front of the surfaces rather than inside them.

   WHAT WAS VISIBLE BEFORE, HONESTLY: nothing that is not still visible. The one
   mount is on the ops Home under `role === 'superadmin'`, and superadmin is true
   for maySeeCommission, so this closes no hole that anybody could reach today.
   It is here because the next mount is the risk: this component is exported, its
   whole body is settlement, and a caller that widens the role by one word would
   hand a Manager the agency's payable and an underwriter export in the same
   breath. The panel is the one place that cannot be forgotten, which is the same
   reason CommissionStatement now asks for itself.

   REFUSED WHOLE, and null rather than a sentence. Every section here is money
   owed, down to the Eyebrow that labels them, and the caller draws no heading of
   its own above this, so there is no labelled void left behind: the surface is
   simply not part of that reader's home.

   A Director never reached it either (they do not get the ops Home at all), and
   Opndoor staff are untouched.
   ===================================================================== */
export function FinanceSurfaces(props: FinanceProps) {
  if (!maySeeCommission(props.role)) return null;
  return <SettlementSurfaces {...props} />;
}

/* Module scope, not nested, so its identity is stable across the parent's
   renders: a component TYPE that changes every render remounts its whole subtree
   and kills every click inside it. */
function SettlementSurfaces({ role, partnerScope }: FinanceProps) {
  const toast = useToast();
  // Same services, same role + scope as the dashboard: figures reconcile exactly.
  const settlement = getCommissionSettlement(role, partnerScope);
  const agentSettlement = getAgentCommissionSettlement(role, partnerScope);
  /* The two blocks at the top of this surface live in SettlementBlocks, which
     the agency's own Reporting mounts too: one component, so the figure an
     agency reads and the figure Opndoor reads for them cannot diverge. */
  const live = liveAvailable();

  // Money-reconciliation surface: pence on every row and total so rows always sum.
  const dmyShort = (x: Date) => formatLondonDate(x);
  const settleDate = `${settlement.settlementDate.getDate()} ${settlement.settlementDate.toLocaleDateString('en-GB', { month: 'long' })} ${settlement.settlementDate.getFullYear()}`;
  const agentSettleDate = `${agentSettlement.settlementDate.getDate()} ${agentSettlement.settlementDate.toLocaleDateString('en-GB', { month: 'long' })} ${agentSettlement.settlementDate.getFullYear()}`;
  // The two summary totals moved into SettlementBlocks with the blocks that
  // print them; what is left here is the per-payee paperwork below.
  const settleDayMonth = `${settlement.settlementDate.getDate()} ${settlement.settlementDate.toLocaleDateString('en-GB', { month: 'long' })}`;
  const agentDue = agentSettlement.total;

  // Branded, self-footing statements — read the same settlement data as the rows below.
  const downloadPartnerStatement = (partnerId: string) => void buildPartnerStatementDoc(role, partnerScope, partnerId).then(exportBranded);
  const downloadAgentStatement = (partner: string, agency: string) => void buildAgentStatementDoc(role, partnerScope, partner, agency).then(exportBranded);

  // Agent settlement can span many agencies: top 5 inline, the rest behind an expander.
  const agentTop = agentSettlement.payees.slice(0, 5);
  const agentRest = agentSettlement.payees.slice(5);
  const agentAgencyRow = (a: (typeof agentSettlement.payees)[number]) => (
    <div key={`${a.partner}-${a.agency}`} className="settle__partner">
      <div className="settle__row">
        <span>Agent commission payable to <b>{a.agency}</b></span>
        <span className="settle__amt">{gbpPence(a.commission)}</span>
      </div>
      <div style={{ marginTop: 8 }}>
        <Button variant="ghost" size="sm" onClick={() => downloadAgentStatement(a.partner, a.agency)} title={`Download a branded agent commission statement for ${a.agency} (${agentSettlement.monthLabel}). Foots to the figure above.`}>
          <Icon name="download" /> Download statement
        </Button>
      </div>
      <details className="settle__exp">
        <summary>Show applications ({a.apps.length})</summary>
        <div className="settle__apps">
          <table>
            <thead>
              <tr><th>Reference</th><th>Branch</th><th className="num">Paid</th><th className="num">Fee</th><th className="num">Agent commission</th></tr>
            </thead>
            <tbody>
              {a.apps.map((ap) => (
                <tr key={ap.ref}>
                  <td>{ap.ref}</td>
                  <td>{ap.branch}</td>
                  <td className="num">{dmyShort(ap.paidAt)}</td>
                  <td className="num">{gbpPence(ap.rent)}</td>
                  <td className="num">{gbpPence(ap.commission)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );

  // ---- underwriter bordereau (opndoor admin only) ----
  const [bdxOpen, setBdxOpen] = useState(false);
  const [bdxMonth, setBdxMonth] = useState('2026-06');
  const [bdxRate, setBdxRate] = useState(String(getBordereauRate()));
  const [bdxBusy, setBdxBusy] = useState(false);
  function openBordereau() {
    setBdxRate(String(getBordereauRate()));
    setBdxOpen(true);
  }
  async function exportBordereau() {
    if (bdxBusy) return;
    const mv = (bdxMonth || '2026-06').split('-');
    const parsed = parseFloat(bdxRate);
    const rate = isNaN(parsed) ? getBordereauRate() : parsed;
    setBdxBusy(true);
    try {
      // Persist the applied rate (audited if it changed) so the next export defaults to it.
      await setBordereauRate(rate);
      await exportBordereauFile(role, +mv[0], +mv[1] - 1, rate);
      setBdxOpen(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the insurance rate.', 'error');
    } finally {
      setBdxBusy(false);
    }
  }

  const hasPartner = live && settlement.partners.length > 0;
  const hasAgent = live && agentSettlement.payees.length > 0;
  const isAdmin = role === 'superadmin';

  return (
    <div className="dash-grid">
      <div className="section-label"><Eyebrow>Settlements</Eyebrow></div>

      <SettlementBlocks role={role} scope={partnerScope} />

      {/* COMMISSION SETTLEMENT (partner, prior calendar month, payable the 15th) */}
      {hasPartner && (
        <section className="card settle">
          <CardHead
            title={<>Supplier commission settlement</>}
            sub={<>Supplier commission accrued on payments in <b>{settlement.monthLabel}</b> (calendar month, net of refunds), payable on <b>{settleDate}</b>.</>}
          />
          {settlement.partners.map((p) => (
            <div key={p.partner} className="settle__partner">
              <div className="settle__row">
                <span>Commission payable to <b>{p.partnerName}</b></span>
                <span className="settle__amt">{gbpPence(p.commission)}</span>
              </div>
              <div style={{ marginTop: 8 }}>
                <Button variant="ghost" size="sm" onClick={() => downloadPartnerStatement(p.partner)} title={`Download a branded partner commission statement for ${p.partnerName} (${settlement.monthLabel}). Foots to the figure above.`}>
                  <Icon name="download" /> Download statement
                </Button>
              </div>
              <details className="settle__exp">
                <summary>Show applications ({p.apps.length})</summary>
                <div className="settle__apps">
                  <table>
                    <thead>
                      <tr><th>Reference</th><th>Branch</th><th className="num">Paid</th><th className="num">Fee</th><th className="num">Commission</th></tr>
                    </thead>
                    <tbody>
                      {p.apps.map((ap) => (
                        <tr key={ap.ref}>
                          <td>{ap.ref}</td>
                          <td>{ap.branch}{ap.agency ? ` · ${ap.agency}` : ''}</td>
                          <td className="num">{dmyShort(ap.paidAt)}</td>
                          <td className="num">{gbpPence(ap.rent)}</td>
                          <td className="num">{gbpPence(ap.commission)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          ))}
        </section>
      )}

      {/* AGENT COMMISSION SETTLEMENT (agency level, prior calendar month, payable the 15th) */}
      {hasAgent && (
        <section className="card settle">
          <CardHead
            title={<>Agent commission settlement</>}
            sub={<>Agent commission accrued on payments in <b>{agentSettlement.monthLabel}</b> (calendar month, net of refunds), payable to each payee on <b>{agentSettleDate}</b>.</>}
          />
          <div className="settle__row settle__row--agg">
            <span>Agent commission due <b>{settleDayMonth}</b> across <b>{agentSettlement.payees.length}</b> {agentSettlement.payees.length === 1 ? 'payee' : 'payees'}</span>
            <span className="settle__amt">{gbpPence(agentDue)}</span>
          </div>
          {agentTop.map(agentAgencyRow)}
          {agentRest.length > 0 && (
            <details className="settle__exp settle__exp--more">
              <summary>View all {agentSettlement.payees.length} payees</summary>
              {agentRest.map(agentAgencyRow)}
            </details>
          )}
        </section>
      )}

      {/* UNDERWRITER BORDEREAU (opndoor admin only) */}
      {isAdmin && (
        <section className="card">
          {/* "IN FORCE DURING THE MONTH", which is what this has actually
              listed since the inForce rule landed. The description still
              said "by tenancy start date", which is the behaviour that was
              FIXED: asking when cover was WRITTEN meant a guarantee still
              running from an earlier month appeared on no bordereau at all.
              The copy was describing the bug. Matt, 2026-09-30. */}
          <CardHead
            title={<>Underwriter bordereau</>}
            sub={<>Monthly export (C&amp;C format) with full tenant details: every guarantee in force during the month, whenever it started. Contains personal data, for the underwriter only.</>}
            actions={
            <Button variant="primary" size="sm" onClick={openBordereau} title="Monthly underwriter bordereau (C&C format) with full tenant details. opndoor admin only.">
            <Icon name="shield" /> Bordereau
            </Button>
            }
          />
        </section>
      )}

      {/* BORDEREAU MODAL (opndoor admin only) */}
      {bdxOpen && isAdmin && (
        <div className="bdx-scrim is-open" onMouseDown={(e) => e.target === e.currentTarget && setBdxOpen(false)}>
          <div className="bdx" role="dialog" aria-modal="true">
            <div className="bdx__head">
              <div>
                <div className="bdx__title">Monthly bordereau</div>
                <div className="bdx__sub">Underwriter export (C&amp;C format) with full tenant details: every guarantee in force during the month, whenever it started. opndoor admin only.</div>
              </div>
              <button className="bdx__close" aria-label="Close" onClick={() => setBdxOpen(false)}><Icon name="x" /></button>
            </div>
            <div className="bdx__body">
              <div className="field">
                <label htmlFor="bdx-month">Month (cover in force)</label>
                <input type="month" id="bdx-month" min="2024-09" max="2026-12" value={bdxMonth} onChange={(e) => setBdxMonth(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="bdx-rate">Insurance rate applied to every row</label>
                <div className="bdx__rate">
                  <input type="number" id="bdx-rate" step="0.1" min="0" max="100" value={bdxRate} onChange={(e) => setBdxRate(e.target.value)} />
                  <span>%</span>
                </div>
                <span className="hint">
                  {(() => { const m = getBordereauRateMeta(); return `Current rate: ${m.rate}%${m.changedAt ? ` · last changed ${dmyShort(m.changedAt)} by ${m.changedBy ?? 'an administrator'}` : ' (default)'}.`; })()}
                  {' '}Changing it here saves the new rate for future exports and records who changed it and when.
                </span>
              </div>
              <div className="bdx__warn">
                <Icon name="alert" />
                <span>Contains full tenant personal data. For the underwriter only. Never share with partner users.</span>
              </div>
            </div>
            <div className="bdx__foot">
              <Button variant="ghost" onClick={() => setBdxOpen(false)} disabled={bdxBusy}>Cancel</Button>
              <Button variant="primary" onClick={exportBordereau} disabled={bdxBusy}>{bdxBusy ? 'Saving…' : 'Export bordereau'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
