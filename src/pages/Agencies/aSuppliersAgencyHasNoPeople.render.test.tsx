/* =====================================================================
   A SUPPLIER'S AGENCY HAS NO PEOPLE, AND ONE REFERRAL IS ONE REFERRAL.

   Matt, 2026-10-03: "Supplier view of one of its agencies (e.g. Frost
   Partnership as Kestrel Management): '1 referrals' should be '1 referral';
   remove the People tab and '0 people' (supplier-estate agencies have no
   logins)."

   "0 people" IS NOT AN EMPTY COUNT, it is a question that does not apply, and
   that is why the tab goes with the figure rather than being left to show an
   empty list. On the supplier rail the SUPPLIER's own staff do the referring:
   `user_must_hold_a_position` returns early there and `create_invited_user`
   refuses a developer off it, because its agencies never get logins at all.
   So the tab opened an empty list with an Invite button that could only fail.

   ASKED OF THE AGENCY'S ESTATE, NOT OF THE READER, which the admin case below
   is here to pin: an Opndoor admin looking at Kestrel's Frost must see the
   same absence a Kestrel manager does, because the fact is about the agency.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE = readFileSync(join(process.cwd(), 'src/pages/Agencies/AgencyHome.tsx'), 'utf8');

describe('the figures row', () => {
  /* THROUGH `plural`, which `theCountsReadAsEnglish` requires of every count
     in the product and which the two figures beside it already used: the
     referral count was the one hand-written "referrals" in the row. */
  it('says "1 referral", not "1 referrals"', () => {
    expect(PAGE).toContain("<b>{referrals.length}</b> {plural(referrals.length, 'referral')}");
    expect(PAGE).not.toMatch(/\{referrals\.length\}<\/b> referrals/);
  });

  it('and drops the people figure where there can be none', () => {
    expect(PAGE).toContain('{hasLogins && (\n                <>\n                  <button className="ah-fig" onClick={() => setTab(\'people\')}>');
  });
});

describe('the People tab', () => {
  it('goes with the figure, rather than opening an empty list', () => {
    expect(PAGE).toContain("&& (id !== 'people' || hasLogins)");
  });

  /* THE PREDICATE IS ABOUT THE AGENCY'S PARTNER, which `partner` holds: the
     agency's own, resolved from the org tree. Keyed on the reader instead,
     an admin would see a People tab on an agency that cannot have any. */
  it('and the rule is about the agency, not about who is reading', () => {
    expect(PAGE).toContain('const hasLogins = !partyIsSupplier(partner);');
    expect(PAGE).not.toMatch(/hasLogins = [^\n]*role ===/);
  });
});
