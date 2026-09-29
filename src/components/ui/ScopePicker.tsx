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
   ===================================================================== */
import { useState } from 'react';
import { TypeAhead, highlightMatch, type TypeAheadOption } from './TypeAhead';
import { Icon } from './Icon';
import {
  ORIGIN_ALL, RAIL_AGENCY, RAIL_SUPPLIER, type OriginOption, type OriginScope,
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
  value, onChange, options, recents = [], label, ariaLabel = 'Scope',
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
  const [typing, setTyping] = useState(false);

  const byValue = new Map(options.map((o) => [o.value, o]));
  /* The quick choices the BOOK supports. Direct and Provider come from
     originOptions when rows of that kind exist; the two rails are always
     offered because an admin can always ask the question, and an empty answer
     is an answer. */
  const quick = [...QUICK, ...options.filter((o) => o.group === null && o.value !== ORIGIN_ALL)]
    .filter((o, i, a) => a.findIndex((x) => x.value === o.value) === i);

  const parties = options.filter((o) => o.group !== null && o.group !== 'Selected');
  const q = query.trim().toLowerCase();
  const matches = q ? parties.filter((o) => o.label.toLowerCase().includes(q)) : parties;

  const recentOpts = q
    ? []
    : recents.map((v) => byValue.get(v)).filter((o): o is OriginOption => !!o);

  const row = (o: OriginOption, section: string | null): TypeAheadOption => ({
    id: `${section ?? 'quick'}:${o.value}`,
    icon: <Icon name={iconFor(o.value) as 'dashboard'} />,
    main: highlightMatch(o.label, query),
    sub: section ?? undefined,
    onSelect: () => {
      onChange(o.value);
      setQuery('');
      setTyping(false);
    },
  });

  const rows: TypeAheadOption[] = [
    ...quick.map((o) => row(o, null)),
    ...recentOpts.map((o) => row(o, 'Recent')),
    ...matches.map((o) => row(o, o.group)),
  ];

  const current = byValue.get(value)?.label
    ?? quick.find((o) => o.value === value)?.label
    ?? 'Everything';

  return (
    /* `fchip` as well as its own class: on Applications this sits in the
       filter bar beside Branch and Referrer and must line up with them. On
       Reporting it sits in the page head, where fchip adds nothing and costs
       nothing. */
    <div className="scopepick fchip">
      {label && <span className="scopepick__lbl">{label}</span>}
      <TypeAhead
        value={typing ? query : current}
        ariaLabel={ariaLabel}
        placeholder="Type to find a supplier, agency or group"
        options={rows}
        emptyText="No party of that name in this book"
        onChange={(v) => { setQuery(v); setTyping(true); }}
      />
    </div>
  );
}
