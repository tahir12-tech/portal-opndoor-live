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
    /* (dr4) THE DESCRIPTION CLAIMED SOMETHING ONLY A SUPPLIER CAN DO.
       Matt: "Only suppliers can add agencies and offices while
       referring. Remove that claim from what agency staff see
       (Referrer guide description and FAQs)."

       THE GUIDE ITSELF WAS ALREADY RIGHT -- referrer-guide.html opens
       that paragraph "If you work at a supplier, you can..." -- and
       the three FAQs that describe it are already rail-gated. Only
       this one-line description said it to everybody, which is the
       line an agency reader sees on the shelf before they open
       anything. The capability is kept for the readers who have it,
       conditioned the same way the guide conditions it. */
    { id: 'gs0', icon: 'doc', type: 'Guide', title: 'Referrer guide', desc: 'How to sign in, send a referral, track your applications, and read your League ranking. For everyone who refers. If you work at a supplier, it also covers adding an agency or office while you refer.', meta: 'For all roles', href: '/help-docs/referrer-guide.html' },
    { id: 'gsmg', icon: 'users', type: 'Guide', title: 'Management guide', desc: 'Estate analytics, the fee and commission, settlements, exports, managing agencies, branches and users, the full League, and the Referrer & Period filters.', meta: 'Management & opndoor admin', href: '/help-docs/management-guide.html', minRole: 'management', needsCommission: true },
    { id: 'gsag', icon: 'users', type: 'Guide', title: 'opndoor admin guide', desc: 'Reconciliation, partners and rate management (the rate-snapshot law), the premium bordereau, Health, the opndoor team, and the CRM sync.', meta: 'opndoor admin only', href: '/help-docs/opndoor-admin-guide.html', minRole: 'superadmin' },
    /* (ds) REBUILT AS HTML, read from the ten rendered pages. Every
       figure cross-checked against the render and the landlord guide:
       12 months, GBP 120,000, GBP 10,000, notify within 2 weeks of the
       second month of arrears, payments one month after eviction
       proceedings start. All agree.

       COMMISSION RATE AND FEE BASIS BOTH GONE, per (dr2): the original
       said "10%" in four places and "a fee of one month's rent"
       throughout, and both are per agreement. The scripts keep the
       commission as a FACT ("there's commission in it for you") and
       lose the number. */
    { id: 'gs0b', icon: 'doc', type: 'Guide', title: 'Sales and conversation guide', desc: 'How to talk to the agent and the tenant, who qualifies, how claims work, and where the line is between a guarantor service and insurance.', meta: 'Page · all roles', href: '/help-docs/opndoor-sales-and-conversation-guide.html', rail: 'supplier' },
    { id: 'gs1', icon: 'video', type: 'Video', title: 'Welcome to the portal', desc: 'A short tour of the dashboard, applications and how a referral moves from Sent to Deed Issued.', meta: '' },
  ],
  templates: [
    /* (ds) REBUILT AS HTML so it opens in the modal with Save as PDF,
       like every other item, instead of in the browser's PDF viewer.

       READ FROM RENDERED PAGES, NOT FROM EXTRACTED TEXT. Three
       extraction attempts corrupted the digits -- the cap came out as
       "GBP 12f,fff" -- because the PDF uses subset fonts. Rendering
       each page to an image and reading it sidesteps the encoding
       entirely, and every figure was then cross-checked against the
       landlord guide: 12 months, GBP 120,000, GBP 10,000 all match.

       THE COMMISSION IS GONE, per (dr2). The original led on "10%
       commission to your agency", carried a 10% stat tile and said
       "your agency earns 10% of that tenant fee" in the plain-English
       box. A rate that is per agreement, stated as a fixed number, in
       a flyer handed to an agency that may be on a different one. */
    { id: 'tp0', icon: 'doc', type: 'Flyer', title: 'Agent one-pager (opndoor for letting agents)', desc: 'A branded one-page flyer to share with letting agents: turn failed references into completed lets, with the benefits and how it works.', meta: 'Page', href: '/help-docs/opndoor-for-letting-agents.html', rail: 'supplier' },
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
    /* (dk) THE LEAFLET LEAVES THE BUILDING, which makes it the
       sharpest case on this list: an agent hands it to a tenant. It
       describes the fee and the journey as they are where opndoor
       accepts tenants as sent. Handed to the tenant of an agency
       opndoor checks, it omits a GBP 20 fee they are about to be
       charged -- a false statement about money, given to a consumer.
       So it is tagged to the journey it actually describes and the
       other two show as missing. */
    /* (dt) THE SECOND LEAFLET, for the journey where opndoor checks the
       tenant. The original says "there's nothing more to pay after
       that", which is false for a tenant who also pays GBP 20 -- a
       false statement about money in a document an agent hands to a
       consumer. Two files rather than one conditioned file, because a
       leaflet is printed and handed over: it has to be right on
       paper, with nothing to toggle. */
    { id: 'tp2b', icon: 'doc', type: 'Leaflet', modes: ['opndoor_referenced'], title: 'Tenant explainer leaflet',
      desc: 'A one-page explainer to share with tenants whose application opndoor checks: the £20 eligibility check, the guarantee fee, and how it works.',
      meta: 'Page', href: '/help-docs/opndoor-for-tenants-eligibility.html' },
    /* (dk) THE THIRD LEAFLET, for the journey where opndoor applies
       its own criteria. There is no GBP 20 on this route, so the fee
       story is the plain one -- but there IS a decision before
       payment, and the plain leaflet says "You'll get a secure link,
       and the guarantee can be issued quickly", which tells a tenant
       their only step is paying. Being asked for money you did not
       expect is the worst version of that error, and being told you
       were accepted when you have not been decided on is the second
       worst. Three leaflets now, one per journey, each right on paper
       with nothing to toggle. */
    { id: 'tp2c', icon: 'doc', type: 'Leaflet', modes: ['pre_referenced_screened'], title: 'Tenant explainer leaflet',
      desc: 'A one-page explainer to share with tenants whose referral opndoor decides on: the decision step, the fee, and how it works.',
      meta: 'Page', href: '/help-docs/opndoor-for-tenants-decision.html' },
    { id: 'tp2', icon: 'doc', type: 'Leaflet', modes: ['pre_referenced_open'], title: 'Tenant explainer leaflet', desc: 'A one-page explainer to share with tenants: what the opndoor guarantee service is, the fee, and how it works.', meta: 'Page', href: '/help-docs/opndoor-for-tenants.html' },
    { id: 'tplg', icon: 'doc', type: 'Guide', title: 'Landlord guide', desc: 'A one-page guide to share with landlords: what the Deed of Guarantee means for their property, that it is not insurance, and that either the landlord or the agent can make a claim.', meta: 'Page', href: '/help-docs/opndoor-for-landlords.html' },
    /* (dr5) AN ACTUAL CHECKLIST. Matt: "'Referral information
       checklist' shows the whole Referrer guide. Make it an actual
       checklist of what to gather before referring, taken from the
       form's fields."

       IT WAS AN ANCHOR INTO ANOTHER DOCUMENT -- referrer-guide.html#send
       -- so clicking a thing called a checklist opened a guide, at a
       heading. Its own meta said "In the referrer guide", which is the
       shelf admitting it is not a checklist.

       TAKEN FROM THE FORM, field by field, with required and optional
       marked as the form marks them, so it cannot drift into
       describing a form that does not exist. */
    { id: 'tp1', icon: 'doc', type: 'Checklist', title: 'Referral information checklist', desc: 'The tenant, property and tenancy details to gather before you start an application, field by field.', meta: 'Page', href: '/help-docs/referral-checklist.html' },
    { id: 'tp3', icon: 'image', type: 'Assets', title: 'Co-branding assets', desc: 'Logos and brand guidance for white-labelling the portal with your own branding.', meta: '', rail: 'supplier' },
  ],
  faqs: [
    { id: 'f1', q: 'What is the Guarantee Referral Portal for?', a: 'It lets partner staff refer tenants who cannot pass referencing to opndoor’s professional guarantor service, and track each referral from <b>Sent</b> to <b>Paid</b> to <b>Deed Issued</b>, with live analytics on volume, conversion and fees.', rail: 'supplier' },
    { id: 'f2', q: 'What does opndoor do as guarantor?', a: 'opndoor provides a <b>Deed of Guarantee</b> in favour of the property, for tenants who cannot provide their own guarantor. opndoor is not a party to, or named on, the tenancy agreement. It is a professional guarantor service, not insurance. Either the landlord or the agent can make a claim under the deed.', rail: 'supplier' },
    { id: 'f3', modes: ['pre_referenced_open'], q: 'What do Sent, Paid and Deed Issued mean?', a: '<b>Sent</b> means the referral has been sent to the tenant. <b>Paid</b> means the guarantee fee has been paid. <b>Deed Issued</b> means the Deed of Guarantee has been issued and stored against the record.', rail: 'supplier' },
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
    /* THE RULE MATT DECIDED, after asking what it was. 2026-10-04: "agency and
       supplier users can change a start date only before the tenancy starts
       (signed or not); after the start date, only Opndoor staff can. Show the
       reason in the dialog for everyone else ... Update FAQ 9 to match."

       HELD BACK UNTIL HE RULED, which is why this answer was the one FAQ left
       alone in the rewrite: "Leave FAQ 9 (changing the start date) as it is
       until I confirm the rule."

       WHAT THE PREVIOUS VERSION FIXED AND THIS ONE KEEPS. Both answers used to
       say "within 7 days of the payment date", and no such rule existed:
       `amend_tenancy_start` never mentions `paid_at`. They also left out the
       referrer, who may amend their own. Those corrections stand. What changes
       is the boundary, which is now the start date rather than the signature.

       IT SAYS WHY, NOT JUST NO. The reason an agency cannot move a date after
       the tenancy begins is that the 12 months of cover run from it, and the
       underwriter is already holding that period. An answer that says "only
       opndoor can" without that reads as a permissions quirk; with it, the
       email to the account manager is an obvious next step rather than a
       complaint. The dialog on the application says the same thing. */
    { id: 'f9', q: 'Can a tenancy start date be changed after a referral?', a: 'Yes, up to the day the tenancy starts. Until then there is no deadline and no limit on how far the date can move, and it makes no difference whether the tenant has paid or whether the deed has been signed. Use <b>Amend start date</b> on the application: the person who sent the referral can change their own, and your management can change any of them. <b>From the start date onwards, only opndoor can change it.</b> The guarantee runs for 12 months from the start date, so moving it once the tenancy is under way changes the cover your landlord is relying on, and that is a conversation rather than a form. Email your account manager at partners@opndoor.co with the guarantee reference and the right date. Changing the date reissues the deed: an unsigned one is replaced, and a signed one is kept on the record and replaced with a corrected deed, so the deed and the tenancy never disagree. On a joint tenancy every tenant moves together. A withdrawn or expired referral cannot be changed.', rail: 'supplier' },
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
    /* (dk) STRAIGHT TO PAYMENT ONLY. This answer walks Sent -> Paid ->
       Deed Issued with nothing between the referral and the payment,
       which is true where opndoor accepts tenants as sent and false
       on the other two: there a referral waits for a decision, and on
       "opndoor checks" the tenant pays a GBP 20 application fee for
       an eligibility check first. Tagged rather than reworded, so the
       other two journeys show as a GAP in the matrix instead of
       being told something untrue. */
    { id: 'af3', rail: 'agency', modes: ['pre_referenced_open'], q: 'What do Sent, Paid and Deed Issued mean?',
      a: '<b>Sent</b> means the referral has gone to the tenant and they have been asked to pay. <b>Paid</b> means they have paid the guarantee fee. <b>Deed Issued</b> means they have signed the Deed of Guarantee and it is stored against the record. A joint tenancy reaches Deed Issued one tenant at a time, because each tenant signs their own deed covering their own share.' },
    /* (dr1) THE SAME QUESTION FOR THE OTHER TWO JOURNEYS. Matt: "don't
       just hide things ... the status FAQs must describe that route's
       actual journey (decision or eligibility step before payment),
       not drop the material."

       WRITTEN FROM THE RECORDED STATUS LABELS and nothing else:
       `referencing` is "Awaiting decision" (applicationsService:196),
       which is the step the straight-to-payment answer has no room
       for. The GBP 20 facts are Matt's own, settled in (dt). */
    { id: 'af3b', rail: 'agency', modes: ['pre_referenced_screened'], q: 'What do Sent, Paid and Deed Issued mean?',
      a: '<b>Sent</b> means the referral has been sent to the tenant. <b>Awaiting decision</b> means opndoor is applying its own criteria to it: your agency references the tenant first, and opndoor then decides whether to stand as guarantor, so a referral is not automatically accepted. <b>Paid</b> means the guarantee fee has been paid, which happens only once the referral has been accepted. <b>Deed Issued</b> means the Deed of Guarantee has been issued and stored against the record.' },
    { id: 'af3c', rail: 'agency', modes: ['opndoor_referenced'], q: 'What do Sent, Paid and Deed Issued mean?',
      a: '<b>Sent</b> means the referral has been sent to the tenant. The tenant then completes their application and pays <b>£20 per tenant</b> for the eligibility check, which is not the guarantee fee and does not come off it. <b>Awaiting decision</b> means opndoor is checking them: the application is not sent for referencing until the £20 has been paid, and opndoor then decides whether to stand as guarantor. <b>Paid</b> means the guarantee fee has been paid, which happens only once the referral has been accepted. <b>Deed Issued</b> means the Deed of Guarantee has been issued and stored against the record.' },
    { id: 'af4', rail: 'agency', q: 'How do I refer a tenant?',
      a: 'Open <b>New application</b> and work down the form: the tenant, the property, the tenancy, and the office if your agency has more than one. For a joint tenancy use <b>Add another tenant</b> and set each one\u2019s share of the rent. Send it, and the tenant is emailed a link to pay.' },
    /* (dk) THE GUARANTEE FEE AND NOTHING ELSE, which is the whole
       answer where opndoor accepts tenants as sent or applies its own
       criteria. Where OPNDOOR CHECKS, the tenant also pays a GBP 20
       application fee for the eligibility check, and that sentence
       exists nowhere in this catalogue -- so that journey has no
       answer to this question and the matrix says so. */
    { id: 'af5', rail: 'agency', modes: ['pre_referenced_open', 'pre_referenced_screened'], q: 'What does the tenant pay?',
      a: 'The guarantee fee, calculated from the fee basis your agency has agreed with opndoor. The exact amount appears on the referral form before you send it, and on the application afterwards, so you can tell the tenant what to expect before they open the email. On a joint tenancy the fee is divided between the tenants in the same shares as the rent.' },
    /* (dt) THE "opndoor checks" ANSWER TO THE SAME QUESTION af5 answers
       for the other two journeys. Written only from rules Matt has
       recorded: the three facts he settled, plus the existing fee
       wording. Nothing here is inferred.

       af5 COVERS THE OTHER TWO and is tagged to them, so exactly one
       of the pair reaches any reader. */
    { id: 'af5b', rail: 'agency', modes: ['opndoor_referenced'], q: 'What does the tenant pay?',
      a: 'Two things, and they are separate.<br><br><b>£20 per tenant, once</b>, for the eligibility check on their application. It is not the guarantee fee and does not come off it: it is on top. They pay it near the start, after the property details and their own, and the application is not sent for referencing until it has been paid. It is not refunded in any case: not if the reference comes back declined, not if the tenant stops after paying, and not if opndoor cannot complete the check.<br><br>Then, if they are approved, <b>the guarantee fee</b>, calculated from the fee basis your agency has agreed with opndoor. The exact amount appears on the referral form before you send it, and on the application afterwards, so you can tell the tenant what to expect before they open the email. On a joint tenancy the fee is divided between the tenants in the same shares as the rent, and each tenant pays their own £20.' },
    { id: 'af6', rail: 'agency', q: 'Who sees what, across Director, Manager and Negotiator?',
      a: 'Everyone uses the same portal. A <b>Negotiator</b> sees the referrals they sent. A <b>Manager</b> sees every referral across the agency, every office and the whole team, and can invite people and manage their access. A <b>Director</b> sees everything a Manager sees, and also what the agency has earned. Figures about earnings are shown to Directors only.' },
    /* THE SAME CORRECTION ON THIS RAIL, and the same measurement behind it:
       see the note on f9. The two sets had copied one another's invented
       seven-day deadline. */
    { id: 'af7', rail: 'agency', q: 'Can a tenancy start date be changed after a referral?',
      a: 'Yes, up to the day the tenancy starts. Until then there is no deadline and no limit on how far the date can move, and it makes no difference whether the tenant has paid or whether the deed has been signed. Use <b>Amend start date</b> on the application: the person who sent the referral can change their own, and your management can change any of them. <b>From the start date onwards, only opndoor can change it.</b> The guarantee runs for 12 months from the start date, so moving it once the tenancy is under way changes the cover your landlord is relying on, and that is a conversation rather than a form. Email your account manager at partners@opndoor.co with the guarantee reference and the right date. Changing the date reissues the deed: an unsigned one is replaced, and a signed one is kept on the record and replaced with a corrected deed, so the deed and the tenancy never disagree. On a joint tenancy every tenant moves together. A withdrawn or expired referral cannot be changed.' },
    { id: 'af8', rail: 'agency', q: 'How do I find an application?',
      a: 'Search by the tenant\u2019s name or the guarantee reference on <b>Applications</b>, or filter by status to see everything still waiting on a tenant. Every figure on Reporting and on the League tables clicks through to the applications behind it.' },
  ],
  managers: [
    { id: 'm1', name: 'opndoor partnerships team', role: 'opndoor Partnerships', email: 'partners@opndoor.co', phone: '' },
  ],
};
