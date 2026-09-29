/* =====================================================================
   AgentBranchPicker — the two linked select-or-add fields on the new
   application form. The agent field searches existing agencies (scoped to
   the user's partner) and offers "create new agent"; once an agent is chosen,
   the branch field unlocks, filtered to that agent's branches, with "create
   new branch" on the fly.

   When an agent (agency) is created on the fly, a contact block appears to
   capture the agency-default contact (email required; name and phone optional)
   so Send-deed-to-agent and the bordereau Claim Contact resolve to something
   reachable. A newly-created branch may optionally capture its own contact;
   absent one it inherits the agency default.

   #65 Single-office agents: when the chosen agency has no branches, a default
   "Head office" branch is used automatically (inheriting the agency contact),
   so no one has to invent a junk branch. Type a branch name to override it.

   AN AGENCY USER NEVER SEES THIS PICKER. Not the agency search, not the branch
   search, and not a create-on-the-fly option at either level. They get, in order
   of how much choice they actually have:

     one office            nothing at all. This component renders null and the
                           fact is one line under Tenancy in NewApplication.
     one agency, several   a line naming the agency, and a plain select of their
     offices               own offices.
     several agencies      a plain select of their own agencies, then the same
                           office select.

   A select, not a type-ahead with a "create new" row: the set is closed and
   small, and SQL refuses what the create row offers (agencies_insert,
   branches_insert, and create_referral_target since 20261005200000). Offering it
   and then having the submit refused is worse than not offering it.

   WHILE WE DO NOT KNOW WHICH OF THOSE APPLIES, nothing is drawn but a line
   saying so. The shape used to default to FULL_PICKER, the SUPPLIER shape, so an
   agency user saw the admin search box for as long as the call was in flight and
   permanently if it failed. That was the reported regression.

   The supplier and opndoor-admin form below is unchanged: inventing an agency
   mid-referral IS the product there. The same rule one level down on the admin
   form: once an agent with a single office is chosen, the branch step
   becomes a line rather than a search box. WHICH PREDICATE, and it matters:
   my_org_shape, read here, and NOT viewerShape. viewerShape counts the viewer's
   BOOK, so an office opened last week with no referrals through it yet counts as
   no office, and a form that collapsed on that would file a referral against the
   wrong branch silently and with no way to correct it. my_org_shape counts what
   the org actually holds, server side, through the same reach create_referral
   will use. viewerShape is right for a screen deciding how much of itself to
   draw over records already written; a form writes a new one, so it answers to
   the structure rather than to the history.

   #66 opndoor admins fly-create under an explicit partner: the referral's
   commission lands under it, so the partner is shown and chosen here rather
   than resolved silently from ambient scope. Existing agencies carry their own
   partner (shown in the option), which disambiguates same-named agencies.

   Entities created here write to the client org store for the picker UI; they
   are persisted (as pending_review, or confirmed for an admin) and the contact
   captured server-side when the referral is submitted (create-referral ->
   create_referral_target).
   ===================================================================== */
import { useEffect, useRef, useState } from 'react';
import { ALL_PARTNERS, createAgencyOnTheFly, createBranchOnTheFly, findAgency, getPartners, loadOrgShape, mayInventAgency, mayInventBranch, orgNotSetUp, ownStockViewer, searchAgencies, searchBranches, UNRESOLVED, type OrgShape } from '@/data';
import { useSession } from '@/session/SessionContext';
import { Icon } from '@/components/ui/Icon';
import { TypeAhead, highlightMatch, type TypeAheadOption } from '@/components/ui/TypeAhead';

const DEFAULT_BRANCH = 'Head office';

export interface AgentBranchValue {
  agency: string;
  branch: string;
  /** The agency/branch was created on the fly in this picker. */
  agencyNew: boolean;
  branchNew: boolean;
  /** Captured contact for a newly-created agency (email required when agencyNew). */
  agencyContactEmail: string;
  agencyContactName: string;
  agencyContactPhone: string;
  /** Optional contact for a newly-created branch. */
  branchContactEmail: string;
  /** The partner the referral belongs to: the chosen agency's own partner, or
      (admin fly-creation) the explicitly selected partner. '' when unresolved. */
  partner: string;
  /** #74 For a NEW agency only: has the "single-office agency?" question been
      answered? null = not yet (blocks submit); true = single office (auto Head
      office branch); false = has branches (name one). Always null for an
      existing agency, which is never asked. */
  singleOffice: boolean | null;
  /** What the form decided to ask. Emitted so the section heading can use the
      same answer instead of asking the server a second time. */
  shape: OrgShape;
}

export function AgentBranchPicker({ onChange }: { onChange?: (value: AgentBranchValue) => void }) {
  const { role, partnerScope } = useSession();
  const isAdmin = role === 'superadmin';
  /* What the form should ask. Derived on the server from what this person can
     reach, and from whether the partner owns its stock.

     UNRESOLVED until it arrives, and this used to be FULL_PICKER "because that
     is the shape the portal has always had and the one that loses nothing if the
     call fails". It loses a great deal: FULL_PICKER is the SUPPLIER shape, so
     every agency user saw an agency search box and an add-a-new-one option for
     as long as the call was in flight, and for ever if it failed. An unresolved
     shape offers nothing and claims nothing. See orgShapeService. */
  const [shape, setShape] = useState<OrgShape>(UNRESOLVED);
  const collapsedOnce = useRef(false);
  // Releasing the once-guard when the admin changes partner: the shape is a
  // different partner's now, so re-collapsing is correct rather than a repeat.
  const scopeSeen = useRef<string | null>(null);
  /* The escape hatch, and it now exists only where the escape is real.
     It used to sit under the one-office agency's own line as "A different
     branch?", which was an offer we could not keep: branches_insert refuses a
     new branch on our estate in SQL, and an agency with one office has nothing
     else to pick, so the link led to an empty search box. It is kept for the
     admin and supplier form, where inventing a branch mid-referral IS the
     product, and dropped for an agency user. */
  const [revealBranch, setRevealBranch] = useState(false);
  const [agentValue, setAgentValue] = useState('');
  const [selectedAgency, setSelectedAgency] = useState<string | null>(null);
  const [selectedAgencyPartner, setSelectedAgencyPartner] = useState<string | null>(null);
  const [agencyNew, setAgencyNew] = useState(false);
  const [branchValue, setBranchValue] = useState('');
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [branchNew, setBranchNew] = useState(false);
  // The branch was auto-defaulted to Head office because the agency has none.
  const [branchAuto, setBranchAuto] = useState(false);
  // #74 For a new agency: the answer to "Is this a single-office agency?".
  // null until answered (no default), so submit is blocked until the user picks.
  const [singleOffice, setSingleOffice] = useState<boolean | null>(null);
  const [agEmail, setAgEmail] = useState('');
  const [agName, setAgName] = useState('');
  const [agPhone, setAgPhone] = useState('');
  const [brEmail, setBrEmail] = useState('');
  // Admin fly-creation: the partner the new agency lands under.
  const [adminPartner, setAdminPartner] = useState('');
  // Names created on the fly in this picker. An on-the-fly agency also lands in
  // the client org store, so it shows up as an "existing" search hit; this set
  // keeps it flagged as new (so re-selecting it still requires a contact and
  // creates a contact-bearing record on submit).
  const createdAgencies = useRef<Set<string>>(new Set());

  // The partner the referral resolves to.
  const resolvedPartner = (() => {
    if (selectedAgency && !agencyNew) return selectedAgencyPartner ?? '';
    if (agencyNew) return isAdmin ? adminPartner : (partnerScope === ALL_PARTNERS ? '' : partnerScope);
    return partnerScope === ALL_PARTNERS ? '' : partnerScope;
  })();

  // Emit the composed value whenever anything relevant changes.
  useEffect(() => {
    onChange?.({
      agency: selectedAgency ?? '',
      branch: selectedBranch ?? '',
      agencyNew,
      branchNew,
      agencyContactEmail: agEmail.trim(),
      agencyContactName: agName.trim(),
      agencyContactPhone: agPhone.trim(),
      branchContactEmail: branchAuto ? '' : brEmail.trim(),
      partner: resolvedPartner,
      singleOffice: agencyNew ? singleOffice : null,
      shape,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgency, selectedBranch, agencyNew, branchNew, agEmail, agName, agPhone, brEmail, branchAuto, resolvedPartner, singleOffice, shape]);

  /* Ask the server what to ask, then collapse anything with one answer.

     Guarded by a ref, not by a dependency list: chooseAgency clears the branch,
     so running this a second time would wipe a choice the user had already
     made. It runs once per resolved answer, and never again for that scope.

     ONLY A REAL ANSWER CLOSES THE GUARD, and that is the fix for the reported
     regression. The guard used to be set the moment the promise resolved,
     whatever it resolved to, and loadOrgShape resolved a FAILED call to the
     supplier shape. So one failure, at any point in the page's life, latched the
     supplier form permanently: no retry, nothing to recover it, and the reader
     left looking at an agency search box on our own estate. A failure now leaves
     the shape unresolved and asks again. */
  useEffect(() => {
    let live = true;
    // An admin viewing one partner gets THAT partner's form. Referring on behalf
    // of a single-office agent should not ask an opndoor admin to name the
    // agency either. Ignored by the server for everybody else, so it is a
    // filter and never a way in.
    const scoped = isAdmin && partnerScope !== ALL_PARTNERS ? partnerScope : null;
    if (scopeSeen.current !== null && scopeSeen.current !== String(partnerScope)) {
      collapsedOnce.current = false;
    }
    scopeSeen.current = String(partnerScope);

    /* Bounded, because an unbounded retry against a server that is genuinely
       refusing is a loop nobody asked for, and because the honest end state is a
       form that says it could not work the office out rather than one that keeps
       spinning. Four tries over about seven seconds covers a token refresh,
       which is the failure this is most likely to be. */
    const DELAYS = [400, 1200, 2500, 3000];
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const ask = () => {
      void loadOrgShape(scoped).then((sh) => {
        if (!live || collapsedOnce.current) return;
        if (!sh.resolved) {
          // Leave the shape unresolved: it offers nothing, which is the correct
          // thing to offer when we do not know who is reading.
          if (attempt < DELAYS.length) { timer = setTimeout(ask, DELAYS[attempt++]); }
          else setShape(sh);
          return;
        }
        collapsedOnce.current = true;
        setShape(sh);
        if (!sh.collapseAgency || !sh.onlyAgencyName) return;
        chooseAgency(sh.onlyAgencyName, false);
        // Set the branch AFTER, because chooseAgency may have defaulted a Head
        // office for an agency with no branches and the real one wins.
        if (sh.collapseBranch && sh.onlyBranchName) {
          setBranchValue(sh.onlyBranchName);
          setSelectedBranch(sh.onlyBranchName);
          setBranchNew(false);
          setBranchAuto(false);
        }
      });
    };
    ask();

    return () => { live = false; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerScope]);

  /** Auto-fill the branch when the chosen agency leaves nothing to choose.
      Two cases, and they are not the same fact:
      no branches at all (#65) means a "Head office" is invented for them;
      exactly one branch means we already know the answer and asking is asking
      somebody to confirm what we told them. */
  function autoBranchIfSingleOffice(name: string) {
    const rec = findAgency(name);
    if (!rec) return;
    if (rec.branches.length === 0) {
      setBranchValue(DEFAULT_BRANCH);
      setSelectedBranch(DEFAULT_BRANCH);
      setBranchNew(true);
      setBranchAuto(true);
      setBrEmail('');
      return;
    }
    if (rec.branches.length === 1 && (isAdmin || shape.refersOwnStock)) {
      setBranchValue(rec.branches[0].name);
      setSelectedBranch(rec.branches[0].name);
      setBranchNew(false);
      setBranchAuto(false);
      setBrEmail('');
    }
  }

  function chooseAgency(name: string, isNewArg: boolean, partner?: string) {
    // A picker-created agency stays "new" even when re-selected from the list.
    const isNew = isNewArg || createdAgencies.current.has(name.toLowerCase());
    setSelectedAgency(name);
    setSelectedAgencyPartner(partner ?? findAgency(name)?.partner ?? null);
    setAgentValue(name);
    setAgencyNew(isNew);
    setBranchValue('');
    setSelectedBranch(null);
    setBranchNew(false);
    setBranchAuto(false);
    setBrEmail('');
    // A revealed branch step belonged to the agency it was revealed for.
    setRevealBranch(false);
    setSingleOffice(null); // #74 a fresh choice is unanswered
    if (!isNew) { setAgEmail(''); setAgName(''); setAgPhone(''); }
    else if (isAdmin) setAdminPartner((p) => p || (partnerScope === ALL_PARTNERS ? '' : partnerScope));
    // #65 silent Head office default stays for EXISTING single-office agencies;
    // a NEW agency is asked explicitly (#74) rather than defaulted.
    if (!isNew) autoBranchIfSingleOffice(name);
  }

  /** #74 Answer the single-office question for a new agency. Yes auto-creates a
      self-identifying "[Agency], Head office" branch (inheriting the agency
      contact); No clears the branch so the user names one. */
  function answerSingleOffice(yes: boolean) {
    setSingleOffice(yes);
    if (yes) {
      const name = `${selectedAgency}, Head office`;
      setBranchValue(name);
      setSelectedBranch(name);
      setBranchNew(true);
      setBranchAuto(true);
      setBrEmail('');
    } else {
      setBranchValue('');
      setSelectedBranch(null);
      setBranchNew(false);
      setBranchAuto(false);
      setBrEmail('');
    }
  }

  function resetAgent(v: string) {
    setAgentValue(v);
    setSelectedAgency(null);
    setSelectedAgencyPartner(null);
    setAgencyNew(false);
    setBranchValue('');
    setSelectedBranch(null);
    setBranchNew(false);
    setBranchAuto(false);
    setRevealBranch(false);
    setSingleOffice(null);
    setAgEmail(''); setAgName(''); setAgPhone(''); setBrEmail('');
  }

  function chooseBranch(name: string, isNew: boolean) {
    setBranchValue(name);
    setSelectedBranch(name);
    setBranchNew(isNew);
    setBranchAuto(false);
    if (!isNew) setBrEmail('');
  }

  function onBranchInput(v: string) {
    setBranchValue(v);
    // Editing away from the committed branch de-selects it.
    if (v.trim().toLowerCase() !== (selectedBranch ?? '').toLowerCase()) {
      setSelectedBranch(null);
      setBranchNew(false);
      setBranchAuto(false);
    }
  }

  // ---- agent options ----
  const agentQuery = agentValue.trim();
  const agentMatches = searchAgencies(agentValue, partnerScope);
  const agentExact = agentMatches.some((a) => a.name.toLowerCase() === agentQuery.toLowerCase());
  // For an admin viewing all partners, the same name can exist under two
  // partners; label each option with its partner so the choice is explicit.
  const partnerName = (slug: string) => getPartners().find((p) => p.id === slug)?.name ?? slug;
  const agentOptions: TypeAheadOption[] = agentMatches.map((a) => ({
    id: `${a.partner}:${a.name}`,
    icon: <Icon name="building" />,
    main: highlightMatch(a.name, agentQuery),
    sub: `${a.branches.length} branch${a.branches.length === 1 ? '' : 'es'}${isAdmin ? ` · ${partnerName(a.partner)}` : ''}`,
    onSelect: () => chooseAgency(a.name, false, a.partner),
  }));
  // Only a supplier invents an agency mid-referral. For an agent a new agency
  // is an acquisition, and that belongs to an admin on the Agencies screen, not
  // to whoever happens to be sending a referral.
  if (agentQuery && !agentExact && mayInventAgency(shape)) {
    agentOptions.push({
      id: '__create-agent',
      icon: <Icon name="plus" />,
      main: <>Create new agent &quot;{agentQuery}&quot;</>,
      sub: 'Add an agency not in the list',
      isNew: true,
      onSelect: () => { createAgencyOnTheFly(agentQuery, partnerScope); createdAgencies.current.add(agentQuery.toLowerCase()); chooseAgency(agentQuery, true); },
    });
  }

  function commitAgentEnter() {
    const q = agentValue.trim();
    if (!q) return;
    const matches = searchAgencies('', partnerScope).filter((a) => a.name.toLowerCase() === q.toLowerCase());
    // Ambiguous same-named agencies across partners (admin, all-partners): do
    // not tie-break silently on Enter - require an explicit pick from the list.
    if (matches.length > 1) return;
    if (matches.length === 1) chooseAgency(matches[0].name, false, matches[0].partner);
    // Enter is a shortcut for the list, so it has to obey the same rule: no
    // silent agency creation for a partner that owns its stock.
    else if (mayInventAgency(shape)) { createAgencyOnTheFly(q, partnerScope); createdAgencies.current.add(q.toLowerCase()); chooseAgency(q, true); }
  }

  // ---- branch options ----
  const branchQuery = branchValue.trim();
  const agencyRec = selectedAgency ? findAgency(selectedAgency) : undefined;
  const branchMatches = selectedAgency ? searchBranches(selectedAgency, branchValue) : [];
  const branchExact = branchMatches.some((b) => b.name.toLowerCase() === branchQuery.toLowerCase());
  const branchOptions: TypeAheadOption[] = branchMatches.map((b) => ({
    id: b.name,
    icon: <Icon name="home" />,
    main: highlightMatch(b.name, branchQuery),
    sub: b.area || '',
    onSelect: () => chooseBranch(b.name, false),
  }));
  /* WHO MAY INVENT A BRANCH MID-REFERRAL. The same question as mayAddAgency,
     and the same answer: a SUPPLIER's agency set is open at referral time, so an
     office they have never sent us before must not stop the form. One of OUR
     agencies has a structure we set up — it decides commission, deed delivery
     and scope — so a branch typed into a referral is not a shortcut, it is a
     change to the deal made by the person filing the referral.
     branches_insert refuses it in SQL for the estate (20261004160000), and
     create_referral_target refuses it too (20261005200000, which closed the
     SECURITY DEFINER route the policy could not reach); this is the half that
     stops it being offered and then rejected.

     Through the predicate, not off the field: an UNRESOLVED shape also satisfies
     `!refersOwnStock`, so reading the field inline offered branch creation to
     everybody while the shape was in flight. */
  const mayAddBranch = mayInventBranch(shape);
  if (mayAddBranch && branchQuery && !branchExact && selectedAgency) {
    branchOptions.push({
      id: '__create-branch',
      icon: <Icon name="plus" />,
      main: <>Create new branch &quot;{branchQuery}&quot; in {selectedAgency}</>,
      sub: 'Add a branch to this agent',
      isNew: true,
      onSelect: () => { createBranchOnTheFly(selectedAgency, branchQuery); chooseBranch(branchQuery, true); },
    });
  }

  function commitBranchEnter() {
    if (!selectedAgency) return;
    const q = branchValue.trim();
    if (!q || !agencyRec) return;
    const existing = agencyRec.branches.find((b) => b.name.toLowerCase() === q.toLowerCase());
    if (existing) chooseBranch(existing.name, false);
    // Enter on an unknown name creates one on the supplier rail and does nothing
    // on ours, rather than quietly creating a branch the dropdown refused to.
    else if (mayAddBranch) { createBranchOnTheFly(selectedAgency, q); chooseBranch(q, true); }
  }

  const branchEmpty = selectedAgency
    ? (agencyRec && agencyRec.branches.length === 0
        ? 'This agency has no branches yet. Leave "Head office" or type a branch name.'
        : 'No branches found. Type a name to add one.')
    : 'Select an agent first';

  /* THE CHOSEN AGENT HAS ONE OFFICE. The same ruling one level down: the scope
     collapse above answers "which of your agencies", this answers "which of
     that agency's offices" once the agency is known, which is the only point at
     which the admin form can answer it at all.

     Gated on the branch actually being selected. autoBranchIfSingleOffice sets
     it, but it reads the org store while this reads the server's shape, and if
     those ever disagree the honest failure is to show the field rather than to
     hide a question that nothing has answered and then block submit on it.

     Not offered to a supplier who is not an admin: their agency set is open, so
     "the only office we know of" is a fact about our records rather than about
     their next referral, and today's search box is the right thing there. */
  const collapseChosenBranch = !!selectedAgency && !agencyNew && !revealBranch
    && !!selectedBranch && !branchAuto
    && (agencyRec?.branches.length ?? 0) === 1
    && (isAdmin || shape.refersOwnStock);

  const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };

  /* WE DO NOT KNOW WHO IS READING YET, SO WE OFFER NOTHING.
     Not a search box. The form's whole question depends on which rail the viewer
     is on, and until the server says, drawing the supplier's question is a guess
     that was wrong for every agency user who ever loaded this page while the
     call was in flight or after it had failed. */
  if (!shape.resolved) {
    return (
      <div className="form-grid">
        <div className="field span-2">
          <label>Your office</label>
          <div className="hint" style={{ fontSize: 14 }}>
            Working out which office this referral is against.
          </div>
        </div>
      </div>
    );
  }

  /* ONE AGENCY, ONE OFFICE: NOTHING TO ASK, SO NOTHING TO DRAW.
     This used to render "This referral is against X" with a reveal link under
     it. It was true and it was still furniture: a section, a heading and a
     control-shaped line for a fact the reader cannot change. The fact is worth
     one line, so NewApplication prints it under Tenancy instead, and the picker
     goes quiet. It stays MOUNTED, because it is what resolves that one office
     and reports it through onChange. */
  if (shape.collapseAgency && shape.collapseBranch && shape.onlyAgencyName) return null;

  /* ===================================================================
     AN AGENCY USER PICKS FROM WHAT THEY HAVE, AND THAT IS ALL.

     No search box and no create-on-the-fly, at either level, ever. A search box
     is the wrong control for a closed set of one to a handful of your own
     offices: it implies there is something to find, it accepts free text that
     resolves to nothing, and on the supplier form the same control carries a
     "create new" row, which is an offer SQL refuses (agencies_insert,
     branches_insert, and create_referral_target since 20261005200000). A plain
     select cannot express any of those.

     This is a separate branch rather than more conditions inside the one below
     because the two audiences disagree about the control, not just about its
     contents, and threading "is this a select or a type-ahead" through that
     markup is how the supplier form would eventually acquire an agency user's
     bug or the other way round. The supplier and admin form below is untouched.
     =================================================================== */
  if (ownStockViewer(shape)) {
    /* NOTHING SET UP YET is its own answer and comes first, or an agency with no
       offices would get a select with no options and no explanation, which is
       the exact failure orgNotSetUp was written for. */
    if (orgNotSetUp(shape)) {
      return (
        <div className="form-grid">
          <div className="field span-2">
            <label>Your offices</label>
            <div className="hint" style={{ fontSize: 14, color: 'var(--ink)' }}>
              No offices are set up for your account yet. Ask your manager or opndoor
              to add them, then come back to this form.
            </div>
          </div>
        </div>
      );
    }

    const ownAgencies = searchAgencies('', partnerScope);
    const ownBranches = selectedAgency ? (findAgency(selectedAgency)?.branches ?? []) : [];
    // The shape counts what the org holds, server side; the store is the
    // client's hydrated copy. When they disagree the honest thing is to say so,
    // because the alternative is an empty select the reader cannot act on and
    // cannot see the reason for.
    const branchesMissing = !!selectedAgency && ownBranches.length === 0;

    return (
      <div className="form-grid">
        {shape.collapseAgency ? (
          <div className="field span-2">
            <label>Agency</label>
            <div className="hint" style={{ fontSize: 14, color: 'var(--ink)' }}>
              This referral is against <b>{shape.onlyAgencyName}</b>.
            </div>
          </div>
        ) : (
          <div className="field span-2">
            <label htmlFor="ag-name">Agency <span className="req" aria-hidden="true">*</span></label>
            <select id="ag-name" value={selectedAgency ?? ''}
              onChange={(e) => { if (e.target.value) chooseAgency(e.target.value, false); else resetAgent(''); }}>
              <option value="">Select one of your agencies</option>
              {ownAgencies.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
            <span className="hint">Your own agencies. A new agency is set up by opndoor, not here.</span>
          </div>
        )}

        <div className="field span-2">
          <label htmlFor="br-name">Office <span className="req" aria-hidden="true">*</span></label>
          <select id="br-name" value={selectedBranch ?? ''} disabled={!selectedAgency || branchesMissing}
            onChange={(e) => { if (e.target.value) chooseBranch(e.target.value, false); }}>
            <option value="">{selectedAgency ? 'Select an office' : 'Select an agency first'}</option>
            {ownBranches.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
          </select>
          <span className="hint">
            {branchesMissing
              ? 'We could not list your offices. Reload the page, and tell us if it happens again.'
              : 'Your own offices. A new office is set up by opndoor, not here.'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="form-grid">
      {/* An agent with nothing set up. Says so, rather than showing a search box
          with nothing in it and no way to add anything. It must never fall
          through to the supplier picker: that is how somebody invents a
          misspelled duplicate of their own employer with money attached. */}
      {orgNotSetUp(shape) ? (
        <div className="field span-2">
          <label>Your branches</label>
          <div className="hint" style={{ fontSize: 14, color: 'var(--ink)' }}>
            No branches are set up for your account yet. Ask your manager or opndoor
            to add them, then come back to this form.
          </div>
        </div>
      ) : (<>
      {/* COLLAPSED AGENCY, SEVERAL OFFICES. One agency and it is theirs, so
          there is nothing to choose, but the branch question below is real and
          the line says what it is a branch OF. (One agency AND one office
          returned null above, so collapseBranch cannot reach this.) Shown
          rather than hidden: filing a referral against an agency without saying
          which one is worse than one extra line, and it is text rather than a
          control, so it is not something to read through. */}
      {shape.collapseAgency ? (
        <div className="field span-2">
          <label>Agency</label>
          <div className="hint" style={{ fontSize: 14, color: 'var(--ink)' }}>
            This referral is against <b>{shape.onlyAgencyName}</b>.
          </div>
        </div>
      ) : (
        <div className="field span-2">
          <label htmlFor="ag-name">{shape.refersOwnStock ? 'Agency' : 'Agent'}</label>
          <TypeAhead
            id="ag-name"
            value={agentValue}
            onChange={resetAgent}
            onEnter={commitAgentEnter}
            options={agentOptions}
            placeholder={shape.mayAddAgency ? 'Search agencies or add a new one' : 'Search your agencies'}
            emptyText={shape.mayAddAgency ? 'No agencies found. Type a name to add one' : 'No agencies found'}
          />
          {!shape.mayAddAgency && (
            <span className="hint">Referrals go against one of your own agencies. A new agency is set up by opndoor, not here.</span>
          )}
        </div>
      )}
      {/* #74 New agency: ask explicitly (no default) whether it is single-office. */}
      {agencyNew && (
        <div className="field span-2">
          <label>Is this a single-office agency? <span className="req" aria-hidden="true">*</span></label>
          <div className="radio-row" role="radiogroup" aria-label="Is this a single-office agency?">
            <label className="radio-opt">
              <input type="radio" name="single-office" checked={singleOffice === true} onChange={() => answerSingleOffice(true)} />
              <span>Yes, a single office</span>
            </label>
            <label className="radio-opt">
              <input type="radio" name="single-office" checked={singleOffice === false} onChange={() => answerSingleOffice(false)} />
              <span>No, it has branches</span>
            </label>
          </div>
          <span className="hint">
            {singleOffice === true
              ? <>A branch named <b>{selectedAgency}, Head office</b> will be created automatically, inheriting the agency contact.</>
              : 'A single-office agency gets one Head office branch automatically. Choose No to name a branch.'}
          </span>
        </div>
      )}

      {/* Branch field: a line when the chosen agent has one branch, a search box
          when there is a choice to make. A new agency reaches it only once it is
          confirmed to have branches; a new single-office agency uses the auto
          Head office branch (read-only) and skips it. */}
      {collapseChosenBranch ? (
        <div className="field span-2">
          <label>Branch</label>
          <div className="hint" style={{ fontSize: 14, color: 'var(--ink)' }}>
            This referral is against <b>{selectedBranch}</b>. It is the only branch listed for {selectedAgency}.
          </div>
          {/* Only where a new branch is actually allowed. On our estate there is
              nothing behind this link and SQL would refuse what it led to. */}
          {mayAddBranch && (
            <button type="button" className="linkish" onClick={() => setRevealBranch(true)}
              style={{ background: 'none', border: 0, padding: 0, marginTop: 4, cursor: 'pointer',
                       color: 'var(--heliotrope-deep, #5b3fd9)', font: 'inherit', textDecoration: 'underline' }}>
              Use a different branch
            </button>
          )}
        </div>
      ) : agencyNew && singleOffice === true ? (
        <div className="field span-2">
          <label htmlFor="br-name">Branch</label>
          <input id="br-name" type="text" readOnly value={`${selectedAgency}, Head office`} />
          <span className="hint">Auto-created for this single-office agency. Answer No above to name a branch instead.</span>
        </div>
      ) : (!agencyNew || singleOffice === false) ? (
        <div className="field span-2">
          <label htmlFor="br-name">Branch</label>
          <TypeAhead
            id="br-name"
            value={branchValue}
            onChange={onBranchInput}
            onEnter={commitBranchEnter}
            options={branchOptions}
            placeholder={!selectedAgency ? 'Select an agent first' : mayAddBranch ? 'Search branches or add a new one' : 'Search your offices'}
            disabled={!selectedAgency}
            emptyText={branchEmpty}
          />
          {branchAuto ? (
            <span className="hint">Single-office agent. A <b>Head office</b> branch will be used, inheriting the agency contact. Type a branch name to change it.</span>
          ) : (
            <span className="hint">
              {mayAddBranch
                ? 'Branches are filtered to the selected agent. Add a new branch on the fly if it is not listed.'
                : 'Referrals go against one of your own offices. A new office is set up by opndoor, not here.'}
            </span>
          )}
        </div>
      ) : null}

      </>)}

      {agencyNew && (
        <div className="field span-2" style={{ background: 'var(--white-lilac)', border: '1px solid var(--line)', borderRadius: 'var(--r-md, 10px)', padding: 14 }}>
          <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>New agency contact</div>
          <div className="form-grid">
            {isAdmin && (
              <div className="field span-2" style={fieldStyle}>
                <label htmlFor="ag-partner">Supplier <span className="req" aria-hidden="true">*</span></label>
                <select id="ag-partner" value={adminPartner} onChange={(e) => setAdminPartner(e.target.value)}>
                  <option value="">Select the supplier this agent belongs to</option>
                  {getPartners().map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <span className="hint">The referral and its commission land under this supplier.</span>
              </div>
            )}
            <div className="field span-2" style={fieldStyle}>
              <label htmlFor="ag-email">Contact email <span className="req" aria-hidden="true">*</span></label>
              <input id="ag-email" type="email" placeholder="agent@agency.co.uk" value={agEmail} onChange={(e) => setAgEmail(e.target.value)} />
            </div>
            <div className="field" style={fieldStyle}>
              <label htmlFor="ag-cname">Contact name <span className="hint">(optional)</span></label>
              <input id="ag-cname" type="text" placeholder="e.g. Jordan Blake" value={agName} onChange={(e) => setAgName(e.target.value)} />
            </div>
            <div className="field" style={fieldStyle}>
              <label htmlFor="ag-phone">Contact phone <span className="hint">(optional)</span></label>
              <input id="ag-phone" type="tel" placeholder="020 7946 0000" value={agPhone} onChange={(e) => setAgPhone(e.target.value)} />
            </div>
          </div>
          <span className="hint">Required for a new agency. Becomes its default contact for deed delivery and the bordereau.</span>
        </div>
      )}

      {branchNew && !branchAuto && (
        <div className="field span-2" style={{ background: 'var(--white-lilac)', border: '1px solid var(--line)', borderRadius: 'var(--r-md, 10px)', padding: 14 }}>
          <label htmlFor="br-email">New branch contact email <span className="hint">(optional)</span></label>
          <input id="br-email" type="email" placeholder="branch@agency.co.uk" value={brEmail} onChange={(e) => setBrEmail(e.target.value)} />
          <span className="hint">Optional. If left blank, this branch inherits the agency's default contact.</span>
        </div>
      )}
    </div>
  );
}
