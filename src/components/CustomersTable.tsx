/* =====================================================================
   EVERY CUSTOMER, SIDE BY SIDE.

   Walk fix 20: "Reporting for Opndoor admin should show volume broken down
   by partner: every supplier and every agency, side by side (referrals
   sent, fees collected, deeds issued, commission payable). Suppliers are
   currently left out of the breakdowns entirely (Kestrel appears nowhere)."

   And the centre of walk fix 15's answer (NM-F): "What he wants is to see
   the reports for each customer: each supplier and each agency."

   WHY IT IS NOT THE "COMMISSION BY PARTNER" TABLE ABOVE IT. That one groups
   by `app.partner`, and on the agency rail every agency of ours is carried
   by one house partner -- so it has ONE row for the whole agency estate,
   named after a company that does not exist outside our own schema, plus
   one per supplier. That is why Kestrel appeared nowhere and Northgate
   appeared twice on the same screen. The two tables answer different
   questions and both are kept: this one is "how is each customer doing",
   the other is "what is the commission split".

   ITS OWN COMPONENT because item 15 puts the same four measures on each
   customer's own page as well, and a table written twice is two tables.
   ===================================================================== */
import { Link } from 'react-router-dom';
import { gbpPence } from '@/lib/format';
import type { CustomerRow } from '@/data/liveAnalytics';
import { Card, CardHead } from '@/components/ui/Card';
import './CustomersTable.css';

export function CustomersTable({ rows, seesCommission }: {
  rows: CustomerRow[];
  /** Commission payable is a commission figure. The column is dropped
   *  rather than zeroed for a reader who may not see one: a column of
   *  £0.00 reads as "they are owed nothing", which is a different and
   *  false statement. */
  seesCommission: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHead
        title="Every customer"
        sub="Each agency and each supplier, side by side, for the selected period. Direct signups are Opndoor's own business and are not a customer, so they are not listed."
      />
      <div className="custtab">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th className="num">Referrals sent</th>
              <th className="num">Fees collected</th>
              <th className="num">Deeds issued</th>
              {seesCommission && <th className="num">Commission payable</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>
                  {/* STRAIGHT TO THEIR OWN PAGE, which is where item 15 puts
                      the rest of their report. A name in a table that
                      cannot be opened is a lookup exercise. */}
                  {/* THE AGENCY'S ROUTE IS `id ?? name`, NOT THE NAME.
                      /agencies/:key resolves against `x.id ?? x.name`, and
                      every other agency link in the product goes through
                      the exported `agencyKey` helper for exactly that. This
                      one was written by hand with the name, so on dev --
                      where every agency has a uuid -- it landed on "Agency
                      not found" for every row. The mock book gives its
                      agencies no id at all, so `id ?? name` IS the name
                      there and the fixture agreed with the bug. */}
                  <Link to={r.kind === 'supplier'
                    ? `/partners/${encodeURIComponent(r.key.replace(/^partner:/, ''))}`
                    : `/agencies/${encodeURIComponent(r.agencyId ?? r.name)}`}>{r.name}</Link>
                  {/* Which rail, under the name: two names tell a reader
                      nothing about which kind of company each is. */}
                  <div className="dt__sub">{r.kind === 'supplier' ? 'Supplier' : 'Agency'}</div>
                </td>
                <td className="num">{r.sent}</td>
                <td className="num">{gbpPence(r.fees)}</td>
                <td className="num">{r.deeds}</td>
                {seesCommission && <td className="num">{gbpPence(r.payable)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
