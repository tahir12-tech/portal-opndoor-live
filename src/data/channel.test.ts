/* The channel rule, which exists twice: here and in public.application_channel.
   These lock the four answers so a drift between them is a failing test rather
   than a CRM record attributed to the wrong rail. */
import { describe, expect, it } from 'vitest';
import { CHANNELS, HOUSE_PARTNER_SLUGS, ROUTE_LABEL, channelOf, houseRouteLabel, isHousePartner } from './channel';

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

  it('the UI shows agencies and suppliers by name, not the SQL wording', () => {
    expect(ROUTE_LABEL['Direct']).toBe('Direct');
    expect(ROUTE_LABEL['Agent referral']).toBe('Agency referral');
    expect(ROUTE_LABEL['Partner referral']).toBe('Supplier referral');
    expect(ROUTE_LABEL['Provider hand-over']).toBe('Provider hand-over');
  });
});

describe('house / plumbing partners never surface', () => {
  it('recognises all three house partners, including opndoor-agents', () => {
    // opndoor-agents is the one that is NOT is_house_route in the DB, so it must
    // be caught here by slug or it leaks into every partner picker.
    expect(HOUSE_PARTNER_SLUGS).toEqual(['opndoor-direct', 'referencing-partner', 'opndoor-agents']);
    expect(isHousePartner('opndoor-agents')).toBe(true);
    expect(isHousePartner('opndoor-direct')).toBe(true);
    expect(isHousePartner('referencing-partner')).toBe(true);
  });

  it('leaves real partners alone', () => {
    expect(isHousePartner('rightmove')).toBe(false);
    expect(isHousePartner('meridian-group')).toBe(false);
    expect(isHousePartner(null)).toBe(false);
    expect(isHousePartner(undefined)).toBe(false);
  });

  it('shows the route label in place of the plumbing name', () => {
    expect(houseRouteLabel('opndoor-direct')).toBe('Direct');
    expect(houseRouteLabel('opndoor-agents')).toBe('Agency referral');
    expect(houseRouteLabel('referencing-partner')).toBe('Provider hand-over');
  });
});
