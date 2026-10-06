/* =====================================================================
   THE GUIDES, SWEPT FOR THE WORDS MATT NAMED.

   Matt, 2026-10-03: "Rewrite the Help guides (referrer guide and any others)
   to match the portal as it is today, in plain English, no em dashes anywhere
   ... Remove 'canonical', 'shipped' and other internal words. Show each guide
   to the right level only, and add a check that fails if help text contains an
   em dash."

   THE CHECK IS THE DELIVERABLE, not just the edit, and he says so. A guide is
   a flat HTML file that nothing compiles and nobody typechecks: the only thing
   standing between it and the old wording is somebody remembering. There was
   no scan at all for em dashes in these files, and
   `noEmDashesInCustomerText` reads `src/`, so public/help-docs was outside it.

   WHAT EACH BAN IS FOR, because they are not one rule:

     em dash         house style, everywhere, product copy and guides alike.
     "partner"       the schema's word for two different kinds of company. A
                     reader is at an AGENCY or at a SUPPLIER, and "your
                     partner" means Opndoor to them, which is backwards.
     "canonical"     the schema again. The act is confirming a record.
     "shipped"       ours, about a release. A reader is using the portal, not
                     taking delivery of it.
     "on the fly"    jargon, and since 20261007840000 it is also imprecise:
                     a supplier's person adds a real agency, pending review.
     "guarantor fee" the fee is the GUARANTEE fee. "Guarantor" is the service.
     a rate          noRatesInTheGuides.test.ts, which is its own file because
                     it is a disclosure rule rather than a wording one.

   THE ADMIN GUIDE IS EXEMPT FROM THE SCREEN-NAME RULES AND NOTHING ELSE. It
   is for Opndoor's own staff, so Reconciliation, Health and the CRM sync are
   its subject rather than a leak. It is not exempt from the em dash.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'public/help-docs');
const GUIDES = readdirSync(DIR).filter((f) => f.endsWith('.html'));
/** Everything a reader is shown: the prose and the <title>, never the CSS. */
const prose = (f: string) =>
  readFileSync(join(DIR, f), 'utf8').replace(/<style[\s\S]*?<\/style>/gi, '');

/** The guides a customer reads. The opndoor admin guide is not one. */
const CUSTOMER = GUIDES.filter((f) => !f.startsWith('opndoor-admin'));

describe('the scan itself', () => {
  it('found the guides, so a broken scan cannot pass silently', () => {
    expect(GUIDES).toContain('referrer-guide.html');
    expect(GUIDES).toContain('management-guide.html');
    expect(CUSTOMER.length).toBeGreaterThan(1);
  });
});

describe('no em dash anywhere in a guide', () => {
  /* EVERY GUIDE, INCLUDING OPNDOOR'S OWN: "no em dashes anywhere" has no
     audience in it. All three had them, the titles included, which is the
     half a body-text scan would have missed. */
  it.each(GUIDES)('%s', (f) => {
    const hits = [...prose(f).matchAll(/.{0,40}[—–].{0,40}/g)].map((m) => m[0]);
    expect(hits).toEqual([]);
  });
});

describe('the words that belong to the schema, not to a reader', () => {
  it.each(GUIDES)('%s says neither canonical nor shipped', (f) => {
    const t = prose(f);
    expect(t).not.toMatch(/canonical/i);
    expect(t).not.toMatch(/\bshipped\b/i);
  });

  /* "partner" IS THE SHARPEST OF THEM. On the agency rail it is the HOUSE
     partner, `opndoor-agents`, which every agency shares: "your partner"
     there names Opndoor and reads to a Director as their own agency. */
  it.each(CUSTOMER)('%s never calls the reader’s company a partner', (f) => {
    expect(prose(f)).not.toMatch(/\bpartner\b/i);
  });

  it.each(CUSTOMER)('%s says guarantee fee, never guarantor fee', (f) => {
    expect(prose(f)).not.toMatch(/guarantor fee/i);
  });

  /* "on the fly" WAS TRUE AND IS NOW IMPRECISE. A supplier's person adding an
     agency while referring creates a real row that waits for review; an
     agency user cannot add one at all. Both are worth a sentence, and neither
     is "on the fly". */
  it.each(CUSTOMER)('%s does not say on the fly', (f) => {
    expect(prose(f)).not.toMatch(/on the fly/i);
  });
});

describe('the referrer guide says what the portal does today', () => {
  const t = prose('referrer-guide.html');

  /* THE TITLE. Matt: "Title 'Refer and track' for people who don't see
     commission; mention commission only for Directors and Management." The
     guide is listed for all roles, so it is the no-commission title, and
     "earn" was the one word that implied otherwise. */
  it('is called Refer and track, and does not promise earnings', () => {
    expect(t).toContain('<h1>Refer and track</h1>');
    expect(t).not.toMatch(/\bearn\b/i);
    expect(t).not.toMatch(/commission/i);
  });

  /* THE FEE IS NOT ALWAYS ONE MONTH. Regent is three weeks for a single
     tenant and five split between joint ones, so a flat claim is wrong for
     every agency that negotiated. */
  it('says the fee is agreed with the agency and usually one month', () => {
    expect(t).toMatch(/the guarantee fee agreed with your agency, usually one month's rent/);
  });

  /* WHERE THE OFFICES COME FROM, which is the half the old guide got
     backwards for an agency user: it offered them a control SQL refuses. */
  it('says offices are set up by opndoor on our own estate', () => {
    expect(t).toMatch(/the offices <b>opndoor has set up for you<\/b>/);
    expect(t).toMatch(/A new office is added by opndoor rather than on this form/);
  });

  /* AND THAT A SUPPLIER'S PEOPLE CAN ADD ONE, which 20261007840000 made true
     the same day. A guide that denied it would be wrong about the product in
     the other direction. */
  it('and that a supplier’s people can add one while referring', () => {
    expect(t).toMatch(/add a new agency or office while you refer/);
    expect(t).toMatch(/name, address and the email signed deeds should go to/);
  });

  it('has Awaiting signature in the status table', () => {
    expect(t).toMatch(/<b>Awaiting signature<\/b>/);
    expect(t).toMatch(/The deed is with the tenant to sign/);
  });

  it('and ranks you at your agency, not at a partner', () => {
    expect(t).toMatch(/among referrers at your agency/);
  });
});

describe('the management guide', () => {
  const t = prose('management-guide.html');

  /* THE PAYMENT DATE, which was wrong on the screen as well and is the same
     rule: each month is paid on the 15th of the month AFTER it. */
  it('says a month is paid on the 15th of the month after it', () => {
    expect(t).toMatch(/15th of the month after that/);
    expect(t).toMatch(/September's is paid on 15 October/);
  });

  it('points at the agreement for the rate, not at a figure', () => {
    expect(t).toMatch(/Your commission is set out in your agreement and shown on your Commission tab and monthly statement/);
  });

  /* THE LEVEL WORDS THE PRODUCT USES, including the Manager, who is the level
     this guide is most often read by and whose line was missing. */
  it('names who sees commission and who does not', () => {
    expect(t).toMatch(/A Manager sees everything else, but not what the agency earns/);
    expect(t).toMatch(/A referrer's own performance export has every commission line and column left out/);
  });

  /* THE SCREENS BY THEIR NAMES ON SCREEN. "User management" and "Agencies &
     branches" are both gone from the product, and "Manage partner" is
     Opndoor's own screen, which Matt named. */
  it('calls the screens what the sidebar calls them', () => {
    expect(t).toMatch(/On <b>Team<\/b> you can invite a colleague/);
    expect(t).toMatch(/On the <b>Agencies<\/b> screen/);
    expect(t).not.toMatch(/User management/i);
    expect(t).not.toMatch(/Manage partner/i);
  });

  /* AND THE ROW ACTIONS BY THEIR LABELS, because a guide naming a button that
     does not exist is worse than one that says nothing. */
  it('and the row actions what the row calls them', () => {
    for (const label of ['Send password reset', 'Reset two-factor', 'Change level', 'Remove access']) {
      expect(t, label).toContain(label);
    }
    expect(t).not.toMatch(/Reset 2FA/i);
    expect(t).not.toMatch(/Deactivate \/ reactivate/i);
  });

  // No query strings in a document a customer reads.
  it('shows no query strings', () => {
    expect(t).not.toMatch(/\?agency=|\?branch=|\?referrer=|\?status=/);
  });
});

/* =====================================================================
   THE TWO LEAFLETS, WHICH WERE PDFs UNTIL 2026-10-03.

   Matt: "Open the tenant and landlord leaflets the same way as the referrer
   guide (as a page with 'Save as PDF'), not in a PDF viewer."

   AUTHORING THEM FROM THE PDFs IS TRANSCRIPTION, NOT A REWRITE, because the
   cover amounts, the claim steps and the refund wording are being checked
   against the DEED and Matt has held all three: "Don't change the cover
   amounts, claim steps or refund wording; I'm checking those against the deed
   and will send exact wording."

   SO THIS BLOCK IS TWO KINDS OF ASSERTION AT ONCE and that is deliberate. The
   four changes he asked for are pinned so they cannot be lost. The sentences
   he HELD are pinned so they cannot be edited by somebody tidying the page
   afterwards, which is the likelier accident: the held wording looks like
   ordinary marketing copy and reads as fair game.
   ===================================================================== */
describe('the tenant leaflet', () => {
  const t = prose('opndoor-for-tenants.html');

  it('is a page with Save as PDF, like the guides', () => {
    expect(t).toContain('onclick="window.print()"');
    expect(t).toContain('Save as PDF');
  });

  /* THE FEE WAS STATED FLATLY AS ONE MONTH. Matt: 'fee as "a one-off fee,
     usually one month's rent (split between you if you're renting jointly)",
     not always one month'. The joint half matters as much as the "usually":
     a tenant renting with two others pays a third. */
  it('says usually one month, and splits it on a joint tenancy', () => {
    expect(t).toContain("A one-off fee, usually one month's rent");
    expect(t).toMatch(/Split between you if you're renting jointly/);
    expect(t).not.toMatch(/A one-off fee of one month's rent/);
  });

  it('calls it the guarantee fee, not the guarantor fee', () => {
    expect(t).toContain('one-off guarantee fee for opndoor acting as guarantor');
    expect(t).not.toMatch(/guarantor fee/i);
  });

  /* HELD BY MATT: "Refunds: keep 'Full refund if the tenancy doesn't go
     ahead' as it is; there are no extra conditions." No "subject to", no
     window, no qualifier. */
  it('keeps the refund promise with no conditions added', () => {
    expect(t).toContain('Full refund if it falls through');
    expect(t).toContain("If the tenancy doesn't go ahead, you get a full refund of the fee.");
    expect(t).not.toMatch(/subject to|provided that|within \d+ days of/i);
  });

  /* AND THE SENTENCE THAT KEEPS THIS LEAFLET HONEST, which is the one a
     redesign would be most tempted to soften. */
  it('still says the guarantee protects the landlord, not the tenant', () => {
    expect(t).toContain('The guarantee protects the landlord, not you. You still pay your rent as normal.');
  });
});

describe('the landlord leaflet', () => {
  const t = prose('opndoor-for-landlords.html');

  it('is a page with Save as PDF', () => {
    expect(t).toContain('onclick="window.print()"');
  });

  /* "the 'It costs you nothing' icon is a dollar sign; use £." */
  it('uses a pound sign on "It costs you nothing", not a dollar', () => {
    const card = t.slice(t.indexOf('It costs you nothing') - 240, t.indexOf('It costs you nothing'));
    expect(card).toContain('&pound;');
    expect(t).not.toContain('$');
  });

  /* 'Header "Guarantee service", as on the tenant leaflet, not "Guarantee
     referral portal".' A landlord is not a portal user; they never sign in. */
  it('is headed Guarantee Service, not Guarantee Referral Portal', () => {
    expect(t).toMatch(/Guarantee<br>Service/);
    expect(t).not.toMatch(/referral portal/i);
  });

  /* MATT'S EXACT REPLACEMENT SENTENCE, second version: he revised his own
     first one to carry the cap and the legal costs. */
  it('says how a joint tenancy splits the cover, in his own words', () => {
    expect(t).toContain('On a joint tenancy, each tenant has their own deed covering their share of the rent. The &pound;120,000 cap and &pound;10,000 legal costs apply to the whole tenancy, split between the deeds in the same shares.');
  });

  /* "Remove the 'Optional extra layer... eligible for rent guarantee cover'
     section from the landlord leaflet in the portal." */
  it('no longer offers rent guarantee cover as an extra layer', () => {
    expect(t).not.toMatch(/optional extra layer/i);
    expect(t).not.toMatch(/rent guarantee cover/i);
  });

  /* HELD: "The claim steps on the landlord leaflet are correct; leave them."
     All three, word for word, because they describe when a landlord is paid. */
  it('keeps all three claim steps exactly', () => {
    expect(t).toContain('Notify opndoor within two weeks of the second month of arrears.');
    expect(t).toContain('Make your claim to opndoor directly, or your agent can do it for you.');
    expect(t).toContain('Payments begin one month after eviction proceedings start, and continue from there.');
  });

  /* HELD: "Leave the £120,000 and £10,000 figures as they are for now." */
  it('keeps the cover amounts', () => {
    expect(t).toContain('&pound;120k');
    expect(t).toContain('&pound;10k');
    expect(t).toContain('capped at &pound;120,000, plus &pound;10,000 of legal costs');
    expect(t).toContain('up to twelve months of unpaid rent');
  });

  /* "Keep the leaflet's 'claim directly, or your agent can do it for you'",
     which is the leaflet's own wording and is NOT the FAQ's sentence. */
  it('keeps the leaflet\u2019s own way of saying who can claim', () => {
    expect(t).toContain('You can claim under the deed directly, or your agent can claim on your behalf.');
  });
});
