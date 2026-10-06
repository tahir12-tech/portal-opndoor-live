/* "PRE-REFERENCED, SCREENED" IS NOT A SENTENCE ANYBODY CAN ANSWER.
 *
 * Matt, 2026-10-03, verbatim: "Add supplier form (and supplier Settings):
 * replace the 'Referencing mode' dropdown with the same plain-English radio
 * question as the agency page, 'How are this supplier's tenants checked?', one
 * line each:
 *   - 'They check tenants, and Opndoor applies its own criteria too' (screened)
 *   - 'They check tenants, and Opndoor accepts them as sent' (open)
 *   - 'Opndoor checks tenants itself'.
 * Rewrite the Capabilities intro as: 'How this supplier sends referrals:
 * through the portal, through the API, or both.' Remove the line about
 * agencies and CRMs."
 *
 * THE DROPDOWN'S PROBLEM WAS NOT ITS WORDS, IT WAS ITS SHAPE. Three mutually
 * exclusive answers that each need a sentence do not fit in a select: the
 * explanation can only be shown for the option already chosen, so the one
 * answer you could read about was the one you had already picked. The agency
 * page worked this out on 2026-10-02 and the supplier forms kept the select,
 * one copy each.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { TenantsChecked } from './TenantsChecked';
import { REFERENCING_MODES } from '@/data';

afterEach(cleanup);

const read = (p: string) => readFileSync(p, 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the three lines', () => {
  /* ON THE MODE LIST, beside the ids, so the control and the confirmation
     cannot disagree about what was chosen. */
  it('are Matt’s, word for word, against the right modes', () => {
    const byId = Object.fromEntries(REFERENCING_MODES.map((m) => [m.id, m.choice]));
    expect(byId.pre_referenced_screened).toBe('They check tenants, and Opndoor applies its own criteria too');
    expect(byId.pre_referenced_open).toBe('They check tenants, and Opndoor accepts them as sent');
    expect(byId.opndoor_referenced).toBe('Opndoor checks tenants itself');
  });

  /* AND THE SHORT NAME SURVIVES. A chip on the supplier's own page has room
     for two words, and "They check tenants, and Opndoor applies its own
     criteria too" is not a chip. Two labels for two jobs, not one label
     stretched over both. */
  it('while the short names stay, for the chip that has no room', () => {
    expect(REFERENCING_MODES.map((m) => m.label))
      .toEqual(['Pre-referenced, screened', 'Pre-referenced, open', 'opndoor referenced']);
  });
});

describe('drawn', () => {
  it('asks the question and offers the three answers as radios', () => {
    const { container, getByText } = render(
      <TenantsChecked name="t" value="pre_referenced_screened" onChange={() => {}} />,
    );
    getByText('How are this supplier’s tenants checked?');
    const radios = container.querySelectorAll<HTMLInputElement>('input[type="radio"][name="t"]');
    expect(radios).toHaveLength(3);
    expect([...radios].map((r) => r.value))
      .toEqual(['pre_referenced_screened', 'pre_referenced_open', 'opndoor_referenced']);
  });

  it('shows which one is set, and only that one', () => {
    const { container } = render(
      <TenantsChecked name="t" value="opndoor_referenced" onChange={() => {}} />,
    );
    const on = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')].filter((r) => r.checked);
    expect(on.map((r) => r.value)).toEqual(['opndoor_referenced']);
    expect(container.querySelectorAll('.ah-route__opt.is-on')).toHaveLength(1);
  });

  it('reports a change, and says nothing when the same one is clicked again', () => {
    const seen: string[] = [];
    const { getByText } = render(
      <TenantsChecked name="t" value="pre_referenced_screened" onChange={(v) => seen.push(v)} />,
    );
    fireEvent.click(getByText('Opndoor checks tenants itself'));
    fireEvent.click(getByText('They check tenants, and Opndoor applies its own criteria too'));
    expect(seen).toEqual(['opndoor_referenced']);
  });

  it('and can be locked, for a reader who may not change it', () => {
    const { container } = render(
      <TenantsChecked name="t" value="pre_referenced_open" onChange={() => {}} disabled />,
    );
    const radios = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.every((r) => r.disabled)).toBe(true);
  });
});

describe('both forms that set this field', () => {
  const ADD = read('src/pages/PartnerManagement/PartnerManagement.tsx');
  const SETTINGS = read('src/pages/PartnerManagement/SupplierSettings.tsx');

  it('use the one control, not a select each', () => {
    for (const [where, src] of [['Add supplier', ADD], ['Supplier Settings', SETTINGS]] as const) {
      expect(src, where).toContain('<TenantsChecked');
      expect(stripComments(src), where).not.toContain('Referencing mode');
      expect(stripComments(src), where).not.toContain('REFERENCING_MODES.map');
    }
  });

  /* AND THE CONFIRMATION NAMES THE LINE THAT WAS CLICKED. Add supplier
     lists what changed before it saves; naming the change "to
     Pre-referenced, screened" would quote words the reader has never
     seen on that form. */
  it('and the Add supplier confirmation quotes the answer, not the old field name', () => {
    expect(ADD).toContain("REFERENCING_MODES.find((x) => x.id === m)?.choice ?? m;");
  });

  it('and both carry Matt’s Capabilities intro', () => {
    for (const [where, src] of [['Add supplier', ADD], ['Supplier Settings', SETTINGS]] as const) {
      expect(src, where).toContain('How this supplier sends referrals: through the portal, through the API, or both.');
    }
  });

  /* THE LINE ABOUT AGENCIES AND CRMS, which is the half Matt asked to be
     removed and the half that was wrong: it used "an agency" to mean a kind
     of supplier, and an agency is something else in this product. */
  it('and neither still explains itself with agencies and CRMs', () => {
    for (const [where, src] of [['Add supplier', ADD], ['Supplier Settings', SETTINGS]] as const) {
      expect(stripComments(src), where).not.toMatch(/a CRM is API only/);
      expect(stripComments(src), where).not.toMatch(/Two independent settings rather than one supplier type/);
    }
  });
});
