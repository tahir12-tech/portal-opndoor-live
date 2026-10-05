/* =====================================================================
   THE JOURNEY THIS SUPPLIER ACTUALLY GETS, AND THE OTHER TWO BEHIND A
   HEADING.

   Matt (dj): "Make the Dev Centre's API documentation and Getting
   started follow the supplier's checking setting: show the journey,
   statuses and webhook events that apply to their current setting
   (accepts as sent / applies its own criteria / Opndoor checks), with
   the others available under 'If your checking setting changes'.
   State that each application keeps the setting in force when it was
   created, so changing it never changes applications already sent.
   Admins viewing a supplier's Dev Centre see that supplier's version."

   =====================================================================
   WHY A DEVELOPER NEEDS THIS AND A READER OF THE GUIDES NEEDS IT LESS
   =====================================================================

   A guide that describes the wrong journey misleads somebody. Docs
   that describe the wrong journey make them write code that breaks:
   an integrator on "accepts as sent" who builds a state machine
   around `application.decision` is waiting for an event that will
   never arrive, and one on "opndoor checks" who does NOT build for it
   drops a status their applications really pass through.

   THE FROZEN RULE IS THE SHARPEST PART. `applications.referencing_mode`
   is stamped at creation, so flipping the setting does not move
   anything already sent -- which means a developer who changes it and
   then tests against old applications sees the OLD journey and
   concludes the change did not work. Said plainly here because
   nothing else tells them.

   THE SETTING IS THE ORGANISATION'S, NOT THE READER'S, so an admin
   looking at Kestrel's Dev Centre sees Kestrel's journey. Same rule
   as Help, for the same reason: the docs are right or wrong about a
   company.
   ===================================================================== */
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { REFERENCING_MODES, type ReferencingMode } from '@/data';

interface Journey {
  /** The statuses an application passes through, in order. */
  statuses: string[];
  /** What happens, in one sentence a developer can build against. */
  flow: string;
  /** The webhook events this setting actually emits. */
  events: string[];
  /** The trap for an integrator on this setting. */
  watch: string;
}

/* ONE ENTRY PER SETTING, keyed on the stored value so a new mode
   cannot be added to the product without this failing to resolve. */
export const JOURNEY_BY_MODE: Record<ReferencingMode, Journey> = {
  pre_referenced_open: {
    statuses: ['sent', 'paid', 'deed'],
    flow: 'You reference the tenant. You POST the application, opndoor accepts it as sent, and the tenant is sent a payment link straight away. There is no decision step.',
    events: ['application.created', 'application.paid', 'application.deed_issued'],
    watch: 'Do not build a wait state for a decision. Nothing will ever move an application of yours into Awaiting decision, so code that blocks on one will never proceed.',
  },
  pre_referenced_screened: {
    statuses: ['sent', 'referencing', 'paid', 'deed'],
    flow: 'You reference the tenant and POST the application. opndoor then applies its own criteria and decides whether to stand as guarantor. The application sits at Awaiting decision until it does, and only an accepted application reaches payment.',
    events: ['application.created', 'application.decision', 'application.paid', 'application.deed_issued'],
    watch: 'An application can be DECLINED. Handle the decision event with both outcomes: an integration that assumes acceptance will show a tenant a payment step that never arrives.',
  },
  opndoor_referenced: {
    statuses: ['sent', 'referencing', 'paid', 'deed'],
    flow: 'You POST the application and opndoor references the tenant itself. The tenant completes their own application and pays the eligibility check fee, opndoor checks them, and only an accepted application reaches the guarantee fee.',
    events: ['application.created', 'application.decision', 'application.paid', 'application.deed_issued'],
    watch: 'There are TWO payments on this setting: the tenant’s eligibility check fee first, then the guarantee fee after acceptance. Only the second emits application.paid. An integration that treats the first as the guarantee fee will mark applications paid that are not.',
  },
};

const label = (m: ReferencingMode) => REFERENCING_MODES.find((x) => x.id === m)?.choice ?? m;

function JourneyBody({ mode }: { mode: ReferencingMode }) {
  const j = JOURNEY_BY_MODE[mode];
  return (
    <>
      <p>{j.flow}</p>
      <p><b>Statuses, in order:</b> {j.statuses.map((s) => <code key={s}>{s} </code>)}</p>
      <p><b>Webhook events you will receive:</b> {j.events.map((e) => <code key={e}>{e} </code>)}</p>
      <p><b>Watch out:</b> {j.watch}</p>
    </>
  );
}

export function CheckingJourney({ mode, orgName }: { mode: ReferencingMode | null; orgName?: string | null }) {
  /* NO SETTING RESOLVED: show all three rather than guessing one. A
     developer shown the wrong journey writes the wrong code, which is
     worse than being shown three and told to check which is theirs. */
  const known = mode != null;
  const others = (Object.keys(JOURNEY_BY_MODE) as ReferencingMode[]).filter((m) => m !== mode);
  return (
    <Card>
      <CardHead
        title="The journey your applications take"
        sub={known ? `${orgName ?? 'Your organisation'}: ${label(mode)}` : 'Shown for all three settings, because yours has not resolved'}
      />
      <CardBody>
        {known ? <JourneyBody mode={mode} /> : null}
        {/* THE FROZEN RULE. Matt asked for it in as many words, and it
            is the thing a developer discovers the hard way otherwise. */}
        <p>
          <b>Each application keeps the setting that was in force when it was created.</b>{' '}
          Changing your checking setting never changes applications already sent, so a
          test against an older application will still show you the older journey.
        </p>
        <details>
          <summary>If your checking setting changes</summary>
          {(known ? others : (Object.keys(JOURNEY_BY_MODE) as ReferencingMode[])).map((m) => (
            <div key={m}>
              <h4>{label(m)}</h4>
              <JourneyBody mode={m} />
            </div>
          ))}
        </details>
      </CardBody>
    </Card>
  );
}
