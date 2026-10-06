/* =====================================================================
   Generate the client's non-production project list from the Stripe guard.

   supabase/functions/_shared/stripeMode.ts is the source of truth for which
   projects are non-production. It has to be: it is what decides whether a live
   Stripe key is required, so it is already load bearing for real money.

   The client cannot import it. tsconfig.app.json includes only `src`, and that
   file is Deno code using Deno.env. So the list is extracted here instead of
   being retyped, which is the whole point: a second hand-maintained copy would
   drift, and the failure mode is a portal showing "Sandbox" while pointed at
   live.

   Run: node scripts/generate-environment.mjs
   ===================================================================== */
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'supabase/functions/_shared/stripeMode.ts';
const OUT = 'src/config/environment.generated.ts';

const src = readFileSync(SRC, 'utf8');
const block = src.match(/NON_PRODUCTION_REFS\s*=\s*new Set<string>\(\[([\s\S]*?)\]\)/);
if (!block) {
  console.error(`REFUSING to write: could not find NON_PRODUCTION_REFS in ${SRC}.`);
  console.error('The guard has been restructured. Update this script rather than hand-writing the list.');
  process.exit(1);
}

const refs = [...block[1].matchAll(/["']([a-z]{20})["']/g)].map((m) => m[1]);
if (!refs.length) {
  console.error(`REFUSING to write: NON_PRODUCTION_REFS in ${SRC} parsed to zero refs.`);
  console.error('An empty list would mark every environment live, which is the safe direction but almost certainly wrong.');
  process.exit(1);
}

writeFileSync(OUT, `/* GENERATED FILE. Do not edit.
   Source: ${SRC} (NON_PRODUCTION_REFS)
   Regenerate: node scripts/generate-environment.mjs

   The same list the Stripe key guard uses, so the environment banner and the
   requirement for a live Stripe key can never disagree about which project is
   production. */
export const NON_PRODUCTION_REFS: readonly string[] = ${JSON.stringify(refs)};
`);
console.log(`  wrote ${OUT}: ${refs.length} non-production ref(s): ${refs.join(', ')}`);
