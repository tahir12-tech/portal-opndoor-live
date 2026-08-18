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
import { useId } from 'react';
import { Field } from '@/components/ui/Field';
import { PeriodSelect } from '@/components/ui/Select';
import type { FieldSpec } from '@/tenant/formSpec';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
].map((m, i) => ({ value: String(i + 1), label: m }));

function years(): { value: string; label: string }[] {
  const now = new Date().getFullYear();
  return Array.from({ length: 60 }, (_, i) => String(now - i)).map((y) => ({ value: y, label: y }));
}

export function FieldInput({
  spec, value, onChange, disabled,
}: {
  spec: FieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const v = value ?? '';
  const label = spec.required ? <>{spec.label} <span className="ap-req" aria-hidden="true">*</span></> : spec.label;

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
        <input id={id} className="input" type="text" disabled={disabled} autoComplete="postal-code"
          value={String(v)} onChange={(e) => onChange(e.target.value.toUpperCase())} placeholder="SW1A 1AA" />
      );
      break;
    default:
      control = (
        <input
          id={id} className="input" disabled={disabled}
          type={spec.kind === 'number' ? 'number' : spec.kind === 'date' ? 'date' : spec.kind === 'email' ? 'email' : spec.kind === 'tel' ? 'tel' : 'text'}
          inputMode={spec.kind === 'tel' ? 'tel' : undefined}
          value={String(v)} placeholder={spec.placeholder}
          onChange={(e) => onChange(e.target.value)} />
      );
  }

  // A checkbox carries its own label, so wrapping it in one would read it twice
  // to a screen reader.
  if (spec.kind === 'checkbox') {
    return <Field htmlFor={id} hint={spec.help} span2>{control}</Field>;
  }
  return <Field label={label} htmlFor={id} hint={spec.help}>{control}</Field>;
}

/** Render a spec list, honouring the conditional reveals. */
export function FieldList({
  fields, values, onChange, disabled,
}: {
  fields: FieldSpec[];
  values: Record<string, unknown>;
  onChange: (name: string, v: unknown) => void;
  disabled?: boolean;
}) {
  return (
    <div className="ap-grid">
      {fields.filter((f) => !f.when || f.when(values)).map((f) => (
        <FieldInput key={f.name} spec={f} value={values[f.name]} disabled={disabled}
          onChange={(v) => onChange(f.name, v)} />
      ))}
    </div>
  );
}
