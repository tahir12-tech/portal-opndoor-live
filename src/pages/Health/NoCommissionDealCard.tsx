/* =====================================================================
   SUPPLIERS TAKING REFERRALS WITH NO COMMISSION DEAL.

   Matt, 2026-10-03: "Make a missing deal loud, not silent: when a
   referral is created for a supplier with no commission deal set (rates
   null, coalesced to 0), raise an ops alert once per supplier and show
   it on Health and the supplier's Overview ('Referrals are coming in
   with no commission deal set')."

   WHY THIS EXISTS AT ALL. 20261007680000 stopped "Add supplier" handing
   out a silent 25% deal, and gave `resolve_rates` a last-resort 0 so a
   dealless supplier's referrals are recorded rather than refused on
   `applications.partner_rate`'s NOT NULL. Refusing them is an
   After-launch item. The price of not refusing is that nothing says so:
   the referral is created, the statement shows nothing owed, and the
   first person to notice is the supplier, asking where their money is.

   THE EMAIL IS ONCE PER SUPPLIER AND THIS IS NOT. The trigger latches in
   `supplier_no_deal_alerts` so the alert is sent once; this card asks
   the database what is true NOW, every time it is opened. So a supplier
   drops off it the moment a deal is set, and clearing a latch changes
   nothing here. Two facts: one about the world, one about our own post.

   NOT A RECONCILIATION QUEUE, deliberately, though it looks like one.
   Reconciliation is work on CUSTOMER records -- match this agency, add
   that email -- and its counts are quoted on Home and in the sidebar.
   This is Opndoor's own commercial admin, it is nobody's queue, and
   adding it to that total would change a number Matt has already had
   fixed twice.
   ===================================================================== */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadSuppliersWithNoDeal, type SupplierWithNoDeal } from '@/data';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { plural } from '@/lib/plural';
import { formatDate } from '@/lib/format';

export function NoCommissionDealCard() {
  const [rows, setRows] = useState<SupplierWithNoDeal[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadSuppliersWithNoDeal()
      .then((r) => { if (alive) { setRows(r); setLoaded(true); } })
      .catch(() => { if (alive) { setRows([]); setLoaded(true); } });
    return () => { alive = false; };
  }, []);

  /* NOTHING AT ALL WHEN THERE IS NOTHING, which is the common case and
     the one Health is read in. A card saying "no problems" on a page of
     cards saying "no problems" is how the page stops being scanned. */
  if (!loaded || rows.length === 0) return null;

  return (
    <Card style={{ marginBottom: 18 }}>
      <CardHead
        title="Referrals are coming in with no commission deal set"
        sub="These suppliers have sent referrals that were priced at 0%. Nothing is owed to them until a deal is set, and setting one prices new referrals only."
      />
      <CardBody>
        {rows.map((r) => (
          <p key={r.slug} className="stmt__err" style={{ marginBottom: 8 }}>
            <Icon name="alert" size={14} />
            <span>
              <Link to={`/partners/${encodeURIComponent(r.slug)}?tab=commission`}><b>{r.name}</b></Link>
              {' '}&middot; <b>{r.referrals}</b> {plural(r.referrals, 'referral')}
              {r.firstReferralAt && <> since {formatDate(r.firstReferralAt)}</>}
              {' '}&middot; set a deal on their Commission tab
            </span>
          </p>
        ))}
      </CardBody>
    </Card>
  );
}
