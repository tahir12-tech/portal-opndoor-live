/* Pull the LAST definition of a function out of the migration files.
 *
 * Used to write a corrective migration that makes dev match the files without
 * re-running an old migration and without retyping a body from memory, which
 * is how admin_update_user_role lost its superadmin handling once already.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'supabase', 'migrations');
const wanted = process.argv.slice(2);
if (!wanted.length) { console.error('usage: extract-latest-definition.mjs <fn> [<fn> ...]'); process.exit(2); }

const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const found = new Map();

for (const file of files) {
  const sql = readFileSync(join(DIR, file), 'utf8');
  for (const name of wanted) {
    const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+(?:public\\.)?${name}\\s*\\(`, 'gi');
    let m;
    while ((m = re.exec(sql)) !== null) {
      // From the CREATE to the end of its dollar-quoted body plus the semicolon.
      const from = m.index;
      const tag = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(from));
      if (!tag) continue;
      const bodyStart = from + tag.index + tag[0].length;
      const close = sql.indexOf(tag[0], bodyStart);
      if (close === -1) continue;
      let end = close + tag[0].length;
      while (end < sql.length && /\s/.test(sql[end])) end += 1;
      if (sql[end] === ';') end += 1;
      found.set(name, { file, text: sql.slice(from, end) });
    }
  }
}

for (const name of wanted) {
  const hit = found.get(name);
  if (!hit) { console.error(`-- NOT FOUND: ${name}`); continue; }
  console.log(`-- ${name}, as ${hit.file} defines it`);
  console.log(hit.text.trim());
  console.log();
}
