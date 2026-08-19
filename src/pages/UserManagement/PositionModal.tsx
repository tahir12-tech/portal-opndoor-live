/* =====================================================================
   Setting somebody's position.

   The model and the policies went in inert: nothing could create a scope row,
   so the whole hierarchy did nothing. This is the screen that makes it real.

   WHAT A POSITION IS. A role says what somebody may do; a position says over
   what. Head office covers a group, a director an agency, a branch manager one
   or more branches, and a negotiator covers their own referrals and needs no
   position at all. That last one is why this modal opens with "Own referrals"
   as a real, chosen state rather than an empty list: for most people it is the
   right answer and they should see that it has been answered.

   THE SCREEN IS NOT THE RULE. set_user_scope refuses a caller who does not hold
   a group or agency position of their own, so a branch manager who reaches this
   through the DOM is refused by SQL. The button is hidden as a courtesy.
   ===================================================================== */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { PeriodSelect } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import * as positions from '@/data/positionsService';
import type { ManagedUser } from '@/data/usersService';

export interface ScopeTarget { id: string; name: string; kind: positions.ScopeKind }

export function PositionModal({
  user, targets, onClose, onSaved,
}: {
  user: ManagedUser;
  /** Everything the CALLER can see: their own groups, brands and branches. */
  targets: ScopeTarget[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [held, setHeld] = useState<positions.Position[]>([]);
  const [kind, setKind] = useState<positions.ScopeKind>('branch');
  const [targetId, setTargetId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setHeld(await positions.getPositions(user.id)); }
    catch { toast('Could not load this person’s position.', 'error'); }
    finally { setLoading(false); }
  }, [user.id, toast]);

  useEffect(() => { void load(); }, [load]);

  const options = targets.filter((t) => t.kind === kind);

  const add = async () => {
    const t = options.find((o) => o.id === targetId);
    if (!t) return;
    setBusy(true);
    try {
      await positions.addPosition(user.id, kind, t.id, t.name);
      await load();
      onSaved();
      setTargetId('');
      toast(`${user.name} now covers ${t.name}.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not set that position.', 'error');
    } finally { setBusy(false); }
  };

  const remove = async (p: positions.Position) => {
    setBusy(true);
    try {
      await positions.removePosition(user.id, p.id);
      await load();
      onSaved();
      toast(`${user.name} no longer covers ${p.targetName}.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not remove that position.', 'error');
    } finally { setBusy(false); }
  };

  return (
    <Modal
      open
      title={`What ${user.name} can see`}
      sub="A role says what somebody may do. A position says over what."
      onClose={onClose}
      width={620}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Done</Button>
          <Button variant="primary" disabled={!targetId || busy} onClick={() => void add()}>
            {busy ? 'Saving…' : 'Add position'}
          </Button>
        </>
      }
    >
      {loading ? (
        <p className="soft">Loading…</p>
      ) : held.length === 0 ? (
        <div className="pos-empty">
          <Icon name="users" />
          <div>
            <strong>Own referrals only.</strong>
            <div className="soft">
              That is the right answer for a negotiator, and it needs nothing set.
              Add a position below only if they oversee other people’s work.
            </div>
          </div>
        </div>
      ) : (
        <ul className="pos-list">
          {held.map((p) => (
            <li key={p.id} className="pos-item">
              <Icon name={p.kind === 'group' ? 'building' : p.kind === 'agency' ? 'org' : 'home'} />
              <div className="pos-item__txt">
                <div className="pos-item__name">{p.targetName}</div>
                <div className="soft">
                  {p.kind === 'group' ? 'Every brand and branch in this group'
                    : p.kind === 'agency' ? 'Every branch of this brand'
                    : 'This branch'}
                </div>
              </div>
              <Button variant="quiet" size="sm" disabled={busy} onClick={() => void remove(p)}>Remove</Button>
            </li>
          ))}
        </ul>
      )}

      <div className="pos-add">
        <Field label="Add">
          <PeriodSelect
            ariaLabel="Scope kind" value={kind}
            onChange={(v) => { setKind(v as positions.ScopeKind); setTargetId(''); }}
            options={[
              { value: 'branch', label: 'A branch' },
              { value: 'agency', label: 'A whole brand' },
              { value: 'group', label: 'A whole group' },
            ]}
          />
        </Field>
        <Field label="Which">
          <PeriodSelect
            ariaLabel="Target" value={targetId} onChange={setTargetId}
            options={[
              { value: '', label: options.length ? 'Please choose' : 'Nothing available at this level' },
              ...options.map((o) => ({ value: o.id, label: o.name })),
            ]}
          />
        </Field>
      </div>

      {/* Several rows of one kind is how "a branch manager over three branches"
          is said, so adding does not replace. */}
      <p className="soft">
        Add more than one to cover several. Someone covering two branches has two positions.
      </p>

    </Modal>
  );
}
