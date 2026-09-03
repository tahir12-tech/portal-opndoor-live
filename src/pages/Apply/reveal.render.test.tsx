/* A blocked "Save and continue" press reveals the missing fields and does not
   proceed. These cover the two pieces: FieldList marking required-but-empty fields
   when revealed, and StepFooter routing a blocked press to onBlocked. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { FieldList } from './FieldInput';
import { StepFooter } from './Sections';
import { RevealMissingContext } from './reveal';
import type { FieldSpec } from '@/tenant/formSpec';

afterEach(() => cleanup());

const fields: FieldSpec[] = [
  { name: 'a', label: 'Thing', kind: 'text', required: true },
  { name: 'b', label: 'Optional', kind: 'text' },
];

describe('reveal on a blocked Continue', () => {
  it('does not mark required-empty fields until revealed', () => {
    render(<FieldList fields={fields} values={{}} onChange={() => {}} />);
    expect(screen.queryByText(/still needed/i)).toBeNull();
  });

  it('marks a required-but-empty field as missing when revealed, but not the optional one', () => {
    render(
      <RevealMissingContext.Provider value={true}>
        <FieldList fields={fields} values={{}} onChange={() => {}} />
      </RevealMissingContext.Provider>,
    );
    expect(screen.getAllByText(/still needed/i)).toHaveLength(1);
  });

  it('un-marks a required field once it has a value', () => {
    render(
      <RevealMissingContext.Provider value={true}>
        <FieldList fields={fields} values={{ a: 'filled' }} onChange={() => {}} />
      </RevealMissingContext.Provider>,
    );
    expect(screen.queryByText(/still needed/i)).toBeNull();
  });

  it('routes a blocked footer press to onBlocked, not onNext', () => {
    const onNext = vi.fn();
    const onBlocked = vi.fn();
    render(<StepFooter done={false} nextLabel="Save and continue to income" onNext={onNext}
      outstanding="Proof of address document is still needed" onBlocked={onBlocked} />);
    fireEvent.click(screen.getByRole('button', { name: /save and continue/i }));
    expect(onBlocked).toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('lets a ready footer press proceed', () => {
    const onNext = vi.fn();
    const onBlocked = vi.fn();
    render(<StepFooter done={true} nextLabel="Save and continue to income" onNext={onNext} onBlocked={onBlocked} />);
    fireEvent.click(screen.getByRole('button', { name: /save and continue/i }));
    expect(onNext).toHaveBeenCalled();
    expect(onBlocked).not.toHaveBeenCalled();
  });
});
