/* =====================================================================
   ONE CONTROL FOR "WHOSE BUSINESS AM I LOOKING AT".

   Q-06 item C: "replace the 'All partners' dropdown with a searchable picker
   (type to find any supplier, agency or group), with Everything, Suppliers,
   Agencies and Direct as quick choices at the top and recent selections
   remembered. Every tile, chart, export and statement on the page follows the
   selection. Same control for the Origin filter on Applications."

   And Matt, 2026-09-29: "Reporting and Applications share one remembered
   scope choice." So the two pages share the control AND the value; the value
   lives on the session as `scopeSel`.

   WHAT THIS COMPONENT IS NOT. It is not a partner selector. The thing it
   holds is an OriginScope, which can be a rail, an agency BY NAME across
   partners, or a group -- none of which `selectedPartner` can express,
   because that one mirrors the server's isolation rule and must stay a real
   partner slug. `partnerFor()` bridges them and `scopeFull` does the rest of
   the narrowing afterwards. Keeping those two apart is the whole design: a
   picker that wrote straight into the isolation scope would be a control that
   grants access.

   THE QUICK CHOICES STAY VISIBLE WHILE TYPING. They are how you get back, and
   a search box that hides the way back is a trap. Typing filters the parties
   below them only.

   =====================================================================
   IT IS A BUTTON THAT OPENS A PICKER, NOT A BOX THAT SITS THERE
   =====================================================================

   Matt, 2026-10-01: "The Origin filter box on League and Applications:
   style it to match the other filter buttons (like 'Period: All time'),
   reading 'Origin: Everything' with a dropdown arrow, opening the search
   and list when clicked. No bare text box."

   It used to render the search input itself, permanently, which put a
   plain rectangle in a row of pills: on Applications beside "Period: All
   time" and "Branch: All", and on League beside the same period control.
   At rest it now reads what every other filter in that row reads -- a
   label, the value in bold, a chevron -- and the search appears when it
   is asked for.

   THE PILL IS STYLED HERE, NOT BORROWED. It used to take the `fchip`
   class from Applications.css, which League does not load, so the same
   control was styled on one page and bare on the other. The look is the
   same; it is just owned by the component that needs it.
   ===================================================================== */
import { useRef, useState } from 'react';
import { useOnClickOutside } from '@/hooks/useOnClickOutside';
import { TypeAhead, highlightMatch, type TypeAheadOption } from './TypeAhead';
import { Icon } from './Icon';
import {
  ORIGIN_ALL, RAIL_AGENCY, RAIL_SUPPLIER, originLabelFor,
  type OriginOption, type OriginScope,
} from '@/data/origin';
import './ScopePicker.css';

/** The rails, which `originOptions` does not produce because no single row is
    "every agency". They are a fact about the estate, not about the book. */
const QUICK: OriginOption[] = [
  { value: ORIGIN_ALL, label: 'Everything', group: null },
  { value: RAIL_SUPPLIER, label: 'Suppliers', group: null },
  { value: RAIL_AGENCY, label: 'Agencies', group: null },
];

const iconFor = (v: OriginScope) =>
  v === ORIGIN_ALL ? 'dashboard'
    : v === RAIL_SUPPLIER || v.startsWith('partner:') ? 'partners'
    : v === RAIL_AGENCY || v.startsWith('agency:') || v.startsWith('group:') ? 'building'
    : 'home';

export function ScopePicker({
  value, onChange, options, recents = [], label = 'Origin', ariaLabel = 'Scope',
}: {
  value: OriginScope;
  onChange: (v: OriginScope) => void;
  /** From `originOptions(book, value)`: derived from the rows actually in the
      book, so the control never offers a choice that matches nothing. */
  options: OriginOption[];
  recents?: OriginScope[];
  label?: string;
  ariaLabel?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); setQuery(''); };
  useOnClickOutside(wrap, close, open);

  const byValue = new Map(options.map((o) => [o.value, o]));
  /* The quick choices the BOOK supports. Direct and Provider come from
     originOptions when rows of that kind exist; the two rails are always
     offered because an admin can always ask the question, and an empty answer
     is an answer. */
  const quick = [...QUICK, ...options.filter((o) => o.group === null && o.value !== ORIGIN_ALL)]
    .filter((o, i, a) => a.findIndex((x) => x.value === o.value) === i);

  const parties = options.filter((o) => o.group !== null && o.group !== 'Selected');
  const q = query.trim().toLowerCase();
  /* PARTIES ARE SEARCH RESULTS, NOT A LIST. Matt, 2026-09-30: "Show only
     the quick choices and recent selections until the user types;
     individual agencies and suppliers appear only as search results, so
     the list never grows endless."

     It used to show every party in the book the moment the box was
     focused. On a real estate that is hundreds of rows under three quick
     choices, and the quick choices are the ones almost every use wants. */
  const matches = q ? parties.filter((o) => o.label.toLowerCase().includes(q)) : [];

  /* AND NO DUPLICATE ENTRIES. A recent that is already a quick choice
     (Direct is both) would otherwise appear twice, once unlabelled and
     once under "Recent", which reads as two different things. */
  const quickValues = new Set(quick.map((o) => o.value));
  const recentOpts = q
    ? []
    : recents
      .filter((v) => !quickValues.has(v))
      .map((v) => byValue.get(v) ?? { value: v, label: originLabelFor(v), group: null } as OriginOption)
      .filter((o, i, a) => a.findIndex((x) => x.value === o.value) === i);

  const row = (o: OriginOption, section: string | null): TypeAheadOption => ({
    id: `${section ?? 'quick'}:${o.value}`,
    icon: <Icon name={iconFor(o.value) as 'dashboard'} />,
    main: highlightMatch(o.label, query),
    sub: section ?? undefined,
    onSelect: () => {
      onChange(o.value);
      close();
    },
  });

  const rows: TypeAheadOption[] = [
    ...quick.map((o) => row(o, null)),
    ...recentOpts.map((o) => row(o, 'Recent')),
    ...matches.map((o) => row(o, o.group)),
  ];

  /* THE BOX ALWAYS SHOWS WHAT IS ACTUALLY APPLIED, which is the first
     thing Matt asked for and the one the old fallback broke. A selection
     the BOOK does not contain -- an agency with nothing in the chosen
     period, a supplier whose rows are all refunded -- was not in
     `options` and not in `quick`, so the box read "Everything" over a
     narrowed list. `originLabelFor` can name any selection from the
     value alone, so there is no case left where the control and the list
     disagree. */
  const current = byValue.get(value)?.label
    ?? quick.find((o) => o.value === value)?.label
    ?? originLabelFor(value);

  /* THE LABEL, WITHOUT A TRAILING COLON. Applications passed "Origin:"
     and League passed nothing at all, so one page's control was labelled
     and the other's was not. One default, one place the colon is added. */
  const labelText = label.replace(/:\s*$/, '');

  return (
    <div className="scopepick" ref={wrap}>
      <button
        type="button"
        className={`scopepick__btn${open ? ' is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${labelText}: ${current}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon name={iconFor(value) as 'dashboard'} />
        <span className="scopepick__text">{labelText}: <b>{current}</b></span>
        <Icon name="chevronDown" className="scopepick__caret" />
      </button>

      {/* CLEAR, BACK TO EVERYTHING. Matt: "Add a clear (x) to go back to
          Everything." Only when something is applied: an x beside
          "Everything" offers to undo nothing. Outside the button, so it
          is its own target and does not open the picker on the way to
          clearing it. */}
      {value !== ORIGIN_ALL && (
        <button
          type="button"
          className="scopepick__clear"
          aria-label={`Clear the ${labelText.toLowerCase()} filter`}
          title="Show everything"
          onClick={() => { onChange(ORIGIN_ALL); close(); }}
        >
          <Icon name="x" size={13} />
        </button>
      )}

      {open && (
        <div className="scopepick__pop">
          <TypeAhead
            value={query}
            ariaLabel={ariaLabel}
            placeholder="Type to find a supplier, agency or group"
            options={rows}
            emptyText="No party of that name in this book"
            onChange={setQuery}
            /* Focused on open, which is what makes the list appear: the
               press on the pill was the intent to choose, and a dropdown
               that needs a second click into a box does not drop down. */
            autoFocus
          />
        </div>
      )}
    </div>
  );
}
