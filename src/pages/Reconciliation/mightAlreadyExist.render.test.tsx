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

   "MERGE INTO" IS OFFERED FOR AN AGENCY ONLY. merge_agencies exists on
   dev and has never had a caller in the client; there is no
   merge_branches, so two duplicate OFFICES can be told apart and kept
   but not joined. That gap is a question for Matt in QUEUE.md rather
   than a button that cannot work -- which is what the code this
   replaces was removed for being.
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
  /* THE FLAG IS THE SAME; the verb is not available, because merging two
     offices is a thing the database cannot do yet. */
  it('is flagged and can be kept, but not merged', async () => {
    page();
    const card = await cardFor('Sth Kensington');
    expect(within(card).getByText('Might already exist')).toBeTruthy();
    expect(within(card).getByRole('button', { name: /Keep both/i })).toBeTruthy();
    expect(within(card).queryByRole('button', { name: /Merge into/i })).toBeNull();
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
