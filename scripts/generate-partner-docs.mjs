/* =====================================================================
   Generate the partner-facing API documentation from PARTNER-API.md.

   WHY THIS IS A BUILD STEP AND NOT A RUNTIME IMPORT. The obvious approach is
   `import spec from '../PARTNER-API.md?raw'` and filter it in the component.
   That filters what is RENDERED, not what is SHIPPED: Vite inlines the whole
   file into the bundle, so the entire internal specification, including its
   references to DEFECTS.md, its migration citations and its unresolved open
   questions, is readable in devtools by any partner developer.

   Extracting here means only the sanitised subset is ever emitted.

   Run: node scripts/generate-partner-docs.mjs
   The output is committed, so a spec change needs this re-run. That is a real
   drift risk and a deliberate trade: a stale generated file is visible in a diff,
   whereas leaking the whole spec is not visible at all.
   ===================================================================== */
import { readFileSync, writeFileSync } from 'node:fs';

const SPEC   = 'PARTNER-DOCS.md';
const OUT    = 'src/pages/DevCentre/partnerDocs.generated.ts';
const CONFIG = 'src/config/partnerApi.ts';

/* ---------------------------------------------------------------------
   The base URL is configured in one place and rendered here, rather than
   living as a literal in the markdown that somebody has to remember to
   update. PARTNER-API.md keeps the canonical URL written out in full so it
   stays readable to a human; this rewrites it to whatever is configured.

   Reading the .ts file with a regex rather than importing it, for the same
   reason generate-environment.mjs does: this is a plain node script with no
   TypeScript loader, and the alternative is a build dependency to read one
   string.
   --------------------------------------------------------------------- */
function literal(src, name) {
  // Requires an http(s) URL specifically. Matching any quoted string instead
  // picked up the empty string inside `.replace(/\/+$/, '')` on the
  // PARTNER_API_BASE_URL declaration and silently produced a blank base.
  const m = new RegExp(name + "[\\s\\S]{0,240}?'(https?://[^']+)'").exec(src);
  return m ? m[1] : null;
}

const cfg = readFileSync(CONFIG, 'utf8');
const CANONICAL = literal(cfg, 'PARTNER_API_CANONICAL_BASE');
const CONFIGURED = (process.env.VITE_PARTNER_API_BASE_URL || literal(cfg, 'PARTNER_API_BASE_URL') || '').replace(/\/+$/, '');

if (!CANONICAL || !CONFIGURED) {
  console.error(`REFUSING to write: could not read the base URL from ${CONFIG}.`);
  process.exit(1);
}

/* WHY THERE IS NO LONGER AN ALLOWLIST OF SECTIONS.
   The source used to be PARTNER-API.md, the internal design record, and the
   allowlist was what kept the rest of it out. That was the wrong shape: every
   partner-facing section still carried migration citations, internal function
   names and drafting history, so the allowlist chose WHICH internal document to
   publish rather than whether to publish one.
   The source is now PARTNER-DOCS.md, which is partner-facing in its entirety, so
   every section ships and a new one needs no registration. The refusal rules
   below stay as a backstop against something internal being pasted in. */

/** Anything matching these must never reach a partner. The generator REFUSES to
    write when one survives, rather than stripping the line and shipping the rest:
    a rule that silently deletes content is a rule nobody notices is wrong. */
const INTERNAL = [
  // Repo and infrastructure
  [/DEFECTS\.md|REGRESSION\.md|HANDOVER\.md|PARTNER-API\.md/i, 'internal document reference'],
  [/supabase|postgres|postgrest|vercel|cloudflare|deno|edge function/i, 'hosting or infrastructure detail'],
  [/\bsrc\/|supabase\/|migrations?\//i, 'file path'],
  [/\d{14}_|\.sql\b|index\.ts|\.tsx\b/i, 'migration or source filename'],
  [/:\d{1,4}(?:-\d{1,4})?\)/, 'line citation'],

  // Internal identifiers
  [/\bpublic\.[a-z_]+/i, 'schema-qualified identifier'],
  [/referral_field_errors|create_referral|apply_stripe|partner_api_\w+|activity_log|guarantee_ref_seq/i,
   'internal table or function name'],
  [/\breferencing_mode\b|pre_referenced_\w+|opndoor_referenced/i, 'internal configuration vocabulary'],

  // Internal status values. The partner vocabulary is published; the stored
  // values are ours, and publishing the mapping publishes both.
  [/stored status|internal status|`deed`\s*\||\|\s*`expired`\s*\|/i, 'internal status value or mapping'],

  // Roadmap and drafting history
  [/not yet built|not built yet|does not exist yet|roadmap|needs the .* status|coming soon/i, 'roadmap note'],
  // Narrowed from a bare /previously/, which tripped on ordinary prose
  // ("whatever you previously believed"). The rule is meant to catch the
  // DOCUMENT talking about its own past, not the reader's. A rule that fires on
  // legitimate wording gets loosened by whoever hits it next, so it is better to
  // aim it properly than to leave it broad and be overridden later.
  [/earlier draft|first draft|used to (be|say|read)|an earlier version|was added before|in the original (spec|design)|we previously|this previously/i,
   'drafting history'],

  // Our own weaknesses
  [/replayable|no timestamp|constant.time comparison is not|uses ===/i, 'disclosure of an internal weakness'],

  // Cross-references that do not resolve in the rendered output
  [/\bsee section \d|\bsection \d+(\.\d+)?\b/i, 'numbered cross-reference'],
];

/** The first rule a string trips, or null. */
function tripped(text) {
  for (const [re, label] of INTERNAL) {
    const m = re.exec(text);
    if (m) return { label, sample: m[0] };
  }
  return null;
}

function sanitise(md) {
  return md
    // Configured base URL first, so a partner never reads a host we cannot change.
    .split(CANONICAL).join(CONFIGURED)
    .replace(/<!--[\s\S]*?-->/g, '')                        // maintainer notes never ship
    .replace(/\[([^\]]+)\]\((?!https?:)[^)]+\)/g, '$1')   // keep link text, drop repo paths
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const lines = readFileSync(SPEC, 'utf8').split('\n');
const sections = [];

// Every `##` section, in document order. Sub-headings stay inside their parent
// so the panel's contents list matches the document's own shape.
for (let i = 0; i < lines.length; i++) {
  if (!/^##\s/.test(lines[i])) continue;
  const title = lines[i].replace(/^##\s+/, '').trim();

  let end = lines.length;
  for (let j = i + 1; j < lines.length; j++) {
    if (/^##\s/.test(lines[j])) { end = j; break; }
  }

  const body = sanitise(lines.slice(i + 1, end).join('\n'));
  if (body) sections.push({ id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title, body });
}

if (!sections.length) {
  console.error(`REFUSING to write: no sections found in ${SPEC}.`);
  process.exit(1);
}

// Fail loudly rather than shipping a leak. Checked per section AND on the title,
// and it reports what tripped so the fix is obvious rather than a hunt.
const leaked = [];
for (const s of sections) {
  const hit = tripped(s.body) ?? tripped(s.title);
  if (hit) leaked.push({ title: s.title, ...hit });
}
if (leaked.length) {
  console.error('REFUSING to write. Internal detail survived sanitising:\n');
  for (const l of leaked) {
    console.error(`  section: ${l.title}`);
    console.error(`  problem: ${l.label}`);
    console.error(`  matched: ${JSON.stringify(l.sample)}\n`);
  }
  console.error('Fix it in the source, not by loosening the rule.');
  process.exit(1);
}

console.log(`  base URL: ${CONFIGURED}${CONFIGURED === CANONICAL ? '' : ` (overriding ${CANONICAL})`}`);

/* ---------------------------------------------------------------------
   OpenAPI 3.1, from the same file.

   ONE SOURCE, TWO OUTPUTS. The alternative is a hand-maintained spec beside
   hand-maintained prose, which drifts silently: nobody notices the spec is a
   version behind until a developer imports it and generates a client against
   endpoints that moved. The endpoint list, the request and response shapes and
   the error codes below all come out of PARTNER-DOCS.md, so editing the docs
   and forgetting the spec is not possible for those; only the descriptions can
   fall out of step, and the counts printed on every run make that visible.
   --------------------------------------------------------------------- */
const OPENAPI_OUT = 'public/openapi.json';

function readSourceBlock(raw) {
  const m = /```openapi-source\n([\s\S]*?)```/.exec(raw);
  if (!m) {
    console.error(`REFUSING to write: no openapi-source block in ${SPEC}.`);
    process.exit(1);
  }
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    // A malformed edit fails the build rather than producing a spec that does
    // not open. Discovering that by trying to import it is the worst way.
    console.error(`REFUSING to write: the openapi-source block in ${SPEC} is not valid JSON.`);
    console.error(`  ${e.message}`);
    process.exit(1);
  }
}

const src = readSourceBlock(readFileSync(SPEC, 'utf8'));

/** Shared field shapes, so tenant/property/tenancy are declared once. */
const TENANT = {
  type: 'object',
  required: ['title', 'first_name', 'last_name', 'date_of_birth', 'email', 'phone'],
  properties: {
    title: { type: 'string', enum: ['Mr', 'Mrs', 'Miss', 'Ms', 'Mx', 'Dr'] },
    first_name: { type: 'string', minLength: 1 },
    last_name: { type: 'string', minLength: 1 },
    date_of_birth: { type: 'string', format: 'date', description: 'Must be in the past, and 18 by the tenancy start date.' },
    email: { type: 'string', format: 'email' },
    phone: { type: 'string', description: 'Must contain at least one digit.' },
  },
};

const PROPERTY = {
  type: 'object',
  required: ['address_line_1', 'city', 'postcode'],
  properties: {
    address_line_1: { type: 'string', minLength: 1 },
    address_line_2: { type: ['string', 'null'] },
    city: { type: 'string', minLength: 1 },
    county: { type: ['string', 'null'] },
    postcode: { type: 'string', description: 'UK format.' },
  },
};

const TENANCY = {
  type: 'object',
  required: ['monthly_rent', 'start_date'],
  properties: {
    monthly_rent: { type: 'number', exclusiveMinimum: 0 },
    start_date: { type: 'string', format: 'date' },
  },
};

const STATUS = {
  type: 'string',
  enum: ['sent', 'paid', 'deed_issued', 'lapsed', 'withdrawn'],
  description: 'lapsed means an unpaid application closed automatically 15 days after it was sent. It is not the guarantee expiring.',
};

/* $refs rather than inlined copies. Inlining validated, but every consumer that
   generates a client would emit an anonymous type per occurrence: three
   different unnamed shapes for the same tenant. Referencing gives them one
   `Tenant`, and it is also what silences no-unused-components honestly, by
   actually using the component rather than deleting it. */
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

const APPLICATION = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    guarantee_ref: { type: 'string', description: 'Sandbox references are prefixed GR-TEST-.' },
    status: STATUS,
    created_at: { type: 'string', format: 'date-time' },
    sent_at: { type: ['string', 'null'], format: 'date-time' },
    paid_at: { type: ['string', 'null'], format: 'date-time' },
    deed_issued_at: { type: ['string', 'null'], format: 'date-time' },
    expiry_date: { type: ['string', 'null'], format: 'date', description: "The guarantee's own expiry, twelve months after the tenancy start." },
    tenant: ref('Tenant'),
    property: ref('Property'),
    tenancy: ref('Tenancy'),
    org: {
      type: 'object',
      properties: {
        agency_id: { type: 'string', format: 'uuid' },
        agency_name: { type: 'string' },
        branch_id: { type: 'string', format: 'uuid' },
        branch_name: { type: 'string' },
      },
    },
  },
};

const FIELD_ERROR = {
  type: 'object',
  properties: {
    field: { type: 'string', example: 'tenant.email' },
    code: { type: 'string', example: 'invalid_format' },
    message: { type: 'string', description: 'Written for humans and may change. Match on field and code.' },
  },
};

const ERROR = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        // Named `fields`, not `errors`. Getting this wrong means a partner
        // parses undefined on every validation failure.
        fields: { type: 'array', items: ref('FieldError') },
      },
    },
  },
};

const ERROR_CODES = [
  [400, 'malformed_request', 'Not valid JSON, or a missing idempotency key'],
  [401, 'unauthorized', 'Any authentication failure. Always identical'],
  [403, 'insufficient_scope', 'The key lacks the required scope'],
  [403, 'partner_inactive', 'The account is not active'],
  [404, 'not_found', 'Unknown, or not yours'],
  [404, 'unsupported_version', 'No API version in the path, or one not supported'],
  [409, 'idempotency_key_reused', 'Same key, different body'],
  [409, 'request_in_progress', 'Same key, still processing'],
  [422, 'validation_failed', 'Field errors, listed in fields'],
  [429, 'rate_limited', 'Too many requests. Retry-After says when'],
  [500, 'internal_error', 'Something went wrong our end'],
  [503, 'service_unavailable', 'Temporarily unavailable, safe to retry'],
];

function errorResponses(codes) {
  const out = {};
  for (const [status, code, desc] of codes) {
    // One entry per STATUS; two codes can share a status, so the description
    // lists both rather than one silently overwriting the other.
    const key = String(status);
    out[key] = out[key]
      ? { ...out[key], description: `${out[key].description}; ${code}: ${desc}` }
      : { description: `${code}: ${desc}`, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
  }
  return out;
}

const WEBHOOK_EVENTS = [
  ['application.created', 'An application is created and accepted'],
  ['application.paid', 'The guarantor fee is paid'],
  ['application.deed_issued', 'The Deed of Guarantee is executed'],
  ['application.lapsed', 'An unpaid application closes automatically'],
  ['application.withdrawn', 'An application is withdrawn before payment'],
  ['application.reinstated', 'A lapsed or declined application is paid late. Sent INSTEAD OF application.paid, not in addition'],
];

const RATE_HEADERS = {
  'X-RateLimit-Limit': { schema: { type: 'integer' }, description: 'Requests allowed per window for this key.' },
  'X-RateLimit-Remaining': { schema: { type: 'integer' }, description: 'Requests left in the current window.' },
  'X-RateLimit-Reset': { schema: { type: 'integer' }, description: 'Unix timestamp when the window resets.' },
  'X-Request-Id': { schema: { type: 'string' }, description: 'Quote this to support.' },
};

const paths = {};
for (const [route, ops] of Object.entries(src.paths)) {
  paths[route] = {};
  for (const [method, op] of Object.entries(ops)) {
    const parameters = [];
    if (op.pathParam) {
      parameters.push({ name: op.pathParam, in: 'path', required: true, schema: { type: 'string', format: 'uuid' } });
    }
    for (const q of op.query ?? []) {
      parameters.push({
        name: q, in: 'query', required: false,
        schema: q === 'limit' ? { type: 'integer', minimum: 1, maximum: 100, default: 50 }
              : q === 'status' ? STATUS
              : { type: 'string' },
      });
    }
    if (op.idempotent) {
      parameters.push({
        name: 'Idempotency-Key', in: 'header', required: true,
        schema: { type: 'string' },
        description: 'Unique to the application on your side. The same key with the same body replays the first response.',
      });
    }

    paths[route][method] = {
      summary: op.summary,
      description: op.description,
      operationId: `${method}${route.replace(/[^a-zA-Z]+/g, '_')}`.replace(/_$/, ''),
      security: [{ bearerAuth: [] }],
      ...(op.scope ? { 'x-required-scope': op.scope } : {}),
      ...(parameters.length ? { parameters } : {}),
      ...(op.requestSchema
        ? { requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${op.requestSchema}` } } } } }
        : {}),
      responses: {
        [op.created ? '201' : '200']: {
          description: op.created ? 'Created' : 'OK',
          headers: RATE_HEADERS,
          content: { 'application/json': { schema: ref(op.responseSchema) } },
        },
        ...errorResponses(ERROR_CODES),
      },
    };
  }
}

const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'Opndoor Partner API',
    version: 'v1',
    contact: { name: 'opndoor support', url: 'https://opndoor.co' },
    // NO license block, deliberately, and this is worth the comment because the
    // obvious "fix" breaks the spec. Redocly warns (info-license-strict) that one
    // is missing. Adding `{ name: 'Proprietary' }` silences that warning and
    // makes the document INVALID: OpenAPI 3.1 requires a license object to carry
    // an SPDX `identifier` or a `url`, and this API has neither. A second
    // validator caught it; Redocly did not.
    //
    // A style warning is not worth a schema violation. Leave it absent.
    description:
      'Create guarantee applications from your own system and receive webhooks as they progress. '
      + 'Organisations must already exist: create them in the opndoor portal, then send names or ids. '
      + 'The API key prefix decides the mode: opnd_test_ creates sandbox applications, opnd_live_ creates real ones.',
  },
  servers: src.servers.map((sv) => ({ ...sv, url: sv.url === CANONICAL ? CONFIGURED : sv.url })),
  security: [{ bearerAuth: [] }],
  paths,
  webhooks: Object.fromEntries(WEBHOOK_EVENTS.map(([name, desc]) => ([
    name,
    {
      post: {
        // operationId, so a generated client gets a named handler per event
        // rather than six functions called `post`.
        operationId: `on${name.split('.').map((w) => w[0].toUpperCase() + w.slice(1)).join('')}`,
        summary: desc,
        description:
          'Signed with HMAC-SHA256 over "<t>.<raw body>" using your endpoint secret, sent as '
          + 'X-Opndoor-Signature: t=<unix>,v1=<hex>. Verify against the RAW body before parsing. '
          + 'Respond 2xx to accept; anything else is retried. Dedupe on X-Opndoor-Event-Id.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/WebhookEvent' } } },
        },
        responses: { '200': { description: 'Accepted. Any 2xx is treated as delivered.' } },
      },
    },
  ]))),
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http', scheme: 'bearer',
        description: 'Your API key. Shown once when created and not retrievable afterwards.',
      },
    },
    schemas: {
      Tenant: TENANT,
      Property: PROPERTY,
      Tenancy: TENANCY,
      Application: APPLICATION,
      Error: ERROR,
      FieldError: FIELD_ERROR,
      OrgList: {
        type: 'object',
        properties: {
          agencies: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                name: { type: 'string' },
                has_agent_contact: { type: 'boolean' },
                branches: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      name: { type: 'string' },
                      has_agent_contact: {
                        type: 'boolean',
                        description: 'False means no deed could be issued for this branch. Do not send applications against it.',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      CreateApplication: {
        type: 'object',
        required: ['tenant', 'property', 'tenancy', 'org', 'referrer'],
        properties: {
          tenant: ref('Tenant'),
          property: ref('Property'),
          tenancy: ref('Tenancy'),
          org: {
            type: 'object',
            description: 'Send NAMES or our IDS, never a mix. Names are matched ignoring case, surrounding whitespace and a trailing Ltd or Limited.',
            oneOf: [
              { type: 'object', required: ['agency_name'], properties: { agency_name: { type: 'string' }, branch_name: { type: 'string' } } },
              { type: 'object', required: ['agency_id', 'branch_id'], properties: { agency_id: { type: 'string', format: 'uuid' }, branch_id: { type: 'string', format: 'uuid' } } },
            ],
          },
          referrer: {
            type: 'object', required: ['email'],
            properties: { email: { type: 'string', format: 'email' } },
          },
        },
      },
      CreateApplicationResponse: {
        type: 'object',
        properties: {
          application: ref('Application'),
          payment_url: { type: ['string', 'null'], description: 'Give this to the tenant. Present while the application is payable.' },
        },
      },
      ApplicationList: {
        type: 'object',
        properties: {
          applications: { type: 'array', items: ref('Application') },
          next_cursor: {
            type: ['string', 'null'],
            description: 'Null on the last page. This is the signal to stop; there is no has_more field.',
          },
        },
      },
      WebhookEvent: {
        type: 'object',
        properties: {
          event_type: { type: 'string', enum: WEBHOOK_EVENTS.map(([n]) => n) },
          livemode: { type: 'boolean', description: 'False for sandbox. Branch on this if one handler serves both.' },
          application: ref('Application'),
        },
      },
    },
  },
};

writeFileSync(OPENAPI_OUT, JSON.stringify(openapi, null, 2) + '\n');
console.log(`  wrote ${OPENAPI_OUT}: ${Object.keys(paths).length} paths, `
  + `${Object.keys(openapi.components.schemas).length} schemas, `
  + `${Object.keys(openapi.webhooks).length} webhook events`);

writeFileSync(OUT, `/* GENERATED FILE. Do not edit.
   Source: ${SPEC}
   Regenerate: node scripts/generate-partner-docs.mjs

   The source is partner-facing in its entirety. The internal design record is a
   different document and is deliberately NOT the source: importing it raw would
   ship the whole internal specification to every browser, and filtering at
   render time filters what renders, not what ships. */
export interface DocSection { id: string; title: string; body: string }

export const PARTNER_DOCS: DocSection[] = ${JSON.stringify(sections, null, 2)};
`);

console.log(`  wrote ${OUT}: ${sections.length} sections, ${sections.reduce((n, s) => n + s.body.length, 0)} chars`);
