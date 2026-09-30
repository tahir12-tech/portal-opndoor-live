/* =====================================================================
   WHO A SUPPLIER'S MONTHLY COMMISSION STATEMENT IS POSTED TO.

   Matt, 2026-09-30, verbatim: "Supplier monthly commission statements:
   sent to the supplier's Management users who have statements switched
   on, addressed to the supplier. Only Opndoor admin can switch statements
   on or off for a supplier's users; supplier users cannot change it for
   themselves or colleagues. Opndoor admin can also add named email
   addresses that aren't portal users (e.g. a finance inbox) to receive a
   supplier's statement."

   TWO HALVES, AND THIS CARD IS ONE OF THEM. The PEOPLE half is a tick on
   each person and already has a home: the person panel under People, the
   same control an agency Director uses for their own staff. What had no
   home at all is the second half -- a finance inbox that is not a portal
   user and never will be -- so that is what this card is, and it says
   where the other half lives rather than leaving an admin to hunt.

   THE SCREEN IS NOT THE BOUNDARY. All three RPCs are granted to
   `authenticated` and guarded inside with is_admin + is_aal2: the two
   writers raise, and the reader answers an empty list. Rendering this
   only for an admin is courtesy. `a_supplier_gets_its_own_statement.
   test.sql` asserts both halves of that from the supplier's side.

   NO COMMISSION FIGURE IS SHOWN HERE. It is a list of addresses. The
   money is on the statement itself, which is the thing being addressed.
   ===================================================================== */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  addStatementRecipient, getStatementRecipients, removeStatementRecipient,
  type StatementRecipient,
} from '@/data';
import { Card, CardHead, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';

interface Props {
  /** The partner's DATABASE uuid. A partner's client-side id is its slug and
      the table's foreign key is not that, so a page with no `dbId` (mock mode)
      falls back to the slug, which its mock store is keyed on. */
  partnerKey: string;
  /** For the confirmation sentence, which names the record per walk fix 23. */
  supplierName: string;
}

export function StatementRecipients({ partnerKey, supplierName }: Props) {
  const toast = useToast();
  const { ask, confirmEl } = useConfirm();
  const [rows, setRows] = useState<StatementRecipient[] | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await getStatementRecipients(partnerKey));
    } catch {
      /* AN EMPTY LIST, NOT A BROKEN CARD. The read needs live mode and MFA,
         and the same degradation is what the API-key count on this page
         already does. An admin who cannot read it also cannot write it. */
      setRows([]);
    }
  }, [partnerKey]);

  useEffect(() => { void load(); }, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await addStatementRecipient(partnerKey, email, name);
      setEmail(''); setName('');
      await load();
      toast('That address will receive the monthly statement.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Something went wrong.', 'error');
    } finally { setBusy(false); }
  };

  const remove = (r: StatementRecipient) => ask({
    title: 'Stop sending the statement here',
    body: <>Take <b>{r.email}</b> off {supplierName}&rsquo;s monthly commission statement? It will not receive next month&rsquo;s.</>,
    confirmLabel: 'Remove address',
    danger: true,
    run: async () => {
      try {
        await removeStatementRecipient(partnerKey, r.id);
        await load();
        toast(`${r.email} no longer receives the statement.`);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Something went wrong.', 'error');
      }
    },
  });

  return (
    <Card>
      <CardHead
        title="Monthly statement addresses"
        sub="Addresses that are not portal users, such as a finance inbox. Opndoor only."
      />
      <CardBody>
        {rows === null ? (
          <p className="ph-note muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="ph-note muted">
            No extra addresses. The statement goes to this supplier&rsquo;s Management users who have it switched on.
          </p>
        ) : (
          <ul className="sr-list">
            {rows.map((r) => (
              <li key={r.id} className="sr-row">
                <span className="sr-row__who">
                  <Icon name="send" size={13} />
                  <b>{r.email}</b>
                  {r.fullName && <span className="sr-row__name">{r.fullName}</span>}
                </span>
                <Button variant="quiet" size="sm" onClick={() => remove(r)} disabled={busy}>Remove</Button>
              </li>
            ))}
          </ul>
        )}

        <form className="sr-add" onSubmit={(e) => void add(e)}>
          <input
            id="sr-add-email"
            type="email"
            required
            value={email}
            placeholder="finance@example.co.uk"
            aria-label="Email address"
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            id="sr-add-name"
            type="text"
            value={name}
            placeholder="Who it is (optional)"
            aria-label="Who it is"
            onChange={(e) => setName(e.target.value)}
          />
          <Button variant="dark" size="sm" disabled={busy || !email.trim()}>Add address</Button>
        </form>

        {/* THE OTHER HALF, NAMED. An admin reading this card is one click
            from the question it does not answer. */}
        <p className="ph-note muted">
          Staff who receive it are set person by person, under <b>People</b>. On this rail only Opndoor can change that.
        </p>
      </CardBody>
      {confirmEl}
    </Card>
  );
}
