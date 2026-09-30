/* =====================================================================
   Real payment + refund metrics, computed from the live full-application set
   (Supabase mode). The dashboard funnel and volume charts remain the modelled
   portfolio view; these figures are the live payment truth, so refunds are
   honest and reported alongside without touching paid/conversion.

   In mock/test mode these figures fall back to the modelled view; the live
   values are computed only when the application set has been hydrated.
   ===================================================================== */
import { ORIGIN_ALL, originMatches, type OriginScope } from './origin';
import { SUPABASE_ENABLED } from '@/lib/supabase';
import type { PartnerScope, Period, Role } from './types';
import { reachableAgencyNames } from './orgService';
import { ALL_PARTNERS, readsTheWholeBook } from './types';
import { allFull, type FullApp } from './applicationsService';

/** Period date range. Real "today" in Supabase mode; the demo date otherwise. */
export function periodRange(period: Period): [Date, Date] {
  const now = SUPABASE_ENABLED ? new Date() : new Date(2026, 5, 26);
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const s = (yy: number, mm: number, dd: number) => new Date(yy, mm, dd, 0, 0, 0, 0);
  const e = (yy: number, mm: number, dd: number) => new Date(yy, mm, dd, 23, 59, 59, 999);
  switch (period.id) {
    case 'thismonth': return [s(y, m, 1), e(y, m + 1, 0)];
    case 'lastmonth': return [s(y, m - 1, 1), e(y, m, 0)];
    case 'last7': return [s(y, m, d - 6), e(y, m, d)];
    case 'last30': return [s(y, m, d - 29), e(y, m, d)];
    case 'last90': return [s(y, m, d - 89), e(y, m, d)];
    case 'last12m': return [s(y - 1, m, d), e(y, m, d)];
    /* ALL TIME ENDS IN THE FUTURE, NOT TODAY. Matt, 2026-09-30: "for any
       period it counts every executed deed whose 12-month cover overlaps
       the period, including cover that starts after today; for all time
       that is every executed deed."

       Clamped to today, "all time" silently excluded every guarantee whose
       cover has not started yet, because `inForceDuring` asks
       `tenancyStart <= end`. Measured on dev: FOUR of the five executed
       deeds start after today, so the headline Total guaranteed rent value
       was showing one of five.

       SAFE FOR EVERY OTHER MEASURE ON THIS RANGE, because the rest are
       event-based -- sent, paid, deed issued -- and an event cannot happen
       after today. Only a tenancy START is legitimately in the future, and
       admitting it is the whole point.

       THE TRAILING WINDOWS ARE NOT TOUCHED. Last 7 / 30 / 90 days and the
       last 12 months end today deliberately: cover starting next month does
       not overlap them, and saying it does would be a different error. */
    default: return [s(2024, 8, 1), e(y + 25, 11, 31)]; // all time, from 2024-09
  }
}

/** Role + partner + AGENCY isolation, matching the applications list rule,
    and then -- strictly afterwards -- the reader's own selection. */
export function scopeFull(
  apps: FullApp[], role: Role, scope: PartnerScope, sel: OriginScope = ORIGIN_ALL,
): FullApp[] {
  let set = apps;
  if (scope !== ALL_PARTNERS) set = set.filter((a) => a.partner === scope);
  /* THE PARTNER IS A ROUTE, NOT A COMPANY. Every agency on our own estate
     shares the house partner, so the line above narrows a Regent user to
     "every agency Opndoor carries". The server already narrows further and
     this says the same thing, so the two cannot quietly disagree. Null in mock
     mode means "do not narrow": see reachableAgencyNames. */
  if (scope !== ALL_PARTNERS) {
    const mine = reachableAgencyNames();
    if (mine) set = set.filter((a) => !a.agency || mine.has(a.agency));
  }
  /* Positive allowlist. This scopes the set every downstream metric is built
     from, so an unrecognised role reaching it with no filter handed over the
     whole partner book. A role not named here gets nothing, and that stays
     true: the fix below ADDS a name, it does not remove the default.

     WHY `opndoor_manager` WAS MISSING, and it is the failure mode the
     comment above invites. The allowlist is correct to be positive and
     correct to be conservative; what it cannot do is notice when a new role
     is created. `opndoor_manager` arrived in 20260922090000, months after
     this line, and nobody came back. So Opndoor's own operations staff were
     treated as an unrecognised role and every live figure on their
     Reporting page read zero -- reported by Matt as "the blank Reporting
     page for opndoor_manager".

     It failed in the safe direction, which is why it survived: they were
     shown too little, never too much.

     WHAT THE PRODUCT INTENDS, from App.tsx's own route comment:
     "opndoor_manager is Opndoor ops staff: it reads the whole book like an
     admin (its RLS read arms mirror superadmin) but cannot create referrals
     or reach the sensitive-settings routes below."

     AND READING THE BOOK IS NOT SEEING THE MONEY. Those are two
     permissions and only this one is widened here: `maySeeCommission` is a
     flat no for this role and stays so, which is what keeps every
     commission figure at zero for them while the volumes become real. */
  if (role === 'referrer') set = set.filter((a) => a.owner === 1);
  else if (!readsTheWholeBook(role)) set = [];
  /* THE READER'S SELECTION, LAST AND DELIBERATELY SO.
     Everything above is isolation: what this reader is permitted to see. This
     is preference: which of it they are currently looking at. Running it last
     means a selection can only ever NARROW what isolation already allowed, so
     no reader can select their way into another party's rows -- and if this
     line were ever deleted the page would show too MUCH of the reader's own
     book, which is visible, rather than somebody else's, which is not. */
  if (sel) set = set.filter((a) => originMatches(a, sel));
  return set;
}

export function inRange(x: Date | null, start: Date, end: Date): boolean {
  return !!x && x >= start && x <= end;
}

export type ExportBasisKind = 'referred' | 'paid' | 'deed' | 'activity';

/** Whether an application falls in the period on the chosen export basis. */
export function basisInPeriod(a: FullApp, basis: ExportBasisKind, start: Date, end: Date): boolean {
  if (basis === 'referred') return inRange(a.sentAt, start, end);
  if (basis === 'paid') return inRange(a.paidAt, start, end);
  if (basis === 'deed') return inRange(a.deedAt, start, end);
  return inRange(a.sentAt, start, end) || inRange(a.paidAt, start, end) || inRange(a.deedAt, start, end);
}

export interface AwaitingSignature {
  ref: string;
  branch: string;
  agency: string;
  sentAt: Date;
  /** When the tenant first opened the deed (null = not yet viewed). */
  viewedAt: Date | null;
  days: number;
}

/**
 * Deeds sent to the tenant for e-signature and still unsigned after the ageing
 * threshold (default 7 days). Live (Supabase) only; empty in mock/test mode.
 */
export function getAwaitingSignature(role: Role, scope: PartnerScope, thresholdDays = 7): AwaitingSignature[] {
  if (!SUPABASE_ENABLED || allFull().length === 0) return [];
  const now = new Date();
  const set = scopeFull(allFull(), role, scope);
  const out: AwaitingSignature[] = [];
  for (const a of set) {
    if (a.deedState !== 'awaiting_tenant' || !a.deedSentAt) continue;
    const days = Math.floor((now.getTime() - a.deedSentAt.getTime()) / 86_400_000);
    if (days > thresholdDays) out.push({ ref: a.ref, branch: a.branch, agency: a.agency, sentAt: a.deedSentAt, viewedAt: a.deedViewedAt, days });
  }
  return out.sort((x, y) => y.days - x.days);
}
