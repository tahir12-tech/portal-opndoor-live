/* =====================================================================
   NM-N. THE AGENCIES A DIRECT TENANT NAMED THAT WE DO NOT WORK WITH.

   Matt, 2026-09-30, verbatim: "NM-N: don't create companies in HubSpot
   automatically; list agencies a direct tenant named that we don't work
   with on the Reconciliation page, with the agent contact given, for
   someone to add to HubSpot by hand."

   A LIST AND NOTHING ELSE. There is no button here, and that is the design
   rather than an omission. Item 24 wanted the agency written to HubSpot as
   a prospect; the check against HUBSPOT-CONSEQUENCES.md found that its own
   rule -- "if the company already exists in HubSpot, add to it rather than
   duplicating" -- cannot be honoured, because HubSpot's upsert matches only
   on our own unique property and would sit a second company next to one a
   salesperson typed in. Matt's answer drops the write. So the job of this
   screen is to make the retyping quick and obvious, not to automate it, and
   notInNetwork.render.test.tsx asserts that no control here reads like a
   CRM write.

   WHAT MAKES IT QUICK. Each field a person has to retype is on its own
   line, in the order a CRM asks for it, and the values are selectable text
   rather than a summary sentence. The tenant count leads because it is what
   decides whether the row is worth the typing at all.

   NOTHING OF THE TENANT'S IS ON THIS SCREEN. The row type carries no
   guarantee reference, no tenant name and no property, because the SQL does
   not return them. Item 24: "Only the agency and agent contact go across,
   never the tenant's details."
   ===================================================================== */
import { useEffect, useState } from 'react';
import { loadNotInNetworkAgencies, type NotInNetworkAgency } from '@/data';
import { useToast } from '@/components/ui/Toast';
import { Icon } from '@/components/ui/Icon';
import './NotInNetwork.css';

/** A contact's name, from however much of it we were given. */
function contactName(c: { title: string | null; firstName: string | null; lastName: string | null }): string {
  return [c.title, c.firstName, c.lastName].filter(Boolean).join(' ').trim();
}

export function NotInNetwork() {
  const toast = useToast();
  const [rows, setRows] = useState<NotInNetworkAgency[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    loadNotInNetworkAgencies()
      .then((r) => { if (live) setRows(r); })
      .catch((e) => toast(e instanceof Error ? e.message : 'Could not load the not-in-network list.', 'error'))
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [toast]);

  if (loading) return <div className="empty">Loading.</div>;
  if (rows.length === 0) {
    return (
      <div className="empty">
        No direct tenant has named an agency we do not work with. Agencies land here when a
        match is dismissed as not in network.
      </div>
    );
  }

  return (
    <div className="nin">
      <p className="nin__lede">
        Direct tenants named these agencies and we do not work with them. Add them to HubSpot
        by hand. Nothing on this page writes to HubSpot.
      </p>
      {rows.map((r) => (
        <section className="nin__card" key={r.nameKey}>
          <div className="nin__head">
            <div>
              <h3 className="nin__name">{r.typedName}</h3>
              <div className="nin__meta">
                {/* The count decides whether the row is worth typing in, so
                    it leads. Singular matters: "1 tenants" on a prospect
                    list reads as a bug in the list. */}
                <b>{r.tenants}</b> {r.tenants === 1 ? 'tenant' : 'tenants'} named it
                {r.lastNamedAt && <> · last on {r.lastNamedAt}</>}
              </div>
            </div>
          </div>

          {r.contacts.length === 0 ? (
            /* NOT A MISSING ROW, A STATED ABSENCE. On dev this is the real
               case: that tenant gave a private landlord, who is not an
               agent. Saying so is what stops somebody hunting for a contact
               that was never given. */
            <div className="nin__none">
              <Icon name="info" size={14} /> No agent contact was given. The agency name is
              all we have.
            </div>
          ) : (
            r.contacts.map((c, i) => (
              <dl className="nin__contact" key={`${r.nameKey}-${i}`}>
                {c.agencyName && c.agencyName !== r.typedName && (
                  <><dt>Company as written</dt><dd>{c.agencyName}</dd></>
                )}
                {contactName(c) && <><dt>Contact</dt><dd>{contactName(c)}</dd></>}
                {c.email && <><dt>Email</dt><dd>{c.email}</dd></>}
                {c.phone && <><dt>Phone</dt><dd>{c.phone}</dd></>}
              </dl>
            ))
          )}
        </section>
      ))}
    </div>
  );
}
