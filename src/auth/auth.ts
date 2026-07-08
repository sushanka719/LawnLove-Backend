import { PrismaPg } from '@prisma/adapter-pg';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { magicLink, username } from 'better-auth/plugins';
import {
  sendMagicLinkEmail,
  sendResetPasswordEmail,
} from '../mail/mail.service';
import { PrismaClient } from '../../generated/prisma/client';
import {
  collapseSpaces,
  EMAIL_MAX,
  EMAIL_MESSAGE,
  EMAIL_REGEX,
  NAME_MAX,
  NAME_MESSAGE,
  NAME_MIN,
  NAME_REGEX,
  PASSWORD_MAX,
  PASSWORD_MESSAGE,
  PASSWORD_MIN,
  PASSWORD_REGEX,
  USERNAME_MAX,
  USERNAME_MESSAGE,
  USERNAME_MIN,
  USERNAME_REGEX,
} from './validation.constants';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

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
  // Frontend (vercel.app) and backend (gettola.app) are cross-site, not just
  // cross-origin subdomains. SameSite=Lax (the default) drops cookies set
  // during the initial cross-site fetch to /sign-in/social, which breaks the
  // OAuth state-cookie check on callback (`state_mismatch`) and would equally
  // break the session cookie for any cross-site fetch-based auth call.
  advanced: {
    defaultCookieAttributes: {
      sameSite: 'none',
      secure: true,
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
    }),
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const pending = await prisma.verification.findFirst({
            where: { identifier: pendingUsernameIdentifier(user.email) },
          });
          if (!pending) return;
          await prisma.verification.delete({ where: { id: pending.id } });
          const { username: normalizedUsername, displayUsername } = JSON.parse(
            pending.value,
          ) as {
            username: string;
            displayUsername: string;
          };
          return {
            data: { ...user, username: normalizedUsername, displayUsername },
          };
        },
      },
    },
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendMagicLinkEmail(email, url);
      },
      disableSignUp: false,
    }),
    username(),
  ],
});
