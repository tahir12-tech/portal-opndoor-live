/* =====================================================================
   API documentation for the Dev Centre.

   The content comes from partnerDocs.generated.ts, which is produced from
   PARTNER-API.md by scripts/generate-partner-docs.mjs. The specification is the
   source of truth, so the docs cannot be written twice and drift.

   IT IS A BUILD STEP RATHER THAN A RAW IMPORT ON PURPOSE. Importing the spec
   with ?raw inlines the WHOLE file into the bundle, so filtering it in the
   component filters what is rendered but not what ships: the entire internal
   document, including defect references and open questions, would be readable in
   devtools by any partner developer. Extracting at build time means only the
   sanitised subset is ever emitted.

   The trade is that a spec change needs the generator re-run. A stale generated
   file shows up in a diff; a leaked specification does not show up at all.

   This file now only renders. Extraction and sanitising live in the generator.
   ===================================================================== */
import { PARTNER_DOCS, type DocSection } from './partnerDocs.generated';

export type { DocSection };

export function partnerDocSections(): DocSection[] {
  return PARTNER_DOCS;
}

/** False when the generator has never been run, so the panel can say so. */
export const specAvailable = PARTNER_DOCS.length > 0;

// ---------------------------------------------------------------------
// A minimal markdown renderer covering what the spec uses: headings, fenced
// code, tables, lists, blockquotes, paragraphs, and inline code/bold/links.
// ---------------------------------------------------------------------
export type Block =
  | { kind: 'h'; level: number; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'p'; text: string };

export function parseBlocks(md: string): Block[] {
  const lines = md.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    if (line.startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { buf.push(lines[i]); i++; }
      i++; // closing fence
      blocks.push({ kind: 'code', text: buf.join('\n') });
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { blocks.push({ kind: 'h', level: h[1].length, text: h[2] }); i++; continue; }

    // A table needs a header row and a separator row of dashes.
    if (line.trim().startsWith('|') && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(cells(lines[i])); i++; }
      blocks.push({ kind: 'table', head, rows });
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
      blocks.push({ kind: 'ul', items });
      continue;
    }

    // Paragraph: run to the next blank line, joining wrapped lines.
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith('```') && !/^#{1,6}\s/.test(lines[i])
           && !lines[i].trim().startsWith('|') && !/^\s*[-*]\s+/.test(lines[i])) {
      buf.push(lines[i].replace(/^>\s?/, '')); i++;
    }
    if (buf.length) blocks.push({ kind: 'p', text: buf.join(' ') });
  }

  return blocks;
}
