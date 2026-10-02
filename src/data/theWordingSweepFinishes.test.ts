/* THE THREE THINGS THAT WERE LEFT, FINISHED.
 *
 * Matt, 2026-10-02: "Fix the three older items: remove the reminder
 * promise from the tenant's deed email unless tenants really get that
 * reminder; remove the duplicate 'not insurance' sentences; change
 * 'guarantor fee' to 'guarantee fee' in CSV exports, the activity feed
 * and the API docs wording, but do not rename any API field or CSV
 * column a partner's code may read."
 *
 * THE FIRST ONE IS NOT A REMOVAL, and that is the point of writing it
 * down. I raised it overnight on the belief that the tenant was on no
 * lapse list, which is true of `notification_recipients` and is not the
 * whole answer: `renewal-notices` adds the tenant itself, on every rail,
 * and is scheduled and active. So the tenant really does get that
 * reminder and the sentence stays. The instruction said "unless", and
 * this is the unless.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { deedToSignEmail, executedDeedTenantEmail } from '../../supabase/functions/_shared/emailTemplates.ts';
import { renderText } from '../../supabase/functions/_shared/emailLayout.ts';

const read = (p: string) => readFileSync(p, 'utf8');

const tenant = {
  guaranteeRef: 'GR-23853', tenantName: 'Tess Tenant',
  propertyAddr: '1 Example Road, N1 1AA', tenancyStartLabel: '29 Dec 2026',
};

describe('the tenant is promised a reminder they actually get', () => {
  it('so the sentence stays on their signed-deed email', () => {
    expect(renderText(executedDeedTenantEmail(tenant)))
      .toContain('We will email you a month before the guarantee ends');
  });

  /* AND THE JOB BEHIND IT. A promise in an email and a recipient list in
     a scheduled function are two files that can drift apart silently,
     which is exactly how the landlord's copy came to promise a letter
     nobody sends. This is the assertion that would go red if the tenant
     were ever dropped from the notice. */
  it('because renewal-notices emails the tenant, on every rail', () => {
    const job = read('supabase/functions/renewal-notices/index.ts');
    expect(job).toContain('r.tenant_email');
    expect(job).toMatch(/\[r\.tenant_email, \.\.\.agents\]/);
    // Within 30 days of the end, which is what "a month before" means.
    expect(job).toContain('ending within 30 days');
  });
});

describe('"not insurance" is said once, in the footer', () => {
  /* The footer emailLayout puts on every message says it word for word.
     A body line repeating it printed the same sentence twice on one
     screen, eight words apart. */
  const footerSays = /professional guarantor service, not insurance/;

  it('and the deed-to-sign email keeps only the half the footer does not say', () => {
    const t = renderText(deedToSignEmail({
      guaranteeRef: 'GR-23853', tenantName: 'Tess Tenant',
      propertyAddr: '1 Example Road, N1 1AA', signUrl: 'https://example.test/sign',
    }));
    expect(t).toContain('You remain the claim contact');
    expect(t.match(footerSays) ?? []).toHaveLength(1);
  });

  it('and the PandaDoc signing email drops the line altogether', () => {
    const src = read('supabase/functions/_shared/pandadoc.ts');
    expect(src).not.toContain('not insurance, and is not a party to your tenancy agreement');
  });

  /* THE FOOTER ITSELF IS UNTOUCHED, or "said once" would be "said never". */
  it('while the footer still says it', () => {
    expect(read('supabase/functions/_shared/emailLayout.ts')).toMatch(footerSays);
  });
});

describe('"guarantee fee" in the prose, and not one field renamed', () => {
  it('the activity feed says it, in the browser and as the webhook writes it', () => {
    expect(read('src/data/activityService.ts')).toContain('Guarantee fee refunded for');
    expect(read('supabase/functions/stripe-webhook/index.ts')).toContain('Guarantee fee paid (£');
  });

  it('and the API docs say it, in both generators', () => {
    expect(read('src/data/devCentreService.ts')).toContain("desc: 'The guarantee fee was paid'");
    expect(read('scripts/generate-partner-docs.mjs')).toContain("'The guarantee fee is paid'");
  });

  it('and the export summaries say it', () => {
    const src = read('src/data/exportsService.ts');
    expect(src).toContain("moneyKv('Guarantee fees collected (gross)'");
    expect(src).toContain("moneyKv('Average guarantee fee'");
  });

  /* THE CAVEAT, WHICH IS THE HALF WITH TEETH. "Do not rename any API
     field or CSV column a partner's code may read." A column heading is
     what a partner's spreadsheet or importer matches on; renaming it
     would break the reconciliation the exports exist for. So the
     headings still read "Guarantor fee" and this says so on purpose,
     rather than leaving the next person to tidy them. */
  it('while the CSV column headings are deliberately NOT renamed', () => {
    const src = read('src/data/exportsService.ts');
    expect(src).toContain("moneyCol('Guarantor fee')");
    expect(src).toContain("moneyCol('Guarantor fee charged')");
  });

  it('nor is the webhook event a partner subscribes to', () => {
    expect(read('src/data/devCentreService.ts')).toContain("id: 'application.paid'");
    expect(read('scripts/generate-partner-docs.mjs')).toContain("['application.paid'");
  });
});
