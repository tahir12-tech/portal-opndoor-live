/* WHAT A READER MAY OPEN ON HELP.

   Four faults, all of them things the page showed to somebody it should not
   have, and all of them invisible to the old rule because minRole is a single
   ladder and the questions are not on one.

   THE RAIL. Supplier material talks about referring somebody else's stock,
   adding agencies on the fly, white-labelling and the sales conversation. A
   Regent reader is on our own estate and does none of that, so it describes a
   product they are not using.

   COMMISSION. minRole 'management' admits Directors AND Managers, because they
   are the same role. The Manager level exists precisely so somebody can run the
   team without being shown what the agency earns, and the Management guide
   describes the commission in prose, so that level handed it straight back.

   EMPTY ITEMS. Three of the eleven seeded resources have no file and no
   servable href. They rendered to everyone as "Coming soon", which is a promise
   the page cannot keep made to people who cannot make it come.

   DUPLICATES. The referral checklist is the referrer guide's own #send anchor,
   so one document sat on the shelf twice under two names.

   mayOpenResource is the part that is pure, so it is the part asserted here. */
import { describe, expect, it } from 'vitest';
import { mayOpenFaq, mayOpenResource, type HelpViewer } from './Help';
import type { HelpResource } from '@/data/types';

const res = (over: Partial<HelpResource>): HelpResource =>
  ({ id: 'x', icon: 'doc', type: 'Guide', title: 'T', desc: '', meta: '', ...over });

const DIRECTOR: HelpViewer = { role: 'management', seesCommission: true, agency: true, admin: false };
const MANAGER: HelpViewer = { role: 'management', seesCommission: false, agency: true, admin: false };
const NEGOTIATOR: HelpViewer = { role: 'referrer', seesCommission: false, agency: true, admin: false };
const SUPPLIER_MGMT: HelpViewer = { role: 'management', seesCommission: true, agency: false, admin: false };
const ADMIN: HelpViewer = { role: 'superadmin', seesCommission: true, agency: false, admin: true };

describe('the rail', () => {
  const salesGuide = res({ rail: 'supplier' });

  it('keeps supplier material away from every agency reader', () => {
    for (const v of [DIRECTOR, MANAGER, NEGOTIATOR]) {
      expect(mayOpenResource(salesGuide, v)).toBe(false);
    }
  });

  it('still shows it to a supplier and to opndoor', () => {
    expect(mayOpenResource(salesGuide, SUPPLIER_MGMT)).toBe(true);
    expect(mayOpenResource(salesGuide, ADMIN)).toBe(true);
  });

  it('leaves anything untagged visible to both rails, which is most of the shelf', () => {
    const shared = res({});
    for (const v of [DIRECTOR, MANAGER, NEGOTIATOR, SUPPLIER_MGMT, ADMIN]) {
      expect(mayOpenResource(shared, v)).toBe(true);
    }
  });
});

describe('commission', () => {
  const mgmtGuide = res({ minRole: 'management', needsCommission: true });

  /* THE ONE THE OLD RULE COULD NOT EXPRESS. Both are 'management', so minRole
     alone cannot separate them and the Manager was being shown the figures. */
  it('separates a Director from a Manager, though both are management', () => {
    expect(mayOpenResource(mgmtGuide, DIRECTOR)).toBe(true);
    expect(mayOpenResource(mgmtGuide, MANAGER)).toBe(false);
  });

  it('is never opened by a Negotiator, who does not clear the role ladder either', () => {
    expect(mayOpenResource(mgmtGuide, NEGOTIATOR)).toBe(false);
  });

  it('is open to opndoor regardless', () => {
    expect(mayOpenResource(mgmtGuide, ADMIN)).toBe(true);
  });

  /* The two tests are independent: a commission resource with no minRole still
     needs the bit, or tagging one and forgetting the other would leak it. */
  it('needs the bit even with no role floor set', () => {
    expect(mayOpenResource(res({ needsCommission: true }), MANAGER)).toBe(false);
    expect(mayOpenResource(res({ needsCommission: true }), DIRECTOR)).toBe(true);
  });
});

describe('the role ladder, unchanged', () => {
  it('still hides an opndoor-admin guide from everyone else', () => {
    const adminGuide = res({ minRole: 'superadmin' });
    for (const v of [DIRECTOR, MANAGER, NEGOTIATOR, SUPPLIER_MGMT]) {
      expect(mayOpenResource(adminGuide, v)).toBe(false);
    }
    expect(mayOpenResource(adminGuide, ADMIN)).toBe(true);
  });

  it('still hides a management guide from a Negotiator', () => {
    expect(mayOpenResource(res({ minRole: 'management' }), NEGOTIATOR)).toBe(false);
    expect(mayOpenResource(res({ minRole: 'management' }), MANAGER)).toBe(true);
  });
});

describe('agency-rail material', () => {
  it('is hidden from a supplier but shown to opndoor, who maintain it', () => {
    const agencyGuide = res({ rail: 'agency' });
    expect(mayOpenResource(agencyGuide, SUPPLIER_MGMT)).toBe(false);
    expect(mayOpenResource(agencyGuide, ADMIN)).toBe(true);
    for (const v of [DIRECTOR, MANAGER, NEGOTIATOR]) {
      expect(mayOpenResource(agencyGuide, v)).toBe(true);
    }
  });
});

describe('the FAQs answer to the same rules', () => {
  /* THE ONE THAT WAS ACTUALLY LEAKING. f8 named 25% and 10% outright, in a list
     with no gate of any kind on it, so every Manager and Negotiator could read
     the commission the Manager level exists to withhold. Gating the guide that
     describes commission was never enough on its own. */
  it('withholds an answer that states the commission from a Manager', () => {
    const f8 = { needsCommission: true };
    expect(mayOpenFaq(f8, MANAGER)).toBe(false);
    expect(mayOpenFaq(f8, NEGOTIATOR)).toBe(false);
    expect(mayOpenFaq(f8, DIRECTOR)).toBe(true);
    expect(mayOpenFaq(f8, ADMIN)).toBe(true);
  });

  it('keeps supplier-rail answers off an agency reader', () => {
    expect(mayOpenFaq({ rail: 'supplier' }, DIRECTOR)).toBe(false);
    expect(mayOpenFaq({ rail: 'supplier' }, SUPPLIER_MGMT)).toBe(true);
  });

  it('shows an ordinary answer to everybody, which is most of them', () => {
    for (const v of [DIRECTOR, MANAGER, NEGOTIATOR, SUPPLIER_MGMT, ADMIN]) {
      expect(mayOpenFaq({}, v)).toBe(true);
    }
  });
});
