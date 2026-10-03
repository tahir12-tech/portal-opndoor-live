/* =====================================================================
   THE LEVELS A SUPPLIER'S PERSON CAN HOLD, AS A CHOICE.

   Two screens offer this: inviting somebody (SupplierInvite) and
   changing somebody (SupplierRoleDialog). They were going to be two
   copies of the same radio list reading the same descriptions out of
   SUPPLIER_LEVELS -- which is how the invite dialog and the change
   dialog come to disagree about what a Developer is.

   DEVELOPER IS OFFERED ONLY WITH API ACCESS ON, which is the
   Integration tab's switch and the same thing the Dev Centre is gated
   on. A Developer at a supplier with the API off signs in to a Dev
   Centre that is not there.

   IT IS A CONVENIENCE, NOT A BOUNDARY. The server decides who may hold
   a role; this decides what is worth offering.

   AND SINCE 2026-10-03 IT IS THREE SCREENS, not two: the supplier's own
   Team page (/users as its Management sees it) renders this too, which is
   Matt's "Use the same dialog component as the agency Team page". That page
   was building its own radio list out of ROLE_OPTIONS -- the paragraph-long
   descriptions, plus a Supplier picker with one option in it.
   ===================================================================== */
import { SUPPLIER_LEVELS, type Role } from '@/data/types';
import { supplierLevelBlurb } from '@/data/levelLabel';
import { Field } from '@/components/ui/Field';

export function supplierLevelsFor(apiAccessEnabled: boolean) {
  return SUPPLIER_LEVELS.filter((l) => apiAccessEnabled || !l.needsApi);
}

export function SupplierLevelOptions({
  value, onChange, apiAccessEnabled, label = 'Level',
}: {
  value: Role;
  onChange: (role: Role) => void;
  apiAccessEnabled: boolean;
  label?: string;
}) {
  const levels = supplierLevelsFor(apiAccessEnabled);
  return (
    <>
      <Field label={label}>
        <div className="roleopts">
          {levels.map((l) => (
            <label
              key={l.level}
              className={`roleopt${value === l.role ? ' is-sel' : ''}`}
              onClick={() => onChange(l.role)}
            >
              <span className="roleopt__radio" />
              <div>
                <div className="roleopt__name">{l.level}</div>
                {/* THE SHORT FORM. Matt, 2026-10-03: "short level
                    descriptions, e.g. Management 'Sees everything for your
                    company, including commission, and manages the team and
                    agencies'."

                    SUPPLIER_LEVELS.desc is a paragraph per level, written to
                    DOCUMENT a level where there is room for it. Three of them
                    stacked above a Send invite button is a wall of text, and a
                    reader choosing between three options wants the difference,
                    not the specification. The long form still has a home on
                    the Manage partner screen. */}
                <div className="roleopt__desc">{supplierLevelBlurb(l.level)}</div>
              </div>
            </label>
          ))}
        </div>
      </Field>
      {!apiAccessEnabled && (
        /* SAYING WHY A LEVEL IS MISSING, rather than leaving a gap. An
           admin looking for Developer should not have to guess which
           switch governs it. */
        <p className="ph-note muted">
          Developer is offered once API access is switched on, which is done on the Integration tab.
        </p>
      )}
    </>
  );
}
