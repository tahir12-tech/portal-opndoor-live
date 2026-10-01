/* =====================================================================
   SEVERAL AGENTS'-SHARE DEALS, AND WHO IS ON EACH.

   Matt, 2026-10-01, verbatim: "Supplier Commission tab: under 'What the
   agencies underneath keep', allow several deals. One default deal for
   all agencies, plus extra deals that each apply to agencies picked from
   a searchable list of that supplier's agencies (several agencies can
   share one deal). Show which agencies are on which deal, and every
   agency not picked uses the default. An agency can only be on one deal
   at a time; moving it is one click. Changes apply to new referrals only
   and are recorded with who and when."

   =====================================================================
   WHAT THIS CARD IS AND IS NOT
   =====================================================================

   It is the LIST of a supplier's share deals and the membership editor.
   It is NOT a second deal editor: each deal's terms are still changed in
   `AgreementEditor`, the same one agencies use, reached from the row.
   Two places to set a rate is the fault this whole tab was built to end.

   THE DEFAULT IS A ROW LIKE THE OTHERS, not a special case above them,
   because it IS one: the resolver treats "named on nothing" and "named
   on the default" as the same answer. What marks it out is its
   membership line, which names a count of agencies nobody chose rather
   than a list of ones somebody did.

   "CHANGES APPLY TO NEW REFERRALS ONLY" needs nothing here. The rates
   are frozen onto the application by create_referral, so moving an
   agency cannot reprice a referral that already exists. The card says so
   once, because an administrator moving an agency mid-month will want to
   know, and nothing on the screen would otherwise tell them.
   ===================================================================== */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getSupplierShareDeals, setAgencyShareDeal, clearAgencyShareDeal,
  type ShareDealView,
} from '@/data/orgService';
import { dealWords, AgreementEditor } from '@/pages/Agencies/AgreementEditor';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { TypeAhead, highlightMatch, type TypeAheadOption } from '@/components/ui/TypeAhead';
import { useToast } from '@/components/ui/Toast';
import './PartnerHome.css';
import { plural } from '@/lib/plural';

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

const whenWho = (m: { addedAt: string | null; addedBy: string | null }) => {
  if (!m.addedAt) return null;
  const d = new Date(m.addedAt);
  const when = Number.isNaN(d.getTime())
    ? null
    : `${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })} ${d.getFullYear()}`;
  if (!when) return null;
  return m.addedBy ? `moved here ${when} by ${m.addedBy}` : `moved here ${when}`;
};

/* =====================================================================
   ONE DEAL'S CARD, AT MODULE SCOPE AND NOT INSIDE THE PARENT.

   It was defined inside `ShareDeals`, which makes it a NEW component type
   on every render: React then unmounts the old subtree and mounts a fresh
   one rather than updating it. The picker is a TypeAhead holding its own
   open-and-focused state, and every keystroke changes `query` on the
   parent -- so each letter typed destroyed the list and the focus with
   it, and the control could not be used at all. Three tests failed on it
   immediately and the screen would have failed on the first search.

   Everything it needs is a prop. Nothing about it wanted to be a closure.
   ===================================================================== */
function DealCard({
  deal, canEdit, busy, picking, query, onDefault, onPick, onQuery, onEdit, onOff, pickerRows,
}: {
  deal: ShareDealView;
  canEdit: boolean;
  busy: boolean;
  picking: string | null;
  query: string;
  /** The agencies the default deal applies to, derived by the parent. */
  onDefault: ShareDealAgency[];
  onPick: (id: string | null) => void;
  onQuery: (q: string) => void;
  onEdit: (id: string) => void;
  onOff: (a: ShareDealAgency) => void;
  pickerRows: (deal: ShareDealView) => TypeAheadOption[];
}) {
  return (
  <Card>
    <CardHead
      title={deal.isDefault ? 'The default deal' : 'A deal for named agencies'}
      sub={deal.isDefault
        ? 'Every agency under this supplier that is not named on another deal is paid on these terms.'
        : 'Only the agencies named below are paid on these terms.'}
      actions={canEdit && (
        <>
          {!deal.isDefault && (
            <Button
              variant="quiet" size="sm" disabled={busy}
              onClick={() => { onPick(picking === deal.agreementId ? null : deal.agreementId); onQuery(''); }}
            >
              {picking === deal.agreementId ? 'Done' : 'Add agencies'}
            </Button>
          )}
          <Button variant="quiet" size="sm" disabled={busy}
            onClick={() => onEdit(deal.agreementId)}>
            Change the deal
          </Button>
        </>
      )}
    />
    <CardBody>
      <p className="sd-summary">{words(deal)}</p>

      {deal.isDefault ? (
        /* A COUNT AND THE NAMES, not a count alone: "14 agencies" is a
           number an administrator then has to go and work out. */
        <div className="sd-members">
          {onDefault.length === 0 ? (
            <p className="ph-note muted">
              Every agency is named on another deal, so nothing is priced by this one today.
            </p>
          ) : (
            <>
              <p className="ph-note muted">
                {onDefault.length} {plural(onDefault.length, 'agency')}, being
                everyone not named on a deal below.
              </p>
              <ul className="sd-memberlist">
                {onDefault.map((a) => (
                  <li key={a.id} className="sd-member">
                    <span className="sd-member__name">{a.name}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : (
        <div className="sd-members">
          {deal.members.length === 0 ? (
            /* A NAMED DEAL WITH NOBODY ON IT PRICES NOTHING, and says so
               rather than looking live. The server treats it as a default
               in that state, which is the safe answer and the wrong thing
               to leave unexplained on a screen. */
            <p className="ph-note muted">
              No agency is on this deal yet, so it prices nothing. Add one, or it will behave as
              a second default.
            </p>
          ) : (
            <ul className="sd-memberlist">
              {deal.members.map((m) => {
                const line = whenWho(m);
                return (
                  <li key={m.agencyId} className="sd-member">
                    <span className="sd-member__name">{m.name}</span>
                    {line && <span className="sd-member__when">{line}</span>}
                    {canEdit && (
                      <button
                        type="button" className="sd-member__off" disabled={busy}
                        title="Move this agency back to the default deal"
                        onClick={() => onOff({ id: m.agencyId, name: m.name })}
                      >
                        Back to default
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {picking === deal.agreementId && (
            <div className="sd-picker">
              <TypeAhead
                value={query}
                onChange={onQuery}
                options={pickerRows(deal)}
                ariaLabel="Find an agency"
                placeholder="Type to find one of this supplier’s agencies"
                emptyText="No agency of that name under this supplier"
                autoFocus
              />
            </div>
          )}
        </div>
      )}
    </CardBody>
  </Card>
  );
}

export function ShareDeals({
  slug, partnerId, name, agencies, canEdit, onChanged,
}: {
  slug: string;
  /** The uuid, which is what a partner-scope agreement is keyed on. */
  partnerId: string;
  name: string;
  /** This supplier's agencies, which is what the picker searches. */
  agencies: ShareDealAgency[];
  canEdit: boolean;
  onChanged?: () => void;
}) {
  const toast = useToast();
  const [deals, setDeals] = useState<ShareDealView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Which deal's picker is open. One at a time: two open searches over the
      same list of agencies is two answers to one question. */
  const [picking, setPicking] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  /* WHICH DEAL'S TERMS ARE OPEN IN THE EDITOR: an agreement id to change
     one, the string 'new' to write another. The SAME AgreementEditor the
     agencies use and the commission card above opens -- a second editor
     for the same kind of deal is how two screens come to disagree. */
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDeals(await getSupplierShareDeals(slug));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not read the deals.', 'error');
    } finally {
      setLoaded(true);
    }
  }, [slug, toast]);
  useEffect(() => { void load(); }, [load]);

  /* WHERE EVERY AGENCY ACTUALLY SITS. Built once from the deals rather than
     asked per row, because the same map answers both questions the card
     has: what to list under each deal, and what the default is left with. */
  const dealOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of deals) for (const mem of d.members) m.set(mem.agencyId, d.agreementId);
    return m;
  }, [deals]);

  /* THE DEFAULT'S MEMBERS ARE EVERYBODY ELSE, which is the sentence Matt
     wrote and is not stored anywhere: the default deal has no rows in the
     membership table, on purpose, because "everybody not named" cannot be
     kept correct as a list. It is derived here, once, at the moment it is
     shown. */
  const onTheDefault = useMemo(
    () => agencies.filter((a) => !dealOf.has(a.id)),
    [agencies, dealOf],
  );

  const run = async (what: () => Promise<void>, ok: string) => {
    setBusy(true);
    try {
      await what();
      await load();
      onChanged?.();
      toast(ok);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change that.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const move = (agreementId: string, a: ShareDealAgency) =>
    run(() => setAgencyShareDeal(agreementId, a.id), `${a.name} moved onto this deal.`);
  const toDefault = (a: ShareDealAgency) =>
    run(() => clearAgencyShareDeal(a.id), `${a.name} is back on the default deal.`);

  if (!loaded) {
    return (
      <Card>
        <CardHead title="What the agencies underneath keep" />
        <CardBody><p className="ph-note muted">Loading…</p></CardBody>
      </Card>
    );
  }

  /* THE EDITOR IS OPENED FROM THREE PLACES and is one component: write the
     first deal, write another, change an existing one. `current` is what
     tells it which, and a null one is a new deal.

     EVERY DEAL IT WRITES IS PARTNER-SCOPE `agent_share`. Which agencies it
     applies to is NOT its business -- that is the membership below, and the
     server decides whether a new deal is the default by whether the supplier
     already has one. So the editor never has to ask. */
  const openDeal = editing && editing !== 'new'
    ? deals.find((d) => d.agreementId === editing) ?? null
    : null;

  const extras = deals.filter((d) => !d.isDefault);

  /* THE PICKER SEARCHES EVERY AGENCY OF THIS SUPPLIER, including ones
     already on another deal, because "an agency can only be on one deal at
     a time; moving it is one click" is only one click if the agency you
     want is in the list you are looking at. Hiding the taken ones would
     make a move a two-step: find out where it is, take it off, come back.
     The row says where it is now instead. */
  const pickerRows = (target: ShareDealView): TypeAheadOption[] => {
    const q = query.trim().toLowerCase();
    return agencies
      .filter((a) => dealOf.get(a.id) !== target.agreementId)
      .filter((a) => !q || a.name.toLowerCase().includes(q))
      .slice(0, 40)
      .map((a) => {
        const on = dealOf.get(a.id);
        return {
          id: a.id,
          icon: <Icon name="org" size={14} />,
          main: highlightMatch(a.name, query),
          sub: on ? 'on another deal, so this moves it' : 'on the default',
          onSelect: () => {
            setPicking(null);
            setQuery('');
            void move(target.agreementId, a);
          },
        };
      });
  };

  return (
    <>
      {deals.length === 0 ? (
        <Card>
          <CardHead
            title="No agents’ share deal"
            sub="The part of the commission the referring agency is paid."
            actions={canEdit && (
              <Button variant="dark" size="sm" onClick={() => setEditing('new')}>Agree a deal</Button>
            )}
          />
          <CardBody>
            <p className="sd-summary">
              No deal. Every agency under this supplier is paid the supplier’s flat agents’ rate.
            </p>
          </CardBody>
        </Card>
      ) : (
        deals.map((d) => (
          <DealCard
            key={d.agreementId}
            deal={d}
            canEdit={canEdit}
            busy={busy}
            picking={picking}
            query={query}
            onDefault={onTheDefault}
            onPick={(id) => setPicking(id)}
            onQuery={setQuery}
            onEdit={(id) => setEditing(id)}
            onOff={(a) => void toDefault(a)}
            pickerRows={pickerRows}
          />
        ))
      )}

      {/* ANOTHER DEAL, which is the instruction: "plus extra deals that each
          apply to agencies picked from a searchable list". Written first and
          given its agencies afterwards, because a deal with no members is a
          valid intermediate state the server already understands -- it
          behaves as a default until somebody is on it, and the card says so
          rather than letting it look live. */}
      {canEdit && deals.length > 0 && (
        <div className="sd-addrow">
          <Button variant="quiet" size="sm" onClick={() => setEditing('new')}>
            Add another deal
          </Button>
          <span className="ph-note muted">
            For a group of agencies on different terms. Pick which ones after you have agreed it.
          </span>
        </div>
      )}

      {/* ONE SENTENCE ABOUT WHEN A MOVE TAKES EFFECT, which nothing else on
          the screen says and which an administrator moving an agency
          mid-month will want. */}
      {deals.length > 0 && (
        <p className="ph-note muted sd-foot">
          Moving an agency applies to its next referral. Referrals already sent keep the rates
          frozen onto them, so nothing already invoiced moves.
          {extras.length > 0 && ' An agency is on one deal at a time; adding it to another moves it.'}
        </p>
      )}

      {editing && (
        <AgreementEditor
          level="partner"
          id={partnerId}
          name={name}
          kind="agent_share"
          current={openDeal}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); onChanged?.(); }}
        />
      )}
    </>
  );
}
