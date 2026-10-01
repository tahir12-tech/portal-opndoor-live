/* =====================================================================
   ONE PEOPLE TABLE, ON EVERY PEOPLE SCREEN.

   Matt, 2026-10-01, verbatim: "Use one shared people table on every
   people screen (agency Team as a Director sees it, admin agency People,
   supplier People, opndoor team): fixed aligned columns Name (initials,
   name, email below), Level, Office, Status, Last active, and actions
   right-aligned, so every row lines up. Search and level/status filters
   styled like the rest of the portal. When someone has no name yet, show
   the email once with 'Name not set' beneath, not the email twice."

   =====================================================================
   WHY FOUR SCREENS DREW FOUR TABLES
   =====================================================================

   Each was written when its own page was, and each answered the same
   questions slightly differently: Team drew cards rather than rows, the
   agency tab put Agency and Office in separate columns, the supplier tab
   had a Sees column and no Office, and the opndoor team page had Last
   active in a different place. Nothing was wrong on any of them on its
   own; together they meant four places to fix anything about a person,
   and a reader moving between them re-learning where to look.

   TWO THINGS THE SHARED TABLE DECIDES, and they are the ones that keep
   coming back:

     a person with no name    `personLabel` prints the email once with
                              "Name not set" under it, never the address
                              twice in two sizes
     a column nobody fills    Office is dropped when no row has one, so a
                              supplier's staff -- who hold no office --
                              do not read a column of dashes

   AND ONE IT DOES NOT. The `extra` column exists for the supplier tab's
   "Sees", which is its own instruction from the same day and is about
   what a Developer can reach. A fixed set of columns that loses a column
   somebody asked for is not a simplification.
   ===================================================================== */
import { useMemo, useState, type ReactNode } from 'react';
import { personInitials, personLabel } from '@/data/personLabel';
import { Pill, type PillVariant } from '@/components/ui/Pill';
import './PeopleTable.css';

export interface PeopleTableRow {
  id: string;
  name: string | null;
  email: string;
  /** The word this rail uses: Director, Manager, Negotiator, Developer. */
  level: string;
  /** Where they sit. Null on a rail with no offices. */
  office?: string | null;
  /** A second line under the office, for the agency when several are in view. */
  officeSub?: string | null;
  status: string;
  lastActive?: string | null;
  /** Right-aligned, and the only part of a row a screen draws itself. */
  actions?: ReactNode;
  /** "You", beside the name. */
  tag?: ReactNode;
  /** The supplier tab's "Sees", and nothing else so far. */
  extra?: ReactNode;
}

/* "INVITED", NOT "PENDING", which is the word Team argued for and the one
   worth keeping: what is pending is an invitation, and "Pending" beside a
   name reads as a person whose status is undecided. */
const STATUS_PILL: Record<string, [string, PillVariant]> = {
  active: ['Active', 'deed'],
  pending: ['Invited', 'warn'],
  deactivated: ['Deactivated', 'muted'],
};

export function PeopleTable({
  rows, extraHeader, officeHeader = 'Office', emptyText = 'Nobody matches those filters.',
  showFilters = true,
}: {
  rows: PeopleTableRow[];
  /** Header for the optional extra column. Omitted drops the column. */
  extraHeader?: string;
  officeHeader?: string;
  emptyText?: string;
  showFilters?: boolean;
}) {
  const [q, setQ] = useState('');
  const [level, setLevel] = useState('');
  const [status, setStatus] = useState('');

  const levels = useMemo(
    () => [...new Set(rows.map((r) => r.level).filter(Boolean))].sort(),
    [rows],
  );
  const statuses = useMemo(
    () => [...new Set(rows.map((r) => r.status).filter(Boolean))],
    [rows],
  );
  /* A COLUMN NOBODY FILLS IS NOT A COLUMN, which is the rule the
     Applications list already applies to Agency and Branch. */
  const showOffice = rows.some((r) => (r.office ?? '').trim() !== '');
  const showExtra = !!extraHeader && rows.some((r) => r.extra != null);
  const showLastActive = rows.some((r) => (r.lastActive ?? '').trim() !== '');
  const showActions = rows.some((r) => r.actions != null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (level && r.level !== level) return false;
      if (status && r.status !== status) return false;
      if (!needle) return true;
      return [r.name ?? '', r.email, r.level, r.office ?? '', r.officeSub ?? '']
        .some((v) => v.toLowerCase().includes(needle));
    });
  }, [rows, q, level, status]);

  return (
    <>
      {showFilters && (
        <div className="ppl-filters">
          <input
            className="inp ppl-filters__q"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, email or office"
            aria-label="Search people"
          />
          {levels.length > 1 && (
            <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Level">
              <option value="">All levels</option>
              {levels.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
          {statuses.length > 1 && (
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="">Any status</option>
              {statuses.map((s) => (
                <option key={s} value={s}>{STATUS_PILL[s]?.[0] ?? s}</option>
              ))}
            </select>
          )}
          {(q || level || status) && (
            <button
              type="button"
              className="ah-linkbtn ah-linkbtn--quiet"
              onClick={() => { setQ(''); setLevel(''); setStatus(''); }}
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="ppl-empty">{emptyText}</div>
      ) : (
        <table className="dt ppl-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Level</th>
              {showExtra && <th>{extraHeader}</th>}
              {showOffice && <th>{officeHeader}</th>}
              <th>Status</th>
              {showLastActive && <th>Last active</th>}
              {showActions && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const who = personLabel(r.name, r.email);
              const [label, variant] = STATUS_PILL[r.status] ?? [r.status, 'muted' as PillVariant];
              return (
                <tr key={r.id}>
                  <td>
                    <span className="ppl-who">
                      <span className="who__av">{personInitials(who)}</span>
                      <span className="ppl-who__txt">
                        <span className="dt__name">{who.title}{r.tag}</span>
                        <span className="dt__sub">{who.sub}</span>
                      </span>
                    </span>
                  </td>
                  <td className="ppl-level">{r.level}</td>
                  {showExtra && <td className="soft">{r.extra}</td>}
                  {showOffice && (
                    <td className="soft">
                      {r.office || '-'}
                      {r.officeSub && <span className="dt__sub">{r.officeSub}</span>}
                    </td>
                  )}
                  <td><Pill variant={variant}>{label}</Pill></td>
                  {showLastActive && <td className="soft">{r.lastActive || '-'}</td>}
                  {showActions && <td className="ppl-acts">{r.actions}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
