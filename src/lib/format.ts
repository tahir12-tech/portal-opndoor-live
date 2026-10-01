/* =====================================================================
   Display formatting helpers. Pure, display-layer only.
   ===================================================================== */

/**
 * #8 Title-case SHOUTED all-caps address data at the display layer only (stored
 * data is never changed). "LONDON" -> "London", "18 ONSLOW GARDENS" -> "18 Onslow
 * Gardens", while postcodes (uppercase runs adjacent to a digit, e.g. SW7, EC2A,
 * 1AA), mixed-case words and numbers are left untouched.
 */
export function titleCaseAddress(s: string | null | undefined): string {
  if (!s) return s ?? '';
  // Lookahead-only (no lookbehind, which older Safari cannot parse — this runs in
  // the browser). Match a SHOUTED word of 2+ letters (apostrophes allowed inside,
  // so possessives like EARL'S / KING'S / ST JOHN'S title-case to Earl's / King's /
  // St John's) preceded by a non-alphanumeric boundary and not followed by one, so
  // postcodes (SW7, EC2A, 1AA) and mixed-case names stay untouched.
  return s.replace(/(^|[^A-Za-z0-9'])([A-Z][A-Z']*[A-Z])(?![A-Za-z0-9])/g, (_m, pre, word) => pre + word[0] + word.slice(1).toLowerCase());
}

/**
 * A name in the possessive. WALK FIX 19.
 *
 * "Northgate Lettings's commission" should read "Northgate Lettings'
 * commission". It was formed by appending `${name}’s` at eight call sites, so
 * it was eight bugs; it is one now, and this is the one place to be wrong.
 *
 * THE RULE IS EXACTLY THE ONE MATT NAMED, and no wider: a name ending in s
 * takes the apostrophe alone. Names ending in x or z, or in a silent s, are
 * argued over by style guides and nobody has asked. Inventing a rule for them
 * here would be a second thing to be wrong about, so the omission is
 * deliberate and this sentence is the record of it.
 *
 * U+2019, the typographic apostrophe, because that is what every call site
 * that had it right already used.
 */
export function possessive(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  // An empty name must not become a bare apostrophe hanging in front of the
  // word it was meant to qualify.
  if (!n) return '';
  // Already possessive: a name stored as "Jones’" must not become "Jones’’s".
  if (n.endsWith('’') || n.endsWith("'")) return n;
  return /s$/i.test(n) ? `${n}’` : `${n}’s`;
}

/**
 * Format a commission rate (a fraction, 0–1) as a percentage to ONE decimal place.
 * NEVER rounds to a whole percent: a stored 9.5% (0.095) must render as "9.5%" and
 * can never be shown as — or mistaken for — 10% (0.10). 0.095 -> "9.5%",
 * 0.1 -> "10.0%", 0.25 -> "25.0%". Use this for every commission-rate display.
 */
export function fmtRatePct(rate: number | null | undefined): string {
  return `${((rate ?? 0) * 100).toFixed(1)}%`;
}



/**
 * Format an ISO/parseable date string as dd/mm/yyyy in the Europe/London
 * timezone (handles the GMT/BST shift consistently, regardless of the
 * viewer's own device timezone). Returns '' for a null/invalid input.
 */
/** A long, human date in Europe/London: "23 September 2026". '' for
    null/invalid. The prose shape; `formatDate` is the one every table,
    cell and label uses. */
export function formatLongDate(input: string | number | Date | null | undefined): string {
  if (!input) return '';
  /* A BARE 'YYYY-MM-DD' IS A CALENDAR DAY, as in formatDate: parsed as an
     instant it is midnight UTC, which is the day before once the clocks
     go back. */
  if (typeof input === 'string') {
    const m = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${Number(m[3])} ${MONTH_LONG[Number(m[2]) - 1]} ${m[1]}`;
  }
  const ymd = londonParts(input);
  return ymd ? `${ymd.d} ${MONTH_LONG[ymd.m - 1]} ${ymd.y}` : '';
}

/* =====================================================================
   ONE DATE FORMAT, EVERYWHERE ON SCREEN.

   Matt, 2026-10-01, verbatim: "Show dates the same way everywhere on
   screen ('29 Sep 2026'), including the supplier Referrals tab and
   'Live from' (e.g. 'Live from Aug 2026'), with one shared date
   formatter."

   WHAT WAS THERE. Eight spellings, counted: `dd/mm/yyyy` hand-rolled in
   four files, `formatLondonDate` (also dd/mm/yyyy) in three, a
   `toLocaleDateString('en-GB')` with no options, two with different
   options, a bare ISO string printed as-is on the supplier Referrals
   tab, and `YYYY-MM` printed as-is under "Live from". A reader moving
   between two tabs of the same page saw "2026-08" and "20/08/2026".

   WHY "29 Sep 2026" IS THE RIGHT ONE and dd/mm/yyyy is not: 03/04/2026
   is the third of April to half the world and the fourth of March to
   the other half, and this product has an API with American
   integrators. A named month cannot be read two ways.

   TWO SHAPES, because Matt's own example needs both: a day date and a
   month date. "Live from Aug 2026" has no day to show -- the column is
   a month and the control that edits it is `<input type="month">` -- so
   printing one would be inventing precision.

   AND `formatLondonDate` STAYS, dd/mm/yyyy and all. It is not a
   leftover: ApplicationDetail's tenancy-start amendment puts its output
   INTO a text input and parses it back, so that one is a wire format
   between the screen and itself, not something being read as a date.
   Changing it would have broken the parse quietly.
   ===================================================================== */
/* OUR OWN ABBREVIATIONS, not Intl's. Node's en-GB gives "Sept" for
   September and some ICU builds add a full stop, so the same date would
   print differently depending on which Node the page was built with --
   which is precisely the thing this file exists to stop. Only the
   TIMEZONE is left to Intl, because that part is a calendar calculation
   and not a matter of taste. */
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** The London year, month and day of an instant. Null for a bad input. */
function londonParts(input: string | number | Date): { y: string; m: number; d: number } | null {
  const date = new Date(input);
  if (isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(date);
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  const m = Number(get('month'));
  if (!m) return null;
  return { y: get('year'), m, d: Number(get('day')) };
}

/** A date as every screen shows it: "29 Sep 2026". '' for nothing. */
export function formatDate(input: string | number | Date | null | undefined): string {
  if (!input) return '';
  /* A BARE 'YYYY-MM-DD' IS A CALENDAR DAY, not an instant, and `new Date`
     reads it as midnight UTC -- which is the previous day once the clocks
     go back. Taken apart rather than parsed, so a date somebody typed is
     the date they typed. */
  if (typeof input === 'string') {
    const m = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${Number(m[3])} ${MONTH_SHORT[Number(m[2]) - 1]} ${m[1]}`;
  }
  const ymd = londonParts(input);
  return ymd ? `${ymd.d} ${MONTH_SHORT[ymd.m - 1]} ${ymd.y}` : '';
}

/** A month as every screen shows it: "Aug 2026". '' for nothing. */
export function formatMonth(input: string | number | Date | null | undefined): string {
  if (!input) return '';
  if (typeof input === 'string') {
    const m = input.trim().match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
    if (m) {
      const i = Number(m[2]) - 1;
      if (i >= 0 && i <= 11) return `${MONTH_SHORT[i]} ${m[1]}`;
    }
  }
  const ymd = londonParts(input);
  return ymd ? `${MONTH_SHORT[ymd.m - 1]} ${ymd.y}` : '';
}

/** A moment: "29 Sep 2026 · 14:30", London. The date half is the one every
    other date on screen uses, so a timestamp and a date agree. */
export function formatDateTime(input: string | number | Date | null | undefined): string {
  if (!input) return '';
  const d = new Date(input);
  if (isNaN(d.getTime())) return '';
  const day = formatDate(d);
  if (!day) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return `${day} \u00b7 ${get('hour')}:${get('minute')}`;
}

export function formatLondonDate(input: string | number | Date | null | undefined): string {
  if (!input) return '';
  const d = new Date(input);
  if (isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(d);
  const day = parts.find((p) => p.type === 'day')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  const year = parts.find((p) => p.type === 'year')!.value;
  return `${day}/${month}/${year}`;
}

/**
 * Format an ISO/parseable date string as dd/mm/yyyy - HH:mm in the
 * Europe/London timezone. Returns '' for a null/invalid input.
 */
export function formatLondonDateTime(input: string | number | Date | null | undefined): string {
  if (!input) return '';
  const d = new Date(input);
  if (isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const day = parts.find((p) => p.type === 'day')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  const year = parts.find((p) => p.type === 'year')!.value;
  const hour = parts.find((p) => p.type === 'hour')!.value;
  const minute = parts.find((p) => p.type === 'minute')!.value;
  return `${day}/${month}/${year} - ${hour}:${minute}`;
}

/**
 * Money, to the penny, for anything a reader might reconcile against a bank
 * statement or an invoice.
 *
 * ONE DEFINITION BECAUSE THERE WERE THREE, character-identical, in
 * Dashboard.tsx, FinanceSurfaces.tsx and SettlementBlocks.tsx -- three
 * surfaces that print the SAME settlement figures and so must agree by
 * construction rather than by coincidence. Fold F1's requirement is exactly
 * that: "assert every money figure in an export comes from one formatter",
 * and it is worth as much on the screens the exports are reconciled against.
 *
 * Always two decimals, never rounded up to the pound: a settlement that reads
 * 4,431 against an export reading 4,430.77 is the defect F1 was raised for.
 */
export function gbpPence(n: number): string {
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
