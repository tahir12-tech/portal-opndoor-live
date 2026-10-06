/* =====================================================================
   Where the application actually is, in words and on the portal's own timeline.

   THE GAP THIS FILLS. The journey showed a form and nothing else, so a tenant
   who had submitted saw the same screen as one who had not, and a tenant who
   had been approved had no way to learn it from the product. "Have they got
   back to me yet" is the single question somebody has after submitting, and it
   was the one thing the screen could not answer.

   Same StatusTimeline the staff application view uses, so a tenant and the
   agent looking at the same application see the same shape of progress.
   ===================================================================== */
import { StatusTimeline, type TimelineStep } from '@/components/ui/StatusTimeline';
import { Icon } from '@/components/ui/Icon';
// The timeline's own styles live with the staff application view. Imported
// rather than copied, so a tenant and an agent see the same component styled
// by the same rules.
import '@/pages/ApplicationDetail/ApplicationDetail.css';

/* The five stages a tenant experiences, which are NOT the five values of
   applications.status. Status is our vocabulary: 'sent' means a payment link is
   out, which is meaningless to the person it was sent to. This is theirs. */
/* THE FEE STEP'S NOTE WAS THE STRING "One month's rent", unconditionally.

   That was true of every application while the fee WAS a month of rent, and it
   stopped being true when negotiated three and five week bases landed. It is the
   reported GR-20837 sentence surviving in the client: a Regent tenant charged
   £692.31 on a £1,000 rent read "One month's rent" on the screen they pay from.
   The agency-facing equivalent of this note (src/data/journeyStages.ts) had
   already had its fallback deleted and takes the basis from its caller; the
   tenant copy kept the fallback, which is the wrong way round, because the tenant
   is the one being asked for the money.

   Now a function of the basis the caller knows. No basis means no note rather
   than the commonest guess: the step is still called "Guarantee fee", which is
   what it is, and a sentence nobody verified is worse than no sentence. */
export function stepsFor(feeBasis?: string | null): TimelineStep[] {
  const basis = feeBasis && feeBasis.trim() ? feeBasis.trim() : '';
  return [
    { label: 'Your application', date: '', note: 'Details, fee and documents' },
    { label: 'Eligibility check', date: '', note: 'We check whether we can guarantee you' },
    { label: 'Decision',         date: '', note: 'Approved or not' },
    { label: 'Guarantee fee',    date: '', note: basis ? basis.charAt(0).toUpperCase() + basis.slice(1) : '' },
    { label: 'Guarantee issued', date: '', note: 'Deed of Guarantee in place' },
  ];
}

export interface StatusView {
  reached: number;
  terminated: boolean;
  headline: string;
  detail: string;
  tone: 'progress' | 'waiting' | 'good' | 'bad';
  cta?: 'pay_guarantee' | 'sign_deed' | 'view_deed';
}

/** "your letting agent", "your landlord", or a phrase committing to neither.

    The form already asks "Who manages the property?" and stores the answer, so
    this reads it rather than assuming. The fallback is vague on purpose: it is
    true whoever manages the property, and true when we do not yet know. */
export function managedByLabel(kind?: string | null): string {
  if (kind === 'letting_agent') return 'your letting agent';
  if (kind === 'private_landlord') return 'your landlord';
  return 'whoever manages the property';
}

export function statusView(
  status: string, feePaid: boolean, doneCount: number, total: number,
  managedByKind?: string | null, deedState?: string | null,
  /** "3 weeks of rent", from the application's own fee and share of the rent.
      Omitted means unknown, and the approved state then names the step without
      pricing it rather than asserting a month. */
  feeBasis?: string | null,
): StatusView {
  const managedBy = managedByLabel(managedByKind);
  switch (status) {
    case 'draft':
      return {
        reached: 1, terminated: false, tone: 'progress',
        headline: doneCount === total ? 'Ready to send' : 'In progress',
        detail: doneCount === total
          ? 'Everything is filled in. Send it from the Declaration step whenever you are ready.'
          : `${doneCount} of ${total} sections done.${feePaid ? '' : ' The application fee unlocks the rest.'}`,
      };
    case 'referencing':
      return {
        reached: 2, terminated: false, tone: 'waiting',
        headline: 'Eligibility check in progress',
        detail: 'We are checking your eligibility now. This usually does not take long. We will email you as soon as there is a decision, and you do not need to do anything in the meantime.',
      };
    case 'declined':
      return {
        reached: 3, terminated: true, tone: 'bad',
        headline: 'Not approved',
        detail: 'We were not able to approve this application on the eligibility check. We know that is disappointing. If your circumstances change, you are welcome to apply again.',
      };
    case 'sent':
      return {
        reached: 4, terminated: false, tone: 'good', cta: 'pay_guarantee',
        headline: 'Approved',
        /* THE ONLY STATEMENT OF PRICE ON THIS SCREEN, and it was hardcoded to a
           month. No figure is shown here at all, so this sentence was the whole
           of what the tenant was told they owed, and for an agency on a
           negotiated basis it was wrong. The basis is named when we know it and
           the clause is dropped when we do not. */
        detail: feeBasis && feeBasis.trim()
          ? `You have been approved. The last step is the guarantee fee, ${feeBasis.trim()}, and then we issue the Deed of Guarantee to ${managedBy}.`
          : `You have been approved. The last step is the guarantee fee, and then we issue the Deed of Guarantee to ${managedBy}.`,
      };
    case 'paid':
      // Once the deed has been generated it is awaiting the tenant's signature,
      // and the sign step happens here on the status screen, not only on the
      // Stripe return page. Before that, it is still being prepared.
      if (deedState === 'awaiting_tenant') {
        return {
          reached: 5, terminated: false, tone: 'good', cta: 'sign_deed',
          headline: 'Your deed is ready to sign',
          detail: `Thank you. Your Deed of Guarantee is ready. Sign it below and we issue it to ${managedBy}.`,
        };
      }
      return {
        reached: 5, terminated: false, tone: 'good',
        headline: 'Guarantee fee paid',
        detail: `Thank you. We are preparing your Deed of Guarantee now and will email it to you and to ${managedBy}.`,
      };
    case 'deed':
      return {
        reached: 6, terminated: false, tone: 'good', cta: 'view_deed',
        headline: 'Your guarantee is in place',
        detail: `Your Deed of Guarantee has been issued. You can view or download it below, and ${managedBy} has a copy too.`,
      };
    case 'withdrawn':
    case 'expired':
      return {
        reached: 1, terminated: true, tone: 'bad',
        headline: status === 'expired' ? 'This application has lapsed' : 'This application was withdrawn',
        detail: `Talk to ${managedBy}, or start again if you still need a guarantor.`,
      };
    default:
      return { reached: 1, terminated: false, tone: 'progress', headline: 'In progress', detail: '' };
  }
}

export function ApplicationStatus({
  view, guaranteeRef, onPayGuarantee, onSignDeed, onViewDeed, busy, feeBasis,
}: {
  view: StatusView;
  guaranteeRef: string;
  onPayGuarantee?: () => void;
  onSignDeed?: () => void;
  onViewDeed?: () => void;
  busy?: boolean;
  /** "3 weeks of rent", for the fee step's note. Omitted leaves the step named
      and unpriced, which is the honest answer when nothing has told us. */
  feeBasis?: string | null;
}) {
  return (
    <section className={`apst apst--${view.tone}`} aria-label="Application status">
      <div className="apst__head">
        <div>
          <div className="apst__eyebrow">{guaranteeRef}</div>
          <h2 className="apst__headline">
            {view.tone === 'good' && <Icon name="check" />}
            {view.tone === 'waiting' && <Icon name="clock" />}
            {view.tone === 'bad' && <Icon name="ban" />}
            {view.headline}
          </h2>
          <p className="apst__detail">{view.detail}</p>
        </div>
        {view.cta === 'pay_guarantee' && onPayGuarantee && (
          <button type="button" className="btn btn--primary" disabled={busy} onClick={onPayGuarantee}>
            {busy ? 'Taking you to payment…' : 'Pay the guarantee fee'}
          </button>
        )}
        {view.cta === 'sign_deed' && onSignDeed && (
          <button type="button" className="btn btn--primary" disabled={busy} onClick={onSignDeed}>
            {busy ? 'Opening…' : 'Sign the deed'}
          </button>
        )}
        {view.cta === 'view_deed' && onViewDeed && (
          <button type="button" className="btn btn--primary" disabled={busy} onClick={onViewDeed}>
            {busy ? 'Opening…' : 'View or download the deed'}
          </button>
        )}
      </div>
      {/* A tenant's current stage is always a phase in progress, never a completed
          event, so it shows its highlighted ring without a tick until it is done.
          "Guarantee issued" only ticks once the deed executes (status 'deed'). */}
      <StatusTimeline steps={stepsFor(feeBasis)} reached={view.reached} terminated={view.terminated} currentInProgress />
    </section>
  );
}
