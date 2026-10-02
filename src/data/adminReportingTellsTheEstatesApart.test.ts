/* TWO FROSTS, A PARTNER THAT IS NOT A ROUTE, AND ONE NAME FOR THE FEE.
 *
 * Matt, 2026-10-02, verbatim:
 *
 *   "1. Wherever an agency or branch from a supplier's estate appears
 *       alongside Opndoor's (branch and agency charts, referrer list,
 *       settlements, payees, statements), label it with its supplier,
 *       e.g. "Frost Partnership (via Kestrel Lettings)", so two
 *       same-named companies can always be told apart.
 *    2. "Commission by route": Harbour Lets is an agency, so it belongs
 *       in "Agency referral", not listed as its own route. Only real
 *       suppliers appear as routes.
 *    3. Use "guarantee fee" on every screen, not "guarantor fee" (e.g.
 *       "Guarantee fee paid", "Guarantee fees collected"), matching the
 *       emails. API field names and CSV column headings stay as they
 *       are."
 *
 * DEV IS THE CASE. There really are two agencies called Frost
 * Partnership -- one under `opndoor-agents`, one under
 * `kestrel-lettings` -- with one paid application each, so admin
 * Reporting draws them as two identical rows. That is the estate rule
 * working (two records that never link) meeting the one screen that puts
 * the estates side by side on purpose.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { hydratePartners } from './partnersService';
import { viaSupplier, isSupplierEstate } from './viaSupplier';
import { routeOf } from './route';
import type { Partner } from './types';

/** Dev's partners, in the shape hydrate produces. */
const PARTNERS = [
  { id: 'opndoor-agents', name: 'Opndoor Agents', status: 'active', referencingMode: 'opndoor_referenced', isHouse: true },
  { id: 'opndoor-direct', name: 'Opndoor Direct', status: 'active', referencingMode: 'opndoor_referenced', isHouse: true },
  { id: 'referencing-partner', name: 'Referencing Partner', status: 'active', referencingMode: 'pre_referenced_open', isHouse: true },
  { id: 'kestrel-lettings', name: 'Kestrel Lettings', status: 'active', referencingMode: 'pre_referenced_open', isHouse: false },
  { id: 'harbour-lets', name: 'Harbour Lets', status: 'active', referencingMode: 'opndoor_referenced', isHouse: false },
] as unknown as Partner[];

beforeEach(() => hydratePartners(PARTNERS));

describe('an agency in a supplier estate', () => {
  it('names its supplier', () => {
    expect(viaSupplier('Frost Partnership', 'kestrel-lettings'))
      .toBe('Frost Partnership (via Kestrel Lettings)');
  });

  /* OUR OWN ESTATE IS THE UNLABELLED ONE, which is worth having as the
     default: on an Opndoor screen a bare name means one of ours. */
  it('and ours does not', () => {
    expect(viaSupplier('Frost Partnership', 'opndoor-agents')).toBe('Frost Partnership');
  });

  it('so the two Frosts on dev read as two different companies', () => {
    expect(viaSupplier('Frost Partnership', 'opndoor-agents'))
      .not.toBe(viaSupplier('Frost Partnership', 'kestrel-lettings'));
  });

  /* HARBOUR LETS IS NOT A SUPPLIER, so there is no supplier to name. It
     is `opndoor_referenced`, which is the predicate the Suppliers list
     was fixed onto the same day. */
  it('and a partner that is really an agency names nobody', () => {
    expect(viaSupplier('Harbour Lets', 'harbour-lets')).toBe('Harbour Lets');
    expect(isSupplierEstate('harbour-lets')).toBe(false);
    expect(isSupplierEstate('kestrel-lettings')).toBe(true);
  });

  /* NOR DO THE HOUSE RAILS, which are plumbing and must never be named
     on a customer's screen at all. */
  it('and neither do the house rails', () => {
    expect(viaSupplier('Unattached', 'opndoor-direct')).toBe('Unattached');
    expect(isSupplierEstate('opndoor-agents')).toBe(false);
  });

  /* A LABEL WITH A BLANK IN IT IS WORSE THAN NO LABEL: "Frost
     Partnership (via )" reads as broken rather than as unlabelled. */
  it('and says nothing rather than something empty', () => {
    expect(viaSupplier('Frost Partnership', '')).toBe('Frost Partnership');
    expect(viaSupplier('', 'kestrel-lettings')).toBe('');
  });
});

describe('a route', () => {
  it('is a supplier when the partner is one', () => {
    expect(routeOf('kestrel-lettings')).toEqual({ key: 'kestrel-lettings', name: 'Kestrel Lettings' });
  });

  it('is the rail for each house partner', () => {
    expect(routeOf('opndoor-agents').name).toBe('Agency referral');
    expect(routeOf('opndoor-direct').name).toBe('Direct');
    expect(routeOf('referencing-partner').name).toBe('Provider hand-over');
  });

  /* THE INSTRUCTION ITSELF. Harbour Lets had a route of its own because
     the grouping asked "does it have a partner row", which is yes for an
     agency's parent too. */
  it('and is "Agency referral" for an agency that happens to hold a partner row', () => {
    expect(routeOf('harbour-lets').name).toBe('Agency referral');
  });

  /* FOLDED IN, NOT DROPPED. Its referrals are real money and the column
     totals have to keep footing to the summary above them, so the key is
     the agency rail's own rather than something new. */
  it('and is folded into the same row as the agency rail, not a second one with the same name', () => {
    expect(routeOf('harbour-lets').key).toBe(routeOf('opndoor-agents').key);
  });
});

/* =====================================================================
   AND ONE NAME FOR THE FEE, EVERYWHERE A PERSON READS IT.

   The sweep is the half that keeps it true. "guarantor fee" is not
   wrong anywhere in particular; it was right in eight places, each
   written when its own screen was.
   ===================================================================== */
const SCREEN_DIRS = ['src/pages', 'src/components'];

function screenFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return screenFiles(full);
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) return [];
    return [full];
  });
}

describe('the fee is called the same thing on every screen', () => {
  it('and no screen says "guarantor fee"', () => {
    const offenders = SCREEN_DIRS.flatMap(screenFiles)
      /* THE GENERATED PARTNER DOCS ARE A PUBLISHED SPEC, not a screen of
         ours: its words describe an API a partner's code is written
         against, and Matt's exception is explicit -- "API field names and
         CSV column headings stay as they are". Its source is
         PARTNER-DOCS.md, so changing it here would be changing a
         generated file by hand anyway. */
      .filter((f) => !f.endsWith('partnerDocs.generated.ts'))
      .filter((f) => /guarantor fee/i.test(readFileSync(f, 'utf8')));
    expect(offenders, `these screens still say "guarantor fee"`).toEqual([]);
  });

  /* THE HELP CONTENT IS A SCREEN TOO, and is the one place a customer
     goes to be told what a word means. */
  it('and neither does the help content', () => {
    expect(readFileSync('src/data/mock/help.ts', 'utf8')).not.toMatch(/guarantor fee/i);
  });

  /* THE EXCEPTION WAS REAL AND IS LIFTED, 2026-10-02. It was "do not
     rename any API field or CSV column a partner's code may read", and
     this assertion existed so a later sweep could not quietly finish
     the job. Matt then said, of the performance export, the application
     export and the league exports: "This file is for Opndoor only, so
     its column headings can change."

     INVERTED RATHER THAN DELETED, so a reader who finds the old
     headings in a screenshot can see which answer is live -- and so the
     three files it does NOT cover stay covered. */
  it('and the Opndoor-only exports have had their headings changed too', () => {
    const src = readFileSync('src/data/exportsService.ts', 'utf8');
    expect(src).not.toContain("moneyCol('Guarantor fee')");
    expect(src).toContain("moneyCol('Guarantee fee')");
  });

  /* AND THE FILES A PARTNER READS STILL HAVE NOT MOVED. Nothing has
     been said about the expiries file or the partner API, so their
     wording is untouched -- the expiries heading Matt DID name is the
     one exception, and he named it. */
  it('but the partner API documentation is untouched', () => {
    expect(readFileSync('src/pages/DevCentre/partnerDocs.generated.ts', 'utf8'))
      .toMatch(/guarantor fee/i);
  });
});
