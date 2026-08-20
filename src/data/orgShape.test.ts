/* The collapse rule, from the consumer's side.

   The rule itself lives in SQL (my_org_shape). These cover the shapes the
   client has to render and the wording that goes with them, and they exist
   because the first version of the rule was wrong in a way that only showed up
   when it was run against real data: it collapsed the agency step for a
   SUPPLIER that happened to have one agency so far. A supplier's agency set is
   open, so that would have filed the next referral against whichever agency
   was first. */
import { describe, expect, it } from 'vitest';
import { FULL_PICKER, orgNotSetUp, orgSectionCopy, type OrgShape } from './orgShapeService';

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

  it('asks a group which brand and which branch', () => {
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

describe('the wording follows the shape', () => {
  it('asks a supplier whose property it is', () => {
    const c = orgSectionCopy(SUPPLIER_ONE_AGENCY);
    expect(c.title).toBe('Agency and branch');
    expect(c.sub).toMatch(/which agency is letting this property/i);
  });

  it('asks an agent which of their own offices it is', () => {
    expect(orgSectionCopy(AGENCY).title).toBe('Your branch');
    expect(orgSectionCopy(AGENCY).sub).toMatch(/your branches/i);
  });

  it('says brand, not agency, to a group that owns its stock', () => {
    expect(orgSectionCopy(GROUP).title).toBe('Brand and branch');
  });

  it('does not ask an independent anything', () => {
    expect(orgSectionCopy(INDEPENDENT).title).toBe('Your office');
    expect(orgSectionCopy(INDEPENDENT).sub).toMatch(/only office/i);
  });

  it('never says agency to somebody who owns their stock', () => {
    for (const s of [INDEPENDENT, AGENCY, GROUP]) {
      const c = orgSectionCopy(s);
      expect(`${c.title} ${c.sub}`.toLowerCase()).not.toMatch(/\bagency\b/);
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
    expect(orgSectionCopy(EMPTY_AGENT).sub).toMatch(/no branches are set up/i);
  });

  it('is never true for a supplier, who starts empty and fills up by referring', () => {
    expect(orgNotSetUp(FULL_PICKER)).toBe(false);
    expect(orgNotSetUp(SUPPLIER_ONE_AGENCY)).toBe(false);
  });

  it('does not offer to add an agency, which is what a fall-through would', () => {
    expect(EMPTY_AGENT.mayAddAgency).toBe(false);
  });
});
