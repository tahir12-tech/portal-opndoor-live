/* DOES DEV MATCH WHAT THE MIGRATION FILES SAY?
 *
 * The files are the truth: they are what CI applies from zero and what Balal
 * applies to the clone and then to production. Dev is a working copy that has
 * had migrations run against it by hand, and once an earlier migration is
 * re-applied after a later one the two part company silently. That is not
 * hypothetical: it is how a revoke that broke every user invite sat green in
 * the suite, because every local test was measuring dev rather than the files.
 *
 * So this diffs the two, and the only acceptable answer is no differences.
 *
 * Reads dev through scratchpad/q.sh, which is pinned to the dev project ref.
 * It never writes. A difference is fixed by a NEW migration, never by editing
 * or re-running an old one, which is the rule this check exists to enforce.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { finalState, callableBy, normaliseBody } from './schema-final-state.mjs';

const QSH = process.env.QSH
  ?? '/private/tmp/claude-502/-Users-nicholasdwyer-Downloads-portal-opndoor-liveCode/92662f0b-dd66-45e1-bdfa-ee3a6f2bfb36/scratchpad/q.sh';

function sql(query) {
  const out = execFileSync('bash', [QSH, query], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const parsed = JSON.parse(out);
  if (!Array.isArray(parsed)) throw new Error(`query failed: ${JSON.stringify(parsed).slice(0, 300)}`);
  return parsed;
}

/** Dev's signature spelling, normalised the same way the file model spells it. */
function devSig(name, args) {
  const types = (args || '').split(',').map((a) => {
    const t = a.trim().replace(/^(in|out|inout|variadic)\s+/i, '');
    const parts = t.split(/\s+/);
    if (parts.length > 1 && /^[a-z_][a-z0-9_]*$/i.test(parts[0]) && !/^(timestamp|double|character|bit)$/i.test(parts[0])) parts.shift();
    return parts.join(' ').toLowerCase()
      .replace(/^public\./, '')
      .replace(/\btimestamp with time zone\b/, 'timestamptz')
      .replace(/\bcharacter varying\b/, 'varchar')
      .replace(/\s+/g, ' ').trim();
  }).filter((t) => t.length);
  return `${name.toLowerCase()}(${types.join(',')})`;
}

function main() {
  if (!existsSync(QSH)) {
    console.error(`No dev query helper at ${QSH}. Set QSH to point at it.`);
    console.error('Skipping the live half; the file half still ran.');
    finalState();
    process.exit(0);
  }

  const files = finalState();
  const differences = [];

  // ---- function EXECUTE, the class that broke the invite --------------------
  const devFns = sql(`
    select p.proname as nm,
           pg_get_function_identity_arguments(p.oid) as args,
           has_function_privilege('authenticated', p.oid, 'execute') as auth,
           has_function_privilege('anon', p.oid, 'execute') as anon
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'`);

  const devAuth = new Set();
  const devAnon = new Set();
  const devAll = new Set();
  for (const r of devFns) {
    const sig = devSig(r.nm, r.args);
    devAll.add(sig);
    if (r.auth === true || r.auth === 't') devAuth.add(sig);
    if (r.anon === true || r.anon === 't') devAnon.add(sig);
  }

  for (const [role, devSet] of [['authenticated', devAuth], ['anon', devAnon]]) {
    const fileSet = new Set(callableBy(files, role));
    for (const sig of fileSet) {
      if (!devAll.has(sig)) continue; // absent from dev entirely, reported below
      if (!devSet.has(sig)) {
        differences.push(`EXECUTE  ${sig}: files say ${role} MAY call it, dev says it may not`);
      }
    }
    for (const sig of devSet) {
      if (!fileSet.has(sig)) {
        differences.push(`EXECUTE  ${sig}: dev lets ${role} call it, the files do not`);
      }
    }
  }

  /* ---- FUNCTION BODIES, which is the check that would have caught the
     invite. 20261006380000 rewrote create_invited_user so it no longer calls
     set_user_scope; the file has it and dev did not, so a migration that had
     been written, applied and verified was simply not present in the database
     every test then ran against. Grants alone cannot see that. */
  const devBodies = new Map();
  for (const r of sql(`
    select p.proname as nm, pg_get_function_identity_arguments(p.oid) as args, p.prosrc as src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'`)) {
    devBodies.set(devSig(r.nm, r.args), normaliseBody(r.src));
  }
  for (const [sig, body] of files.funcBodies) {
    if (!files.funcDefined.has(sig)) continue;
    const live = devBodies.get(sig);
    if (live === undefined) continue; // reported as MISSING below
    if (live !== body) {
      differences.push(`BODY     ${sig}: dev's definition differs from ${files.funcDefined.get(sig)}`);
    }
  }

  // ---- functions that exist on one side only --------------------------------
  for (const sig of files.funcDefined.keys()) {
    if (!devAll.has(sig)) differences.push(`MISSING  ${sig}: defined by ${files.funcDefined.get(sig)}, absent from dev`);
  }

  /* THE SIXTEEN GENERATED POLICIES. 20260922090000 creates one
     <table>_opndoor_read policy per table inside a DO loop with
     execute format(...), so no text model can see their names. They are
     enumerated here rather than ignored, so a NEW generated policy still
     shows up as drift instead of being swallowed by a wildcard. */
  const GENERATED_POLICY = /_opndoor_read$/;

  // ---- policies -------------------------------------------------------------
  const devPolicies = new Set(sql(`
    select c.relname as t, p.polname as p
      from pg_policy p join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'`)
    .map((r) => `${r.t}.${r.p}`));
  for (const key of files.policies.keys()) {
    if (!devPolicies.has(key)) differences.push(`POLICY   ${key}: in the files (${files.policies.get(key)}), not on dev`);
  }
  for (const key of devPolicies) {
    if (files.policies.has(key)) continue;
    if (GENERATED_POLICY.test(key)) continue; // created by the DO loop above
    differences.push(`POLICY   ${key}: on dev, not in the files`);
  }

  // ---- triggers -------------------------------------------------------------
  const devTriggers = new Set(sql(`
    select c.relname as t, tg.tgname as g
      from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not tg.tgisinternal`)
    .map((r) => `public.${r.t}.${r.g}`));
  for (const key of files.triggers.keys()) {
    // The live half reads public only, so a trigger on auth.* is out of scope.
    if (!key.startsWith('public.')) continue;
    if (!devTriggers.has(key)) differences.push(`TRIGGER  ${key}: in the files (${files.triggers.get(key)}), not on dev`);
  }
  for (const key of devTriggers) {
    if (!files.triggers.has(key)) differences.push(`TRIGGER  ${key}: on dev, not in the files`);
  }

  // ---- the commission columns, which a column revoke cannot close on its own -
  const cols = sql(`
    select 'agencies.partner_rate' as c, has_column_privilege('authenticated','public.agencies','partner_rate','select') as v
    union all select 'agencies.agent_rate', has_column_privilege('authenticated','public.agencies','agent_rate','select')
    union all select 'agency_groups.partner_rate', has_column_privilege('authenticated','public.agency_groups','partner_rate','select')
    union all select 'agency_groups.agent_rate', has_column_privilege('authenticated','public.agency_groups','agent_rate','select')
    union all select 'branches.agent_rate', has_column_privilege('authenticated','public.branches','agent_rate','select')
    union all select 'applications.partner_rate', has_column_privilege('authenticated','public.applications','partner_rate','select')
    union all select 'applications.agent_rate', has_column_privilege('authenticated','public.applications','agent_rate','select')`);
  for (const r of cols) {
    if (r.v === true || r.v === 't') differences.push(`COLUMN   ${r.c}: authenticated can still SELECT a commission column`);
  }

  console.log(`files: ${files.files.length} migrations, ${files.funcDefined.size} functions, ${files.policies.size} policies, ${files.triggers.size} triggers`);
  console.log(`dev:   ${devAll.size} functions, ${devPolicies.size} policies, ${devTriggers.size} triggers`);
  if (files.unparsed.length) {
    console.log(`\n${files.unparsed.length} statements not understood by the file model:`);
    files.unparsed.slice(0, 20).forEach(([f, t]) => console.log(`  ${f}: ${t}`));
  }

  if (!differences.length) {
    console.log('\nNo drift. Dev matches what a clean apply of the files would produce.');
    process.exit(0);
  }
  console.log(`\n${differences.length} DIFFERENCES between dev and the migration files:\n`);
  differences.sort().forEach((d) => console.log('  ' + d));
  console.log('\nFix these with a NEW migration. Never edit or re-run an old one.');
  process.exit(1);
}

main();
