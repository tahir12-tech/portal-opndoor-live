/* =====================================================================
   RECENT CHANGES, ON THE AGENCY'S PAGE.

   Matt, 2026-10-01, verbatim: "Agency page: add a 'Recent changes' list
   like the supplier's, showing every change to the agency's details,
   branches, people's levels and commission deals in plain English, with
   who and when, using the shared builder."

   "LIKE THE SUPPLIER'S" IS A SPECIFICATION, so this is the supplier's
   markup: the same `pm-audit` rows, the same sentence-then-meta shape,
   the same show-all after five. What it adds is a chip, because an
   agency's history has four subjects and the supplier's has one -- a row
   reading "Position set to the Chelsea branch" needs to say whose
   position, and "Created: Chelsea" needs to say it is a branch.

   AND THE SENTENCE IS `changeSentence`, not a second wording. That was
   the point of building it: the fault it was written for is two lists
   describing the same change two different ways.
   ===================================================================== */
import { useCallback, useEffect, useState } from 'react';
import { getAgencyChanges, type AgencyChange } from '@/data/orgService';
import { changeSentence } from '@/data/changeSentence';
import { formatDate } from '@/lib/format';
import { countOf } from '@/lib/plural';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import '@/pages/PartnerManagement/PartnerManagement.css';

/** What each kind of row is called on its chip. */
const KIND_LABEL: Record<AgencyChange['subjectKind'], string> = {
  agency: 'Agency',
  branch: 'Branch',
  person: 'Person',
  deal: 'Deal',
};

export function AgencyChanges({ agencyId }: { agencyId: string | null | undefined }) {
  const toast = useToast();
  const [rows, setRows] = useState<AgencyChange[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    if (!agencyId) { setLoaded(true); return; }
    try {
      setRows(await getAgencyChanges(agencyId));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not read the changes.', 'error');
    } finally {
      setLoaded(true);
    }
  }, [agencyId, toast]);
  useEffect(() => { void load(); }, [load]);

  /* NOTHING AT ALL IS A REAL STATE and says what would appear here,
     rather than an empty box. Most agencies on a fresh estate have no
     history yet, and a card that just stops reads as broken. */
  if (loaded && rows.length === 0) {
    return (
      <Card>
        <CardHead title="Recent changes" />
        <CardBody>
          <p className="ph-note muted">
            No changes recorded yet. Edits to this agency&rsquo;s details, its branches, its
            people&rsquo;s levels and its commission deals appear here.
          </p>
        </CardBody>
      </Card>
    );
  }

  const shown = showAll ? rows : rows.slice(0, 5);

  return (
    <Card>
      <CardHead title="Recent changes" sub={loaded ? countOf(rows.length, 'change') : undefined} />
      <CardBody>
        {!loaded ? (
          <p className="ph-note muted">Loading…</p>
        ) : (
          <>
            <ul className="pm-audit">
              {shown.map((e, i) => (
                <li key={i} className="pm-audit__row">
                  <span className="pm-audit__said">
                    {/* THE CHIP SAYS WHAT THE ROW IS ABOUT, which the
                        supplier's list never needs: there, every row is
                        about the supplier. */}
                    <span className={`agc-chip agc-chip--${e.subjectKind}`}>
                      {KIND_LABEL[e.subjectKind]}
                    </span>
                    {e.subject && <b className="agc-who">{e.subject}</b>}
                    {changeSentence(e)}
                  </span>
                  <span className="pm-audit__meta">{e.actor} · {formatDate(e.at)}</span>
                </li>
              ))}
            </ul>
            {rows.length > 5 && (
              <button type="button" className="pm-audit__more" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Show fewer' : `View all ${countOf(rows.length, 'change')}`}
              </button>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
