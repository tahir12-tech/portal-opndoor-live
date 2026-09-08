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
  hydratePartners, hydrateUsers, hydrateOrg, hydrateApplications, hydrateUpcoming, hydrateFull, hydrateSettings,
  type Agency, type AgentContact, type ApplicationSummary, type Branch, type FullApp, type ManagedUser, type Role,
  type Partner, type Status,
} from '@/data';
import type { AppRecord } from '@/data/mock/applications';
import type { UpcomingGuaranteeSeed } from '@/data/mock/guarantees';

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

function relTime(ts: string | null, status: string): string {
  if (!ts) return status === 'pending' ? 'Pending invite' : '—';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const wks = Math.round(days / 7);
  return `${wks} week${wks === 1 ? '' : 's'} ago`;
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
  const [partnersRes, partnerRatesRes, usersRes, ratesRes, agenciesRes, branchesRes, contactsRes, appsRes] = await Promise.all([
    // THE RATES ARE NO LONGER SELECTABLE HERE BY ANYONE, exactly as on
    // applications. They came off the table grant for `authenticated`
    // (20260815030000), because this string was never enforcement: it decided
    // what the client ASKED for, and PostgREST answers whatever it is asked. A
    // referrer could request them directly and did, proven live.
    //
    // Same list for every role now. There is nothing left to narrow, which is
    // the point: a select that cannot leak does not need a conditional.
    client.from('partners').select(
      'id, slug, name, status, live_from, is_primary, referrer_leaderboard_mode, referencing_mode, portal_referrals_enabled, api_access_enabled',
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
    // partner:partners is named to its FK, not left bare. partner_agency_relationships
    // (20260812110000) gave PostgREST a SECOND agencies<->partners relationship, the
    // many-to-many of who-can-reach-whom, on top of the direct owner FK. A bare
    // partners(...) embed is now ambiguous (PGRST201) and threw "Failed to load data"
    // for every role, because this is the global hydrate. agencies_partner_id_fkey is
    // the one meant here: the single owning partner, the same one partner_id resolves
    // to. The many-to-many would return an array and, for a shared agency, the wrong
    // partner.
    client.from('agencies').select('id, name, group_name, review_state, partner_id, partner:partners!agencies_partner_id_fkey(slug)'),
    client.from('branches').select('id, name, area, review_state, agency_id, partner_id'),
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
        'monthly_rent, ' +
        'status, beneficiary, tenancy_start, sent_at, paid_at, deed_issued_at, expiry_date, ' +
        'payment_state, refunded_at, refunded_amount, paid_amount, refund_after_start, ' +
        'withdrawn_at, withdrawn_reason, withdrawn_note, ' +
        'deed_state, deed_sent_at, deed_viewed_at, expiry_reminders_sent, ' +
        'referencing_mode, ' +
        'referrer_id, referrer_name, branch_id, agency_id, partner_id, ' +
        'branch:branches(name), agency:agencies(name), referrer:users!referrer_id(full_name, role), partner:partners(slug)',
    ),
  ]);

  // ratesRes is deliberately absent from this list. It returns nothing for a
  // referrer or a developer by design, and treating that as a hydration failure
  // would break login for two roles to protect a figure they are not shown.
  for (const res of [partnersRes, usersRes, agenciesRes, branchesRes, contactsRes, appsRes]) {
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
  const branches = (branchesRes.data ?? []) as any[];
  const contacts = (contactsRes.data ?? []) as any[];
  const apps = (appsRes.data ?? []) as any[];

  // Keyed by application id. Empty for a referrer or a developer, which is the
  // point: every commission figure computed downstream then comes out zero
  // rather than wrong.
  const rateById = new Map<string, { partner: number; agent: number }>(
    ((ratesRes.data ?? []) as any[]).map((r) => [r.application_id, { partner: num(r.partner_rate), agent: num(r.agent_rate) }]),
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
    lastActive: relTime(u.last_sign_in_at, u.status),
    status: u.status,
    partner: u.role === 'superadmin' ? 'opndoor' : (u.partner_slug ?? ''),
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
    id: p.slug,
    name: p.name,
    status: p.status,
    since: p.live_from ? String(p.live_from).slice(0, 7) : '',
    weight: (appsByPartner[p.slug] || 0) / maxApps || 0.05,
    ...(p.is_primary ? { primary: true } : {}),
    users: usersByPartner[p.slug] || 0,
    apps: appsByPartner[p.slug] || 0,
    partnerRate: num(p.partner_rate),
    agentRate: num(p.agent_rate),
    referrerLeaderboard: (p.referrer_leaderboard_mode ?? 'full') as Partner['referrerLeaderboard'],
    referencingMode: (p.referencing_mode ?? 'pre_referenced_screened') as Partner['referencingMode'],
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
  const feesNet = (rows: any[]): number =>
    sum(rows, (x) => (x.status === 'paid' || x.status === 'deed' ? num(x.monthly_rent) : 0)) -
    sum(rows, (x) => (x.payment_state === 'refunded' ? num(x.refunded_amount ?? x.monthly_rent) : 0));

  const agenciesOut: Agency[] = agencies.map((a) => {
    const brs: Branch[] = (branchesByAgency[a.id] ?? []).map((b) => {
      const bApps = appsByBranch[b.id] ?? [];
      const branch: Branch = {
        id: b.id,
        name: b.name,
        area: b.area || '—',
        referrers: new Set(bApps.map((x) => x.referrer_id)).size,
        referrals: bApps.length,
        guaranteed: money(sum(bApps, (x) => num(x.monthly_rent) * 12)),
        fees: feesNet(bApps),
        contacts: (contactsByBranch[b.id] ?? []).map(toContact),
      };
      if (b.review_state === 'pending_review') branch.unreviewed = true;
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
    if (a.review_state === 'pending_review') agency.unreviewed = true;
    return agency;
  });

  /* ---- applications: summaries + detail records ---- */
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
    // #owner referrer name + sent-date for the Applications referrer/period filters.
    referrer: a.referrer_name ?? emb(a.referrer)?.full_name ?? null,
    sentAtTs: a.sent_at ? new Date(a.sent_at).getTime() : null,
    refunded: a.payment_state === 'refunded',
    withdrawn: a.status === 'withdrawn',
    expired: a.status === 'expired',
    awaitingSignature: a.deed_state === 'awaiting_tenant',
    referencingMode: a.referencing_mode ?? undefined,
  }));

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
  const fullOut: FullApp[] = apps.map((a) => ({
    ref: a.guarantee_ref,
    partner: slugOfApp(a),
    agency: emb(a.agency)?.name ?? '',
    branch: emb(a.branch)?.name ?? '',
    branchId: a.branch_id ?? '',
    // #97 Prefer the snapshotted referrer name (survives deactivation / users-RLS);
    // fall back to the live join, then a stable placeholder that is never counted.
    referrer: a.referrer_name ?? emb(a.referrer)?.full_name ?? '(unknown)',
    referrerRole: emb(a.referrer)?.role ?? null,
    owner: ownerFlag(a),
    status: a.status as Status,
    rent: num(a.monthly_rent),
    // From the RPC when entitled, otherwise the partner's current rate as the
    // display fallback, which is what this did before for rows with no snapshot.
    // A role with no entitlement gets zero and every commission figure computed
    // from it is zero, which is the correct answer to "what commission may you
    // see" rather than a wrong number.
    partnerRate: rateById.get(a.id)?.partner ?? (partnerRateById.get(a.partner_id) ?? 0),
    agentRate: rateById.get(a.id)?.agent ?? (agentRateById.get(a.partner_id) ?? 0),
    sentAt: toDate(a.sent_at),
    paidAt: toDate(a.paid_at),
    deedAt: toDate(a.deed_issued_at),
    tenancyStart: toLocalDate(a.tenancy_start),
    expiry: toLocalDate(a.expiry_date),
    refunded: a.payment_state === 'refunded',
    refundedAt: toDate(a.refunded_at),
    refundedAmount: a.refunded_amount != null ? num(a.refunded_amount) : null,
    refundAfterStart: !!a.refund_after_start,
    deedState: a.deed_state ?? null,
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
    withdrawnReason: (a.withdrawn_reason ?? null) as AppRecord['withdrawnReason'],
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
