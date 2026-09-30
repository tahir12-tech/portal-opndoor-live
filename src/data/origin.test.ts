/* WHERE DID THIS APPLICATION COME FROM?

   Two columns used to answer that between them and neither answered it alone.
   The Route pill said which rail ("Agency referral") and never whose; the
   Partner column said which partner RECORD, and on the agency rail that record
   is house plumbing, so rows read "Agency referral | Opndoor Agents", naming a
   party that exists only in our own schema.

   These lock the merged answer: the party, named as the reader knows it, with
   the rail beside it; a selector built from the book so nothing on it matches
   nothing; and the two live deep-links that predate it still landing on the
   rows they always did. */
import { describe, expect, it } from 'vitest';
import {
  ALL_PARTNERS, countByStatus, getApplications, scopedSummaries,
  ORIGIN_KIND_LABEL, RAIL_AGENCY, RAIL_SUPPLIER,
  originFromParams, originLabel, originOf, originOptions, originToFilter, originValue,
} from '@/data';

const ADMIN = { role: 'superadmin' as const, scope: ALL_PARTNERS };
const book = () => scopedSummaries(ADMIN);

describe('naming the party', () => {
  it('names the agency on the agency rail, not the plumbing partner that carries it', () => {
    /* THE DEFECT, stated. opndoor-agents is the house partner every agency with
       no partner record of its own comes through, and the Partner column printed
       its name. */
    expect(originOf({ partner: 'opndoor-agents', agency: 'Foxglove Residential' }))
      .toEqual({ kind: 'agency', name: 'Foxglove Residential' });
  });

  it('names the agency for an agency-rail partner of our own too', () => {
    // Northwind IS a real partner record and still not the answer: the reader
    // wants the same thing from both kinds of agency row.
    expect(originOf({ partner: 'northwind', agency: 'Marylebone & Co' }))
      .toEqual({ kind: 'agency', name: 'Marylebone & Co' });
  });

  it('names the supplier on the supplier rail', () => {
    expect(originOf({ partner: 'harbourside', agency: null }))
      .toEqual({ kind: 'supplier', name: 'Harbourside Homes' });
  });

  /* A SUPPLIER'S ROW KEEPS ITS SUPPLIER even where an introducing agency is
     recorded on it. The origin is who brought us the referral, and on that rail
     it is the supplier; the agency is where it landed. */
  it('does not let an agency on a supplier row take the supplier\'s place', () => {
    expect(originOf({ partner: 'harbourside', agency: 'Cityscape Lettings' }))
      .toEqual({ kind: 'supplier', name: 'Harbourside Homes' });
  });

  it('reads the two other house rails by their route', () => {
    expect(originOf({ partner: 'opndoor-direct' })).toEqual({ kind: 'direct', name: 'Direct' });
    expect(originOf({ partner: 'referencing-partner' })).toEqual({ kind: 'provider', name: 'Provider hand-over' });
  });

  /* THE HOUSE SLUGS ARE READ AHEAD OF THE MODE, deliberately. channelOf tells
     opndoor-agents from a supplier by the partner's referencing mode, which is
     right when the partner record is hydrated and wrong when it is not: without
     a record the whole agency rail would come back as Suppliers. */
  it('still reads the agency rail when no partner record is hydrated', () => {
    expect(originOf({ partner: 'opndoor-agents', agency: 'Hartwell Estates' }).kind).toBe('agency');
    expect(originOf({ partner: 'opndoor-agents', agency: null }).name).toBe('Agency referral');
  });

  it('never prints a house partner\'s name', () => {
    for (const slug of ['opndoor-direct', 'opndoor-agents', 'referencing-partner']) {
      expect(originOf({ partner: slug, agency: null }).name).not.toMatch(/Opndoor|Referencing Partner/i);
    }
  });

  it('says which kind of party a name is, since a name alone does not', () => {
    expect(ORIGIN_KIND_LABEL.agency).toBe('Agency');
    expect(ORIGIN_KIND_LABEL.supplier).toBe('Supplier');
    expect(ORIGIN_KIND_LABEL.direct).toBe('Direct signup');
    expect(ORIGIN_KIND_LABEL.provider).toBe('Provider');
  });
});

describe('the selector is built from the book', () => {
  it('offers Everything first, and it means no filter', () => {
    const opts = originOptions(book());
    expect(opts[0]).toEqual({ value: '', label: 'Everything', group: null });
    expect(originToFilter('', ALL_PARTNERS)).toEqual({});
  });

  /* THE REASON IT IS DERIVED FROM ROWS AND NOT FROM THE PARTNER TABLE. The
     directory always holds a Direct house partner and a Provider one; this book
     holds no row from either, and a choice that selects nothing is a thing to
     read past, which is exactly what this page takes whole columns off to
     avoid. */
  it('offers no rail the book has no rows from', () => {
    const values = originOptions(book()).map((o) => o.value);
    expect(values).not.toContain('direct');
    expect(values).not.toContain('provider');
  });

  it('offers every supplier in the book, under Suppliers', () => {
    const suppliers = originOptions(book()).filter((o) => o.group === 'Suppliers');
    expect(suppliers.map((o) => o.label).sort()).toEqual(['Harbourside Homes', 'Meridian Lettings']);
  });

  /* AN AGENCY-RAIL PARTNER IS NOT A SUPPLIER. Northwind has a partner record and
     40-odd rows, and listing it beside Harbourside would offer the reader a
     "supplier" that is our own agency estate. */
  it('does not offer an agency-rail partner as a supplier', () => {
    const labels = originOptions(book()).filter((o) => o.group === 'Suppliers').map((o) => o.label);
    expect(labels).not.toContain('Northwind Property');
  });

  it('offers the agencies under Agencies', () => {
    const agencies = originOptions(book()).filter((o) => o.group === 'Agencies').map((o) => o.label);
    expect(agencies).toContain('Foxglove Residential');
  });

  it('holds every option to at least one row in the book', () => {
    const rows = book();
    for (const opt of originOptions(rows)) {
      if (!opt.value || opt.value.startsWith('group:')) continue;
      expect(rows.some((r) => originValue(r) === opt.value), `${opt.label} matches nothing`).toBe(true);
    }
  });

  /* A SELECTION THE BOOK DOES NOT HOLD IS STILL SHOWN. PartnerHome links here
     with ?partner= for any partner, agency-rail ones included, and a selector
     whose value is missing from its own options displays the wrong choice and
     cannot be put back. */
  it('carries a selection that is not one of its choices', () => {
    const opts = originOptions(book(), 'partner:northwind');
    expect(opts.find((o) => o.value === 'partner:northwind')).toBeTruthy();
    expect(originLabel('partner:northwind', book())).toBe('Northwind Property');
  });
});

describe('a selection filters the list', () => {
  it('selects exactly the rows of that origin, whichever kind it is', () => {
    const rows = book();
    for (const opt of originOptions(rows)) {
      if (!opt.value || opt.value.startsWith('group:')) continue;
      const got = getApplications({ ...ADMIN, status: 'all', ...originToFilter(opt.value, ALL_PARTNERS) });
      for (const r of got) expect(originValue(r)).toBe(opt.value);
    }
  });

  it('a supplier selection reaches the partner filter that already existed', () => {
    expect(originToFilter('partner:harbourside', ALL_PARTNERS)).toEqual({ partner: 'harbourside' });
    const got = getApplications({ ...ADMIN, status: 'all', partner: 'harbourside' });
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((r) => r.partner === 'harbourside')).toBe(true);
  });

  /* AN AGENCY SELECTION GOES THROUGH `agencies`, NOT `agency`, so it ANDs with
     the drill-through filter instead of overwriting it. Arriving from Agencies &
     branches sets ?agency=, whose banner is still on screen with its own Clear;
     one control silently winning over the other is how a reader ends up looking
     at rows they did not ask for. */
  it('an agency selection does not write the drill-through\'s field', () => {
    const f = originToFilter('agency:Foxglove Residential', ALL_PARTNERS);
    expect(f).toEqual({ agencies: ['Foxglove Residential'] });
    expect(f).not.toHaveProperty('agency');
  });

  it('and the two narrow together rather than one replacing the other', () => {
    const both = getApplications({
      ...ADMIN, status: 'all', agency: 'Marylebone & Co', agencies: ['Foxglove Residential'],
    });
    expect(both).toEqual([]);
  });

  it('a direct selection is the channel filter', () => {
    expect(originToFilter('direct', ALL_PARTNERS)).toEqual({ channel: 'Direct' });
    expect(originToFilter('provider', ALL_PARTNERS)).toEqual({ channel: 'Provider hand-over' });
  });

  /* A GROUP WITH NO AGENCIES MATCHES NOTHING, not everything. This is the one
     selection with no single-value equivalent, and the failure mode if the empty
     list fell through as "no filter" would be silent: the whole book under one
     brand's name. */
  it('a group that resolves to nothing selects nothing', () => {
    expect(originToFilter('group:does-not-exist', ALL_PARTNERS)).toEqual({ agencies: [] });
    expect(getApplications({ ...ADMIN, status: 'all', agencies: [] })).toEqual([]);
  });

  it('several agencies at once is several agencies, not the first one', () => {
    const a = getApplications({ ...ADMIN, status: 'all', agencies: ['Foxglove Residential'] });
    const b = getApplications({ ...ADMIN, status: 'all', agencies: ['Marylebone & Co'] });
    const both = getApplications({ ...ADMIN, status: 'all', agencies: ['Foxglove Residential', 'Marylebone & Co'] });
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(both.length).toBe(a.length + b.length);
  });
});

/* =====================================================================
   WALK FIX 7. "Applications, Origin picker: choosing an option does nothing,
   the list doesn't change."

   THE TWO CHOICES IT IS TRUE OF, and they are the two at the top. The picker
   offers Everything, Suppliers and Agencies as quick choices; the second and
   third are `rail:supplier` and `rail:agency`, values `originOptions` never
   produces, because no single row is "every agency". The list narrowed
   through `originToFilter`, whose arms are direct / provider / partner: /
   agency: / group: and whose fallthrough is `return {}` -- no filter at all.
   So picking either rail left the whole book on screen.

   WHY NO TEST CAUGHT IT. The loop above walks `originOptions(rows)`, which is
   exactly the set of values that DO work. A rail is not in the book, so it
   was never in the loop.

   AND THERE WAS ALREADY A PREDICATE THAT KNEW. `originMatches` has both rail
   arms and is what Reporting narrows by. Two expressions of one rule and only
   one of them complete: the failure the header of origin.ts warns about, in
   the file it warns in. So the list asks `originMatches` too, rather than
   gaining a third.
   ===================================================================== */
describe('the two quick choices at the top of the picker', () => {
  const kinds = (rows: { partner?: string | null; agency?: string | null }[]) =>
    [...new Set(rows.map((r) => originOf(r).kind))].sort();

  it('are not in the book, so the loop above can never have covered them', () => {
    const values = originOptions(book()).map((o) => o.value);
    expect(values).not.toContain(RAIL_AGENCY);
    expect(values).not.toContain(RAIL_SUPPLIER);
  });

  /* THE DEFECT, STATED. Not "returns the wrong rows": returns EVERY row,
     which is what "choosing an option does nothing" looks like. */
  it('Suppliers narrows the list to suppliers, rather than leaving the whole book', () => {
    const all = getApplications({ ...ADMIN, status: 'all' });
    const got = getApplications({ ...ADMIN, status: 'all', origin: RAIL_SUPPLIER });
    expect(got.length).toBeGreaterThan(0);
    expect(got.length).toBeLessThan(all.length);
    expect(kinds(got)).toEqual(['supplier']);
  });

  it('Agencies narrows the list to agencies, likewise', () => {
    const all = getApplications({ ...ADMIN, status: 'all' });
    const got = getApplications({ ...ADMIN, status: 'all', origin: RAIL_AGENCY });
    expect(got.length).toBeGreaterThan(0);
    expect(got.length).toBeLessThan(all.length);
    expect(kinds(got)).toEqual(['agency']);
  });

  /* THE TWO RAILS ARE DISJOINT. No row can be counted under both, which is
     the property; the `kinds` assertions above already rule out the rails
     being wired to each other's arm.

     NOT ASSERTED, AND SAID SO RATHER THAN QUIETLY DROPPED: that the two do
     not cover the whole book. In this fixture they do -- 16 agency rows and
     5 supplier, no Direct and no Provider -- so the only way to assert it
     would be to add fixture rows in order to have something to assert, which
     proves the fixture and not the code. */
  it('and the two do not overlap', () => {
    const ag = getApplications({ ...ADMIN, status: 'all', origin: RAIL_AGENCY });
    const su = getApplications({ ...ADMIN, status: 'all', origin: RAIL_SUPPLIER });
    const refs = new Set(ag.map((r) => r.ref));
    expect(su.length).toBeGreaterThan(0);
    expect(su.some((r) => refs.has(r.ref))).toBe(false);
  });

  /* AND A KIND THE BOOK HAS NONE OF SELECTS NOTHING, not everything. This is
     the fallthrough that caused the defect, asserted directly: `direct` has
     always had an arm, so if it starts returning 21 rows something has
     turned the predicate off rather than changed one branch of it. */
  it('and a kind with no rows selects none, rather than the whole book', () => {
    expect(getApplications({ ...ADMIN, status: 'all', origin: 'direct' })).toEqual([]);
  });

  /* THE CHIPS FOLLOW THE ROWS. "Showing X of Y" and every status count read
     countByStatus, which filters separately. A fix that taught only
     getApplications would leave the tabs claiming rows the list is not
     showing: the same complaint, one screen further on. */
  it('and the status counts narrow with them, not only the rows', () => {
    const all = countByStatus({ ...ADMIN });
    const su = countByStatus({ ...ADMIN, origin: RAIL_SUPPLIER });
    expect(su.all).toBeLessThan(all.all);
    expect(su.all).toBe(getApplications({ ...ADMIN, status: 'all', origin: RAIL_SUPPLIER }).length);
  });

  /* EVERY SELECTION GOES THROUGH ONE PREDICATE NOW, so the arms that already
     worked must still work through it. Re-walks the book's own options
     against `origin` rather than against originToFilter. */
  it('and every selection the book offers still selects exactly its own rows', () => {
    for (const opt of originOptions(book())) {
      if (!opt.value || opt.value.startsWith('group:')) continue;
      const got = getApplications({ ...ADMIN, status: 'all', origin: opt.value });
      expect(got.length, `no rows for ${opt.value}`).toBeGreaterThan(0);
      for (const r of got) expect(originValue(r)).toBe(opt.value);
    }
  });

  /* A GROUP STILL MATCHES NOTHING WHEN IT HOLDS NOTHING. The one selection
     whose empty case must not fall through as "no filter": that failure is
     the whole book under one brand's name. */
  it('and an empty group still selects nothing rather than everything', () => {
    expect(getApplications({ ...ADMIN, status: 'all', origin: 'group:does-not-exist' })).toEqual([]);
  });
});

describe('the deep-links that predate the selector', () => {
  it('translates Home\'s Direct tiles', () => {
    expect(originFromParams({ route: 'Direct' })).toBe('direct');
    expect(originFromParams({ route: 'Provider hand-over' })).toBe('provider');
  });

  /* A RAIL IS NOT A PARTY. "Agency referral" names four agencies and
     "Supplier referral" names two, so there is no one origin either could
     select; the link opens the whole book rather than an arbitrary one of them. */
  it('opens unfiltered where the old link named a rail rather than a party', () => {
    expect(originFromParams({ route: 'Agent referral' })).toBe('');
    expect(originFromParams({ route: 'Partner referral' })).toBe('');
  });

  it('translates a supplier page\'s View applications button', () => {
    expect(originFromParams({ partner: 'harbourside' })).toBe('partner:harbourside');
  });

  it('validates the partner, so a stale id opens the book rather than an empty list', () => {
    expect(originFromParams({ partner: 'no-such-partner' })).toBe('');
  });

  it('never lets a house partner become a selection', () => {
    expect(originFromParams({ partner: 'opndoor-agents' })).toBe('');
    expect(originFromParams({ partner: 'opndoor-direct' })).toBe('');
  });

  it('prefers an explicit ?origin= over the two it translates', () => {
    expect(originFromParams({ origin: 'agency:Foxglove Residential', partner: 'harbourside', route: 'Direct' }))
      .toBe('agency:Foxglove Residential');
  });

  it('opens unfiltered when there is nothing to read', () => {
    expect(originFromParams({})).toBe('');
    expect(originFromParams({ route: null, partner: null, origin: null })).toBe('');
  });
});
