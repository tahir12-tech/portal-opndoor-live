/* =====================================================================
   One renderer for every field in the spec.

   The alternative is JSX per field, which for nine employment types and
   eighteen income types is roughly a thousand lines of near-duplicate markup
   and four places to forget when a type is added. This is the other half of
   formSpec.ts: the spec says what to ask, this says how to ask it.

   The conditional reveals live here too. A field with a `when` that fails is
   not rendered AND its value is not cleared, deliberately: somebody who ticks
   "yes", fills three boxes, then changes to "no" and back has not lost the
   three boxes. The server ignores fields whose parent answer says they do not
   apply, so a stale value is never read.
   ===================================================================== */
import { useContext, useId, useState, type ReactNode } from 'react';
import { Field } from '@/components/ui/Field';
import { PeriodSelect } from '@/components/ui/Select';
import type { FieldSpec } from '@/tenant/formSpec';
import { Button } from '@/components/ui/Button';
import { addressLookupAvailable, lookupAddresses, type AddressOption } from '@/data';
import { RevealMissingContext } from './reveal';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
].map((m, i) => ({ value: String(i + 1), label: m }));

function years(): { value: string; label: string }[] {
  const now = new Date().getFullYear();
  return Array.from({ length: 60 }, (_, i) => String(now - i)).map((y) => ({ value: y, label: y }));
}

/* ---------------------------------------------------------------------------
   Postcode lookup, using the SAME service the staff New Application form uses.

   Not a second implementation. addressLookupAvailable() and lookupAddresses()
   are the ones in src/data/addressService.ts, so the tenant form and the
   referral form hit the same provider, normalise the result the same way, and
   fall back to manual entry under the same condition. Two lookups would drift
   on the small things that matter here: which of line_2/3/4 get concatenated,
   whether the postcode is upper-cased, what "no addresses" reads as.

   Falls back silently to a plain input when no provider key is configured,
   which is the state of the dev project today (HANDOVER "deliberately not
   done"). A tenant should never see a Find button that cannot work.
   --------------------------------------------------------------------------- */
function PostcodeLookup({
  id, value, spec, onChange, onApply, disabled, onBlur,
}: {
  id: string;
  value: string;
  spec: FieldSpec;
  onChange: (v: unknown) => void;
  onApply?: (patch: Record<string, unknown>) => void;
  disabled?: boolean;
  onBlur?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [results, setResults] = useState<AddressOption[]>([]);

  const canLookup = addressLookupAvailable() && !!spec.fills && !!onApply;

  const run = async () => {
    setBusy(true); setMsg(''); setResults([]);
    const r = await lookupAddresses(value);
    setBusy(false);
    if (!r.available) { setMsg(''); return; }          // no key: stay manual, say nothing
    if (r.error) { setMsg(r.error); return; }
    if (!r.addresses.length) { setMsg('No addresses found for that postcode.'); return; }
    setResults(r.addresses);
  };

  const pick = (a: AddressOption) => {
    const f = spec.fills!;
    const patch: Record<string, unknown> = {};
    if (f.single) {
      // One free-text field: everything but the postcode, which has its own.
      patch[f.single] = [a.line1, a.line2, a.city, a.county].filter(Boolean).join(', ');
    } else {
      if (f.line1) patch[f.line1] = a.line1;
      if (f.line2) patch[f.line2] = a.line2;
      if (f.city) patch[f.city] = a.city;
      if (f.county) patch[f.county] = a.county;
    }
    if (f.postcode) patch[f.postcode] = a.postcode;
    onApply!(patch);
    setResults([]);
    setMsg('');
  };

  return (
    <div className="apzip">
      <div className="apzip__row">
        <input
          id={id} className="input" type="text" disabled={disabled} autoComplete="postal-code"
          value={value} placeholder="SW1A 1AA"
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          onBlur={onBlur}
          onKeyDown={(e) => { if (canLookup && e.key === 'Enter') { e.preventDefault(); void run(); } }}
        />
        {canLookup && (
          <Button variant="quiet" disabled={disabled || busy || !value.trim()} onClick={() => void run()}>
            {busy ? 'Looking…' : 'Find address'}
          </Button>
        )}
      </div>
      {msg && <p className="apzip__msg">{msg}</p>}
      {results.length > 0 && (
        <ul className="apzip__list">
          {results.map((a) => (
            <li key={a.label}>
              <button type="button" className="apzip__opt" onClick={() => pick(a)}>{a.label}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FieldInput({
  spec, value, onChange, onApply, disabled,
}: {
  spec: FieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
  /** Applies a whole address at once, for the postcode lookup. */
  onApply?: (patch: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const v = value ?? '';
  const label = spec.required ? <>{spec.label} <span className="ap-req" aria-hidden="true">*</span></> : spec.label;

  // Format errors show once the field has been left, so a half-typed number
  // does not flash red mid-entry. A value that arrives already invalid (a bad
  // phone carried in from an earlier draft) counts as touched, so it is flagged
  // on sight rather than only after the tenant happens to click into it.
  const validationError = spec.validate && String(v).trim() ? spec.validate(String(v)) : null;
  const [touched, setTouched] = useState<boolean>(() => validationError != null);
  // After a blocked Continue, a required field left empty shows itself as missing,
  // so pressing the button names the reason on the field, not only in the footer.
  const reveal = useContext(RevealMissingContext);
  const missing = reveal && !!spec.required && String(v).trim() === '';
  const shownError = touched && validationError ? validationError
    : missing ? 'Still needed'
    : undefined;

  // Every select is the app's own component. A bare <select> here would be the
  // fifth time a new screen reintroduced one against the house style.
  const select = (options: { value: string; label: string }[]) => (
    <PeriodSelect
      id={id} value={String(v)} onChange={onChange} disabled={disabled}
      ariaLabel={spec.label}
      options={[{ value: '', label: 'Please choose' }, ...options]}
    />
  );

  let control: React.ReactNode;
  switch (spec.kind) {
    case 'select':
      control = select(spec.options ?? []);
      break;
    case 'yesno':
      control = select([{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]);
      break;
    case 'yesnodk':
      control = select([{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'dont_know', label: "Don't know" }]);
      break;
    case 'month':
      control = select(MONTHS);
      break;
    case 'year':
      control = select(years());
      break;
    case 'textarea':
      control = (
        <textarea id={id} className="input ap-textarea" rows={3} disabled={disabled}
          value={String(v)} onChange={(e) => onChange(e.target.value)} />
      );
      break;
    case 'checkbox':
      control = (
        <label className="ap-check">
          <input id={id} type="checkbox" disabled={disabled}
            checked={v === true || v === 'true'} onChange={(e) => onChange(e.target.checked)} />
          <span>{spec.label}</span>
        </label>
      );
      break;
    case 'money':
      control = (
        <div className="ap-money">
          <span aria-hidden="true">£</span>
          <input id={id} className="input" type="number" inputMode="decimal" min="0" step="0.01"
            disabled={disabled} value={String(v)} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
      break;
    case 'postcode':
      control = (
        <PostcodeLookup id={id} value={String(v)} spec={spec}
          onChange={onChange} onApply={onApply} disabled={disabled}
          onBlur={() => setTouched(true)} />
      );
      break;
    default:
      control = (
        <input
          id={id} className="input" disabled={disabled}
          type={spec.kind === 'number' ? 'number' : spec.kind === 'date' ? 'date' : spec.kind === 'email' ? 'email' : spec.kind === 'tel' ? 'tel' : 'text'}
          inputMode={spec.kind === 'tel' ? 'tel' : undefined}
          value={String(v)} placeholder={spec.placeholder}
          onBlur={() => setTouched(true)}
          onChange={(e) => onChange(e.target.value)} />
      );
  }

  // A checkbox carries its own label, so wrapping it in one would read it twice
  // to a screen reader.
  if (spec.kind === 'checkbox') {
    return <Field htmlFor={id} hint={spec.help} span2 error={shownError}>{control}</Field>;
  }
  return <Field label={label} htmlFor={id} hint={spec.help} error={shownError}>{control}</Field>;
}

/** Render a spec list, honouring the conditional reveals. */
export function FieldList({
  fields, values, onChange, disabled, after,
}: {
  fields: FieldSpec[];
  values: Record<string, unknown>;
  onChange: (name: string, v: unknown) => void;
  disabled?: boolean;
  /** Rendered as the last item INSIDE the grid, so a non-spec control (the proof
      of address upload) sits inline with the fields rather than tacked underneath. */
  after?: ReactNode;
}) {
  // A chosen address writes several fields at once. Each goes through the same
  // onChange as a keystroke, so all of them update the local mirror by one path
  // and are written together when the step's button is pressed.
  const applyAll = (patch: Record<string, unknown>) => {
    for (const [k, val] of Object.entries(patch)) onChange(k, val);
  };
  return (
    <div className="ap-grid">
      {fields.filter((f) => !f.when || f.when(values)).map((f) => (
        <FieldInput key={f.name} spec={f} value={values[f.name]} disabled={disabled}
          onChange={(v) => onChange(f.name, v)} onApply={applyAll} />
      ))}
      {after}
    </div>
  );
}
