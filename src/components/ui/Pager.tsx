/* =====================================================================
   Pager — a compact, accessible pagination control for long lists.
   Renders "Showing X–Y of N" plus Previous / Next. Returns null when the
   whole set fits on one page, so short lists look exactly as before.
   Page numbers are 1-based.
   ===================================================================== */
import { Icon } from '@/components/ui/Icon';

interface PagerProps {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  /** Noun for the range label, e.g. "applications" or "events". */
  noun?: string;
  /** How many pages there REALLY are, when they are not uniform.
      The applications list never splits a joint tenancy across a boundary, so a
      page may run a row or two over pageSize and the count cannot be got by
      dividing — done that way, the last page becomes unreachable and its rows
      simply vanish from the screen. Defaults to the division, so every other
      caller is unchanged. */
  pageCount?: number;
  /** The 1-based range actually on this page, for the same reason. */
  range?: [number, number];
}

export function Pager({ page, pageSize, total, onPage, noun = 'rows', pageCount, range }: PagerProps) {
  const pages = pageCount ?? Math.ceil(total / pageSize);
  // Unchanged for a uniform pager: ceil(total / pageSize) <= 1 is exactly
  // total <= pageSize.
  if (pages <= 1) return null;
  const current = Math.min(Math.max(1, page), pages);
  const from = range ? range[0] : (current - 1) * pageSize + 1;
  const to = range ? range[1] : Math.min(current * pageSize, total);

  return (
    <div className="pager">
      <div className="pager__info">
        Showing <b>{from.toLocaleString('en-GB')}–{to.toLocaleString('en-GB')}</b> of{' '}
        <b>{total.toLocaleString('en-GB')}</b> {noun}
      </div>
      <div className="pager__nav">
        <button
          type="button"
          className="pager__btn"
          onClick={() => onPage(current - 1)}
          disabled={current <= 1}
          aria-label="Previous page"
        >
          <Icon name="arrowLeft" size={16} /> Previous
        </button>
        <span className="pager__count">Page {current} of {pages}</span>
        <button
          type="button"
          className="pager__btn"
          onClick={() => onPage(current + 1)}
          disabled={current >= pages}
          aria-label="Next page"
        >
          Next <Icon name="arrowRight" size={16} />
        </button>
      </div>
    </div>
  );
}
