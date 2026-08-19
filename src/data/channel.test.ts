/* The channel rule, which exists twice: here and in public.application_channel.
   These lock the four answers so a drift between them is a failing test rather
   than a CRM record attributed to the wrong rail. */
import { describe, expect, it } from 'vitest';
import { CHANNELS, channelOf } from './channel';

describe('how an application arrived', () => {
  it('the direct house route is Direct', () => {
    expect(channelOf({ partnerSlug: 'opndoor-direct', referencingMode: 'opndoor_referenced' })).toBe('Direct');
  });

  it('the provider house route is a hand-over, whatever its mode says', () => {
    expect(channelOf({ partnerSlug: 'referencing-partner', referencingMode: 'pre_referenced_open' })).toBe('Provider hand-over');
  });

  it('a partner rail where WE check is an agent referral', () => {
    expect(channelOf({ partnerSlug: 'some-agency', referencingMode: 'opndoor_referenced' })).toBe('Agent referral');
  });

  it('a partner rail already checked is a partner referral', () => {
    expect(channelOf({ partnerSlug: 'rightmove', referencingMode: 'pre_referenced_open' })).toBe('Partner referral');
    expect(channelOf({ partnerSlug: 'rightmove', referencingMode: 'pre_referenced_screened' })).toBe('Partner referral');
  });

  it('falls back to partner referral rather than throwing on missing data', () => {
    // Reachable in mock mode, where a hydrated row may have neither.
    expect(channelOf({ partnerSlug: null, referencingMode: null })).toBe('Partner referral');
  });

  it('the four values are the four the SQL returns', () => {
    expect(CHANNELS).toEqual(['Direct', 'Agent referral', 'Partner referral', 'Provider hand-over']);
  });
});
