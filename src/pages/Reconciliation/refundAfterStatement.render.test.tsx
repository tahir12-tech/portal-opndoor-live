/* A REFUND ON A STATEMENT ALREADY SENT: NOTHING HAPPENS UNTIL SOMEBODY SAYS.
 *
 * Matt, 2026-10-01, verbatim: "Refund after a commission statement has
 * been sent: when a refund lands on an application whose commission was
 * already on a sent statement, raise an internal alert to Opndoor naming
 * the payee, the statement reference and the commission affected. On that
 * alert, Opndoor admin chooses, with a confirmation box: (a) reissue a
 * corrected statement to the payee, or (b) carry the amount as a
 * deduction line on the payee's next statement. Nothing happens
 * automatically. Record who chose what and when."
 *
 * WHAT ONLY A RENDER CAN SHOW. The database refuses a second decision and
 * a non-staff caller, and a_refund_after_a_statement_is_a_question.test.sql
 * proves both. What a pgTAP file cannot show is that the screen ASKS
 * before it acts, and that the box names the record: a confirmation that
 * does not say which payee and which statement is the same click with an
 * extra step in front of it, and it teaches people to press through.
 *
 * AND THAT THE TWO ANSWERS ARE NOT THE SAME WEIGHT. Deducting is quiet;
 * reissuing posts a second document for a month the payee may already
 * have invoiced for. The assertions below read both sentences.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/components/ui/Toast';
import { RefundQuestions } from './RefundQuestions';
import * as recon from '@/data/reconciliationService';

const ROW: recon.RefundQuestion = {
  id: 'q-1',
  guaranteeRef: 'GR-20845',
  tenantName: 'Ada Tester',
  payeeName: "Regent's Lettings",
  payeeLevel: 'agency',
  statementMonth: '2026-08',
  statementReference: 'STMT-2026-08-0012',
  commission: 300,
  raisedAt: '1 Oct 2026',
  refundedAt: '30 Sep 2026',
};

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(recon, 'loadRefundQuestions').mockResolvedValue([ROW]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function open() {
  const onChanged = vi.fn();
  const view = render(
    <MemoryRouter><ToastProvider><RefundQuestions onChanged={onChanged} /></ToastProvider></MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.nin__card')) throw new Error('no rows'); });
  await act(async () => {});
  return { ...view, onChanged };
}
type View = Awaited<ReturnType<typeof open>>;
const btn = (v: View, label: string) =>
  [...v.container.querySelectorAll<HTMLElement>('button')]
    .find((b) => (b.textContent ?? '').trim() === label);
/** The confirmation renders in a portal, so it is not inside `container`. */
const dialog = () => document.querySelector('[role="dialog"]');
const dialogText = () => dialog()?.textContent ?? '';
const dialogBtn = (label: string) =>
  [...(dialog()?.querySelectorAll<HTMLElement>('button') ?? [])]
    .find((b) => (b.textContent ?? '').trim() === label);

describe('the question on the page', () => {
  it('names the payee, the statement reference and the commission', () => {
    /* MATT'S THREE FACTS. The alert email carries them and so must the
       screen: a reader deciding this has to know whose money, which
       document, and how much, without opening anything else. */
    return open().then((v) => {
      const text = v.container.textContent ?? '';
      expect(text).toContain("Regent's Lettings");
      expect(text).toContain('STMT-2026-08-0012');
      expect(text).toContain('£300.00');
      expect(text).toContain('GR-20845');
    });
  });

  it('and says, before anything is decided, that nothing has been changed', async () => {
    const v = await open();
    expect(v.container.textContent).toMatch(/Nothing has been changed/i);
  });

  /* "partner" IS THE MACHINE WORD. On this rail a partner is a supplier,
     and a screen that printed the payee_key's level would tell an admin a
     supplier was a "Partner" while every other page calls it a supplier. */
  it('and calls a supplier a supplier', async () => {
    vi.spyOn(recon, 'loadRefundQuestions').mockResolvedValue([{ ...ROW, payeeLevel: 'partner' }]);
    const v = await open();
    expect(v.container.textContent).toContain('Supplier');
    expect(v.container.textContent).not.toContain('Partner ·');
  });
});

describe('carrying it as a deduction', () => {
  it('asks first, and names where the money will show up', async () => {
    const spy = vi.spyOn(recon, 'decideRefundQuestion');
    const v = await open();
    await act(async () => { fireEvent.click(btn(v, 'Carry as a deduction')!); });
    expect(dialog(), 'no confirmation box').toBeTruthy();
    expect(spy, 'it acted before the reader confirmed').not.toHaveBeenCalled();
    const t = dialogText();
    expect(t).toContain("Regent's Lettings");
    expect(t).toContain('£300.00');
    expect(t).toContain('STMT-2026-08-0012');
    // The half a reader cannot guess: the payee will see it, and the
    // document already sent is not touched.
    expect(t).toMatch(/next statement/i);
    expect(t).toMatch(/left exactly as it is/i);
  });

  it('and records the decision only once confirmed', async () => {
    const spy = vi.spyOn(recon, 'decideRefundQuestion').mockResolvedValue(undefined);
    const v = await open();
    await act(async () => { fireEvent.click(btn(v, 'Carry as a deduction')!); });
    await act(async () => { fireEvent.click(dialogBtn('Carry as a deduction')!); });
    expect(spy).toHaveBeenCalledWith('q-1', 'deduct');
    expect(v.onChanged).toHaveBeenCalled();
  });

  /* AND IT DOES NOT SEND ANYTHING. Deducting is the quiet answer: the
     money comes off a document nobody has written yet. A call to the
     reissue endpoint here would post a second statement the admin did
     not ask for. */
  it('and sends no statement', async () => {
    vi.spyOn(recon, 'decideRefundQuestion').mockResolvedValue(undefined);
    const send = vi.spyOn(recon, 'reissueCorrectedStatement');
    const v = await open();
    await act(async () => { fireEvent.click(btn(v, 'Carry as a deduction')!); });
    await act(async () => { fireEvent.click(dialogBtn('Carry as a deduction')!); });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('reissuing a corrected statement', () => {
  it('warns that it goes out now, and to whom', async () => {
    const v = await open();
    await act(async () => { fireEvent.click(btn(v, 'Reissue statement')!); });
    const t = dialogText();
    expect(t).toContain("Regent's Lettings");
    expect(t).toContain('STMT-2026-08-0012');
    expect(t).toMatch(/goes out now/i);
    expect(t).toMatch(/statement recipients/i);
    /* THE ONE THING THE ADMIN HAS TO DO THAT THE SOFTWARE CANNOT. If the
       payee has already invoiced against the old document, a second one
       arriving unannounced is a reconciliation problem for them. */
    expect(t).toMatch(/already invoiced/i);
  });

  it('records the decision and then sends, in that order', async () => {
    const order: string[] = [];
    vi.spyOn(recon, 'decideRefundQuestion').mockImplementation(async () => { order.push('decide'); });
    vi.spyOn(recon, 'reissueCorrectedStatement').mockImplementation(async () => {
      order.push('send');
      return { ok: true, reference: 'STMT-2026-08-0031', recipients: 2 };
    });
    const v = await open();
    await act(async () => { fireEvent.click(btn(v, 'Reissue statement')!); });
    await act(async () => { fireEvent.click(dialogBtn('Send corrected statement')!); });
    /* THE DECISION IS RECORDED FIRST, so a send that falls over leaves a
       decided question rather than a sent document nobody chose. */
    expect(order).toEqual(['decide', 'send']);
  });

  /* THE HALF-DONE STATE, SAID OUT LOUD. The decision sticks and the
     document does not, and a reader who is not told will believe the
     payee has it. */
  it('and says so plainly when the decision stuck but the send failed', async () => {
    vi.spyOn(recon, 'decideRefundQuestion').mockResolvedValue(undefined);
    vi.spyOn(recon, 'reissueCorrectedStatement').mockResolvedValue({
      ok: false, error: 'Regent has nobody to send a statement to.',
    });
    const v = await open();
    await act(async () => { fireEvent.click(btn(v, 'Reissue statement')!); });
    await act(async () => { fireEvent.click(dialogBtn('Send corrected statement')!); });
    await waitFor(() => {
      if (!(document.body.textContent ?? '').match(/did not go out/i)) throw new Error('no warning');
    });
    expect(document.body.textContent).toMatch(/Recorded, but the statement did not go out/i);
    expect(document.body.textContent).toContain('nobody to send a statement to');
  });
});

describe('when there is nothing to decide', () => {
  it('says so, and says that nothing is changed without a person', async () => {
    vi.spyOn(recon, 'loadRefundQuestions').mockResolvedValue([]);
    const v = render(
      <MemoryRouter><ToastProvider><RefundQuestions /></ToastProvider></MemoryRouter>,
    );
    await waitFor(() => { if (!v.container.querySelector('.empty')) throw new Error('no empty state'); });
    /* `empty is-shown`, not `empty`: the shared rule hides a bare .empty,
       so the class alone renders an element that is in the DOM, carries
       the right words and shows the reader nothing. */
    expect(v.container.querySelector('.empty')?.className).toContain('is-shown');
    expect(v.container.textContent).toMatch(/nothing is changed until somebody decides/i);
  });
});
