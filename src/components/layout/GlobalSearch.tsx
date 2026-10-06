/* =====================================================================
   Global search — the top-bar search, now functional. Matches the signed-in,
   RLS-scoped data the placeholder claims: applications (by tenant, guarantee
   reference or property) and branches. Selecting a result navigates to it.
   ===================================================================== */
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { allSummaries, getAgencies } from '@/data';
import { useSession } from '@/session/SessionContext';
import { Icon } from '@/components/ui/Icon';
import { useOnClickOutside } from '@/hooks/useOnClickOutside';
import './GlobalSearch.css';

interface Result { kind: 'app' | 'branch'; label: string; sub: string; to: string; }

export function GlobalSearch() {
  const navigate = useNavigate();
  const { partnerScope } = useSession();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useOnClickOutside(box, () => setOpen(false), open);

  const results = useMemo<Result[]>(() => {
    const term = q.trim().toLowerCase();
    if (term.length < 2) return [];
    /* READ THROUGH A GUARD, EVEN THOUGH THE TYPES SAY STRING.
       (bw): propStr handed back a null `prop` and this was the one
       reader that called a string method on it, so one bad row among
       49 took the entire application down from the header. The
       boundary is fixed in hydrate, which is the real repair; this
       stays because allSummaries() is the WHOLE BOOK, unscoped and
       unfiltered, so any row anywhere that ever arrives malformed
       lands here first, during render, with nothing to catch it. A
       search box is not worth a white screen. */
    const has = (v: string | null | undefined) => (v ?? '').toLowerCase().includes(term);
    const apps: Result[] = allSummaries()
      .filter((a) => has(a.tenant) || has(a.ref) || has(a.prop))
      .slice(0, 6)
      .map((a) => ({ kind: 'app', label: a.tenant, sub: `${a.ref} · ${a.prop}`, to: `/applications/${encodeURIComponent(a.ref)}` }));
    const branches: Result[] = [];
    for (const ag of getAgencies(partnerScope)) {
      // Same reason: an agency that arrives without a branches array
      // would throw in the for-of, in render, from the header.
      for (const b of ag.branches ?? []) {
        if (has(b.name) || has(ag.name)) {
          branches.push({ kind: 'branch', label: b.name, sub: ag.name, to: '/agencies' });
        }
        if (branches.length >= 4) break;
      }
      if (branches.length >= 4) break;
    }
    return [...apps, ...branches];
  }, [q, partnerScope]);

  const go = (to: string) => { setOpen(false); setQ(''); navigate(to); };
  const term = q.trim();

  return (
    <div className="topbar__search gsearch" ref={box}>
      <Icon name="search" />
      <input
        type="text"
        placeholder="Search tenants, references, branches"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
          if (e.key === 'Enter' && results[0]) go(results[0].to);
        }}
      />
      {open && term.length >= 2 && (
        <div className="gsearch__pop">
          {results.length === 0 ? (
            <div className="gsearch__empty">No matches for “{term}”.</div>
          ) : (
            results.map((r, i) => (
              <button key={i} className="gsearch__item" onMouseDown={(e) => { e.preventDefault(); go(r.to); }}>
                <Icon name={r.kind === 'app' ? 'file' : 'building'} />
                <span className="gsearch__label">{r.label}</span>
                <span className="gsearch__sub">{r.sub}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
