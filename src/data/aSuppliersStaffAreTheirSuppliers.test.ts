/* A SUPPLIER'S OWN STAFF WORE THE AGENCY THEY LAST REFERRED FOR.
 *
 * Matt, 2026-10-03, verbatim: "Reporting and League, referrer lists: a
 * supplier's own staff are labelled with their supplier (e.g. 'Kestrel
 * Lettings'), not with the agency or branch they last referred for."
 *
 * MEASURED ON DEV. Kestrel has two people who have referred: its own director,
 * who referred for Frost Partnership (Frost Mayfair), one of Kestrel's
 * agencies, and an Opndoor admin, who is excluded from these boards anyway. So
 * the board said "Kestrel Director / Frost Partnership, Frost Mayfair": the
 * company whose tenant it was, not the company he works for.
 *
 * THE TWO FACTS WERE BOTH ON THE ROW AND THE WRONG ONE WAS READ. An
 * application carries the PARTNER (the rail it came in on) and the AGENCY (who
 * the tenant belongs to); neither is who the referrer works for. That third
 * fact lives on the referring user: a supplier's staff hold
 * `users.partner_id`, and our own estate's people hold a POSITION in
 * public.user_scopes and no partner at all. So a partner on the referring user
 * IS the statement "this person belongs to that supplier", and it is now
 * carried onto FullApp as `referrerPartner`.
 *
 * AND IT IS NOT `app.partner`, which would have been the easy fix and is
 * wrong in exactly the case that would matter later: an agency inside a
 * supplier's estate with its own logins refers on the supplier's rail, and
 * labelling that person with the supplier would be the same mistake in the
 * other direction.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_PARTNERS } from '@/data/types';
import { getPeriods } from '@/data';
import { hydratePartners } from './partnersService';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { liveLeague, liveVolume } from '@/data/liveAnalytics';
import { whereTheyWork } from './whereTheyWork';
import type { Partner } from './types';

const D = (s: string) => new Date(s);
const allTime = getPeriods().find((p) => p.id === 'alltime')!;

const PARTNERS = [
  { id: 'opndoor-agents', name: 'Agency referral', kind: 'agency', isHouse: true },
  { id: 'kestrel-lettings', name: 'Kestrel Lettings', kind: 'supplier' },
].map((p) => ({ ...p, status: 'active', since: '2026-01-01', weight: 1, users: 0, apps: 0,
  partnerRate: 0.25, agentRate: 0.1, primary: false })) as unknown as Partner[];

function app(o: Partial<FullApp> & Pick<FullApp, 'ref' | 'rent' | 'partner' | 'agency' | 'branch' | 'referrer'>): FullApp {
  return {
    partnerRate: 0.25, agentRate: 0.1, owner: 0, status: 'paid', referrerRole: 'management',
    referrerId: 'u1',
    sentAt: D('2026-02-01'), paidAt: D('2026-02-03'), deedAt: null, tenancyStart: null, expiry: null,
    refunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
    deedState: null, deedSentAt: null, deedViewedAt: null, ...o,
  };
}

/* DEV'S OWN SHAPE: Kestrel's director referring into one of Kestrel's
   agencies, beside one of our own estate's negotiators. */
const APPS: FullApp[] = [
  app({
    ref: 'GR-K1', rent: 2400, partner: 'kestrel-lettings',
    agency: 'Frost Partnership', branch: 'Frost Mayfair',
    referrer: 'Kestrel Director', referrerId: 'u-kestrel',
    referrerPartner: 'kestrel-lettings',
  }),
  app({
    ref: 'GR-R1', rent: 1800, partner: 'opndoor-agents',
    agency: "Regent's Lettings", branch: "Regent's Park",
    referrer: 'Nadia Rahman', referrerId: 'u-nadia', referrerRole: 'referrer',
    // Our own estate: placed by position, so no partner on the user row.
    referrerPartner: null,
  }),
];

hydrateFull(APPS);
hydratePartners(PARTNERS);
afterEach(() => { hydrateFull(APPS); hydratePartners(PARTNERS); });
afterAll(() => { hydrateFull([]); hydratePartners([]); });

const subOf = (rows: { name: string; sub: string }[], name: string) => rows.find((r) => r.name === name)!.sub;

describe('the League Referrers board', () => {
  it("names a supplier's own staff with their supplier", () => {
    const rows = liveLeague('referrer', 'superadmin', ALL_PARTNERS, '', allTime);
    expect(subOf(rows, 'Kestrel Director')).toBe('Kestrel Lettings');
  });

  it('and not with the agency or branch they referred for', () => {
    const rows = liveLeague('referrer', 'superadmin', ALL_PARTNERS, '', allTime);
    expect(subOf(rows, 'Kestrel Director')).not.toMatch(/Frost/);
    expect(subOf(rows, 'Kestrel Director')).not.toMatch(/Mayfair/);
  });

  it("while our own estate's people still read where they work", () => {
    const rows = liveLeague('referrer', 'superadmin', ALL_PARTNERS, '', allTime);
    expect(subOf(rows, 'Nadia Rahman')).toContain("Regent's Lettings");
  });
});

describe("Reporting's Volume by referrer", () => {
  it('says the same thing, because it is the same grouping', () => {
    const rows = liveVolume('superadmin', ALL_PARTNERS, allTime).referrers;
    expect(subOf(rows, 'Kestrel Director')).toBe('Kestrel Lettings');
    expect(subOf(rows, 'Nadia Rahman')).toContain("Regent's Lettings");
  });
});

/* THE RULE ITSELF, on the one function the three lists share. */
describe('whereTheyWork', () => {
  it('prefers the supplier to the agency, for every reader', () => {
    for (const reader of ['opndoor', 'multi-branch', 'one-branch'] as const) {
      expect(whereTheyWork({
        reader, agencies: ['Frost Partnership'], branches: ['Frost Mayfair'],
        suppliers: ['Kestrel Lettings'],
      }), `reader ${reader}`).toBe('Kestrel Lettings');
    }
  });

  /* A SINGLE-OFFICE AGENCY GETS NO LINE AT ALL, which is the rule a
     supplier's name must not be swallowed by: "one-branch" is about OUR
     offices, and a supplier reading as one would have gone back to
     nameless. */
  it('including the one-branch reader, who otherwise gets no line', () => {
    expect(whereTheyWork({ reader: 'one-branch', agencies: ['Frost Partnership'], branches: ['Frost Mayfair'] })).toBe('');
  });

  it('and falls back to where they referred when there is no supplier', () => {
    expect(whereTheyWork({
      reader: 'opndoor', agencies: ["Regent's Lettings"], branches: ["Regent's Park"], suppliers: [],
    })).toContain("Regent's Lettings");
  });
});

/* AND THE FACT REACHES THE CLIENT AT ALL, which is half the change: the
   referrer embed selected full_name, role and sees_commission, so the
   person's own company was never loaded. */
describe('the hydrate query', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/lib/hydrate.ts'), 'utf8');

  it('asks for the referring user’s partner', () => {
    expect(SRC).toContain('referrer:users!referrer_id(full_name, role, sees_commission, partner_id)');
  });

  it('and resolves it to a slug, like every other partner on the row', () => {
    expect(SRC).toContain('referrerPartner: partnerSlug.get(emb(a.referrer)?.partner_id) ?? null');
  });
});
