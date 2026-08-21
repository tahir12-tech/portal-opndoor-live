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
const STEPS: TimelineStep[] = [
  { label: 'Your application', date: '', note: 'Details, fee and documents' },
  { label: 'Eligibility check', date: '', note: 'We check whether we can guarantee you' },
  { label: 'Decision',         date: '', note: 'Approved or not' },
  { label: 'Guarantee fee',    date: '', note: "One month's rent" },
  { label: 'Guarantee issued', date: '', note: 'Deed of Guarantee in place' },
];

export interface StatusView {
  reached: number;
  terminated: boolean;
  headline: string;
  detail: string;
  tone: 'progress' | 'waiting' | 'good' | 'bad';
  cta?: 'pay_guarantee';
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
  managedByKind?: string | null,
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
        detail: 'We are checking your eligibility now. It usually takes a few working days. We will email you as soon as there is a decision, and you do not need to do anything in the meantime.',
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
        detail: "You have been approved. The last step is the guarantee fee, one month's rent, and then we issue the Deed of Guarantee to whoever manages the property.",
      };
    case 'paid':
      return {
        reached: 5, terminated: false, tone: 'good',
        headline: 'Guarantee fee paid',
        detail: 'Thank you. We are preparing your Deed of Guarantee now and will email it to you and to whoever manages the property.',
      };
    case 'deed':
      return {
        reached: 6, terminated: false, tone: 'good',
        headline: 'Your guarantee is in place',
        detail: 'The Deed of Guarantee has been issued. A copy is on the "Your guarantee" tab, and whoever manages the property has one too.',
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
  view, guaranteeRef, onPayGuarantee, busy,
}: {
  view: StatusView;
  guaranteeRef: string;
  onPayGuarantee?: () => void;
  busy?: boolean;
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
      </div>
      <StatusTimeline steps={STEPS} reached={view.reached} terminated={view.terminated} />
    </section>
  );
}
