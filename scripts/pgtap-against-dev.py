#!/usr/bin/env python3
"""Run pgTAP files against DEV, capturing every assertion line.

WHY THIS EXISTS. `npm run test:db` is `supabase test db`, which needs Docker to
start a throwaway freshly-migrated Postgres. Docker is not installed on this
machine, so the pgTAP suite has never been executed here -- it only runs in CI
on push, and nothing has been pushed. pgTAP 1.3.3 is therefore installed into
dev's `extensions` schema (nothing in `public`, so `npm run drift` is
unaffected) and these files run against dev instead.

THE ONE AWKWARD BIT. Supabase's SQL endpoint returns only the LAST statement's
rows, so sending a pgTAP file verbatim shows one assertion out of nine. Rather
than reordering or merging assertions -- which would change interleaving with
the fixtures and with `set local role`, and so change what is being tested --
each assertion is rewritten IN PLACE from

    select is(...);                 ->  insert into _tap(line) select is(...);

and the table is selected at the end. Every statement stays exactly where it
was, in the same transaction, with the same roles in force.

WHAT THIS IS NOT. Dev is not a freshly-migrated database: it carries real seed
rows and ~320 migrations' worth of state. CI remains the authority. A pass here
means the assertions hold against dev; it does not prove a clean filename-order
run, which is what `npm run drift` is for.
"""
import json, os, re, subprocess, sys

REF = "nfufwcpgrhfgwtphegca"          # dev. never the live ref.
REPO = "/Users/nicholasdwyer/Downloads/portal-opndoor-liveCode"

TAP_FNS = (
    "plan|finish|is|isnt|ok|nok|is_empty|isnt_empty|throws_ok|lives_ok|"
    "matches|imatches|doesnt_match|cmp_ok|pass|fail|diag|todo|skip|"
    "has_table|has_column|has_function|hasnt_function|col_is_null|"
    "col_not_null|results_eq|results_ne|set_eq|bag_eq|row_eq|"
    "function_privs_are|table_privs_are|column_privs_are|policies_are|"
    "has_policy|hasnt_policy|is_definer|volatility_is|has_trigger"
)


def split_statements(sql: str):
    """Split on semicolons that are not inside a string or a dollar-quote."""
    out, buf, i, n = [], [], 0, len(sql)
    dollar = None          # the active $tag$, if any
    quote = None           # ' or "
    while i < n:
        ch = sql[i]
        if dollar:
            if sql.startswith(dollar, i):
                buf.append(dollar); i += len(dollar); dollar = None; continue
            buf.append(ch); i += 1; continue
        if quote:
            buf.append(ch)
            if ch == quote:
                if i + 1 < n and sql[i + 1] == quote:   # doubled = escaped
                    buf.append(sql[i + 1]); i += 2; continue
                quote = None
            i += 1; continue
        if ch == "-" and sql.startswith("--", i):
            j = sql.find("\n", i)
            j = n if j == -1 else j + 1
            buf.append(sql[i:j]); i = j; continue
        # BLOCK COMMENTS MUST BE SKIPPED WHOLE. Nearly every test file explains
        # itself in /* ... */ prose, and that prose contains apostrophes
        # ("the owner's own application"). Treating one as an opening quote
        # swallows every semicolon until the next apostrophe, silently merging
        # a dozen assertions into one statement -- which then reports one
        # result and hides the rest, including any that failed.
        if ch == "/" and sql.startswith("/*", i):
            depth, j = 1, i + 2               # Postgres nests these
            while j < n and depth:
                if sql.startswith("/*", j): depth += 1; j += 2; continue
                if sql.startswith("*/", j): depth -= 1; j += 2; continue
                j += 1
            buf.append(sql[i:j]); i = j; continue
        if ch in ("'", '"'):
            quote = ch; buf.append(ch); i += 1; continue
        m = re.match(r"\$[A-Za-z_]*\$", sql[i:])
        if m:
            dollar = m.group(0); buf.append(dollar); i += len(dollar); continue
        if ch == ";":
            out.append("".join(buf) + ";"); buf = []; i += 1; continue
        buf.append(ch); i += 1
    tail = "".join(buf).strip()
    if tail:
        out.append(tail)
    return out


ASSERTION = re.compile(
    r"^(?P<lead>(?:\s|--[^\n]*\n|/\*(?:[^*]|\*(?!/))*\*/)*)"          # comments and blank lines stay put
    r"(?P<sel>select\s+(?:\*\s+from\s+)?(?:" + TAP_FNS + r")\s*\()",
    re.I | re.S,
)


LEADING_NOISE = re.compile(r"^(?:\s|--[^\n]*\n|/\*(?:[^*]|\*(?!/))*\*/)*")


def rewrite(sql: str):
    """Rewrite in place. Every statement keeps its position, its comments and
    whatever role is in force around it; only the assertions gain a wrapper."""
    stmts, rewritten = split_statements(sql), []
    for s in stmts:
        noise = LEADING_NOISE.match(s).group(0)     # the file's own comments
        core = s[len(noise):].strip()
        if re.match(r"^begin\s*;$", core, re.I):
            rewritten.append(s)
            # Half the suite asserts from inside `set local role authenticated`,
            # which is the whole point of those files. The capture table has to
            # be writable by whatever role is in force, or the rewrite would
            # silently only work for the tests that never change role -- which
            # is exactly the half that proves least.
            rewritten.append(
                "\ncreate temporary table _tap(seq serial primary key, line text);"
                "\ngrant insert, select on _tap to public;"
                "\ngrant usage, select on sequence _tap_seq_seq to public;\n")
            continue
        if re.match(r"^rollback\s*;$", core, re.I):
            rewritten.append("\nreset role;\nselect line from _tap order by seq;\n")
            rewritten.append(s)
            continue
        if ASSERTION.match(core):
            rewritten.append(noise + "insert into _tap(line) " + core)
            continue
        rewritten.append(s)
    return "".join(rewritten)


def run(path: str):
    with open(os.path.join(REPO, path) if not os.path.isabs(path) else path) as f:
        src = f.read()
    sql = "set search_path = public, extensions, pg_temp;\n" + rewrite(src)
    tok = subprocess.run(["security", "find-generic-password", "-s", "Supabase CLI", "-w"],
                         capture_output=True, text=True).stdout.strip()
    r = subprocess.run(
        ["curl", "-s", "-H", f"Authorization: Bearer {tok}",
         "-H", "Content-Type: application/json",
         "-d", json.dumps({"query": sql}),
         f"https://api.supabase.com/v1/projects/{REF}/database/query"],
        capture_output=True, text=True)
    try:
        d = json.loads(r.stdout)
    except Exception:
        return None, ["RAW: " + r.stdout[:1200]]
    if isinstance(d, dict):
        return None, ["ERROR: " + (d.get("message") or "")[:1200]]
    return [list(x.values())[0] for x in d], []


if __name__ == "__main__":
    files = sys.argv[1:]
    total_fail, errored = 0, []
    for path in files:
        lines, err = run(path)
        name = os.path.basename(path)
        if lines is None:
            print(f"\n=== {name}")
            for e in err:
                print("   " + e)
            errored.append(name)
            continue
        bad = [l for l in lines if isinstance(l, str) and l.startswith("not ok")]
        diag = [l for l in lines if isinstance(l, str) and l.startswith("#")]
        total_fail += len(bad)
        oks = sum(1 for l in lines if isinstance(l, str) and l.startswith("ok "))
        status = "FAIL" if bad else "pass"
        print(f"{status}  {name}  {oks} ok, {len(bad)} failing")
        if bad or len(files) == 1:
            for l in lines:
                print("   " + str(l))
        elif diag:
            for l in diag:
                print("   " + str(l))
    print()
    print(f"files: {len(files)}   failing assertions: {total_fail}   errored files: {len(errored)}")
    if errored:
        print("errored: " + ", ".join(errored))
    sys.exit(1 if (total_fail or errored) else 0)
