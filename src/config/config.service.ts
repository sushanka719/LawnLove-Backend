import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from './env.validation';

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService<Env, true>) {}

  get nodeEnv() {
    return this.configService.get('NODE_ENV', { infer: true });
  }

  get port() {
    return this.configService.get('PORT', { infer: true });
  }

  get databaseUrl() {
    return this.configService.get('DATABASE_URL', { infer: true });
  }

  get corsOrigin(): string[] | boolean {
    const raw = this.configService.get('CORS_ORIGIN', { infer: true });
    if (!raw) return true;
    return raw.split(',').map((origin) => origin.trim());
  }

  get sentryDsn() {
    return this.configService.get('SENTRY_DSN', { infer: true });
  }

  get throttleTtl() {
    return this.configService.get('THROTTLE_TTL', { infer: true });
  }

  get throttleLimit() {
    return this.configService.get('THROTTLE_LIMIT', { infer: true });
  }

  get resendApiKey() {
    return this.configService.get('RESEND_API_KEY', { infer: true });
  }

  get googleClientId() {
    return this.configService.get('GOOGLE_CLIENT_ID', { infer: true });
  }

  get googleClientSecret() {
    return this.configService.get('GOOGLE_CLIENT_SECRET', { infer: true });
  }

  get stripeSecretKey() {
    return this.configService.get('STRIPE_SECRET_KEY', { infer: true });
  }

  get appUrl() {
    return this.configService.get('APP_URL', { infer: true });
  }

  get platformFeePct() {
    return this.configService.get('PLATFORM_FEE_PCT', { infer: true });
  }

  get r2Endpoint() {
    return this.configService.get('R2_ENDPOINT', { infer: true });
  }

  get r2AccessKeyId() {
    return this.configService.get('R2_ACCESS_KEY_ID', { infer: true });
  }

  get r2SecretAccessKey() {
    return this.configService.get('R2_SECRET_ACCESS_KEY', { infer: true });
  }

  get r2Bucket() {
    return this.configService.get('R2_BUCKET', { infer: true });
  }

  get isProduction() {
    return this.nodeEnv === 'production';
  }
}
