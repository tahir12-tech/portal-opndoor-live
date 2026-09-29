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

   A column that says the same thing on every line is not drawn: see
   src/data/statementColumns.ts, which is also where the PDF and the CSV get
   the answer, so the three cannot show different columns for one month.

   WHO MAY READ IT. Directors and Opndoor staff, and nobody else: the panel
   asks maySeeCommission itself rather than trusting the two callers to ask for
   it. See the gate on CommissionStatement below.
   ===================================================================== */
import { gbpPence } from '@/lib/format';
import { useEffect, useMemo, useState } from 'react';
import {
  buildAllStatementsCsv, buildCommissionStatementDoc, downloadCsv, exportBranded,
  getCommissionStatements, maySeeCommission,
  statementMonths, type CommissionStatement as Statement,
} from '@/data';
import type { PartnerScope, Role } from '@/data';
import { SOURCE_LABEL } from '@/data/commissionSplit';
import type { CommissionSource } from '@/data/types';
import {
  dimensionCollapsed, statementShape, type StatementDimension,
} from '@/data/statementColumns';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { PeriodSelect } from '@/components/ui/Select';
import './CommissionStatement.css';

const money = gbpPence;
const pct = (n: number) => `${Number((n * 100).toFixed(2))}%`;
const dmy = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
/** A frozen line's source in the reader's words. Falls back to the stored code
    rather than to a blank, so a source we stop labelling is still legible. */
const sourceWord = (s: string) => SOURCE_LABEL[s as CommissionSource] ?? s;

/** The columns, in the order the PDF and the CSV declare them in
    supabase/functions/commission-statements/index.ts, so a reader can hold the
    three side by side. No widths: the page has CSS, and the only thing this
    list has to agree with is WHICH columns there are.

    NO AGENCY COLUMN, and not an oversight: a StatementLine carries the branch
    and not the agency, so on a group statement spanning two agencies there is
    nothing to put in the cells. The rule already answers for that dimension
    (statementShape().oneAgency); the day a line carries an agency, the column
    is one entry here and one cell below. */
const HEADS: { label: string; num?: boolean; dim?: StatementDimension }[] = [
  { label: 'Reference' },
  { label: 'Tenant' },
  { label: 'Branch', dim: 'branch' },
  { label: 'Tenancy' },
  { label: 'Share', num: true },
  { label: 'Paid' },
  { label: 'Fee charged', num: true },
  { label: 'Rate', num: true },
  { label: 'Source', dim: 'source' },
  { label: 'Commission', num: true },
];

type PanelProps = {
  role: Role;
  scope: PartnerScope;
  /** Narrow to one payee by org id. Omitted on the agency's own Reporting page,
      where every payee they can see is theirs anyway; supplied by the admin
      Commission tab, which is looking at one agency out of many. */
  orgId?: string | null;
  title?: string;
};

/* =====================================================================
   THE GATE, in front of the panel rather than around it.

   WHAT A MANAGER COULD SEE BEFORE THIS. Both callers gated on role alone and a
   Manager is role 'management', so Reporting drew them the agency's month in
   full: every line's rate and commission, the payee total, the month selector
   to walk back through earlier months, and an Export button that handed them
   the same statement as a PDF. The database was never the leak; the screen
   read it out of analytics and printed it.

   REFUSED WHOLE, not blanked column by column. There is no version of this
   panel that survives the rule: the total is commission, the rate is
   commission, the month list is a list of months the agency earned in, and the
   export is the statement entire. The one figure on it a Manager is entitled to
   is the fee the tenant was charged, and they read that on the referral itself,
   where it belongs, not off a settlement ledger.

   WHY THE PANEL ASKS AS WELL AS THE CALLERS. Both callers do refuse a Manager
   already, and correctly: Reporting wraps the section in <RoleOnly commission>
   so its "Your commission" eyebrow goes with it, and the admin Commission tab
   is not even listed without maySeeCommission. So on the two homes that exist
   today this gate never fires. It is here for the third home: two callers is
   already enough to forget one, and a panel that depends on being asked
   politely is one copy-paste away from putting the agency's month back on a
   Manager's screen.

   WHY A LINE AND NOT null, for that third caller. A caller that failed to gate
   has already drawn a heading or an eyebrow of its own, and a null under it
   leaves a labelled section with a void in it, which reads as a page that
   failed to load rather than a level that does not include this. One sentence
   says which it is, in the same words the level itself uses (AGENCY_LEVELS in
   src/data/types.ts). No CardHead of our own: a heading reading "Commission
   statement" over a refusal promises a statement below it, and whatever the
   caller drew is the heading already.

   Directors and Opndoor staff are untouched, maySeeCommission is true for both,
   and a Negotiator never reached this panel: their callers do not list
   'referrer'.
   ===================================================================== */
export function CommissionStatement(props: PanelProps) {
  if (!maySeeCommission(props.role)) {
    return (
      <Card>
        <CardBody>
          <p className="muted" style={{ fontSize: 13.5 }}>
            Commission figures are not shown at your level. Every referral, every branch and the
            team stay yours to see.
          </p>
        </CardBody>
      </Card>
    );
  }
  return <StatementPanel {...props} />;
}

/* The panel proper. Split out so the gate above holds no hooks: a reader whose
   entitlement changes under a mounted page then swaps one component for the
   other, instead of changing how many hooks this one calls between renders. */
function StatementPanel({
  role, scope, orgId, title = 'Commission statement',
}: PanelProps) {
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
    const mine = orgId ? all.filter((s) => s.orgId === orgId) : all;
    /* NO STATEMENT FOR A PARTY WITH NO COMMISSION. The direct route hangs off a
       placeholder agency called "Unattached", which earns nobody anything and
       appeared in this list every month as a payee with a zero total: a
       statement for a party that is not a party, about money that does not
       exist. Sorted by total because that is the order the month is read in. */
    return mine
      .filter((s) => s.total > 0 && s.lines.length > 0)
      .sort((a, b) => b.total - a.total);
  }, [role, scope, monthKey, orgId]);

  /* WHICH PAYEE IS OPEN. The panel used to stack every payee's full table down
     one page: on a book with thirty agencies that is thirty tables, and finding
     one of them meant scrolling past the other twenty-nine. The list is the
     month; a payee is opened out of it.

     ONE PAYEE NEEDS NO LIST. The agency Commission tab passes orgId and gets a
     single statement, which is what a link from that tab should land on. */
  const [openPayee, setOpenPayee] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const single = !!orgId || statements.length === 1;
  const shown = single ? statements : statements.filter((s) => s.payeeKey === openPayee);
  // A payee that vanishes under the reader (month changed, book re-hydrated)
  // must not leave the panel showing nothing with no way back to the list.
  useEffect(() => {
    if (openPayee && !statements.some((s) => s.payeeKey === openPayee)) setOpenPayee(null);
  }, [statements, openPayee]);
  const listed = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? statements.filter((s) => s.payeeName.toLowerCase().includes(needle)) : statements;
  }, [statements, q]);

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
          <span className="stmt__tools">
            {/* ONE FILE FOR THE MONTH. Per-payee Export sends a payee their own
                paperwork; this is the month-end job, and doing it one agency at
                a time was thirty downloads. */}
            {!single && statements.length > 0 && (
              <Button
                variant="ghost" size="sm"
                title={`Every payee's ${months.find((m) => m.key === monthKey)?.label ?? 'month'} lines in one sheet.`}
                onClick={() => {
                  const out = buildAllStatementsCsv(role, scope, monthKey);
                  if (out) downloadCsv(out.csv, out.filename);
                }}
              >
                <Icon name="download" /> Export all
              </Button>
            )}
            <PeriodSelect
              ariaLabel="Statement month"
              value={monthKey}
              onChange={setMonthKey}
              options={months.map((m) => ({ value: m.key, label: m.label }))}
            />
          </span>
        }
      />
      <CardBody>
        {statements.length === 0 ? (
          <p className="muted" style={{ fontSize: 13.5 }}>No commission accrued in this month.</p>
        ) : !single && !openPayee ? (
          /* THE MONTH, AS A LIST OF WHO IS OWED WHAT. */
          <div className="stmt-list">
            <div className="stmt-list__tools">
              <input
                type="text" className="stmt-list__q" placeholder="Search payee"
                aria-label="Search payee" value={q} onChange={(e) => setQ(e.target.value)}
              />
              <span className="muted" style={{ fontSize: 12.5 }}>
                {listed.length} of {statements.length} {statements.length === 1 ? 'payee' : 'payees'}
              </span>
            </div>
            {listed.length === 0 ? (
              <p className="muted" style={{ fontSize: 13.5 }}>No payee matches that search.</p>
            ) : (
              <div className="table-wrap">
                <table className="stmt__table">
                  <thead>
                    <tr><th>Payee</th><th>Level</th><th className="num">Applications</th><th className="num">Total</th></tr>
                  </thead>
                  <tbody>
                    {listed.map((st) => (
                      <tr key={st.payeeKey} className="stmt-list__row" onClick={() => setOpenPayee(st.payeeKey)}>
                        <td>
                          <button className="stmt-list__name" onClick={(e) => { e.stopPropagation(); setOpenPayee(st.payeeKey); }}>
                            {st.payeeName}
                          </button>
                        </td>
                        <td className="muted">{st.level === 'agency' ? 'Agency' : st.level === 'group' ? 'Group' : 'Branch'}</td>
                        <td className="num">{st.lines.length}</td>
                        <td className="num">{money(st.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : shown.map((st) => {
          // PER PAYEE, not per screen. Two payees in the same month can have
          // different answers, and each block may only say what its own lines
          // say: a group with two branches keeps the column that the branch
          // below it has no use for.
          const shape = statementShape(st.lines.map((l) => ({ branch: l.branch, source: l.source })));
          const heads = HEADS.filter((h) => !h.dim || !dimensionCollapsed(shape, h.dim));
          return (
            <div key={st.payeeKey} className="stmt">
              <div className="stmt__head">
                <div>
                  {!single && (
                    <button className="stmt__back" onClick={() => setOpenPayee(null)}>
                      <Icon name="arrowLeft" size={13} /> All payees
                    </button>
                  )}
                  <div className="stmt__payee">{st.payeeName}</div>
                  <div className="stmt__level">{st.level === 'agency' ? 'Agency' : st.level === 'group' ? 'Group' : 'Branch'} · {st.monthLabel}</div>
                  {/* TWO LINES, ALWAYS. A third used to appear here whenever a
                      column collapsed, "Branch: Soho · Source: Agreement", on
                      the principle that the value should not be lost with its
                      column. Withdrawn: the payee knows which of their own
                      branches this is, and a block that grows a line whenever
                      the table loses one changes shape month to month for no
                      gain. Dropping a column removes something that says
                      nothing; moving it up here says the same nothing higher
                      up. See src/data/statementColumns.ts. */}
                </div>
                {/* The builder is async now: it reads the statement's stored
                    reference from the database rather than deriving one from the
                    payee's name, which changed when an agency was renamed. */}
                <Button
                  variant="ghost" size="sm"
                  title={`Download ${st.payeeName}'s ${st.monthLabel} statement. Foots to the total below.`}
                  onClick={() => void buildCommissionStatementDoc(role, scope, st.monthKey, st.payeeKey).then(exportBranded)}
                >
                  <Icon name="download" /> Export
                </Button>
              </div>
              <div className="table-wrap">
                <table className="stmt__table">
                  <thead>
                    <tr>
                      {heads.map((h) => (
                        <th key={h.label} className={h.num ? 'num' : undefined}>{h.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {st.lines.map((l, i) => (
                      <tr key={`${l.ref}-${i}`}>
                        <td>{l.ref}</td>
                        <td>{l.tenant}</td>
                        {/* The house empty glyph, for the mixed statement where
                            some lines name a branch and some cannot: that is the
                            case the column survives for. */}
                        {!shape.oneBranch && <td>{l.branch || '-'}</td>}
                        {/* A tenancy of one is not a joint tenancy; saying "1 of 1" invents one. */}
                        <td>{l.tenancyPlace ? `Joint, ${l.tenancyPlace}` : 'Single'}</td>
                        <td className="num">{l.sharePercent == null ? '100%' : `${l.sharePercent}%`}</td>
                        <td>{dmy(l.paidAt)}</td>
                        <td className="num">{money(l.fee)}</td>
                        <td className="num">{pct(l.rate)}</td>
                        {/* A line frozen before the source was recorded says so,
                            rather than being labelled the standard on a guess. */}
                        {!shape.oneSource && (
                          <td>{l.source ? sourceWord(l.source) : <span className="muted">Not recorded</span>}</td>
                        )}
                        <td className="num">{money(l.commission)}</td>
                      </tr>
                    ))}
                    <tr className="stmt__total">
                      {/* Every column but the money one, however many that is today. */}
                      <td colSpan={heads.length - 1}>Total · {st.lines.length} application{st.lines.length === 1 ? '' : 's'}</td>
                      <td className="num">{money(st.total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
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
