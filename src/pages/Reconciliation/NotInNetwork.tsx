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
import { useCallback, useEffect, useState } from 'react';
import { decideNotInNetwork, loadNotInNetworkAgencies, type NotInNetworkAgency } from '@/data';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import './NotInNetwork.css';
import { plural } from '@/lib/plural';

/** A contact's name, from however much of it we were given. */
function contactName(c: { title: string | null; firstName: string | null; lastName: string | null }): string {
  return [c.title, c.firstName, c.lastName].filter(Boolean).join(' ').trim();
}

/* THE CALLBACK THIS COMPONENT DID NOT HAVE. Matt, 2026-10-03: "after
   pressing Ignore ... the section empties but the tab count ('Not in
   network 1'), the 'Waiting' tile and the sidebar badge stay at their old
   numbers until refresh."

   EXACTLY THAT: the list below reloaded itself and told nobody. Its three
   siblings on Reconciliation all took an `onChanged` and this one took no
   props at all, so of the six actions on that page these two were the only
   ones that moved no count outside their own section. Awaited rather than
   fired, because the parent re-hydrates in it and this list is read from
   the hydrated book. */
export function NotInNetwork({ onChanged }: { onChanged?: () => void | Promise<void> }) {
  const toast = useToast();
  const { ask, confirmEl } = useConfirm();
  const [rows, setRows] = useState<NotInNetworkAgency[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await loadNotInNetworkAgencies());
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not load the not-in-network list.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  /* RELOADED RATHER THAN SPLICED. The list is grouped and ordered by the
     server, and a row removed here would leave the rest describing a
     state the server no longer agrees with -- including the case that
     matters, where a tenant named the same agency again between the read
     and the click. */
  const decide = (r: NotInNetworkAgency, decision: 'added' | 'ignored') => ask({
    title: decision === 'added' ? 'Mark as added to HubSpot' : 'Ignore this agency',
    /* WALK FIX 23: the sentence names the record. And it says the one
       thing a reader needs to know about a list that forgets: this is
       not permanent. */
    body: decision === 'added'
      ? (<>
          Take <b>{r.typedName}</b> off the list, recorded as added to HubSpot by hand?
          {' '}If another direct tenant names them later, they come back.
        </>)
      : (<>
          Take <b>{r.typedName}</b> off the list without adding them, recorded as ignored?
          {' '}If another direct tenant names them later, they come back.
        </>),
    confirmLabel: decision === 'added' ? 'Mark as added' : 'Ignore',
    run: async () => {
      setBusy(true);
      try {
        await decideNotInNetwork(r.nameKey, decision, r.typedName);
        /* THE PARENT FIRST, then this list. `onChanged` re-hydrates and
           re-reads the five queues, so doing it the other way round
           would load these rows from the book the decision just
           invalidated. */
        await onChanged?.();
        await load();
        toast(decision === 'added'
          ? `${r.typedName} marked as added to HubSpot.`
          : `${r.typedName} ignored.`);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not record that.', 'error');
      } finally { setBusy(false); }
    },
  });

  /* `empty is-shown`, NOT `empty`. The shared rule is `.empty { display:
     none }` with `.empty.is-shown { display: block }`, so the class alone
     renders an element that is in the DOM, carries the right words, and
     shows the reader nothing. Both of these were bare until an audit found
     them. jsdom does not load the stylesheet, so no render test can see
     this; src/data/anEmptyStateIsVisible.test.ts reads the CSS and the JSX
     together and is what catches it now. */
  if (loading) return <div className="empty is-shown">Loading.</div>;
  if (rows.length === 0) {
    return (
      <div className="empty is-shown">
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
                <b>{r.tenants}</b> {plural(r.tenants, 'tenant')} named it
                {r.lastNamedAt && <> · last on {r.lastNamedAt}</>}
              </div>
            </div>
            {/* TWO ACTIONS, EACH BEHIND A CONFIRMATION. Matt, 2026-09-30.
                Neither is destructive in the usual sense -- the row comes
                back the moment another tenant names the agency -- so
                neither is styled as a danger, and both say so in the
                box. */}
            <div className="nin__acts">
              <Button variant="dark" size="sm" disabled={busy} onClick={() => decide(r, 'added')}>
                Added to HubSpot
              </Button>
              <Button variant="quiet" size="sm" disabled={busy} onClick={() => decide(r, 'ignored')}>
                Ignore
              </Button>
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
      {confirmEl}
    </div>
  );
}
