/* =====================================================================
   Getting started: mint a key, call GET /orgs, POST an application, register a
   webhook, verify a signature.

   Written as a sequence rather than a reference, because the reference is the
   API documentation tab. The order matters: each step produces the thing the
   next one needs, and the two most common integration failures (posting a
   branch with no agent contact, and treating application.reinstated as a second
   payment) are called out where they bite.
   ===================================================================== */
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { PARTNER_API_BASE_URL } from '@/config/partnerApi';

export function GettingStarted({ env }: { env: 'live' | 'sandbox' }) {
  // One configured value, rendered rather than written out. It used to be a
  // literal '/functions/v1/partner-api/v1' against a '<your-project>.supabase.co'
  // placeholder, which asked a partner to hardcode both our hosting arrangement
  // and a project ref we may need to move.
  const base = PARTNER_API_BASE_URL;
  const keyExample = env === 'live' ? 'opnd_live_...' : 'opnd_test_...';

  return (
    <Card>
      <CardHead title="Getting started" sub="Five steps, in the order that works" />
      <CardBody>
      <div className="devdoc">

        <section className="devdoc__section">
          <h3 className="devdoc__title">1. Mint a key</h3>
          <p>
            Use the <strong>API keys</strong> tab. The key is shown once and cannot be recovered, because only a
            hash is stored. Give it the narrowest scopes that do the job: <code>orgs:read</code> and{' '}
            <code>applications:write</code> are enough to create applications against organisations that already
            exist.
          </p>
          <p>
            The prefix is the mode: <code>opnd_test_</code> keys create sandbox applications and{' '}
            <code>opnd_live_</code> keys create real ones. Nothing else changes between them, so when you are
            ready to go live you swap the key and change nothing in your code. The mode is never read from
            the request body.
          </p>
          <pre className="devcode"><code>{`Authorization: Bearer ${keyExample}`}</code></pre>
        </section>

        <section className="devdoc__section">
          <h3 className="devdoc__title">2. Find your organisation ids</h3>
          <p>
            Send ids, not names. Names create duplicate agencies over time; ids do not.
          </p>
          <pre className="devcode"><code>{`curl -s "${base}/orgs" \\
  -H "Authorization: Bearer ${keyExample}"`}</code></pre>
          <p>
            Every branch carries <code>has_agent_contact</code>. <strong>If it is false, do not post against that
            branch.</strong> It means no agent contact resolves, so a deed could not be issued: the tenant would
            pay and then the deed would fail. Fix the branch in the portal first.
          </p>
        </section>

        <section className="devdoc__section">
          <h3 className="devdoc__title">3. Create an application</h3>
          <p>
            <code>Idempotency-Key</code> is required. Send the same key with the same body and you get the same
            application back rather than a second one, which is what makes a retry after a timeout safe.
          </p>
          <pre className="devcode"><code>{`curl -s -X POST "${base}/applications" \\
  -H "Authorization: Bearer ${keyExample}" \\
  -H "Idempotency-Key: your-unique-id" \\
  -H "Content-Type: application/json" \\
  -d '{
    "tenant":   { "title":"Mr","first_name":"Jo","last_name":"Bloggs",
                  "date_of_birth":"1990-04-12","email":"jo@example.com","phone":"07700900000" },
    "property": { "address_line_1":"1 High Street","city":"London","postcode":"SW1A 1AA" },
    "tenancy":  { "monthly_rent": 1250, "start_date":"2026-09-01" },
    "org":      { "agency_id":"<uuid>","branch_id":"<uuid>" },
    "referrer": { "email":"agent@youragency.co.uk" }
  }'`}</code></pre>
          <p>
            You get back the application and a <code>payment_url</code> to send the tenant. Validation failures
            come back as <code>422</code> with every bad field at once, each carrying a <code>field</code> and a{' '}
            <code>code</code>, so you can fix them in one pass rather than one per round trip.
          </p>
        </section>

        <section className="devdoc__section">
          <h3 className="devdoc__title">4. Register a webhook endpoint</h3>
          <p>
            Use the <strong>Webhook endpoints</strong> tab, or the API with <code>webhooks:manage</code>. The
            signing secret is shown once. Subscribe to nothing and you receive every event.
          </p>
          <p>
            <strong>Handle <code>application.reinstated</code> as its own thing.</strong> It is sent when a lapsed
            or tenant-declined application is paid late, instead of <code>application.paid</code>. If you treat it
            as a first payment you will double count; if you ignore it your record stays permanently wrong.
          </p>
        </section>

        <section className="devdoc__section">
          <h3 className="devdoc__title">5. Verify the signature</h3>
          <p>
            Every delivery carries <code>X-Opndoor-Signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</code>. The signed
            value is <code>&quot;&lt;t&gt;.&lt;raw body&gt;&quot;</code>, not the body alone: that is what makes a
            replay detectable. Verify against the <strong>raw</strong> body, before any JSON parsing, and reject a
            timestamp outside about five minutes.
          </p>
          <pre className="devcode"><code>{`const crypto = require('crypto');

function verify(rawBody, header, secret) {
  const m = /^t=(\\d+),v1=([a-f0-9]{64})$/.exec(header);
  if (!m) return false;
  const [, t, sig] = m;

  // Reject anything too old to be a live delivery.
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;

  const expected = crypto.createHmac('sha256', secret)
                         .update(t + '.' + rawBody)
                         .digest('hex');

  const a = Buffer.from(sig, 'hex'), b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}`}</code></pre>
          <p>
            Respond <code>2xx</code> to accept. Anything else is retried with exponential backoff for about two
            days and then dead lettered, and you can see exactly where a delivery got to on the{' '}
            <strong>Delivery history</strong> tab.
          </p>
        </section>

      </div>
      </CardBody>
    </Card>
  );
}
