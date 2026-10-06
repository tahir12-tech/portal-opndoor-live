/* The proof-of-address upload: a required per-address control in the small link
   style, with client type/size validation, per-address scoping, the uploaded
   state, and the reveal-when-blocked highlight. These mount it and drive it. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ProofUpload } from './Sections';
import { RevealMissingContext } from './reveal';
import * as api from '@/tenant/tenantApi';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

type Doc = { id: string; kind: string; filename: string; bytes: number | null; address_id: string | null };
const noDocs: Doc[] = [];
const proofFor = (aid: string): Doc[] =>
  [{ id: 'd1', kind: 'proof_of_address', filename: 'council-tax.pdf', bytes: 250000, address_id: aid }];

function file(name: string, type: string, size: number): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}
const validPdf = () => file('proof.pdf', 'application/pdf', 2000);
const idIs = async () => 'addr-1';

function fileInput(c: HTMLElement): HTMLInputElement {
  return c.querySelector('input[type="file"]') as HTMLInputElement;
}

describe('ProofUpload', () => {
  it('is a small upload link when this address has no proof', () => {
    render(<ProofUpload applicationId="a1" documents={noDocs} addressId="addr-1" ensureId={idIs} editable onChanged={() => {}} />);
    expect(screen.getByRole('button', { name: /upload proof of address/i })).toBeTruthy();
  });

  it('rejects a wrong type and does not upload', async () => {
    const up = vi.spyOn(api, 'uploadDocument').mockResolvedValue(undefined as never);
    const { container } = render(<ProofUpload applicationId="a1" documents={noDocs} addressId="addr-1" ensureId={idIs} editable onChanged={() => {}} />);
    fireEvent.change(fileInput(container), { target: { files: [file('notes.txt', 'text/plain', 1000)] } });
    await waitFor(() => expect(screen.getByText(/not a PDF, JPG or PNG/i)).toBeTruthy());
    expect(up).not.toHaveBeenCalled();
  });

  it('rejects a file over 10MB and does not upload', async () => {
    const up = vi.spyOn(api, 'uploadDocument').mockResolvedValue(undefined as never);
    const { container } = render(<ProofUpload applicationId="a1" documents={noDocs} addressId="addr-1" ensureId={idIs} editable onChanged={() => {}} />);
    fireEvent.change(fileInput(container), { target: { files: [file('big.pdf', 'application/pdf', 11 * 1024 * 1024)] } });
    await waitFor(() => expect(screen.getByText(/over 10MB/i)).toBeTruthy());
    expect(up).not.toHaveBeenCalled();
  });

  it('uploads a valid file scoped to this address', async () => {
    const up = vi.spyOn(api, 'uploadDocument').mockResolvedValue(undefined as never);
    const onChanged = vi.fn();
    const { container } = render(<ProofUpload applicationId="a1" documents={noDocs} addressId="addr-1" ensureId={idIs} editable onChanged={onChanged} />);
    fireEvent.change(fileInput(container), { target: { files: [validPdf()] } });
    await waitFor(() => expect(up).toHaveBeenCalled());
    const [appId, kind, , link] = up.mock.calls.at(-1)!;
    expect(appId).toBe('a1');
    expect(kind).toBe('proof_of_address');
    expect(link).toEqual({ address_id: 'addr-1' });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('saves the row for its id first when the address is not yet saved', async () => {
    const up = vi.spyOn(api, 'uploadDocument').mockResolvedValue(undefined as never);
    const ensureId = vi.fn(async () => 'fresh-id');
    const { container } = render(<ProofUpload applicationId="a1" documents={noDocs} addressId={null} ensureId={ensureId} editable onChanged={() => {}} />);
    fireEvent.change(fileInput(container), { target: { files: [validPdf()] } });
    await waitFor(() => expect(ensureId).toHaveBeenCalled());
    await waitFor(() => expect(up).toHaveBeenCalled());
    expect(up.mock.calls.at(-1)![3]).toEqual({ address_id: 'fresh-id' });
  });

  it('shows an error and does not upload if the address cannot be saved', async () => {
    const up = vi.spyOn(api, 'uploadDocument').mockResolvedValue(undefined as never);
    const { container } = render(<ProofUpload applicationId="a1" documents={noDocs} addressId={null} ensureId={async () => null} editable onChanged={() => {}} />);
    fireEvent.change(fileInput(container), { target: { files: [validPdf()] } });
    await waitFor(() => expect(screen.getByText(/could not save this address/i)).toBeTruthy());
    expect(up).not.toHaveBeenCalled();
  });

  it('shows only this address’s proof, not another address’s', () => {
    render(<ProofUpload applicationId="a1" documents={proofFor('other-addr')} addressId="addr-1" ensureId={idIs} editable onChanged={() => {}} />);
    expect(screen.queryByText('council-tax.pdf')).toBeNull();                     // belongs to another address
    expect(screen.getByRole('button', { name: /upload proof of address/i })).toBeTruthy();  // this one still needs its own
  });

  it('shows the uploaded file with size and Remove for this address', () => {
    render(<ProofUpload applicationId="a1" documents={proofFor('addr-1')} addressId="addr-1" ensureId={idIs} editable onChanged={() => {}} />);
    expect(screen.getByText('council-tax.pdf')).toBeTruthy();
    expect(screen.getByText(/244 KB/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /remove/i })).toBeTruthy();
  });

  it('reveals why it is needed after a blocked Continue', () => {
    render(
      <RevealMissingContext.Provider value={true}>
        <ProofUpload applicationId="a1" documents={noDocs} addressId="addr-1" ensureId={idIs} editable onChanged={() => {}} />
      </RevealMissingContext.Provider>,
    );
    expect(screen.getByText(/upload a proof of address to continue/i)).toBeTruthy();
  });
});
