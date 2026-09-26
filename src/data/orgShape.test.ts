/* The collapse rule, from the consumer's side.

   The rule itself lives in SQL (my_org_shape). These cover the shapes the
   client has to render and the wording that goes with them, and they exist
   because the first version of the rule was wrong in a way that only showed up
   when it was run against real data: it collapsed the agency step for a
   SUPPLIER that happened to have one agency so far. A supplier's agency set is
   open, so that would have filed the next referral against whichever agency
   was first. */
import { describe, expect, it } from 'vitest';
import {
  FULL_PICKER, UNRESOLVED, mayInventAgency, mayInventBranch, orgNotSetUp, orgSectionCopy,
  ownStockViewer, type OrgShape,
} from './orgShapeService';

function shape(p: Partial<OrgShape>): OrgShape {
  return { ...FULL_PICKER, ...p };
}

const INDEPENDENT = shape({
  refersOwnStock: true, agencyCount: 1, branchCount: 1,
  collapseAgency: true, collapseBranch: true, mayAddAgency: false,
  onlyAgencyName: 'Harbour Lets', onlyBranchName: 'Harbour Lets',
});
const AGENCY = shape({
  refersOwnStock: true, agencyCount: 1, branchCount: 6,
  collapseAgency: true, collapseBranch: false, mayAddAgency: false,
  onlyAgencyName: 'Harbour Lets',
});
const GROUP = shape({
  refersOwnStock: true, agencyCount: 2, branchCount: 3,
  collapseAgency: false, collapseBranch: false, mayAddAgency: false,
});
const SUPPLIER_ONE_AGENCY = shape({
  refersOwnStock: false, agencyCount: 1, branchCount: 1,
  collapseAgency: false, collapseBranch: false, mayAddAgency: true,
});

describe('what each shape asks for', () => {
  it('asks an independent nothing', () => {
    expect(INDEPENDENT.collapseAgency).toBe(true);
    expect(INDEPENDENT.collapseBranch).toBe(true);
  });

  it('asks an agency only which branch', () => {
    expect(AGENCY.collapseAgency).toBe(true);
    expect(AGENCY.collapseBranch).toBe(false);
  });

  it('asks a group which agency and which office', () => {
    expect(GROUP.collapseAgency).toBe(false);
    expect(GROUP.collapseBranch).toBe(false);
  });

  /* The defect. Counting alone said "one agency, do not ask". */
  it('never collapses a supplier, however few agencies it has so far', () => {
    expect(SUPPLIER_ONE_AGENCY.agencyCount).toBe(1);
    expect(SUPPLIER_ONE_AGENCY.collapseAgency).toBe(false);
  });

  it('lets only a supplier add an agency mid-referral', () => {
    expect(SUPPLIER_ONE_AGENCY.mayAddAgency).toBe(true);
    for (const s of [INDEPENDENT, AGENCY, GROUP]) expect(s.mayAddAgency).toBe(false);
  });
});

describe('the fallback', () => {
  /* A failed lookup must never collapse a step. Collapsing files the referral
     against whatever happened to be first; asking costs one field. */
  it('is the supplier shape, which is what the portal has always done', () => {
    expect(FULL_PICKER.collapseAgency).toBe(false);
    expect(FULL_PICKER.collapseBranch).toBe(false);
    expect(FULL_PICKER.mayAddAgency).toBe(true);
    expect(FULL_PICKER.refersOwnStock).toBe(false);
  });
});

/* =====================================================================
   "WE COULD NOT TELL" IS NOT "YOU ARE A SUPPLIER".

   The regression these exist for: loadOrgShape answered a FAILED call with
   FULL_PICKER, and FULL_PICKER is a positive claim, not an absence. It says the
   viewer is a supplier, whose form carries an agency search box and an
   add-a-new-agency option. So one failed RPC handed an agency user on our own
   estate a form offering an acquisition, which SQL then refuses three ways
   (agencies_insert, branches_insert, create_referral_target).

   The fix is a shape that claims nothing, and predicates that require a positive
   answer rather than reading a field that an empty shape happens to satisfy.
   ===================================================================== */
describe('an unresolved shape', () => {
  it('offers nothing', () => {
    expect(UNRESOLVED.resolved).toBe(false);
    expect(UNRESOLVED.mayAddAgency).toBe(false);
    expect(UNRESOLVED.collapseAgency).toBe(false);
    expect(UNRESOLVED.collapseBranch).toBe(false);
  });

  /* THE TRAP, written out. `!shape.refersOwnStock` is true of an unresolved
     shape, so every surface that read that field inline was treating "unknown"
     as "supplier". Both predicates must refuse it. */
  it('is not mistaken for a supplier by either predicate', () => {
    expect(UNRESOLVED.refersOwnStock).toBe(false); // the trap
    expect(mayInventAgency(UNRESOLVED)).toBe(false);
    expect(mayInventBranch(UNRESOLVED)).toBe(false);
  });

  it('is not mistaken for one of ours either', () => {
    expect(ownStockViewer(UNRESOLVED)).toBe(false);
  });

  it('does not ask the supplier question while it waits', () => {
    // It used to print "Which agency is letting this property... You can add
    // either on the fly" at an agency user, which is a promise we cannot keep.
    const c = orgSectionCopy(UNRESOLVED);
    expect(`${c.title} ${c.sub}`).not.toMatch(/on the fly/i);
    expect(c.sub).toMatch(/working out which office/i);
  });

  it('is never treated as an agent with nothing set up', () => {
    // orgNotSetUp drives a dead end ("ask your manager"), and an unresolved
    // shape has a branchCount of 0 for a completely different reason.
    expect(orgNotSetUp(UNRESOLVED)).toBe(false);
  });
});

describe('who may invent an org mid-referral', () => {
  it('a supplier, at both levels, because their agency set is open', () => {
    expect(mayInventAgency(SUPPLIER_ONE_AGENCY)).toBe(true);
    expect(mayInventBranch(SUPPLIER_ONE_AGENCY)).toBe(true);
    expect(mayInventAgency(FULL_PICKER)).toBe(true);
  });

  it('never one of ours, at either level, however many offices they have', () => {
    for (const s of [INDEPENDENT, AGENCY, GROUP]) {
      expect(mayInventAgency(s)).toBe(false);
      expect(mayInventBranch(s)).toBe(false);
      expect(ownStockViewer(s)).toBe(true);
    }
  });
});

describe('the wording follows the shape', () => {
  it('asks a supplier whose property it is', () => {
    const c = orgSectionCopy(SUPPLIER_ONE_AGENCY);
    expect(c.title).toBe('Agency and branch');
    expect(c.sub).toMatch(/which agency is letting this property/i);
  });

  it('asks an agent which of their own offices it is', () => {
    expect(orgSectionCopy(AGENCY).title).toBe('Your office');
    expect(orgSectionCopy(AGENCY).sub).toMatch(/your offices/i);
  });

  /* THE VOCABULARY RULING, and it reverses an earlier one.
     This used to assert "Brand and branch", and beneath it a rule that this copy
     must never say "agency" to somebody who owns their stock. "Brand" is banned:
     it is our word for a thing an agency calls itself, and no agency reading the
     form has ever called it that. The old no-agency rule existed only to stop us
     calling an agency's own brands "agencies", so with brand gone there is
     nothing left for it to protect. */
  it('says agency and office to a group that owns its stock', () => {
    expect(orgSectionCopy(GROUP).title).toBe('Agency and office');
    expect(orgSectionCopy(GROUP).sub).toMatch(/which of your agencies/i);
  });

  it('does not ask an independent anything', () => {
    expect(orgSectionCopy(INDEPENDENT).title).toBe('Your office');
    expect(orgSectionCopy(INDEPENDENT).sub).toMatch(/only office/i);
  });

  it('never says brand to anybody, which is the banned word', () => {
    for (const s of [INDEPENDENT, AGENCY, GROUP, SUPPLIER_ONE_AGENCY, FULL_PICKER, UNRESOLVED]) {
      const c = orgSectionCopy(s);
      expect(`${c.title} ${c.sub}`.toLowerCase()).not.toMatch(/brand/);
    }
  });

  /* An agency user is told about OFFICES, not branches: branch is the schema's
     word and the supplier rail's word, and the two audiences do not share a
     vocabulary. The supplier copy above is deliberately left saying branch. */
  it('says office, not branch, to somebody who owns their stock', () => {
    for (const s of [INDEPENDENT, AGENCY, GROUP]) {
      const c = orgSectionCopy(s);
      expect(`${c.title} ${c.sub}`.toLowerCase()).not.toMatch(/branch/);
    }
  });
});

describe('an agent with nothing set up yet', () => {
  const EMPTY_AGENT = shape({
    refersOwnStock: true, agencyCount: 0, branchCount: 0,
    collapseAgency: false, collapseBranch: false, mayAddAgency: false,
  });

  /* The hole the design pass caught. An agent cannot create an agency here by
     design, so without this state they get a search box with nothing in it, no
     way to add anything and no explanation. */
  it('is its own state, not a quiet fall-through', () => {
    expect(orgNotSetUp(EMPTY_AGENT)).toBe(true);
    expect(orgSectionCopy(EMPTY_AGENT).sub).toMatch(/no offices are set up/i);
  });

  it('is never true for a supplier, who starts empty and fills up by referring', () => {
    expect(orgNotSetUp(FULL_PICKER)).toBe(false);
    expect(orgNotSetUp(SUPPLIER_ONE_AGENCY)).toBe(false);
  });

  it('does not offer to add an agency, which is what a fall-through would', () => {
    expect(EMPTY_AGENT.mayAddAgency).toBe(false);
  });
});
