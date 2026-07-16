import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.string().url(),
  CORS_ORIGIN: z.string().optional(),
  SENTRY_DSN: z.string().url().optional(),
  THROTTLE_TTL: z.coerce.number().int().positive().default(60000),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
  RESEND_API_KEY: z.string(),
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),
  STRIPE_SECRET_KEY: z.string(),
  // Frontend base URL — used for Stripe Connect onboarding return/refresh links
  // and email deep-links.
  APP_URL: z.string().url().default('http://localhost:3000'),
  // Platform's cut of each job payout (0..1). Defaults to 20%.
  PLATFORM_FEE_PCT: z.coerce.number().min(0).max(1).default(0.2),
  // Cloudflare R2 (S3-compatible). Optional so the app boots before R2 is
  // configured; the storage service errors clearly if used while unset.
  R2_ENDPOINT: z.string().url().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  // Public base URL for the R2 bucket (r2.dev dev URL or a custom domain), used
  // to build directly-viewable URLs for profile avatars. Optional so the app
  // boots before it's set; the avatar upload endpoint errors clearly if unset.
  R2_PUBLIC_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}
