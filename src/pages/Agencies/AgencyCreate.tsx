/* =====================================================================
   AgencyCreate — the admin "Add agency" flow, which asks the SHAPE first.

   Opndoor onboards three different things and they were all being squeezed
   through one form that could only make an independent agency with exactly one
   branch. A group then had to be assembled by making agencies one at a time and
   re-parenting them afterwards, which is the same end state reached the long way
   round and invited half-made orgs.

   So the first question is what is being created, and the form follows from the
   answer. All three build on createOrgShape, which uses the same primitives the
   grow path on a detail page uses, so an agency created here and an agency grown
   there are indistinguishable afterwards.

   SKELETON GROUPS ARE ALLOWED. An agency may be created with no branches; its
   manager adds them on first login. Nothing downstream needs a branch to exist.
   ===================================================================== */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getGroups, getRatesFor } from '@/data';
import { createOrgShape, inviteLevelsFor, type AgencySpec } from '@/data/orgShapes';
import { useSession } from '@/session/SessionContext';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { fmtRatePct } from '@/lib/format';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOUSE = 'opndoor-agents';

type Shape = 'independent' | 'group' | 'join';

interface DraftAgency { name: string; ratePct: string; branches: string[] }
const emptyAgency = (): DraftAgency => ({ name: '', ratePct: '', branches: [''] });

export function AgencyCreate({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { refresh } = useSession();
  const base = useMemo(() => getRatesFor(HOUSE), []);

  const [shape, setShape] = useState<Shape | null>(null);
  const [busy, setBusy] = useState(false);

  const [groupName, setGroupName] = useState('');
  const [groupRatePct, setGroupRatePct] = useState('');
  const [joinGroupId, setJoinGroupId] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [drafts, setDrafts] = useState<DraftAgency[]>([emptyAgency()]);

  const [invEmail, setInvEmail] = useState('');
  const [invFirst, setInvFirst] = useState('');
  const [invLast, setInvLast] = useState('');
  const [invLevel, setInvLevel] = useState<'group' | 'agency'>('agency');
  const [invAgencyIdx, setInvAgencyIdx] = useState(0);

  const groups = useMemo(() => getGroups(HOUSE), []);
  const groupMatches = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    return q ? groups.filter((g) => g.name.toLowerCase().includes(q)) : groups;
  }, [groups, groupSearch]);
  const joinGroup = groups.find((g) => g.id === joinGroupId);

  const reset = () => {
    setShape(null); setGroupName(''); setGroupRatePct(''); setJoinGroupId(''); setGroupSearch('');
    setDrafts([emptyAgency()]); setInvEmail(''); setInvFirst(''); setInvLast(''); setInvLevel('agency'); setInvAgencyIdx(0);
  };
  const close = () => { if (!busy) { reset(); onClose(); } };

  const pctToFrac = (s: string): number | null => {
    const t = s.replace('%', '').trim();
    if (!t) return null;
    const n = parseFloat(t);
    return isNaN(n) || n < 0 || n > 100 ? null : n / 100;
  };

  const setDraft = (i: number, patch: Partial<DraftAgency>) =>
    setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const setBranch = (i: number, bi: number, v: string) =>
    setDrafts((d) => d.map((x, j) => (j === i ? { ...x, branches: x.branches.map((b, k) => (k === bi ? v : b)) } : x)));

  /* THE SENTENCE. Stated before anything is created, naming every parent. */
  const sentence = (() => {
    if (shape === 'independent') {
      const n = drafts[0]?.name.trim() || 'a new agency';
      const bs = drafts[0]?.branches.filter((b) => b.trim()).length ?? 0;
      return `You're creating ${n} as an independent agency with ${bs} ${bs === 1 ? 'branch' : 'branches'}. No group sits above it.`;
    }
    if (shape === 'group') {
      const n = groupName.trim() || 'a new group';
      const count = drafts.filter((d) => d.name.trim()).length;
      return `You're creating the group ${n} with ${count} ${count === 1 ? 'agency' : 'agencies'} inside it.`;
    }
    if (shape === 'join') {
      const n = drafts[0]?.name.trim() || 'a new agency';
      return joinGroup
        ? `You're adding ${n} to the existing group ${joinGroup.name}.`
        : 'Choose the group this agency is joining.';
    }
    return '';
  })();

  const namedAgencies = drafts.filter((d) => d.name.trim());
  const emailOk = !invEmail.trim() || EMAIL_RE.test(invEmail.trim());
  const canSave = !busy && emailOk && namedAgencies.length > 0
    && (shape === 'independent' ? drafts[0].branches.some((b) => b.trim())
      : shape === 'group' ? !!groupName.trim()
      : shape === 'join' ? !!joinGroupId
      : false);

  const save = async () => {
    if (!canSave || !shape) return;
    setBusy(true);
    try {
      const specs: AgencySpec[] = namedAgencies.map((d) => ({
        name: d.name.trim(),
        agentRate: pctToFrac(d.ratePct),
        branches: d.branches.filter((b) => b.trim()).map((b) => ({ name: b.trim() })),
      }));
      const made = await createOrgShape({
        partner: HOUSE,
        groupName: shape === 'group' ? groupName.trim() : undefined,
        groupId: shape === 'join' ? joinGroupId : undefined,
        groupRate: shape === 'group' ? pctToFrac(groupRatePct) : undefined,
        agencies: specs,
        invite: invEmail.trim()
          ? { email: invEmail, firstName: invFirst, lastName: invLast, level: invLevel, agencyIndex: invAgencyIdx }
          : undefined,
      });
      await refresh();
      toast(invEmail.trim() ? 'Created, and the first invitation sent.' : 'Created.', 'ok');
      const to = made.groupId && shape !== 'join' ? made.groupId : made.agencyIds[0];
      reset(); onClose();
      if (to) navigate(`/agencies/${encodeURIComponent(to)}`);
    } catch (e) {
      // createOrgShape has already removed whatever it made.
      toast(e instanceof Error ? e.message : 'Could not create that. Nothing was left behind.', 'error');
    } finally { setBusy(false); }
  };

  const levels = shape ? inviteLevelsFor(shape) : [];

  const agencyBlock = (d: DraftAgency, i: number, showRemove: boolean) => (
    <div key={i} className="ac-agency">
      <div className="ac-agency__head">
        <b>{shape === 'independent' ? 'Agency' : `Agency ${i + 1}`}</b>
        {showRemove && <button className="ah-linkbtn ah-linkbtn--quiet" onClick={() => setDrafts((x) => x.filter((_, j) => j !== i))}>Remove</button>}
      </div>
      <Field label="Agency name" htmlFor={`ac-name-${i}`}>
        <input id={`ac-name-${i}`} type="text" autoComplete="off" placeholder="e.g. Northgate Lettings" value={d.name} onChange={(e) => setDraft(i, { name: e.target.value })} />
      </Field>
      <Field label="Agency commission %" htmlFor={`ac-rate-${i}`} hint={`Blank earns the Opndoor standard (${fmtRatePct(base.agent)}).`}>
        <input id={`ac-rate-${i}`} inputMode="decimal" placeholder="standard" value={d.ratePct} onChange={(e) => setDraft(i, { ratePct: e.target.value })} />
      </Field>
      {d.branches.map((b, bi) => (
        <Field key={bi} label={bi === 0 ? 'First branch' : `Branch ${bi + 1}`} htmlFor={`ac-br-${i}-${bi}`}
          hint={bi === 0 && shape !== 'independent' ? 'Optional — the manager can add branches on first login.' : undefined}>
          <input id={`ac-br-${i}-${bi}`} type="text" autoComplete="off" placeholder="e.g. Northgate Central" value={b} onChange={(e) => setBranch(i, bi, e.target.value)} />
        </Field>
      ))}
      <button className="ah-linkbtn" onClick={() => setDraft(i, { branches: [...d.branches, ''] })}>
        <Icon name="plus" size={12} /> Add another branch
      </button>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={close}
      title={shape ? 'Add agency' : 'What are you adding?'}
      sub={shape ? sentence : 'Opndoor onboards agencies; there is no self-registration.'}
      footer={shape
        ? <>
            <Button variant="ghost" onClick={() => setShape(null)} disabled={busy}>Back</Button>
            <Button variant="primary" onClick={save} disabled={!canSave}>{busy ? 'Creating…' : 'Create'}</Button>
          </>
        : <Button variant="ghost" onClick={close}>Cancel</Button>}
    >
      {!shape && (
        <div className="ac-shapes">
          <button className="ac-shape" onClick={() => setShape('independent')}>
            <b>An independent agency</b>
            <span>One agency and its branches, with no group above it. It can grow into a group later.</span>
          </button>
          <button className="ac-shape" onClick={() => setShape('group')}>
            <b>A group</b>
            <span>A group with one or more agencies inside it. Agencies may start with no branches; their managers add them.</span>
          </button>
          <button className="ac-shape" onClick={() => { setShape('join'); setInvLevel('agency'); }} disabled={groups.length === 0}>
            <b>An agency joining an existing group</b>
            <span>{groups.length === 0 ? 'There are no groups yet.' : 'Pick the group, then add the agency into it.'}</span>
          </button>
        </div>
      )}

      {shape === 'join' && (
        <>
          <Field label="Group" htmlFor="ac-group-search" hint="Search by name.">
            <input id="ac-group-search" type="text" autoComplete="off" placeholder="Search groups" value={groupSearch} onChange={(e) => setGroupSearch(e.target.value)} />
          </Field>
          <div className="ac-grouplist">
            {groupMatches.map((g) => (
              <button key={g.id} className={`ac-groupopt${joinGroupId === g.id ? ' is-on' : ''}`} onClick={() => setJoinGroupId(g.id)}>{g.name}</button>
            ))}
            {groupMatches.length === 0 && <div className="ah-empty">No group matches that.</div>}
          </div>
        </>
      )}

      {shape === 'group' && (
        <>
          <Field label="Group name" htmlFor="ac-groupname"><input id="ac-groupname" type="text" autoComplete="off" placeholder="e.g. Meridian Property Group" value={groupName} onChange={(e) => setGroupName(e.target.value)} /></Field>
          <Field label="Group commission %" htmlFor="ac-grouprate" hint="Optional. A group rate is its own line, paid to the group, on top of each agency's.">
            <input id="ac-grouprate" inputMode="decimal" placeholder="none" value={groupRatePct} onChange={(e) => setGroupRatePct(e.target.value)} />
          </Field>
        </>
      )}

      {shape && (
        <div className="ac-agencies">
          {drafts.map((d, i) => agencyBlock(d, i, shape === 'group' && drafts.length > 1))}
          {shape === 'group' && (
            <button className="ah-linkbtn" onClick={() => setDrafts((d) => [...d, emptyAgency()])}>
              <Icon name="plus" size={12} /> Add another agency
            </button>
          )}
        </div>
      )}

      {shape && (
        <div className="ac-invite">
          <div className="ac-invite__title">First invite <span className="soft">(optional)</span></div>
          <div className="form-grid">
            <Field span2 label="Email" htmlFor="ac-inv-email"><input id="ac-inv-email" type="email" autoComplete="off" placeholder="manager@agency.co.uk" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} /></Field>
            <Field label="First name" htmlFor="ac-inv-first" hint="Optional"><input id="ac-inv-first" type="text" autoComplete="off" value={invFirst} onChange={(e) => setInvFirst(e.target.value)} /></Field>
            <Field label="Last name" htmlFor="ac-inv-last" hint="Optional"><input id="ac-inv-last" type="text" autoComplete="off" value={invLast} onChange={(e) => setInvLast(e.target.value)} /></Field>
            {/* Only levels that exist in the shape being created. */}
            <Field span2 label="Level" htmlFor="ac-inv-level">
              <select id="ac-inv-level" value={invLevel} onChange={(e) => setInvLevel(e.target.value as 'group' | 'agency')}>
                {levels.includes('group') && <option value="group">Group director</option>}
                {levels.includes('agency') && <option value="agency">Agency manager</option>}
              </select>
            </Field>
            {invLevel === 'agency' && namedAgencies.length > 1 && (
              <Field span2 label="Which agency" htmlFor="ac-inv-ag">
                <select id="ac-inv-ag" value={invAgencyIdx} onChange={(e) => setInvAgencyIdx(Number(e.target.value))}>
                  {namedAgencies.map((d, i) => <option key={i} value={i}>{d.name.trim()}</option>)}
                </select>
              </Field>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
