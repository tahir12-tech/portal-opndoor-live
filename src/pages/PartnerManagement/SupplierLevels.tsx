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
   ===================================================================== */
import { SUPPLIER_LEVELS, type Role } from '@/data/types';
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
                <div className="roleopt__desc">{l.desc}</div>
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
