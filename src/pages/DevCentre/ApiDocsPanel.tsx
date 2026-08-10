/* =====================================================================
   The API documentation panel, rendered from PARTNER-API.md.

   Named ApiDocsPanel, not ApiDocs, because macOS and Windows filesystems are
   case-insensitive: ApiDocs.tsx and apiDocs.ts are the SAME FILE there, and
   TypeScript rejects the pair outright. Worth knowing before naming a component
   after its data module.
   Extraction and sanitising live in apiDocs.ts; this is only presentation.
   ===================================================================== */
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { parseBlocks, partnerDocSections, specAvailable, type Block } from './apiDocs';

function Inline({ text }: { text: string }) {
  // Inline code and bold, the only inline markup the spec uses in these sections.
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('`') && p.endsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>;
        if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === 'code') return <pre key={i} className="devcode"><code>{b.text}</code></pre>;
        if (b.kind === 'h') return <h4 key={i} className="devdoc__h">{b.text}</h4>;
        if (b.kind === 'ul') return <ul key={i} className="devdoc__ul">{b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</ul>;
        if (b.kind === 'table') return (
          <div key={i} className="devdoc__tablewrap">
            <table className="dt">
              <thead><tr>{b.head.map((h, j) => <th key={j}><Inline text={h} /></th>)}</tr></thead>
              <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}><Inline text={c} /></td>)}</tr>)}</tbody>
            </table>
          </div>
        );
        return <p key={i}><Inline text={b.text} /></p>;
      })}
    </>
  );
}

export function ApiDocsPanel() {
  const sections = specAvailable ? partnerDocSections() : [];

  if (!sections.length) {
    return (
      <Card>
        <CardHead title="API documentation" sub="Generated from the specification" />
        <CardBody>
        <p className="soft">
          The documentation could not be generated from the specification. That means the section headings
          it looks for have been renamed, so the extraction list needs updating rather than the docs
          being rewritten here.
        </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHead
        title="API documentation"
        sub="Generated from the specification, so it cannot drift from what is built"
      />
      <CardBody>
      <div className="devdoc">
        {sections.map((s) => (
          <section key={s.id} className="devdoc__section">
            <h3 className="devdoc__title">{s.title}</h3>
            <Blocks blocks={parseBlocks(s.body)} />
          </section>
        ))}
      </div>
      </CardBody>
    </Card>
  );
}
