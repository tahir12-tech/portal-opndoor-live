/* =====================================================================
   ONE CUSTOMER'S REPORT, on their own page.

   Walk fix 15, as answered in NM-F: "What he wants is to see the reports
   for each customer: each supplier and each agency." Matt: "yes to both
   halves. The per-customer Reporting tab is Opndoor-only; agencies and
   suppliers keep their own Reporting page as it is."

   OPNDOOR-ONLY, AND THE PAGES IT SITS ON ARE ALREADY OPNDOOR-ONLY, so the
   gate here is belt to their braces rather than the only lock: /partners
   is superadmin, and the agency page's Reporting tab is drawn only for
   Opndoor staff.

   THE SAME FOUR MEASURES AS THE ESTATE TABLE, from the same function, so a
   customer's own page and the table that lists them cannot disagree about
   their numbers. That is the whole reason this takes rows rather than
   computing its own.

   A GROUP GETS THE TABLE AS WELL. An agency page can be showing a group of
   several agencies, and then "this customer's numbers" is several
   customers' numbers; the tiles total them and the table breaks them down.
   One agency gets the tiles alone, because a one-row table under four
   tiles saying the same thing is furniture.
   ===================================================================== */
import { gbpPence } from '@/lib/format';
import type { CustomerRow } from '@/data/liveAnalytics';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { PeriodSelect } from '@/components/ui/Select';
import { CustomersTable } from '@/components/CustomersTable';
import './CustomerReport.css';

export function CustomerReport({
  rows, seesCommission, periodId, periods, onPeriod, emptyText,
}: {
  /** This customer's rows from liveByCustomer. Several for a group. */
  rows: CustomerRow[];
  seesCommission: boolean;
  periodId: string;
  periods: { value: string; label: string }[];
  onPeriod: (id: string) => void;
  /** Said when there is nothing, rather than four zeros. */
  emptyText: string;
}) {
  const sum = (pick: (r: CustomerRow) => number) => rows.reduce((n, r) => n + pick(r), 0);
  const tiles: [string, string][] = [
    ['Referrals sent', String(sum((r) => r.sent))],
    ['Fees collected', gbpPence(sum((r) => r.fees))],
    ['Deeds issued', String(sum((r) => r.deeds))],
    ...(seesCommission
      ? [['Commission payable', gbpPence(sum((r) => r.payable))] as [string, string]]
      : []),
  ];

  return (
    <>
      <Card>
        <CardHead
          title="Their numbers"
          sub="The same four measures as the estate-wide table, over the period you choose."
          actions={
            <PeriodSelect
              ariaLabel="Report period"
              value={periodId}
              onChange={onPeriod}
              options={periods}
            />
          }
        />
        <CardBody>
          {rows.length === 0 ? (
            /* FOUR ZEROS IS NOT AN ANSWER. It reads as "they did nothing",
               which is true only if the period is the reason -- and the
               reader cannot tell which from a zero. */
            <p className="soft">{emptyText}</p>
          ) : (
            <div className="custrep">
              {tiles.map(([label, value]) => (
                <div key={label} className="custrep__tile">
                  <div className="custrep__l">{label}</div>
                  <div className="custrep__v">{value}</div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Only where there is more than one: see the header. */}
      {rows.length > 1 && <CustomersTable rows={rows} seesCommission={seesCommission} />}
    </>
  );
}
