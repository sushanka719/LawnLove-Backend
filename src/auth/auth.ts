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

const USERNAME_REGEX = /^[a-zA-Z0-9_.]+$/;

function normalizeUsername(rawUsername: string) {
  const displayUsername = rawUsername;
  const normalized = rawUsername.toLowerCase();
  if (
    normalized.length < 3 ||
    normalized.length > 30 ||
    !USERNAME_REGEX.test(normalized)
  ) {
    throw new APIError('UNPROCESSABLE_ENTITY', {
      message: 'Invalid username',
    });
  }
  return { username: normalized, displayUsername };
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
      if (ctx.path !== '/sign-in/magic-link') return;
      const body = ctx.body as {
        email: string;
        metadata?: { username?: string };
      };
      const requestedUsername = body.metadata?.username;
      if (!requestedUsername) return;
      const normalized = normalizeUsername(requestedUsername);
      await ctx.context.internalAdapter.createVerificationValue({
        identifier: pendingUsernameIdentifier(body.email),
        value: JSON.stringify(normalized),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });
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
