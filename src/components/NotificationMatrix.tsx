/* WHO IS TOLD WHAT, for one party.
 *
 * Q-03. Notification types down, recipient classes across, each cell on or
 * off. One component for both parties, because a supplier's matrix and an
 * agency's differ only in which recipient classes exist, and the SERVER says
 * which those are. A screen holding its own list would eventually draw a
 * switch that does nothing.
 *
 * READ-ONLY IS A REAL STATE, not a disabled grid. An opndoor_manager on an
 * agency page, or an agency Manager, may see what is set and may not change
 * it; `may_edit_notification_matrix` is asked once and the card says so in a
 * sentence rather than offering twenty controls that each refuse.
 *
 * AND A LOCKED CELL IS LOCKED, WITH THE REASON. The executed deed to its own
 * recipient cannot be switched off -- the SQL refuses it and
 * notification_enabled ignores any row that says otherwise -- so it is drawn
 * ticked and unpressable with the reason on it, rather than as a control that
 * appears to work and does not.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  LOCKED_REASON, MATRIX_NOTE, getNotificationMatrix, mayEditNotificationMatrix,
  setNotificationSetting, toColumns, toRows, type MatrixCell, type Party,
} from '@/data/notificationMatrixService';
import { Card, CardHead } from '@/components/ui/Card';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { useToast } from '@/components/ui/Toast';
import './NotificationMatrix.css';

export function NotificationMatrix({ party, title = 'Who is told what' }: {
  party: Party;
  title?: string;
}) {
  const toast = useToast();
  const [cells, setCells] = useState<MatrixCell[]>([]);
  const [mayEdit, setMayEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const key = `${party.partnerId ?? ''}|${party.agencyId ?? ''}`;

  const load = useCallback(async () => {
    try {
      const [rows, editable] = await Promise.all([
        getNotificationMatrix(party),
        mayEditNotificationMatrix(party),
      ]);
      setCells(rows);
      setMayEdit(editable);
    } catch {
      /* A reader who may not even READ this party's matrix gets an empty card
         rather than an error: notification_matrix refuses them, and that is
         the same answer as "there is nothing here for you". */
      setCells([]);
      setMayEdit(false);
    } finally { setLoading(false); }
  // party is a fresh object each render; the key is its identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => { void load(); }, [load]);

  const flip = async (c: MatrixCell) => {
    const id = `${c.notificationType}:${c.recipient}`;
    setBusy(id);
    // Optimistic, and reverted on refusal: the server is the rule and it can
    // still say no.
    const before = cells;
    setCells(cells.map((x) => (x.notificationType === c.notificationType && x.recipient === c.recipient
      ? { ...x, enabled: !c.enabled, isDefault: false } : x)));
    try {
      await setNotificationSetting(party, c.notificationType, c.recipient, !c.enabled);
    } catch (e) {
      setCells(before);
      toast(e instanceof Error ? e.message : 'Could not change that.', 'error');
    } finally { setBusy(null); }
  };

  if (loading) return null;
  if (!cells.length) return null;

  const rows = toRows(cells);
  const cols = toColumns(cells);

  return (
    <Card>
      <CardHead title={<><Eyebrow>Notifications</Eyebrow>{title}</>} />
      <p className="soft nm-note">{MATRIX_NOTE}</p>
      {!mayEdit && (
        <p className="soft nm-note">
          This is how it is set. Changing it is done by opndoor, or by a director of this agency.
        </p>
      )}
      <div className="nm-scroll">
        <table className="nm-grid">
          <thead>
            <tr>
              <th scope="col">When this happens</th>
              {cols.map((c) => <th key={c.recipient} scope="col">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.notificationType}>
                <th scope="row">{r.typeLabel}</th>
                {cols.map((col) => {
                  const cell = r.cells.find((c) => c.recipient === col.recipient);
                  if (!cell) return <td key={col.recipient} className="nm-na">{'—'}</td>;
                  const label = `${r.typeLabel}: ${col.label}`;
                  if (cell.locked) {
                    return (
                      <td key={col.recipient} className="nm-locked" title={LOCKED_REASON}>
                        <span aria-label={`${label} (always on)`}>Always</span>
                      </td>
                    );
                  }
                  if (!mayEdit) {
                    return (
                      <td key={col.recipient}>
                        <span className="soft" aria-label={label}>{cell.enabled ? 'Yes' : 'No'}</span>
                      </td>
                    );
                  }
                  return (
                    <td key={col.recipient}>
                      <label className="nm-cell">
                        <input
                          type="checkbox"
                          checked={cell.enabled}
                          disabled={busy !== null}
                          aria-label={label}
                          onChange={() => void flip(cell)}
                        />
                        <span>{cell.enabled ? 'Yes' : 'No'}</span>
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
