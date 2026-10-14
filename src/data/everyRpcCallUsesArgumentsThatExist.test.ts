/* =====================================================================
   AN RPC IS RESOLVED BY ITS ARGUMENT NAMES, SO A RENAME IS A BREAK.

   Found while answering (cp). 20261008020000 created
   report_portal_incident(p_type, p_month). 20261008080000 renamed the
   second argument to p_context and updated one of its two callers.
   PostgREST matches a function by the NAMES of the arguments posted, so
   the other caller stopped resolving to anything at all: PGRST202,
   silently, in a fire-and-forget call nobody watches. It was the call
   that reports failures to Health, so the failure reporter failed
   silently for a day.

   NOTHING IN THE SUITE COULD SEE IT. The migration is SQL, the caller is
   TypeScript, and no test asserted the pair. pgTAP proves the function
   works; vitest proves the client calls something; only this compares
   the two sides of the wire.

   =====================================================================
   HOW IT READS THE SIGNATURE
   =====================================================================

   The migrations ARE the schema (npm run drift enforces that), so the
   last CREATE FUNCTION for a name in filename order is its current
   shape. That is the same rule a clean apply follows, so this cannot
   disagree with dev unless drift already does.

   IT ONLY EVER REPORTS AN ARGUMENT THAT IS SENT AND DOES NOT EXIST.
   Not the reverse: an argument with a default may rightly be omitted,
   and demanding every argument would fail on every optional one. A
   name that is sent and is not in the signature can only be a typo or
   a rename, and either way the call reaches nothing.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = process.cwd();

/** name -> the p_ argument names of its LAST definition in filename order. */
export function signaturesFromMigrations(dir: string): Map<string, Set<string>> {
  const sig = new Map<string, Set<string>>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, file), 'utf8');
    const def = /create\s+(?:or\s+replace\s+)?function\s+public\.([a-z0-9_]+)\s*\(([^;]*?)\)\s*returns/gis;
    for (let m = def.exec(sql); m; m = def.exec(sql)) {
      const args = `${m[2]} `.match(/(?:^|,)\s*(p_[a-z0-9_]+)\s/gi) ?? [];
      sig.set(m[1].toLowerCase(), new Set(args.map((a) => a.replace(/[,\s]/g, '').toLowerCase())));
    }
  }
  return sig;
}

/** Every `.rpc('name', { p_x: ... })` in a source file, as sent. */
export function rpcCallsIn(src: string): { fn: string; keys: string[] }[] {
  const out: { fn: string; keys: string[] }[] = [];
  const call = /\.rpc\(\s*'([a-z0-9_]+)'\s*,\s*\{(.*?)\}/gis;
  for (let m = call.exec(src); m; m = call.exec(src)) {
    const keys = (m[2].match(/(?:^|[,{\s])(p_[a-z0-9_]+)\s*:/gi) ?? [])
      .map((k) => k.replace(/[^a-z0-9_]/gi, '').toLowerCase());
    out.push({ fn: m[1].toLowerCase(), keys });
  }
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p, out); continue; }
    if (!/\.(ts|tsx)$/.test(p) || /\.test\.(ts|tsx)$/.test(p)) continue;
    out.push(p);
  }
  return out;
}

const SIG = signaturesFromMigrations(resolve(ROOT, 'supabase/migrations'));

describe('the detector itself', () => {
  /* PROVED ON THE REAL REGRESSION, written out as it was. A guard whose
     own logic is untested is a guard that can pass by not working. */
  it('catches the p_month call against the p_context signature', () => {
    const sig = signaturesFromMigrations(resolve(ROOT, 'supabase/migrations'));
    const asItWas = rpcCallsIn(
      "sb().rpc('report_portal_incident', { p_type: 'portal_statement_reference_unreadable', p_month: monthKey })",
    );
    expect(asItWas).toEqual([{ fn: 'report_portal_incident', keys: ['p_type', 'p_month'] }]);
    expect([...asItWas[0].keys].filter((k) => !sig.get('report_portal_incident')?.has(k))).toEqual(['p_month']);
  });

  it('reads a real signature, defaults and all', () => {
    expect(SIG.get('report_portal_incident')).toEqual(new Set(['p_type', 'p_context', 'p_code']));
  });

  /* THE LAST DEFINITION WINS, which is what a clean apply does. */
  it('and takes the latest definition when a function was redefined', () => {
    expect(SIG.get('report_portal_incident')?.has('p_month')).toBe(false);
  });

  it('covers the whole schema, not a handful of functions', () => {
    expect(SIG.size).toBeGreaterThan(300);
  });
});

describe('every RPC the client calls', () => {
  it('sends only arguments that function has', () => {
    const bad: string[] = [];
    for (const file of walk(resolve(ROOT, 'src'))) {
      const src = readFileSync(file, 'utf8');
      for (const { fn, keys } of rpcCallsIn(src)) {
        const known = SIG.get(fn);
        // A function defined outside the migrations (an extension, or a
        // name built at runtime) is not something this can judge.
        if (!known) continue;
        for (const k of keys) {
          if (!known.has(k)) bad.push(`${relative(ROOT, file)}  ${fn}(${k}) -- it takes ${[...known].join(', ') || 'no p_ arguments'}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
