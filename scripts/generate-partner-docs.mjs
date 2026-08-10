/* =====================================================================
   Generate the partner-facing API documentation from PARTNER-API.md.

   WHY THIS IS A BUILD STEP AND NOT A RUNTIME IMPORT. The obvious approach is
   `import spec from '../PARTNER-API.md?raw'` and filter it in the component.
   That filters what is RENDERED, not what is SHIPPED: Vite inlines the whole
   file into the bundle, so the entire internal specification, including its
   references to DEFECTS.md, its migration citations and its unresolved open
   questions, is readable in devtools by any partner developer.

   Extracting here means only the sanitised subset is ever emitted.

   Run: node scripts/generate-partner-docs.mjs
   The output is committed, so a spec change needs this re-run. That is a real
   drift risk and a deliberate trade: a stale generated file is visible in a diff,
   whereas leaking the whole spec is not visible at all.
   ===================================================================== */
import { readFileSync, writeFileSync } from 'node:fs';

const SPEC = 'PARTNER-API.md';
const OUT  = 'src/pages/DevCentre/partnerDocs.generated.ts';

/** Sections shown to partners, by exact heading text. A new section does NOT
    appear automatically: somebody has to decide it is partner-facing. */
const PARTNER_FACING = [
  'The partner-facing status vocabulary',
  'The real URL, and how it is versioned',
  'Reading applications',
  '4.2 Key format and hashing',
  '4.4 Identical failures',
  '4.5 Scopes',
  '6.1 Payload',
  '9.4 The field codes, as built',
  '13.4 Signing',
  '13.5 Events',
  '13.6 Status is not monotonic',
  '14. Error contract',
];

/** Anything matching these must never reach a partner. */
const INTERNAL = /DEFECTS\.md|REGRESSION\.md|HANDOVER\.md|supabase\/|src\/|migrations?\/|open question|\d{14}_/i;

function sanitise(md) {
  return md
    .replace(/\[([^\]]+)\]\((?!https?:)[^)]+\)/g, '$1')   // keep link text, drop repo paths
    .split('\n')
    .filter((l) => !INTERNAL.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const lines = readFileSync(SPEC, 'utf8').split('\n');
const sections = [];

for (const wanted of PARTNER_FACING) {
  const start = lines.findIndex((l) => /^#{2,4}\s/.test(l) && l.replace(/^#{2,4}\s+/, '').trim() === wanted);
  if (start === -1) { console.warn(`  ! section not found, skipping: ${wanted}`); continue; }
  const level = (lines[start].match(/^#+/) ?? ['##'])[0].length;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s/);
    if (m && m[1].length <= level) { end = i; break; }
  }

  const body = sanitise(lines.slice(start + 1, end).join('\n'));
  if (body) {
    sections.push({ id: wanted.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title: wanted.replace(/^[\d.]+\s*/, ''), body });
  }
}

// Fail loudly rather than shipping a leak.
const leaked = sections.filter((s) => INTERNAL.test(s.body));
if (leaked.length) {
  console.error('REFUSING to write: internal markers survived sanitising in:', leaked.map((s) => s.title));
  process.exit(1);
}

writeFileSync(OUT, `/* GENERATED FILE. Do not edit.
   Source: ${SPEC}
   Regenerate: node scripts/generate-partner-docs.mjs

   Only the partner-facing sections are extracted, and repo paths, defect
   references and open questions are stripped. The full specification is NOT
   bundled: importing it raw would ship the whole internal document to every
   browser, where filtering at render time does not help. */
export interface DocSection { id: string; title: string; body: string }

export const PARTNER_DOCS: DocSection[] = ${JSON.stringify(sections, null, 2)};
`);

console.log(`  wrote ${OUT}: ${sections.length} sections, ${sections.reduce((n, s) => n + s.body.length, 0)} chars`);
