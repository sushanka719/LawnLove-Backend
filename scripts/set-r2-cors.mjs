// Apply/merge a CORS policy on the R2 bucket so the browser can upload directly
// via presigned PUT URLs (avatars, job photos). R2 has no CORS by default,
// which blocks the preflight for cross-origin PUT/GET from the app.
//
// Run from LawnBackend/ with the environment's R2_* + CORS_ORIGIN vars loaded:
//   dev:  node --env-file=.env                  scripts/set-r2-cors.mjs
//   prod: node --env-file=.env.production.local  scripts/set-r2-cors.mjs
//
// Future-proof + safe to run in any environment: it MERGES the current env's
// origins into whatever is already configured (PutBucketCors replaces the whole
// policy, so a naive per-env run would clobber the other env's origin). Requires
// an R2 API token with **Admin Read & Write** (object-only tokens get 403 on
// bucket-config operations).
import {
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const {
  NODE_ENV,
  R2_ENDPOINT,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  CORS_ORIGIN,
} = process.env;

for (const [name, value] of Object.entries({
  R2_ENDPOINT,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
})) {
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
}

// Origins from this environment's CORS_ORIGIN (comma-separated). localhost:3000
// is added only outside production so local uploads work out of the box without
// leaking a dev origin into a prod-only policy.
const envOrigins = (CORS_ORIGIN ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
if (NODE_ENV !== 'production') envOrigins.push('http://localhost:3000');

if (envOrigins.length === 0) {
  console.error(
    'No origins to configure — set CORS_ORIGIN (or run outside production for the localhost fallback).',
  );
  process.exit(1);
}

const client = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

// Read whatever origins are already allowed so we never drop another
// environment's origin (the bucket may be shared dev/prod).
let existingOrigins = [];
try {
  const current = await client.send(
    new GetBucketCorsCommand({ Bucket: R2_BUCKET }),
  );
  existingOrigins = (current.CORSRules ?? []).flatMap(
    (rule) => rule.AllowedOrigins ?? [],
  );
} catch (err) {
  // First-time setup: no CORS config yet. Any other error is fatal.
  if (err?.name !== 'NoSuchCORSConfiguration') {
    console.error(`Could not read existing CORS config: ${err?.name ?? err}`);
    if (err?.$metadata?.httpStatusCode === 403) {
      console.error(
        'Got 403 — the R2 token needs Admin Read & Write to manage bucket CORS.',
      );
    }
    process.exit(1);
  }
}

const origins = [...new Set([...existingOrigins, ...envOrigins])].sort();

await client.send(
  new PutBucketCorsCommand({
    Bucket: R2_BUCKET,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: origins,
          // PUT for uploads; GET/HEAD so JS-based reads work too.
          AllowedMethods: ['GET', 'PUT', 'HEAD'],
          // The browser sets Content-Type on the PUT; `*` also covers any
          // x-amz-* headers the SDK may add.
          AllowedHeaders: ['*'],
          ExposeHeaders: ['ETag'],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }),
);

console.log(`Applied CORS to bucket "${R2_BUCKET}" — allowed origins:`);
for (const o of origins) console.log(`  - ${o}`);
