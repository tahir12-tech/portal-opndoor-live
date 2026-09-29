/* THE AGENCY PEOPLE TAB DRAWS NO CONTROL ITS READER CANNOT USE.
 *
 * Round 6, M11. The "Receives notifications" tick on the agency People tab had
 * no isAdmin gate, unlike the commission tick in the very next column. But
 * `constants/nav.ts` gives an `opndoor_manager` the Agencies section, and
 * `set_receives_notifications` passes only on `is_admin()` or
 * `app_role() = 'management'`. An opndoor_manager is neither, so the control
 * rendered for them and every click raised 42501 with
 * "You can only change this for people at or below your own position, in your
 * own agency." -- a sentence that is not even true of them.
 *
 * The fix shows the VALUE and withholds the CONTROL: an opndoor_manager still
 * answers "why did this person not get it?", which is most of why they are
 * looking, and is not offered a switch that always errors.
 *
 * WHY A SOURCE TEST. The property is structural -- a control is inside an
 * isAdmin branch or it is not -- and rendering AgencyHome needs a whole agency
 * fixture, a route param and a hydrated org tree. Three render tests in this
 * suite already fail intermittently under load; adding a heavyweight one to
 * assert a one-line gate would trade a real check for a flaky one. The
 * BEHAVIOUR of set_receives_notifications is asserted properly in pgTAP
 * (commission_statement_recipients.test.sql and the notifications tests).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(process.cwd(), 'src', 'pages', 'Agencies', 'AgencyHome.tsx'), 'utf8');

/** The JSX cell that draws a control, from its opening `<td>` to the matching
 *  close. Crude but adequate: these cells do not nest another `<td>`. */
function cellAround(needle: string): string {
  const i = src.indexOf(needle);
  expect(i, `not found in AgencyHome: ${needle}`).toBeGreaterThan(-1);
  const open = src.lastIndexOf('<td', i);
  const close = src.indexOf('</td>', i);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return src.slice(open, close);
}

describe('the People tab', () => {
  it('has the two ticks it is supposed to have', () => {
    expect(src).toMatch(/NOTIFY_LABEL/);
    expect(src).toMatch(/COMMISSION_STATEMENT_LABEL/);
  });

  /* THE DEFECT. */
  it('withholds the notifications CONTROL from a reader who cannot set it', () => {
    const cell = cellAround('aria-label={`${NOTIFY_LABEL}');
    expect(cell).toMatch(/!isAdmin/);
  });

  it('but still shows them the value, because that is most of why they are looking', () => {
    const cell = cellAround('aria-label={`${NOTIFY_LABEL}');
    // A read-only Yes/No on the not-admin branch, not an empty cell.
    expect(cell).toMatch(/!isAdmin \?[\s\S]*notify\[r\.userId\] \? 'Yes' : 'No'/);
  });

  /* AND THE ONE BESIDE IT WAS ALREADY RIGHT, which is how the omission was
     visible at all: two adjacent controls, one gated and one not. */
  it('gates the commission tick the same way, as it always did', () => {
    const i = src.indexOf('COMMISSION_STATEMENT_LABEL}:');
    expect(i).toBeGreaterThan(-1);
    expect(src.lastIndexOf('{isAdmin && (', i)).toBeGreaterThan(-1);
  });
});
