/* The direct tenant's post-approval status screen: pay, then sign the deed on the
   status screen until it is signed, then view/download it. Copy follows the
   managed-by kind, as the emails do. */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { statusView, ApplicationStatus } from './ApplicationStatus';

afterEach(cleanup);

describe('the direct tenant status screen after approval', () => {
  it('sent: Approved, with the guarantee fee to pay', () => {
    const v = statusView('sent', true, 7, 7, 'letting_agent', null);
    expect(v.cta).toBe('pay_guarantee');
    render(<ApplicationStatus view={v} guaranteeRef="GR-1" onPayGuarantee={() => {}} />);
    expect(screen.getByRole('button', { name: /pay the guarantee fee/i })).toBeTruthy();
  });

  it('paid, deed awaiting signature: a Sign button on the status screen', () => {
    const v = statusView('paid', true, 7, 7, 'private_landlord', 'awaiting_tenant');
    expect(v.cta).toBe('sign_deed');
    expect(v.detail).toMatch(/your landlord/i); // copy follows the managed-by kind
    render(<ApplicationStatus view={v} guaranteeRef="GR-1" onSignDeed={() => {}} />);
    expect(screen.getByRole('button', { name: /sign the deed/i })).toBeTruthy();
  });

  it('paid but deed not generated yet: preparing, no sign button', () => {
    const v = statusView('paid', true, 7, 7, null, null);
    expect(v.cta).toBeUndefined();
    expect(v.detail).toMatch(/preparing/i);
  });

  it('deed executed: guarantee in place, deed to view or download', () => {
    const v = statusView('deed', true, 7, 7, 'letting_agent', 'executed');
    expect(v.cta).toBe('view_deed');
    expect(v.detail).toMatch(/your letting agent/i);
    render(<ApplicationStatus view={v} guaranteeRef="GR-1" onViewDeed={() => {}} />);
    expect(screen.getByRole('button', { name: /view or download the deed/i })).toBeTruthy();
  });

  it('deed ready to sign: the last timeline stage is current, not a completed tick', () => {
    // The guarantee is not issued until they sign, so "Guarantee issued" must read
    // as the current stage in progress, with its ring but no done-tick.
    const v = statusView('paid', true, 7, 7, 'letting_agent', 'awaiting_tenant');
    const { container } = render(<ApplicationStatus view={v} guaranteeRef="GR-1" onSignDeed={() => {}} />);
    const steps = container.querySelectorAll('.tl-step');
    const last = steps[steps.length - 1];
    expect(last.className).toContain('tl-step--current');
    expect(last.className).not.toContain('tl-step--done');
    expect(last.querySelector('svg')).toBeNull(); // no tick yet
  });

  it('deed executed: the last timeline stage is done and ticked', () => {
    const v = statusView('deed', true, 7, 7, 'letting_agent', 'executed');
    const { container } = render(<ApplicationStatus view={v} guaranteeRef="GR-1" onViewDeed={() => {}} />);
    const steps = container.querySelectorAll('.tl-step');
    const last = steps[steps.length - 1];
    expect(last.className).toContain('tl-step--done');
    expect(last.querySelector('svg')).not.toBeNull(); // now ticked
  });
});
