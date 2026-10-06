/* HOW AN AGENCY'S TENANTS ARE CHECKED: TWO ANSWERS, NOT THREE.
 *
 * Matt, 2026-10-02: "replace it with a clear choice titled 'How are
 * this agency's tenants checked?' with two options: 'Opndoor checks
 * eligibility' (the tenant completes eligibility before paying) and
 * 'Agency has already referenced them' (the tenant goes straight to
 * payment). Remove the separate 'Follow the default' option; new
 * agencies start on 'Opndoor checks eligibility'. Changing it asks for
 * confirmation and applies to new referrals only, and is recorded in
 * Recent changes."
 *
 * REMOVING AN OPTION IS A DATA CHANGE. `agencies.referencing_mode` was
 * nullable and null meant "inherit the partner's", which IS the third
 * option. Two options means the column always holds one, so the
 * backfill, the NOT NULL and the setter's refusal all had to land
 * together: a backfill without the constraint leaves the next inserted
 * row null, and a constraint without the setter turns a sentence into a
 * database error.
 *
 * Matt was asked before it was done and answered: "Yes to defaulting
 * agencies on 'Follow the default' to 'Opndoor checks eligibility'.
 * There are no real agencies yet, only dev test data." The backfill
 * moves an agency that was inheriting from a PRE-REFERENCED partner
 * onto eligibility, which is a real change to what its tenants do; that
 * is the thing he was answering.
 *
 * "APPLIES TO NEW REFERRALS ONLY" NEEDED NOTHING BUILT: an application
 * snapshots its own `referencing_mode` at creation and has since the
 * rail existed. What was missing is the screen SAYING so, which is now
 * in the confirmation.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { changeSentence } from '@/data/changeSentence';

const read = (p: string) => readFileSync(p, 'utf8');
const home = read('src/pages/Agencies/AgencyHome.tsx');
const sql = read('supabase/migrations/20261007470000_how_this_agencys_tenants_are_checked.sql');

describe('the control', () => {
  it('is titled as Matt wrote it', () => {
    expect(home).toContain('How are {possessive(a.name)} tenants checked?');
  });

  it('and offers his two options, each with what it does to the tenant', () => {
    expect(home).toContain("'Opndoor checks eligibility', 'The tenant completes eligibility before paying.'");
    expect(home).toContain("'Agency has already referenced them', 'The tenant goes straight to payment.'");
  });

  /* THE THIRD OPTION IS GONE FROM THE SCREEN as well as from the
     column: a select whose first entry explained somebody else's
     default made the reader work out what this agency does.

     Asked of the CONTROL, not the file: the comment above it records
     what was removed and why, and a whole-file match would make that
     explanation fail the rule it explains. */
  it('and no longer offers "Follow the default"', () => {
    // The option itself, and the select it was the first entry of.
    expect(home).not.toContain('Follow the default ({partnerMode');
    expect(home).not.toContain('aria-label={`Referencing route for ${a.name}`}');
  });

  it('and asks before it changes, saying it is new referrals only', () => {
    expect(home).toContain('Change how ${possessive(name)} tenants are checked?');
    expect(home).toContain('Referrals already sent keep the route they were given');
  });
});

describe('the column always holds an answer', () => {
  it('every existing null became "Opndoor checks eligibility"', () => {
    expect(sql).toContain("set referencing_mode = 'opndoor_referenced'");
    expect(sql).toContain('where referencing_mode is null');
  });

  it('and a new agency starts there', () => {
    expect(sql).toContain("alter column referencing_mode set default 'opndoor_referenced'");
    expect(sql).toContain('alter column referencing_mode set not null');
  });

  /* AND THE SETTER REFUSES THE OPTION THAT NO LONGER EXISTS, with a
     sentence rather than a constraint error arriving from the column. */
  it('and the setter says so rather than letting the constraint say it', () => {
    expect(sql).toContain('There is no "follow the default" any more.');
  });
});

describe('the change is in Recent changes', () => {
  it('in the two answers’ own words', () => {
    expect(changeSentence({ action: 'tenant_check_changed', detail: 'Opndoor checks eligibility -> Agency has already referenced them' }))
      .toBe('Tenant checks changed from “Opndoor checks eligibility” to “Agency has already referenced them”');
  });

  /* WRITTEN IN THE SETTER, so every caller records it, and only when it
     MOVES: a save that changes nothing is not a change. */
  it('and only when it actually moves', () => {
    expect(sql).toContain('referencing_mode::text is distinct from p_mode');
  });
});
