/* The About-step blocker once claimed date of birth and phone were missing when
   only the adverse-credit answer was. The completeness check was never at fault:
   it reads dob and phone correctly. These lock that, so the fix stays a message
   derived from the check rather than a static list that can drift from it. */
import { describe, expect, it } from 'vitest';
import { BASIC_FIELDS, fieldsComplete, firstMissingField, validatePhone } from './formSpec';

// A date input yields YYYY-MM-DD; a UK mobile as typed. Everything but the
// adverse-credit answer, exactly the reported case.
const filledExceptAdverse = {
  title: 'Mr', first_name: 'Sam', last_name: 'Okafor',
  phone: '07950446107', dob: '1997-11-20',
};

describe('the About completeness check reads dob and phone', () => {
  it('accepts the phone as typed', () => {
    expect(validatePhone('07950446107')).toBeNull();
  });

  it('flags only the adverse-credit answer, not dob or phone', () => {
    const missing = firstMissingField(BASIC_FIELDS, filledExceptAdverse);
    expect(missing?.name).toBe('adverse_credit');
    expect(missing?.name).not.toBe('dob');
    expect(missing?.name).not.toBe('phone');
  });

  it('is incomplete on the missing answer, complete once it is given', () => {
    expect(fieldsComplete(BASIC_FIELDS, filledExceptAdverse)).toBe(false);
    expect(fieldsComplete(BASIC_FIELDS, { ...filledExceptAdverse, adverse_credit: 'no' })).toBe(true);
  });
});
