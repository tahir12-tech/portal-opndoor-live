/* THE SUPPLIER'S INTEGRATION TAB SPEAKS TO AN ADMIN, NOT A DEVELOPER.
 *
 * Matt, 2026-10-02: "Same tab, admin view: replace developer
 * instructions with plain admin wording. Empty states read 'No sandbox
 * applications yet', 'No API requests in this period', 'No webhook
 * deliveries in this period'. Remove the PandaDoc sandbox email
 * warning, the 'POST to /v1/applications' line and 'check on
 * Configuration' from the admin view; they stay in the developer's own
 * Dev Centre."
 *
 * ONE COMPONENT, TWO AUDIENCES, which is why this is a `readOnly` arm
 * and not a second panel. The three panels are the SAME ones the Dev
 * Centre draws; a copy of each for the admin tab would be three places
 * for a fix to be made twice and once.
 *
 * AND TWO OF THE THREE REMOVALS POINT AT LOCKED DOORS. "Check on
 * Configuration" and the Dev Centre are gone for admin as of the same
 * day, so the old copy would have sent them to a screen that no longer
 * opens. The PandaDoc warning is different: it is advice about an act
 * an admin cannot perform here at all, because the panel is read-only
 * for them.
 *
 * READS THE SOURCE rather than rendering, because each panel needs a
 * live partner id and an RPC to draw anything, and what is being
 * asserted is which sentence each audience gets -- not the table under
 * it, which has its own tests.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(p, 'utf8');
const sandbox = read('src/pages/DevCentre/Sandbox.tsx');
const logs = read('src/pages/DevCentre/Logs.tsx');
const webhooks = read('src/pages/DevCentre/WebhookHistory.tsx');
const tab = read('src/pages/PartnerManagement/PartnerHome.tsx');

describe('the three empty states, in Matt’s words', () => {
  it('the sandbox says "No sandbox applications yet"', () => {
    expect(sandbox).toContain('No sandbox applications yet.');
  });

  it('the request log says "No API requests in this period"', () => {
    expect(logs).toContain('No API requests in this period.');
  });

  it('and the delivery history says "No webhook deliveries in this period"', () => {
    expect(webhooks).toContain('No webhook deliveries in this period.');
  });
});

describe('and each is behind the admin arm, not instead of the developer’s', () => {
  /* THE DEVELOPER'S OWN COPY SURVIVES. "They stay in the developer's own
     Dev Centre" is half the instruction, and deleting the explanations
     would have satisfied the other half while losing it. */
  it('the POST line is still there for a developer', () => {
    expect(sandbox).toContain('POST to <code>/v1/applications</code>');
    expect(sandbox).toMatch(/readOnly \? \(\s*<p className="soft">No sandbox applications yet\.<\/p>/);
  });

  it('and so is "check on Configuration"', () => {
    expect(webhooks).toContain('check on Configuration that an endpoint is enabled');
    expect(webhooks).toContain("readOnly ? 'No webhook deliveries in this period.'");
  });

  it('and the request log keeps its explanation of where requests come from', () => {
    expect(logs).toContain('including ones that failed');
    expect(logs).toContain("readOnly ? 'No API requests in this period.'");
  });
});

describe('the PandaDoc warning is the developer’s alone', () => {
  /* It is advice about what happens when YOU send a sandbox application,
     and an admin cannot: the panel is read-only for them. A caution
     about an act you cannot perform teaches people to skip the ones
     that apply. */
  it('so the whole block is behind !readOnly', () => {
    expect(sandbox).toMatch(/\{!readOnly && \(\s*<div className="sbxwarn">/);
  });

  it('while the warning itself is untouched for a developer', () => {
    expect(sandbox).toContain('Sandbox sends real email through PandaDoc.');
  });
});

describe('and the tab asks for the admin arm on all three', () => {
  it('sandbox, logs and webhook history are all read-only there', () => {
    expect(tab).toContain('<Sandbox partnerId={partner.dbId ?? null} readOnly />');
    expect(tab).toContain('<Logs partnerId={partner.dbId ?? null} readOnly />');
    expect(tab).toContain('<WebhookHistory partnerId={partner.dbId ?? null} readOnly />');
  });
});
