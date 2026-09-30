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

   ONE POSITION, AND IT IS SWAPPED, NOT ADDED. Round 5, M12. There is no insert
   policy on user_scopes: positions are granted only through set_user_scope,
   which REPLACES. So nobody has ever held two, and a button saying "Add
   position" over a list of held positions promised accumulation while the
   write underneath was a swap -- pressing it silently deleted the position the
   person already had.

   AND REMOVE ONLY WORKS ON SOMEBODY DEACTIVATED. The deferred constraint from
   20261006300000 refuses to leave an active person on our estate with no
   position, so Remove on the only position of an active person always errored.
   It was offered in exactly the case where it cannot work. The product's real
   answer is: place them somewhere else, or deactivate them.
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

const REMOVE_HINT =
  'A position can only be taken away once somebody is deactivated, because nobody '
  + 'on our estate works without one. Move them to another group, brand or branch '
  + 'instead, or deactivate them first.';

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
  /* WHERE THEY WORK. Round 6, M12: set_home_branch had no caller anywhere in
     the product, so a person invited to the wrong office could never be moved.
     It belongs here rather than on a new screen because this modal is already
     the answer to "where does this person sit", and for a Negotiator the home
     branch IS their placement -- the position list above is empty for them by
     design. */
  const [home, setHome] = useState<string>(
    positions.mockHomeBranch(user.id) ?? user.homeBranchId ?? '',
  );
  const [homeBusy, setHomeBusy] = useState(false);

  const load = useCallback(async () => {
    try { setHeld(await positions.getPositions(user.id)); }
    catch { toast('Could not load this person’s position.', 'error'); }
    finally { setLoading(false); }
  }, [user.id, toast]);

  useEffect(() => { void load(); }, [load]);

  const options = targets.filter((t) => t.kind === kind);
  const branches = targets.filter((t) => t.kind === 'branch');

  /* The one case the constraint allows. Everything else is a move. */
  const canRemove = user.status === 'deactivated';

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

  const moveHome = async (branchId: string) => {
    const prev = home;
    setHome(branchId);
    setHomeBusy(true);
    try {
      await positions.setHomeBranch(user.id, branchId || null);
      onSaved();
      const name = branches.find((b) => b.id === branchId)?.name;
      toast(branchId ? `${user.name} now works at ${name}.` : `${user.name} is no longer placed at an office.`);
    } catch (e) {
      setHome(prev);
      toast(e instanceof Error ? e.message : 'Could not move them.', 'error');
    } finally { setHomeBusy(false); }
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
      title="Office and responsibilities"
      sub={`Two different things about ${user.name}: where they work, and what they oversee.`}
      onClose={onClose}
      width={620}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Done</Button>
          <Button variant="primary" disabled={!targetId || busy} onClick={() => void add()}>
            {busy ? 'Saving…' : held.length ? 'Move position' : 'Set position'}
          </Button>
        </>
      }
    >
      {loading ? (
        <p className="soft">Loading…</p>
      ) : (
        <>
        {/* WALK FIX 6. WHERE THEY WORK, FIRST AND SEPARATELY. "Split it into
            two clearly labelled parts: 'Works at' (their home office, which
            decides their team, league and commission statement) and
            'Oversees' (the branches, brand or agency they manage, which
            decides what they can see)."

            The two were interleaved: an office picker sat between a list of
            positions and the control that changes them, with nothing saying
            they answered different questions. Works at comes first because
            for most people it is the only one of the two that applies -- a
            Negotiator has an office and oversees nobody. */}
        <section className="pos-sec">
          <h4 className="pos-h">Works at</h4>
          <p className="pos-sub">
            Their office. It decides their team, their place in the league, and
            which commission statement they are on.
          </p>
          {branches.length > 0 ? (
            <Field label="Office">
              <select
                aria-label="Where they work"
                value={home}
                disabled={homeBusy || busy}
                onChange={(e) => void moveHome(e.target.value)}
              >
                <option value="">No office</option>
                {branches.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          ) : (
            /* set_home_branch refuses a branch the caller does not reach, and
               `targets` is already narrowed to their reach, so an empty list
               means there is nothing they could legitimately choose. Saying so
               beats an empty select. */
            <p className="soft">No office here that you can place somebody at.</p>
          )}
        </section>

        <section className="pos-sec">
          <h4 className="pos-h">Oversees</h4>
          <p className="pos-sub">
            The branches, brand or agency they are responsible for. It decides
            what they can see.
          </p>
          {held.length === 0 ? (
            <div className="pos-empty">
              <Icon name="users" />
              <div>
                <strong>Own referrals only.</strong>
                <div className="soft">
                  That is the right answer for a negotiator, and it needs nothing set.
                  Give them something to oversee below only if they manage other
                  people’s work.
                </div>
              </div>
            </div>
          ) : (
            <>
            <p className="soft pos-note">
              Everybody holds one position. Choosing another below moves {user.name} to it;
              it is not added alongside.
            </p>
            <ul className="pos-list">
              {held.map((p) => (
                <li key={p.id} className="pos-item">
                  <Icon name={p.kind === 'group' ? 'building' : p.kind === 'agency' ? 'org' : 'home'} />
                  <div className="pos-item__txt">
                    <div className="pos-item__name">{p.targetName}</div>
                    <div className="soft">
                      {p.kind === 'group' ? 'Every agency and branch in this group'
                        : p.kind === 'agency' ? 'Every branch of this agency'
                        : 'This branch'}
                    </div>
                  </div>
                  {/* Offered, but only pressable where it can succeed. Hiding it
                      entirely would leave no answer to "how do I take this away";
                      disabling it with the reason says what to do instead. */}
                  <Button
                    variant="quiet" size="sm"
                    disabled={busy || !canRemove}
                    title={canRemove ? undefined : REMOVE_HINT}
                    onClick={() => void remove(p)}
                  >Remove</Button>
                </li>
              ))}
            </ul>
            {!canRemove && <p className="soft pos-note">{REMOVE_HINT}</p>}
            </>
          )}

          <div className="pos-add">
            <Field label="Responsible for">
              <PeriodSelect
                ariaLabel="Scope kind" value={kind}
                onChange={(v) => { setKind(v as positions.ScopeKind); setTargetId(''); }}
                options={[
                  { value: 'branch', label: 'A branch' },
                  { value: 'agency', label: 'A whole agency' },
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
        </section>
        </>
      )}
    </Modal>
  );
}
