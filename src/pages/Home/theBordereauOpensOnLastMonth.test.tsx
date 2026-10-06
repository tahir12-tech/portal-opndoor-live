/* THE BORDEREAU OPENED ON JUNE, FOR THREE MONTHS.
 *
 * Matt, 2026-10-03, verbatim: "Monthly bordereau dialog: default the month to
 * the last complete calendar month (today that's September 2026), not a fixed
 * month. Also show 'last changed 7 Aug 2026' in the same date style as the
 * rest of the portal."
 *
 * The month was '2026-06' written straight into the state. That was last month
 * once, in June. Since then every export has begun by correcting the control,
 * and one run without looking covered the wrong month entirely -- which on this
 * document means invoicing the underwriter for the wrong book.
 *
 * AND THE CEILING WAS A SECOND FIXED DATE: `max="2026-12"`, three months after
 * go-live, which would have started refusing the default the moment it passed.
 * It is the same month as the default now, which is the honest bound: there is
 * no bordereau for a month that has not finished.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { FinanceSurfaces } from './FinanceSurfaces';
import { ALL_PARTNERS } from '@/data/types';

afterEach(cleanup);

const SRC = readFileSync('src/pages/Home/FinanceSurfaces.tsx', 'utf8');
/* THE CODE WITHOUT ITS COMMENTS. Every literal this file asserts is GONE is
   still named in the comment explaining what it used to be, which is the
   point of the comment, so a scan of the raw source would find all of them. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function open() {
  return render(
    <MemoryRouter>
      <SessionProvider><ToastProvider>
        <FinanceSurfaces role="superadmin" partnerScope={ALL_PARTNERS} />
      </ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
}

/** The month the dialog should be showing, worked out the other way round from
    the component: step back to the 1st, then one day. */
function expectedMonth(): string {
  const n = new Date();
  const first = new Date(n.getFullYear(), n.getMonth(), 1);
  const prev = new Date(first.getTime() - 86400000);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}

describe('the monthly bordereau dialog', () => {
  it('opens on the last complete calendar month', () => {
    const { getByRole, container } = open();
    fireEvent.click(getByRole('button', { name: /Bordereau/i }));
    const input = container.querySelector('#bdx-month') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe(expectedMonth());
  });

  it('and will not offer a month that has not finished', () => {
    const { getByRole, container } = open();
    fireEvent.click(getByRole('button', { name: /Bordereau/i }));
    const input = container.querySelector('#bdx-month') as HTMLInputElement;
    expect(input.getAttribute('max')).toBe(expectedMonth());
  });

  /* NOT A LITERAL ANYWHERE, which is the actual defect: the value, the
     fallback inside the export handler and the input's ceiling were three
     separate constants and only one of them was ever noticed. */
  it('with no fixed month left in the code', () => {
    // CODE ONLY: both literals are still named in the comments that explain
    // what they were, which is where they belong.
    expect(CODE).not.toContain("'2026-06'");
    expect(CODE).not.toContain('max="2026-12"');
    expect(SRC).toContain('useState(lastCompleteMonth)');
    expect(SRC).toContain('bdxMonth || lastCompleteMonth()');
  });
});

describe('the rate hint', () => {
  /* "7 Aug 2026", NOT "07/08/2026". formatDate is the portal's one date;
     formatLondonDate is dd/mm/yyyy, which src/lib/format.ts keeps only as a
     wire format for the one input that parses its own output back. */
  it('prints its date through the portal formatter', () => {
    expect(SRC).toContain('last changed ${formatDate(m.changedAt)}');
  });

  /* AND SO DO THE TWO SETTLEMENT TABLES ON THE SAME PAGE. Fixing only the
     hint would have left one surface printing dates two ways a scroll apart,
     which is the thing the one-format rule exists for. */
  it('and nothing on this surface uses dd/mm/yyyy any more', () => {
    expect(SRC).toContain('const dmyShort = (x: Date) => formatDate(x);');
    expect(CODE).not.toContain('formatLondonDate');
  });
});
