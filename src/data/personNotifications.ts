/* =====================================================================
   ONE PERSON'S NOTIFICATIONS, ON ANY OF THE THREE PARTIES.

   Walk fixes 9, 10 and 12. Matt: "notifications move onto each person, like
   permissions, reached from their row... Build items 10 and 12 as one shared
   design so Opndoor team and agency people work the same way; suppliers too."

   THE REASON THIS IS A FUNCTION AND NOT JUST A COMPONENT. The three parties
   do not share a server model:

     Opndoor          ops_routing_matrix    alert x RECIPIENT       per person
     agency/supplier  notification_matrix   event x recipient CLASS party-wide

   So "which events is this person told about" is a fact about the PERSON on
   one side and a fact about the WHOLE AGENCY on the other. One panel has to
   present both without pretending they are the same thing, and that decision
   belongs somewhere a test can hold it to account rather than buried in JSX.

   WHAT THE PANEL WILL NOT DO. It will not show a party-wide switch as though
   it were personal. `partyWide` is carried on every row precisely so the
   screen must say "this affects everyone at the agency" where that is true.
   Hiding it would mean a Director edits one person and silently changes what
   every colleague receives -- the exact class of surprise the walk keeps
   finding, introduced on purpose.
   ===================================================================== */
import { OPS_FLOOR_REASON, isLastCritical, type OpsRouteCell } from './opsRoutingService';
import { LOCKED_REASON, type MatrixCell } from './notificationMatrixService';

export type PartyKind = 'opndoor' | 'agency' | 'supplier';

export interface EventRow {
  /** The notification or alert type key, for the write call. */
  type: string;
  label: string;
  /** For the agency and supplier rails only: which recipient class this row
   *  is. Null on Opndoor, where the row IS the person. */
  recipient: string | null;
  on: boolean;
  /** The sentence to print beside a locked row, or null when it is simply
   *  off. Never a bare boolean: item 9's complaint was that boxes could not
   *  be unticked and "nothing says why", so a lock without its reason is the
   *  bug rather than the fix. */
  locked: string | null;
  /** True when changing this changes it for EVERYBODY at the party. */
  partyWide: boolean;
}

export interface ToggleRow { on: boolean; locked: string | null }

export interface PersonPanel {
  /** Copied on referrals within their position. Null where the concept does
   *  not apply to this party. */
  copied: ToggleRow | null;
  /** Monthly commission statements. Null where it does not apply. */
  statements: ToggleRow | null;
  events: EventRow[];
  /** True when any event row is party-wide, so the screen can say it once
   *  above the list rather than on every line. */
  anyPartyWide: boolean;
}

export interface PanelInput {
  party: PartyKind;
  userId: string;
  /** `receives_notifications` for this person, or null if not applicable. */
  copiedOnReferrals: boolean | null;
  /** `receives_commission_statements`, or null if not applicable. */
  getsStatements: boolean | null;
  /** Opndoor only: the whole routing matrix; filtered to this person here. */
  ops: OpsRouteCell[];
  /** Agency and supplier: the party's matrix. */
  matrix: MatrixCell[];
}

/**
 * COPIED ON REFERRALS IS NOT OFFERED ON THE SUPPLIER RAIL.
 *
 * B3: `set_receives_notifications`'s scope test requires the TARGET to hold a
 * position, and positions exist only on the house estate. So the control can
 * never succeed for a supplier's colleague. Offering a switch that always
 * fails is worse than offering none, and this is the one place the shared
 * design is deliberately not identical across the three parties.
 */
function copiedApplies(party: PartyKind): boolean {
  return party === 'agency';
}

/** Opndoor staff are not paid commission, so there is no statement for them. */
function statementsApply(party: PartyKind): boolean {
  return party === 'agency' || party === 'supplier';
}

export function buildPersonPanel(input: PanelInput): PersonPanel {
  const events: EventRow[] = input.party === 'opndoor'
    ? input.ops
        .filter((c) => c.recipientKind === 'person' && c.recipientId === input.userId)
        .sort((a, b) => a.typeOrd - b.typeOrd)
        .map((c) => ({
          type: c.alertType,
          label: c.label,
          recipient: null,
          on: c.enabled,
          // The floor, shown rather than only enforced. The SQL refuses it
          // anyway; this is the courtesy half.
          locked: isLastCritical(c) ? OPS_FLOOR_REASON : null,
          partyWide: false,
        }))
    : [...input.matrix]
        .sort((a, b) => (a.typeOrd - b.typeOrd) || (a.recipientOrd - b.recipientOrd))
        .map((c) => ({
          type: c.notificationType,
          label: c.typeLabel,
          recipient: c.recipient,
          on: c.enabled,
          locked: c.locked ? LOCKED_REASON : null,
          partyWide: true,
        }));

  return {
    copied: copiedApplies(input.party) && input.copiedOnReferrals !== null
      ? { on: input.copiedOnReferrals, locked: null }
      : null,
    statements: statementsApply(input.party) && input.getsStatements !== null
      ? { on: input.getsStatements, locked: null }
      : null,
    events,
    anyPartyWide: events.some((e) => e.partyWide),
  };
}
