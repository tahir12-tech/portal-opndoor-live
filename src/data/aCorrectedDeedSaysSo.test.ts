/* A CORRECTED DEED SAYS IT IS A CORRECTION.
 *
 * Matt, 2026-10-01, verbatim: "Signed deed email after a tenancy start
 * correction: say so at the top, e.g. 'This corrected deed replaces the
 * one sent on 1 Oct 2026. The tenancy start is now 21 November 2026;
 * please discard the earlier copy.' Same for the tenant's copy."
 *
 * Without it the second email reads as a duplicate of the first, and the
 * one already filed is the one with the wrong date on it.
 *
 * AND THE SAME CORRECTION RE-OPENED A GUARD I CLOSED EARLIER TONIGHT.
 * 20261007320000 made the signed deed go out once, testing "has anything
 * been delivered". After a correction the answer is yes, about a deed
 * that has since been voided, so the corrected one would have been
 * signed and never sent. The test is now which is NEWER, in the webhook
 * and in send_deed_to_agent alike (20261007350000).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  executedDeedAgentEmail, executedDeedTenantEmail,
} from '../../supabase/functions/_shared/emailTemplates.ts';
import { renderText } from '../../supabase/functions/_shared/emailLayout.ts';

const base = {
  guaranteeRef: 'GR-23853', tenantName: 'Joint One',
  propertyAddr: '1 Example Road, N1 1AA', tenancyStartLabel: '21 Nov 2026',
};

describe('the agent’s copy', () => {
  it('opens by saying what it replaces, and when', () => {
    const t = renderText(executedDeedAgentEmail({ ...base, correctedFrom: '1 Oct 2026' }));
    expect(t).toContain('This corrected deed replaces the one sent on 1 Oct 2026.');
    expect(t).toContain('The tenancy start is now 21 Nov 2026');
    expect(t).toContain('please discard the earlier copy');
  });

  it('and says nothing of the sort on a first send', () => {
    expect(renderText(executedDeedAgentEmail(base))).not.toMatch(/corrected deed/i);
  });
});

describe('the tenant’s copy', () => {
  it('says the same thing', () => {
    const t = renderText(executedDeedTenantEmail({
      guaranteeRef: base.guaranteeRef, propertyAddr: base.propertyAddr,
      tenancyStartLabel: base.tenancyStartLabel, correctedFrom: '1 Oct 2026',
    }));
    expect(t).toContain('This corrected deed replaces the one sent on 1 Oct 2026.');
  });

  it('and is unchanged on a first send', () => {
    const t = renderText(executedDeedTenantEmail({
      guaranteeRef: base.guaranteeRef, propertyAddr: base.propertyAddr,
      tenancyStartLabel: base.tenancyStartLabel,
    }));
    expect(t).not.toMatch(/corrected deed/i);
  });
});

describe('the delivery guard a correction has to pass', () => {
  const webhook = readFileSync('supabase/functions/pandadoc-webhook/index.ts', 'utf8');
  const migration = readFileSync(
    'supabase/migrations/20261007350000_a_corrected_deed_is_a_new_deed.sql', 'utf8');

  /* THE BUG THIS WOULD HAVE BEEN: a corrected deed signed and never sent. */
  it('the webhook asks which is newer, not whether anything was sent', () => {
    expect(webhook).toContain('new Date(app.deed_issued_at) > new Date(app.deed_delivered_at)');
  });

  it('and so does the manual send', () => {
    expect(migration).toContain('coalesce(a.deed_issued_at, a.deed_delivered_at) <= a.deed_delivered_at');
  });

  /* AND A PLAIN RESEND IS STILL REFUSED, which is the rule from earlier
     tonight and must survive this one. */
  it('while a resend of the same deed still has to say it is one', () => {
    expect(migration).toContain('Confirm a resend to send it again.');
  });
});

describe('the PandaDoc covering email', () => {
  const pandadoc = readFileSync('supabase/functions/_shared/pandadoc.ts', 'utf8');

  it('says it is a correction, with the date spelled', () => {
    expect(pandadoc).toContain('this corrected Deed of Guarantee replaces the one sent to you earlier');
    expect(pandadoc).toContain('spelledDate(a.tenancy_start)');
  });

  /* THE DEED ITSELF KEEPS dd/mm/yyyy: it is a legal document with its own
     conventions, and the token fills a field on it. */
  it('while the deed keeps its own date format', () => {
    expect(pandadoc).toContain('{ name: "tenancy_start_date", value: fmtDate(a.tenancy_start) }');
  });
});
