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
import { changeSentence } from './changeSentence';

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
