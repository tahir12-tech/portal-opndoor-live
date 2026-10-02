/* A CHANGE, IN PLAIN ENGLISH.
 *
 * Matt, 2026-10-01, verbatim: "Supplier Recent changes: show every change in
 * plain English (e.g. 'API access turned on', 'Live from changed from August
 * to September 2026'), never raw field names. Only record a change when a
 * value actually changed. Same for agencies and anywhere else changes are
 * listed."
 *
 * The second sentence is the database's half and
 * a_change_is_only_a_change.test.sql holds it. This file is the wording.
 */
import { describe, expect, it } from 'vitest';
import { changeSentence, isNoOpChange } from './changeSentence';

const say = (field: string, oldValue: string, newValue: string) =>
  changeSentence({ field, oldValue, newValue });

describe('Matt’s two examples', () => {
  it('"API access turned on"', () => {
    expect(say('api_access_enabled', 'off', 'on')).toBe('API access turned on');
  });

  /* THE YEAR ONCE, where both months are in it. That is how a person says
     it and it is how Matt wrote it. */
  it('"Live from changed from August to September 2026"', () => {
    expect(say('live_from', '2026-08', '2026-09'))
      .toBe('Live from changed from August to September 2026');
  });
});

describe('a switch', () => {
  it('reads as turned off, not as a journey from on', () => {
    expect(say('portal_referrals_enabled', 'on', 'off')).toBe('Portal referrals turned off');
  });

  /* THE TRAIL STORES A CONSEQUENCE in the new value for API access, and it
     is the sentence somebody investigating an outage needs. Carried over
     rather than thrown away with the rest of the raw value. */
  it('and keeps the consequence the trail recorded with it', () => {
    expect(say('api_access_enabled', 'on', 'off (all existing keys stop working)'))
      .toBe('API access turned off (all existing keys stop working)');
  });
});

describe('a month', () => {
  it('says both years when they differ', () => {
    expect(say('live_from', '2025-12', '2026-01'))
      .toBe('Live from changed from December 2025 to January 2026');
  });
  it('and reads as set where there was nothing before', () => {
    expect(say('live_from', '—', '2026-09')).toBe('Live from set to September 2026');
  });
  it('and as cleared where there is nothing after', () => {
    expect(say('live_from', '2026-09', '—')).toBe('Live from cleared');
  });
});

describe('never a raw field name or a raw value', () => {
  it('names the field the way the screen does', () => {
    expect(say('partner_rate', '25.0%', '30.0%'))
      .toBe('Total commission changed from 25.0% to 30.0%');
    expect(say('agent_rate', '10.0%', '12.0%'))
      .toBe("Agents' share changed from 10.0% to 12.0%");
  });

  /* THE ENUMS ARE THE WORST OF IT: `pre_referenced_open` is a database
     value and means nothing to the person reading the trail. */
  it('and the value the way the control that sets it does', () => {
    expect(say('referencing_mode', 'pre_referenced_open', 'opndoor_referenced'))
      .toBe('Referencing changed from Pre-referenced, open to opndoor referenced');
  });

  it('including the leaderboard, which had a second set of words', () => {
    expect(say('referrer_leaderboard', 'full', 'private'))
      .toBe('Referrer leaderboard changed from Full to Private');
  });

  it('and a user’s status, which is the other list', () => {
    expect(say('status', 'active', 'deactivated'))
      .toBe('Status changed from Active to Deactivated');
  });

  /* A CREATION IS NOT A CHANGE and has no "from". */
  it('and a creation reads as one', () => {
    expect(say('created', '', 'ZZZ Co (zzz), active'))
      .toBe('Created: ZZZ Co (zzz), active');
  });

  /* AND AN UNKNOWN FIELD STILL READS. The fallback is the field with its
     underscores taken out, which is worse than a real label and much
     better than `some_new_column`. */
  it('and a field nobody has labelled yet is still readable', () => {
    expect(say('some_new_column', 'a', 'b')).toBe('some new column changed from a to b');
  });

  it('with no raw underscore left anywhere', () => {
    const all = [
      say('api_access_enabled', 'off', 'on'),
      say('portal_referrals_enabled', 'on', 'off'),
      say('live_from', '2026-08', '2026-09'),
      say('referencing_mode', 'pre_referenced_open', 'pre_referenced_screened'),
      say('opndoor_pays_agents', 'the supplier pays its own agents', 'opndoor pays the agents'),
    ].join(' | ');
    expect(all).not.toMatch(/_/);
  });
});

/* ===========================================================================
   AND THE EVENT SHAPE, which is how an agency's history is kept.

   Matt, 2026-10-01: "Agency page: add a 'Recent changes' list like the
   supplier's ... using the shared builder."

   `org_audit` records an action and a free-text detail, not a triple. An
   event is not a before-and-after, so the builder takes either rather than
   inventing one: "action changed from nothing to created" would be worse
   than no sentence at all.
   =========================================================================== */
const ev = (action: string, detail = '') => changeSentence({ action, detail });

describe('an event rather than a triple', () => {
  it('reads a branch being created', () => {
    expect(ev('created', 'Chelsea')).toBe('Created: Chelsea');
  });

  it('and a move into a group', () => {
    expect(ev('group_set', 'Northgate')).toBe('Moved into the Northgate group');
  });

  it('and a position, which the reader has already resolved to a place', () => {
    expect(ev('position_set', 'the Chelsea branch')).toBe('Position set to the Chelsea branch');
  });

  /* THE ONE DETAIL THAT IS RAW NUMBERS. `set_agency_rates` stores
     "partner 0.25, agent 0.1", which is the only row in org_audit that is
     not already a sentence somebody wrote. */
  it('and turns the stored rate pair into percentages', () => {
    expect(ev('commission_set', 'partner 0.2500, agent 0.1000'))
      .toBe('Commission set to 25% total, 10% to the agents');
  });

  it('including an inherited one, which is not a number at all', () => {
    expect(ev('commission_set', 'partner 0.2500, agent inherit'))
      .toBe('Commission set to 25% total, inherited to the agents');
  });

  it('and a deal being agreed', () => {
    expect(ev('agreement_created', 'additive agreement, volume per agency per year'))
      .toBe('Commission deal agreed: additive agreement, volume per agency per year');
  });

  /* MOST DETAILS ARE ALREADY A SENTENCE, written when the row was
     inserted. Re-saying them would be saying them worse. */
  it('and uses the sentence the trail already recorded, where there is one', () => {
    expect(ev('commission_statements_on', 'Rosa Vance now receives the monthly statement'))
      .toBe('Rosa Vance now receives the monthly statement');
  });

  it('falling back to a plain one where the detail is empty', () => {
    expect(ev('commission_statements_on')).toBe('Now receives the monthly commission statement');
  });

  /* AN EVENT NOBODY HAS WORDED still reads, like an unlabelled field. */
  it('and an action nobody has worded yet is still readable', () => {
    expect(ev('some_new_event', 'with a detail')).toBe('Some new event: with a detail');
    expect(ev('some_new_event')).toBe('Some new event');
  });

  it('with no raw underscore left anywhere', () => {
    const all = [
      ev('position_set', 'the Chelsea branch'),
      ev('commission_statements_off', ''),
      ev('agreement_superseded', ''),
      ev('some_new_event', ''),
    ].join(' | ');
    expect(all).not.toMatch(/_/);
  });

  /* AND THE TRIPLE SHAPE STILL WORKS, because the supplier's list and
     the agency's people both use it. */
  it('while a triple is still a triple', () => {
    expect(changeSentence({ field: 'status', oldValue: 'active', newValue: 'deactivated' }))
      .toBe('Status changed from Active to Deactivated');
  });
});

/* =====================================================================
   AND THE ROWS THAT SAY NOTHING, 2026-10-02.

   Matt: "Recent changes: hide old entries where nothing actually
   changed (e.g. 'Live from changed from August to August 2026')."

   THE WRITE WAS ALREADY FIXED. `update_partner_settings` compares
   `date_trunc('month', ...)` before recording a live_from change, so
   nothing new lands like this; these are rows written before that, when
   the two sides were compared as a DATE and stored as a MONTH.
   ===================================================================== */
describe('a change that changed nothing', () => {
  /* MATT'S EXAMPLE, IN THE SHAPE IT IS ACTUALLY STORED.
     `update_partner_settings` writes `to_char(live_from,'YYYY-MM')` on
     both sides, so a row whose DATE moved within one month arrives here
     with two identical strings -- and renders as "changed from August
     to August 2026", which is the sentence he quoted. */
  it('is spotted on Matt’s own example', () => {
    const row = { field: 'live_from', oldValue: '2026-08', newValue: '2026-08' };
    expect(changeSentence(row)).toBe('Live from changed from August to August 2026');
    expect(isNoOpChange(row)).toBe(true);
  });

  it('and on any other field whose two sides are the same', () => {
    expect(isNoOpChange({ field: 'name', oldValue: 'Kestrel', newValue: 'Kestrel' })).toBe(true);
  });

  /* AND THE SECOND ARM, which is the one that earns the predicate its
     place over a plain `oldValue === newValue`: two DIFFERENT stored
     values that the reader is shown as one thing. Nothing writes this
     today; it is what the next field with a display format coarser
     than its storage will do, which is exactly how live_from did it. */
  it('and when two different values are shown as the same thing', () => {
    expect(isNoOpChange({ field: 'status', oldValue: 'active', newValue: 'active ' })).toBe(true);
  });

  /* AND A REAL CHANGE IS NOT HIDDEN, which is the half that matters:
     a filter that swallowed real history would be worse than the noise
     it was added to remove. */
  it('while a real one is not', () => {
    expect(isNoOpChange({ field: 'live_from', oldValue: '2026-08', newValue: '2026-09' }))
      .toBe(false);
    expect(isNoOpChange({ field: 'name', oldValue: 'Kestrel', newValue: 'Kestrel Lettings' }))
      .toBe(false);
  });

  /* NOR AN EVENT, which records something that happened rather than a
     field moving and has no two sides to compare. */
  it('and an event row is never one', () => {
    expect(isNoOpChange({ action: 'created', detail: 'Kestrel Central' })).toBe(false);
    expect(isNoOpChange({ action: 'contact_added', detail: 'desk@zzz.test' })).toBe(false);
  });

  it('and a one-sided row is left alone, because it is not a comparison', () => {
    expect(isNoOpChange({ field: 'live_from', oldValue: '', newValue: '2026-08-01' })).toBe(false);
  });
});
