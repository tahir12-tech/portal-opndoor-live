/* =====================================================================
   THE "N ACTIVE KEYS" COUNT KEEPS UP WITH THE LIST BESIDE IT.

   Matt, 2026-10-03: "Supplier Integration tab (admin): after revoking a key,
   the 'N active keys' count at the top doesn't update until refresh. Update it
   straight away, and check the same on the Dev Centre after mint, revoke and
   delete."

   WHY THE LIST WAS RIGHT AND THE COUNT WAS WRONG, which is the whole shape of
   it: they are two components. `SupplierApiKeys` reloads itself after a
   revoke, so the row disappeared immediately. The count lives in
   `ApiAccessSwitch` beside it, whose effect is keyed on the partner and on the
   API on/off switch -- and a revoke changes neither, so nothing told it to
   look again.

   THE PARENT HOLDS THE FACT THEY SHARE, which is the honest place for it:
   they have a parent in common, and a shared store or a context for one
   integer would be a bigger mechanism than the problem.

   AND THE DEV CENTRE WAS ALREADY FINE, which is the half of the instruction
   that needed checking rather than fixing: it has no separate count at all --
   its list IS the count -- and all three of its actions `await load()`.
   Asserted below so that stays true.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const SWITCH = read('src/pages/PartnerManagement/ApiAccessSwitch.tsx');
const KEYS = read('src/pages/PartnerManagement/SupplierApiKeys.tsx');
const HOME = read('src/pages/PartnerManagement/PartnerHome.tsx');
const DEV = read('src/pages/DevCentre/DevCentre.tsx');

describe('the count', () => {
  it('re-reads when the key set changes, not only when the switch flips', () => {
    expect(SWITCH).toContain('}, [slug, on, version]);');
  });

  /* DEFAULTED, so the component's other caller is unchanged by this: a prop
     that has to be passed everywhere is a prop somebody forgets. */
  it('and the signal is optional', () => {
    expect(SWITCH).toContain('version = 0 }');
    expect(SWITCH).toContain('version?: number;');
  });
});

describe('the list beside it', () => {
  it('tells the parent after a revoke, as well as reloading itself', () => {
    expect(KEYS).toContain('await load();\n          onChanged?.();');
  });

  it('and the callback is optional, because the Dev Centre has no count', () => {
    expect(KEYS).toContain('onChanged?: () => void;');
  });
});

describe('the parent', () => {
  it('holds the counter the two of them share', () => {
    expect(HOME).toContain('const [keysVersion, setKeysVersion] = useState(0);');
  });

  it('and wires both ends of it', () => {
    expect(HOME).toContain('version={keysVersion}');
    expect(HOME).toContain('onChanged={() => setKeysVersion((v) => v + 1)}');
  });
});

describe('the Dev Centre, which Matt asked me to check', () => {
  /* ALL THREE ACTIONS RELOAD, which is why there was nothing to fix there.
     Its list is the count, so a reload IS the update. */
  it('reloads after a revoke and after a delete', () => {
    expect(DEV).toContain('await revokeApiKey(k.id); toast(`Revoked ${k.name}.`); await load();');
    expect(DEV).toContain('await deleteApiKey(k.id); toast(`Deleted ${k.name}.`); await load();');
  });

  it('and after a mint', () => {
    const mint = DEV.slice(DEV.indexOf('await mintApiKey('), DEV.indexOf('await mintApiKey(') + 400);
    expect(mint).toContain('await load();');
  });
});
