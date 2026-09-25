/* =====================================================================
   THE COMMISSION STATEMENT, as a panel.

   One component, two homes, deliberately: an agency manager reads it on
   Reporting for their own agency, and an Opndoor admin reads the identical
   thing on an agency's Commission tab. Two renderings of one statement is how
   the two come to disagree, and the whole point of this screen is that it
   agrees — with the settlement, and with itself.

   It states its own basis rather than assuming the reader shares ours:
   commission on fees PAID in the month, refunds excluded. That is the rule the
   settlement uses, so "why is this different from what you paid me" has an
   answer on the page.
   ===================================================================== */
import { useEffect, useMemo, useState } from 'react';
import {
  buildCommissionStatementDoc, exportBranded, getCommissionStatements, statementMonths,
  type CommissionStatement as Statement,
} from '@/data';
import type { PartnerScope, Role } from '@/data';
import { SOURCE_LABEL } from '@/data/commissionSplit';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { PeriodSelect } from '@/components/ui/Select';
import './CommissionStatement.css';

const money = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${Number((n * 100).toFixed(2))}%`;
const dmy = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

export function CommissionStatement({
  role, scope, orgId, title = 'Commission statement',
}: {
  role: Role;
  scope: PartnerScope;
  /** Narrow to one payee by org id. Omitted on the agency's own Reporting page,
      where every payee they can see is theirs anyway; supplied by the admin
      Commission tab, which is looking at one agency out of many. */
  orgId?: string | null;
  title?: string;
}) {
  const months = useMemo(() => statementMonths(role, scope), [role, scope]);
  const [monthKey, setMonthKey] = useState('');
  // Default to the most recent month with money in it, and follow it if the
  // book changes underneath — never to a month that would render empty.
  useEffect(() => {
    if (months.length && !months.some((m) => m.key === monthKey)) setMonthKey(months[0].key);
  }, [months, monthKey]);

  const statements: Statement[] = useMemo(() => {
    if (!monthKey) return [];
    const all = getCommissionStatements(role, scope, monthKey);
    return orgId ? all.filter((s) => s.orgId === orgId) : all;
  }, [role, scope, monthKey, orgId]);

  if (!months.length) {
    return (
      <Card>
        <CardHead title={title} sub="Commission on fees paid in the month, net of refunds." />
        <CardBody>
          <p className="muted" style={{ fontSize: 13.5 }}>
            Nothing has been paid yet, so there is no statement to show. One appears here as soon as
            a referral reaches Paid.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHead
        title={title}
        sub="Every application that paid in the month, what it was charged, and the commission it earned. Net of refunds, and the same figures as settlement."
        actions={
          <PeriodSelect
            ariaLabel="Statement month"
            value={monthKey}
            onChange={setMonthKey}
            options={months.map((m) => ({ value: m.key, label: m.label }))}
          />
        }
      />
      <CardBody>
        {statements.length === 0 ? (
          <p className="muted" style={{ fontSize: 13.5 }}>No commission accrued in this month.</p>
        ) : statements.map((st) => (
          <div key={st.payeeKey} className="stmt">
            <div className="stmt__head">
              <div>
                <div className="stmt__payee">{st.payeeName}</div>
                <div className="stmt__level">{st.level === 'agency' ? 'Agency' : st.level === 'group' ? 'Group' : 'Branch'} · {st.monthLabel}</div>
              </div>
              <Button
                variant="ghost" size="sm"
                title={`Download ${st.payeeName}'s ${st.monthLabel} statement. Foots to the total below.`}
                onClick={() => void exportBranded(buildCommissionStatementDoc(role, scope, st.monthKey, st.payeeKey))}
              >
                <Icon name="download" /> Export
              </Button>
            </div>
            <div className="table-wrap">
              <table className="stmt__table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Tenant</th>
                    <th>Branch</th>
                    <th>Tenancy</th>
                    <th className="num">Share</th>
                    <th>Paid</th>
                    <th className="num">Fee charged</th>
                    <th className="num">Rate</th>
                    <th>Source</th>
                    <th className="num">Commission</th>
                  </tr>
                </thead>
                <tbody>
                  {st.lines.map((l, i) => (
                    <tr key={`${l.ref}-${i}`}>
                      <td>{l.ref}</td>
                      <td>{l.tenant}</td>
                      <td>{l.branch}</td>
                      {/* A tenancy of one is not a joint tenancy; saying "1 of 1" invents one. */}
                      <td>{l.tenancyPlace ? `Joint, ${l.tenancyPlace}` : 'Single'}</td>
                      <td className="num">{l.sharePercent == null ? '100%' : `${l.sharePercent}%`}</td>
                      <td>{dmy(l.paidAt)}</td>
                      <td className="num">{money(l.fee)}</td>
                      <td className="num">{pct(l.rate)}</td>
                      {/* A line frozen before the source was recorded says so,
                          rather than being labelled the standard on a guess. */}
                      <td>{l.source ? SOURCE_LABEL[l.source] : <span className="muted">Not recorded</span>}</td>
                      <td className="num">{money(l.commission)}</td>
                    </tr>
                  ))}
                  <tr className="stmt__total">
                    <td colSpan={9}>Total · {st.lines.length} application{st.lines.length === 1 ? '' : 's'}</td>
                    <td className="num">{money(st.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </CardBody>
      <CardFoot>
        <span className="muted" style={{ fontSize: 12.5 }}>
          Commission accrues on the date the fee was <b>paid</b>. A refunded fee earns nothing and is
          not listed. These are the same figures Opndoor settles from.
        </span>
      </CardFoot>
    </Card>
  );
}
