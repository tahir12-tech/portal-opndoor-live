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
import { ALL_PARTNERS, createAgencyOnTheFly, createBranchOnTheFly, findAgency, getPartners, loadOrgShape, mayInventAgency, mayInventBranch, orgNotSetUp, ownStockViewer, searchAgencies, searchBranches, FULL_PICKER, UNRESOLVED, type OrgShape } from '@/data';
import { mayAddWhileReferring, partyIsSupplier } from '@/data/capabilities';
import { SupplierAddOrg } from '@/pages/PartnerManagement/SupplierAddOrg';
import { useSession } from '@/session/SessionContext';
import { Icon } from '@/components/ui/Icon';
import { TypeAhead, highlightMatch, type TypeAheadOption } from '@/components/ui/TypeAhead';
import { plural } from '@/lib/plural';

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

export function AgentBranchPicker({ onChange, scopePartner, showErrors = false }: {
  onChange?: (value: AgentBranchValue) => void;
  /* =====================================================================
     SHOW YOUR OWN ERRORS, BECAUSE THE FORM CANNOT REACH THEM.

     Matt, 2026-10-04: "with required fields missing, pressing Send shows the
     messages ('Tell us whether this is a single-office agency', 'Enter a
     contact email...') only in the sections above, so from the bottom of the
     page nothing seems to happen. On Send, scroll to the first missing field,
     mark every missing field, and show 'N things still need filling in' next
     to the Send button with a link to the first."

     WHY THE MECHANISM MISSED THESE and he is right that it did. The count
     and the jump read `.field.is-invalid`, which `Field` sets. These three
     controls live in here, and the form rendered their errors as bare
     paragraphs UNDER the picker: not fields, not marked, invisible to the
     count, skipped by the jump. So on the one form where the org section is
     step 1 and the button is at the bottom, pressing Send did nothing
     visible -- which is the exact failure the mechanism was built to remove.

     THE FIX IS THE CONTROL, NOT THE PARAGRAPH. The error belongs on the
     thing that has to be fixed, which is in here, so the picker is told when
     to show them and marks its own. The form's paragraphs go with it: two
     statements of one problem is how they come to disagree.
     ===================================================================== */
  showErrors?: boolean;
  /* A SCOPE PASSED IN, RATHER THAN READ FROM THE SESSION.
     Q-06 item H: once an admin has chosen a supplier at the top of the
     form, "Agency and Branch search only that supplier's agencies and
     branches". The picker has always read the ambient partnerScope, which
     is right for every other caller and wrong for this one -- the admin's
     ambient scope is whatever they last looked at on Reporting, not the
     supplier they just chose here. */
  scopePartner?: string | null;
}) {
  const { role, partnerScope: ambientScope } = useSession();
  const partnerScope = scopePartner ?? ambientScope;
  const isAdmin = role === 'superadmin';
  /* What the form should ask. Derived on the server from what this person can
     reach, and from whether the partner owns its stock.

     UNRESOLVED until it arrives, and this used to be FULL_PICKER "because that
     is the shape the portal has always had and the one that loses nothing if the
     call fails". It loses a great deal: FULL_PICKER is the SUPPLIER shape, so
     every agency user saw an agency search box and an add-a-new-one option for
     as long as the call was in flight, and for ever if it failed. An unresolved
     shape offers nothing and claims nothing. See orgShapeService. */
  const [loadedShape, setShape] = useState<OrgShape>(UNRESOLVED);
  /* WALK FIX 28. AN ADMIN'S SHAPE IS NOT A SHAPE THE SERVER CAN REPORT.
     `my_org_shape` answers "what should I be asked about MY org", and an
     Opndoor admin has none: called with no partner it returns no row at all,
     and called WITH the chosen supplier it returns that supplier's own
     shape -- refers_own_stock true, one agency and it is yours, called
     "Kestrel Lettings". Measured on dev, both cases.

     So the section spoke to an admin in a supplier user's words -- "Your
     office", "This referral is against Kestrel Lettings" -- and, whenever
     the call had not landed, in the placeholder's: "Working out which office
     this referral is against", with nothing to choose and nothing to wait
     for. Matt: "That's the supplier user's own wording and behaviour."

     An admin's question is fixed and needs no server round trip to settle:
     which of the chosen supplier's agencies is letting this property, and
     which branch, with the option to add either. That is FULL_PICKER
     exactly, and taking it here means the section is never unresolved for
     an admin and never collapses one of somebody else's agencies away. The
     AGENCIES are still the supplier's own: they come from partnerScope,
     which is the supplier chosen in Referred by. */
  const shape = isAdmin ? FULL_PICKER : loadedShape;
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

  /* =====================================================================
     A SUPPLIER'S OWN PEOPLE ADD A REAL AGENCY, NOT A NAME.

     Matt, 2026-10-03: "On the New application form, 'Add a new agency' and
     'Add a new office' sit under the agency and office pickers. A new agency
     needs its name, address and agency email (where signed deeds go); a new
     office needs its name and address, and its email is optional (it uses the
     agency's otherwise)."

     WHY THIS REPLACES THE TYPE-AHEAD'S "Create new agent" ROW rather than
     sitting beside it. That row takes a NAME and nothing else: the agency
     lands in the client store as a placeholder and is written for real by
     create_referral_target when the referral is sent. It has no address field
     and no office address, because it never asked for one -- and an address is
     now required. Two doors onto the same job, asking for different things and
     writing at different moments, is how the two of them drift; so on the
     supplier rail the row goes and the button takes its place.

     AN ADMIN KEEPS THE ROW. mayAddWhileReferring answers false for an admin
     deliberately: an admin fly-creating under an explicitly chosen supplier is
     a different flow with a partner picker in it, it is the admin product, and
     Matt's instruction is about the supplier's own users.

     IT IS WRITTEN BEFORE SEND, which is the real change. The dialog calls the
     RPC, so by the time the picker selects it the agency is a row with an id,
     pending_review, in Reconciliation, with an org_audit line naming who added
     it. The referral then goes against an existing agency like any other --
     "usable straight away for the referral" with nothing deferred to submit.
     ===================================================================== */
  const addsViaDialog = mayAddWhileReferring(role, partnerScope);

  /* THE FOUR THINGS THIS PICKER CAN BE MISSING, named here so the marks below
     and the form's own validity test cannot drift apart. `showErrors` decides
     whether to SAY them; these decide what is true. */
  const missingPartner = showErrors && agencyNew && isAdmin && !adminPartner;
  const missingSingleOffice = showErrors && agencyNew && singleOffice === null;
  const missingAgencyEmail = showErrors && agencyNew
    && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(agEmail.trim());
  const missingOrg = showErrors && (!selectedAgency || !selectedBranch);
  const [addOrg, setAddOrg] = useState<'agency' | 'branch' | null>(null);

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
    // Nothing to ask for an admin: their shape is FULL_PICKER above, so the
    // call, its four retries and the collapse it drives are all skipped.
    if (isAdmin) return;
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
    /* ONE OFFICE IS NOT A CHOICE. Matt, 2026-10-01: "if the supplier or
       agency only has one office, pick it automatically so the button
       works straight away."

       This was admin-or-own-stock only, so a supplier's user picking one
       of their agencies was left to choose the single branch it has by
       hand -- and until they did, "Add another tenant" stayed disabled
       for a reason that was about the rail. Nothing is being guessed:
       there is exactly one, and they can still change the agency. */
    if (rec.branches.length === 1) {
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
    sub: `${a.branches.length} ${plural(a.branches.length, 'office')}${isAdmin ? ` · ${partnerName(a.partner)}` : ''}`,
    onSelect: () => chooseAgency(a.name, false, a.partner),
  }));
  // Only a supplier invents an agency mid-referral. For an agent a new agency
  // is an acquisition, and that belongs to an admin on the Agencies screen, not
  // to whoever happens to be sending a referral.
  if (agentQuery && !agentExact && mayInventAgency(shape) && !addsViaDialog) {
    agentOptions.push({
      id: '__create-agent',
      icon: <Icon name="plus" />,
      main: <>Create new agency &quot;{agentQuery}&quot;</>,
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
    // ... and nothing on the supplier rail, where Add a new agency is the door
    // and typing a name is not a creation any more.
    else if (mayInventAgency(shape) && !addsViaDialog) { createAgencyOnTheFly(q, partnerScope); createdAgencies.current.add(q.toLowerCase()); chooseAgency(q, true); }
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
  const mayAddBranch = mayInventBranch(shape) && !addsViaDialog;
  /* THE ESCAPE HATCH IS NOT THE CREATE ROW, and keeping them apart matters
     once the create row is gone from the supplier rail. "Use a different
     branch" under a one-office agency only UNCOLLAPSES the step; what it
     reveals is a search box over offices that already exist, which is a
     reader on either rail's right whether or not they may add one. Hanging it
     on mayAddBranch would have taken it away from exactly the readers who
     just gained the Add a new office button. */
  const mayReachOtherOffices = mayInventBranch(shape);
  if (mayAddBranch && branchQuery && !branchExact && selectedAgency) {
    branchOptions.push({
      id: '__create-branch',
      icon: <Icon name="plus" />,
      main: <>Create new office &quot;{branchQuery}&quot; in {selectedAgency}</>,
      sub: 'Add an office to this agency',
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
        ? 'This agency has no offices yet. Leave "Head office" or type an office name.'
        : 'No offices found. Type a name to add one.')
    : 'Select an agency first';

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
        <div className={`field span-2${missingOrg && !selectedAgency ? ' is-invalid' : ''}`}>
          {/* "Agency", NOT "Agent". Matt, 2026-10-04: "use 'Agency' and
              'Office' instead of 'Agent' and 'Branch' on this form, matching
              the supplier and agency forms." Those two forms have said Agency
              and Office since they were written; this one said Agent to an
              admin and Agency to a supplier's own staff, for the same
              control. One word, both readers. */}
          <label htmlFor="ag-name">Agency</label>
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
          {/* UNDER THE PICKER, which is where Matt put it: the list is still the
              first thing to try, and this is what to do when the agency is not
              in it. */}
          {addsViaDialog && (
            <button type="button" className="abp-addorg" onClick={() => setAddOrg('agency')}>
              <Icon name="plus" size={13} /> Add a new agency
            </button>
          )}
          {/* THE PAIR, MARKED ON THE AGENCY FIELD, because that is the first of
              the two and the jump goes to the first missing thing. The form
              printed "Select an agent and a branch" in a paragraph below. */}
          {missingOrg && !selectedAgency && <span className="field-error">Required</span>}
        </div>
      )}
      {/* #74 New agency: ask explicitly (no default) whether it is single-office. */}
      {agencyNew && (
        <div className={`field span-2${missingSingleOffice ? ' is-invalid' : ''}`}>
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
          {/* Matt's own words for this one, which the form used to print in a
              paragraph underneath where nobody standing at the button saw it. */}
          {missingSingleOffice && <span className="field-error">Tell us whether this is a single-office agency.</span>}
        </div>
      )}

      {/* Branch field: a line when the chosen agent has one branch, a search box
          when there is a choice to make. A new agency reaches it only once it is
          confirmed to have branches; a new single-office agency uses the auto
          Head office branch (read-only) and skips it. */}
      {collapseChosenBranch ? (
        <div className="field span-2">
          <label>Office</label>
          <div className="hint" style={{ fontSize: 14, color: 'var(--ink)' }}>
            This referral is against <b>{selectedBranch}</b>. It is the only branch listed for {selectedAgency}.
          </div>
          {/* Only where a new branch is actually allowed. On our estate there is
              nothing behind this link and SQL would refuse what it led to. */}
          {mayReachOtherOffices && (
            <button type="button" className="linkish" onClick={() => setRevealBranch(true)}
              style={{ background: 'none', border: 0, padding: 0, marginTop: 4, cursor: 'pointer',
                       color: 'var(--heliotrope-deep, #5b3fd9)', font: 'inherit', textDecoration: 'underline' }}>
              Use a different office
            </button>
          )}
        </div>
      ) : agencyNew && singleOffice === true ? (
        <div className="field span-2">
          <label htmlFor="br-name">Office</label>
          <input id="br-name" type="text" readOnly value={`${selectedAgency}, Head office`} />
          <span className="hint">Auto-created for this single-office agency. Answer No above to name an office instead.</span>
        </div>
      ) : (!agencyNew || singleOffice === false) ? (
        <div className="field span-2">
          <label htmlFor="br-name">Office</label>
          <TypeAhead
            id="br-name"
            value={branchValue}
            onChange={onBranchInput}
            onEnter={commitBranchEnter}
            options={branchOptions}
            placeholder={!selectedAgency ? 'Select an agency first' : mayAddBranch ? 'Search offices or add a new one' : 'Search your offices'}
            disabled={!selectedAgency}
            emptyText={branchEmpty}
          />
          {branchAuto ? (
            <span className="hint">Single-office agency. A <b>Head office</b> will be used, inheriting the agency contact. Type an office name to change it.</span>
          ) : (
            <span className="hint">
              {mayAddBranch
                ? 'Offices are filtered to the selected agency. Add a new one if it is not listed.'
                : addsViaDialog
                  ? 'Offices are filtered to the agency above. Use Add a new office if it is not listed.'
                  : 'Referrals go against one of your own offices. A new office is set up by opndoor, not here.'}
            </span>
          )}
          {/* ONLY ONCE THERE IS AN AGENCY TO ADD IT TO. An office with no
              agency is not a thing the server can write (admin_add_branch
              takes the agency's id), so the button waits rather than opening a
              dialog that could only fail on save. */}
          {addsViaDialog && selectedAgency && (
            <button type="button" className="abp-addorg" onClick={() => setAddOrg('branch')}>
              <Icon name="plus" size={13} /> Add a new office
            </button>
          )}
        </div>
      ) : null}

      </>)}

      {agencyNew && (
        <div className="field span-2" style={{ background: 'var(--white-lilac)', border: '1px solid var(--line)', borderRadius: 'var(--r-md, 10px)', padding: 14 }}>
          <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>New agency contact</div>
          <div className="form-grid">
            {isAdmin && (
              <div className={`field span-2${missingPartner ? ' is-invalid' : ''}`} style={fieldStyle}>
                <label htmlFor="ag-partner">Supplier <span className="req" aria-hidden="true">*</span></label>
                {/* =====================================================================
                    SUPPLIERS ONLY. Matt, 2026-10-04: "the Supplier dropdown
                    includes 'Harbour Lets', which is an agency; list suppliers
                    only (partner_kind supplier)."

                    `getPartners()` STRIPS THE HOUSE PARTNERS AND NOTHING ELSE,
                    which was the whole of the filtering here: opndoor-agents,
                    opndoor-direct and referencing-partner are excluded because
                    their names are internal route labels. An AGENCY-kind
                    partner is a real company with a real name and sailed
                    through -- so an admin creating an agency could file it
                    under another agency, which is not a party that can own
                    one, and its commission would land nowhere anybody reads.

                    `partyIsSupplier` reads the partner's own `kind`, which is
                    the fact that means it. Not `!partyIsAgency`: that was the
                    reading that put a supplier set to "opndoor referenced" on
                    the wrong side of a gate once already. */}
                <select id="ag-partner" value={adminPartner} onChange={(e) => setAdminPartner(e.target.value)}>
                  <option value="">Select the supplier this agency belongs to</option>
                  {getPartners().filter((p) => partyIsSupplier(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <span className="hint">The referral and its commission land under this supplier.</span>
                {missingPartner && <span className="field-error">Select the supplier this agency belongs to.</span>}
              </div>
            )}
            <div className={`field span-2${missingAgencyEmail ? ' is-invalid' : ''}`} style={fieldStyle}>
              <label htmlFor="ag-email">Agency email <span className="req" aria-hidden="true">*</span></label>
              <input id="ag-email" type="email" placeholder="jane@example.co.uk" value={agEmail} onChange={(e) => setAgEmail(e.target.value)} />
              {/* MATT'S OWN SENTENCE, 2026-10-04, replacing "Required for a new
                  agency. Becomes its default contact for deed delivery and the
                  bordereau." His says the same thing in the reader's terms and
                  names the one exception that matters. */}
              <span className="hint">Required for a new agency. Signed deeds go here unless the office has its own email.</span>
              {missingAgencyEmail && <span className="field-error">{agEmail.trim() ? 'That is not an email address.' : 'Required'}</span>}
            </div>
            <div className="field" style={fieldStyle}>
              <label htmlFor="ag-cname">Contact name <span className="hint">(optional)</span></label>
              <input id="ag-cname" type="text" placeholder="e.g. Jane Smith" value={agName} onChange={(e) => setAgName(e.target.value)} />
            </div>
            <div className="field" style={fieldStyle}>
              <label htmlFor="ag-phone">Contact phone <span className="hint">(optional)</span></label>
              <input id="ag-phone" type="tel" placeholder="020 7946 0000" value={agPhone} onChange={(e) => setAgPhone(e.target.value)} />
            </div>
          </div>
          {/* THE SECOND COPY OF THIS SENTENCE IS GONE, not reworded. It sat
              below the grid saying "Becomes its default contact for deed
              delivery and the bordereau" while the Agency email field above
              it already said the same thing in Matt's words, so the form
              stated one rule twice and the two had already drifted: I
              replaced one of them on 2026-10-04 and left this one saying the
              old thing. One statement, next to the control it is about. */}
        </div>
      )}

      {branchNew && !branchAuto && (
        <div className="field span-2" style={{ background: 'var(--white-lilac)', border: '1px solid var(--line)', borderRadius: 'var(--r-md, 10px)', padding: 14 }}>
          <label htmlFor="br-email">New office contact email <span className="hint">(optional)</span></label>
          <input id="br-email" type="email" placeholder="lettings@example.co.uk" value={brEmail} onChange={(e) => setBrEmail(e.target.value)} />
          <span className="hint">Optional. If left blank, this office inherits the agency's default contact.</span>
        </div>
      )}

      {/* THE SAME DIALOG THE AGENCIES PAGE OPENS, with one prop different.
          `onUseExisting` turns its duplicate offer from a link into a
          selection, because a reader halfway through a referral must not be
          navigated away from it. See the prop's own note.

          SELECTED AS AN EXISTING AGENCY, not a new one: by the time this
          returns, the row is written, so `chooseAgency(name, false)` is the
          truth. Passing true would re-ask for the contact the dialog just
          took and hand it to create_referral_target to create a second time. */}
      {addOrg && (
        <SupplierAddOrg
          mode={addOrg}
          partnerSlug={partnerScope === ALL_PARTNERS ? '' : String(partnerScope)}
          partnerName={partnerName(String(partnerScope))}
          agency={addOrg === 'branch' && selectedAgency ? (findAgency(selectedAgency) ?? null) : null}
          onClose={() => setAddOrg(null)}
          onUseExisting={(name) => {
            if (addOrg === 'agency') chooseAgency(name, false);
            else chooseBranch(name, false);
            setAddOrg(null);
          }}
          onDone={(name) => {
            // The dialog has already re-hydrated, so the new row is in the
            // store under the name that was typed.
            if (addOrg === 'agency') chooseAgency(name, false);
            else chooseBranch(name, false);
            setAddOrg(null);
          }}
        />
      )}
    </div>
  );
}
