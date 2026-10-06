/* =====================================================================
   AGENCIES ON DIFFERENT TERMS.

   Matt, 2026-10-01, verbatim: "4. 'Agencies on different terms': a list
   of bespoke deals, each showing its agencies and terms with a Change
   button. 'Add' opens one dialog that asks which agencies first
   (searchable list of this supplier's agencies, pick one or several),
   titled with them, e.g. 'Deal for Frost Partnership and 2 others', then
   the agencies' % editor below, one Save."

   =====================================================================
   WHAT CHANGED HERE, AND WHY THE DEFAULT DEAL LEFT THIS LIST
   =====================================================================

   This was the whole list, default deal included, with "Add agencies"
   and "Change the deal" as separate buttons and a search per row. The
   rebuilt tab shows the default in its own card above -- it is the
   answer to "Agencies get", which is a question about every agency, not
   about a group of them. What is left here is only the exceptions, which
   is what Matt's heading says.

   ONE CHANGE BUTTON, not two. Who a deal is for and what it pays are one
   negotiation, and `save_share_deal` takes them in one call, so the
   dialog that writes a deal is the dialog that changes it. "Back to
   default" stays on each agency because it is genuinely one click and
   the instruction that asked for it has not changed.

   THE AGENCIES AND THE DEALS ARE PROPS. The parent reads them once:
   "Agencies get" above and this list are two views of one answer from
   `supplier_share_deals`, and two readers of it would eventually show a
   supplier two different defaults.
   ===================================================================== */
import { useMemo, useState } from 'react';
import { clearAgencyShareDeal, type ShareDealView } from '@/data/orgService';
import { dealWords } from '@/pages/Agencies/AgreementEditor';
import { AgencyPercentEditorTitles } from './dealTitles';
import { ShareDealDialog } from './ShareDealDialog';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import './PartnerHome.css';
import { plural } from '@/lib/plural';
import { formatDate } from '@/lib/format';

export interface ShareDealAgency { id: string; name: string }

/** The one sentence a deal's terms come to, from the same function the
    editor's own preview uses so a deal cannot be worded two ways. */
const words = (d: ShareDealView) =>
  dealWords(
    d.bands.map((b) => ({
      min: b.min, max: b.max, weeks: b.weeks, unit: b.unit ?? 'weeks', rate: b.rate,
    })),
    d.tiers,
    true,
  );

/** What each deal is called, which is what its dialog was titled with. */
const titleOf = (d: ShareDealView) =>
  AgencyPercentEditorTitles.dealFor(d.members.map((m) => m.name));

const whenWho = (m: { addedAt: string | null; addedBy: string | null }) => {
  if (!m.addedAt) return null;
  const when = formatDate(m.addedAt) || null;
  if (!when) return null;
  return m.addedBy ? `moved here ${when} by ${m.addedBy}` : `moved here ${when}`;
};

export function ShareDeals({
  partnerId, deals, agencies, canEdit, onChanged,
}: {
  /** The uuid, which is what a partner-scope agreement is keyed on. */
  partnerId: string;
  /** The bespoke deals only. The default is the card above this list. */
  deals: ShareDealView[];
  /** This supplier's agencies, which is what the dialog searches. */
  agencies: ShareDealAgency[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  /** The deal open in the dialog: a deal to change it, 'new' to agree one. */
  const [editing, setEditing] = useState<ShareDealView | 'new' | null>(null);

  /* WHERE EVERY NAMED AGENCY SITS NOW, so the dialog's search can say "on
     Deal for Frost Partnership, so this moves it" rather than letting
     somebody move an agency without knowing they are moving it. */
  const dealNameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of deals) for (const mem of d.members) m.set(mem.agencyId, titleOf(d));
    return m;
  }, [deals]);

  const toDefault = async (agencyId: string, name: string) => {
    setBusy(true);
    try {
      await clearAgencyShareDeal(agencyId);
      toast(`${name} is back on the default deal.`);
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change that.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {deals.length === 0 ? (
        <Card>
          <CardBody>
            <p className="sd-summary">
              No agency is on different terms. Every one of them gets the percentage above.
            </p>
            {canEdit && (
              <Button variant="dark" size="sm" onClick={() => setEditing('new')}>Add</Button>
            )}
          </CardBody>
        </Card>
      ) : (
        <>
          {deals.map((d) => (
            <Card key={d.agreementId}>
              <CardHead
                title={titleOf(d)}
                sub={`${d.members.length} ${plural(d.members.length, 'agency')} on these terms.`}
                actions={canEdit && (
                  <Button variant="quiet" size="sm" disabled={busy} onClick={() => setEditing(d)}>
                    Change
                  </Button>
                )}
              />
              <CardBody>
                <p className="sd-summary">{words(d)}</p>
                {d.note && <p className="ph-note muted">{d.note}</p>}

                {d.members.length === 0 ? (
                  /* A DEAL WITH NOBODY ON IT PRICES NOTHING, and says so
                     rather than looking live. The server treats it as a
                     default in that state, which is the safe answer and the
                     wrong thing to leave unexplained on a screen. The new
                     dialog cannot create one; a deal emptied before it
                     existed still can be. */
                  <p className="ph-note muted">
                    No agency is on this deal, so it prices nothing. Press Change to name one.
                  </p>
                ) : (
                  <ul className="sd-memberlist">
                    {d.members.map((m) => {
                      const line = whenWho(m);
                      return (
                        <li key={m.agencyId} className="sd-member">
                          <span className="sd-member__name">{m.name}</span>
                          {line && <span className="sd-member__when">{line}</span>}
                          {canEdit && (
                            <button
                              type="button" className="sd-member__off" disabled={busy}
                              title="Move this agency back to the default deal"
                              onClick={() => void toDefault(m.agencyId, m.name)}
                            >
                              Back to default
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardBody>
            </Card>
          ))}

          {canEdit && (
            <div className="sd-addrow">
              <Button variant="quiet" size="sm" onClick={() => setEditing('new')}>Add</Button>
              <span className="ph-note muted">
                For a group of agencies on terms of their own. An agency is on one deal at a time,
                so adding it to another moves it.
              </span>
            </div>
          )}
        </>
      )}

      {editing && (
        <ShareDealDialog
          partnerId={partnerId}
          agencies={agencies}
          current={editing === 'new' ? null : editing}
          whereNow={(id) => dealNameOf.get(id) ?? null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged(); }}
        />
      )}
    </>
  );
}
