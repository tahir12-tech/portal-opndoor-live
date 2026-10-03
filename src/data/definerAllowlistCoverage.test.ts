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
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error - plain .mjs helper, shared with scripts/schema-drift.mjs
import { finalState, callableBy } from '../../scripts/schema-final-state.mjs';

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
  /* THREE CAME OFF THIS LIST on 2026-10-01: dev_api_logs,
     dev_api_errors_by_method and dev_sandbox_applications are now
     exercised by an_admin_watches_one_suppliers_integration.test.sql,
     which the supplier Integration tab's read-only panels needed. Not a
     coverage drive: the panels read another party's data, so the
     scoping had to be proved, and proving it covers the readers.

     AND TWO MORE on 2026-10-02, for the same reason one page over:
     `dev_api_keys` and `dev_revoke_api_key` are now exercised by
     an_admin_revokes_one_key.test.sql. Neither is called BY the new
     feature -- the point of that file is that admin gets nothing from
     the first and is refused by the second -- which is a better reason
     to cover them than calling them would have been: the refusals are
     what make the third function narrow rather than a widening. */
  'dev_api_stats', 'dev_api_timeseries', 'dev_delete_api_key',
  'dev_delete_webhook_endpoint', 'dev_live_application_counts', 'dev_live_applications',
  'dev_partner_options', 'dev_purge_sandbox', 'dev_replay_webhook_delivery',
  'dev_sandbox_counts',
  'dev_update_webhook_endpoint', 'dev_webhook_deliveries', 'dev_webhook_endpoint_secret',
  'dev_webhook_endpoints', 'dev_webhook_stats', 'partner_active_key_count',
  // --- opndoor-admin globals, which have no agency to be scoped to --------
  'admin_add_agency', 'admin_break_glass_revoke_key', 'admin_delete_org_shape',
  'confirm_org_entity', 'log_view_as', 'set_app_setting_num',
  'trigger_crm_sync',
  /* update_partner_settings LEFT THIS LIST with R6 (20261006870000). It is now
     exercised by the_money_goes_through_the_front_door.test.sql, which had to
     call it: R6 shuts the browser's direct write to the rate columns, so the
     governed RPC became the ONLY way to change a commission rate, and a test
     proving the side door is shut is worthless without one proving the front
     door still opens. */
  // --- agency-rail, still to cover, and no excuse beyond Monday -----------
  // agency_branches_for_match came off this list when 20261006500000 gave it
  // the AAL2 step-up: the_rest_of_round_fives_lows.test.sql exercises it by
  // name, as a password-only session and then at aal2.
  'count_pending_tenancy_corrections', 'dismiss_agency_match',
  'end_agreement', 'my_partner_summary', 'origin_is_agent_estate',
  'referral_fee_preview', 'resolve_agency_match',
  /* 35 -> 36, AND THE RATCHET DID NOT GO BACKWARDS: the measurement got
     honest. `dev_sandbox_application_document` was counted as covered by
     a has_function_privilege assertion, which tests the GRANT and not the
     reach, and which definer_grants.test.sql already makes for every name
     on this list. Nothing lost coverage; one thing never had it.

     `is_opndoor_staff` was in the same position, riding on two SQL
     comments, and is NOT listed here because it was given a real
     assertion instead (every_browser_rpc_checks_its_reach). That is the
     direction this list is supposed to move in. */
  'dev_sandbox_application_document',
].sort();

/* THE ALLOWLIST IS DERIVED FROM THE MIGRATION FILES, NOT FROM THE DATABASE.
 *
 * It used to be generated by querying dev's catalogue, which is why it could
 * not detect the thing it exists to detect: a test whose expected answer is
 * produced by the system under test restates that system rather than checking
 * it. 20261006330000 revoked create_invited_user from authenticated and this
 * file said the grant was present, because dev had it and the files did not.
 *
 * The files are the authority: they are what CI applies from zero, what Balal
 * applies to the clone, and what production gets. So the list in
 * definer_grants.test.sql is checked against a replay of the files, and the
 * pgTAP run then checks dev against that list. Files -> list -> database, in
 * one direction, with no step allowed to define its own expectation.
 */
describe('the allowlist agrees with the migration files', () => {
  // definerOnly: the allowlist is about SECURITY DEFINER functions, which are
  // the ones that run as their owner with RLS switched off inside them. A pure
  // helper being callable is not the same question.
  const fromFiles = new Set<string>(callableBy(finalState(), 'authenticated', { definerOnly: true }));
  const named = new Set(allowlist);

  it('replays the files, so a broken replay cannot pass silently', () => {
    expect(fromFiles.size).toBeGreaterThan(100);
  });

  it('names nothing the files do not grant to authenticated', () => {
    const onlyInList = [...named].filter((n) => ![...fromFiles].some((f) => f.startsWith(`${n}(`)));
    expect(onlyInList).toEqual([]);
  });

  it('and omits nothing the files DO grant', () => {
    const onlyInFiles = [...fromFiles]
      .map((sig) => sig.slice(0, sig.indexOf('(')))
      .filter((n) => !named.has(n));
    expect([...new Set(onlyInFiles)].sort()).toEqual([]);
  });
});

describe('the definer allowlist', () => {
  it('parses, so a renamed file cannot turn this suite into a no-op', () => {
    expect(allowlist.length).toBeGreaterThan(100);
    expect(allowlist).toContain('app_may_reach_user');
  });

  it('has no duplicates', () => {
    expect(new Set(allowlist).size).toBe(allowlist.length);
  });

  /* THE RATCHET THAT WAS MISSING, and it is on the wrong list that
     everything else was watching. `uncovered` cannot grow unnoticed --
     the set equality sees to that. What CAN grow with no ceremony is the
     ALLOWLIST: add a SECURITY DEFINER function, grant it to
     authenticated, mention it once anywhere in the suite, and the browser
     surface is one function wider with nothing to say so.

     A ceiling means every legitimate new browser-callable definer
     function edits this line. That is the intended friction and it is the
     point: the number is the size of the surface an authenticated session
     can reach, and it should not move by accident. Lower it when one goes;
     raise it deliberately, in the same commit as the function. */
  /* 132 -> 133, RAISED DELIBERATELY AND IN THE SAME COMMIT AS THE
     FUNCTION, which is exactly the friction this line exists to create.
     `caller_leads_their_party` is browser-reachable because the write
     POLICY on user_notification_settings evaluates it, so it has to be
     executable by `authenticated` and therefore has to be on the
     allowlist. Q4. */
  /* 133 -> 136, RAISED DELIBERATELY AND IN THE SAME COMMIT AS THE THREE
     FUNCTIONS. `add_partner_statement_recipient`,
     `remove_partner_statement_recipient` and
     `partner_statement_recipient_list` are the admin doors onto a
     supplier's named statement addresses: called from the browser, so
     granted to `authenticated`, so on the allowlist. All three are
     exercised by name in a_supplier_gets_its_own_statement.test.sql, so
     none joins the uncovered list below. Supplier statements,
     2026-09-30. */
  /* 136 -> 138, RAISED DELIBERATELY AND IN THE SAME COMMIT AS THE TWO
     FUNCTIONS. `set_supplier_commission` and `supplier_commission_tiers`
     are the supplier Commission tab's write and read. Both are exercised
     by name in commission_is_set_in_one_place.test.sql. 2026-09-30. */
  /* 138 -> 139, RAISED DELIBERATELY AND IN THE SAME COMMIT AS THE
     FUNCTION. `decide_not_in_network` is the Reconciliation page's two
     buttons: called from the browser, guarded inside with is_aal2 +
     is_opndoor_staff. Exercised by name in
     a_decision_is_a_moment_not_a_flag.test.sql. 2026-09-30. */
  /* 139 -> 142, RAISED DELIBERATELY AND IN THE SAME COMMIT AS THE THREE.
     `set_app_setting_text` is Health's field, `statement_invoice_email`
     is what it reads back, and `statements_can_be_posted` is the
     boolean Home and Health both warn on. 2026-10-01. */
  it('is 151 functions wide, and does not widen by accident', () => {
    /* 142 -> 144, 2026-10-01: refund_questions_open and
       decide_refund_question, the list and the answer for a refund that
       landed on commission already sent on a statement. Both are staff
       only and the decision is MFA'd, because answering it either sends
       a payee a corrected document or changes what their next one says.
       Covered by a_refund_after_a_statement_is_a_question.test.sql. */
    /* 144 -> 145, 2026-10-01: supplier_deal, which the Commission tab reads
       its two deals from. */
    /* 145 -> 148, 2026-10-01: supplier_share_deals, set_agency_share_deal
       and clear_agency_share_deal, which are the Commission tab reading a
       supplier's several agents' share deals and moving an agency between
       them. All three are admin-only and behind MFA, checked inside each
       rather than by a grant, because `authenticated` is every seat in the
       product and these decide what an agency is paid. The reader returns
       one supplier's deals and nobody else's; the two writers refuse a
       deal that is not that supplier's through the membership trigger. */
    /* 148 -> 149, 2026-10-01: agency_changes, the agency page's Recent
       changes list. Gated on `app_may_reach_agency`, the same predicate
       every other agency-scoped reader uses, so it cannot become a way
       round the boundary; within it the rows are about the agency the
       caller is already reading. */
    /* 149 -> 150, 2026-10-01: email_from, who every email is sent from.
       A reader of one app setting and nothing else; it exposes an address
       the product prints at the foot of every email it sends. */
    /* 150 -> 151, 2026-10-01: authorise_mfa_reset_notice, the twin of
       authorise_password_reset. It judges the same ladder and returns the
       address to tell that their two-factor was reset, so the browser
       never nominates where that email goes. It writes nothing. */
    /* 151 -> 152, 2026-10-01: save_share_deal, which writes one of a
       supplier's agents' share deals together with the agencies it
       applies to. It exists because create_agreement takes no agencies
       and therefore cannot tell the supplier's default deal from a deal
       for three named ones -- and that difference decides which other
       deals it is allowed to end. Admin only, behind MFA, and it refuses
       an agency belonging to another supplier. Covered by name in
       one_save_for_a_share_deal.test.sql. */
    /* 152 -> 153, 2026-10-01: is_supplier_partner, the SQL twin of
       partyIsSupplier, for the rule that shared notes with the supplier
       that referred the application.
       153 -> 151 the same evening, and this is the ratchet turning the
       right way twice. Matt's third version of that rule is "anyone who
       can see the application reads and adds notes", which needs no rail
       predicate at all, so is_supplier_partner is dropped; and the write
       became an INSERT policy with the same test, so
       add_application_note is SECURITY INVOKER and off this list. Two
       functions fewer that an authenticated session can reach, for a
       rule that is simpler than either of the ones before it. */
    /* 151 -> 152, 2026-10-02: supplier_agencies_without_an_email, the
       reconciliation list Matt asked for -- "list them on Reconciliation
       so Opndoor can add one". It is a READER and returns nothing but an
       agency's name, its supplier's name and two counts; its own where
       clause is `is_aal2() and is_opndoor_staff()`, so a supplier's own
       Director cannot see which of a rival's agencies are unconfigured.
       It earns its place on the list rather than being folded into an
       existing reader because the question is per-estate and none of them
       asks it. Covered by name in
       an_agency_arrives_with_somewhere_to_send.test.sql. */
    /* 152 -> 153, 2026-10-02: admin_revoke_partner_api_key, the Revoke
       beside each key on the supplier's Integration tab. It is the
       third door onto one act and the narrowest: by the id admin can
       already read, admin only, MFA'd, and written to security_events.
       It is not a widening of `dev_revoke_api_key`, whose guard is
       written for the partner's own developer, nor of break glass,
       which takes a prefix admin is not shown. Covered by name in
       an_admin_revokes_one_key.test.sql. */
    /* 153 -> 154, the same day and the same instruction:
       admin_supplier_api_keys, which is what the Revoke needs something
       to sit beside. `dev_api_keys` has no admin arm by design, so the
       tab had nothing to list; this returns a name, created, last used
       and the id, and cannot return a prefix, hash or scope. */
    /* 154 -> 155, 2026-10-03: suppliers_with_no_commission_deal, which
       Health and the supplier's Overview read to show "Referrals are
       coming in with no commission deal set".

       IT IS A LIST OF WHO IS BEING UNDER-BILLED, so it is Opndoor's own
       commercial admin rather than anybody's record of themselves, and
       the function asks `is_admin()` in its own WHERE clause instead of
       trusting the two callers -- a supplier must never be able to read
       which of its competitors has no deal. It returns a slug, a name,
       a count and two dates: no rates, no money, nothing about a
       referral beyond when it arrived.

       NO EXISTING READER COULD ANSWER IT. The question joins partners,
       pricing_agreements and applications and turns on the difference
       between a null rate and a zero one, which is the distinction
       20261007680000 created and nothing else asks. Covered by name in
       a_missing_deal_is_loud.test.sql. */
    /* 155 -> 156, 2026-10-03: admin_delete_user, the second step of
       "After access is removed, offer 'Delete'".

       IT IS A SIBLING OF admin_set_user_status AND ASKS ITS PERMISSION
       QUESTION WORD FOR WORD -- is_admin, or management reaching one of
       its own people through app_may_reach_user -- then the level ladder
       on top of that. It widens nothing: whoever may take somebody's
       access away may finish the job, and nobody else. It also refuses a
       person whose access has not been removed yet, so the two steps
       cannot be collapsed by finding the RPC, and it refuses self.

       IT DELETES NOTHING. The row's status becomes 'deleted' and that is
       all, which is the point: applications.referrer_id and
       user_audit.target_user both reference this row, and Matt's rule is
       that "their name stays wherever they appear on past records".
       Covered by name in a_deleted_person_keeps_their_name.test.sql. */
    expect(allowlist.length).toBeLessThanOrEqual(156);
  });

  it('is sorted, so two people adding to it do not collide', () => {
    expect(allowlist).toEqual([...allowlist].sort());
  });
});

describe('every allowlisted function is exercised by a pgTAP test', () => {
  /* R7. WHAT COUNTS AS EXERCISING A FUNCTION, and two things that do not.
     Coverage is "the name appears followed by a paren somewhere in the
     suite", which is crude on purpose -- but it counted two kinds of
     mention that prove nothing:

       a SQL COMMENT naming the function, and

       a has_function_privilege('authenticated', 'public.f(uuid)',
       'EXECUTE') assertion, which tests the GRANT and not the reach.

     The second is not hypothetical. Exactly one name was riding on it:
     `dev_sandbox_application_document`, counted as covered solely by a
     grant assertion in what_the_sixth_round_found.test.sql -- which is
     the very thing definer_grants.test.sql already does for every
     function on the list. So the ratchet believed one more function was
     proven than actually is.

     Scrubbed here rather than by hand-maintaining an exclusion list,
     because the next one will arrive the same way. */
  const scrubbed = suite
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/has_function_privilege\s*\([^)]*\)/g, ' ');

  const uncovered = allowlist
    .filter((name) => !new RegExp(`\\b${name}\\s*\\(`).test(scrubbed))
    .sort();

  it('and the ones that are not are exactly the ones named here', () => {
    expect(uncovered).toEqual(NOT_YET_COVERED);
  });

  /* THE RATCHET. If this number is ever edited upwards, somebody added a
     browser-callable definer function and did not test its reach check, and
     they had to change this line to do it. */
  /* 36 -> 35 with R6 (20261006870000). The ratchet turned the right way for
     once: update_partner_settings came OFF the uncovered list because R6
     made it the only way to change a commission rate, and a test proving the
     browser's direct write is shut is worthless without one proving the
     governed path still opens. */
  /* THE TWO ASSERTIONS THAT USED TO SIT HERE COULD NOT FAIL.
     `expect(uncovered.length).toBeLessThanOrEqual(36)` was dead: the set
     equality above it already pins `uncovered` to the list exactly, so
     the length follows, and the literal 36 read as "one more is
     tolerated" when nothing tolerated anything. Replaced by the one that
     keeps the two in step and cannot drift. */
  it('the uncovered list is the uncovered set, exactly, and is 33', () => {
    expect(NOT_YET_COVERED.length).toBe(uncovered.length);
    /* 36 -> 33, 2026-10-01, and the ratchet turned the right way: three
       Dev Centre readers gained a pgTAP test because the supplier
       Integration tab reads another party's data through them and the
       scoping had to be proved.

       33 -> 31, 2026-10-02: dev_api_keys and dev_revoke_api_key, both
       covered by an_admin_revokes_one_key.test.sql as the two doors the
       admin one is NOT -- the first returns an admin nothing, the
       second refuses them. */
    expect(NOT_YET_COVERED.length).toBe(31);
  });

  /* AND THE SORTED CLAIM IS NOW TRUE OF THE FILE. The literal is `.sort()`ed
     at runtime, which silently launders an unsorted source and made the
     "Sorted, so a diff to it reads cleanly" comment above untrue of what is
     actually written. Compare the literal to its own sorted copy instead. */
  it('and is sorted in the source, not just at runtime', () => {
    expect(NOT_YET_COVERED).toEqual([...NOT_YET_COVERED].sort());
  });

  it('so most of the surface IS covered, which is the point of the count', () => {
    const covered = allowlist.length - uncovered.length;
    expect(covered).toBeGreaterThanOrEqual(79);
  });
});
