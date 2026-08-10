// =====================================================================
// The partner-facing shape of an application. See PARTNER-API.md section 10.
//
// ONE SERIALIZER, THREE CALLERS: the POST response, GET /applications/{id} and
// GET /applications. The field list is the security boundary, so it exists once.
// Three inline object literals would drift, and the one that drifted would be
// whichever endpoint nobody looked at.
//
// The exclusions are enforced in SQL as well, by partner_api_applications naming
// its columns. This layer cannot widen what that returns, only narrow it. Two
// layers of default-deny, and neither is load bearing alone.
// =====================================================================

/** A row as returned by public.partner_api_applications. */
export type ApplicationRow = {
  id: string;
  guarantee_ref: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  paid_at: string | null;
  deed_issued_at: string | null;
  expiry_date: string | null;
  tenant_title: string | null;
  tenant_first: string | null;
  tenant_last: string | null;
  tenant_dob: string | null;
  tenant_email: string | null;
  tenant_phone: string | null;
  addr1: string | null;
  addr2: string | null;
  city: string | null;
  county: string | null;
  postcode: string | null;
  monthly_rent: number | null;
  tenancy_start: string | null;
  agency_id: string;
  agency_name: string;
  branch_id: string;
  branch_name: string;
  payment_token: string | null;
};

/**
 * Shape one application for a partner.
 *
 * `includePaymentUrl` is false for the list endpoint. The payment token is a
 * bearer credential for the tenant payment page, including the self-decline
 * action, so handing out a page of them to satisfy a reconciliation walk is
 * more exposure than the job needs. A partner acting on one application fetches
 * it individually.
 */
export function applicationView(
  row: ApplicationRow,
  opts: { appUrl?: string; includePaymentUrl?: boolean } = {},
): Record<string, unknown> {
  const view: Record<string, unknown> = {
    id: row.id,
    guarantee_ref: row.guarantee_ref,
    // Already mapped to the partner vocabulary by partner_status() in SQL, so
    // this reads 'lapsed' and 'deed_issued' rather than the stored values.
    status: row.status,
    created_at: row.created_at,
    sent_at: row.sent_at,
    paid_at: row.paid_at,
    deed_issued_at: row.deed_issued_at,
    expiry_date: row.expiry_date,
    tenant: {
      title: row.tenant_title,
      first_name: row.tenant_first,
      last_name: row.tenant_last,
      date_of_birth: row.tenant_dob,
      email: row.tenant_email,
      phone: row.tenant_phone,
    },
    property: {
      address_line_1: row.addr1,
      address_line_2: row.addr2,
      city: row.city,
      county: row.county,
      postcode: row.postcode,
    },
    tenancy: {
      monthly_rent: row.monthly_rent,
      start_date: row.tenancy_start,
    },
    org: {
      agency_id: row.agency_id,
      agency_name: row.agency_name,
      branch_id: row.branch_id,
      branch_name: row.branch_name,
    },
  };

  if (opts.includePaymentUrl) {
    const base = (opts.appUrl ?? "").replace(/\/$/, "");
    view.payment_url = row.payment_token && base ? `${base}/pay?token=${row.payment_token}` : null;
  }

  return view;
}

/**
 * The opaque pagination cursor.
 *
 * Encodes the keyset, `(created_at, id)`, rather than an offset. Offset
 * pagination silently skips rows when new applications are created during a
 * walk, which for a partner reconciling their book means quietly missing
 * records. Base64 so it reads as opaque and nobody builds a client that parses
 * and increments it.
 */
export function encodeCursor(createdAt: string, id: string): string {
  return btoa(`${createdAt}|${id}`);
}

export function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = atob(cursor).split("|");
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
