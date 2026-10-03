/* =====================================================================
   Hydrate the service-layer working copies from Supabase.

   Every read screen consumes the four base datasets (partners, org, users,
   applications) through the existing synchronous services. We load those
   datasets once, RLS-scoped to the signed-in user, and replace the mock
   working copies with real data shaped identically. The derived services
   (analytics, league, exports, reconciliation, activity) then reflect real
   data with no screen changes. Runs after AAL2 login; see SessionContext.
   ===================================================================== */
import { sb } from '@/lib/supabase';
import { LEAST_PRIVILEGED_ROLE,
  hydratePartners, hydrateUsers, hydrateOrg, hydrateGroups, hydrateApplications, hydrateUpcoming, hydrateFull, hydrateSettings,
  type Agency, type AgencyGroup, type AgentContact, type ApplicationSummary, type Branch, type CommissionLine, type FullApp, type ManagedUser, type Role,
  type Partner, type Status,
} from '@/data';
import type { AppRecord } from '@/data/mock/applications';
import type { UpcomingGuaranteeSeed } from '@/data/mock/guarantees';
import { isDirectRail, isHousePartner } from '@/data/channel';
import { plural, countOf } from '@/lib/plural';
import { formatDate } from '@/lib/format';

const DAY = 86400000;

/* eslint-disable @typescript-eslint/no-explicit-any */
const emb = (x: any): any => (Array.isArray(x) ? x[0] : x);
const num = (x: any): number => Number(x ?? 0);

function money(n: number): string {
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `£${Math.round(n / 1_000)}k`;
  return `£${Math.round(n)}`;
}

/** Property display string: "addr1, OUTCODE" (upcoming rows already embed the area). */
function propStr(addr1: string, postcode: string | null): string {
  if (!postcode) return addr1;
  return `${addr1}, ${String(postcode).split(' ')[0]}`;
}

function isoDate(ts: string | null): string {
  if (!ts) return '';
  return new Date(ts).toISOString().slice(0, 10);
}

/** The record's anchor date: deed issued, else paid, else sent. */
function eventDate(a: any): string {
  return isoDate(a.deed_issued_at) || isoDate(a.paid_at) || isoDate(a.sent_at);
}

/** The anchor event's epoch ms (same priority as eventDate), for a precise sort. */
function eventTs(a: any): number {
  const ts = a.deed_issued_at || a.paid_at || a.sent_at;
  return ts ? new Date(ts).getTime() : 0;
}

/* "INVITED [DATE]", NOT "PENDING INVITE". Matt, 2026-10-02: the Last
   active column reads "Invited [date]" for a pending invite. A person who
   has never signed in has no last_sign_in_at, so the cell used to print
   the status again -- "Invited" in the pill, "Pending invite" in the date
   column -- and said nothing about how long the invitation had been out,
   which is the one thing a reader looking at a pending row wants.

   PENDING IS CHECKED BEFORE THE TIMESTAMP, because a pending invite may
   have a last_sign_in_at: a person deactivated and re-invited keeps the
   old one, and "3 weeks ago" against an outstanding invitation reads as
   somebody active. `invitedAt` comes from list_managed_users, which
   20261007480000 added it to. */
function relTime(ts: string | null, status: string, invitedAt?: string | null): string {
  if (status === 'pending') {
    const on = formatDate(invitedAt);
    return on ? `Invited ${on}` : 'Pending invite';
  }
  if (!ts) return '-';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} ${plural(mins, 'minute')} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} ${plural(hrs, 'hour')} ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return 'Yesterday';
  // See activityService: guarded above, routed through the helper anyway.
  if (days < 7) return `${countOf(days, 'day')} ago`;
  const wks = Math.round(days / 7);
  return `${wks} ${plural(wks, 'week')} ago`;
}

function toContact(c: any): AgentContact {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone || '',
    role: c.contact_role || '',
    primary: !!c.is_primary,
  };
}

/** Load all RLS-scoped datasets and replace the service working copies. */
/* viewerRole is no longer read here. It used to narrow the partners select,
   which was never enforcement: Postgres now refuses the rate columns to
   everyone whatever they ask. The parameter stays because callers pass it and
   removing it would be an unrelated change to every call site. */
export async function hydrateFromSupabase(userId: string, _viewerRole: Role = LEAST_PRIVILEGED_ROLE): Promise<void> {
  const client = sb();
  const [partnersRes, partnerRatesRes, usersRes, ratesRes, orgRatesRes, agenciesRes, groupsRes, branchesRes, contactsRes, appsRes, linesRes] = await Promise.all([
    // THE RATES ARE NO LONGER SELECTABLE HERE BY ANYONE, exactly as on
    // applications. They came off the table grant for `authenticated`
    // (20260815030000), because this string was never enforcement: it decided
    // what the client ASKED for, and PostgREST answers whatever it is asked. A
    // referrer could request them directly and did, proven live.
    //
    // Same list for every role now. There is nothing left to narrow, which is
    // the point: a select that cannot leak does not need a conditional.
    client.from('partners').select(
      'id, slug, name, status, live_from, is_primary, referrer_leaderboard_mode, referencing_mode, partner_kind, portal_referrals_enabled, api_access_enabled, opndoor_pays_agents',
    ),
    // The partner rates, for the roles entitled to them. Called unconditionally
    // and refused in the function rather than skipped here, because a client
    // that skipped the call would be back to a TypeScript decision.
    client.rpc('my_partner_rates'),
    // Admin user list via RPC: TRUTHFUL last-active (auth.users.last_sign_in_at)
    // and status/role, visibility-scoped like the users_select RLS policy.
    client.rpc('list_managed_users'),
    // The commission snapshot, for the roles entitled to it. Returns nothing for
    // everyone else, enforced in the function rather than by not calling it: a
    // client that skipped the call would be back to a TypeScript decision.
    client.rpc('application_commission_rates', { p_partner: null }),
    /* THE ORG TREE'S RATES, for the roles entitled to them. The three selects
       below used to carry partner_rate/agent_rate on the table grant, which
       meant every signed-in user -- a Negotiator included -- hydrated their
       agency's commission rate, the one number may_see_commission() withholds
       everywhere else. 20261005220000 wrote that down under "STILL OPEN,
       DELIBERATELY" and it stayed open. Same treatment as applications
       (20260811180000) and partners (20260815030000): the columns came off the
       grant in 20261006350000 and this asks for them instead. Unconditional
       and refused in the function, because a client that skipped the call
       would be back to a TypeScript decision. */
    client.rpc('org_rate_tiers'),
    // partner:partners is named to its FK, not left bare. partner_agency_relationships
    // (20260812110000) gave PostgREST a SECOND agencies<->partners relationship, the
    // many-to-many of who-can-reach-whom, on top of the direct owner FK. A bare
    // partners(...) embed is now ambiguous (PGRST201) and threw "Failed to load data"
    // for every role, because this is the global hydrate. agencies_partner_id_fkey is
    // the one meant here: the single owning partner, the same one partner_id resolves
    // to. The many-to-many would return an array and, for a shared agency, the wrong
    // partner.
    client.from('agencies').select('id, name, group_name, group_id, referencing_mode, review_state, is_placeholder, partner_id, partner:partners!agencies_partner_id_fkey(slug)'),
    // Agency groups — the top commission tier and the target of a "whole group"
    // position. RLS scopes them to the caller's partner (or all, for admin/staff).
    client.from('agency_groups').select('id, name, partner_id'),
    client.from('branches').select('id, name, area, review_state, is_placeholder, agency_id, partner_id'),
    // Ordered oldest-first so the on-screen contact order matches the server's
    // promote-oldest primary backstop (org_*_contact RPCs): the "promotes X to
    // primary" consequence text then names the contact the backstop will pick.
    client.from('agent_contacts').select('id, name, email, phone, contact_role, is_primary, agency_id, branch_id').order('created_at', { ascending: true }).order('id', { ascending: true }),
    client.from('applications').select(
      'id, guarantee_ref, tenant_title, tenant_first_name, tenant_last_name, ' +
        'tenant_dob, tenant_email, tenant_phone, ' +
        'prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode, ' +
        // The rates are NO LONGER SELECTABLE HERE BY ANYONE. partner_rate and
        // agent_rate came off the table grant for `authenticated` entirely
        // (20260811180000), because narrowing this string was never enforcement:
        // it decided what the client ASKED for, and PostgREST answers whatever it
        // is asked. Any signed-in user could request them directly. They now
        // arrive through application_commission_rates() below, for the roles
        // entitled to them, and Postgres refuses the columns to everyone else
        // whatever they ask.
        'monthly_rent, fee_amount, fee_basis_weeks, ' +
        // The joint-tenancy shape. Every sibling carries the WHOLE tenancy rent
        // in monthly_rent; share_amount is this applicant's slice and fee_amount
        // is what they are actually charged. tenancy_position is the order the
        // agent entered them, and position 1 leads: it carries the one deed.
        'tenancy_id, tenancy_position, share_percent, share_amount, ' +
        'status, beneficiary, tenancy_start, sent_at, paid_at, deed_issued_at, expiry_date, ' +
        'payment_state, refunded_at, refunded_amount, paid_amount, refund_after_start, ' +
        'withdrawn_at, withdrawn_reason, withdrawn_note, ' +
        'deed_state, deed_sent_at, deed_viewed_at, expiry_reminders_sent, ' +
        // DELIVERY. awaiting_staff_send has existed since 20260925150000 and
        // was granted to authenticated, but was never selected, so the one
        // authoritative flag never reached a screen and the Applications
        // filter guessed from the agent_contacts tree instead.
        'awaiting_staff_send, delivery_failed_at, delivery_attempted_to, delivery_source, delivery_reason, ' +
        // WHICH ARRANGEMENT THIS REFERRAL WAS SOLD UNDER, snapshotted at
        // creation (20261007610000). Not the partner's live flag: that one
        // is mutable and has already moved twice under live referrals, and
        // reading it made a past month's statement change shape.
        'opndoor_pays_agents_at_freeze, ' +
        'referencing_mode, applicant_id, landlord_name, landlord_email, ' +
        'elig:application_eligibility_payments(paid_at), ' +
        'referrer_id, referrer_name, branch_id, agency_id, partner_id, ' +
        'branch:branches(name), agency:agencies(name), referrer:users!referrer_id(full_name, role, sees_commission), partner:partners(slug)',
    ),
    // The frozen commission split, one row per payee. Deliberately OUTSIDE the
    // throw-list below: a row with no lines is a historic row, not a failure, and
    // losing the payee breakdown must never cost anybody their sign-in.
    client.from('application_commission_lines').select('application_id, level, org_id, org_name, rate, source, basis_amount, amount'),
  ]);

  // ratesRes is deliberately absent from this list. It returns nothing for a
  // referrer or a developer by design, and treating that as a hydration failure
  // would break login for two roles to protect a figure they are not shown.
  for (const res of [partnersRes, usersRes, agenciesRes, groupsRes, branchesRes, contactsRes, appsRes]) {
    if (res.error) throw new Error(`Failed to load data: ${res.error.message}`);
  }

  // Merged back onto the partner rows the RPC is entitled to answer for. Empty
  // for a referrer and a developer, so a rate they are not entitled to reads as
  // absent rather than as zero, and nothing downstream has to know the
  // difference between "no commission" and "not your commission".
  const ratesFromRpc = new Map<string, { partner_rate: number | null; agent_rate: number | null }>(
    ((partnerRatesRes.data ?? []) as any[]).map((r) => [r.partner_id, { partner_rate: r.partner_rate, agent_rate: r.agent_rate }]),
  );
  // Merged before anything downstream reads partners, so partnerRateById below
  // keeps working unchanged: it derives from these rows.
  const partners = ((partnersRes.data ?? []) as any[]).map((p) => ({ ...p, ...(ratesFromRpc.get(p.id) ?? {}) }));
  const users = (usersRes.data ?? []) as any[];
  const agencies = (agenciesRes.data ?? []) as any[];
  const groups = (groupsRes.data ?? []) as any[];
  const branches = (branchesRes.data ?? []) as any[];
  const contacts = (contactsRes.data ?? []) as any[];
  const apps = (appsRes.data ?? []) as any[];

  // Keyed by application id. Empty for a referrer or a developer, which is the
  // point: every commission figure computed downstream then comes out zero
  // rather than wrong.
  const rateById = new Map<string, { partner: number; agent: number }>(
    ((ratesRes.data ?? []) as any[]).map((r) => [r.application_id, { partner: num(r.partner_rate), agent: num(r.agent_rate) }]),
  );

  /* One map per tier, so a null stays a null: "inherit from the tier above"
     and "you may not see this" both arrive as absent, and every figure
     downstream is then absent rather than wrong. */
  const orgRate = new Map<string, { partner_rate: number | null; agent_rate: number | null }>(
    ((orgRatesRes.data ?? []) as any[]).map((r) => [`${r.level}:${r.org_id}`, { partner_rate: r.partner_rate, agent_rate: r.agent_rate }]),
  );

  const partnerSlug = new Map<string, string>(partners.map((p) => [p.id, p.slug]));
  // Fallback rates by partner (only used if a row somehow lacks its snapshot;
  // the applications columns are NOT NULL, so this is belt-and-braces).
  const partnerRateById = new Map<string, number>(partners.map((p) => [p.id, num(p.partner_rate)]));
  const agentRateById = new Map<string, number>(partners.map((p) => [p.id, num(p.agent_rate)]));
  const slugOfApp = (a: any): string => emb(a.partner)?.slug ?? partnerSlug.get(a.partner_id) ?? '';
  const fullName = (a: any): string => `${a.tenant_first_name} ${a.tenant_last_name}`;
  const ownerFlag = (a: any): number => (a.referrer_id === userId ? 1 : 0);

  /* ---- users (from list_managed_users: real last-active + email) ---- */
  const usersOut: ManagedUser[] = users.map((u) => ({
    id: u.id,
    name: u.full_name,
    email: u.email,
    role: u.role,
    // Truthful: relative time since the real last sign-in (auth.users), or a
    // "Pending invite" / "Never signed in" placeholder from status.
    lastActive: relTime(u.last_sign_in_at, u.status, u.invited_at),
    status: u.status,
    partner: (u.role === 'superadmin' || u.role === 'opndoor_manager') ? 'opndoor' : (u.partner_slug ?? ''),
    homeBranchId: u.home_branch_id ?? null,
    // Director if true, Manager if false, on a management user. What lets a
    // people list name the level without a query per row.
    seesCommission: u.sees_commission === true,
  }));

  /* ---- partners (with derived weight/users/apps counts) ---- */
  const usersByPartner: Record<string, number> = {};
  users.forEach((u) => {
    const s = u.partner_slug;
    if (s) usersByPartner[s] = (usersByPartner[s] || 0) + 1;
  });
  const appsByPartner: Record<string, number> = {};
  apps.forEach((a) => {
    const s = slugOfApp(a);
    if (s) appsByPartner[s] = (appsByPartner[s] || 0) + 1;
  });
  const maxApps = Math.max(1, ...Object.values(appsByPartner));

  const partnersOut: Partner[] = partners.map((p) => ({
    /* THE CLIENT'S PARTNER ID IS THE SLUG, deliberately: every screen, route
       and scope compares slugs, and `partnerName` resolves a house route by
       it. But the DATABASE keys on the uuid, so anything calling an RPC that
       takes a partner needs the real one -- the notification matrix is the
       first. Carried alongside rather than swapped in, because changing `id`
       would touch every comparison in the product. */
    id: p.slug,
    dbId: p.id,
    name: p.name,
    status: p.status,
    since: p.live_from ? String(p.live_from).slice(0, 7) : '',
    weight: (appsByPartner[p.slug] || 0) / maxApps || 0.05,
    ...(p.is_primary ? { primary: true } : {}),
    // House / plumbing partners stay in the working copy so a row's partner can
    // still be resolved, but this flag hides them from every selector and swaps
    // their name for the route label. See isHousePartner / houseRouteLabel.
    ...(isHousePartner(p.slug) ? { isHouse: true } : {}),
    users: usersByPartner[p.slug] || 0,
    apps: appsByPartner[p.slug] || 0,
    /* NULL SURVIVES THE HYDRATE, 20261007680000. `num()` coalesces to 0,
       which would turn "no deal has been set" into "a deal of nothing" --
       two different facts, and the second one is a real state that Letly
       is in. The columns are nullable now and the screens have to be able
       to tell them apart. */
    partnerRate: p.partner_rate == null ? null : num(p.partner_rate),
    agentRate: p.agent_rate == null ? null : num(p.agent_rate),
    /* NM-C 5. Not a rate, so it is not behind my_partner_rates: it says
       WHO Opndoor pays rather than how much, and the Commission tab
       needs it to render a switch. */
    opndoorPaysAgents: p.opndoor_pays_agents === true,
    referrerLeaderboard: (p.referrer_leaderboard_mode ?? 'full') as Partner['referrerLeaderboard'],
    referencingMode: (p.referencing_mode ?? 'pre_referenced_screened') as Partner['referencingMode'],
    /* WHAT THIS PARTNER IS. No coalesce and no fall back to the mode
       beside it: an unresolved column must read as "unknown", because
       the whole point of the column is that the mode is not the answer.
       A partner row without it is a row the migration did not reach. */
    ...(p.partner_kind ? { kind: p.partner_kind as Partner['kind'] } : {}),
    // === true, not a coalesce to true. A missing column or an unresolved select
    // must not read as "this partner may hold API keys": the whole point of the
    // default being false is that enabling the API is deliberate.
    portalReferralsEnabled: p.portal_referrals_enabled !== false,
    apiAccessEnabled: p.api_access_enabled === true,
  }));

  /* ---- org (agencies -> branches -> contacts + derived metrics) ---- */
  const appsByBranch: Record<string, any[]> = {};
  const appsByAgency: Record<string, any[]> = {};
  apps.forEach((a) => {
    /* ROUND 6, M9. DIRECT-RAIL BUSINESS IS NEVER THE MATCHED AGENCY'S.
       Matt's ruling: "direct-rail applications never count as the matched
       agency's business: exclude them from agency digests, cohort CSVs and
       every other agency-facing surface." The server was swept
       (20261006410000, 20261006580000, 20261006590000); these two indexes
       were not.

       The trap is that a direct row LOOKS like the agency's by every field
       except the one that decides. resolve_agency_match and the email
       matcher rewrite a direct application's agency_id and branch_id to a
       real agency so somebody can service it, while pinning partner_id to
       opndoor-direct. So it lands in appsByAgency[<Regent's id>] and
       inflates four counters off it.

       `referrers` was worse than one too high: a direct row's referrer_id
       is NULL, so null joined the Set and a branch whose only traffic was
       direct reported one referrer who does not exist.

       SLUG-ONLY, and it has to be: hydratePartners() does not run until
       later in this function, so partnersService is empty or stale here
       and anything resolving a partner record would answer wrong.

       NOT appsByPartner above, which is untouched: a direct row genuinely
       DOES belong to opndoor-direct, and that index is what makes the
       direct rail's own figures work. */
    if (isDirectRail(slugOfApp(a))) return;
    (appsByBranch[a.branch_id] ??= []).push(a);
    (appsByAgency[a.agency_id] ??= []).push(a);
  });
  const branchesByAgency: Record<string, any[]> = {};
  branches.forEach((b) => (branchesByAgency[b.agency_id] ??= []).push(b));
  const contactsByAgency: Record<string, any[]> = {};
  const contactsByBranch: Record<string, any[]> = {};
  contacts.forEach((c) => {
    if (c.agency_id) (contactsByAgency[c.agency_id] ??= []).push(c);
    else if (c.branch_id) (contactsByBranch[c.branch_id] ??= []).push(c);
  });
  const sum = (rows: any[], f: (a: any) => number): number => rows.reduce((s, a) => s + f(a), 0);
  // Fees collected net of refunds: paid fees minus refunded amounts. Commission
  // downstream (league, exports) is fees x rate, so refunded fees pay none.
  /* "Fees collected" is the FEE, which since M1 is a stored value rather than the
     rent it happened to equal. Falls back to monthly_rent for any row created
     before the fee existed. */
  const feeOf = (x: any): number => (x.fee_amount == null ? num(x.monthly_rent) : num(x.fee_amount));
  const feesNet = (rows: any[]): number =>
    sum(rows, (x) => (x.status === 'paid' || x.status === 'deed' ? feeOf(x) : 0))
    // R2. Both states take money back out; only a FULL refund may fall back
    // to the whole fee, because a partial refund's amount is the whole point.
    - sum(rows, (x) => (x.payment_state === 'refunded' ? num(x.refunded_amount ?? feeOf(x))
                        : x.payment_state === 'partially_refunded' ? num(x.refunded_amount ?? 0) : 0));

  const agenciesOut: Agency[] = agencies.map((a) => {
    const brs: Branch[] = (branchesByAgency[a.id] ?? []).map((b) => {
      const bApps = appsByBranch[b.id] ?? [];
      const branch: Branch = {
        id: b.id,
        name: b.name,
        agentRate: orgRate.get(`branch:${b.id}`)?.agent_rate == null ? null : Number(orgRate.get(`branch:${b.id}`)!.agent_rate),
        /* AN EMPTY ADDRESS IS EMPTY, not a dash. Matt, 2026-10-02:
           "the '-' after each branch name is an empty address. Show the
           branch address when there is one, and nothing when there
           isn't."

           This mapped null to the literal string "-", so every screen
           that guards on `b.area &&` printed it: the string is truthy.
           The dash belonged to one table cell that needed a filler and
           was applied to the field instead of to that cell. Every
           reader of `.area` already handles an empty string -- they are
           all `b.area ? ... : ''` or `b.area || ''` -- so this is the
           one place the fix belongs. */
        area: b.area || '',
        referrers: new Set(bApps.map((x) => x.referrer_id)).size,
        referrals: bApps.length,
        guaranteed: money(sum(bApps, (x) => num(x.monthly_rent) * 12)),
        fees: feesNet(bApps),
        contacts: (contactsByBranch[b.id] ?? []).map(toContact),
      };
      if (b.review_state === 'pending_review') branch.unreviewed = true;
      if (b.is_placeholder) branch.isPlaceholder = true;
      return branch;
    });
    const aApps = appsByAgency[a.id] ?? [];
    const agency: Agency = {
      id: a.id,
      partner: emb(a.partner)?.slug ?? partnerSlug.get(a.partner_id) ?? '',
      name: a.name,
      referrals: aApps.length,
      guaranteed: money(sum(aApps, (x) => num(x.monthly_rent) * 12)),
      fees: feesNet(aApps),
      contacts: (contactsByAgency[a.id] ?? []).map(toContact),
      branches: brs,
    };
    if (a.group_name) agency.group = a.group_name;
    if (a.group_id) agency.groupId = a.group_id;
    // Preserve null (inherit) rather than coercing to 0 (a real 0% override).
    const aRate = orgRate.get(`agency:${a.id}`);
    agency.partnerRate = aRate?.partner_rate == null ? null : Number(aRate.partner_rate);
    agency.agentRate = aRate?.agent_rate == null ? null : Number(aRate.agent_rate);
    agency.referencingMode = a.referencing_mode ?? null;
    if (a.review_state === 'pending_review') agency.unreviewed = true;
    if (a.is_placeholder) agency.isPlaceholder = true;
    return agency;
  });

  const groupsOut: AgencyGroup[] = groups.map((g) => ({
    id: g.id,
    partner: partnerSlug.get(g.partner_id) ?? '',
    name: g.name,
    partnerRate: orgRate.get(`group:${g.id}`)?.partner_rate == null ? null : Number(orgRate.get(`group:${g.id}`)!.partner_rate),
    agentRate: orgRate.get(`group:${g.id}`)?.agent_rate == null ? null : Number(orgRate.get(`group:${g.id}`)!.agent_rate),
  }));

  /* ---- applications: summaries + detail records ---- */
  /* DECLARED BEFORE THE MAPPINGS THAT USE THEM, which is not a style
     preference. These were below listOut, and listOut's callback runs
     IMMEDIATELY: the moment anything in it called toDate, the const was still
     in its temporal dead zone and the whole post-login hydrate threw "Cannot
     access 'toDate' before initialization", which the user meets as a crash
     straight back to the sign-in screen.

     It compiled, because TypeScript cannot know when a callback passed to .map
     will run, and it passed every test, because hydrateFromSupabase only
     executes in Supabase mode and the suite runs in mock mode. postLoginShell
     .render.test.tsx is the test that now covers it. */
  const toDate = (ts: any): Date | null => (ts ? new Date(ts) : null);
  // Postgres DATE columns (tenancy_start, expiry_date) arrive as bare
  // 'YYYY-MM-DD'. new Date() would parse them as UTC midnight, which then
  // misbuckets/off-by-ones under local-time comparisons and formatting (e.g. the
  // bordereau's monthly window). Parse them at LOCAL midnight instead.
  const toLocalDate = (s: any): Date | null => {
    if (!s) return null;
    const p = String(s).slice(0, 10).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  };

  const listOut: ApplicationSummary[] = apps.map((a) => ({
    ref: a.guarantee_ref,
    tenant: fullName(a),
    prop: propStr(a.prop_addr1, a.prop_postcode),
    branch: emb(a.branch)?.name ?? '',
    agency: emb(a.agency)?.name ?? '',
    ben: a.beneficiary ?? '',
    rent: num(a.monthly_rent),
    status: a.status as Status,
    date: eventDate(a),
    eventTs: eventTs(a),
    owner: ownerFlag(a),
    partner: slugOfApp(a),
    referrerRole: emb(a.referrer)?.role ?? null,
    // The other half of the referrer's LEVEL. Director and Manager are both
    // 'management' and differ only here, so role alone cannot name either.
    referrerSeesCommission: emb(a.referrer)?.sees_commission === true,
    // #owner referrer name + sent-date for the Applications referrer/period filters.
    referrer: a.referrer_name ?? emb(a.referrer)?.full_name ?? null,
    sentAtTs: a.sent_at ? new Date(a.sent_at).getTime() : null,
    refunded: a.payment_state === 'refunded',
    // R2. A partial refund moves money, not the guarantee. See FullApp.
    partiallyRefunded: a.payment_state === 'partially_refunded',
    withdrawn: a.status === 'withdrawn',
    expired: a.status === 'expired',
    awaitingSignature: a.deed_state === 'awaiting_tenant',
    awaitingStaffSend: a.awaiting_staff_send === true,
    deedSentAt: toDate(a.deed_sent_at),
    deliveryFailedAt: toDate(a.delivery_failed_at),
    deliveryAttemptedTo: a.delivery_attempted_to ?? null,
    deliverySource: a.delivery_source ?? null,
    deliveryReason: a.delivery_reason ?? null,
    referencingMode: a.referencing_mode ?? undefined,
    // The joint-tenancy shape, so the list can show a tenancy as one thing.
    tenancyId: a.tenancy_id ?? null,
    tenancyPosition: a.tenancy_position == null ? null : Number(a.tenancy_position),
    sharePercent: a.share_percent == null ? null : Number(a.share_percent),
    shareAmount: a.share_amount == null ? null : Number(a.share_amount),
    fee: a.fee_amount == null ? null : Number(a.fee_amount),
    paidAtTs: a.paid_at ? new Date(a.paid_at).getTime() : null,
    deedState: (a.deed_state ?? null) as string | null,
    registered: a.applicant_id != null,
    feePaid: (Array.isArray(a.elig) ? a.elig.some((e: { paid_at?: string | null }) => e?.paid_at) : !!(a.elig as { paid_at?: string | null } | null)?.paid_at),
  }));

  // agency id -> group id, so an application can name the group it sits under
  // without a second lookup downstream.
  const groupOfAgency = new Map<string, string | null>(
    (agencies as any[]).map((a) => [String(a.id), a.group_id ?? null]),
  );

  const linesByApp = new Map<string, CommissionLine[]>();
  for (const r of (linesRes.data ?? []) as any[]) {
    const list = linesByApp.get(String(r.application_id)) ?? [];
    list.push({
      level: r.level, orgId: r.org_id ?? null, orgName: String(r.org_name ?? ''), rate: Number(r.rate ?? 0),
      // Both nullable and both left null rather than defaulted: a line frozen
      // before these were recorded does not know its source, and inventing
      // 'standard' for it would relabel a settled statement.
      source: r.source ?? null,
      basisAmount: r.basis_amount == null ? null : Number(r.basis_amount),
      // The frozen amount, so the client and commission_statement_lines say the
      // same number for the same line. Null on a pre-column row, where both
      // sides fall back to the same arithmetic.
      amount: r.amount == null ? null : Number(r.amount),
    });
    linesByApp.set(String(r.application_id), list);
  }

  const fullOut: FullApp[] = apps.map((a) => ({
    ref: a.guarantee_ref,
    partner: slugOfApp(a),
    agency: emb(a.agency)?.name ?? '',
    branch: emb(a.branch)?.name ?? '',
    branchId: a.branch_id ?? '',
    agencyId: a.agency_id ?? '',
    groupId: a.agency_id ? (groupOfAgency.get(String(a.agency_id)) ?? null) : null,
    // #97 Prefer the snapshotted referrer name (survives deactivation / users-RLS);
    // fall back to the live join, then a stable placeholder that is never counted.
    referrer: a.referrer_name ?? emb(a.referrer)?.full_name ?? '(unknown)',
    // Walk fix 18: is there a referring PERSON. The name above is a label and
    // a direct signup has one ("Direct signup") without having a referrer.
    referrerId: a.referrer_id ?? null,
    referrerRole: emb(a.referrer)?.role ?? null,
    // The other half of the referrer's LEVEL. Director and Manager are both
    // 'management' and differ only here, so role alone cannot name either.
    referrerSeesCommission: emb(a.referrer)?.sees_commission === true,
    owner: ownerFlag(a),
    status: a.status as Status,
    rent: num(a.monthly_rent),
    // The FEE, which is what commission is a share of. Falls back to rent so a
    // row created before M1 (or a mock row) reads exactly as it always did.
    fee: a.fee_amount == null ? num(a.monthly_rent) : num(a.fee_amount),
    feeBasisWeeks: a.fee_basis_weeks == null ? null : Number(a.fee_basis_weeks),
    tenancyId: a.tenancy_id ?? null,
    tenancyPosition: a.tenancy_position == null ? null : Number(a.tenancy_position),
    sharePercent: a.share_percent == null ? null : Number(a.share_percent),
    shareAmount: a.share_amount == null ? null : num(a.share_amount),
    // From the RPC when entitled, otherwise the partner's current rate as the
    // display fallback, which is what this did before for rows with no snapshot.
    // A role with no entitlement gets zero and every commission figure computed
    // from it is zero, which is the correct answer to "what commission may you
    // see" rather than a wrong number.
    partnerRate: rateById.get(a.id)?.partner ?? (partnerRateById.get(a.partner_id) ?? 0),
    agentRate: rateById.get(a.id)?.agent ?? (agentRateById.get(a.partner_id) ?? 0),
    commissionLines: linesByApp.get(a.id),
    /* Null off a supplier estate, where there is no supplier and nothing
       for the arrangement to decide. `?? null` rather than a boolean
       coalesce, because "not recorded" and "the supplier settles its own
       agents" are different answers and only one of them is false. */
    opndoorPaysAgentsAtFreeze: a.opndoor_pays_agents_at_freeze ?? null,
    sentAt: toDate(a.sent_at),
    paidAt: toDate(a.paid_at),
    deedAt: toDate(a.deed_issued_at),
    tenancyStart: toLocalDate(a.tenancy_start),
    expiry: toLocalDate(a.expiry_date),
    refunded: a.payment_state === 'refunded',
    // R2. A partial refund moves money, not the guarantee. See FullApp.
    partiallyRefunded: a.payment_state === 'partially_refunded',
    refundedAt: toDate(a.refunded_at),
    refundedAmount: a.refunded_amount != null ? num(a.refunded_amount) : null,
    refundAfterStart: !!a.refund_after_start,
    deedState: a.deed_state ?? null,
    awaitingStaffSend: a.awaiting_staff_send === true,
    deliveryFailedAt: toDate(a.delivery_failed_at),
    deliveryAttemptedTo: a.delivery_attempted_to ?? null,
    deliverySource: a.delivery_source ?? null,
    deliveryReason: a.delivery_reason ?? null,
    deedSentAt: toDate(a.deed_sent_at),
    deedViewedAt: toDate(a.deed_viewed_at),
    withdrawn: a.status === 'withdrawn',
    withdrawnReason: (a.withdrawn_reason ?? null) as FullApp['withdrawnReason'],
    withdrawnNote: a.withdrawn_note ?? null,
    expired: a.status === 'expired',
  }));

  const recordsOut: AppRecord[] = apps.map((a) => ({
    ref: a.guarantee_ref,
    name: fullName(a),
    title: a.tenant_title ?? '',
    role: '',
    addr1: a.prop_addr1,
    postcode: a.prop_postcode ?? '',
    branch: emb(a.branch)?.name ?? '',
    agency: emb(a.agency)?.name ?? '',
    rent: num(a.monthly_rent),
    status: a.status as Status,
    date: eventDate(a),
    referrer: a.referrer_name ?? emb(a.referrer)?.full_name ?? '(unknown)', // #97
    owner: ownerFlag(a),
    referencingMode: a.referencing_mode ?? undefined,
    tenancyId: a.tenancy_id ?? null,
    tenancyPosition: a.tenancy_position == null ? null : Number(a.tenancy_position),
    sharePercent: a.share_percent == null ? null : Number(a.share_percent),
    shareAmount: a.share_amount == null ? null : Number(a.share_amount),
    withdrawnReason: (a.withdrawn_reason ?? null) as AppRecord['withdrawnReason'],
    landlordName: a.landlord_name ?? null,
    landlordEmail: a.landlord_email ?? null,
    // Real values so the detail view shows exactly what was entered, and when.
    firstName: a.tenant_first_name ?? null,
    lastName: a.tenant_last_name ?? null,
    dob: a.tenant_dob ?? null,
    email: a.tenant_email ?? null,
    phone: a.tenant_phone ?? null,
    addr2: a.prop_addr2 ?? null,
    city: a.prop_city ?? null,
    county: a.prop_county ?? null,
    tenancyStartTs: a.tenancy_start ?? null,
    sentAtTs: a.sent_at ?? null,
    paidAtTs: a.paid_at ?? null,
    deedAtTs: a.deed_issued_at ?? null,
  }));

  /* ---- upcoming expiries: near-term in-force (deed) guarantees ---- */
  const horizon = Date.now() + 90 * DAY;
  const upcomingOut: UpcomingGuaranteeSeed[] = apps
    // In-force = Deed Issued AND not refunded (matches fire_expiry_reminders), so a
    // refunded guarantee never shows here looking like it should get reminders.
    .filter((a) => a.status === 'deed' && a.payment_state !== 'refunded' && a.expiry_date && new Date(a.expiry_date).getTime() <= horizon)
    .map((a) => ({
      ref: a.guarantee_ref,
      tenant: fullName(a),
      prop: propStr(a.prop_addr1, a.prop_postcode),
      branch: emb(a.branch)?.name ?? '',
      agency: emb(a.agency)?.name ?? '',
      partner: slugOfApp(a),
      owner: ownerFlag(a),
      tenancyStart: a.tenancy_start,
      remindersSent: a.expiry_reminders_sent ?? 0,
    }));

  hydratePartners(partnersOut);
  hydrateUsers(usersOut);
  hydrateOrg(agenciesOut);
  hydrateGroups(groupsOut);
  hydrateApplications(listOut, recordsOut);
  hydrateUpcoming(upcomingOut);
  hydrateFull(fullOut);

  // App settings (admin-only via RLS; returns nothing for others, so the service
  // keeps its default). Separate from the base load: small and role-scoped.
  const settingsRes = await client
    .from('app_settings')
    .select('num_value, updated_by_name, updated_at')
    .eq('key', 'bordereau_insurance_rate')
    .maybeSingle();
  if (settingsRes.data) {
    hydrateSettings({
      rate: num(settingsRes.data.num_value),
      changedAt: settingsRes.data.updated_at ? new Date(settingsRes.data.updated_at) : null,
      changedBy: settingsRes.data.updated_by_name ?? null,
    });
  }
}
