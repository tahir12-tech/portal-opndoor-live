/* =====================================================================
   A BACK LINK TO SOMEWHERE THE SIDEBAR ALREADY GOES.

   Matt (bo), verbatim: "League: remove the 'Back to dashboard' link at
   the top (it's in the sidebar already). Check other pages for the same
   leftover back links and remove those too, except on detail pages (an
   application, agency or supplier), where 'back to the list' is useful."

   THE EXCEPTION IS THE WHOLE RULE, so the test is written as the rule
   and not as a list of two files. A back link is dead weight when it
   goes somewhere the sidebar also goes, and it is the most useful
   control on the page when it goes somewhere the sidebar cannot --
   "the list I came from" has no sidebar entry, because the sidebar
   does not know you are three levels into an agency.

   SO THE TEST IS AGAINST NAV AND THE ROUTE TABLE rather than against a
   hand-kept list of top-level pages: a component the sidebar links to
   DIRECTLY must carry no back link at all. Keyed on a list, this guard
   would go stale the first time a page was added to the nav, and go
   stale silently, which is the failure mode the League links are an
   example of -- both were correct when they were written, on a screen
   reached from the dashboard before it had a sidebar entry.

   IT IS THE PAGE THAT DECIDES, NOT THE DESTINATION. My first draft
   asked whether the back link POINTED at a sidebar route, and it
   immediately reported "Back to applications" on an application --
   which is the one case Matt names as worth keeping. A detail page is
   not in the sidebar; the list it returns to is. Reading the rule off
   the destination inverts it exactly.

   WHAT IS DELIBERATELY NOT COVERED. Signed-out pages -- "Back to sign
   in" on the login, reset and forgot-password screens -- have no
   sidebar at all, so the rule does not reach them. Nor do controls that
   only read like back links: "Back to default" on a share deal is an
   action, "Back to in progress" is a tab, and "Back to configuration"
   and "Back to the tree" close a panel within one page rather than
   navigating anywhere.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { NAV } from '@/constants/nav';

const ROOT = process.cwd();
const PAGES = join(ROOT, 'src/pages');

/** The routes the sidebar lists. */
const SIDEBAR_ROUTES = new Set(NAV.flatMap((g) => g.items.map((i) => i.to)));

/** Component name -> route, read off App.tsx's own table, so a page that
    is moved or renamed cannot drift out of this guard's sight. */
const APP = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8');
const ROUTE_OF = new Map<string, string[]>();
for (const m of APP.matchAll(/<Route\s+path="([^"]+)"\s+element=\{<([A-Za-z0-9_]+)/g)) {
  ROUTE_OF.set(m[2], [...(ROUTE_OF.get(m[2]) ?? []), m[1]]);
}

/** Is this file the component behind a page the sidebar links to? A file
    may export several components; the one that matters is the one named
    like the file, which is this codebase's convention for a page. */
function isTopLevelPage(file: string): boolean {
  const name = file.split('/').pop()!.replace(/\.tsx$/, '');
  return (ROUTE_OF.get(name) ?? []).some((r) => SIDEBAR_ROUTES.has(r));
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) return walk(full);
    return e.endsWith('.tsx') && !e.includes('.test.') ? [full] : [];
  });
}

describe('a page the sidebar links to', () => {
  const offences: string[] = [];
  const kept: string[] = [];
  for (const file of walk(PAGES)) {
    const rel = relative(ROOT, file);
    const top = isTopLevelPage(file);
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (!/arrowLeft/.test(line)) return;
      const m = /to="(\/[^"]*)"/.exec(line);
      // No `to`: it closes a panel or runs an action, and navigates nowhere.
      if (!m) return;
      (top ? offences : kept).push(`${rel}:${i + 1}  -> ${m[1]}`);
    });
  }

  it('carries no back link, because the sidebar is already that link', () => {
    expect(offences).toEqual([]);
  });

  /* THE GUARD HAS TO BE ABLE TO SEE. A sweep that matched nothing would
     pass this file forever, so the back links worth keeping are named:
     they are the proof the search works, and they are the three cases
     Matt singled out -- an application, an agency and a supplier. */
  it('while the three on detail pages are untouched', () => {
    const to = kept.map((k) => k.split('-> ')[1]);
    expect(to).toContain('/applications');
    expect(to).toContain('/agencies');
    expect(to).toContain('/partners');
  });
});
