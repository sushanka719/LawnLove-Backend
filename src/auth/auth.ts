import { PrismaPg } from '@prisma/adapter-pg';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { admin, bearer, magicLink, username } from 'better-auth/plugins';
import {
  sendAgentInviteEmail,
  sendMagicLinkEmail,
  sendResetPasswordEmail,
} from '../mail/mail.service';
import { PrismaClient } from '../../generated/prisma/client';
import {
  collapseSpaces,
  EMAIL_MAX,
  EMAIL_MESSAGE,
  EMAIL_REGEX,
  FULL_NAME_MAX,
  FULL_NAME_MESSAGE,
  FULL_NAME_MIN,
  NAME_MAX,
  NAME_MESSAGE,
  NAME_MIN,
  NAME_REGEX,
  PASSWORD_MAX,
  PASSWORD_MESSAGE,
  PASSWORD_MIN,
  PASSWORD_REGEX,
  PHONE_MESSAGE,
  PHONE_REGEX,
  stripPhoneSeparators,
  USERNAME_MAX,
  USERNAME_MESSAGE,
  USERNAME_MIN,
  USERNAME_REGEX,
} from './validation.constants';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// The cross-subdomain / SameSite=None / Secure cookie config below only works
// for the deployed gettola.app subdomains over HTTPS. Locally the frontend
// (localhost:3000) and backend (localhost:4000) share the `localhost` site
// (ports don't affect SameSite) over plain HTTP, so applying it makes the
// browser drop cookies: `Domain=.gettola.app` doesn't match `localhost`, so the
// OAuth `state` cookie is discarded and the callback fails with `state_mismatch`.
// Gate on NODE_ENV (read from the raw environment here because this module is
// constructed before Nest's ConfigService is available). Defaults to the local
// config when unset, so production must explicitly set NODE_ENV=production.
const isProduction = process.env.NODE_ENV === 'production';

// The magic-link plugin's stored verification token only carries
// `email`/`name` through to `/magic-link/verify` — `metadata` never
// survives past the initial `signInMagicLink` call. We stash the
// requested username here, keyed by email, so the `user.create.before`
// hook below can pick it up when the user row is actually created.
// The `username()` plugin's own create.before hook (which normalizes and
// validates) runs before this one, so it never sees a `username` field on
// magic-link signups — we replicate its default normalization/validation
// here so a username injected this way is still well-formed.
const pendingUsernameIdentifier = (email: string) =>
  `magic-link-username:${email}`;

// Same "pending value keyed by email" trick, for admin agent invites. The
// admin invite endpoint writes this row (value = JSON({businessName})) before
// triggering the magic link; its mere existence signals "make this user an
// agent." The sendMagicLink callback reads it to pick the invite email body,
// and user.create.before consumes it to set role:'agent' when the link is
// clicked. See src/admin/admin.service.ts inviteAgent().
export const pendingAgentInviteIdentifier = (email: string) =>
  `agent-invite:${email}`;

type PendingAgentInvite = { businessName?: string };

async function readPendingAgentInvite(
  email: string,
): Promise<{ id: string; businessName?: string } | null> {
  const pending = await prisma.verification.findFirst({
    where: { identifier: pendingAgentInviteIdentifier(email) },
  });
  if (!pending) return null;
  const { businessName } = JSON.parse(pending.value) as PendingAgentInvite;
  return { id: pending.id, businessName };
}

function normalizeUsername(rawUsername: string) {
  const displayUsername = rawUsername;
  const normalized = rawUsername.toLowerCase();
  if (
    normalized.length < USERNAME_MIN ||
    normalized.length > USERNAME_MAX ||
    !USERNAME_REGEX.test(normalized) ||
    normalized.includes('..') ||
    normalized.includes('__')
  ) {
    throw new APIError('UNPROCESSABLE_ENTITY', {
      message: USERNAME_MESSAGE,
    });
  }
  return { username: normalized, displayUsername };
}

function validateName(rawName: unknown) {
  if (typeof rawName !== 'string') {
    throw new APIError('UNPROCESSABLE_ENTITY', { message: NAME_MESSAGE });
  }
  const name = collapseSpaces(rawName);
  if (
    name.length < NAME_MIN ||
    name.length > NAME_MAX ||
    !NAME_REGEX.test(name)
  ) {
    throw new APIError('UNPROCESSABLE_ENTITY', { message: NAME_MESSAGE });
  }
  return name;
}

// Profile "Full Name" — stricter 3-char minimum than the auth `name` above.
// Returns the collapsed value so the caller can persist the normalized form.
function validateFullName(rawName: unknown) {
  if (typeof rawName !== 'string') {
    throw new APIError('UNPROCESSABLE_ENTITY', { message: FULL_NAME_MESSAGE });
  }
  const name = collapseSpaces(rawName);
  if (
    name.length < FULL_NAME_MIN ||
    name.length > FULL_NAME_MAX ||
    !NAME_REGEX.test(name)
  ) {
    throw new APIError('UNPROCESSABLE_ENTITY', { message: FULL_NAME_MESSAGE });
  }
  return name;
}

// Profile "Phone Number". An empty value clears the number; otherwise it must be
// 10-15 digits with an optional leading `+`. Returns the normalized value
// (separators stripped, or null when cleared) for persistence.
function validatePhoneNumber(rawPhone: unknown) {
  if (typeof rawPhone !== 'string') {
    throw new APIError('UNPROCESSABLE_ENTITY', { message: PHONE_MESSAGE });
  }
  const phone = stripPhoneSeparators(rawPhone.trim());
  if (phone === '') return null;
  if (!PHONE_REGEX.test(phone)) {
    throw new APIError('UNPROCESSABLE_ENTITY', { message: PHONE_MESSAGE });
  }
  return phone;
}

function validateEmail(rawEmail: unknown) {
  if (typeof rawEmail !== 'string') {
    throw new APIError('UNPROCESSABLE_ENTITY', { message: EMAIL_MESSAGE });
  }
  const email = rawEmail.trim();
  if (
    email.length > EMAIL_MAX ||
    email.includes(' ') ||
    email.includes('..') ||
    !EMAIL_REGEX.test(email)
  ) {
    throw new APIError('UNPROCESSABLE_ENTITY', { message: EMAIL_MESSAGE });
  }
  return email;
}

function validatePassword(rawPassword: unknown) {
  if (typeof rawPassword !== 'string') {
    throw new APIError('UNPROCESSABLE_ENTITY', { message: PASSWORD_MESSAGE });
  }
  const password = rawPassword.trim();
  if (
    password.length < PASSWORD_MIN ||
    password.length > PASSWORD_MAX ||
    !PASSWORD_REGEX.test(password)
  ) {
    throw new APIError('UNPROCESSABLE_ENTITY', { message: PASSWORD_MESSAGE });
  }
  return password;
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  // The frontend runs on a different origin in dev, so its callbackURL /
  // redirectTo values (magic-link, social sign-in, password reset) need to
  // be explicitly trusted here — otherwise better-auth's origin check
  // rejects them with INVALID_CALLBACK_URL / INVALID_REDIRECT_URL.
  trustedOrigins: process.env.CORS_ORIGIN?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  // SameSite=Lax (the default) drops cookies set during the initial
  // cross-site fetch to /sign-in/social, which breaks the OAuth state-cookie
  // check on callback (`state_mismatch`) and would equally break the session
  // cookie for any cross-site fetch-based auth call.
  //
  // Backend (railway.app) and frontend (gettola.app) are on different
  // registrable domains, not shared subdomains — crossSubDomainCookies can't
  // apply here (the browser rejects a Domain=.gettola.app cookie set by a
  // railway.app response), so the cookie stays host-only on the backend's
  // domain. SameSite=None still lets it round-trip on cross-site requests.
  advanced: isProduction
    ? {
        defaultCookieAttributes: {
          sameSite: 'none',
          secure: true,
        },
      }
    : {
        // localhost is same-site across ports and served over HTTP, so a
        // host-only Lax cookie is both sufficient and required to work.
        defaultCookieAttributes: {
          sameSite: 'lax',
          secure: false,
        },
      },
  // better-auth's default is 3 requests / 10s on auth-sensitive paths, which
  // is too strict for real usage (page reloads, OAuth redirect round-trips,
  // multiple people testing behind the same NAT'd IP). Loosen it here while
  // still meaningfully rate-limiting brute-force attempts.
  rateLimit: {
    customRules: {
      '/sign-in/*': { window: 60, max: 20 },
      '/sign-up': { window: 60, max: 20 },
      '/callback/*': { window: 60, max: 20 },
      '/change-password': { window: 60, max: 20 },
      '/change-email': { window: 60, max: 20 },
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: PASSWORD_MIN,
    maxPasswordLength: PASSWORD_MAX,
    sendResetPassword: async ({ user, url }) => {
      await sendResetPasswordEmail(user.email, url);
    },
    revokeSessionsOnPasswordReset: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['google'],
    },
  },
  user: {
    additionalFields: {
      // Surfaced on the session and accepted by `/update-user` (validated in
      // the before-hook below). Maps to the `phoneNumber` column on the User
      // model. `input: true` lets the profile form set it via update-user.
      phoneNumber: {
        type: 'string',
        required: false,
        input: true,
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/sign-in/magic-link') {
        const body = ctx.body as {
          email: string;
          name?: string;
          metadata?: { username?: string };
        };
        validateEmail(body.email);
        if (body.name !== undefined) validateName(body.name);
        // This endpoint is only ever used by the signup form in this app
        // (login uses email+password) — so an email that already has a
        // password credential means the visitor already has an account.
        // Without this check, the magic-link verify step silently logs
        // them into that existing account instead of signaling "you
        // already have an account, sign in instead."
        const existingCredential = await prisma.account.findFirst({
          where: {
            providerId: 'credential',
            password: { not: null },
            user: { email: body.email },
          },
        });
        if (existingCredential) {
          throw new APIError('CONFLICT', {
            message:
              'An account with this email already exists. Please sign in instead.',
          });
        }
        const requestedUsername = body.metadata?.username;
        if (!requestedUsername) return;
        const normalized = normalizeUsername(requestedUsername);
        await ctx.context.internalAdapter.createVerificationValue({
          identifier: pendingUsernameIdentifier(body.email),
          value: JSON.stringify(normalized),
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        });
        return;
      }
      if (ctx.path === '/reset-password') {
        const body = ctx.body as { newPassword: string };
        validatePassword(body.newPassword);
      }
      // Profile updates from the dashboard. `/update-user` doesn't run our
      // field-format rules on its own, so validate + normalize here and write
      // the cleaned values back onto the body the handler will persist. Only
      // the keys actually present are touched (partial updates are allowed).
      if (ctx.path === '/update-user') {
        const body = ctx.body as {
          name?: unknown;
          phoneNumber?: unknown;
        };
        if (body.name !== undefined) {
          body.name = validateFullName(body.name);
        }
        if (body.phoneNumber !== undefined) {
          body.phoneNumber = validatePhoneNumber(body.phoneNumber);
        }
      }
    }),
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          // Both pending-value rows (username from customer signup, role from
          // an agent invite) are keyed by email and consumed here on the one
          // create that follows the magic-link click. Merge whatever applies.
          const data: Record<string, unknown> = { ...user };
          let changed = false;

          const pendingUsername = await prisma.verification.findFirst({
            where: { identifier: pendingUsernameIdentifier(user.email) },
          });
          if (pendingUsername) {
            await prisma.verification.delete({
              where: { id: pendingUsername.id },
            });
            const { username: normalizedUsername, displayUsername } =
              JSON.parse(pendingUsername.value) as {
                username: string;
                displayUsername: string;
              };
            data.username = normalizedUsername;
            data.displayUsername = displayUsername;
            changed = true;
          }

          const pendingInvite = await readPendingAgentInvite(user.email);
          if (pendingInvite) {
            await prisma.verification.delete({
              where: { id: pendingInvite.id },
            });
            data.role = 'agent';
            // Business name is stored as the user's name (no dedicated column);
            // the agent can edit it later in their profile.
            if (pendingInvite.businessName) {
              data.name = pendingInvite.businessName;
            }
            changed = true;
          }

          if (!changed) return;
          return { data };
        },
      },
    },
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        // Agent invites reuse the magic-link flow but need their own email
        // body (and greeting). A pending agent-invite row, written by the
        // admin invite endpoint, is the signal to send that instead.
        const invite = await readPendingAgentInvite(email);
        if (invite) {
          await sendAgentInviteEmail(email, url, invite.businessName);
          return;
        }
        await sendMagicLinkEmail(email, url);
      },
      disableSignUp: false,
    }),
    username(),
    // Adds `user.role` (default "user") and exposes it on the session so
    // nestjs-better-auth's @Roles(['agent'|'admin']) guard can gate routes.
    // The role/banned/banExpires/impersonatedBy columns it needs are in the
    // Prisma schema (migration add_roles_and_connect).
    admin(),
    // Lets non-browser clients (the mobile app) authenticate without cookies.
    // On sign-in better-auth returns the session token in a `set-auth-token`
    // response header; the client stores it and sends it back as
    // `Authorization: Bearer <token>` on subsequent requests, which this plugin
    // converts into the same session the cookie flow uses. The web frontend is
    // unaffected — it keeps using cookies (see the `advanced` cookie config
    // above). The token is the opaque DB session token (schema.prisma `session`
    // table), so `expiresAt` and instant server-side revocation still apply.
    bearer(),
  ],
});
