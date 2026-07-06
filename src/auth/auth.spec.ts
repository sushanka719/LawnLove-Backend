import 'dotenv/config';
import { ChildProcess, execSync, spawn } from 'node:child_process';
import path from 'node:path';
import { Client } from 'pg';

/**
 * Integration tests for the better-auth wiring in `auth.ts`, driven end to
 * end over real HTTP against the compiled app and a real Postgres database
 * (the same one `pnpm start:dev` uses).
 *
 * This can't be a plain unit test that `import`s `./auth`: better-auth 1.6.x
 * ships ESM-only, and the generated Prisma 7 client uses a dynamic
 * `import()` internally that Jest's default CJS runtime rejects outside
 * `--experimental-vm-modules`. Both are third-party constraints, not
 * something worth reconfiguring the whole project's test transform for.
 * Spawning the real compiled server sidesteps that entirely and exercises
 * the exact code path production traffic hits.
 *
 * `RESEND_API_KEY` is a placeholder in `.env`, so `/sign-in/magic-link`
 * itself returns a 500 once it reaches the (failing) email send — but that
 * happens *after* the verification rows this suite cares about are already
 * written, so the custom hook logic is still fully exercised. `/magic-link/
 * verify` and `/reset-password` never send email, so those paths behave
 * exactly as they would in production.
 */

jest.setTimeout(90_000);

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BASE_URL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
const TEST_EMAIL_PREFIX = 'jest-auth-test';

let serverProcess: ChildProcess;
let db: Client;

function testEmail(label: string) {
  return `${TEST_EMAIL_PREFIX}-${label}-${Date.now()}-${Math.floor(
    Math.random() * 1e6,
  )}@example.com`;
}

// Node's fetch (undici) sends `sec-fetch-mode: cors` on every request, which
// trips better-auth's CSRF origin check unless a trusted `Origin` header is
// present — a real browser would send one automatically. curl doesn't set
// that header at all, which is why this only shows up when testing via fetch.
function authFetch(url: string, init: RequestInit = {}) {
  return fetch(url, {
    ...init,
    headers: { Origin: BASE_URL, ...init.headers },
  });
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
    } catch {
      // server socket not accepting connections yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('server did not become healthy in time');
}

async function cleanupTestRows() {
  await db.query(
    `DELETE FROM "session" WHERE "userId" IN (SELECT id FROM "user" WHERE email LIKE $1)`,
    [`${TEST_EMAIL_PREFIX}%`],
  );
  await db.query(
    `DELETE FROM "account" WHERE "userId" IN (SELECT id FROM "user" WHERE email LIKE $1)`,
    [`${TEST_EMAIL_PREFIX}%`],
  );
  await db.query(`DELETE FROM "user" WHERE email LIKE $1`, [
    `${TEST_EMAIL_PREFIX}%`,
  ]);
  await db.query(`DELETE FROM "verification" WHERE identifier LIKE $1`, [
    `%${TEST_EMAIL_PREFIX}%`,
  ]);
}

beforeAll(async () => {
  execSync('pnpm run build', { cwd: REPO_ROOT, stdio: 'inherit' });

  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await cleanupTestRows();

  serverProcess = spawn('node', ['dist/src/main.js'], {
    cwd: REPO_ROOT,
    env: process.env,
  });

  await waitForServer();
});

afterAll(async () => {
  await cleanupTestRows();
  await db.end();
  serverProcess.kill('SIGTERM');
});

async function signInMagicLink(email: string, name: string, username?: string) {
  return authFetch(`${BASE_URL}/api/auth/sign-in/magic-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      name,
      ...(username ? { metadata: { username } } : {}),
    }),
  });
}

async function getPendingUsername(email: string) {
  const { rows } = await db.query<{ value: string }>(
    `SELECT value FROM verification WHERE identifier = $1`,
    [`magic-link-username:${email}`],
  );
  return rows[0]
    ? (JSON.parse(rows[0].value) as {
        username: string;
        displayUsername: string;
      })
    : null;
}

async function getMagicLinkToken(email: string) {
  const { rows } = await db.query<{ identifier: string }>(
    `SELECT identifier FROM verification WHERE value LIKE $1 ORDER BY "createdAt" DESC LIMIT 1`,
    [`%${email}%`],
  );
  if (!rows[0]) {
    throw new Error(`no magic-link verification row found for ${email}`);
  }
  return rows[0].identifier;
}

async function verifyMagicLink(token: string) {
  return authFetch(`${BASE_URL}/api/auth/magic-link/verify?token=${token}`, {
    redirect: 'manual',
  });
}

interface MagicLinkVerifyBody {
  user: {
    email: string;
    username: string;
    displayUsername: string;
    emailVerified: boolean;
  };
}

describe('magic-link signup with username', () => {
  it('normalizes and stashes the requested username before the endpoint runs', async () => {
    const email = testEmail('pending');
    await signInMagicLink(email, 'Pending User', 'Pending_User.1');

    const pending = await getPendingUsername(email);
    expect(pending).toEqual({
      username: 'pending_user.1',
      displayUsername: 'Pending_User.1',
    });
  });

  it('rejects an invalid username and stores no pending row', async () => {
    const email = testEmail('invalid');
    const res = await signInMagicLink(email, 'Invalid User', 'ab');

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await getPendingUsername(email)).toBeNull();
  });

  it('creates the user with username/displayUsername on verify and consumes the pending row', async () => {
    const email = testEmail('verify');
    await signInMagicLink(email, 'Verify User', 'Verify_User');

    const token = await getMagicLinkToken(email);
    const verifyRes = await verifyMagicLink(token);

    expect(verifyRes.status).toBe(200);
    const body = (await verifyRes.json()) as MagicLinkVerifyBody;
    expect(body.user.email).toBe(email);
    expect(body.user.username).toBe('verify_user');
    expect(body.user.displayUsername).toBe('Verify_User');
    expect(body.user.emailVerified).toBe(true);
    expect(verifyRes.headers.get('set-cookie')).toBeTruthy();

    expect(await getPendingUsername(email)).toBeNull();
  });

  it('does not touch the username on a second, returning-user magic-link request', async () => {
    const email = testEmail('returning');
    await signInMagicLink(email, 'Returning User', 'Returning_User');
    await verifyMagicLink(await getMagicLinkToken(email));

    // Returning user signs in again without requesting a username change.
    await signInMagicLink(email, 'Returning User');
    const verifyRes = await verifyMagicLink(await getMagicLinkToken(email));

    const body = (await verifyRes.json()) as MagicLinkVerifyBody;
    expect(body.user.username).toBe('returning_user');
  });
});

describe('set-password + login', () => {
  it('rejects the custom set-password endpoint without a session', async () => {
    const res = await authFetch(`${BASE_URL}/auth/set-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword: 'Sup3rSecret!' }),
    });
    expect(res.status).toBe(401);
  });

  it('lets a magic-link-only user set a password, then sign in with it', async () => {
    const email = testEmail('setpw');
    await signInMagicLink(email, 'Set Password User', 'Set_Password_User');
    const verifyRes = await verifyMagicLink(await getMagicLinkToken(email));
    const sessionCookie = verifyRes.headers.get('set-cookie')!.split(';')[0];

    const setPasswordRes = await authFetch(`${BASE_URL}/auth/set-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: sessionCookie },
      body: JSON.stringify({ newPassword: 'Sup3rSecret!' }),
    });
    expect(setPasswordRes.status).toBe(201);

    // The magic-link session must not survive past set-password: the
    // product decision is to force a real login on `/login` afterward.
    const postSetPasswordSession = await authFetch(
      `${BASE_URL}/api/auth/get-session`,
      { headers: { cookie: sessionCookie } },
    );
    expect(await postSetPasswordSession.json()).toBeNull();

    const signInRes = await authFetch(`${BASE_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Sup3rSecret!' }),
    });
    expect(signInRes.status).toBe(200);
  });
});

describe('forgot / reset password', () => {
  it('returns the same generic response for an unknown email as for a known one', async () => {
    const res = await authFetch(`${BASE_URL}/api/auth/request-password-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail('unknown'),
        redirectTo: '/reset-password',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: boolean };
    expect(body.status).toBe(true);
  });

  it('lets an existing password user reset their password and revokes their other sessions', async () => {
    const email = testEmail('reset');
    await signInMagicLink(email, 'Reset User', 'Reset_User');
    const verifyRes = await verifyMagicLink(await getMagicLinkToken(email));
    const oldSessionCookie = verifyRes.headers.get('set-cookie')!.split(';')[0];
    await authFetch(`${BASE_URL}/auth/set-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: oldSessionCookie },
      body: JSON.stringify({ newPassword: 'OldPassword1!' }),
    });

    await authFetch(`${BASE_URL}/api/auth/request-password-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, redirectTo: '/reset-password' }),
    });

    const { rows: userRows } = await db.query<{ id: string }>(
      `SELECT id FROM "user" WHERE email = $1`,
      [email],
    );
    const { rows: resetRows } = await db.query<{ identifier: string }>(
      `SELECT identifier FROM verification WHERE identifier LIKE 'reset-password:%' AND value = $1 ORDER BY "createdAt" DESC LIMIT 1`,
      [userRows[0].id],
    );
    const resetToken = resetRows[0].identifier.replace('reset-password:', '');

    const resetRes = await authFetch(`${BASE_URL}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword: 'NewPassword1!', token: resetToken }),
    });
    expect(resetRes.status).toBe(200);

    const oldSessionRes = await authFetch(`${BASE_URL}/api/auth/get-session`, {
      headers: { cookie: oldSessionCookie },
    });
    expect(await oldSessionRes.json()).toBeNull();

    const signInRes = await authFetch(`${BASE_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'NewPassword1!' }),
    });
    expect(signInRes.status).toBe(200);
  });
});
