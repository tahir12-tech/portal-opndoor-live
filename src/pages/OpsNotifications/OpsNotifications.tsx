/* WHERE OPNDOOR'S OWN ALERTS GO.
 *
 * Q-04. Until now every internal alert of every kind went to one address read
 * from an environment variable, and if that variable was unset the alert was
 * dropped with nothing but an ops_alerts row to show for it. See
 * docs/OPS-NOTIFICATIONS.md for the whole inventory.
 *
 * ONE SCREEN, FOUR GROUPS, ONE COLUMN PER RECIPIENT. Types down, people and
 * shared inboxes across. The page holds no list of its own: which types
 * exist, which group each is in, which are critical, and who can be routed to
 * all come back from `ops_routing_matrix`. A new shared inbox appears here
 * without a client change, and a type nothing raises is never offered --
 * a switch for something that never fires reads as coverage.
 *
 * THE FLOOR IS SHOWN, NOT JUST ENFORCED. "Critical types can be rerouted but
 * never left with zero recipients: refused in SQL and shown as locked below
 * one." So the last live recipient of a critical type is drawn locked with
 * the reason, and the SQL refuses it anyway -- the screen is the courtesy and
 * the trigger is the rule.
 *
 * SUPERADMIN EDITS, opndoor_manager VIEWS. Enforced in set_ops_route; the
 * page renders values without controls for anybody else, rather than controls
 * that each refuse.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  OPS_FLOOR_REASON, OPS_ROUTING_NOTE, getOpsRoutingMatrix, isLastCritical,
  setOpsRoute, toGroups, toRecipients, type OpsRouteCell,
} from '@/data/opsRoutingService';
import { useSession } from '@/session/SessionContext';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Card, CardHead } from '@/components/ui/Card';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Pill } from '@/components/ui/Pill';
import { useToast } from '@/components/ui/Toast';
import './OpsNotifications.css';

export function OpsNotifications() {
  usePageMeta('internal-notifications', 'Internal notifications', ['Home', 'opndoor', 'Internal notifications']);
  const { role } = useSession();
  const toast = useToast();
  const mayEdit = role === 'superadmin';

  const [cells, setCells] = useState<OpsRouteCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setCells(await getOpsRoutingMatrix()); }
    catch { setCells([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const flip = async (c: OpsRouteCell) => {
    setBusy(true);
    try {
      await setOpsRoute(c.alertType, c.recipientKind, c.recipientId, !c.enabled);
      /* RELOADED RATHER THAN PATCHED. Turning one cell changes the LIVE COUNT
         of its type, which is what decides whether the remaining cells are
         locked, so a local edit would leave the floor drawn wrong until the
         next visit. */
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change that.', 'error');
    } finally { setBusy(false); }
  };

  if (loading) return null;

  const groups = toGroups(cells);
  const recipients = toRecipients(cells);

  if (!groups.length) {
    return (
      <Card>
        <CardHead title={<><Eyebrow>Notifications</Eyebrow>Internal notifications</>} />
        <p className="soft">There is nobody to route alerts to yet. Add an opndoor team member or a shared inbox first.</p>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHead title={<><Eyebrow>Notifications</Eyebrow>Where opndoor’s own alerts go</>} />
        <p className="soft on-note">{OPS_ROUTING_NOTE}</p>
        {!mayEdit && (
          <p className="soft on-note">This is how it is set. Changing it is done by an opndoor admin.</p>
        )}
      </Card>

      {groups.map((g) => (
        <Card key={g.group}>
          <CardHead title={<><Eyebrow>{g.group}</Eyebrow>{
            g.group === 'Critical' ? 'Always reaches somebody'
              : g.group === 'Operations' ? 'Somebody has to do something'
              : g.group === 'Commercial' ? 'Money and renewals'
              : 'Worth knowing'
          }</>} />
          <div className="on-scroll">
            <table className="on-grid">
              <thead>
                <tr>
                  <th scope="col">Alert</th>
                  {recipients.map((r) => (
                    <th key={r.id} scope="col" title={r.email}>
                      {r.name}
                      {r.kind === 'inbox' && <span className="on-inbox">shared</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.types.map((t) => (
                  <tr key={t.alertType}>
                    <th scope="row">
                      {t.label}
                      {t.critical && t.liveCount <= 1 && (
                        <Pill variant="warn">{t.liveCount === 0 ? 'unrouted' : 'last one'}</Pill>
                      )}
                    </th>
                    {recipients.map((r) => {
                      const cell = t.cells.find((c) => c.recipientId === r.id);
                      if (!cell) return <td key={r.id} className="on-na">{'—'}</td>;
                      const label = `${t.label}: ${r.name}`;
                      const locked = isLastCritical(cell);
                      if (!mayEdit) {
                        return (
                          <td key={r.id}>
                            <span className="soft" aria-label={label}>{cell.enabled ? 'Yes' : 'No'}</span>
                          </td>
                        );
                      }
                      return (
                        <td key={r.id}>
                          <label className="on-cell" title={locked ? OPS_FLOOR_REASON : undefined}>
                            <input
                              type="checkbox"
                              checked={cell.enabled}
                              disabled={busy || locked}
                              aria-label={locked ? `${label} (locked: last recipient)` : label}
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
          {g.group === 'Critical' && (
            <p className="soft on-note">
              A critical alert cannot be left with nobody to receive it. If one ever is,
              it goes to support@opndoor.co marked UNROUTED rather than being lost.
            </p>
          )}
        </Card>
      ))}
    </>
  );
}
