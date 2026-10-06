/* Renders every email template into one page, so they can be reviewed side by
   side instead of one at a time in an inbox.

   It imports the REAL layout. If this page looks right, the emails look right,
   because there is no second copy of the markup to drift from. */
import { writeFileSync } from 'node:fs';
import { renderHtml, renderText, type Message } from '../supabase/functions/_shared/emailLayout.ts';

const APP = 'http://localhost:5173';

/** Pretend redirect, so the review banner can be seen without sending anything. */
const REDIRECTED = { to: ['mdwyer@opndoor.co'], redirected: true, intended: ['sam.okafor@example.com'] };

const MESSAGES: { id: string; note: string; m: Message; redirected?: boolean }[] = [
  { id: 'tenant-code', note: 'Registration and sign-in. The six-digit code.', m: {
    subject: '482913 is your opndoor confirmation code',
    heading: 'Your confirmation code',
    blocks: [
      { p: 'Enter this code to confirm your email address and continue your application.' },
      { callout: '482913' },
      { small: 'It lasts ten minutes and can be used once. If you did not ask for this, you can ignore it.' },
    ],
  } },
  { id: 'tenant-code-redirected', note: 'The same email, redirected. THE BANNER.', redirected: true, m: {
    subject: '482913 is your opndoor confirmation code',
    heading: 'Your confirmation code',
    blocks: [
      { p: 'Enter this code to confirm your email address and continue your application.' },
      { callout: '482913' },
      { small: 'It lasts ten minutes and can be used once.' },
    ],
  } },
  { id: 'password-reset', note: 'Reset link. Staff and tenant.', m: {
    subject: 'Reset your opndoor password',
    heading: 'Reset your password',
    blocks: [
      { p: 'We received a request to reset the password on your opndoor account. Choose a new one using the button below.' },
      { small: 'For your security this link expires in 30 minutes and can be used once. If you did not ask for it, nothing has changed and you can ignore this email.' },
    ],
    action: { label: 'Choose a new password', href: `${APP}/apply/reset#token_hash=abc123&type=recovery` },
  } },
  { id: 'tenant-invite', note: 'Agent referral. Invites the tenant to apply.', m: {
    subject: 'Complete your opndoor guarantee application',
    heading: 'Your agent has started an application for you',
    blocks: [
      { p: 'Northgate Lettings has referred you to opndoor for a guarantee on the property below. The next step is yours: finish the application and we will take it from there.' },
      { rows: [['Property', '12 Bramble Court, Sheffield S7 1FD'], ['Monthly rent', '£1,450'], ['Reference', 'GR-1042']] },
      { p: 'Everything saves as you go, so you can stop and come back whenever you like.' },
    ],
    action: { label: 'Continue your application', href: `${APP}/apply/invite?token=abc123` },
  } },
  { id: 'payment-link', note: 'Guarantee fee, one month rent.', m: {
    subject: 'Your opndoor guarantee is ready to pay',
    heading: 'Your guarantee is approved',
    blocks: [
      { p: 'Good news. Your application has been approved and the guarantee is ready. The last step is the guarantee fee.' },
      { rows: [['Reference', 'GR-1042'], ['Property', '12 Bramble Court, Sheffield'], ['Guarantee fee', '£1,450'], ['Tenancy starts', '1 September 2026']] },
      { small: 'The fee is one month of rent and is payable once. The Deed of Guarantee is issued as soon as it clears.' },
    ],
    action: { label: 'Pay the guarantee fee', href: `${APP}/pay?token=abc123` },
  } },
  { id: 'payment-receipt', note: 'After payment clears.', m: {
    subject: 'Payment received for GR-1042',
    heading: 'Thank you, your payment has cleared',
    blocks: [
      { p: 'We have received your guarantee fee. Your Deed of Guarantee is being prepared and will arrive shortly.' },
      { rows: [['Reference', 'GR-1042'], ['Amount paid', '£1,450'], ['Paid on', '21 August 2026']] },
    ],
  } },
  { id: 'deed-to-agent', note: 'Deed of Guarantee to the agent.', m: {
    subject: 'Deed of Guarantee issued for GR-1042',
    heading: 'The Deed of Guarantee is ready to sign',
    blocks: [
      { p: 'opndoor has issued a Deed of Guarantee for the tenancy below. It needs signing before it takes effect.' },
      { rows: [['Reference', 'GR-1042'], ['Tenant', 'Sam Okafor'], ['Property', '12 Bramble Court, Sheffield'], ['Tenancy starts', '1 September 2026']] },
      { small: 'opndoor is a professional guarantor service, not insurance, and is not a party to the tenancy agreement. You remain the claim contact.' },
    ],
    action: { label: 'Review and sign', href: 'https://app.pandadoc.com/s/abc123' },
  } },
  { id: 'executed-deed-agent', note: 'Signed deed, to the AGENT. As written today.', m: {
    subject: 'Signed Deed of Guarantee for GR-1042',
    heading: 'The Deed of Guarantee has been signed',
    blocks: [
      { p: 'The Deed of Guarantee for the tenancy below has been signed by all parties. A copy is attached for your records.' },
      { rows: [['Reference', 'GR-1042'], ['Tenant', 'Sam Okafor'], ['Property', '12 Bramble Court, Sheffield'], ['Guarantee expires', '31 August 2027']] },
      { small: 'opndoor remains the guarantor for the term above. You remain the claim contact.' },
    ],
  } },
  { id: 'executed-deed-tenant', note: 'Signed deed, to the TENANT. NEW. No Tenant line: they know who they are.', m: {
    subject: 'Your signed Deed of Guarantee for GR-1042',
    heading: 'Your Deed of Guarantee has been signed',
    blocks: [
      { p: 'The Deed of Guarantee for your tenancy has been signed by all parties. A copy is attached for your records, and you do not need to do anything else.' },
      { rows: [['Reference', 'GR-1042'], ['Property', '12 Bramble Court, Sheffield'], ['Guarantee expires', '31 August 2027']] },
      { small: 'opndoor is your guarantor for the term above. opndoor is a professional guarantor service, not insurance, and is not a party to your tenancy agreement. If anything changes, speak to your letting agent first.' },
    ],
  } },
  { id: 'payment-reminder', note: 'Chaser for an unpaid referral.', m: {
    subject: 'A reminder about your opndoor guarantee',
    heading: 'Your guarantee is still waiting',
    blocks: [
      { p: 'Your guarantee for the property below is approved and waiting on the fee. It stays open for fifteen days from approval.' },
      { rows: [['Reference', 'GR-1042'], ['Guarantee fee', '£1,450'], ['Open until', '5 September 2026']] },
    ],
    action: { label: 'Pay the guarantee fee', href: `${APP}/pay?token=abc123` },
  } },
  { id: 'expiry-reminder', note: 'Guarantee approaching expiry.', m: {
    subject: 'Your opndoor guarantee expires soon',
    heading: 'A guarantee is coming to an end',
    blocks: [
      { p: 'The Deed of Guarantee below expires shortly. If the tenancy is continuing, a new guarantee will be needed.' },
      { rows: [['Reference', 'GR-1042'], ['Property', '12 Bramble Court, Sheffield'], ['Expires', '31 August 2027']] },
    ],
  } },
  { id: 'staff-invite', note: 'New portal user.', m: {
    subject: 'You have been invited to the opndoor portal',
    heading: 'Set up your portal account',
    blocks: [
      { p: 'Northgate Lettings has invited you to the opndoor Guarantee Referral Portal. Choose a password and set up two-factor authentication to get started.' },
      { small: 'Two-factor authentication is required on every sign in. You will need an authenticator app.' },
    ],
    action: { label: 'Set up your account', href: `${APP}/accept-invite#token_hash=abc123` },
  } },
  { id: 'weekly-digest', note: 'Partner weekly summary.', m: {
    subject: 'Your opndoor week: 8 referrals, £11,600 in fees',
    heading: 'Your week at a glance',
    blocks: [
      { rows: [['Referrals sent', '8'], ['Paid', '5'], ['Deeds issued', '4'], ['Fees collected', '£11,600'], ['Commission earned', '£2,900']] },
      { h: 'Climber of the week' },
      { p: 'Northgate Central, up four places on last week.' },
    ],
    action: { label: 'Open the portal', href: `${APP}/dashboard` },
  } },
  { id: 'ops-alert', note: 'Internal. Ops failure alert.', m: {
    subject: '[opndoor] Deed generation failed for GR-1042',
    heading: 'Something needs a look',
    blocks: [
      { p: 'A deed could not be generated and the application is waiting.' },
      { rows: [['Alert', 'deed_generation_failed'], ['Reference', 'GR-1042'], ['When', '21 August 2026, 10:42']] },
      { small: 'PandaDoc responded 502. The application remains paid and undeeded. It will not retry on its own.' },
    ],
    action: { label: 'Open the application', href: `${APP}/applications/abc123` },
  } },
];

const cards = MESSAGES.map(({ id, note, m, redirected }) => {
  const r = redirected ? REDIRECTED : undefined;
  const html = renderHtml(m, r as never);
  const text = renderText(m, r as never);
  return `
  <section class="card" id="${id}">
    <header>
      <h2>${id}</h2>
      <p class="note">${note}</p>
      <p class="subj"><strong>Subject:</strong> ${m.subject}</p>
    </header>
    <div class="panes">
      <div class="pane">
        <div class="pane-label">HTML</div>
        <iframe srcdoc="${html.replace(/"/g, '&quot;')}" title="${id}"></iframe>
      </div>
      <div class="pane">
        <div class="pane-label">Plain text fallback</div>
        <pre>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>
      </div>
    </div>
  </section>`;
}).join('\n');

writeFileSync('public/email-preview.html', `<!doctype html>
<html><head><meta charset="utf-8"><title>opndoor email templates</title>
<style>
  :root { --ink:#271d5f; --soft:#5b4d86; --mute:#8676ab; --line:#e7e0ef; --canvas:#f6f3fa; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--canvas); font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:var(--ink); }
  .top { background:#fff; border-bottom:1px solid var(--line); padding:20px 28px; position:sticky; top:0; z-index:5; }
  .top h1 { margin:0 0 4px; font-size:20px; letter-spacing:-.02em; }
  .top p { margin:0; color:var(--soft); font-size:13px; }
  .top nav { margin-top:10px; display:flex; flex-wrap:wrap; gap:6px; }
  .top nav a { font-size:12px; text-decoration:none; color:#b54de0; border:1px solid var(--line); border-radius:999px; padding:3px 10px; }
  main { padding:24px 28px 60px; display:grid; gap:24px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:14px; overflow:hidden; }
  .card header { padding:16px 20px; border-bottom:1px solid var(--line); }
  .card h2 { margin:0; font-size:15px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; color:#b54de0; }
  .note { margin:4px 0 0; color:var(--soft); font-size:13px; }
  .subj { margin:8px 0 0; font-size:13px; color:var(--ink); }
  .panes { display:grid; grid-template-columns:1fr 380px; }
  @media (max-width:1100px) { .panes { grid-template-columns:1fr; } }
  .pane { border-left:1px solid var(--line); }
  .pane:first-child { border-left:0; }
  .pane-label { font-size:11px; letter-spacing:.06em; color:var(--mute); padding:8px 14px; border-bottom:1px solid var(--line); background:#fcfaff; }
  iframe { width:100%; height:640px; border:0; display:block; }
  pre { margin:0; padding:14px; font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--soft); white-space:pre-wrap; height:640px; overflow:auto; }
</style></head>
<body>
  <div class="top">
    <h1>opndoor email templates</h1>
    <p>Every one rendered from the shared layout. Change the layout and all of these change together.</p>
    <nav>${MESSAGES.map((x) => `<a href="#${x.id}">${x.id}</a>`).join('')}</nav>
  </div>
  <main>${cards}</main>
</body></html>`);

console.log(`rendered ${MESSAGES.length} templates -> public/email-preview.html`);
