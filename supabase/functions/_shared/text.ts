// #8 Display-layer address title-casing: SHOUTED all-caps address words
// ("LONDON" -> "London", "EARL'S COURT" -> "Earl's Court") become title case,
// while postcodes (uppercase runs adjacent to a digit, e.g. SW7, EC2A, 1AA),
// mixed-case and numeric tokens are left untouched. Stored data is never changed.
// Lookahead-only (no lookbehind) so it parses on older Safari too. A SHOUTED word
// is 2+ letters and may contain apostrophes, so possessives case correctly.
export function titleCaseAddress(s: string | null | undefined): string {
  if (!s) return s ?? "";
  return s.replace(/(^|[^A-Za-z0-9'])([A-Z][A-Z']*[A-Z])(?![A-Za-z0-9])/g, (_m, pre, word) => pre + word[0] + word.slice(1).toLowerCase());
}

/* ONE DATE FORMAT FOR A TENANT, and it used to live inside pandadoc.ts where
 * only the deed could reach it.
 *
 * "16 Oct 2026". The repo has a oneDateFormat guard for the client for the
 * same reason this moved: a tenant comparing the date on their deed with the
 * date in the email telling them to sign it must not find two spellings and
 * wonder which document is current. The signing email (signingInvite.ts) and
 * the deed's own covering text (pandadoc.ts) now read it from here.
 */
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** An ISO date as "16 Oct 2026". Returns the input unchanged if it is not one,
 *  because a malformed date is a thing to show, not a thing to crash on. */
export function spelledDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return iso || "";
  return `${Number(m[3])} ${MONTH_SHORT[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}
