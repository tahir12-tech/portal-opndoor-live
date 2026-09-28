/* AN ALLOWLIST IS ONLY WORTH HAVING IF SOMETHING TESTS WHAT IS ON IT.

   supabase/tests/definer_grants.test.sql says WHO may call each SECURITY
   DEFINER function. That is half a guarantee. A definer function runs as its
   owner with RLS switched off inside it, so being on the allowlist means "the
   browser may call this", and the only thing standing between that and a data
   leak is the reach check the function makes for itself.

   So: every name on the allowlist must be exercised by name in some pgTAP
   test in the same directory. This file is the bookkeeping for that, and it
   runs in the web job where it needs no database.

   THE UNCOVERED LIST IS EXPLICIT, AND THAT IS THE POINT. Pretending to full
   coverage by loosening the check would be worse than having none. What is
   left is named, counted, and asserted at an exact number, so adding to it
   means editing this file and the reader sees it happen. The number may go
   down without ceremony. It may not go up by accident.

   WHY THESE ARE STILL UNCOVERED, honestly: twenty of them are dev-centre RPCs
   (dev_api_*, dev_webhook_*, dev_sandbox_*) and the rest are opndoor-admin
   globals. Both belong to the SUPPLIER rail, where partner_id genuinely is a
   company boundary and the failures this whole exercise is about cannot
   arise. 20261006270000 already refuses an API key and a webhook endpoint on
   the house route, and invite-user refuses to create a developer there at
   all, so the agency rail cannot reach dev-centre to begin with. They are
   worth covering; they were not worth covering before Monday. */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'supabase', 'tests');
const ALLOWLIST_FILE = 'definer_grants.test.sql';

const allowlist = [
  ...readFileSync(join(DIR, ALLOWLIST_FILE), 'utf8').matchAll(/^\s*\('([a-z0-9_]+)'\)/gm),
].map((m) => m[1]);

/** Every pgTAP test EXCEPT the allowlist file itself, which only names them. */
const suite = readdirSync(DIR)
  .filter((f) => f.endsWith('.test.sql') && f !== ALLOWLIST_FILE)
  .map((f) => readFileSync(join(DIR, f), 'utf8'))
  .join('\n');

/* Named, so the gap is a list rather than a number. Sorted, so a diff to it
   reads cleanly. */
const NOT_YET_COVERED = [
  // --- dev centre: the supplier rail's API tooling, which the house route
  //     cannot reach at all (20261006270000 refuses a key and an endpoint
  //     there, and invite-user refuses to create a developer there) --------
  'dev_api_errors_by_method', 'dev_api_keys', 'dev_api_logs',
  'dev_api_stats', 'dev_api_timeseries', 'dev_delete_api_key',
  'dev_delete_webhook_endpoint', 'dev_live_application_counts', 'dev_live_applications',
  'dev_partner_options', 'dev_purge_sandbox', 'dev_replay_webhook_delivery',
  'dev_revoke_api_key', 'dev_sandbox_applications', 'dev_sandbox_counts',
  'dev_update_webhook_endpoint', 'dev_webhook_deliveries', 'dev_webhook_endpoint_secret',
  'dev_webhook_endpoints', 'dev_webhook_stats', 'partner_active_key_count',
  // --- opndoor-admin globals, which have no agency to be scoped to --------
  'admin_add_agency', 'admin_break_glass_revoke_key', 'admin_delete_org_shape',
  'confirm_org_entity', 'log_view_as', 'set_app_setting_num',
  'trigger_crm_sync', 'update_partner_settings',
  // --- agency-rail, still to cover, and no excuse beyond Monday -----------
  'agency_branches_for_match', 'count_pending_tenancy_corrections', 'dismiss_agency_match',
  'end_agreement', 'my_partner_summary', 'origin_is_agent_estate',
  'referral_fee_preview', 'resolve_agency_match', 'send_deed_to_agent',
].sort();

describe('the definer allowlist', () => {
  it('parses, so a renamed file cannot turn this suite into a no-op', () => {
    expect(allowlist.length).toBeGreaterThan(100);
    expect(allowlist).toContain('app_may_reach_user');
  });

  it('has no duplicates', () => {
    expect(new Set(allowlist).size).toBe(allowlist.length);
  });

  it('is sorted, so two people adding to it do not collide', () => {
    expect(allowlist).toEqual([...allowlist].sort());
  });
});

describe('every allowlisted function is exercised by a pgTAP test', () => {
  const uncovered = allowlist
    .filter((name) => !new RegExp(`\\b${name}\\s*\\(`).test(suite))
    .sort();

  it('and the ones that are not are exactly the ones named here', () => {
    expect(uncovered).toEqual(NOT_YET_COVERED);
  });

  /* THE RATCHET. If this number is ever edited upwards, somebody added a
     browser-callable definer function and did not test its reach check, and
     they had to change this line to do it. */
  it('the uncovered list is 38 and does not grow', () => {
    expect(NOT_YET_COVERED.length).toBe(38);
    expect(uncovered.length).toBeLessThanOrEqual(38);
  });

  it('so most of the surface IS covered, which is the point of the count', () => {
    const covered = allowlist.length - uncovered.length;
    expect(covered).toBeGreaterThanOrEqual(77);
  });
});
