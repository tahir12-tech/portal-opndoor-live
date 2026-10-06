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

   AND NOW THE FIX IS HERE TOO, 2026-10-02. Matt: "each row gets an 'Add
   email' button that sets the agency email right there (same as on the
   supplier's Agencies tab), plus a link to the agency on its supplier's
   page. Once added, the row disappears and the counts update."

   WHICH REVERSES THE PARAGRAPH THIS REPLACES, and the reasoning that
   paragraph gave is the reason it had to go. It said "a button here
   would be a second way to do one thing" -- true of a second DIALOG,
   and this is not one: `AddContactEmail` is the component the
   supplier's Agencies tab uses, writing through the same RPCs, so there
   is still exactly one way to store a contact. What it was really
   defending was a page that reports work it cannot do, one navigation
   away from the page that can.

   THE LINK GOES WITH IT, because the two are different jobs: the button
   is for the address, and the link is for everything else the reader
   might want to see about that agency. It carries ?tab=agencies, which
   PartnerHome learned to read for this.

   NO ADDRESS IS SUGGESTED. "Don't invent or copy addresses" -- so this
   does not offer an office's address to promote, or the first person on
   the org, although both are one query away. The field opens empty.
   ===================================================================== */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadSupplierAgenciesWithoutAnEmail, getAgencies, partnerName, ALL_PARTNERS, type Agency, type AgencyWithoutAnEmail } from '@/data';
import { AddContactEmail } from '@/pages/PartnerManagement/AddContactEmail';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/session/SessionContext';
import { Icon } from '@/components/ui/Icon';
import { plural } from '@/lib/plural';
import './NotInNetwork.css';

export function NoAgencyEmail({ onChanged }: { onChanged?: () => void }) {
  const toast = useToast();
  const { dataVersion, refresh } = useSession();
  const [rows, setRows] = useState<AgencyWithoutAnEmail[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setRows(await loadSupplierAgenciesWithoutAnEmail()); }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not load the list.', 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  /* THE HYDRATED AGENCY BEHIND EACH ROW. `AddContactEmail` writes a
     contact against an Agency, and the list is a reporting shape with
     an id and three counts. Looked up by id rather than by name, which
     is the rule the whole estate work landed on: two agencies called
     Frost Partnership exist, one in each estate. */
  const book = useMemo(() => getAgencies(ALL_PARTNERS), [dataVersion]);
  const find = useCallback((row: AgencyWithoutAnEmail): Agency | undefined => {
    const byId = book.find((a) => a.id && a.id === row.agencyId);
    if (byId) return byId;
    /* AND FAILING THAT, THE ESTATE AND THE NAME, which is the pair the
       database treats as unique -- `agencies` carries a unique
       (partner_id, name) since separate estates, which is exactly why
       `agencySelection` is keyed on it. It is the mock book that needs
       this: an agency there has no id, because the agency page keys its
       URL on `id ?? name` and inventing ids would move those pages.

       ONLY WHEN IT IS UNAMBIGUOUS. If two rows matched, the pair would
       not be the pair the database guarantees and the control would be
       writing against a guess; no match means no button, which is the
       honest outcome and is what the live rule gives anyway. */
    const pair = book.filter((a) => a.name === row.agencyName && partnerName(a.partner ?? '') === row.partnerName);
    return pair.length === 1 ? pair[0] : undefined;
  }, [book]);

  /* WHAT HAPPENS WHEN ONE IS ADDED. The row has to go, and so do the
     five numbers that count it: the tab, the All count and the three
     tiles are the page's (onChanged), and Home's tile and the sidebar
     badge read the hydrated org (refresh). The reload is last, so the
     list is re-read from a book that already has the contact in it. */
  const saved = useCallback(async () => {
    await refresh();
    await load();
    onChanged?.();
  }, [refresh, load, onChanged]);

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
        Add one here, or open the agency on its supplier&rsquo;s page.
      </p>
      {rows.map((r) => {
        const stranded = r.branches - r.branchesCovered;
        const ag = find(r);
        return (
          <section className="nin__card" key={r.agencyId}>
            <div className="nin__head">
              <div>
                <h3 className="nin__name">{r.agencyName}</h3>
                <div className="nin__meta">
                  under <b>{r.partnerName}</b> · <b>{r.branches}</b> {plural(r.branches, 'office')}
                </div>
              </div>
              {/* THE BUTTON ONLY WHERE THE AGENCY IS IN HAND. The list is
                  an RPC and the org is the hydrated book; a row whose
                  agency has not hydrated (RLS, or a book loaded before
                  it existed) still gets its link, which needs only the
                  estate. A disabled button would be worse than none. */}
              <div className="nin__acts">
                {ag && <AddContactEmail agency={ag} onSaved={() => void saved()} label="Add email" />}
                {ag?.partner && (
                  <Link className="ah-linkbtn" to={`/partners/${encodeURIComponent(ag.partner)}?tab=agencies`}>
                    Open on {r.partnerName}
                  </Link>
                )}
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
