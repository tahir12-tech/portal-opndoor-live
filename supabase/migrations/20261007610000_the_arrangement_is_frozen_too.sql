/* =====================================================================
   THE ARRANGEMENT IS FROZEN TOO.

   Matt, 2026-10-03, deciding the rule and approving this: "under that
   setting the supplier's commission and the agency's commission are
   separate and the total is their sum: Kestrel GBP 600 (25%) plus Frost
   via Kestrel GBP 240 (10%) = GBP 840 owed ... If a referral is frozen
   under 'the supplier pays its own agents', the agency's share comes out
   of the supplier's total and Opndoor pays only the supplier."

   TWO ARRANGEMENTS, AND THE FROZEN ROWS CANNOT TELL THEM APART.
   `freeze_commission_lines` writes two independent rows, each its own
   rate times the same basis, neither reduced by the other:

     agency    commission_split's rate  x basis
     supplier  applications.partner_rate x basis

   Which is correct, and is what the Commission tab's worked example
   says. But it writes exactly those two rows under BOTH settings, and it
   never reads `opndoor_pays_agents`. So "pay 840" and "pay 600" are the
   same data, and every reader has been deciding between them by asking
   `partners.opndoor_pays_agents` -- a mutable column, long after the
   money was earned.

   ON DEV THAT COLUMN HAS ALREADY MOVED TWICE under Kestrel: to "opndoor
   pays the agents" on 1 Oct 15:52:55 and back on 2 Oct 09:33:06.
   GR-FROST-KES was created at 2 Oct 00:07:24, between them. So its
   statement and its settlement have been reading an arrangement that was
   not the one it was sold under, and they would change again at the next
   flip. A rate is snapshotted onto the application for exactly this
   reason; the arrangement that says what the rate MEANS was not.

   THIS COLUMN IS THAT SNAPSHOT. It records nothing new about the money
   and changes no frozen amount; it records which of the two readings of
   the existing amounts is the right one.
   ===================================================================== */

alter table public.applications
  add column opndoor_pays_agents_at_freeze boolean;

comment on column public.applications.opndoor_pays_agents_at_freeze is
  'Whether Opndoor paid the agencies directly, as at the moment this application was created and its commission frozen. true: the supplier line and the agency line are SEPARATE payees and Opndoor owes their sum. false: the agency share comes out of the supplier total and Opndoor owes the supplier only. Snapshotted because partners.opndoor_pays_agents is mutable and has changed under live referrals. Never recomputed.';

/* SELECTABLE, because 20260811180000 made this table a denylist: every
   column not named is refused to `authenticated`, and a new one without
   this line takes the whole dashboard SELECT down. applications_column_
   grants.test.sql is the guard that says so. Not a rate, so not on the
   denylist: it says what Opndoor's arrangement IS, which the Reporting
   screens have to know to add up correctly. */
grant select (opndoor_pays_agents_at_freeze) on public.applications to authenticated;

/* =====================================================================
   THE BACKFILL, FROM THE LEDGER WHERE THERE IS ONE.

   `partner_audit` records every change to `opndoor_pays_agents` with a
   timestamp, so the value in force when an application was created is
   recoverable two ways, and both are used here because each covers a gap
   the other leaves:

     from before  the NEW value of the most recent change at or before
                  creation. Answers for anything created after the first
                  ever change.
     from after   the OLD value of the earliest change after creation.
                  Answers for anything created BEFORE the first change,
                  which the first lookup cannot see.

   On dev the two agree wherever both apply, which is the check worth
   having: they are independent readings of the same ledger.

   AND MATT'S RULE FOR THE REST. "For older referrals with no audit
   record, fill the frozen setting from the partner's current setting and
   list in QUEUE.md which rows were filled that way." The coalesce below
   is that rule. On dev it fills NOTHING: both supplier-estate
   applications are answered by the audit. It is here for live, where the
   ledger may not reach back as far.

   AN UNKNOWN PHRASE FALLS THROUGH rather than reading as false. The
   audit stores the human sentence, so a future rewording would otherwise
   be silently read as "the supplier pays its own agents" on every
   historic row. Null from the CASE means "the ledger did not answer",
   and the coalesce then applies Matt's fallback, which is the honest
   outcome rather than a confident wrong one.

   SUPPLIER ESTATES ONLY. On the agency and direct rails there is no
   supplier, no supplier line and nothing for the arrangement to decide,
   so the column stays null there and says so.
   ===================================================================== */
update public.applications a
   set opndoor_pays_agents_at_freeze = coalesce(
     (select case au.new_value
               when 'opndoor pays the agents'          then true
               when 'the supplier pays its own agents' then false
               else null end
        from public.partner_audit au
       where au.partner_id = a.partner_id
         and au.field = 'opndoor_pays_agents'
         and au.at <= a.created_at
       order by au.at desc
       limit 1),
     (select case au.old_value
               when 'opndoor pays the agents'          then true
               when 'the supplier pays its own agents' then false
               else null end
        from public.partner_audit au
       where au.partner_id = a.partner_id
         and au.field = 'opndoor_pays_agents'
         and au.at > a.created_at
       order by au.at asc
       limit 1),
     (select p.opndoor_pays_agents from public.partners p where p.id = a.partner_id)
   )
 where exists (
   select 1 from public.partners p
    where p.id = a.partner_id and p.partner_kind = 'supplier'
 );

/* =====================================================================
   AND EVERY NEW REFERRAL STAMPS ITS OWN.

   In `sync_application_partner`, which is the BEFORE INSERT trigger that
   already resolves `partner_id` from the branch: once the route partner
   is known, the arrangement is known, and putting it anywhere else would
   be a second place that has to agree with this one about which partner
   the row is on.

   ON INSERT ONLY. The trigger also fires on UPDATE OF branch_id and
   agency_id -- moving a referral between branches must not re-stamp an
   arrangement that was agreed when it was sold, which is the whole point
   of a snapshot.

   AND ONLY WHEN THE CALLER DID NOT STATE ONE, exactly as the
   `partner_id` line above it does. A fixture or a correction may set it
   deliberately, and a trigger that overwrote it would make that
   impossible.
   ===================================================================== */
create or replace function public.sync_application_partner()
returns trigger language plpgsql as $$
declare b record;
begin
  select agency_id, partner_id into b from public.branches where id = new.branch_id;
  if not coalesce(found, false) then raise exception 'branch % not found', new.branch_id; end if;

  -- Structural, always.
  new.agency_id := b.agency_id;

  -- The route. Derived ONLY when the caller did not state one. Both existing
  -- create paths state one, and state the same value this would derive, so this
  -- branch is not reached by the referral path at all.
  if new.partner_id is null then
    new.partner_id := b.partner_id;
  end if;

  -- The arrangement, snapshotted beside the rates. Null off a supplier
  -- estate, where there is no supplier and nothing to decide.
  if tg_op = 'INSERT' and new.opndoor_pays_agents_at_freeze is null then
    select p.opndoor_pays_agents into new.opndoor_pays_agents_at_freeze
      from public.partners p
     where p.id = new.partner_id
       and p.partner_kind = 'supplier';
  end if;

  return new;
end $$;
