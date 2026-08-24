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
import { carriedEmail, carriedTab, forgotHref, signInHref } from './carry';

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

describe('no entry point into the reset page forgets the tab', () => {
  it('has no link to a bare /forgot-password anywhere in src', () => {
    const offenders: string[] = [];
    for (const file of sources()) {
      // carry.ts BUILDS the link and appends the tab itself; the Route in
      // App.tsx declares the destination rather than linking to it.
      if (file.endsWith(join('pages', 'auth', 'carry.ts'))) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/<Route\s/.test(line)) return;
        for (const hit of line.match(/['"`]\/forgot-password([^'"`]*)['"`]/g) ?? []) {
          if (!hit.includes('tab=')) offenders.push(`${file}:${i + 1}  ${hit}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
