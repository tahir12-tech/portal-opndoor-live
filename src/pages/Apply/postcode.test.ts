/* The postcode field's contract with the shared lookup service.

   The lookup itself is src/data/addressService.ts and is the staff form's; what
   is tested here is the mapping, because that is the part this form owns and the
   part that would silently write an address into the wrong columns. */
import { describe, expect, it } from 'vitest';
import { PROPERTY_FIELDS, addressFields, employmentFields } from '@/tenant/formSpec';

const find = (fields: ReturnType<typeof employmentFields>, name: string) =>
  fields.find((f) => f.name === name);

describe('postcode fields declare what an address fills', () => {
  it('the property writes into the property columns', () => {
    const f = find(PROPERTY_FIELDS, 'prop_postcode');
    expect(f?.kind).toBe('postcode');
    expect(f?.fills).toEqual({
      line1: 'prop_addr1', line2: 'prop_addr2',
      city: 'prop_city', county: 'prop_county', postcode: 'prop_postcode',
    });
  });

  it('an address in the history writes into the address columns, which are named differently', () => {
    const f = find(addressFields(true), 'postcode');
    expect(f?.fills?.line1).toBe('address_1');
    expect(f?.fills?.city).toBe('city');
    // The property's column names must not leak into an address row.
    expect(f?.fills?.line1).not.toBe('prop_addr1');
  });

  it('an employer address collapses into one field, because that is how it is stored', () => {
    const f = find(employmentFields('permanent'), 'employer_postcode');
    expect(f?.fills?.single).toBe('employer_address');
    expect(f?.fills?.line1).toBeUndefined();
  });

  it('every postcode field declares a target, or the lookup silently does nothing', () => {
    const all = [
      ...PROPERTY_FIELDS,
      ...addressFields(true),
      ...addressFields(false),
      ...employmentFields('permanent'),
      ...employmentFields('self_employed'),
    ];
    for (const f of all.filter((x) => x.kind === 'postcode')) {
      expect(f.fills, `${f.name} has no fills`).toBeTruthy();
      expect(f.fills?.postcode, `${f.name} does not write back its own postcode`).toBeTruthy();
    }
  });
});
