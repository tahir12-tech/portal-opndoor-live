/* =====================================================================
   HOW ARE THIS SUPPLIER'S TENANTS CHECKED?

   Matt, 2026-10-03, verbatim: "Add supplier form (and supplier Settings):
   replace the 'Referencing mode' dropdown with the same plain-English radio
   question as the agency page, 'How are this supplier's tenants checked?',
   one line each:
     - 'They check tenants, and Opndoor applies its own criteria too' (screened)
     - 'They check tenants, and Opndoor accepts them as sent' (open)
     - 'Opndoor checks tenants itself'."

   WHY A DROPDOWN WAS THE WRONG CONTROL, which is the same reason the agency
   page stopped using one: three mutually exclusive answers that each need a
   sentence are not a list of names. The select showed 'Pre-referenced,
   screened' -- jargon the reader has to already know to choose between -- and
   the sentence explaining it sat underneath, describing only the option
   already selected. So the one answer you could read about was the one you
   had already picked.

   ONE COMPONENT, TWO FORMS. Add supplier and Supplier Settings are separate
   screens that set the same field, and they held two copies of the select
   and two copies of the note. The lines themselves live on
   REFERENCING_MODES.choice, beside the ids, so the control and the
   confirmation cannot disagree about what was chosen.

   THE AGENCY PAGE'S OWN CLASSES, deliberately: "the same plain-English radio
   question as the agency page" is about what it looks like as much as what it
   says, and AgencyCreate already imports this stylesheet for the same reason.
   ===================================================================== */
import { REFERENCING_MODES, type ReferencingMode } from '@/data';
import '@/pages/Agencies/AgencyHome.css';

export function TenantsChecked({ value, onChange, name, disabled }: {
  value: ReferencingMode;
  onChange: (next: ReferencingMode) => void;
  /** Radio group name. Two of these on one page would otherwise share a group. */
  name: string;
  disabled?: boolean;
}) {
  return (
    <div className="ah-route">
      <span className="ah-route__lbl">How are this supplier’s tenants checked?</span>
      <div className="ah-route__opts">
        {REFERENCING_MODES.map((m) => {
          const chosen = m.id === value;
          return (
            <label key={m.id} className={`ah-route__opt${chosen ? ' is-on' : ''}`}>
              <input
                type="radio" name={name} value={m.id} checked={chosen} disabled={disabled}
                onChange={() => { if (!chosen) onChange(m.id); }}
              />
              {/* ONE LINE EACH, which is Matt's instruction and is why there is
                  no `ah-route__why` here: these sentences ARE the explanation,
                  and a second line under them would be the jargon again. */}
              <span><b>{m.choice}</b></span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
