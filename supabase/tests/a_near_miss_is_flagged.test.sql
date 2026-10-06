-- THE API CREATES AN AGENCY, AND A NEAR MISS IS FLAGGED.
--
-- Matt, 2026-10-03, approving the design: "opt-in flag defaulting to false,
-- suppliers only, agency email required, reuse on an exact (normalised)
-- match, refuse on ambiguous, land in Reconciliation, response says what was
-- created, audited with the key name. One addition: API-created agencies and
-- offices must go through Reconciliation's 'Might already exist' similarity
-- check, so a near-miss like 'Frost Partnerhsix' is flagged to me as a
-- possible duplicate of 'Frost Partnership'."
--
-- EVERY ONE OF THOSE EIGHT IS AN ASSERTION HERE, because the design was
-- approved as a list and a list is what it has to be held to. The two that
-- matter most are the two that write into somebody's book:
--
--   the OPT IN, which defaults to false, so every partner we already hold is
--   unchanged by this migration and keeps the refusal they had yesterday;
--
--   SUPPLIERS ONLY, because `opndoor-agents` is one partner shared by every
--   agency Opndoor onboards, so creating there makes a sibling beside
--   somebody else's agency rather than adding to your own book.

begin;
select plan(25);

insert into public.partners (id, slug, name, referencing_mode, is_house_route,
                             partner_kind, api_may_create_agencies)
values ('e9000000-0000-0000-0000-0000000000a1','zzz-api-on','ZZZ API On',
        'pre_referenced_open', false, 'supplier', true),
       -- The same rail with the flag OFF, which is the default and is the
       -- state every existing partner is in.
       ('e9000000-0000-0000-0000-0000000000a2','zzz-api-off','ZZZ API Off',
        'pre_referenced_open', false, 'supplier', false);

-- AND ONE ON THE AGENCY RAIL WITH THE FLAG ON, which is the combination that
-- must still be refused: the flag is not the whole rule.
insert into public.partners (id, slug, name, referencing_mode, is_house_route,
                             partner_kind, api_may_create_agencies)
values ('e9000000-0000-0000-0000-0000000000a3','zzz-api-ours','ZZZ API Ours',
        'pre_referenced_open', false, 'agency', true);

insert into public.partner_api_keys (id, partner_id, name, key_prefix, key_hash, scopes, livemode)
values ('e9000000-0000-0000-0000-00000000000c','e9000000-0000-0000-0000-0000000000a1',
        'ZZZ Rightmove production','zzz_live_','x', array['applications:write'], true);

-- ===========================================================================
-- 1. THE DEFAULT IS OFF
-- ===========================================================================
select is(
  (select api_may_create_agencies from public.partners where slug = 'opndoor-agents'),
  false, 'the opt-in defaults to false, so no existing partner is changed');

select is(
  (select outcome from public.partner_api_create_org(
     'e9000000-0000-0000-0000-0000000000a2'::uuid, null,
     'ZZZ Brand New', 'deeds@zzznew.test', null, null, null, null)),
  'creation_not_enabled', 'a supplier without the flag cannot create');

select is(
  (select count(*)::int from public.agencies
    where partner_id = 'e9000000-0000-0000-0000-0000000000a2'),
  0, 'and nothing was written for them');

-- ===========================================================================
-- 2. SUPPLIERS ONLY, WHATEVER THE FLAG SAYS
-- ===========================================================================
select is(
  (select outcome from public.partner_api_create_org(
     'e9000000-0000-0000-0000-0000000000a3'::uuid, null,
     'ZZZ Not Allowed', 'deeds@zzzno.test', null, null, null, null)),
  'creation_not_available', 'our own estate refuses even with the flag on');

-- ===========================================================================
-- 3. THE AGENCY EMAIL IS REQUIRED, AND HAS TO BE ONE
-- ===========================================================================
select is(
  (select outcome from public.partner_api_create_org(
     'e9000000-0000-0000-0000-0000000000a1'::uuid, null,
     'ZZZ Needs Email', null, null, null, null, null)),
  'agency_email_required', 'an agency email is required to create one');

select is(
  (select outcome from public.partner_api_create_org(
     'e9000000-0000-0000-0000-0000000000a1'::uuid, null,
     'ZZZ Needs Email', 'not-an-address', null, null, null, null)),
  'agency_email_invalid', 'and it has to be an email address');

select is(
  (select count(*)::int from public.agencies where name like 'ZZZ Needs Email%'),
  0, 'and neither attempt wrote anything');

-- ===========================================================================
-- 4. THE HAPPY PATH: created, pending review, audited with the key's name
-- ===========================================================================
select is(
  (select outcome from public.partner_api_create_org(
     'e9000000-0000-0000-0000-0000000000a1'::uuid,
     'e9000000-0000-0000-0000-00000000000c'::uuid,
     'ZZZ Frost Partnership', 'deeds@zzzfrost.test', '1 ZZZ Street',
     'ZZZ Frost Mayfair', '2 ZZZ Mews', null)),
  'ok', 'a supplier with the flag on creates the agency and the office');

-- "response says what was created", which is the array the API returns.
select is(
  (select created from public.partner_api_create_org(
     'e9000000-0000-0000-0000-0000000000a1'::uuid,
     'e9000000-0000-0000-0000-00000000000c'::uuid,
     'ZZZ Second Agency', 'deeds@zzzsecond.test', null, 'ZZZ Second Office', null, null)),
  array['agency','branch'],
  'and says what it made, as a list rather than a flag');

select is(
  (select review_state from public.agencies where name = 'ZZZ Frost Partnership'),
  'pending_review', 'it lands in Reconciliation');

select is(
  (select review_state from public.branches where name = 'ZZZ Frost Mayfair'),
  'pending_review', 'and so does the office');

-- The address goes on the office, which is where an address lives on this rail.
select is(
  (select area from public.branches where name = 'ZZZ Frost Mayfair'),
  '2 ZZZ Mews', 'the office carries the address it was sent');

select is(
  (select email from public.agent_contacts
    where agency_id = (select id from public.agencies where name = 'ZZZ Frost Partnership')
      and branch_id is null),
  'deeds@zzzfrost.test', 'and the agency carries the email signed deeds go to');

/* AUDITED WITH THE KEY'S NAME. An API key is not a person, so actor_id stays
   null: putting a user's name on something no user did would be worse than
   saying nothing. */
select is(
  (select actor from public.org_audit
    where entity_id = (select id from public.agencies where name = 'ZZZ Frost Partnership')
      and action = 'created'),
  'ZZZ Rightmove production', 'audited with the key''s own name');

select is(
  (select actor_id from public.org_audit
    where entity_id = (select id from public.agencies where name = 'ZZZ Frost Partnership')
      and action = 'created'),
  null::uuid, 'and with no actor_id, because a key is not a person');

/* A CALL WITH NO KEY NAMED still says something readable rather than leaving
   the actor blank. Its own creation, because the two above both passed the
   key and asserting this against one of them would have been asserting
   nothing. */
select is(
  (select outcome from public.partner_api_create_org(
     'e9000000-0000-0000-0000-0000000000a1'::uuid, null,
     'ZZZ Keyless Agency', 'deeds@zzzkeyless.test', null, null, null, null)),
  'ok', 'a call with no key still creates');

select is(
  (select actor from public.org_audit
    where entity_id = (select id from public.agencies where name = 'ZZZ Keyless Agency')
      and action = 'created'),
  'an API key', 'and is audited as an API key rather than as nobody');

-- ===========================================================================
-- 5. REUSE ON AN EXACT NORMALISED MATCH, AND REFUSE ON AMBIGUOUS
-- ===========================================================================
/* THE RETRY CASE, which is the one that matters: an integrator whose call
   timed out sends it again. `normalise_org_name` lowers case, collapses
   whitespace and strips a trailing Ltd, so all three of these are the agency
   that already exists and none of them creates a second one. */
select is(
  (select created from public.partner_api_create_org(
     'e9000000-0000-0000-0000-0000000000a1'::uuid, null,
     'zzz frost partnership ltd', 'deeds@zzzfrost.test', null, 'ZZZ Frost Mayfair', null, null)),
  array[]::text[], 'an exact normalised match creates nothing at all');

select is(
  (select count(*)::int from public.agencies
    where partner_id = 'e9000000-0000-0000-0000-0000000000a1'
      and public.normalise_org_name(name) = public.normalise_org_name('ZZZ Frost Partnership')),
  1, 'so there is still exactly one of it');

/* AMBIGUOUS IS OUR DATA PROBLEM. Two agencies normalising the same, which the
   unique index permits because it keys on the raw name. */
insert into public.agencies (partner_id, name, review_state)
values ('e9000000-0000-0000-0000-0000000000a1','zzz frost partnership','confirmed');

select is(
  (select outcome from public.partner_api_create_org(
     'e9000000-0000-0000-0000-0000000000a1'::uuid, null,
     'ZZZ Frost Partnership', 'deeds@zzzfrost.test', null, null, null, null)),
  'agency_ambiguous', 'two agencies normalising the same is refused, not guessed');

-- ===========================================================================
-- 6. MATT'S ADDITION: THE NEAR MISS, IN THE TAB HE NAMED
-- ===========================================================================
/* "MIGHT ALREADY EXIST" IS A FILTER OVER reconciliation_queue, not a query of
   its own: the tab is `queue.filter((i) => i.match)`. So a row is in that tab
   exactly when the queue found it a `match_name`, and that is what these
   assertions read. Testing a separate similarity function would have proved
   the arithmetic and not the thing Matt asked for. */
insert into public.agencies (id, partner_id, name, review_state, livemode)
values ('e9000000-0000-0000-0000-0000000000b8','e9000000-0000-0000-0000-0000000000a1',
        'ZZZ Hartwell Estates','confirmed', true);

/* HIS OWN EXAMPLE, to the letter: a transposition and a wrong last letter.
   It scores 0.565, which is why the threshold is 0.55 and not 0.6. */
insert into public.agencies (id, partner_id, name, review_state, livemode)
values ('e9000000-0000-0000-0000-0000000000b9','e9000000-0000-0000-0000-0000000000a1',
        'ZZZ Hartwell Estatse','pending_review', true);

-- The queue is opndoor-only, which is correct and has to be stood in for.
select set_config('request.jwt.claims',
  json_build_object('sub',(select id from public.users where role = 'superadmin' and status = 'active' limit 1),
                    'role','authenticated','aal','aal2')::text, true);
set local role authenticated;

select is(
  (select match_name from public.reconciliation_queue()
    where entity_id = 'e9000000-0000-0000-0000-0000000000b9'),
  'ZZZ Hartwell Estates',
  'a typo is matched to the agency it is a typo of, so it lands in "Might already exist"');

/* AND IT IS NOT REPORTED AS THE SAME NAME, which is the distinction the card
   draws: `matchExact` decides whether it says "already exists" or "looks
   like". A typo is a maybe, and Opndoor decides. */
select is(
  (select match_exact from public.reconciliation_queue()
    where entity_id = 'e9000000-0000-0000-0000-0000000000b9'),
  false, 'and is offered as a likeness rather than as a duplicate');

/* THE EXACT NAME STILL WINS over a likeness, which the ordering has to
   guarantee: with both present, the card must name the one that really is
   the same agency. */
/* IN A DIFFERENT CASE, because `agencies` carries a unique (partner_id,
   name) on the RAW name: a confirmed row spelled identically to the pending
   one cannot exist. Which is also what the exact arm is really for -- it is
   `lower(c.name) = lower(p.name)`, so the case difference is the whole case
   it was written to catch. */
insert into public.agencies (id, partner_id, name, review_state, livemode)
values ('e9000000-0000-0000-0000-0000000000b7','e9000000-0000-0000-0000-0000000000a1',
        'ZZZ HARTWELL ESTATSE','confirmed', true);

select is(
  (select match_name from public.reconciliation_queue()
    where entity_id = 'e9000000-0000-0000-0000-0000000000b9'),
  'ZZZ HARTWELL ESTATSE',
  'an exact name beats a likeness when both are there');

select is(
  (select match_exact from public.reconciliation_queue()
    where entity_id = 'e9000000-0000-0000-0000-0000000000b9'),
  true, 'and is reported as the duplicate it is');

/* AND NOTHING UNRELATED IS DRAGGED IN. 0.026 against the pending name, which
   is the measurement the threshold was set from. */
insert into public.agencies (id, partner_id, name, review_state, livemode)
values ('e9000000-0000-0000-0000-0000000000b6','e9000000-0000-0000-0000-0000000000a1',
        'ZZZ Foxglove Residential','pending_review', true);

select is(
  (select match_name from public.reconciliation_queue()
    where entity_id = 'e9000000-0000-0000-0000-0000000000b6'),
  null, 'an unrelated name is matched to nothing and stays a new record');

reset role;

select finish();
rollback;
