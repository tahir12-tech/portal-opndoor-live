/* The pager, when pages are not all the same size.

   The applications list never splits a joint tenancy across a boundary, so a
   page can run over pageSize and the real page count is not total/pageSize.
   Left to divide, the pager disables Next before the last page is reachable and
   those rows vanish with nothing on screen to suggest they exist. */
/* THE RANGE SEPARATOR IS A HYPHEN, 2026-10-01. These assertions pinned
   an EN DASH, which is what the component used to print. Matt: "No em
   dashes anywhere in emails, PDFs, CSV headers or screen text ...
   Replace any with a comma, colon or full stop." A range cannot take a
   comma or a colon, so it takes a hyphen, which is the correct
   plain-text typography and is not a dash at all.

   `noEmDashesInCustomerText.test.ts` keeps it that way, and checks the
   en dash as well as the em dash: the two are one keystroke apart and
   letting the other through would be the obvious failure. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';
import { Pager } from './Pager';

afterEach(cleanup);

describe('the uniform case is untouched', () => {
  it('hides itself when everything fits on one page', () => {
    const { container } = render(<Pager page={1} pageSize={20} total={20} onPage={() => {}} />);
    expect(container.querySelector('.pager')).toBeNull();
  });

  it('counts and ranges by division when told nothing else', () => {
    const { container } = render(<Pager page={2} pageSize={20} total={45} onPage={() => {}} noun="applications" />);
    expect(container.textContent).toMatch(/Showing 21-40 of 45 applications/);
    expect(container.textContent).toMatch(/Page 2 of 3/);
  });
});

describe('when pages are not uniform', () => {
  it('uses the real page count, so the last page stays reachable', () => {
    // Eight rows, four to a page — but a tenancy kept whole makes three pages.
    // Dividing would say two and strand the eighth row.
    const onPage = vi.fn();
    const { container } = render(
      <Pager page={3} pageSize={4} total={8} pageCount={3} range={[8, 8]} onPage={onPage} noun="applications" />,
    );
    expect(container.textContent).toMatch(/Page 3 of 3/);
    expect(container.textContent).toMatch(/Showing 8-8 of 8 applications/);
  });

  it('still lets you reach that page', () => {
    const onPage = vi.fn();
    const { container } = render(
      <Pager page={2} pageSize={4} total={8} pageCount={3} range={[4, 7]} onPage={onPage} noun="applications" />,
    );
    const next = [...container.querySelectorAll('button')].find((b) => /next/i.test(b.textContent ?? ''))!;
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(onPage).toHaveBeenCalledWith(3);
  });
});
