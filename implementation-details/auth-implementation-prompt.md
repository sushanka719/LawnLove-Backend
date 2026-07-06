Implement the auth flow for LawnBackend (NestJS + better-auth 1.6.23 + @thallesp/nestjs-better-auth + Prisma/Postgres).

Current state: `LawnBackend/src/auth/auth.ts` only has `emailAndPassword: { enabled: true }`. `LawnBackend/prisma/schema.prisma` has the stock better-auth User/Session/Account/Verification models, no `username` field yet.

## Required flow

**Signup (magic link, no password at signup):**
1. User submits username + email on a signup form.
2. Backend calls `auth.api.signInMagicLink` (better-auth's `magic-link` plugin) with `{ email, name, metadata: { username } }`. Note: the plugin's request body does NOT have a native `username` field — pass it via `metadata` and pull it back out in a `databaseHooks.user.create.before` hook so the created user record gets `username` set at creation time (the plugin's internal `createUser` call only sets `email`, `emailVerified: true`, `name` — username must be injected via this hook, not assumed to pass through automatically).
3. Email is sent via **Resend**. Implement `sendMagicLink` in the `magicLink` plugin config using Resend's SDK (add `resend` package, read `RESEND_API_KEY` from env). Check the repo first for any existing mail-sending module/service to avoid duplicating one; if a mailer service already exists, use it instead of adding Resend directly if that's cleaner. Otherwise add a small `MailService`/util.
4. User clicks the link → hits `GET /magic-link/verify` → better-auth verifies the token, creates the user if new, sets `emailVerified: true`, and **automatically creates a session + sets the session cookie**. This is native behavior — do not try to prevent auto-login here.
5. Set `newUserCallbackURL` (first-time signup) and `callbackURL` (returning user, e.g. a login-via-magic-link case if you support that later) separately in the `signInMagicLink` call so verify can tell new vs. existing users apart and redirect accordingly.
6. `newUserCallbackURL` points to a frontend "Set Password" page. That page loads with an active session (from step 4). It calls better-auth's `setPassword` server action (NOT `changePassword` — `setPassword` is for accounts with no existing password, which fits here since the user signed up via magic link with no password ever set).
7. **After `setPassword` succeeds, explicitly sign the user out** (revoke/clear the session — `auth.api.signOut` or equivalent) and redirect to the login screen. This is an intentional product decision: even though the user technically has a valid session at this point, we force them to land on `/login` and authenticate for real with email + password. Do not skip this step or leave them auto-logged-in past the set-password page.
8. Login screen: user enters email + password → `signIn.email` → normal better-auth login.

**OAuth (Google):**
9. Add the `google` social provider to the `betterAuth()` config (`socialProviders: { google: { clientId, clientSecret } }`), reading `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` from env.
10. `signIn.social({ provider: 'google' })` handles both signup and login in one call — better-auth auto-creates the User + Account on first use, logs in if the Account already exists. No separate "OAuth signup" step, no password, no OTP/magic-link needed for OAuth users.
11. Decide and implement the account-linking policy: if a Google login's email matches an existing email/password (or magic-link) account, should it auto-link into the same User record? Better-auth supports this via `account.accountLinking` (off by default) with a `trustedProviders` allowlist. Default to enabling linking with `trustedProviders: ['google']` unless told otherwise, and flag this decision clearly in the PR/summary since it has security implications (an unverified email on another provider could hijack an account if misconfigured — Google's emails are provider-verified so this is the safe end of the spectrum).

**Forgot / reset password (native `emailAndPassword` flow, no extra plugin):**
12. `POST /request-password-reset` (client: `authClient.requestPasswordReset({ email, redirectTo })`). Looks up user by email; if not found, still returns `{ status: true }` with a generic message (deliberate timing-attack mitigation — do not change this to reveal whether an email exists). If found, creates a `Verification` row (`reset-password:<token>`, default 1h expiry, configurable via `emailAndPassword.resetPasswordTokenExpiresIn`) and calls your `emailAndPassword.sendResetPassword({ user, url, token }, request)` — **this function must be added to `auth.ts` or the endpoint throws `RESET_PASSWORD_DISABLED`**. Send it via Resend, same as the magic-link email. `url` is `${baseURL}/reset-password/<token>?callbackURL=<redirectTo>`, where `redirectTo` should be your frontend's "enter new password" page.
13. `GET /reset-password/:token` is a redirect helper, not the actual UI page: validates the token exists/not expired, then redirects to your `redirectTo` with `?token=<token>` appended (or `?error=INVALID_TOKEN` if invalid/expired).
14. `POST /reset-password` (client: `authClient.resetPassword({ newPassword, token })`). Validates password length, consumes the token (single use). If the user has no `credential` account yet (e.g. magic-link-only or OAuth-only user), it **creates one** with the new password instead of requiring an existing password row — same underlying pattern as `setPassword` in the signup flow, so "forgot password" doubles as "set my first password" for anyone who never completed the set-password step. If a credential account exists, it updates it instead.
15. Set `emailAndPassword.revokeSessionsOnPasswordReset: true` — kills all existing sessions for that user on reset. Recommended given the forced-re-login posture already decided for the signup flow. Optionally implement `emailAndPassword.onPasswordReset({ user })` for post-reset side effects (e.g. notification email).
16. **Decided: force re-login after reset, consistent with the signup flow.** Note this requires no extra sign-out step — unlike magic-link verify, neither `GET /reset-password/:token` nor `POST /reset-password` ever creates a session or sets a cookie, so the user is never auto-logged-in after a reset. The only session-hygiene concern is a *pre-existing* session from before the reset was requested (e.g. an old/compromised session) — `revokeSessionsOnPasswordReset: true` from step 15 kills that. So the frontend flow is simply: reset succeeds → redirect to `/login` → user authenticates with the new password. Do not build a "reset creates a session" assumption into the frontend; it doesn't.

Add to `auth.ts`:
```ts
emailAndPassword: {
  enabled: true,
  sendResetPassword: async ({ user, url, token }, request) => {
    // send via Resend
  },
  revokeSessionsOnPasswordReset: true,
},
```

## Schema changes needed

- Add `username` (unique) field to the Prisma `User` model in `LawnBackend/prisma/schema.prisma`.
- Register the `username` plugin in `auth.ts` (`username()` from `better-auth/plugins`) so sign-in-by-username and uniqueness validation work.
- Run/generate the appropriate Prisma migration after schema changes (check how migrations are run in this repo — look for existing migration scripts/commands before assuming `prisma migrate dev`).

## Plugins to add to `auth.ts`

```ts
import { magicLink, username } from 'better-auth/plugins';
```
- `magicLink({ sendMagicLink, disableSignUp: false })`
- `username()`
- keep existing `emailAndPassword: { enabled: true }` (needed for the final login step and for `setPassword`/`signIn.email` to work)
- `socialProviders: { google: { clientId, clientSecret } }`
- `account: { accountLinking: { enabled: true, trustedProviders: ['google'] } }`

## Env vars to add (check `.env.example` / existing env handling conventions in the repo first)

- `RESEND_API_KEY`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- Confirm `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are already set (they're referenced in `auth.ts` already).

## What to verify when done

- New signup: username+email → magic link email arrives (via Resend) → clicking it lands on a working session → set-password page can call `setPassword` successfully → user is signed out and redirected to `/login` → logging in with email+password works and the username was actually persisted on the User record.
- Existing user requesting another magic link (e.g. passwordless login attempt) doesn't get treated as a "new user" — no incorrect username overwrite, correct redirect target used.
- Google OAuth: fresh Google login creates a new User+Account; a second Google login with the same Google account logs into the same User; a Google login with an email that already has a password account links correctly per the `trustedProviders` policy above (or explicitly document if you chose not to enable linking).
- Confirm NestJS routes/guards (via `@thallesp/nestjs-better-auth`) correctly expose whatever custom endpoints (set-password page's backend call, sign-out) are needed — check how the existing module wires better-auth into Nest before adding new custom controllers.
- Forgot-password: requesting a reset for a non-existent email returns the same generic response as for an existing one; the reset link redirects correctly to the frontend page with `?token=`; submitting a new password works both for a user who already has a password (normal reset) and for a magic-link-only user with no `credential` account yet (first-password-via-reset case); all other sessions for that user are revoked after reset.
