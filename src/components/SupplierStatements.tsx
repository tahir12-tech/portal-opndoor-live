/* =====================================================================
   THE SUPPLIER'S STATEMENTS, ON THE SUPPLIER'S PAGE.

   Matt, 2026-10-01, on the supplier statement email: "If the zip would
   be over 10MB, don't attach it; instead the email links to download it
   from the supplier's Reporting page, where it's always available."

   THE EMAIL SAYS THIS EXISTS WHETHER OR NOT IT CARRIED THE ZIP. That
   sentence is in every supplier statement email, not only the ones that
   blew the cap, so this card has to answer for any month rather than
   only the month that overflowed. Until it was built the email pointed
   at a page with nothing on it, which is worse than saying nothing.

   WHY IT FETCHES RATHER THAN DERIVES, when every other statement on
   screen is computed from the hydrated book: a supplier's three-way
   split lives in a service_role function. See
   src/data/supplierStatementsService.ts.

   THE MONTHS COME FROM THE BOOK, though, and the documents come from the
   server. The list of months a supplier might ask about is just "months
   with money in them", which the reader's own applications already
   answer; asking the server for the list as well would be a round trip
   to learn something on the page. A month the book offers but the server
   has nothing for says so, in a sentence, rather than offering a
   download of nothing.
   ===================================================================== */
import { useEffect, useMemo, useState } from 'react';
import { gbpPence, possessive } from '@/lib/format';
import {
  downloadSupplierDocument, getSupplierBundle,
  type SupplierBundleResult,
} from '@/data/supplierStatementsService';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { PeriodSelect } from '@/components/ui/Select';
import { plural } from '@/lib/plural';

export interface SupplierStatementsProps {
  /** The supplier, as a slug or a uuid: the endpoint resolves either. */
  partner: string;
  supplierName: string;
  /** Months with money in them, newest first, from statementMonths(). */
  months: { key: string; label: string }[];
}

/** What each document is, in the reader's words rather than its filename. */
function documentLabel(filename: string, agencies: number): string {
  if (filename.endsWith('.zip')) {
    return agencies === 1 ? 'Agency statement (zip)' : `Agency statements (zip, ${agencies})`;
  }
  return filename.endsWith('.csv') ? 'Your statement (CSV)' : 'Your statement (PDF)';
}

export function SupplierStatements({ partner, supplierName, months }: SupplierStatementsProps) {
  const [monthKey, setMonthKey] = useState('');
  const [state, setState] = useState<SupplierBundleResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (months.length && !months.some((m) => m.key === monthKey)) setMonthKey(months[0].key);
  }, [months, monthKey]);

  /* ONE FETCH PER MONTH, and the month that was asked for is checked
     against the month that came back before anything is shown: a reader
     flicking through months faster than the function answers would
     otherwise see September's total under October's heading. */
  useEffect(() => {
    if (!monthKey || !partner) { setState(null); return; }
    let ignore = false;
    setBusy(true);
    setState(null);
    void (async () => {
      const r = await getSupplierBundle(partner, monthKey);
      if (ignore) return;
      setBusy(false);
      setState(r);
    })();
    return () => { ignore = true; };
  }, [partner, monthKey]);

  const options = useMemo(() => months.map((m) => ({ value: m.key, label: m.label })), [months]);
  const monthName = months.find((m) => m.key === monthKey)?.label ?? '';

  return (
    <Card>
      <CardHead
        title="Commission statements"
        /* `possessive`, not `${name}'s`. A supplier whose name ends in s --
           Kestrel Lettings, and most letting agency names do -- read
           "Kestrel Lettings's own statement". Reported by Matt, 2026-10-01.
           The helper exists for exactly this and already carries the
           typographic apostrophe the rest of the page uses. */
        sub={`${possessive(supplierName)} own statement, and one for each of its agencies. The same documents that were emailed.`}
        actions={months.length > 1 && (
          <PeriodSelect
            value={monthKey}
            onChange={setMonthKey}
            options={options}
            ariaLabel="Statement month"
          />
        )}
      />
      <CardBody>
        {!months.length && (
          <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
            No commission yet. A statement appears here for every month with a paid referral in it.
          </p>
        )}

        {!!months.length && busy && (
          <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>Building {monthName}...</p>
        )}

        {/* THE REFUSALS ARE SHOWN AS SENTENCES, not as a missing card. The
            two that matter both have an answer the reader can act on: a
            month with nothing in it, and the invoice email not being set,
            which stops a statement being issued at all. */}
        {!!months.length && !busy && state && !state.ok && (
          <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>{state.error}</p>
        )}

        {!busy && state?.ok && (
          <>
            <div className="stmt__level" style={{ marginBottom: 12 }}>
              {state.monthLabel} · {state.applications} {plural(state.applications ?? 0, 'application')} ·{' '}
              {gbpPence(state.total ?? 0)} · <span className="stmt__ref">{state.reference}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {(state.documents ?? []).map((doc) => (
                <Button
                  key={doc.filename}
                  variant="ghost" size="sm"
                  title={doc.filename}
                  onClick={() => downloadSupplierDocument(doc)}
                >
                  <Icon name="download" /> {documentLabel(doc.filename, state.agencies ?? 0)}
                </Button>
              ))}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
