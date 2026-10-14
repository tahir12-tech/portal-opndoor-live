/* =====================================================================
   (ck) "MIGHT ALREADY EXIST", WITH A VERB BESIDE IT.

   Matt: "Flag as 'Might already exist' when a new agency or office
   shares an email with an existing one, or its name starts with or
   contains another's name, within the same supplier or Opndoor's own
   estate. Show the possible match side by side, with 'Merge into
   [existing]' and 'Keep both'."

   THE DETECTION IS IN SQL and is tested there
   (the_duplicate_check_sees_both_new_rows.test.sql): the cause was that
   the match only looked at CONFIRMED records, so two agencies created
   two minutes apart could not see each other. This is the other half:
   a warning with no verb leaves the reader exactly where they were.

   "MERGE INTO" IS OFFERED FOR BOTH SINCE 2026-10-05. It began as
   agencies only, because merge_agencies existed and nothing one level
   down did; Matt answered that question with "yes, write
   merge_branches", so both are offered now. The same migration also
   GRANTED merge_agencies to authenticated, which it had never been:
   the button rendered by this test would have failed at the click
   with "permission denied for function merge_agencies", and a render
   test is exactly the thing that cannot see that.
   ===================================================================== */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Reconciliation } from './Reconciliation';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';

afterEach(() => cleanup());

const page = () =>
  render(
    <MemoryRouter initialEntries={['/reconciliation']}>
      <ToastProvider>
        <PageMetaProvider>
          <SessionProvider>
            <Reconciliation />
          </SessionProvider>
        </PageMetaProvider>
      </ToastProvider>
    </MemoryRouter>,
  );

/* BY THE CARD'S OWN NAME CELL, not by the text anywhere on the page: the
   new side-by-side block repeats both names inside the card, so a plain
   text query now finds two nodes and throws. Which is itself the feature
   working. */
const cardFor = async (name: string): Promise<HTMLElement> => {
  const card = await waitFor(() => {
    const hit = [...document.querySelectorAll('.rqitem')].find(
      (el) => el.querySelector('.rqitem__name')?.textContent === name,
    ) as HTMLElement | undefined;
    expect(hit, `a queue card for ${name}`).toBeTruthy();
    return hit!;
  });
  return card;
};

describe('a new agency that might already exist', () => {
  it('is labelled in Matt’s words, not "Might be the same"', async () => {
    page();
    const card = await cardFor('Marylebone and Co.');
    expect(within(card).getByText('Might already exist')).toBeTruthy();
    expect(within(card).queryByText('Might be the same')).toBeNull();
  });

  /* SIDE BY SIDE, which is the part a reviewer actually uses: the two
     names, labelled, in one line, rather than one of them buried in a
     sentence about the other. */
  it('shows the two records beside each other', async () => {
    page();
    const card = await cardFor('Marylebone and Co.');
    const pair = card.querySelector('.match__pair');
    expect(pair).toBeTruthy();
    expect(pair!.textContent).toContain('Marylebone and Co.');
    expect(pair!.textContent).toContain('Marylebone & Co');
    expect(pair!.textContent).toContain('On file');
  });

  it('and says what it matched on', async () => {
    page();
    const card = await cardFor('Marylebone and Co.');
    expect(within(card).getByText(/Matched on a similar name/)).toBeTruthy();
  });

  it('offers both verbs', async () => {
    page();
    const card = await cardFor('Marylebone and Co.');
    expect(within(card).getByRole('button', { name: /Merge into Marylebone & Co/i })).toBeTruthy();
    expect(within(card).getByRole('button', { name: /Keep both/i })).toBeTruthy();
  });
});

describe('a new office that might already exist', () => {
  /* BOTH VERBS NOW. Matt, 2026-10-05, answering the question this test
     used to record as unanswerable: "Merging two offices: yes, write
     merge_branches, matching how merge_agencies works, with a test."
     So the office case is no longer the one that can only be kept. */
  it('is flagged, and can be merged or kept', async () => {
    page();
    const card = await cardFor('Sth Kensington');
    expect(within(card).getByText('Might already exist')).toBeTruthy();
    expect(within(card).getByRole('button', { name: /Keep both/i })).toBeTruthy();
    expect(within(card).getByRole('button', { name: /Merge into South Kensington/i })).toBeTruthy();
  });
});

describe('a new record with nothing like it', () => {
  it('still reads "Confirm as new", because there is no second thing to keep', async () => {
    page();
    const card = await cardFor('Camden Town Lettings');
    await waitFor(() => expect(within(card).getByText('Nothing similar found')).toBeTruthy());
    expect(within(card).getByRole('button', { name: /Confirm as new/i })).toBeTruthy();
    expect(within(card).queryByRole('button', { name: /Keep both/i })).toBeNull();
  });
});
