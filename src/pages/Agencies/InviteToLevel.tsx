/* =====================================================================
   InviteToLevel — invite a person from the level they belong to (a branch, a
   brand, or a group), reached from the People blocks on the agency page.

   A branch invite places a negotiator at that branch immediately (home branch).
   A brand/group manager is invited here; their exact position is set from Users
   once they accept — inviteUser returns before the real account id exists, so the
   scope grant cannot be attached in the same step.
   ===================================================================== */
import { useMemo, useState } from 'react';
import { AGENCY_LEVELS, ALL_PARTNERS, getAgencies, inviteUser, type AgencyLevel, type Role } from '@/data';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

export interface InviteContext {
  level: 'group' | 'brand' | 'branch';
  /** Owning partner slug — passed to the invite, never shown. */
  partner: string;
  /** The node's display name (group / brand / branch), for the modal copy. */
  name: string;
  groupId?: string;
  agencyId?: string;
  branchId?: string;
  /** Offer the three agency levels explicitly rather than inferring one from the
      node. Used by the People tab, where an admin is adding somebody to an
      agency rather than to a particular node and may set any level. */
  chooseLevel?: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteToLevel({ ctx, onClose, onInvited }: { ctx: InviteContext; onClose: () => void; onInvited: () => void }) {
  const toast = useToast();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  // At a branch you can invite a negotiator (referrer, placed at the branch) or a
  // branch manager. Above a branch, the person is a manager/director.
  const [branchRole, setBranchRole] = useState<Role>('referrer');
  const [chosen, setChosen] = useState<AgencyLevel>('Negotiator');
  const [busy, setBusy] = useState(false);

  /* THE LEVEL, AND THE BUG THAT WAS IN IT.

     inviteUser takes role AND seesCommission, because Director and Manager are
     the same role and differ only in that bit. This dialog never sent it, and
     users.sees_commission defaults to false, so EVERY person invited from here
     landed as a Manager. The group dialog is titled "Invite group director" and
     created a Manager: it said the level out loud and then did not set it.

     Both paths now send the pair. The inferred path says what each title has
     always promised (a group director is a Director, an agency or branch manager
     is a Manager), and the explicit path is the People tab, where an admin picks
     from the same three levels the Team dialog offers. */
  const inferredLevel: AgencyLevel = ctx.level === 'group' ? 'Director'
    : ctx.level === 'brand' ? 'Manager'
    : branchRole === 'management' ? 'Manager' : 'Negotiator';
  const level: AgencyLevel = ctx.chooseLevel ? chosen : inferredLevel;
  const spec = AGENCY_LEVELS.find((l) => l.level === level)!;
  const role: Role = spec.role;

  const levelWord = ctx.level === 'group' ? 'group' : ctx.level === 'brand' ? 'agency' : 'branch';
  const titleFor = ctx.chooseLevel ? 'Invite someone'
    : ctx.level === 'group' ? 'Invite group director'
    : ctx.level === 'brand' ? 'Invite agency manager'
    : 'Invite branch manager or negotiator';

  const canSend = !!email.trim() && EMAIL_RE.test(email.trim()) && !busy && !!ctx.partner;
  const [tried, setTried] = useState(false);

  // The position granted on creation. A negotiator (referrer) is placed by their
  // home branch instead of a scope; a group/brand/branch manager gets a scope.
  /* A NEGOTIATOR IS PLACED BY THEIR HOME BRANCH AND HOLDS NO POSITION, which the
     model has always said and which the explicit-level path would otherwise have
     broken: the scope came from the NODE, so choosing Negotiator on an agency's
     People tab would have granted them an agency-wide position, making a person
     who should see their own referrals see everybody's.

     So the scope follows the LEVEL chosen, not the node it was chosen from. A
     Negotiator invited from the People tab gets neither a scope nor a branch,
     lands unplaced, and the admin sets where they sit with Position on their
     row, which is what the dialog's closing line tells them to do. */
  /* WALK FIX 13. THE DIALOG ASKS WHERE THEY SIT, AND PLACES THEM IN ONE STEP.

     The paragraph above described a design that stopped being possible.
     20261006300000 made an unpositioned active person a constraint violation,
     so "lands unplaced, and the admin sets where they sit afterwards" is a
     plan the database refuses to let anybody carry out: invite-user returns
     NEEDS_A_POSITION and the invite dies after the form is filled in. The
     screen was telling the admin to do something the server had already said
     no to.

     So the question is asked HERE, before sending, and the position is
     created in the same transaction as the user (create_invited_user has
     taken p_scope_kind and p_scope_target all along -- the form simply never
     filled them in).

     AND IT IS NOT ASKED WHEN THERE IS ONE ANSWER. Matt: "If the agency has
     only one branch, pick it automatically and don't ask." */
  const branches = useMemo(() => {
    if (!ctx.agencyId) return [];
    const ag = getAgencies(ALL_PARTNERS).find((a) => a.id === ctx.agencyId);
    return (ag?.branches ?? []).filter((b) => !!b.id);
  }, [ctx.agencyId]);

  const [whereId, setWhereId] = useState('');

  /* A NEGOTIATOR SITS AT A BRANCH. A Manager or Director may sit at the whole
     agency or at one branch, so the agency is offered first and is the
     default -- which is what this dialog already did for them, now stated in
     a control instead of inferred silently. */
  const mustPickBranch = level === 'Negotiator';
  const whereOptions: { id: string; label: string; kind: 'agency' | 'branch' }[] = [
    ...(mustPickBranch || !ctx.agencyId ? [] : [{ id: ctx.agencyId, label: `${ctx.name} (whole agency)`, kind: 'agency' as const }]),
    ...branches.map((b) => ({ id: b.id!, label: b.name, kind: 'branch' as const })),
  ];
  // One option is not a question. Two or more is.
  const askWhere = ctx.chooseLevel && whereOptions.length > 1;
  const chosenWhere = whereOptions.find((o) => o.id === whereId) ?? whereOptions[0];

  const scope: { scopeKind?: 'group' | 'agency' | 'branch'; scopeTarget?: string } =
    ctx.chooseLevel && chosenWhere ? { scopeKind: chosenWhere.kind, scopeTarget: chosenWhere.id }
    : ctx.level === 'group' && ctx.groupId ? { scopeKind: 'group', scopeTarget: ctx.groupId }
    : ctx.level === 'brand' && ctx.agencyId ? { scopeKind: 'agency', scopeTarget: ctx.agencyId }
    : ctx.level === 'branch' && ctx.branchId ? { scopeKind: 'branch', scopeTarget: ctx.branchId }
    : {};

  const send = async () => {
    /* PRESSABLE, AND IT SAYS WHY. Matt, 2026-10-03: "Same for every form in
       the portal." This refusal existed and could never run, because the
       button was disabled until the form was valid: a reader with the email
       blank pressed nothing and was told nothing. One required field, so the
       field's own mark is the whole answer and there is no count to show. */
    if (!canSend) {
      setTried(true);
      if (email.trim() && !EMAIL_RE.test(email.trim())) toast('Enter a valid email address.', 'error');
      return;
    }
    setBusy(true);
    try {
      await inviteUser({
        firstName: first.trim(), lastName: last.trim(), email: email.trim(),
        role, seesCommission: spec.seesCommission,
        partner: ctx.partner,
        // The home branch is the branch node's own, and only a branch node has
        // one. From the People tab there is no branch in hand, so a Negotiator
        // arrives unplaced rather than placed at a guess.
        branch: ctx.branchId,
        ...scope,
      });
      toast(`Invited, and placed at ${ctx.name}.`, 'ok');
      onInvited();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not send the invitation.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={() => { if (!busy) onClose(); }}
      title={titleFor}
      sub={`${ctx.name} · they will be invited to Opndoor and land in this ${levelWord}.`}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send invite'}</Button></>}
    >
      <div className="form-grid">
        <Field span2 label={<>Work email <span className="req" aria-hidden="true">*</span></>} htmlFor="inv-email" error={tried && !email.trim() ? 'Required' : undefined}><input id="inv-email" type="email" autoComplete="off" placeholder="name@example.co.uk" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="First name" htmlFor="inv-first" hint="Optional"><input id="inv-first" type="text" autoComplete="off" value={first} onChange={(e) => setFirst(e.target.value)} /></Field>
        <Field label="Last name" htmlFor="inv-last" hint="Optional"><input id="inv-last" type="text" autoComplete="off" value={last} onChange={(e) => setLast(e.target.value)} /></Field>
      </div>
      {ctx.chooseLevel && (
        <div className="roleopts" style={{ marginTop: 14 }}>
          {AGENCY_LEVELS.map((o) => (
            <label key={o.level} className={`roleopt${level === o.level ? ' is-sel' : ''}`} onClick={() => setChosen(o.level)}>
              <span className="roleopt__radio" />
              <div><div className="roleopt__name">{o.level}</div><div className="roleopt__desc">{o.desc}</div></div>
            </label>
          ))}
        </div>
      )}
      {askWhere && (
        <Field
          label="Where they sit"
          htmlFor="inv-where"
          hint={mustPickBranch
            ? 'A negotiator works one office, and sees their own referrals there.'
            : 'The whole agency, or one office of it.'}
        >
          <select
            id="inv-where"
            aria-label="Where they sit"
            value={chosenWhere?.id ?? ''}
            onChange={(e) => setWhereId(e.target.value)}
          >
            {whereOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Field>
      )}
      {!ctx.chooseLevel && ctx.level === 'branch' && (
        <Field label="Position" htmlFor="inv-role" hint="A negotiator works this branch; a branch manager runs it.">
          <select id="inv-role" value={branchRole} onChange={(e) => setBranchRole(e.target.value as Role)}>
            <option value="referrer">Negotiator</option>
            <option value="management">Branch manager</option>
          </select>
        </Field>
      )}
      <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', margin: '10px 0 0' }}>
        {/* WALK FIX 13. This used to read "Set where they sit with Position on
            their row" -- an instruction to finish afterwards a job the
            database will not let you start. Where they sit is chosen above
            and created with the invite, so the line now says what will
            happen rather than what to do next. */}
        {ctx.chooseLevel
          ? `They are invited to ${chosenWhere?.label ?? ctx.name} and can work there as soon as they accept.`
          : `They are placed on this ${levelWord} the moment they are invited, and can work it as soon as they accept.`}
      </p>
    </Modal>
  );
}
