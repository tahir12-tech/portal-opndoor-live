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
      /* THE SPINNER CANNOT BE PERMANENT. Matt, 2026-10-02: "'Commission
         statements' stays on 'Building September 2026...' and never shows
         the statement or downloads. Find why ... and show a clear error
         if building ever fails."

         `getSupplierBundle` already turns every failure it can see into a
         sentence, including thrown ones. What it cannot turn into a
         sentence is a request that never answers -- and this bundle is
         the heaviest thing the product builds, a PDF and a CSV for the
         supplier plus one of each per agency, zipped. If that takes
         longer than the platform allows, or the connection is dropped,
         the promise never settles, `setBusy(false)` never runs, and the
         card sits on "Building..." with nothing to read and nothing to
         press.

         SO THE WAIT IS BOUNDED AND THE FINALLY IS UNCONDITIONAL. Sixty
         seconds is long for a document and short for a dead end. The
         timeout does not cancel the build, which may still be running
         on the other side; it ends the WAIT, which is the thing the
         reader is stuck in. */
      const TIMEOUT_MS = 60_000;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const r = await Promise.race([
          getSupplierBundle(partner, monthKey),
          new Promise<SupplierBundleResult>((resolve) => {
            timer = setTimeout(() => resolve({
              ok: false,
              error: 'Building this statement is taking longer than a minute. It may still be building; try again in a moment, and tell opndoor if it keeps happening.',
            }), TIMEOUT_MS);
          }),
        ]);
        if (!ignore) setState(r);
      } catch (e) {
        /* BELT AND BRACES. The service catches its own throws today, and
           this is here so a future edit to it cannot bring the hang
           back: an error that reaches here is shown rather than lost. */
        if (!ignore) {
          setState({ ok: false, error: e instanceof Error ? e.message : 'Could not build the statement.' });
        }
      } finally {
        if (timer) clearTimeout(timer);
        if (!ignore) setBusy(false);
      }
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
            which stops a statement being issued at all.

            AND THEY ARE SHOWN AS A PROBLEM, 2026-10-02. This was `muted`,
            which is the colour the page uses for asides, so the one
            outcome the reader has to act on looked like a footnote --
            and, next to a card that had been saying "Building..."
            indefinitely, was indistinguishable from the thing still
            working. Matt: "show a clear error if building ever fails."
            The icon and the colour are the ones every other warning on
            the estate uses. */}
        {!!months.length && !busy && state && !state.ok && (
          <p className="stmt__err">
            <Icon name="alert" size={14} />
            <span>{state.error}</span>
          </p>
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
