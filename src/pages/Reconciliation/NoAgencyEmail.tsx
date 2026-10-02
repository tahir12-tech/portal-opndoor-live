/* =====================================================================
   AGENCIES IN A SUPPLIER'S ESTATE WITH NO AGENCY EMAIL.

   Matt, 2026-10-02: "For supplier-estate agencies with no agency email,
   show a clear warning on the supplier's Agencies tab and list them on
   Reconciliation so Opndoor can add one. No warnings for Opndoor's own
   agencies without an email."

   THE SUBJECT IS THE DEFAULT, NOT A STRANDED DEED. Under the corrected
   rule the agency email is what every branch inherits, so an agency
   without one has no default and the next office added under it inherits
   nothing. An agency whose offices each hold a mailbox of their own is
   therefore on this list with nothing stranded today -- and the row says
   that, in those words, because a screen that shouts the same way at
   both cases is a screen people stop reading. Kestrel Lettings on dev is
   the quiet case: it is here, and it is not an incident.

   A LIST AND NOTHING ELSE, like "Not in network" beside it, whose card
   markup this borrows so the two read as one screen. The fix is to open
   that agency and add a contact, which is the Agencies screen's job, and
   a button here would be a second way to do one thing.

   NO ADDRESS IS SUGGESTED. "Don't invent or copy addresses" -- so this
   does not offer an office's address to promote, or the first person on
   the org, although both are one query away.
   ===================================================================== */
import { useCallback, useEffect, useState } from 'react';
import { loadSupplierAgenciesWithoutAnEmail, type AgencyWithoutAnEmail } from '@/data';
import { useToast } from '@/components/ui/Toast';
import { Icon } from '@/components/ui/Icon';
import { plural } from '@/lib/plural';
import './NotInNetwork.css';

export function NoAgencyEmail() {
  const toast = useToast();
  const [rows, setRows] = useState<AgencyWithoutAnEmail[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setRows(await loadSupplierAgenciesWithoutAnEmail()); }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not load the list.', 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  /* `empty is-shown`, as its sibling uses: an empty state with no `is-shown`
     renders nothing at all, which is the fault anEmptyStateIsVisible.test.ts
     exists to catch. */
  if (loading) return <div className="empty is-shown">Loading.</div>;
  if (rows.length === 0) {
    return (
      <div className="empty is-shown">
        Every agency that comes through a supplier has an agency email. They land here when one
        is created without it, which only older rows can be: an agency email is required at
        creation on the supplier side.
      </div>
    );
  }

  return (
    <div className="nin">
      <p className="nin__lede">
        An agency that comes through a supplier needs an <b>agency email</b>. It is where a signed
        deed goes, and the default every office of theirs inherits unless that office has its own.
        Open the agency on its supplier&rsquo;s page and add a contact.
      </p>
      {rows.map((r) => {
        const stranded = r.branches - r.branchesCovered;
        return (
          <section className="nin__card" key={r.agencyId}>
            <div className="nin__head">
              <div>
                <h3 className="nin__name">{r.agencyName}</h3>
                <div className="nin__meta">
                  under <b>{r.partnerName}</b> · <b>{r.branches}</b> {plural(r.branches, 'office')}
                </div>
              </div>
            </div>
            {/* WHICH OF THE TWO CASES THIS IS, said rather than implied. */}
            <div className="nin__none">
              <Icon name={stranded > 0 ? 'alert' : 'info'} size={14} />
              {stranded > 0
                ? <>
                    <b>{stranded}</b> of {r.branches} {plural(r.branches, 'office')} has nowhere to
                    send a deed. An application against one of those will be accepted, the tenant
                    will pay, and the deed will then fail.
                  </>
                : <>
                    Every office has an address of its own, so nothing is stranded today. The next
                    office added here would inherit nothing.
                  </>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
