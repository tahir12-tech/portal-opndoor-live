/* WALK FIXES 31, 32 AND 33. THE INVITE EMAIL.
 *
 * 31. "the App Store and Google Play lines print raw code as text ('<a
 *     href="..." style="color:#5b3fd9;">') and show each link twice. Each
 *     should be one clean link."
 * 32. "the authenticator app is explained twice ('You will need an
 *     authenticator app' then 'You need an authenticator app'). One short
 *     line."
 * 33. "it says 'invited you to the portal for Opndoor Agents', naming the
 *     hidden house account. It must name the agency or supplier the person
 *     is joining (e.g. Regent's Lettings), and Opndoor staff invites should
 *     say Opndoor. Check every other email for the house account name."
 *
 * ITEM 31 IS NOT A TEMPLATE BUG. It is `rich()` in emailLayout.ts, and it is
 * wider than this email. The href pattern reads
 *
 *     /&lt;a href=&quot;(https?:\/\/[^&quot;\s<>]+)&quot;.../
 *
 * and `[^&quot;\s<>]` is a CHARACTER CLASS, not a negated literal: it
 * excludes the individual characters & q u o t ; and whitespace and angle
 * brackets. The intent was "anything that is not the escaped quote". So any
 * URL containing q, u, o, t, & or ; -- which is very nearly every URL, and
 * both of these -- fails to match, and the escaped tag is printed as text.
 * That is both halves of the report: the raw code, and the address twice,
 * because the URL was also the link text.
 *
 * So the assertions below go through the LAYOUT, not the template, and one
 * of them is about an unrelated URL, because a fix to the two store links
 * alone would leave every other anchor in the product broken.
 *
 * WHY THIS FILE IS IN src/. Deno is not installed here, so `deno test`
 * cannot be the guard, and emailTemplates and emailLayout have no Deno-only
 * imports. A test that cannot be run is not a guard against anything. Same
 * reasoning as tenantFeeEmails.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { renderHtml, renderText } from '../../supabase/functions/_shared/emailLayout.ts';
import { staffInviteEmail } from '../../supabase/functions/_shared/emailTemplates.ts';
import { namedParty } from '../../supabase/functions/_shared/namedParty.ts';

const invite = (partnerName: string) =>
  staffInviteEmail({ inviterName: 'Rosa Vance', partnerName, link: 'https://portal.example/accept-invite?t=abc' });

const html = (partnerName = 'Regent’s Lettings') => renderHtml(invite(partnerName));
const text = (partnerName = 'Regent’s Lettings') => renderText(invite(partnerName));

describe('item 31: the store links are links', () => {
  /* THE DEFECT, AS REPORTED: the markup arriving as words. */
  it('does not print the markup as text', () => {
    expect(html()).not.toMatch(/&lt;a href=/);
    expect(html()).not.toMatch(/&quot;color:/);
  });

  it('and renders a real anchor to each store', () => {
    expect(html()).toMatch(/<a href="https:\/\/apps\.apple\.com\/app\/google-authenticator[^"]*"/);
    expect(html()).toMatch(/<a href="https:\/\/play\.google\.com\/store\/apps\/details[^"]*"/);
  });

  /* "SHOW EACH LINK TWICE." The URL was the link text as well as the href,
     so a reader saw the address, then the address again. */
  it('and shows each address once, not twice', () => {
    const body = html();
    const appearances = (needle: string) => body.split(needle).length - 1;
    expect(appearances('apps.apple.com/app/google-authenticator')).toBe(1);
    expect(appearances('play.google.com/store/apps/details')).toBe(1);
  });

  /* AND THE PLAIN-TEXT PART STILL CARRIES THE ADDRESS. The URL was the link
     text precisely because renderText strips tags, so a clean link would
     have left a text-only reader the words "App Store" and no way to get
     there. Fixing one half by breaking the other is not a fix. */
  it('while the plain-text part still gives the address', () => {
    expect(text()).toMatch(/apps\.apple\.com\/app\/google-authenticator/);
    expect(text()).toMatch(/play\.google\.com\/store\/apps\/details/);
  });

  /* WIDER THAN THIS EMAIL. Nearly every URL contains one of q, u, o, t, &
     or ;, so the same escaped markup reached every anchor in every p, small
     or list block in the product. */
  it('and an anchor to any other address works too', () => {
    const out = renderHtml({
      subject: 's', heading: 'h',
      blocks: [{ p: 'See <a href="https://example.com/a?b=1&c=2">the note</a>.' }],
    } as Parameters<typeof renderHtml>[0]);
    expect(out).toMatch(/<a href="https:\/\/example\.com\/a\?b=1&amp;c=2"/);
    expect(out).not.toMatch(/&lt;a href=/);
  });
});

describe('item 32: the authenticator app is explained once', () => {
  /* Two sentences saying the same thing, one after the other. */
  it('says it once, not twice', () => {
    const t = text();
    const hits = (t.match(/authenticator app/gi) ?? []).length;
    expect(hits).toBe(1);
  });

  it('and still says where to get one', () => {
    expect(text()).toMatch(/Google Authenticator/);
  });
});

describe('item 33: the email names the party the person is joining', () => {
  it('names the agency', () => {
    expect(text('Regent’s Lettings')).toMatch(/Regent’s Lettings/);
  });

  /* THE DEFECT, AS REPORTED. `opndoor-agents` is the house partner every
     agency is carried on; it is plumbing and no customer has heard of it.
     channel.ts exists to stop it surfacing and this email was the leak. */
  it('and never the house account that carries them', () => {
    for (const houseName of ['Opndoor Agents', 'opndoor-agents', 'Opndoor Direct', 'Referencing Partner']) {
      expect(text('Regent’s Lettings'), houseName).not.toContain(houseName);
    }
  });

  /* AND AN OPNDOOR STAFF INVITE SAYS OPNDOOR, which is the other half of
     Matt's sentence. It is already in the sentence -- "the opndoor
     Guarantee Referral Portal" -- so the clause naming a party is DROPPED
     rather than repeating the word: "the opndoor portal for opndoor" is not
     a sentence. */
  it('and an Opndoor staff invite says Opndoor once, with no dangling clause', () => {
    const t = renderText(staffInviteEmail({
      inviterName: 'Rosa Vance', partnerName: '', link: 'https://portal.example/accept-invite?t=abc',
    }));
    expect(t).toMatch(/invited you to the opndoor Guarantee Referral Portal\./);
    expect(t).not.toMatch(/ for\s*\./);
    expect(t).not.toMatch(/for\s+opndoor/i);
  });
});

/* AND THE LEAK IS IN THE CALLER. The template prints what it is given, and
   invite-user gave it `partners.name` -- which on the agency rail is the
   house partner "Opndoor Agents", the very thing channel.ts exists to keep
   off a screen. These assert the decision itself, where it now lives. */
describe('item 33: which party an invite names', () => {
  it('names the agency on the agency rail, never the house partner', () => {
    expect(namedParty({
      partnerSlug: 'opndoor-agents', partnerName: 'Opndoor Agents', agencyName: 'Regent’s Lettings',
    })).toBe('Regent’s Lettings');
  });

  it('names a real supplier by its own name', () => {
    expect(namedParty({
      partnerSlug: 'kestrel-lettings', partnerName: 'Kestrel Lettings', agencyName: null,
    })).toBe('Kestrel Lettings');
  });

  it('names nothing for Opndoor’s own staff, who have no partner', () => {
    expect(namedParty({ partnerSlug: null, partnerName: null, agencyName: null })).toBe('');
  });

  /* NOTHING, NOT THE PLUMBING. An agency invite whose agency could not be
     resolved must name no party rather than fall back to the house
     partner's name, which is the defect restated. */
  it('and names nothing rather than the plumbing when the agency is unknown', () => {
    for (const slug of ['opndoor-agents', 'opndoor-direct', 'referencing-partner']) {
      expect(namedParty({ partnerSlug: slug, partnerName: 'Opndoor Agents', agencyName: null }), slug).toBe('');
    }
  });
});

/* ITEM 33's LAST SENTENCE: "Check every other email for the house account
   name." It found one, and it is not an email: the tenant's PAYMENT PAGE
   reads `partnerRow?.name ?? "your letting agent"`, so on an agency-rail
   referral that was not agency-arranged, the screen where a tenant hands
   over a card named "Opndoor Agents" -- a company they have never dealt
   with and which does not exist outside our schema.

   The agency-arranged branch of PayLanding already names the agency, which
   is why this survived: it is the OTHER branch. */
describe('item 33: the same rule on the tenant’s payment page', () => {
  /** What payment-page now computes, with its own fallback. */
  const shownToTenant = (p: Parameters<typeof namedParty>[0]) =>
    namedParty(p) || 'your letting agent';

  it('names the agency rather than the house partner', () => {
    expect(shownToTenant({
      partnerSlug: 'opndoor-agents', partnerName: 'Opndoor Agents', agencyName: 'Regent’s Lettings',
    })).toBe('Regent’s Lettings');
  });

  /* AND FALLS BACK TO WORDS, NOT TO THE PLUMBING. A tenant with no agency
     resolved reads "your letting agent", which is true and says nothing it
     should not; "Opndoor Agents" is neither. */
  it('and falls back to "your letting agent" when there is no agency', () => {
    expect(shownToTenant({
      partnerSlug: 'opndoor-agents', partnerName: 'Opndoor Agents', agencyName: null,
    })).toBe('your letting agent');
  });

  it('while a real supplier is still named', () => {
    expect(shownToTenant({
      partnerSlug: 'kestrel-lettings', partnerName: 'Kestrel Lettings', agencyName: null,
    })).toBe('Kestrel Lettings');
  });
});
