/* =====================================================================
   Seed Help & resources content (ported from portal-help.js).
   opndoor admins add / edit / delete resources, FAQs and account managers;
   changes persist so every portal user sees the same content.
   ===================================================================== */
import type { HelpContent } from '../types';

export const HELP_SEED: HelpContent = {
  gettingStarted: [
    // #110 Three role-specific portal guides (authored HTML, print-to-PDF) + the
    // shipped Sales & Conversation Guide PDF. Referrer guide = all roles; Management
    // guide = management + opndoor admin; opndoor admin guide = opndoor admin only.
    { id: 'gs0', icon: 'doc', type: 'Guide', title: 'Referrer guide', desc: 'How to sign in, send a referral, add agencies and branches on the fly, track your applications, and read your League ranking. For everyone who refers.', meta: 'For all roles', href: '/help-docs/referrer-guide.html' },
    { id: 'gsmg', icon: 'users', type: 'Guide', title: 'Management guide', desc: 'Estate analytics, the fee and commission, settlements, exports, managing agencies, branches and users, the full League, and the Referrer & Period filters.', meta: 'Management & opndoor admin', href: '/help-docs/management-guide.html', minRole: 'management', needsCommission: true },
    { id: 'gsag', icon: 'users', type: 'Guide', title: 'opndoor admin guide', desc: 'Reconciliation, partners and rate management (the rate-snapshot law), the premium bordereau, Health, the opndoor team, and the CRM sync.', meta: 'opndoor admin only', href: '/help-docs/opndoor-admin-guide.html', minRole: 'superadmin' },
    { id: 'gs0b', icon: 'doc', type: 'Guide', title: 'Sales and conversation guide', desc: 'How to talk to the agent and the tenant, who qualifies, how claims work, and where the line is between a guarantor service and insurance.', meta: 'PDF · all roles', href: '/help-docs/opndoor-sales-and-conversation-guide.pdf', rail: 'supplier' },
    { id: 'gs1', icon: 'video', type: 'Video', title: 'Welcome to the portal', desc: 'A short tour of the dashboard, applications and how a referral moves from Sent to Deed Issued.', meta: '' },
  ],
  templates: [
    { id: 'tp0', icon: 'doc', type: 'Flyer', title: 'Agent one-pager (opndoor for letting agents)', desc: 'A branded one-page flyer to share with letting agents: turn failed references into completed lets, with the benefits and how it works.', meta: 'PDF', href: '/help-docs/opndoor-for-letting-agents.pdf', rail: 'supplier' },
    /* =====================================================================
       THE LEAFLETS OPEN AS PAGES NOW, NOT IN A PDF VIEWER.

       Matt, 2026-10-03: "Open the tenant and landlord leaflets the same way
       as the referrer guide (as a page with 'Save as PDF'), not in a PDF
       viewer."

       THE .html FILES ARE AUTHORED FROM THE PDFs, which is transcription
       rather than a rewrite: the cover amounts, the claim steps and the
       refund wording are being checked against the DEED and Matt has held
       them, so every one of those sentences is carried across word for word.
       What changed is only the four things he asked for, which are listed on
       each file.

       `meta` SAYS "Page" NOW, because it is what the reader is about to get
       and the old value said PDF. The Save as PDF button is still there, as
       it is on the guides, so nobody loses the printable copy.

       THE .pdf FILES ARE LEFT IN PLACE rather than deleted: links to them
       exist outside this portal, in emails and on agents' intranets, and a
       deleted file is a broken link for somebody we cannot tell. ===== */
    { id: 'tp2', icon: 'doc', type: 'Leaflet', title: 'Tenant explainer leaflet', desc: 'A one-page explainer to share with tenants: what the opndoor guarantee service is, the fee, and how it works.', meta: 'Page', href: '/help-docs/opndoor-for-tenants.html' },
    { id: 'tplg', icon: 'doc', type: 'Guide', title: 'Landlord guide', desc: 'A one-page guide to share with landlords: what the Deed of Guarantee means for their property, that it is not insurance, and that either the landlord or the agent can make a claim.', meta: 'Page', href: '/help-docs/opndoor-for-landlords.html' },
    { id: 'tp1', icon: 'doc', type: 'Checklist', title: 'Referral information checklist', desc: 'The tenant, property and tenancy details to gather before you start an application.', meta: 'In the referrer guide', href: '/help-docs/referrer-guide.html#send' },
    { id: 'tp3', icon: 'image', type: 'Assets', title: 'Co-branding assets', desc: 'Logos and brand guidance for white-labelling the portal with your own branding.', meta: '', rail: 'supplier' },
  ],
  faqs: [
    { id: 'f1', q: 'What is the Guarantee Referral Portal for?', a: 'It lets partner staff refer tenants who cannot pass referencing to opndoor’s professional guarantor service, and track each referral from <b>Sent</b> to <b>Paid</b> to <b>Deed Issued</b>, with live analytics on volume, conversion and fees.', rail: 'supplier' },
    { id: 'f2', q: 'What does opndoor do as guarantor?', a: 'opndoor provides a <b>Deed of Guarantee</b> in favour of the property, for tenants who cannot provide their own guarantor. opndoor is not a party to, or named on, the tenancy agreement. It is a professional guarantor service, not insurance. Either the landlord or the agent can make a claim under the deed.', rail: 'supplier' },
    { id: 'f3', q: 'What do Sent, Paid and Deed Issued mean?', a: '<b>Sent</b> means the referral has been sent to the tenant. <b>Paid</b> means the guarantee fee has been paid. <b>Deed Issued</b> means the Deed of Guarantee has been issued and stored against the record.', rail: 'supplier' },
    { id: 'f4', q: 'How do I refer a tenant?', a: 'Open <b>New application</b> and complete the sections in order: Tenant, Property, Tenancy, then Agent and branch. You can search for an existing agent and branch or add a new one on the fly. Submit to send the referral.', rail: 'supplier' },
    { id: 'f5', q: 'Are the guarantee reference, issue date and expiry entered by hand?', a: 'No. The guarantee reference, issue date and expiry are <b>assigned automatically</b> once the guarantee is issued. They are not entered on the form; they appear on the application detail view.', rail: 'supplier' },
    { id: 'f6', q: 'Who can use the portal and what can each role see?', a: '<b>opndoor admins</b> are opndoor’s internal team and manage everything, including reconciliation and record mapping. <b>Management</b> sees all tracking and analytics across the whole estate and can add their own users, but cannot edit canonical records or portal settings. <b>Referrers</b> see and track only their own referrals and can add agencies and branches on the fly.', rail: 'supplier' },
    { id: 'f7', q: 'Can I add an agency or branch that is not listed?', a: 'Yes. On the new application form, the agent and branch fields let you search existing records or create a new one on the fly. New records appear on the Agencies and branches screen and are reviewed by opndoor for duplicates.', rail: 'supplier' },
    // STATES THE RATES, so it is gated on the commission bit rather than on the
    // role: a Manager is 'management' and must not be shown what the agency
    // earns, which is the whole point of the level. Also no longer asserts one
    // month's rent as the fee: the basis is per agreement (Regent is 3 weeks for
    // a single tenant and 5 shared between joint ones), and stating one figure
    // for everybody was wrong for every agency that negotiated.
    { id: 'f8', q: 'How are the guarantee fee and commission calculated?', a: 'The guarantee fee is set by the fee basis agreed with each agency, shown on every application and on the referral form before you send it. Commission is a percentage of that fee, and the percentages are in your agreement. Commission figures are visible to Directors and opndoor only.', needsCommission: true, rail: 'supplier' },
    /* WHAT THE PORTAL ACTUALLY ENFORCES. Matt, 2026-10-03: "FAQ 7 (changing the
       start date): tell me exactly what the portal enforces today (how long after
       payment, and any limit on how far the date can move), then make the FAQ say
       exactly that in plain English."

       BOTH ANSWERS SAID "within 7 days of the payment date" AND NO SUCH RULE
       EXISTS. Read off dev before writing this: `amend_tenancy_start` never
       mentions `paid_at` at all, and `can_amend_tenancy_start` is about the ROLE
       and the DEED STATE. The only limit on the date is a sanity range, not
       before 2000 and not more than five years ahead. So the FAQ invented a
       deadline, and an agency reading it would have rung us rather than
       correcting a date they were entitled to correct.

       AND IT UNDERSTATED WHO. "opndoor admins and management" left out the
       referrer, who may amend their OWN referral while the deed is unsigned,
       which is the commonest case of all: the person who typed the date wrong
       fixing it ten minutes later. */
    { id: 'f9', q: 'Can a tenancy start date be changed after a referral?', a: 'Yes. There is <b>no deadline</b>: a start date can be corrected at any time, before or after the tenant has paid, and before or after the deed is signed. There is no limit on how far it can move either, beyond having to be a real date within the next five years. Use <b>Amend start date</b> on the application. Who can do it depends on where the referral has got to: while the deed is still unsigned, the person who sent the referral can change it, and so can your management and opndoor. Once the deed is signed, <b>management and opndoor</b> can change it and the referrer cannot. Changing it reissues the deed: an unsigned one is replaced, and a signed one is kept on the record and replaced with a corrected deed, so the deed and the tenancy never disagree. On a joint tenancy every tenant moves together. A withdrawn or expired referral cannot be changed.', rail: 'supplier' },
    { id: 'f10', q: 'How do I find a specific application?', a: 'Use the search and status filters on the <b>Applications</b> screen, or click any figure on the Agencies and branches screen to drill through to the applications behind it.', rail: 'supplier' },
    { id: 'f11', q: 'What time period does the dashboard cover?', a: 'Use the period selector at the top of the dashboard, from the last 7 days through to all time. Every figure and chart updates to match, and the <b>Export CSV</b> button downloads the analytics for the selected period.', rail: 'supplier' },
    { id: 'f12', q: 'I have a question that is not answered here.', a: 'Contact your opndoor account manager using the details in the panel on this page, and the partnerships team will help.', rail: 'supplier' },

    /* ===================================================================
       THE AGENCY SET. Eight answers, shown to an agency on our own estate in
       place of the twelve above.

       ONE SET FOR ALL THREE LEVELS, ruled 27 September. Not three near-identical
       copies differing by a paragraph: three documents are three things to keep
       in step, and a reader at any level should be able to send a colleague the
       same link. The only level-specific content is INSIDE the "who sees what"
       answer, which describes all three in one place.

       NO COMMISSION FIGURE IN ANY OF THEM, for any level, Director included.
       What an agency earns is in their agreement, not in a help article, and a
       figure in prose is a figure that goes stale without anybody noticing.

       AND NOTHING FROM THE OTHER RAIL. No partners, no adding agencies on the
       fly, no white-labelling: an agency of ours does none of those, and the
       twelve above describe all three. The fee is never stated as a figure or as
       a number of weeks either, because the basis is per agreement and Regent's
       is not the next agency's.
       =================================================================== */
    { id: 'af1', rail: 'agency', q: 'What is this portal for?',
      a: 'It is where you refer a tenant who cannot pass referencing to opndoor for a guarantee, and follow what happens next. Every referral you send is tracked from <b>Sent</b> to <b>Paid</b> to <b>Deed Issued</b>, so you can see which tenancies are covered and which are still waiting on the tenant.' },
    { id: 'af2', rail: 'agency', q: 'What does opndoor do as guarantor?',
      a: 'opndoor provides a <b>Deed of Guarantee</b> in favour of the property, for a tenant who cannot provide a guarantor of their own. opndoor is not named on the tenancy agreement and is not a party to it. It is a professional guarantor service and it is not insurance. Either the landlord or the agent can make a claim under the deed.' },
    { id: 'af3', rail: 'agency', q: 'What do Sent, Paid and Deed Issued mean?',
      a: '<b>Sent</b> means the referral has gone to the tenant and they have been asked to pay. <b>Paid</b> means they have paid the guarantee fee. <b>Deed Issued</b> means they have signed the Deed of Guarantee and it is stored against the record. A joint tenancy reaches Deed Issued one tenant at a time, because each tenant signs their own deed covering their own share.' },
    { id: 'af4', rail: 'agency', q: 'How do I refer a tenant?',
      a: 'Open <b>New application</b> and work down the form: the tenant, the property, the tenancy, and the office if your agency has more than one. For a joint tenancy use <b>Add another tenant</b> and set each one\u2019s share of the rent. Send it, and the tenant is emailed a link to pay.' },
    { id: 'af5', rail: 'agency', q: 'What does the tenant pay?',
      a: 'The guarantee fee, calculated from the fee basis your agency has agreed with opndoor. The exact amount appears on the referral form before you send it, and on the application afterwards, so you can tell the tenant what to expect before they open the email. On a joint tenancy the fee is divided between the tenants in the same shares as the rent.' },
    { id: 'af6', rail: 'agency', q: 'Who sees what, across Director, Manager and Negotiator?',
      a: 'Everyone uses the same portal. A <b>Negotiator</b> sees the referrals they sent. A <b>Manager</b> sees every referral across the agency, every office and the whole team, and can invite people and manage their access. A <b>Director</b> sees everything a Manager sees, and also what the agency has earned. Figures about earnings are shown to Directors only.' },
    /* THE SAME CORRECTION ON THIS RAIL, and the same measurement behind it:
       see the note on f9. The two sets had copied one another's invented
       seven-day deadline. */
    { id: 'af7', rail: 'agency', q: 'Can a tenancy start date be changed after a referral?',
      a: 'Yes. There is <b>no deadline</b>: a start date can be corrected at any time, before or after the tenant has paid, and before or after the deed is signed. There is no limit on how far it can move either, beyond having to be a real date within the next five years. Use <b>Amend start date</b> on the application. Who can do it depends on where the referral has got to: while the deed is still unsigned, the person who sent the referral can change it, and so can your management and opndoor. Once the deed is signed, <b>management and opndoor</b> can change it and the referrer cannot. Changing it reissues the deed: an unsigned one is replaced, and a signed one is kept on the record and replaced with a corrected deed, so the deed and the tenancy never disagree. On a joint tenancy every tenant moves together. A withdrawn or expired referral cannot be changed.' },
    { id: 'af8', rail: 'agency', q: 'How do I find an application?',
      a: 'Search by the tenant\u2019s name or the guarantee reference on <b>Applications</b>, or filter by status to see everything still waiting on a tenant. Every figure on Reporting and on the League tables clicks through to the applications behind it.' },
  ],
  managers: [
    { id: 'm1', name: 'opndoor partnerships team', role: 'opndoor Partnerships', email: 'partners@opndoor.co', phone: '' },
  ],
};
