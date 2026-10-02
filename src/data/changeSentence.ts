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

/* =====================================================================
   A CHANGE COMES IN TWO SHAPES, AND ONLY ONE OF THEM IS A TRIPLE.

   Matt, 2026-10-01: "Agency page: add a 'Recent changes' list like the
   supplier's ... using the shared builder."

   The supplier's history is `partner_audit`, a (field, old, new) triple
   per row, so the builder took one. An agency's is mostly `org_audit`,
   which records an EVENT -- "created", "group_set", "agreement_created",
   "position_set" -- with a free-text detail.

   AN EVENT IS NOT A BEFORE-AND-AFTER and forcing it into a triple would
   mean inventing one: "action changed from nothing to created" is worse
   than useless. So the builder takes either, and a row brings whichever
   it has. That is still one builder, which is what the instruction is
   about -- two lists wording the same change two ways is the fault.
   ===================================================================== */
/** A row in any of the change lists: what moved, and from what to what. */
export interface ChangeLike {
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  /** The event shape: what happened, and the detail recorded with it. */
  action?: string | null;
  detail?: string | null;
}

/* WHAT EACH EVENT READS AS. A function of the detail rather than a fixed
   string, because the detail is where the actual value is -- and for most
   of these the stored detail is ALREADY a sentence somebody wrote when
   the row was inserted ("Rosa Vance now receives ... monthly commission
   statement"), so the right thing is to use it rather than to re-say it
   worse. */
const EVENTS: Record<string, (detail: string) => string> = {
  created: (d) => (d ? `Created: ${d}` : 'Created'),
  merged: (d) => d || 'Merged with another agency',
  group_set: (d) => (d ? `Moved into the ${d} group` : 'Moved into a group'),
  position_set: (d) => (d ? `Position set to ${d}` : 'Position set'),
  /* WHERE THE DEED GOES, which is what a contact is. The detail is the
     address itself on an add, and "was -> now" on a change, because
     "the contact was changed" does not answer the question somebody
     opens this list to ask. */
  contact_added: (d) => (d ? `Contact email set to ${d}` : 'A contact email was set'),
  contact_changed: (d) => {
    const [was, now] = d.split(' -> ');
    if (!now) return d ? `Contact email changed to ${d}` : 'The contact email was changed';
    return was === 'none'
      ? `Contact email set to ${now}`
      : `Contact email changed from ${was} to ${now}`;
  },
  commission_set: (d) => `Commission set to ${ratePair(d)}`,
  agreement_created: (d) => `Commission deal agreed${d ? `: ${d}` : ''}`,
  /* A SUPPLIER'S SHARE DEALS, which save_share_deal records with a
     sentence of its own ("Agents' share deal agreed for ZZZ Frost
     Partnership, counted per agency per month"). Used as written rather
     than re-said worse, like the rest of these. */
  agent_share_created: (d) => d || 'An agents’ share deal was agreed',
  agent_share_changed: (d) => d || 'An agents’ share deal was changed',
  agreement_superseded: (d) => d || 'The previous commission deal was ended',
  agreement_ended: (d) => d || 'The commission deal was ended',
  all_in_breach_confirmed: (d) => `All-in deal confirmed over a higher rate${d ? `: ${d}` : ''}`,
  commission_statements_on: (d) => d || 'Now receives the monthly commission statement',
  commission_statements_off: (d) => d || 'No longer receives the monthly commission statement',
  commission_statement_tick_cleared: (d) => d || 'Commission statements turned off with the level change',
  notifications_on: (d) => d || 'Now receives notifications',
  notifications_off: (d) => d || 'No longer receives notifications',
  invited: () => 'Invited',
  /* AND WHAT THEY WERE INVITED AS, in agency level names. Matt,
     2026-10-02: "'invited set to management' should read 'Independent
     Director invited as Director', using agency level names (Director,
     Manager, Negotiator) everywhere on agency pages."

     The subject's NAME is already on the row -- `AgencyChanges` draws
     it beside the sentence -- so this says the half the row does not:
     what level the invitation was for. `agency_changes` computes it, so
     the three names arrive here already written and this does not
     re-derive a level from a role it cannot tell apart. */
  invited_as: (d) => (d ? `Invited as ${d}` : 'Invited'),
  /* HOW THIS AGENCY'S TENANTS ARE CHECKED. Matt, 2026-10-02: "Changing
     it ... is recorded in Recent changes." The setter stores the two
     answers in his own words, separated by an arrow, so the sentence is
     assembled here rather than the words being invented twice. */
  tenant_check_changed: (d) => {
    const [was, now] = d.split(' -> ');
    if (!now) return d ? `Tenant checks changed to ${d}` : 'Tenant checks changed';
    return `Tenant checks changed from “${was}” to “${now}”`;
  },
};

/* "partner 0.25, agent 0.1" is what set_agency_rates stores, and it is
   the one detail in the list that is a pair of raw numbers rather than a
   sentence. Read as percentages, which is how every other rate on the
   screen is shown. */
function ratePair(detail: string): string {
  const m = detail.match(/partner\s+([^,]+),\s*agent\s+(.+)/i);
  if (!m) return detail;
  const pc = (v: string) => {
    const t = v.trim();
    if (t === 'inherit') return 'inherited';
    const n = Number(t);
    return Number.isFinite(n) ? `${Number((n * 100).toFixed(2))}%` : t;
  };
  return `${pc(m[1])} total, ${pc(m[2])} to the agents`;
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
/**
 * DID ANYTHING ACTUALLY CHANGE?
 *
 * Matt, 2026-10-02: "Recent changes: hide old entries where nothing
 * actually changed (e.g. 'Live from changed from August to August
 * 2026')."
 *
 * THESE ARE OLD ROWS, AND THE WRITE IS ALREADY FIXED.
 * `update_partner_settings` compares `date_trunc('month', ...)` on both
 * sides before recording a live_from change, so nothing new lands like
 * this. What is left is history: rows written when the two sides were
 * compared as a DATE and stored as a MONTH, so 2026-08-01 to 2026-08-14
 * was a change to the column and no change at all to the reader.
 *
 * ASKED THROUGH THE SENTENCE, not through the raw values. The reader
 * sees "August 2026" on both sides, and the reason is exactly that the
 * formatter collapses them -- so the formatter is the right judge of
 * whether anything moved. It also catches the next field that gains a
 * display format coarser than its storage, which a hand-written
 * `oldValue === newValue` would not.
 *
 * AN EVENT ROW IS NEVER A NO-OP: it records something that happened
 * rather than a field moving, and it has no two sides to compare.
 */
export function isNoOpChange(e: ChangeLike): boolean {
  if ((e.action ?? '').trim()) return false;
  const from = (e.oldValue ?? '').trim();
  const to = (e.newValue ?? '').trim();
  if (!from || !to) return false;
  if (from === to) return true;
  /* THE SAME FIELD, EACH SIDE ON ITS OWN, and compared as the reader
     would see them. `changeSentence` on the whole row says "changed
     from A to B"; rendering each side alone says what A and B ARE. */
  const say = (v: string) => changeSentence({ ...e, oldValue: '', newValue: v });
  return say(from) === say(to);
}

export function changeSentence(e: ChangeLike): string {
  /* THE EVENT SHAPE FIRST, where a row has one. A row never has both:
     the reader fills in one or the other. */
  const act = (e.action ?? '').trim();
  if (act) {
    const detail = (e.detail ?? '').trim();
    const said = EVENTS[act];
    if (said) return said(detail);
    /* AN EVENT NOBODY HAS WORDED still reads, the same way an unlabelled
       field does: the action with its underscores taken out, and the
       detail after it where there is one. */
    const name = act.replace(/_/g, ' ');
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    return detail ? `${label}: ${detail}` : label;
  }

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
