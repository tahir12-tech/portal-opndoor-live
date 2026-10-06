/* =====================================================================
   WHAT THE API DOCUMENTATION PROMISES ABOUT CREATING AN AGENCY.

   Matt, 2026-10-03: "the API can create the agency (name, address, agency
   email) and office for that supplier, checked against existing ones for
   duplicates, landing in Reconciliation. Document it on the API documentation
   page." And, approving: "opt-in flag defaulting to false, suppliers only,
   agency email required, reuse on an exact (normalised) match, refuse on
   ambiguous, land in Reconciliation, response says what was created, audited
   with the key name."

   THE DOCUMENTATION IS A PROMISE TO A THIRD PARTY, which is what makes it
   worth a test rather than a proofread. An integrator builds against these
   sentences, and the two that would cost real money if they drifted are:

     "it is off unless you ask"      a partner who reads that creation is
                                     possible and finds it refused will send
                                     the same call again, and again.
     "a retry after a timeout is     the whole reason reuse is on a normalised
      safe"                          match. If that stopped being true, every
                                     timeout would leave a second agency.

   THE BEHAVIOUR ITSELF IS PROVED IN SQL, in
   a_near_miss_is_flagged.test.sql, against the real functions. This file is
   about whether we have told anybody.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const md = readFileSync(join(process.cwd(), 'PARTNER-DOCS.md'), 'utf8');
const generated = readFileSync(join(process.cwd(), 'src/pages/DevCentre/partnerDocs.generated.ts'), 'utf8');

describe('the documentation says it exists', () => {
  it('has its own section', () => {
    expect(md).toContain('### Creating an agency from the API');
  });

  /* AND IT REACHED THE PAGE. The source is PARTNER-DOCS.md and the Dev
     Centre renders a GENERATED file, so a section added to the source and not
     regenerated is documented nowhere a partner can read it. */
  it('and it is in the file the Dev Centre renders', () => {
    expect(generated).toContain('Creating an agency from the API');
  });
});

describe('the eight rules Matt approved', () => {
  it('says it is off unless asked, first and plainly', () => {
    expect(md).toContain('**This is off unless opndoor has switched it on for your account.**');
    // And in the Organisations preamble, where a reader starts.
    expect(md).toContain('It is off unless you ask.');
  });

  /* THE DEFAULT IS IN THE DATABASE, and this is the line that would have to
     change with it. `api_may_create_agencies` is NOT NULL DEFAULT false. */
  it('and the column really defaults to false', () => {
    const mig = readFileSync(
      join(process.cwd(), 'supabase/migrations/20261007930000_the_api_can_create_an_agency.sql'),
      'utf8',
    );
    expect(mig).toMatch(/api_may_create_agencies boolean NOT NULL DEFAULT false/);
  });

  it('says the agency email is required, and why', () => {
    expect(md).toContain('`agency_email` is **required** to create an agency');
    expect(md).toContain('signed deeds for its\nbranches are sent there');
  });

  it('says the office email is optional', () => {
    expect(md).toContain('`branch_email` is optional and overrides it for that\none branch');
  });

  /* THE RETRY PROMISE. An integrator whose call times out will send it again,
     and this sentence is why that is safe. */
  it('says a retry is safe, and on what rule', () => {
    expect(md).toContain('**Nothing is duplicated.**');
    expect(md).toContain('ignoring case, surrounding whitespace and a trailing `Ltd` or\n`Limited`');
    expect(md).toContain('a\nretry after a timeout is safe');
  });

  it('says ambiguity is refused rather than guessed', () => {
    expect(md).toContain('**Ambiguity is refused rather than guessed.**');
    expect(md).toContain('rejected as `ambiguous`');
  });

  it('says what the response tells you, and that the field can be absent', () => {
    expect(md).toContain('"created": ["agency", "branch"]');
    expect(md).toContain('**absent when nothing was**');
  });

  it('says it is held for review, and that this does not hold the tenant up', () => {
    expect(md).toContain('**held for review by opndoor**');
    expect(md).toContain('sent to the tenant\nimmediately');
  });

  /* MATT'S ADDITION, told to the partner as well as done. It is their typo,
     so they are the one who can stop making it. */
  it('says a near miss is flagged, with an example', () => {
    expect(md).toContain('near misses');
    expect(md).toMatch(/Foo Lettigns/);
  });

  it('and says the key is recorded by name', () => {
    expect(md).toContain('recorded against the API key that made it, by name');
  });
});

describe('the error the integrator will actually hit', () => {
  /* THE DOCUMENTED MESSAGE IS THE SERVER'S MESSAGE, word for word. A quoted
     error that has drifted from the real one is worse than no quote: the
     integrator greps their logs for a sentence we no longer send. */
  it('is quoted exactly as the server sends it', () => {
    const fn = readFileSync(
      join(process.cwd(), 'supabase/functions/_shared/partnerApplications.ts'),
      'utf8',
    );
    const sentence = 'We do not hold an agency of that name. Send agency_email as well and we will create it: signed deeds for its offices go to that address.';
    expect(fn).toContain(sentence);
    // The markdown wraps it across lines, so compare on the collapsed text.
    expect(md.replace(/\s+/g, ' ')).toContain(sentence);
  });
});
