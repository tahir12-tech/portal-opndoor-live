/* =====================================================================
   TypeAhead — a single select-or-add field (input + dropdown of options).
   Options are built by the parent (so it controls matching, "create new"
   rows and highlighting). Selection uses mousedown so it fires before the
   input blurs. The AgentBranchPicker composes two of these.
   ===================================================================== */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useOnClickOutside } from '@/hooks/useOnClickOutside';

export interface TypeAheadOption {
  id: string;
  icon: ReactNode;
  main: ReactNode;
  sub?: string;
  isNew?: boolean;
  onSelect: () => void;
}

export interface TypeAheadProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
  options: TypeAheadOption[];
  placeholder?: string;
  disabled?: boolean;
  emptyText?: string;
  /** Names the control for a screen reader where no visible <label> does. */
  ariaLabel?: string;
  /** Focus on mount, which also opens the list. For a TypeAhead that is
      revealed by a button press: the press was the intent to search, and
      making the reader click a second time into the box would be a
      dropdown that does not drop down. */
  autoFocus?: boolean;
}

/** Highlight the matched substring using the .typeahead__match style. */
export function highlightMatch(name: string, query: string): ReactNode {
  const q = query.trim().toLowerCase();
  if (!q) return name;
  const i = name.toLowerCase().indexOf(q);
  if (i === -1) return name;
  return (
    <>
      {name.slice(0, i)}
      <span className="typeahead__match">{name.slice(i, i + q.length)}</span>
      {name.slice(i + q.length)}
    </>
  );
}

export function TypeAhead({
  id, value, onChange, onEnter, options, placeholder, disabled,
  emptyText = 'No matches', ariaLabel, autoFocus,
}: TypeAheadProps) {
  const [open, setOpen] = useState(false);
  /* THE HIGHLIGHTED ROW. Reset whenever the option list changes, because the
     row that was second is not the same row once the query narrows. */
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const listId = useId();
  useOnClickOutside(wrap, () => setOpen(false), open);
  useEffect(() => { setActive(0); }, [options]);

  const optId = (i: number) => `${listId}-o${i}`;
  const choose = (i: number) => {
    const o = options[i];
    if (!o) return false;
    o.onSelect();
    setOpen(false);
    return true;
  };

  return (
    <div className="typeahead" ref={wrap}>
      {/* A CONTROL THAT REPLACES A NATIVE SELECT MUST NOT BE LESS OPERABLE
          THAN THE SELECT IT REPLACED. Arrow keys move, Enter chooses, Escape
          closes without choosing, and the combobox roles tell a screen reader
          which row is current. Added here, in the one component, before two
          more screens compose it. */}
      <input
        id={id}
        type="text"
        autoComplete="off"
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options.length ? optId(active) : undefined}
        aria-label={ariaLabel}
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!open) { setOpen(true); return; }
            // Clamped, not wrapping: a list that loops hides its own end.
            setActive((i) => Math.min(i + 1, Math.max(options.length - 1, 0)));
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
            return;
          }
          if (e.key === 'Escape') {
            if (open) { e.preventDefault(); setOpen(false); }
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            if (open && choose(active)) return;
            onEnter?.();
            setOpen(false);
          }
        }}
      />
      {open && (
        <div className="typeahead__menu" id={listId} role="listbox">
          {options.length === 0 ? (
            <div className="typeahead__opt">
              <div className="typeahead__opt-sub">{emptyText}</div>
            </div>
          ) : (
            options.map((o, i) => (
              <div
                key={o.id}
                id={optId(i)}
                role="option"
                aria-selected={i === active}
                className={`typeahead__opt${o.isNew ? ' typeahead__opt--new' : ''}${i === active ? ' typeahead__opt--active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  o.onSelect();
                  setOpen(false);
                }}
              >
                <span className="typeahead__opt-ic">{o.icon}</span>
                <div>
                  <div className="typeahead__opt-main">{o.main}</div>
                  {o.sub != null && <div className="typeahead__opt-sub">{o.sub}</div>}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
