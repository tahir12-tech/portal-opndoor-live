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
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { gbpPence } from '@/lib/format';
import type { CustomerRow } from '@/data/liveAnalytics';
import { Card, CardHead } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import './CustomersTable.css';
import { plural } from '@/lib/plural';

/* TOP TEN, AND THE REST BEHIND A CHOICE. Matt, 2026-09-30: "the 'Every
   customer' table shows the top 10 by fees collected, with a search box
   and a 'Show all' option, and a switch between Agencies and Suppliers."

   TEN IS A DEFAULT, NOT A LIMIT, which is the difference between this
   and a truncated table: the count is always stated, Show all opens the
   rest, and a search reaches a customer whether or not they are in the
   ten. A table that silently stops at ten is one a reader cannot trust
   for "is X in here". */
const TOP_N = 10;
type Which = 'all' | 'agency' | 'supplier';
const WHICH: { key: Which; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'agency', label: 'Agencies' },
  { key: 'supplier', label: 'Suppliers' },
];

export function CustomersTable({ rows, seesCommission }: {
  rows: CustomerRow[];
  /** Commission payable is a commission figure. The column is dropped
   *  rather than zeroed for a reader who may not see one: a column of
   *  £0.00 reads as "they are owed nothing", which is a different and
   *  false statement. */
  seesCommission: boolean;
}) {
  const [which, setWhich] = useState<Which>('all');
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);

  /* ALREADY SORTED BY FEES by liveByCustomer (fees, then referrals, then
     name), so "top 10 by fees collected" is the first ten and nothing is
     re-sorted here. Sorting it again would be a second opinion about the
     same question. */
  const matching = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => which === 'all' || r.kind === which)
      .filter((r) => !needle || r.name.toLowerCase().includes(needle));
  }, [rows, which, q]);

  // A search is itself a narrowing, so it shows everything it found: being
  // told "10 of 14 matches" after typing a name is the opposite of helpful.
  const searching = q.trim() !== '';
  const shown = showAll || searching ? matching : matching.slice(0, TOP_N);
  const hidden = matching.length - shown.length;

  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHead
        title="Every customer"
        sub="Each agency and each supplier, side by side, for the selected period. Direct signups are Opndoor's own business and are not a customer, so they are not listed."
        actions={(
          <div className="custtab__tools">
            <div className="custtab__seg" role="group" aria-label="Which customers">
              {WHICH.map((w) => (
                <button
                  key={w.key}
                  type="button"
                  className={`custtab__segbtn${which === w.key ? ' is-on' : ''}`}
                  aria-pressed={which === w.key}
                  onClick={() => { setWhich(w.key); setShowAll(false); }}
                >{w.label}</button>
              ))}
            </div>
            <input
              id="custtab-search"
              type="search"
              className="custtab__search"
              placeholder="Search customers"
              aria-label="Search customers"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        )}
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
            {shown.map((r) => (
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
      {/* THE COUNT IS ALWAYS STATED, so the table never quietly stops.
          A reader asking "is Kestrel in here" needs to know whether they
          are looking at all of it. */}
      <div className="custtab__foot">
        {matching.length === 0 ? (
          <span className="muted">No customer matches that.</span>
        ) : hidden > 0 ? (
          <>
            <span className="muted">
              Top {shown.length} by fees collected. {hidden} more {plural(hidden, 'customer')}.
            </span>
            <Button variant="quiet" size="sm" onClick={() => setShowAll(true)}>Show all</Button>
          </>
        ) : (
          <span className="muted">
            {searching
              ? `${matching.length} ${plural(matching.length, 'match')}.`
              : `All ${matching.length}, biggest first by fees collected.`}
            {showAll && !searching && matching.length > TOP_N && (
              <> <button type="button" className="custtab__link" onClick={() => setShowAll(false)}>Show top {TOP_N}</button></>
            )}
          </span>
        )}
      </div>
    </Card>
  );
}
