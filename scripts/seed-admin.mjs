// Seed the initial admin account.
//
// Because `role` gating is enforced by @Roles(['admin']) but the only endpoint
// that promotes a user is itself admin-only, the first admin has to be created
// out-of-band. This script does that safely: it creates the user through
// better-auth's own sign-up API (so the password is hashed exactly the way the
// login flow expects) and then flips the row's `role` to `admin`.
//
// Idempotent: if the email already exists, it just promotes that user to admin.
//
// Usage (from the LawnBackend directory):
//   pnpm build                       # dist/ must exist (this imports the compiled auth)
//   SEED_ADMIN_EMAIL=you@example.com \
//   SEED_ADMIN_PASSWORD='S3cret!pass' \
//   SEED_ADMIN_NAME='Jane Admin' \
//   pnpm seed:admin
//
// or pass them as CLI args (args win over env vars):
//   pnpm seed:admin you@example.com 'S3cret!pass' 'Jane Admin'

import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load LawnBackend/.env BEFORE importing the auth module — the auth graph reads
// process.env at construction time (DATABASE_URL, BETTER_AUTH_SECRET) and the
// mail service instantiates Resend on import, which throws without its key.
config({ path: resolve(__dirname, "..", ".env") });

// Mirrors the app's password rule (better-auth only enforces length on sign-up,
// so we apply the full complexity check here to match the rest of the app).
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/;

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

const [, , argEmail, argPassword, argName] = process.argv;
const email = (argEmail ?? process.env.SEED_ADMIN_EMAIL ?? "").trim();
const password = argPassword ?? process.env.SEED_ADMIN_PASSWORD ?? "";
const name = (argName ?? process.env.SEED_ADMIN_NAME ?? "Admin").trim();

if (!email || !password) {
  fail(
    "Missing credentials. Provide SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD " +
      "(env vars or CLI args). Example:\n" +
      "  SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='S3cret!pass' pnpm seed:admin",
  );
}
if (password.length < 8 || password.length > 64) {
  fail("Password must be 8-64 characters.");
}
if (!PASSWORD_REGEX.test(password)) {
  fail(
    "Password must include an uppercase letter, a lowercase letter, a number, and a special character.",
  );
}
if (!process.env.DATABASE_URL) {
  fail("DATABASE_URL is not set (checked LawnBackend/.env).");
}

const distAuth = resolve(__dirname, "..", "dist", "src", "auth", "auth.js");
if (!existsSync(distAuth)) {
  fail("dist/src/auth/auth.js not found — run `pnpm build` first, then re-run.");
}

async function promoteToAdmin(client) {
  const { rows } = await client.query(
    `UPDATE "user" SET role = 'admin', "updatedAt" = now() WHERE email = $1
     RETURNING id, email, role`,
    [email],
  );
  return rows[0];
}

async function main() {
  const { auth } = await import(distAuth);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const existing = await client.query(
      `SELECT id, role FROM "user" WHERE email = $1`,
      [email],
    );

    if (existing.rowCount > 0) {
      const updated = await promoteToAdmin(client);
      console.log(
        `\n✔ User already existed — promoted to admin:\n  ${updated.email}  (role=${updated.role})\n`,
      );
      return;
    }

    // Create through better-auth so the credential/password hash is valid for
    // the normal email+password login flow.
    await auth.api.signUpEmail({ body: { email, password, name } });

    const updated = await promoteToAdmin(client);
    console.log(
      `\n✔ Admin account created:\n  ${updated.email}  (role=${updated.role})\n` +
        `  Sign in at the frontend /login with this email + password.\n`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // better-auth surfaces validation/conflict errors with a `.message`.
  const message =
    err?.body?.message || err?.message || String(err) || "Unknown error";
  fail(`Seed failed: ${message}`);
});
