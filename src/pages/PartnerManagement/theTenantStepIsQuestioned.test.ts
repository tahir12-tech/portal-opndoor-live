/* A TENANT STEP ABOVE FOUR IS QUESTIONED, IN BOTH % EDITORS.
 *
 * Matt, 2026-10-02: "The agencies' % editor (supplier Commission tab,
 * default and bespoke deals) saved a tenant step of '1 to 10 tenants'
 * with no warning. Add the same warning the main deal editor has:
 * before saving any tenant step above 4 tenants, ask 'Did you mean
 * referrals sent? A tenancy rarely has more than 4 tenants.' with
 * options to switch to '% grows with referrals sent' or save anyway."
 *
 * WHY IT WAS MISSED, which is the part worth not repeating. The
 * agreement editor and the agencies' % editor look alike and are not
 * the same component: one prices a FEE in weeks of rent and the other a
 * PERCENTAGE. The control was rebuilt and the guard beside it was not.
 * And "default and bespoke" is two saves sharing one set of fields, so
 * a guard in one would still have left the other silent.
 *
 * "THE SAME WARNING" MEANS THE SAME PREDICATE. Both import
 * `suspectTenantCounts` and `TENANT_BAND_WARN_ABOVE` from the agreement
 * editor rather than re-deriving them; two editors disagreeing about
 * what counts as suspicious is how one of them goes quiet.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { suspectTenantCounts, TENANT_BAND_WARN_ABOVE } from '@/pages/Agencies/AgreementEditor';

const read = (p: string) => readFileSync(p, 'utf8');
const editor = read('src/pages/PartnerManagement/AgencyPercentEditor.tsx');
const bespoke = read('src/pages/PartnerManagement/ShareDealDialog.tsx');

describe('the predicate itself', () => {
  /* MATT'S OWN EXAMPLE: "1 to 10 tenants". */
  it('catches a step of 1 to 10 tenants', () => {
    expect(suspectTenantCounts([{ min: '1', max: '10' }])).toEqual([10]);
  });

  it('and leaves an ordinary joint tenancy alone', () => {
    expect(suspectTenantCounts([{ min: '1', max: '1' }, { min: '2', max: '' }])).toEqual([]);
    expect(suspectTenantCounts([{ min: '1', max: String(TENANT_BAND_WARN_ABOVE) }])).toEqual([]);
  });

  it('and reports every suspect edge, sorted, once each', () => {
    expect(suspectTenantCounts([{ min: '5', max: '20' }, { min: '20', max: '' }])).toEqual([5, 20]);
  });
});

describe('both saves ask before they write', () => {
  for (const [name, src] of [['the default deal', editor], ['a bespoke deal', bespoke]] as const) {
    it(`${name} checks the steps first`, () => {
      expect(src, name).toContain("if (!confirmTenants && d.model === 'tenants')");
      expect(src, name).toContain('const odd = suspectTenantCounts(d.bands);');
      expect(src, name).toContain('if (odd.length) { setTenantWarn(odd); return; }');
    });

    it(`${name} uses the agreement editor's own predicate`, () => {
      expect(src, name)
        .toContain("import { suspectTenantCounts, TENANT_BAND_WARN_ABOVE } from '@/pages/Agencies/AgreementEditor';");
    });

    /* MATT'S QUESTION AND HIS TWO OPTIONS, word for word on the first
       and in effect on the others. The switch option DOES the switch
       rather than describing where to find it. */
    it(`${name} asks his question and offers both ways out`, () => {
      expect(src, name).toContain('title="Did you mean referrals sent?"');
      expect(src, name).toContain('A tenancy rarely has more than');
      expect(src, name).toContain('Switch to % grows with referrals sent');
      expect(src, name).toContain('Save anyway');
      expect(src, name).toContain("d.setModel('volume')");
    });

    /* AND SAVING ANYWAY REALLY SAVES, which is the half that would make
       the warning a dead end if it were wrong. */
    it(`${name} goes through when the warning is accepted`, () => {
      expect(src, name).toContain('void save(true)');
    });
  }
});
