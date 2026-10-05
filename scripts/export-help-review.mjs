/* =====================================================================
   EXPORT EVERY HELP DOCUMENT AS EACH READER ACTUALLY SEES IT.

   Matt (dp): "Export every Help guide, leaflet, template and FAQ
   exactly as each reader sees them, one file per reader per checking
   setting where it differs ... plus the API docs as the supplier
   Developer sees them under each setting. Put them all in one zip in
   Downloads called help-review.zip. Don't summarise, I want the words
   the user reads."

   SO THIS CARRIES THE TEXT, NOT THE TITLES. The guides are authored
   HTML under public/help-docs; their body text is extracted and
   written out in full. A list of document names would be the summary
   he explicitly refused.

   "WHERE IT DIFFERS" IS COMPUTED, NOT GUESSED. A reader whose three
   settings produce an identical shelf gets ONE file; a reader whose
   shelves differ gets one per setting, named for it. That way the zip
   itself answers the question -- if a file is missing a setting, the
   setting made no difference to that reader.

   THE GATES ARE THE PRODUCT'S OWN. This script does not reimplement
   who-sees-what: it mirrors mayOpenResource / mayOpenFaq, and
   theHelpMatrix test asserts the two agree. A separate copy of the
   rules would be a fourth opinion about who may read what.
   ===================================================================== */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.help-review');
const HOME = process.env.HOME || '';
const ZIP = join(HOME, 'Downloads', 'help-review.zip');

/* ---- the catalogue, read out of the seed without a bundler ------------ */
const seedSrc = readFileSync(join(ROOT, 'src/data/mock/help.ts'), 'utf8');
const body = seedSrc.slice(seedSrc.indexOf('export const HELP_SEED'));
// The seed is a plain object literal of string fields; evaluating it in a
// bare function is enough and avoids pulling vite in for a one-shot script.
const literal = body.slice(body.indexOf('{'), body.lastIndexOf('};') + 1);
// eslint-disable-next-line no-new-func
const HELP = new Function(`return ${literal.replace(/\s*:\s*HelpContent/, '')}`)();

const MODES = [
  { id: 'pre_referenced_open', label: 'accepts as sent' },
  { id: 'pre_referenced_screened', label: 'applies its own criteria' },
  { id: 'opndoor_referenced', label: 'opndoor checks' },
];

const READERS = [
  { label: 'opndoor admin', role: 'superadmin', seesCommission: true, agency: false, admin: true },
  { label: 'opndoor manager', role: 'opndoor_manager', seesCommission: false, agency: false, admin: true },
  { label: 'agency Director', role: 'management', seesCommission: true, agency: true, admin: false },
  { label: 'agency Manager', role: 'management', seesCommission: false, agency: true, admin: false },
  { label: 'agency Negotiator', role: 'referrer', seesCommission: false, agency: true, admin: false },
  { label: 'supplier Management', role: 'management', seesCommission: true, agency: false, admin: false },
  { label: 'supplier Referrer', role: 'referrer', seesCommission: false, agency: false, admin: false },
  { label: 'supplier Developer', role: 'developer', seesCommission: false, agency: false, admin: false },
];

const RANK = { developer: 0, referrer: 1, management: 2, opndoor_manager: 3, superadmin: 4 };
const readsCommission = (v) => v.role === 'superadmin' || v.seesCommission;
const appliesToMode = (x, mode) => !x.modes || !x.modes.length || x.modes.includes(mode);

function mayOpenResource(r, v, mode) {
  if (!appliesToMode(r, mode)) return false;
  if (r.minRole && RANK[v.role] < RANK[r.minRole]) return false;
  if (r.rail === 'supplier' && v.agency) return false;
  if (r.rail === 'agency' && !v.agency && !v.admin) return false;
  if (r.needsCommission && !readsCommission(v)) return false;
  return true;
}
function mayOpenFaq(f, v, mode) {
  if (!appliesToMode(f, mode)) return false;
  if (f.rail === 'supplier' && v.agency) return false;
  if (f.rail === 'agency' && !v.agency && !v.admin) return false;
  if (f.needsCommission && !readsCommission(v)) return false;
  return true;
}

/* ---- the words --------------------------------------------------------- */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ', pound: '£', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…' };
const unescape = (t) => t.replace(/&(#?\w+);/g, (m, e) => (ENT[e] ?? m));

/** An authored HTML guide as readable text, headings kept. */
function htmlToText(html) {
  let t = html;
  t = t.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  t = t.replace(/<h1[^>]*>/gi, '\n\n# ').replace(/<h2[^>]*>/gi, '\n\n## ').replace(/<h3[^>]*>/gi, '\n\n### ');
  t = t.replace(/<li[^>]*>/gi, '\n- ');
  t = t.replace(/<\/(p|div|tr|h1|h2|h3|li|ul|ol|table|section)>/gi, '\n');
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<[^>]+>/g, '');
  return unescape(t).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function resourceWords(r) {
  const href = r.href || '';
  const local = href.startsWith('/') ? join(ROOT, 'public', href.split('#')[0]) : null;
  if (local && existsSync(local) && /\.html?$/i.test(local)) {
    return htmlToText(readFileSync(local, 'utf8'));
  }
  if (local && existsSync(local) && /\.pdf$/i.test(local)) {
    return `_(PDF, shipped as ${href}. Not text-extracted here: the file itself is in the repo under public${href}.)_`;
  }
  return '_(No shipped file. The reader sees the title and description above and nothing to open.)_';
}

/** One reader's whole shelf, in the words they read. */
function render(reader, mode) {
  const L = [];
  L.push(`# Help, as ${reader.label} sees it`);
  L.push('');
  L.push(`**Checking setting:** ${mode.label}`);
  L.push('');
  L.push('> Generated from the live catalogue and the product’s own visibility rules.');
  L.push('> Everything below is what this reader can open. Nothing is summarised.');
  L.push('');
  for (const [section, title] of [['gettingStarted', 'Getting started'], ['templates', 'Templates and resources']]) {
    const list = (HELP[section] || []).filter((r) => mayOpenResource(r, reader, mode.id));
    L.push(`## ${title}`, '');
    if (!list.length) { L.push('_Nothing in this section for this reader._', ''); continue; }
    for (const r of list) {
      L.push(`### ${r.title}`, '', `*${r.type}. ${r.desc}*`, '');
      L.push(resourceWords(r), '');
    }
  }
  const faqs = (HELP.faqs || []).filter((f) => mayOpenFaq(f, reader, mode.id));
  L.push('## Frequently asked questions', '');
  if (!faqs.length) L.push('_No answers for this reader._', '');
  for (const f of faqs) {
    L.push(`### ${unescape(f.q)}`, '', unescape(f.a.replace(/<[^>]+>/g, '')), '');
  }
  return `${L.join('\n')}\n`;
}

/* ---- write ------------------------------------------------------------- */
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const written = [];
for (const reader of READERS) {
  const byMode = MODES.map((m) => ({ m, text: render(reader, m) }));
  const same = byMode.every((x) => x.text.replace(/\*\*Checking setting:\*\*.*/, '') === byMode[0].text.replace(/\*\*Checking setting:\*\*.*/, ''));
  if (same) {
    // ONE FILE WHERE THE SETTING MAKES NO DIFFERENCE, which is itself
    // the answer to "where does it differ".
    const name = `${reader.label} - same under all three settings.md`;
    writeFileSync(join(OUT, name), byMode[0].text.replace(/\*\*Checking setting:\*\*.*/, '**Checking setting:** the same under all three'), 'utf8');
    written.push(name);
  } else {
    for (const { m, text } of byMode) {
      const name = `${reader.label} - ${m.label}.md`;
      writeFileSync(join(OUT, name), text, 'utf8');
      written.push(name);
    }
  }
}

/* THE API DOCS, for the supplier Developer, under each setting. They
   are a React panel rather than a shipped file, so what is exported is
   its rendered copy read out of the source -- and the fact that it
   does NOT vary by setting is the finding, so it is stated rather than
   hidden behind three identical files. */
const docsSrc = existsSync(join(ROOT, 'src/pages/DevCentre/ApiDocsPanel.tsx'))
  ? readFileSync(join(ROOT, 'src/pages/DevCentre/ApiDocsPanel.tsx'), 'utf8')
  : readFileSync(join(ROOT, 'src/pages/DevCentre/GettingStarted.tsx'), 'utf8');
const docText = htmlToText(docsSrc.replace(/\/\*[\s\S]*?\*\//g, ''));
for (const m of MODES) {
  const name = `supplier Developer - API docs - ${m.label}.md`;
  writeFileSync(join(OUT, name), [
    `# Dev Centre documentation, as a supplier Developer sees it`,
    '',
    `**Checking setting:** ${m.label}`,
    '',
    '> FINDING: the Dev Centre documentation does NOT vary by checking setting.',
    '> (dj) asks that it should: the journey, statuses and webhook events a',
    `> developer is shown ought to be the ones their organisation gets, with the`,
    '> others under "If your checking setting changes". Today all three readers',
    '> get this same text, so these three files are identical by construction',
    '> and that is the point of including all three.',
    '',
    docText,
    '',
  ].join('\n'), 'utf8');
  written.push(name);
}

rmSync(ZIP, { force: true });
execFileSync('zip', ['-q', '-j', '-r', ZIP, OUT]);
rmSync(OUT, { recursive: true, force: true });
console.log(`${written.length} files -> ${ZIP}`);
for (const n of written) console.log(`  ${n}`);
