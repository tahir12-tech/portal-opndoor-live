/* THE SHAPES THAT KEEP COMING BACK.

   Two independent reviews of this schema found the same three mistakes at
   twenty-odd sites each, and every one of them was written by somebody who
   knew the rule. They are not knowledge failures, they are shapes that look
   right at the moment of typing:

     not public.app_has_scope() or X     "narrow it for a positioned caller,
                                          and for an unpositioned one there is
                                          nothing to narrow by, so allow"

     partner_id = public.app_partner()   a real company boundary on the
                                          supplier rail, and on the house route
                                          the set of every agency we carry

     revoke ... from authenticated       reads as closing a function, and
                                          leaves PUBLIC's default EXECUTE
                                          exactly where it was

   So the guard is a grep, and it runs in the web job where it needs no
   database. It fails the build on the SHAPE, in the migration file, before
   anybody has to reason about whether this particular instance is safe.

   WHY A GREP AND NOT ONLY THE pgTAP: the pgTAP check in
   definer_grants.test.sql asserts the STATE of a freshly-migrated database,
   which is the real guarantee. This one names the line and the file, which is
   what a person needs at 5pm on a Friday. They fail for different reasons and
   catch different mistakes: a fail-open inside a function body that happens to
   be service_role-only is invisible to the grant check and caught here.

   COMMENTS ARE STRIPPED FIRST, and that is not a detail. Half these
   migrations explain the bug they are fixing by quoting the old arm verbatim.
   An unstripped scan flags every one of those and the check gets switched off
   within a week, which is the real failure mode of a lint like this. */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'supabase', 'migrations');
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

/** SQL with comments removed, so prose about a bug never reads as the bug. */
function code(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/** Every line of code (1-indexed), comments blanked but line numbers intact. */
function codeLines(sql: string): Array<{ n: number; text: string }> {
  return code(sql).split('\n').map((text, i) => ({ n: i + 1, text }));
}

/* A migration written BEFORE the sweep is allowed to contain the old shape:
   it is history, and rewriting history is how you lose the record of what was
   fixed. The rule binds everything from the sweep onwards. Any new file sorts
   after this, because migration names are timestamps. */
const FROM = '20261006300000';
const NEW_FILES = FILES.filter((f) => f >= FROM);

describe('the fail-open shape cannot come back', () => {
  it('has migrations to check, so a broken glob cannot pass silently', () => {
    expect(FILES.length).toBeGreaterThan(200);
    expect(NEW_FILES.length).toBeGreaterThan(0);
  });

  /* `not app_has_scope() or ...` and `case when app_has_scope() ... else true`.
     Both mean "an unpositioned caller sees everything", and on our estate an
     unpositioned caller cannot exist any more (20261006300000), so a new one
     is dead code that will be read as a live decision by whoever finds it. */
  it('no new migration says "not app_has_scope() or"', () => {
    const hits: string[] = [];
    for (const f of NEW_FILES) {
      for (const { n, text } of codeLines(readFileSync(join(DIR, f), 'utf8'))) {
        if (/not\s+(public\.)?app_has_scope\s*\(\s*\)\s*\)?\s*or/i.test(text)) hits.push(`${f}:${n}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('no new migration falls through app_has_scope() to a bare "else true"', () => {
    const hits: string[] = [];
    for (const f of NEW_FILES) {
      const src = code(readFileSync(join(DIR, f), 'utf8'));
      // Within one CASE: the scope test, then an unguarded else.
      if (/app_has_scope\s*\(\s*\)[\s\S]{0,400}?\belse\s+true\b/i.test(src)) hits.push(f);
    }
    expect(hits).toEqual([]);
  });
});

describe('partner_id = app_partner() is not an authorisation test on its own', () => {
  /* It is still CORRECT beside a reach predicate: on the supplier rail the
     partner is the company, and every fixed site in the sweep keeps it. What
     is refused is a policy or a guard where it is the ONLY narrowing. */
  const REACH = /app_may_reach_|app_scoped_agencies|app_scope_branches|app_reachable_agency|app_reachable_group|app_user_in_scope|user_within_caller_scope|is_our_estate_partner|is_admin\s*\(\)|auth\.uid\s*\(\)/i;

  it('every new use sits beside a reach predicate', () => {
    const hits: string[] = [];
    for (const f of NEW_FILES) {
      const src = code(readFileSync(join(DIR, f), 'utf8'));
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (!/partner_id\s*=\s*(public\.)?app_partner\s*\(\s*\)/i.test(line)) return;
        // Judge the surrounding predicate, not the single line: these are
        // written across four or five lines and the reach test is usually the
        // next one.
        const window = lines.slice(Math.max(0, i - 6), i + 7).join('\n');
        if (!REACH.test(window)) hits.push(`${f}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});

describe('a revoke that leaves PUBLIC holding EXECUTE is not a revoke', () => {
  /* Postgres grants EXECUTE on every new function to PUBLIC. Measured on dev
     before the sweep: 193 of 263 SECURITY DEFINER functions were executable by
     `authenticated`, and 35 by `anon`, almost none of it deliberate.
     `revoke ... from authenticated` alone leaves has_function_privilege
     answering TRUE, because PUBLIC still holds it. */
  it('every new "revoke ... on function" names public', () => {
    const hits: string[] = [];
    for (const f of NEW_FILES) {
      const src = code(readFileSync(join(DIR, f), 'utf8'));
      const re = /revoke\s+(all|execute)[\s\S]{0,200}?on\s+function[\s\S]{0,400}?\bfrom\b([^;]*);/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const from = m[2].toLowerCase();
        // A revoke aimed only at service_role or authenticated is a
        // deliberate narrowing of a specific grant, not the PUBLIC default,
        // AND is only safe if the same file also revokes public somewhere for
        // that function. The file-level check below is the one that matters.
        if (/\bpublic\b/.test(from)) continue;
        const line = src.slice(0, m.index).split('\n').length;
        hits.push(`${f}:${line} revoke ... from${m[2].trim()}`);
      }
    }
    /* Not empty: `revoke all on function x from authenticated` is legitimate
       immediately after `revoke all on function x from public, anon`, which is
       exactly the pattern the grant sweep emits for the service-role bucket.
       So the assertion is that every such revoke has a public revoke for the
       SAME function in the same file. */
    const unpaired = hits.filter((h) => {
      const f = h.split(':')[0];
      const src = code(readFileSync(join(DIR, f), 'utf8'));
      return !/revoke\s+all\s+on\s+function[^;]*from[^;]*\bpublic\b/i.test(src);
    });
    expect(unpaired).toEqual([]);
  });

  it('and no new migration grants a function to anon without saying why', () => {
    const hits: string[] = [];
    for (const f of NEW_FILES) {
      const src = readFileSync(join(DIR, f), 'utf8');
      codeLines(src).forEach(({ n, text }) => {
        if (/grant\s+execute\s+on\s+function[\s\S]{0,300}?\bto\b[^;]*\banon\b/i.test(text)) hits.push(`${f}:${n}`);
      });
    }
    /* anon reaches this database through two edge functions holding
       service_role (tenant-portal and payment-page) and through nothing else,
       so there is no function anon needs to execute. If that ever changes,
       this test is the conversation about it. */
    expect(hits).toEqual([]);
  });
});
