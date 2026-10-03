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
/* THE STYLES THIS FORM USES. `.ac-shapes`, `.ac-agency` and now
   `.ac-problems` live in AgencyHome.css beside their siblings, and this
   component renders inside OrgManagement, which loads a different
   stylesheet. They were arriving only when some other route had already
   pulled AgencyHome.css in. A component imports the CSS it needs. */
import './AgencyHome.css';
import { plural } from '@/lib/plural';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOUSE = 'opndoor-agents';

type Shape = 'independent' | 'group' | 'join';

/* THE AGENCY'S OWN ADDRESS, NOT ITS FIRST BRANCH.

   Matt, 2026-10-01: "Don't ask for a branch to create an agency: ask for the
   agency's name and address; that becomes its office behind the scenes, never
   shown separately. 'Add another branch' stays available for agencies with
   several offices."

   Which is NM-P's rule arriving in the create form. Every application hangs
   off a branch and always will; what stops is SHOWING the office to somebody
   who has one. So the form asks the two things an onboarder actually knows --
   the name and where they are -- and the office is made behind them, named
   after the agency.

   `extra` is the offices BEYOND that one, for an agency with several. It is
   empty for almost every agency, which is why it starts empty rather than
   with a blank row demanding to be filled in. */
/* `contactEmail` is OPTIONAL. Matt, 2026-10-02, correcting himself the
   same day: "Opndoor's own agencies (like Regent): no email required.
   Signed deeds go to whoever sent the referral (plus the people already
   ticked to receive them, as now). The agency or a branch can optionally
   add an email that also receives the deed; leave it blank and nothing is
   missing."

   This screen only ever creates on our own estate, so it is always
   optional here. A supplier's agency does need one, and it is the RPC
   that refuses a blank one there. */
interface DraftAgency { name: string; address: string; contactEmail: string; contactName: string; ratePct: string; extra: string[] }
const emptyAgency = (): DraftAgency => ({ name: '', address: '', contactEmail: '', contactName: '', ratePct: '', extra: [] });

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
  const setExtra = (i: number, bi: number, v: string) =>
    setDrafts((d) => d.map((x, j) => (j === i ? { ...x, extra: x.extra.map((b, k) => (k === bi ? v : b)) } : x)));

  /* THE SENTENCE. Stated before anything is created, naming every parent. */
  const sentence = (() => {
    if (shape === 'independent') {
      const n = drafts[0]?.name.trim() || 'a new agency';
      const bs = 1 + (drafts[0]?.extra.filter((b) => b.trim()).length ?? 0);
      return `You're creating ${n} as an independent agency with ${bs} ${plural(bs, 'office')}. No group sits above it.`;
    }
    if (shape === 'group') {
      const n = groupName.trim() || 'a new group';
      const count = drafts.filter((d) => d.name.trim()).length;
      return `You're creating the group ${n} with ${count} ${plural(count, 'agency')} inside it.`;
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

  /* WHAT IS MISSING, NAMED. Matt, 2026-10-01: "Create must never do nothing.
     If anything is missing or the save fails, show the reason next to the
     field or at the top of the form."

     IT USED TO BE A BOOLEAN. `canSave` disabled the button and said nothing,
     so an onboarder who typed the agency name and pressed Create got a dead
     control and no reason -- and the thing it was silently waiting for was a
     BRANCH NAME, which Matt has now said not to ask for at all. The two
     halves of his instruction are the same bug from either end.

     A REASON PER FIELD, so the message can sit beside the box it is about,
     and the same list makes the one at the top. */
  const problems: { field: string; why: string }[] = [];
  if (shape === 'group' && !groupName.trim()) {
    problems.push({ field: 'ac-groupname', why: 'Give the group a name.' });
  }
  if (shape === 'join' && !joinGroupId) {
    problems.push({ field: 'ac-join', why: 'Choose the group this agency is joining.' });
  }
  drafts.forEach((d, i) => {
    /* AN EMPTY EXTRA AGENCY ROW IS NOT A PROBLEM when it is not the only
       one: a group form with three rows and two filled in means two. The
       FIRST row always has to be filled, or nothing is being created. */
    if (!d.name.trim() && (i === 0 || d.address.trim() || d.ratePct.trim())) {
      problems.push({ field: `ac-name-${i}`, why: 'Give the agency a name.' });
    }
    /* BOTH AT ONCE, not one per press. With an empty form the first press
       used to report only the missing name; fixing that and pressing again
       then reported the missing address. Two round trips to learn two
       things the form knew from the start. */
    if ((d.name.trim() || i === 0) && !d.address.trim()) {
      problems.push({ field: `ac-addr-${i}`, why: 'Give the agency an address. It becomes its office.' });
    }
    /* THE ADDRESS IS OPTIONAL, so only its SHAPE is a problem. An empty
       one is not: on our own estate a deed goes to the referrer and the
       ticked people, and this address is an addition. */
    if (d.contactEmail.trim() && !EMAIL_RE.test(d.contactEmail.trim())) {
      problems.push({ field: `ac-email-${i}`, why: 'That is not an email address.' });
    }
  });
  if (!emailOk) {
    problems.push({ field: 'ac-inv-email', why: 'That is not an email address.' });
  }
  const problemFor = (field: string) => problems.find((p) => p.field === field)?.why;
  const [showProblems, setShowProblems] = useState(false);

  const save = async () => {
    if (busy || !shape) return;
    /* THE BUTTON IS ALWAYS LIVE. Pressing it either creates or SAYS WHY NOT,
       which is the whole instruction: a control that does nothing teaches
       the reader that the form is broken, and they have no way to find out
       which of eight fields it is waiting for. */
    if (problems.length) { setShowProblems(true); return; }
    setBusy(true);
    try {
      const specs: AgencySpec[] = namedAgencies.map((d) => ({
        name: d.name.trim(),
        agentRate: pctToFrac(d.ratePct),
        contactEmail: d.contactEmail.trim() || undefined,
        contactName: d.contactName.trim() || undefined,
        /* THE OFFICE IS MADE BEHIND THE AGENCY, named after it and carrying
           the address that was typed. Matt: "that becomes its office behind
           the scenes, never shown separately." A single-office agency
           therefore has an office whose name is its own, which is exactly
           what NM-P's "no Branch line for a single-office agency" renders
           as nothing. */
        branches: [
          { name: d.name.trim(), area: d.address.trim() },
          ...d.extra.filter((b) => b.trim()).map((b) => ({ name: b.trim() })),
        ],
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
      <Field label="Agency name" htmlFor={`ac-name-${i}`}
        error={showProblems ? problemFor(`ac-name-${i}`) : undefined}>
        <input id={`ac-name-${i}`} type="text" autoComplete="off" placeholder="e.g. Example Lettings" value={d.name} onChange={(e) => setDraft(i, { name: e.target.value })} />
      </Field>
      {/* THE ADDRESS, NOT A BRANCH NAME. It becomes the agency's office,
          named after the agency, and is never shown as a separate thing. */}
      <Field label="Agency address" htmlFor={`ac-addr-${i}`}
        hint="Where they work from. This becomes their office."
        error={showProblems ? problemFor(`ac-addr-${i}`) : undefined}>
        <input id={`ac-addr-${i}`} type="text" autoComplete="off" placeholder="e.g. 14 High Street, Chester CH1 2EX" value={d.address} onChange={(e) => setDraft(i, { address: e.target.value })} />
      </Field>
      {/* AN EXTRA PLACE THE DEED GOES, not the only one. On our own estate
          it reaches whoever sent the referral and anybody ticked for it;
          this address is copied in as well, where there is one. */}
      <Field label="Contact email" htmlFor={`ac-email-${i}`}
        hint="Optional. A signed deed also goes here, and every office of theirs uses it unless it has its own."
        error={showProblems ? problemFor(`ac-email-${i}`) : undefined}>
        <input id={`ac-email-${i}`} type="email" autoComplete="off" placeholder="lettings@example.co.uk" value={d.contactEmail} onChange={(e) => setDraft(i, { contactEmail: e.target.value })} />
      </Field>
      <Field label="Contact name" htmlFor={`ac-cname-${i}`} hint="Optional.">
        <input id={`ac-cname-${i}`} type="text" autoComplete="off" placeholder="e.g. Jane Smith" value={d.contactName} onChange={(e) => setDraft(i, { contactName: e.target.value })} />
      </Field>
      <Field label="Agency commission %" htmlFor={`ac-rate-${i}`} hint={`Blank earns the Opndoor standard (${fmtRatePct(base.agent)}).`}>
        <input id={`ac-rate-${i}`} inputMode="decimal" placeholder="standard" value={d.ratePct} onChange={(e) => setDraft(i, { ratePct: e.target.value })} />
      </Field>
      {/* FURTHER OFFICES, for an agency that has them. Matt: "'Add another
          branch' stays available for agencies with several offices." Almost
          none do at the moment they are onboarded, so there is no blank row
          sitting there asking to be filled in. */}
      {d.extra.map((b, bi) => (
        <Field key={bi} label={`Another office ${bi + 1}`} htmlFor={`ac-br-${i}-${bi}`}>
          <input id={`ac-br-${i}-${bi}`} type="text" autoComplete="off" placeholder="e.g. Example Central" value={b} onChange={(e) => setExtra(i, bi, e.target.value)} />
        </Field>
      ))}
      <button className="ah-linkbtn" onClick={() => setDraft(i, { extra: [...d.extra, ''] })}>
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
            <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Creating…' : 'Create'}</Button>
          </>
        : <Button variant="ghost" onClick={close}>Cancel</Button>}
    >
      {/* AND AT THE TOP, because a reason beside a field the reader has
          scrolled past is a reason they will not find. Matt: "show the
          reason next to the field or at the top of the form" -- both, since
          this form is long enough to hide one. */}
      {shape && showProblems && problems.length > 0 && (
        <div className="ac-problems" role="alert">
          <Icon name="alert" />
          <div>
            <b>{problems.length === 1 ? 'One thing is missing' : `${problems.length} things are missing`}</b>
            <ul>
              {problems.map((pr) => <li key={pr.field}>{pr.why}</li>)}
            </ul>
          </div>
        </div>
      )}

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
          <Field label="Group name" htmlFor="ac-groupname" error={showProblems ? problemFor('ac-groupname') : undefined}><input id="ac-groupname" type="text" autoComplete="off" placeholder="e.g. Example Property Group" value={groupName} onChange={(e) => setGroupName(e.target.value)} /></Field>
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
            <Field span2 label="Email" htmlFor="ac-inv-email" error={showProblems ? problemFor('ac-inv-email') : undefined}><input id="ac-inv-email" type="email" autoComplete="off" placeholder="manager@example.co.uk" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} /></Field>
            <Field label="First name" htmlFor="ac-inv-first" hint="Optional"><input id="ac-inv-first" type="text" autoComplete="off" value={invFirst} onChange={(e) => setInvFirst(e.target.value)} /></Field>
            <Field label="Last name" htmlFor="ac-inv-last" hint="Optional"><input id="ac-inv-last" type="text" autoComplete="off" value={invLast} onChange={(e) => setInvLast(e.target.value)} /></Field>
            {/* Only levels that exist in the shape being created. */}
            <Field span2 label="Level" htmlFor="ac-inv-level">
              <select id="ac-inv-level" value={invLevel} onChange={(e) => setInvLevel(e.target.value as 'group' | 'agency')}>
                {/* Both are DIRECTORS: the first person on a new org is the one
                    who will staff it, and only a Director may hand out a level.
                    Labelling this "Agency manager" while creating a Director
                    would be the same mismatch the other way round. */}
                {levels.includes('group') && <option value="group">Group director</option>}
                {levels.includes('agency') && <option value="agency">Agency director</option>}
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
