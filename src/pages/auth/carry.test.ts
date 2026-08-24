/* The tab and the email that /login and /forgot-password hand each other.

   The last test here is the one that matters. Every other entry point into the
   reset page is a chance to forget the tab, and forgetting it is invisible:
   the link still works, you just land as a Tenant. That is how /reset-password
   came to send an agent with an expired link to the Tenant tab, and how the
   staff sign-in form came to pass the email and not the tab. A rule enforced
   at each call site is one chance per call site to be wrong about it. */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { carriedEmail, carriedStaffTab, carriedTab, forgotHref, signInHref } from './carry';

const q = (s: string) => new URLSearchParams(s);

describe('what is carried', () => {
  it('reads an address back out exactly as it was put in', () => {
    const email = 'sam.o+tag@example.co.uk';
    const href = forgotHref('agent', email);
    expect(carriedEmail(q(href.split('?')[1]))).toBe(email);
  });

  it('trims, and caps at the longest an address may legally be', () => {
    expect(carriedEmail(q('email=%20%20sam%40example.co.uk%20%20'))).toBe('sam@example.co.uk');
    expect(carriedEmail(q(`email=${'a'.repeat(9000)}`)).length).toBe(254);
  });

  it('answers null for a missing or unknown tab rather than picking one', () => {
    // The two pages disagree about the default on purpose: /login opens on
    // Agent, /forgot-password on Tenant. This must not decide that for them.
    expect(carriedTab(q(''))).toBeNull();
    expect(carriedTab(q('tab=landlord'))).toBeNull();
    expect(carriedTab(q('tab=agent'))).toBe('agent');
  });

  it('leaves email off entirely when there is none, rather than sending email=', () => {
    expect(forgotHref('supplier', '   ')).toBe('/forgot-password?tab=supplier');
    expect(signInHref('tenant', '')).toBe('/login?tab=tenant');
  });

  it('reads a staff tab, and never answers tenant', () => {
    // /reset-password serves only agents and suppliers. Anything else arriving
    // there is a hand-edited URL or an old link, and Agent beats sending a
    // member of staff to the tenant tab.
    expect(carriedStaffTab(q('tab=supplier'))).toBe('supplier');
    expect(carriedStaffTab(q('tab=agent'))).toBe('agent');
    expect(carriedStaffTab(q('tab=tenant'))).toBe('agent');
    expect(carriedStaffTab(q(''))).toBe('agent');
  });

  it('round trips both ways', () => {
    const there = forgotHref('supplier', 'a@b.co');
    const back = signInHref(carriedTab(q(there.split('?')[1]))!, carriedEmail(q(there.split('?')[1])));
    expect(back).toBe('/login?tab=supplier&email=a%40b.co');
  });
});

/** Every source file under src, tests excluded. .js and .jsx are included even
    though the repo is TypeScript: the point of a sweep is that it does not stop
    at the file types that happen to exist on the day it was written. */
function sources(dir = 'src'): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    if (!/\.[jt]sx?$/.test(full) || /\.test\.[jt]sx?$/.test(full)) return [];
    return [full];
  });
}

/* The link, and whether it names a real audience.

   Two holes the first version of this had, both found by review rather than by
   the suite going red, which is the point of testing the matcher itself:

     1. It skipped any line containing "<Route ", so
        <Route path="/x" element={<Navigate to="/forgot-password" />} /> was
        waved through whole. Only the Route's OWN path attribute declares the
        destination; anything else on that line is still a link to it.
     2. It asked whether the string contained "tab=", which "?tab=" and
        "?notatab=x" both satisfy. A tab that is mentioned is not a tab that is
        carried. */
const NAMES_AN_AUDIENCE = /[?&]tab=(tenant|agent|supplier)(?=[&'"`]|$)/;

export function offendingLinks(line: string): string[] {
  const scan = line.replace(/path=(['"])\/forgot-password\1/g, '');
  return (scan.match(/['"`]\/forgot-password([^'"`]*)['"`]/g) ?? [])
    .filter((hit) => !NAMES_AN_AUDIENCE.test(hit));
}

describe('the invariant matcher has teeth', () => {
  it('passes a link that names a real audience', () => {
    expect(offendingLinks(`<Link to="/forgot-password?tab=agent">x</Link>`)).toEqual([]);
    expect(offendingLinks(`href="/forgot-password?tab=tenant&email=a%40b.co"`)).toEqual([]);
  });

  it('ignores the Route that DECLARES the page, but not a link beside it', () => {
    expect(offendingLinks(`<Route path="/forgot-password" element={<ForgotPassword />} />`)).toEqual([]);
    // The hole. A redirect route is a link, and it used to be skipped wholesale.
    expect(offendingLinks(`<Route path="/old" element={<Navigate to="/forgot-password" />} />`))
      .toEqual(['"/forgot-password"']);
  });

  it('rejects a tab that is mentioned rather than carried', () => {
    expect(offendingLinks(`to="/forgot-password?tab="`).length).toBe(1);
    expect(offendingLinks(`to="/forgot-password?nottab=agent"`).length).toBe(1);
    expect(offendingLinks(`to="/forgot-password?tab=landlord"`).length).toBe(1);
    // Interpolated: cannot be checked here, so it must be looked at by a human.
    expect(offendingLinks('to={`/forgot-password?tab=${who}`}').length).toBe(1);
  });

  it('catches a bare link', () => {
    expect(offendingLinks(`<a href="/forgot-password">reset</a>`)).toEqual(['"/forgot-password"']);
  });
});

describe('no entry point into the reset page forgets the tab', () => {
  it('has none anywhere in src', () => {
    const offenders: string[] = [];
    for (const file of sources()) {
      // carry.ts BUILDS the link and appends the tab itself.
      if (file.endsWith(join('pages', 'auth', 'carry.ts'))) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        for (const hit of offendingLinks(line)) offenders.push(`${file}:${i + 1}  ${hit}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
