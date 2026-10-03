/* =====================================================================
   #1 Tenant payment confirmation page (/pay?token=...). Public, read-only,
   tokenised, mobile-first. Sits between the payment email and Stripe. The Pay
   button mints a fresh Stripe Checkout session server-side and redirects.
   #13 Expired applications get a fresh payment link (never a dead end).
   #14 Carries a quiet, two-step tenant self-decline.
   No login, no navigation, no data entry (beyond the decline confirm).
   ===================================================================== */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PayFrame } from './PayFrame';
import { requestSigningLinkByToken, getPayPage, startCheckout, declineApplication, type PayPageData } from './paymentPageApi';
import { Icon } from '@/components/ui/Icon';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { countOf } from '@/lib/plural';

type Phase = 'loading' | 'ready' | 'paid' | 'closed' | 'invalid' | 'declined';

const DECLINE_REASONS = [
  { value: 'another_guarantor', label: 'I found another guarantor' },
  { value: 'tenancy_fell_through', label: 'The tenancy fell through' },
  { value: 'other', label: 'Other' },
];

function Row({ k, v }: { k: string; v: string }) {
  return <div className="pay__rrow"><span className="pay__rk">{k}</span><span className="pay__rv">{v}</span></div>;
}

function Faq({ q, a }: { q: string; a: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`pay__faq${open ? ' is-open' : ''}`}>
      <button type="button" className="pay__faq-q" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{q}</span><Icon name="chevronDown" />
      </button>
      {open && <div className="pay__faq-a">{a}</div>}
    </div>
  );
}

export function PayLanding() {
  useDocumentTitle('Your guarantee fee');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const utm = params.get('utm_source') || 'confirmation_page';

  const [phase, setPhase] = useState<Phase>('loading');
  const [data, setData] = useState<PayPageData | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // #14 decline sub-flow: null (not started) -> confirm form -> submitting
  /* THE SIGNING TRIP, which only a paid-and-unsigned link ever takes. Its own
     state rather than reusing `busy`: that one disables the Pay button, and
     these two states cannot both be on screen. */
  const [signing, setSigning] = useState(false);
  const [signErr, setSignErr] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  /* WITH THE OTHER HOOKS, ABOVE EVERY EARLY RETURN. This sat down beside the
     branch that uses it, which React refuses: `phase` gates several returns
     above, so the hook count changed between renders and the page died with
     "Rendered more hooks than during the previous render".

     MINTED ON DEMAND, and opened in this tab. Matt: "show the 'Sign your deed
     now' button."

     THE SAME TAB, not a new one: a popup blocker eats a window opened from an
     async callback, and the tenant is finished with this page either way.

     A FAILURE SAYS WHAT HAPPENS NEXT rather than what went wrong. The deed is
     emailed to them regardless, so the honest message is that the link is
     coming, which is also true. */
  const onSignFromLink = useCallback(async () => {
    if (!token || signing) return;
    setSigning(true);
    setSignErr(false);
    const r = await requestSigningLinkByToken(token);
    if (r.signingUrl) { window.location.href = r.signingUrl; return; }
    setSigning(false);
    setSignErr(true);
  }, [token, signing]);

  const [declineReason, setDeclineReason] = useState('another_guarantor');

  const load = useCallback(async () => {
    if (!token) { setPhase('invalid'); return; }
    const d = await getPayPage(token);
    if (!d.ok) {
      // A transient blip keeps the page trying; a definitive failure shows invalid.
      if (d.transient) { setTimeout(() => void load(), 2500); return; }
      setPhase('invalid'); return;
    }
    setData(d);
    setPhase(d.isPaid ? 'paid' : d.isClosed ? 'closed' : 'ready');
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const pay = async () => {
    setBusy(true); setErr('');
    const r = await startCheckout(token, utm);
    if (r.ok && r.url) { window.location.href = r.url; return; }
    setErr(r.error || 'We could not start the payment. Please try again.');
    setBusy(false);
  };

  const confirmDecline = async () => {
    setBusy(true); setErr('');
    const r = await declineApplication(token, declineReason);
    setBusy(false);
    if (!r.ok) { setErr(r.error || 'Could not record that. Please contact support@opndoor.co.'); return; }
    // Idempotent: if it was already paid meanwhile, reflect that instead.
    if (r.status === 'paid' || r.status === 'deed') { setPhase('paid'); return; }
    setPhase('declined');
  };

  if (phase === 'loading') {
    return <PayFrame><div className="pay__spinner" /><p className="pay__lead" style={{ textAlign: 'center' }}>Loading your details…</p></PayFrame>;
  }

  if (phase === 'invalid') {
    return (
      <PayFrame>
        <div className="pay__icon pay__icon--warn"><Icon name="alert" /></div>
        <h1 className="pay__title">This link is not valid</h1>
        <p className="pay__lead">This payment link may have expired or been mistyped. Please use the most recent email we sent you, or contact us at <a href="mailto:support@opndoor.co">support@opndoor.co</a>.</p>
      </PayFrame>
    );
  }

  if (phase === 'paid') {
    /* =====================================================================
       WHERE THEY ACTUALLY ARE, not where they were when the email was sent.

       Matt, 2026-10-03: "Tenant payment link opened after payment: reflect
       where they actually are. If the deed is signed: 'Your guarantee fee is
       paid and your Deed of Guarantee is signed. Nothing more is needed. A
       copy was emailed to you.' If paid but not yet signed: show the 'Sign
       your deed now' button."

       THE SAVED LINK IS THE COMMON CASE, not the edge. The payment email is
       the one the tenant keeps, so the SECOND time they open it is the
       ordinary journey, and this page told all of them the same thing: "your
       Deed of Guarantee will be sent to you to sign" -- to somebody who had
       already signed it, and to somebody whose deed was sitting there waiting
       with no way to reach it from here.

       THE SAME THREE STATES THE POST-CHECKOUT PAGE DRAWS, deliberately
       worded the same way, because they are one journey reached by two doors
       and a tenant comparing them should not find two answers. */
    const signedOff = data?.deedSigned === true;
    const readyToSign = data?.deedReady === true;
    return (
      <PayFrame>
        <div className="pay__icon pay__icon--ok"><Icon name="check" /></div>
        <h1 className="pay__title">{signedOff ? 'You are all set' : 'This fee has been paid'}</h1>
        {signedOff ? (
          <p className="pay__lead">Your guarantee fee is paid and your Deed of Guarantee is signed. Nothing more is needed. A copy was emailed to you{data?.ref ? <> (reference <b>{data.ref}</b>)</> : null}.</p>
        ) : readyToSign ? (
          <>
            <p className="pay__lead">Thank you, your guarantee fee has been paid{data?.ref ? <> (reference <b>{data.ref}</b>)</> : null}. Your Deed of Guarantee is ready to sign.</p>
            <button className="pay__btn pay__btn--primary" onClick={() => void onSignFromLink()} disabled={signing}>
              <Icon name="edit" strokeWidth={2} /> {signing ? 'Opening…' : 'Sign your deed now'}
            </button>
            {signErr && <p className="pay__muted">We couldn&rsquo;t open the signing session just now. We&rsquo;ll email your signing link shortly.</p>}
          </>
        ) : (
          /* STILL BEING PREPARED, which is a real state and is nobody's
             fault: the deed is generated after payment. The old sentence is
             the right one here and nowhere else. */
          <p className="pay__lead">Thank you, your guarantee fee has been paid and nothing more is needed. Your Deed of Guarantee will be sent to you to sign electronically{data?.ref ? <> (reference <b>{data.ref}</b>)</> : null}.</p>
        )}
      </PayFrame>
    );
  }

  if (phase === 'declined') {
    return (
      <PayFrame>
        <div className="pay__icon pay__icon--ok"><Icon name="check" /></div>
        <h1 className="pay__title">Thanks for letting us know</h1>
        <p className="pay__lead">No payment is needed. If this changes, contact us at <a href="mailto:support@opndoor.co">support@opndoor.co</a>{data?.ref ? <> quoting <b>{data.ref}</b></> : null} and we'll help.</p>
      </PayFrame>
    );
  }

  if (phase === 'closed') {
    // Staff-closed / withdrawn: not payable, not a tenant decline flow.
    return (
      <PayFrame>
        <div className="pay__icon pay__icon--warn"><Icon name="info" /></div>
        <h1 className="pay__title">This referral is closed</h1>
        <p className="pay__lead">No payment is needed for this referral. If you think this is a mistake, contact us at <a href="mailto:support@opndoor.co">support@opndoor.co</a>{data?.ref ? <> quoting <b>{data.ref}</b></> : null}.</p>
      </PayFrame>
    );
  }

  // phase === 'ready' (Sent, or #13 Expired — both payable; expired gets a fresh link)
  const d = data!;
  const expiredNote = d.isExpired;

  if (declineOpen) {
    return (
      <PayFrame>
        <h1 className="pay__title">No longer need a guarantor?</h1>
        <p className="pay__lead">To close this off, please confirm below. A single click won't withdraw anything, we just want to be sure.</p>
        <div className="pay__field">
          <label htmlFor="decline-reason">Reason (optional)</label>
          <select id="decline-reason" value={declineReason} onChange={(e) => setDeclineReason(e.target.value)}>
            {DECLINE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        {err && <p className="pay__err">{err}</p>}
        <button type="button" className="pay__btn pay__btn--primary" disabled={busy} onClick={() => void confirmDecline()}>
          {busy ? 'Saving…' : 'I no longer need a guarantor for this tenancy'}
        </button>
        <button type="button" className="pay__btn pay__btn--dark" disabled={busy} onClick={() => { setDeclineOpen(false); setErr(''); }} style={{ marginTop: 10 }}>
          Go back
        </button>
      </PayFrame>
    );
  }

  /* ONE TENANCY, A SHARE EACH. Everything below that states a figure has to say
     whether it is the tenancy's or this tenant's, because on a joint tenancy they
     are different numbers and the tenant is being asked to pay one of them. */
  const joint = (d.tenantCount ?? 1) > 1;

  return (
    <PayFrame>
      <h1 className="pay__title">Your guarantee fee, {d.addr1}</h1>
      {/* WHO ARRANGED THIS, in the words that are true of this referral.

          Two things were wrong on one line. It said "referred via {partnerName}",
          and partnerName is partners.name: the ROUTE partner, the group above the
          agency. A Regent tenant read the name of a holding company they have
          never dealt with, on the page where they hand over a card, having just
          been emailed a sentence that correctly named Regent's Lettings. And it
          asserted that opndoor stands as their guarantor as though opndoor had
          taken a view of them, which on a pre-referenced referral it never did:
          the agency decided and arranged it.

          So the agency-arranged case names the agency and says what opndoor is
          actually doing, and every other rail keeps the approved wording, which
          is correct there because opndoor did make the decision. */}
      {d.agencyArranged && d.agencyName ? (
        <>
          <p className="pay__lead">{d.agencyName} has arranged an opndoor guarantee for your tenancy at {d.propFull}.</p>
          <p className="pay__lead">opndoor provides a Deed of Guarantee in favour of the property, covering 12 months from your tenancy start, so your tenancy can proceed.</p>
        </>
      ) : (
        <>
          <p className="pay__lead">You've been referred via {d.partnerName} for opndoor's professional guarantor service, for your tenancy at {d.propFull}.</p>
          <p className="pay__lead">opndoor stands as your professional guarantor: we provide a Deed of Guarantee in favour of the property, covering 12 months from your tenancy start, so your tenancy can proceed.</p>
        </>
      )}

      {expiredNote && (
        <p className="pay__note">This link had lapsed, so we've refreshed it for you. You can still pay below, your referral will pick up right where it left off.</p>
      )}

      <div className="pay__receipt">
        <Row k="Tenant" v={d.tenantName || '-'} />
        <Row k="Property" v={d.propFull || '-'} />
        <Row k="Tenancy start" v={d.tenancyStart || '-'} />
        <Row k="Monthly rent" v={`£${(d.monthlyRent ?? 0).toLocaleString('en-GB')}`} />
        {/* A JOINT TENANT PAYS A SHARE, so the rent their fee is measured against
            is not the rent on the line above. Printing only the tenancy rent beside
            a share of the fee made the page contradict its own arithmetic: £346.15
            under £1,000 reads as a discount or a mistake. Shown only when the two
            actually differ, so a sole tenant gains no row. */}
        {d.rentShare != null && d.monthlyRent != null && d.rentShare !== d.monthlyRent && (
          <Row k="Your share of the rent" v={`£${d.rentShare.toLocaleString('en-GB')}`} />
        )}
      </div>

      <div className="pay__fee">
        {/* A SHARE IS NOT THE FEE. On a joint tenancy the figure below is this
            tenant's share of a fee the tenancy was charged once, so labelling it
            "Guarantee fee" and stating the tenancy's basis under it asks the reader
            to reconcile two numbers that do not divide into one another. */}
        <div className="pay__fee-k">{joint ? 'Your share of the guarantee fee' : 'Guarantee fee'}</div>
        <div className="pay__fee-v">{d.feeGBP}</div>
        {/* The fee is not always one month's rent: an agency on a negotiated
            basis pays weeks of it, and one tenant of a joint tenancy pays a
            share. The amount above is authoritative either way, so the line
            under it must not contradict it.

            It used to say nothing at all, which was the reported defect on this
            page: the right figure, and no statement of what it was measured
            against, two lines under a rent it does not equal. payment-page has
            returned feeBasis all along and the contract this page renders from
            did not declare it, so the value arrived and was thrown away. When the
            basis genuinely cannot be worked out the sentence stays as it was
            rather than guessing the commonest answer. */}
        <div className="pay__fee-s">
          {d.feeBasis
            ? (joint
                ? `The fee is ${d.feeBasis}, split between ${countOf(d.tenantCount ?? 0, 'tenant')}. `
                : `${d.feeBasis}. `)
            : ''}One-off payment. Reference {d.ref}.
        </div>
      </div>

      <div className="pay__after">
        <div className="pay__after-h">What happens after you pay</div>
        <p>You'll be sent your Deed of Guarantee to sign electronically (it takes two minutes), your letting agent receives the executed deed, and your tenancy proceeds. Nothing else is needed from you.</p>
      </div>

      {err && <p className="pay__err">{err}</p>}
      <button type="button" className="pay__btn pay__btn--primary" disabled={busy} onClick={() => void pay()}>
        {busy ? 'Starting secure payment…' : 'Pay the guarantee fee'}
      </button>
      <p className="pay__secure"><Icon name="lock" /> Payment is secure and handled by Stripe.</p>

      <p className="pay__fine">Spot something wrong in your details? Contact us at <a href="mailto:support@opndoor.co">support@opndoor.co</a> quoting {d.ref} before paying, and we'll put it right.</p>

      <div className="pay__faqs">
        <Faq q="What is a Deed of Guarantee?" a={<>It's a legal deed in which opndoor acts as your professional guarantor, in favour of the property. It lets your tenancy proceed when you can't provide your own guarantor. It's a professional guarantor service, not insurance.</>} />
        {/* WHAT THE DEED ACTUALLY COVERS, which on a joint tenancy is this tenant's
            SHARE of the rent and not the whole of it. Each tenant signs their own
            deed for their own share (see the per-tenant deed ruling), so a page
            that says "your obligations under the tenancy" without naming the share
            overstates what this tenant has signed up to. */}
        <Faq q="What does it cover?" a={joint && d.rentShare != null
          ? <>Your own Deed of Guarantee covers your share of the rent, £{d.rentShare.toLocaleString('en-GB')} a month, for 12 months from your tenancy start. Each tenant signs their own deed for their own share. If there's ever a claim, your letting agent is the point of contact with opndoor.</>
          : <>It supports your obligations under the tenancy, such as rent, for 12 months from your tenancy start. If there's ever a claim, your letting agent is the point of contact with opndoor.</>} />
        <Faq q="When does the guarantee take effect?" a={<>Your Deed of Guarantee is in force from your tenancy start date, {d.tenancyStart}, and covers 12 months from then. The guarantee fee is non-refundable from your tenancy start date. If your circumstances change before then, contact us at <a href="mailto:support@opndoor.co">support@opndoor.co</a> quoting {d.ref}.</>} />
      </div>

      <button type="button" className="pay__decline" onClick={() => { setDeclineOpen(true); setErr(''); }}>
        No longer need this? Let us know.
      </button>
    </PayFrame>
  );
}
