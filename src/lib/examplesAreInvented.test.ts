/* AN EXAMPLE MUST BE OBVIOUSLY INVENTED.
 *
 * Matt, 2026-10-03, verbatim: "Sweep every placeholder and example in the
 * portal, emails and docs (form hints, 'e.g.' text, empty states, help pages)
 * and replace any real or real-sounding company, agency or person names with
 * obviously invented ones, e.g. 'Example Lettings', 'Jane Smith',
 * 'jane@example.co.uk'. Don't change test data, only examples shown to users."
 *
 * WHY IT MATTERS MORE THAN IT LOOKS. Two of the hints named real customers:
 * "e.g. Frost Partnership" on the supplier's Add agency form, and "e.g.
 * Northgate Lettings" with "lettings@northgate.co.uk" on Add agency -- Frost,
 * Northgate and Meridian are all live parties. An agency typing into a form
 * that suggests a competitor's name by way of example is the portal telling
 * them who else is on it.
 *
 * AND THE EMAIL DOMAINS WERE REGISTRABLE. agency.co.uk, supplier.co.uk,
 * northgate.co.uk, brackenhouse.co.uk and company.com can all belong to
 * somebody. example.com and example.co.uk are reserved by the IETF and can
 * never belong to anybody, which is exactly the "obviously invented" property
 * Matt asked for -- and it is the one that matters, because a placeholder is
 * the address somebody sends a test invite to.
 *
 * WHAT IS NOT IN SCOPE, stated so the next reader does not widen it by
 * accident: Matt named "company, agency or person names". Streets, towns and
 * postcodes are geography rather than parties, and a hint has to look like a
 * real address to teach the shape of the field, so "Flat 4, 18 Onslow
 * Gardens, SW7 3LA" stays. opndoor's own name and its own addresses stay,
 * because they are not standing in for the reader's. And demo-mode fixtures
 * stay: that is the test data Matt's last sentence excludes.
 *
 * WITH ONE EDGE THE SCAN DECIDED FOR ME. "e.g. 14 Northgate, Chester CH1
 * 2EX" is an address, and Northgate is a real Chester street -- but it is
 * also a live party, and it was chosen to match the "Northgate Lettings"
 * hint in the field above it. A reader cannot tell which of the two they are
 * looking at, so the street is now High Street. The rule this test holds is
 * therefore the simple one: no live or demo party's name appears in any
 * hint, wherever in the sentence it sits.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(process.cwd(), 'src');

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      // Demo-mode fixtures are the test data Matt's instruction excludes.
      if (name === 'mock') continue;
      sources(p, out);
      continue;
    }
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
    out.push(p);
  }
  return out;
}

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const FILES = sources(ROOT).map((p) => [relative(ROOT, p), stripComments(readFileSync(p, 'utf8'))] as const);

/** Every placeholder string the portal draws. */
function placeholders(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const [file, text] of FILES) {
    for (const m of text.matchAll(/placeholder=(?:"([^"]*)"|\{'([^']*)'\})/g)) {
      out.push({ file, text: m[1] ?? m[2] ?? '' });
    }
  }
  return out;
}

const PLACEHOLDERS = placeholders();

describe('the scan', () => {
  it('found the portal’s placeholders, so a broken scan cannot pass silently', () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(PLACEHOLDERS.length).toBeGreaterThan(40);
  });
});

describe('no example email is on a domain somebody could own', () => {
  /* OURS IS NOT AN EXAMPLE. accounts@opndoor.co and partners@opndoor.co are
     real addresses that the reader is meant to use, which is the opposite of
     a placeholder standing in for their own. */
  const OURS = /@opndoor\.(co|com)$/;

  it('every one is example.com or example.co.uk, or opndoor’s own', () => {
    const bad = PLACEHOLDERS
      .filter((p) => /@/.test(p.text) && !p.text.includes(' '))
      .filter((p) => !OURS.test(p.text))
      .filter((p) => !/@example\.(com|co\.uk)$/.test(p.text))
      .map((p) => `${p.file}  ${p.text}`);
    expect(bad).toEqual([]);
  });
});

describe('no example names a real or real-sounding party', () => {
  /* THE LIVE AND DEMO PARTIES BY NAME. Every one of these is either a real
     customer on dev or a demo agency, and three of them were in hints. */
  const PARTIES = [
    'Frost', 'Kestrel', 'Northgate', 'Meridian', 'Regent', 'Bracken',
    'Foxglove', 'Marylebone', 'Hartwell', 'Northbank', 'Cityscape',
    'Harbourside', 'Northwind', 'Southbank', 'Riverside', 'Letly',
  ];

  it.each(PARTIES)('does not suggest %s', (party) => {
    const bad = PLACEHOLDERS
      .filter((p) => new RegExp(party, 'i').test(p.text))
      .map((p) => `${p.file}  ${p.text}`);
    expect(bad).toEqual([]);
  });

  /* THE PEOPLE WHO WERE IN THE HINTS, each a real-sounding name and two of
     them the names of real dev users (Rosa is Regent's Director). */
  const PEOPLE = ['Jordan Blake', 'Sam Rivers', 'Priya Shah', 'Rosa Hartley', 'Okafor', 'Amelia', 'Hartley'];

  it.each(PEOPLE)('and does not name %s', (who) => {
    const bad = PLACEHOLDERS
      .filter((p) => new RegExp(who, 'i').test(p.text))
      .map((p) => `${p.file}  ${p.text}`);
    expect(bad).toEqual([]);
  });
});

describe('what the examples say instead', () => {
  const all = PLACEHOLDERS.map((p) => p.text);

  it('is Jane Smith, wherever a person is wanted', () => {
    expect(all).toContain('e.g. Jane Smith');
    expect(all).toContain('Jane');
    expect(all).toContain('Smith');
    expect(all).toContain('Jane Smith');
  });

  it('and Example Lettings or Example Property Group for a company', () => {
    expect(all).toContain('e.g. Example Lettings');
    expect(all).toContain('e.g. Example Property Group');
    expect(all).toContain('Example Property Group');
  });

  it('and jane@example.co.uk for an address', () => {
    expect(all).toContain('jane@example.co.uk');
  });

  /* A PHONE NUMBER IS THE SAME QUESTION AS AN EMAIL DOMAIN: it can reach
     somebody real. Ofcom reserves 020 7946 0xxx and 07700 900xxx for
     exactly this, and the portal used them everywhere but one hint. */
  it('and a phone number nobody can answer', () => {
    const phones = all.filter((t) => /^[0-9][0-9 ]{8,}$/.test(t));
    expect(phones.length).toBeGreaterThan(0);
    for (const p of phones) expect(p, `${p} is not a reserved number`).toMatch(/^(020 7946 0|07700 900)/);
  });
});
