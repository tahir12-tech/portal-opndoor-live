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

const SPEC   = 'PARTNER-DOCS.md';
const OUT    = 'src/pages/DevCentre/partnerDocs.generated.ts';
const CONFIG = 'src/config/partnerApi.ts';

/* ---------------------------------------------------------------------
   The base URL is configured in one place and rendered here, rather than
   living as a literal in the markdown that somebody has to remember to
   update. PARTNER-API.md keeps the canonical URL written out in full so it
   stays readable to a human; this rewrites it to whatever is configured.

   Reading the .ts file with a regex rather than importing it, for the same
   reason generate-environment.mjs does: this is a plain node script with no
   TypeScript loader, and the alternative is a build dependency to read one
   string.
   --------------------------------------------------------------------- */
function literal(src, name) {
  // Requires an http(s) URL specifically. Matching any quoted string instead
  // picked up the empty string inside `.replace(/\/+$/, '')` on the
  // PARTNER_API_BASE_URL declaration and silently produced a blank base.
  const m = new RegExp(name + "[\\s\\S]{0,240}?'(https?://[^']+)'").exec(src);
  return m ? m[1] : null;
}

const cfg = readFileSync(CONFIG, 'utf8');
const CANONICAL = literal(cfg, 'PARTNER_API_CANONICAL_BASE');
const CONFIGURED = (process.env.VITE_PARTNER_API_BASE_URL || literal(cfg, 'PARTNER_API_BASE_URL') || '').replace(/\/+$/, '');

if (!CANONICAL || !CONFIGURED) {
  console.error(`REFUSING to write: could not read the base URL from ${CONFIG}.`);
  process.exit(1);
}

/* WHY THERE IS NO LONGER AN ALLOWLIST OF SECTIONS.
   The source used to be PARTNER-API.md, the internal design record, and the
   allowlist was what kept the rest of it out. That was the wrong shape: every
   partner-facing section still carried migration citations, internal function
   names and drafting history, so the allowlist chose WHICH internal document to
   publish rather than whether to publish one.
   The source is now PARTNER-DOCS.md, which is partner-facing in its entirety, so
   every section ships and a new one needs no registration. The refusal rules
   below stay as a backstop against something internal being pasted in. */

/** Anything matching these must never reach a partner. The generator REFUSES to
    write when one survives, rather than stripping the line and shipping the rest:
    a rule that silently deletes content is a rule nobody notices is wrong. */
const INTERNAL = [
  // Repo and infrastructure
  [/DEFECTS\.md|REGRESSION\.md|HANDOVER\.md|PARTNER-API\.md/i, 'internal document reference'],
  [/supabase|postgres|postgrest|vercel|cloudflare|deno|edge function/i, 'hosting or infrastructure detail'],
  [/\bsrc\/|supabase\/|migrations?\//i, 'file path'],
  [/\d{14}_|\.sql\b|index\.ts|\.tsx\b/i, 'migration or source filename'],
  [/:\d{1,4}(?:-\d{1,4})?\)/, 'line citation'],

  // Internal identifiers
  [/\bpublic\.[a-z_]+/i, 'schema-qualified identifier'],
  [/referral_field_errors|create_referral|apply_stripe|partner_api_\w+|activity_log|guarantee_ref_seq/i,
   'internal table or function name'],
  [/\breferencing_mode\b|pre_referenced_\w+|opndoor_referenced/i, 'internal configuration vocabulary'],

  // Internal status values. The partner vocabulary is published; the stored
  // values are ours, and publishing the mapping publishes both.
  [/stored status|internal status|`deed`\s*\||\|\s*`expired`\s*\|/i, 'internal status value or mapping'],

  // Roadmap and drafting history
  [/not yet built|not built yet|does not exist yet|roadmap|needs the .* status|coming soon/i, 'roadmap note'],
  // Narrowed from a bare /previously/, which tripped on ordinary prose
  // ("whatever you previously believed"). The rule is meant to catch the
  // DOCUMENT talking about its own past, not the reader's. A rule that fires on
  // legitimate wording gets loosened by whoever hits it next, so it is better to
  // aim it properly than to leave it broad and be overridden later.
  [/earlier draft|first draft|used to (be|say|read)|an earlier version|was added before|in the original (spec|design)|we previously|this previously/i,
   'drafting history'],

  // Our own weaknesses
  [/replayable|no timestamp|constant.time comparison is not|uses ===/i, 'disclosure of an internal weakness'],

  // Cross-references that do not resolve in the rendered output
  [/\bsee section \d|\bsection \d+(\.\d+)?\b/i, 'numbered cross-reference'],
];

/** The first rule a string trips, or null. */
function tripped(text) {
  for (const [re, label] of INTERNAL) {
    const m = re.exec(text);
    if (m) return { label, sample: m[0] };
  }
  return null;
}

function sanitise(md) {
  return md
    // Configured base URL first, so a partner never reads a host we cannot change.
    .split(CANONICAL).join(CONFIGURED)
    .replace(/<!--[\s\S]*?-->/g, '')                        // maintainer notes never ship
    .replace(/\[([^\]]+)\]\((?!https?:)[^)]+\)/g, '$1')   // keep link text, drop repo paths
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const lines = readFileSync(SPEC, 'utf8').split('\n');
const sections = [];

// Every `##` section, in document order. Sub-headings stay inside their parent
// so the panel's contents list matches the document's own shape.
for (let i = 0; i < lines.length; i++) {
  if (!/^##\s/.test(lines[i])) continue;
  const title = lines[i].replace(/^##\s+/, '').trim();

  let end = lines.length;
  for (let j = i + 1; j < lines.length; j++) {
    if (/^##\s/.test(lines[j])) { end = j; break; }
  }

  const body = sanitise(lines.slice(i + 1, end).join('\n'));
  if (body) sections.push({ id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title, body });
}

if (!sections.length) {
  console.error(`REFUSING to write: no sections found in ${SPEC}.`);
  process.exit(1);
}

// Fail loudly rather than shipping a leak. Checked per section AND on the title,
// and it reports what tripped so the fix is obvious rather than a hunt.
const leaked = [];
for (const s of sections) {
  const hit = tripped(s.body) ?? tripped(s.title);
  if (hit) leaked.push({ title: s.title, ...hit });
}
if (leaked.length) {
  console.error('REFUSING to write. Internal detail survived sanitising:\n');
  for (const l of leaked) {
    console.error(`  section: ${l.title}`);
    console.error(`  problem: ${l.label}`);
    console.error(`  matched: ${JSON.stringify(l.sample)}\n`);
  }
  console.error('Fix it in the source, not by loosening the rule.');
  process.exit(1);
}

console.log(`  base URL: ${CONFIGURED}${CONFIGURED === CANONICAL ? '' : ` (overriding ${CANONICAL})`}`);

writeFileSync(OUT, `/* GENERATED FILE. Do not edit.
   Source: ${SPEC}
   Regenerate: node scripts/generate-partner-docs.mjs

   The source is partner-facing in its entirety. The internal design record is a
   different document and is deliberately NOT the source: importing it raw would
   ship the whole internal specification to every browser, and filtering at
   render time filters what renders, not what ships. */
export interface DocSection { id: string; title: string; body: string }

export const PARTNER_DOCS: DocSection[] = ${JSON.stringify(sections, null, 2)};
`);

console.log(`  wrote ${OUT}: ${sections.length} sections, ${sections.reduce((n, s) => n + s.body.length, 0)} chars`);
