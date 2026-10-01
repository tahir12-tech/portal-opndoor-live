/* =====================================================================
   A CHANGE, IN PLAIN ENGLISH.

   Matt, 2026-10-01, verbatim: "Supplier Recent changes: show every
   change in plain English (e.g. 'API access turned on', 'Live from
   changed from August to September 2026'), never raw field names. Only
   record a change when a value actually changed. Same for agencies and
   anywhere else changes are listed."

   THE SECOND SENTENCE IS A WRITE-SIDE RULE and is not fixed here: see
   20261007260000, which stops `update_partner_settings` recording a
   "Live from 2026-08 -> 2026-08" row. No amount of wording repairs a
   record of something that did not happen.

   =====================================================================
   WHAT WAS ON THE SCREEN
   =====================================================================

     api_access_enabled   off -> on (existing keys work again)
     live_from            2026-08 -> 2026-09
     referencing_mode     pre_referenced_open -> opndoor_referenced

   Three raw column names, two raw enum values and an arrow. Every one
   of them is a thing the database calls itself. The reader is an
   administrator asking what somebody did to this supplier.

   =====================================================================
   ONE BUILDER, EVERY LIST
   =====================================================================

   "Same for agencies and anywhere else changes are listed." There are
   two lists today -- the supplier's Settings tab and the user panel on
   /users -- and they had a `Record<string, string>` of labels each,
   which had already drifted: one called `status` "Status" and the other
   called it "Status" by luck rather than by sharing.

   A change is a (field, old, new) triple whatever it is about, so the
   builder takes that and nothing else. A list that appears later gets
   the sentences for free, which is the point of Matt's "anywhere else".
   ===================================================================== */

/** A row in any of the change lists: what moved, and from what to what. */
export interface ChangeLike {
  field: string;
  oldValue: string | null | undefined;
  newValue: string | null | undefined;
}

/** What each field is called when somebody who does not work here reads it. */
const FIELD_NAME: Record<string, string> = {
  partner_rate: 'Total commission',
  agent_rate: "Agents' share",
  status: 'Status',
  live_from: 'Live from',
  name: 'Name',
  referencing_mode: 'Referencing',
  referrer_leaderboard: 'Referrer leaderboard',
  portal_referrals_enabled: 'Portal referrals',
  api_access_enabled: 'API access',
  opndoor_pays_agents: 'Who pays the agents',
  role: 'Role',
  reset_mfa: 'Two-factor',
};

/* THE FIELDS THAT ARE A SWITCH, which read "turned on" rather than
   "changed from off to on". Matt's own example is "API access turned
   on", and it is the shorter sentence because a switch has only the two
   positions: saying where it came from adds nothing. */
const SWITCHES: Record<string, string> = {
  api_access_enabled: 'API access',
  portal_referrals_enabled: 'Portal referrals',
};

/** The raw enum values, in the words the screens use for them. */
const VALUE_WORDS: Record<string, string> = {
  pre_referenced_open: 'Pre-referenced, open',
  pre_referenced_screened: 'Pre-referenced, screened',
  opndoor_referenced: 'opndoor referenced',
  full: 'Full',
  rankings: 'Rankings only',
  private: 'Private',
  active: 'Active',
  onboarding: 'Onboarding',
  paused: 'Paused',
  deactivated: 'Deactivated',
  pending: 'Invited',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** True where the value is one of the two positions of a switch. */
const ON_OFF = /^(on|off)\b/i;
const isOn = (v: string) => /^on\b/i.test(v.trim());

/** "2026-08" -> { month: 'August', year: '2026' }. Null for anything else. */
function asMonth(v: string): { month: string; year: string } | null {
  const m = v.trim().match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const i = Number(m[2]) - 1;
  if (i < 0 || i > 11) return null;
  return { month: MONTHS[i], year: m[1] };
}

const word = (v: string) => VALUE_WORDS[v.trim()] ?? v.trim();

/**
 * One change as a sentence.
 *
 * Never empty and never a raw field name: an unknown field falls back to
 * its own name with the underscores taken out, which is still readable
 * and is a great deal better than nothing while somebody adds it above.
 */
export function changeSentence(e: ChangeLike): string {
  const field = (e.field ?? '').trim();
  const from = (e.oldValue ?? '').trim();
  const to = (e.newValue ?? '').trim();

  /* A CREATION IS NOT A CHANGE, and reads as one sentence rather than as
     an arrow from nothing. */
  if (field === 'created') return to ? `Created: ${to}` : 'Created';

  /* A SWITCH. Matt's example. The trail stores a sentence in the new
     value for API access ("off (all existing keys stop working)"), which
     is worth keeping -- so the consequence is carried over rather than
     thrown away with the rest of the raw value. */
  const switchName = SWITCHES[field];
  if (switchName && ON_OFF.test(to)) {
    const tail = to.replace(/^on|^off/i, '').trim().replace(/^\((.*)\)$/, '$1');
    return `${switchName} turned ${isOn(to) ? 'on' : 'off'}${tail ? ` (${tail})` : ''}`;
  }

  /* A MONTH. "Live from changed from August to September 2026", and the
     year is said once where both are in it -- which is Matt's own
     example, and is how a person says it. */
  const a = asMonth(from);
  const b = asMonth(to);
  const label = FIELD_NAME[field] ?? field.replace(/_/g, ' ');
  if (b) {
    if (!a) return `${label} set to ${b.month} ${b.year}`;
    return a.year === b.year
      ? `${label} changed from ${a.month} to ${b.month} ${b.year}`
      : `${label} changed from ${a.month} ${a.year} to ${b.month} ${b.year}`;
  }

  /* THE EM DASH IS WRITTEN AS AN ESCAPE, not typed. It is not copy -- it
     is the placeholder `update_partner_settings` stores for "no value"
     (`coalesce(to_char(live_from,'YYYY-MM'), ...)`), so it has to be
     RECOGNISED here even though no screen may print one.
     `noEmDashesInCustomerText` cannot tell a comparison from a sentence,
     and it is right not to try: the rule is cheaper to keep than to
     qualify. */
  const NONE = ['', '-', '\u2014'];
  if (NONE.includes(from)) return `${label} set to ${word(to)}`;
  if (NONE.includes(to)) return `${label} cleared`;
  return `${label} changed from ${word(from)} to ${word(to)}`;
}
