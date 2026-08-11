/* =====================================================================
   Sandbox — the developer's only view of their own rehearsal data.

   Every other screen in this portal is closed to sandbox applications, and not
   by omission: the restrictive policy on `applications` has no developer arm, so
   PostgREST returns nothing to anybody, including a superadmin. That was the
   right call for the policy, because it keeps the rule absolute and meant the
   whole portal client needed no changes. The cost lands here. This tab is the
   one door, so it has to answer every question a developer would otherwise
   answer by opening Applications.

   WHAT A DEVELOPER NEEDS FROM IT, in the order they need it:
     1. did my POST land, and what reference did it get
     2. where did it get to in the lifecycle
     3. how do I pay it, to drive the next transition
     4. how do I sign the deed, to drive the one after that

   3 and 4 are the two with no other route. The payment link is returned in the
   POST response, but a developer who lost that response has no way back to it.
   The signing link exists only inside PandaDoc.
   ===================================================================== */
import { useCallback, useEffect, useState } from 'react';
import {
  getSandboxApplications, getSandboxCounts, getSandboxSigningLink, purgeSandbox,
  type SandboxApplication, type SandboxCounts,
} from '@/data/devCentreService';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Pill, type PillVariant } from '@/components/ui/Pill';
import { useToast } from '@/components/ui/Toast';

function fmtMoney(n: number | null): string {
  return n === null || n === undefined ? '—' : `£${Number(n).toLocaleString('en-GB')}`;
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

/**
 * Status to the app's own pill variants.
 *
 * Deliberately reuses the same names Applications uses rather than inventing a
 * sandbox palette, so a developer reading this table and a member of staff
 * reading Applications are looking at the same colours for the same states.
 */
function statusVariant(s: string): PillVariant {
  if (s === 'deed') return 'deed';
  if (s === 'paid') return 'paid';
  if (s === 'sent') return 'sent';
  if (s === 'withdrawn' || s === 'expired') return 'muted';
  return 'warn';
}

export function Sandbox({ partnerId }: { partnerId: string | null }) {
  const toast = useToast();
  const [rows, setRows] = useState<SandboxApplication[]>([]);
  const [counts, setCounts] = useState<SandboxCounts | null>(null);
  const [search, setSearch] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Held as an object rather than a bare link so the warning can name the address
  // that received the document.
  const [signing, setSigning] = useState<
    { ref: string; link: string; tenantEmail: string | null } | null
  >(null);
  const [purgeOpen, setPurgeOpen] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [list, c] = await Promise.all([
        getSandboxApplications({ partnerId, search: search.trim() || null }),
        getSandboxCounts(partnerId),
      ]);
      setRows(list);
      setCounts(c);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [partnerId, search]);

  useEffect(() => { void load(); }, [load]);

  const copy = (v: string, what: string) => {
    void navigator.clipboard?.writeText(v);
    toast(`${what} copied.`);
  };

  async function showSigningLink(a: SandboxApplication) {
    setBusy(true);
    try {
      const r = await getSandboxSigningLink(a.id);
      setSigning({ ref: a.guarantee_ref, link: r.link, tenantEmail: r.tenantEmail });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doPurge() {
    setBusy(true);
    try {
      const r = await purgeSandbox(partnerId);
      toast(
        `Deleted ${r.applications} application${r.applications === 1 ? '' : 's'}, ` +
        `${r.branches} branch${r.branches === 1 ? '' : 'es'} and ${r.agencies} agenc${r.agencies === 1 ? 'y' : 'ies'}.`,
      );
      setPurgeOpen(false);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* The standing warning. Not dismissable: PandaDoc's sandbox really sends,
          so this is true every time somebody uses the tab, and a notice that can
          be dismissed is one that will be. */}
      <div className="sbxwarn">
        <Icon name="alert" />
        <div>
          <strong>Sandbox sends real email through PandaDoc.</strong>
          <p>
            Stripe and PandaDoc run on sandbox credentials here, so no card is charged and every deed is
            watermarked as a developer document. PandaDoc still <em>delivers</em> its signing email to
            whatever address you send as <code>tenant.email</code>, so use an address you own. Opndoor
            sends no email of its own for sandbox: no payment link, no receipt, no reminders, and nothing
            to the agent.
          </p>
        </div>
      </div>

      <div className="sbxhead">
        <div className="sbxcounts">
          {counts && (
            <>
              <Pill variant="muted">{counts.total} total</Pill>
              <Pill variant="sent">{counts.sent} awaiting payment</Pill>
              <Pill variant="paid">{counts.paid} paid</Pill>
              <Pill variant="deed">{counts.deed} deed issued</Pill>
              <Pill variant="muted">{counts.closed} closed</Pill>
            </>
          )}
        </div>
        <div className="sbxacts">
          <div className="toolbar__search">
            <Icon name="search" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Reference, email or surname"
              aria-label="Search sandbox applications"
            />
          </div>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={busy}>
            <Icon name="refresh" /> Refresh
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="btn--danger"
            onClick={() => setPurgeOpen(true)}
            disabled={busy || !counts?.total}
          >
            <Icon name="trash" /> Clear sandbox
          </Button>
        </div>
      </div>

      {err && <div className="devalert">{err}</div>}

      <Card>
        <CardHead
          title="Sandbox applications"
          sub="Created by keys with an opnd_test_ prefix. Invisible everywhere else in the portal."
        />
        {rows.length === 0 ? (
          <CardBody>
            <p className="soft">
              Nothing here yet. POST to <code>/v1/applications</code> with a key whose prefix is{' '}
              <code>opnd_test_</code> and it will appear. A sandbox key is the only thing that creates one:
              there is no toggle, and nothing in the request body changes the mode.
            </p>
          </CardBody>
        ) : (
          <table className="dt">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Status</th>
                <th>Tenant</th>
                <th>Property</th>
                <th>Rent</th>
                <th>Created</th>
                <th>Drive it</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>
                    <code>{a.guarantee_ref}</code>
                    {a.branch_name && <div className="soft">{a.agency_name} · {a.branch_name}</div>}
                  </td>
                  <td>
                    <Pill variant={statusVariant(a.status)}>{a.status}</Pill>
                    {a.deed_state && <div className="soft">{a.deed_state.replace(/_/g, ' ')}</div>}
                  </td>
                  <td>
                    {`${a.tenant_first_name ?? ''} ${a.tenant_last_name ?? ''}`.trim() || '—'}
                    {/* Shown in full rather than masked. It is the developer's own
                        test payload, and it is the address PandaDoc emails. */}
                    <div className="soft">{a.tenant_email}</div>
                  </td>
                  <td>
                    {a.prop_addr1 ?? '—'}
                    <div className="soft">{a.prop_postcode}</div>
                  </td>
                  <td>{fmtMoney(a.monthly_rent)}</td>
                  <td>{fmtDate(a.created_at)}</td>
                  <td>
                    <div className="sbxrowacts">
                      {/* Offered only while there is something to pay, matching the
                          API's own rule for returning the payment token. */}
                      {a.payment_url && a.status === 'sent' && (
                        <Button variant="ghost" size="sm" href={a.payment_url} target="_blank">
                          <Icon name="external" /> Pay
                        </Button>
                      )}
                      {a.pandadoc_document_id && (
                        <Button variant="ghost" size="sm" onClick={() => void showSigningLink(a)} disabled={busy}>
                          <Icon name="pen" /> Sign
                        </Button>
                      )}
                      {!a.payment_url && !a.pandadoc_document_id && <span className="soft">—</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* ---- signing link ---- */}
      <Modal
        open={!!signing}
        onClose={() => setSigning(null)}
        title={`Sign the deed for ${signing?.ref ?? ''}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => signing && copy(signing.link, 'Signing link')}>
              <Icon name="file" /> Copy link
            </Button>
            <Button variant="primary" href={signing?.link ?? '#'} target="_blank">
              <Icon name="external" /> Open and sign
            </Button>
          </>
        }
      >
        <div className="sbxwarn sbxwarn--tight">
          <Icon name="alert" />
          <div>
            <strong>This document has already been emailed.</strong>
            <p>
              PandaDoc sent its signing email to{' '}
              <strong>{signing?.tenantEmail ?? 'the address on the application'}</strong> when the deed was
              generated. If that is not an address you own, stop and clear the sandbox rather than
              continuing.
            </p>
          </div>
        </div>

        <p className="soft">
          This opens a fresh signing session for the same document. It is a bearer link: anyone holding it
          can sign, so treat it as a credential. It expires after seven days.
        </p>

        <div className="sbxlink"><code>{signing?.link}</code></div>
      </Modal>

      {/* ---- purge ---- */}
      <Modal
        open={purgeOpen}
        onClose={() => setPurgeOpen(false)}
        title="Clear sandbox data"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPurgeOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" className="btn--danger" onClick={() => void doPurge()} disabled={busy}>
              {busy ? 'Deleting…' : `Delete ${counts?.total ?? 0} sandbox application${counts?.total === 1 ? '' : 's'}`}
            </Button>
          </>
        }
      >
        <p>
          This deletes every sandbox application for {partnerId ? 'this partner' : 'your partner'}, along
          with the sandbox agencies and branches created by name, and their activity, notes, payment
          tokens and webhook deliveries.
        </p>
        <p className="soft">
          It cannot touch live data. The function filters on <code>not livemode</code> rather than taking a
          list of ids, so there is no argument that would make it delete a real application.
        </p>
      </Modal>
    </>
  );
}
