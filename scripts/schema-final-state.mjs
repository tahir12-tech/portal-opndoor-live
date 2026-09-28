/* THE FINAL STATE THE MIGRATION FILES DESCRIBE, computed without a database.
 *
 * WHY THIS EXISTS. 20261006300000 grants create_invited_user to
 * `authenticated`. 20261006330000 revokes it. Migrations apply in filename
 * order, so the revoke wins and every user invite breaks. Dev said otherwise,
 * because an earlier migration had been re-applied after a later one, and the
 * whole test suite was therefore measuring a database that no clean run would
 * ever produce.
 *
 * A fresh-database CI run catches that. It catches it late, it needs Docker,
 * and it cannot run on this machine. This does the same reasoning on the text:
 * read every migration in filename order, keep the LAST thing said about each
 * object, and print what a clean apply would leave behind.
 *
 * WHAT IT IS NOT. Not a SQL parser. It recognises the statement shapes this
 * repository actually uses, and it says so loudly when it meets one it does
 * not understand rather than skipping it quietly, because a silent skip here
 * is how the check becomes decoration.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'supabase', 'migrations');

/** SQL with comments and dollar-quoted bodies blanked, for statement splitting.
    Bodies are replaced by a placeholder of the same length so offsets hold. */
function maskBodies(sql) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
    if (tag) {
      const close = sql.indexOf(tag[0], i + tag[0].length);
      if (close === -1) { out += sql.slice(i); break; }
      const end = close + tag[0].length;
      out += ' '.repeat(end - i);
      i = end;
      continue;
    }
    if (sql.startsWith('--', i)) {
      const nl = sql.indexOf('\n', i);
      const end = nl === -1 ? sql.length : nl;
      out += ' '.repeat(end - i);
      i = end;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const close = sql.indexOf('*/', i + 2);
      const end = close === -1 ? sql.length : close + 2;
      out += ' '.repeat(end - i);
      i = end;
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
      const end = Math.min(j + 1, sql.length);
      out += ' '.repeat(end - i);
      i = end;
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

/** Statements, as [text, startOffset], split on semicolons outside bodies. */
function statements(sql) {
  const masked = maskBodies(sql);
  const out = [];
  let start = 0;
  for (let i = 0; i < masked.length; i += 1) {
    if (masked[i] !== ';') continue;
    const text = sql.slice(start, i);
    if (text.trim()) out.push([text, start]);
    start = i + 1;
  }
  if (sql.slice(start).trim()) out.push([sql.slice(start), start]);
  return out;
}

/** The statement with its comments removed, for matching. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

const ROLES = ['public', 'anon', 'authenticated', 'service_role', 'postgres', 'supabase_admin'];

/* Postgres spells a type several ways and pg_get_function_identity_arguments
   picks one. int and integer are the same function; treating them as two is
   how a check reports 40 differences that are all itself. */
const TYPE_ALIAS = new Map(Object.entries({
  int: 'integer', int4: 'integer', int2: 'smallint', int8: 'bigint',
  bool: 'boolean', float8: 'double precision', float4: 'real',
  'timestamp without time zone': 'timestamp', timestamptz: 'timestamptz',
  varchar: 'varchar', decimal: 'numeric',
}));
/** A return type spelled one way or another is the same return type. int and
    integer, timestamptz and timestamp with time zone, public.users and users,
    and any amount of whitespace inside a TABLE(...) list. Without this the
    apply-from-zero check reports a dozen differences that are all itself. */
function canonRet(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/\bpublic\./g, '')
    .replace(/\btimestamp with time zone\b/g, 'timestamptz')
    .replace(/\bcharacter varying\b/g, 'varchar')
    .replace(/\bint4\b|\bint\b/g, 'integer')
    .replace(/\bint8\b/g, 'bigint')
    .replace(/\bint2\b/g, 'smallint')
    .replace(/\bbool\b/g, 'boolean')
    .replace(/\bdecimal\b/g, 'numeric')
    .replace(/\bsetof\s+/g, 'setof ')
    .replace(/\s*([(),])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A function body reduced to what it DOES: comments gone, whitespace
    collapsed, case folded. Two bodies that differ only in wording compare
    equal; two that differ in a single predicate do not. This is what catches
    a migration that was written and never reached dev. */
export function normaliseBody(src) {
  return String(src || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

function canonType(t) {
  const arr = t.endsWith('[]');
  const base = arr ? t.slice(0, -2) : t;
  const mapped = TYPE_ALIAS.get(base) ?? base;
  return arr ? `${mapped}[]` : mapped;
}

/** Normalise a function signature to name(argtype, argtype). Types are
    lowercased and defaults dropped, so the same function written two ways
    still collides. */
function normaliseSig(raw) {
  const m = /^\s*(?:public\.)?([a-z0-9_]+)\s*\(([\s\S]*)\)\s*$/i.exec(raw);
  if (!m) return null;
  const name = m[1].toLowerCase();
  const inner = m[2].trim();
  if (!inner) return `${name}()`;
  const args = [];
  let depth = 0;
  let cur = '';
  for (const ch of inner) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { args.push(cur); cur = ''; continue; }
    cur += ch;
  }
  args.push(cur);
  const types = args.map((a) => {
    let t = a.trim().replace(/\s+default\s+[\s\S]*$/i, '').trim();
    // Drop a leading parameter name and any IN/OUT mode.
    t = t.replace(/^(in|out|inout|variadic)\s+/i, '');
    const parts = t.split(/\s+/);
    if (parts.length > 1 && /^[a-z_][a-z0-9_]*$/i.test(parts[0]) && !/^(timestamp|double|character|bit)$/i.test(parts[0])) {
      parts.shift();
    }
    return parts.join(' ').toLowerCase()
      .replace(/^public\./, '')
      .replace(/\btimestamp with time zone\b/, 'timestamptz')
      .replace(/\bcharacter varying\b/, 'varchar')
      .replace(/\s+/g, ' ')
      .trim();
  });
  return `${name}(${types.map(canonType).join(',')})`;
}

/**
 * Replay every migration in filename order and keep the last word on each
 * object.
 */
export function finalState() {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  /** sig -> Set of roles holding EXECUTE, tracking PUBLIC separately. */
  const funcGrants = new Map();
  /** sig -> filename that last defined it. */
  const funcDefined = new Map();
  /** "table.policy" -> {file, dropped} */
  const policies = new Map();
  /** "table.trigger" -> {file, dropped} */
  const triggers = new Map();
  /** table -> {priv -> Set(roles) | 'TABLE'} for column-level narrowing. */
  const tableGrants = new Map();
  const unparsed = [];
  /* WOULD THIS APPLY FROM ZERO? `create or replace function` REFUSES a return
     type change with 42P13, so a migration that changes one without dropping
     first is a migration that works against dev (where the old signature may
     already be gone) and dies on a clean run. Dev saw exactly that error
     twice today. Tracked here so the answer is a check rather than a memory. */
  const funcReturns = new Map();
  const returnChanges = [];
  /** sig -> the body of its LAST definition, normalised for comparison. */
  const funcBodies = new Map();
  /** sig -> true when its LAST definition says SECURITY DEFINER. The grant
      allowlist is about definer functions, because those are the ones that
      run as their owner with RLS off inside them. */
  const funcSecdef = new Map();

  /* WHAT A NEW FUNCTION STARTS WITH. Postgres grants EXECUTE to PUBLIC on
     every new function, which is the whole reason the grant sweep existed.
     20261006330000 then issues ALTER DEFAULT PRIVILEGES FOR ROLE postgres,
     revoking that and granting service_role instead, so a function created
     after that line starts closed. Modelling the default wrongly would make
     this check disagree with a real apply in exactly the direction that hides
     an open function. */
  let defaultRoles = ['public'];
  const touch = (sig) => {
    if (!funcGrants.has(sig)) funcGrants.set(sig, new Set(defaultRoles));
    return funcGrants.get(sig);
  };

  for (const file of files) {
    const sql = readFileSync(join(DIR, file), 'utf8');
    for (const [raw] of statements(sql)) {
      const s = code(raw).replace(/\s+/g, ' ').trim();
      if (!s) continue;
      const low = s.toLowerCase();
      let m;

      // ---- default privileges, which change what the NEXT function starts with
      if (/^alter\s+default\s+privileges/i.test(low) && /on\s+functions/i.test(low)) {
        const named = (/\b(?:to|from)\s+([\s\S]+)$/i.exec(s) || [, ''])[1]
          .split(',').map((r) => r.trim().toLowerCase()).filter((r) => ROLES.includes(r));
        const set = new Set(defaultRoles);
        if (/^alter[\s\S]*\bgrant\b/i.test(s)) named.forEach((r) => set.add(r));
        else named.forEach((r) => set.delete(r));
        defaultRoles = [...set];
        continue;
      }

      // ---- blanket grants over every function that exists AT THAT POINT ----
      // 20260702134957 revokes EXECUTE on all functions from public, and
      // 20260702135800 the same from anon. Skipping these left ~10 early
      // trigger helpers looking PUBLIC-callable in the model and closed on
      // dev, which is the model being wrong rather than dev drifting.
      m = /^(grant|revoke)\s+(?:all|execute)[\s\S]*?on\s+all\s+functions\s+in\s+schema\s+public\s+(?:to|from)\s+([\s\S]+)$/i.exec(s);
      if (m) {
        const named = m[2].split(',').map((r) => r.trim().toLowerCase()).filter((r) => ROLES.includes(r));
        for (const set of funcGrants.values()) {
          if (/^grant$/i.test(m[1])) named.forEach((r) => set.add(r));
          else named.forEach((r) => set.delete(r));
        }
        continue;
      }

      // ---- function definitions -------------------------------------------
      const m2 = /^create\s+(?:or\s+replace\s+)?function\s+([\s\S]+?\))/i.exec(s);
      if (m2) {
        const sig = normaliseSig(m2[1]);
        if (!sig) { unparsed.push([file, s.slice(0, 90)]); continue; }
        const ret = canonRet((/\)\s*returns\s+([\s\S]+?)(?:\s+language\b|\s+as\b|$)/i.exec(s) || [, ''])[1]);
        const prev = funcReturns.get(sig);
        if (prev !== undefined && prev !== ret && /or\s+replace/i.test(s)) {
          returnChanges.push([file, sig, prev, ret]);
        }
        funcReturns.set(sig, ret);
        // The dollar-quoted body of THIS definition, taken from the raw text
        // because `s` has had its comments stripped and its body masked.
        const bm = /\$([A-Za-z_][A-Za-z0-9_]*)?\$([\s\S]*?)\$\1?\$/.exec(raw);
        if (bm) funcBodies.set(sig, normaliseBody(bm[2]));
        funcSecdef.set(sig, /\bsecurity\s+definer\b/i.test(s));
        // CREATE OR REPLACE preserves the ACL; a fresh CREATE after a DROP
        // resets it to the default.
        touch(sig);
        funcDefined.set(sig, file);
        continue;
      }
      if (/^drop\s+function/i.test(low)) {
        m = /^drop\s+function\s+(?:if\s+exists\s+)?([\s\S]+?\))/i.exec(s);
        if (m) {
          const sig = normaliseSig(m[1]);
          if (sig) { funcGrants.delete(sig); funcDefined.delete(sig); funcReturns.delete(sig); funcBodies.delete(sig); funcSecdef.delete(sig); }
        }
        continue;
      }

      // ---- function grants and revokes -------------------------------------
      m = /^(grant|revoke)\s+(all|execute)[\s\S]*?on\s+function\s+([\s\S]+?\))\s+(?:to|from)\s+([\s\S]+)$/i.exec(s);
      if (m) {
        const sig = normaliseSig(m[3]);
        if (!sig) { unparsed.push([file, s.slice(0, 90)]); continue; }
        const set = touch(sig);
        const named = m[4].split(',').map((r) => r.trim().toLowerCase()).filter((r) => ROLES.includes(r));
        if (/^grant$/i.test(m[1])) named.forEach((r) => set.add(r));
        else named.forEach((r) => set.delete(r));
        continue;
      }

      // ---- policies ---------------------------------------------------------
      m = /^create\s+policy\s+([a-z0-9_"]+)\s+on\s+(?:public\.)?([a-z0-9_"]+)/i.exec(s);
      if (m) { policies.set(`${m[2]}.${m[1]}`.replace(/"/g, ''), file); continue; }
      m = /^drop\s+policy\s+(?:if\s+exists\s+)?([a-z0-9_"]+)\s+on\s+(?:public\.)?([a-z0-9_"]+)/i.exec(s);
      if (m) { policies.delete(`${m[2]}.${m[1]}`.replace(/"/g, '')); continue; }

      // ---- triggers ---------------------------------------------------------
      /* Triggers, including the ones written as execute 'create trigger ...'
         inside a DO block, which a text model would otherwise miss entirely:
         partner_api_key_rail_guard is one, and it showed up as drift when it
         was simply invisible. Targets are schema-qualified, because a trigger
         on auth.mfa_factors is not a public-schema trigger and the live half
         of the diff only reads public. */
      const trigTarget = (raw2) => {
        const q = raw2.replace(/"/g, '');
        return q.includes('.') ? q : `public.${q}`;
      };
      for (const stmt of [s, ...[...s.matchAll(/execute\s+'([^']*create[^']*trigger[^']*)'/gi)].map((x) => x[1])]) {
        const cm = /create\s+(?:constraint\s+)?trigger\s+([a-z0-9_"]+)[\s\S]*?\son\s+([a-z0-9_".]+)/i.exec(stmt);
        if (cm) { triggers.set(`${trigTarget(cm[2])}.${cm[1].replace(/"/g, '')}`, file); }
      }
      if (/^create\s+(?:constraint\s+)?trigger/i.test(s) || /execute\s+'[^']*create[^']*trigger/i.test(s)) continue;
      m = /^drop\s+trigger\s+(?:if\s+exists\s+)?([a-z0-9_"]+)\s+on\s+([a-z0-9_".]+)/i.exec(s);
      if (m) { triggers.delete(`${trigTarget(m[2])}.${m[1].replace(/"/g, '')}`); continue; }

      // ---- table and column privileges --------------------------------------
      m = /^(grant|revoke)\s+([a-z, ()a-z0-9_]+?)\s+on\s+(?:table\s+)?(?:public\.)?([a-z0-9_]+)\s+(?:to|from)\s+([\s\S]+)$/i.exec(s);
      if (m && !/on\s+function/i.test(s) && !/on\s+all\b/i.test(s) && !/on\s+schema\b/i.test(s) && !/on\s+sequence/i.test(s)) {
        const table = m[3].toLowerCase();
        const privs = m[2].toLowerCase();
        const named = m[4].split(',').map((r) => r.trim().toLowerCase()).filter((r) => ROLES.includes(r));
        if (!tableGrants.has(table)) tableGrants.set(table, []);
        tableGrants.get(table).push({ file, kind: m[1].toLowerCase(), privs, roles: named });
        continue;
      }
    }
  }

  return { files, funcGrants, funcDefined, policies, triggers, tableGrants, unparsed, returnChanges, funcBodies, funcSecdef };
}

/** Functions a clean apply leaves callable by a given role. */
export function callableBy(state, role, { definerOnly = false } = {}) {
  const out = [];
  for (const [sig, roles] of state.funcGrants) {
    if (!state.funcDefined.has(sig)) continue;
    if (definerOnly && !state.funcSecdef.get(sig)) continue;
    if (roles.has(role) || roles.has('public')) out.push(sig);
  }
  return out.sort();
}

if (process.argv[1] && process.argv[1].endsWith('schema-final-state.mjs')) {
  const st = finalState();
  const auth = callableBy(st, 'authenticated');
  const anon = callableBy(st, 'anon');
  console.log(`migrations: ${st.files.length}`);
  console.log(`functions defined: ${st.funcDefined.size}`);
  console.log(`callable by authenticated: ${auth.length}`);
  console.log(`callable by anon: ${anon.length}`);
  console.log(`policies live: ${st.policies.size}`);
  console.log(`triggers live: ${st.triggers.size}`);
  if (st.unparsed.length) {
    console.log(`\nSTATEMENTS NOT UNDERSTOOD (${st.unparsed.length}), which the check refuses to skip silently:`);
    for (const [f, t] of st.unparsed.slice(0, 20)) console.log(`  ${f}: ${t}`);
  }
  if (st.returnChanges.length) {
    console.log(`\nRETURN TYPE CHANGED WITHOUT A DROP (${st.returnChanges.length}), which is 42P13 on a clean apply:`);
    st.returnChanges.forEach(([f, sig, a2, b2]) => console.log(`  ${f}: ${sig}  ${a2} -> ${b2}`));
  } else {
    console.log('\nNo return-type change without a preceding drop: the files apply from zero.');
  }
  if (process.argv.includes('--list-auth')) auth.forEach((a) => console.log(a));
  if (process.argv.includes('--list-anon')) anon.forEach((a) => console.log(a));
}
