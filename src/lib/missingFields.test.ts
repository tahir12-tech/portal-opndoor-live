/* =====================================================================
   WHAT HAPPENS WHEN SEND IS PRESSED AND SOMETHING IS MISSING.

   Matt, 2026-10-03: "New application form: when Send is pressed with required
   fields missing, scroll to the first missing field, highlight every missing
   field in red with 'Required', and show a message at the Send button: '3
   fields still need filling in' with a link that jumps to the first one. Same
   for every form in the portal."

   FOUR BEHAVIOURS, and the one he did not ask for in words is the one that
   made the other three reachable: the submit button has to stay pressable. It
   was `disabled={submitted && !isValid}` on the referral form and
   `disabled={!can}` on every dialog, so there was nothing to press, nothing
   to count and nowhere to jump. A reader who had filled in four of five
   fields was looking at a dead button and no mark saying which one was left.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { focusFirstInvalid, invalidFields, missingFieldsLine } from './missingFields';
import { REQUIRED, validateReferral, validateTenant, type ReferralValues } from './validation';

const EMPTY: ReferralValues = {
  title: '', first: '', middle: '', last: '', dob: '', email: '', phone: '',
  addr1: '', addr2: '', city: '', county: '', postcode: '',
  rent: '', tenancyStart: '', agency: '', branch: '',
  sharePercent: '100', shareAmount: '',
};

describe('the count sentence', () => {
  /* THE SINGULAR IS THE COMMONEST CASE and the one worth getting right: one
     field left is what a reader usually has, and "1 fields still need filling
     in" is the sort of thing that makes a careful person distrust the page. */
  it('agrees with itself on one', () => {
    expect(missingFieldsLine(1)).toBe('1 field still needs filling in');
  });

  it('and uses Matt’s own wording on more', () => {
    expect(missingFieldsLine(3)).toBe('3 fields still need filling in');
    expect(missingFieldsLine(11)).toBe('11 fields still need filling in');
  });

  // Nothing to say, so nothing is said: the component renders null on ''.
  it('says nothing at zero, or below it', () => {
    expect(missingFieldsLine(0)).toBe('');
    expect(missingFieldsLine(-2)).toBe('');
  });
});

describe('"Required" where it is empty, the reason where it is wrong', () => {
  /* MATT'S WORD, AND IT IS THE TIGHTER ONE: "Enter a first name", under a
     label reading "First name *", says nothing the label has not. */
  it('marks an empty field Required', () => {
    const e = validateReferral(EMPTY);
    for (const k of ['title', 'first', 'last', 'dob', 'email', 'phone', 'addr1', 'city', 'postcode', 'rent', 'tenancyStart'] as const) {
      expect(e[k], k).toBe(REQUIRED);
    }
  });

  /* AND NOT WHERE THE READER HAS FILLED IT IN. "Required" on a malformed
     postcode tells somebody they have not typed anything when they have,
     which is worse than the old message rather than tighter than it. */
  it('and says what is actually wrong where there is a value', () => {
    const v: ReferralValues = {
      ...EMPTY, postcode: 'NOT A POSTCODE', email: 'nope', rent: '0',
      phone: 'abc', dob: '1990-13-45', tenancyStart: '2026-11-01',
    };
    const e = validateReferral(v);
    expect(e.postcode).toBe('Enter a valid UK postcode');
    expect(e.email).toBe('Enter a valid email address');
    expect(e.rent).toBe('Enter a monthly rent greater than 0');
    expect(e.phone).toBe('Enter a phone number');
    expect(e.dob).toBe('Enter a valid date of birth');
    expect(e.tenancyStart).toBeUndefined();
  });

  /* THE AGE RULES KEEP THEIR OWN SENTENCES, which carry a real fact about
     the tenancy and could never be replaced by one word. */
  it('and keeps the age sentences, which say something a label cannot', () => {
    const e = validateTenant(
      { ...EMPTY, title: 'Mr', first: 'A', last: 'B', email: 'a@b.co', phone: '07700 900000', dob: '2020-01-01' },
      '2026-11-01',
    );
    expect(e.dob).toBe('Tenant must be 18 by the tenancy start date.');
  });
});

describe('reading the missing fields off the page', () => {
  /* THE DOM IS THE SOURCE, which is the design decision this file exists to
     pin. `Field` already marks what it is showing an error for, in the order
     the reader sees, so the count, the first one and the jump all come from
     one query and a field added tomorrow is included without wiring. */
  const page = (html: string) => {
    const d = document.createElement('div');
    d.innerHTML = html;
    document.body.appendChild(d);
    return d;
  };

  it('finds them in the order they appear, not the order they were declared', () => {
    const form = page(`
      <div class="field"><input id="ok"></div>
      <div class="field is-invalid"><input id="second"></div>
      <div class="field"><input id="ok2"></div>
      <div class="field is-invalid"><input id="fourth"></div>
    `);
    expect(invalidFields(form).length).toBe(2);
    expect(invalidFields(form)[0].querySelector('input')!.id).toBe('second');
  });

  it('counts nothing on a form with nothing wrong', () => {
    expect(invalidFields(page('<div class="field"><input></div>')).length).toBe(0);
  });

  // A caller whose ref has not attached yet, which is every first render.
  it('and nothing at all when there is no form', () => {
    expect(invalidFields(null)).toEqual([]);
    expect(focusFirstInvalid(null)).toBeNull();
  });

  /* THE CURSOR GOES IN THE CONTROL, not on the wrapper. Arriving at the right
     part of a long form with the cursor somewhere else means typing into
     nothing, which is the failure a scroll on its own leaves behind. */
  it('puts the cursor in the first missing field’s own control', () => {
    const form = page(`
      <div class="field"><input id="fine"></div>
      <div class="field is-invalid"><label>Postcode</label><input id="pc"></div>
      <div class="field is-invalid"><input id="later"></div>
    `);
    const found = focusFirstInvalid(form);
    expect(found).toBeTruthy();
    expect(document.activeElement?.id).toBe('pc');
  });

  it('and works on a field whose control is a select', () => {
    const form = page('<div class="field is-invalid"><select id="sel"><option></option></select></div>');
    focusFirstInvalid(form);
    expect(document.activeElement?.id).toBe('sel');
  });
});
