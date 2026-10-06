/* =====================================================================
   THE TAB BAR, ONCE.

   Lifted out of AgencyHome, unchanged in markup and class names, because
   Q-06 item A gives the supplier page the same five-tab shape and says so
   explicitly: "Regent's agency page is the template." Two hand-rolled tab
   bars is two places for the keyboard semantics to differ, and the agency
   one already had them right.

   Generic over the tab id so each page keeps its own union type and a typo
   is a compile error rather than a tab that never opens.
   ===================================================================== */
import './PageTabs.css';

export function PageTabs<T extends string>({
  tabs, value, onChange, ariaLabel = 'Sections',
}: {
  /** [id, label] in the order they are shown. Filter before passing: a tab
      the reader may not have is not drawn disabled, it is absent. */
  tabs: [T, string][];
  value: T;
  onChange: (t: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="pt-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map(([id, label]) => (
        <button
          key={id}
          role="tab"
          aria-selected={value === id}
          className={`pt-tab${value === id ? ' is-on' : ''}`}
          onClick={() => onChange(id)}
        >{label}</button>
      ))}
    </div>
  );
}
