import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { auth } from './auth/auth';
import { SetPasswordController } from './auth/set-password.controller';
import { AccountModule } from './account/account.module';
import { AddressesModule } from './addresses/addresses.module';
import { AdminModule } from './admin/admin.module';
import { AgentModule } from './agent/agent.module';
import { BookingModule } from './booking/booking.module';
import { EmployeesModule } from './employees/employees.module';
import { PlansModule } from './plans/plans.module';
import { PricingSettingsModule } from './pricing-settings/pricing-settings.module';
import { PaymentMethodsModule } from './payment-methods/payment-methods.module';
import { PayoutModule } from './payout/payout.module';
import { ProfileModule } from './profile/profile.module';
import { PromoModule } from './promo/promo.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { ServicesModule } from './services/services.module';
import { SettingsModule } from './settings/settings.module';
import { AppConfigModule } from './config/config.module';
import { AppConfigService } from './config/config.service';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    SentryModule.forRoot(),
    AppConfigModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        throttlers: [{ ttl: config.throttleTtl, limit: config.throttleLimit }],
      }),
    }),
    PrismaModule,
    HealthModule,
    BookingModule,
    PlansModule,
    PricingSettingsModule,
    PaymentMethodsModule,
    AddressesModule,
    AccountModule,
    AgentModule,
    AdminModule,
    PayoutModule,
    ProfileModule,
    PromoModule,
    EmployeesModule,
    ServicesModule,
    SettingsModule,
    SchedulerModule,
    AuthModule.forRoot({
      auth,
      // Capture the exact raw request buffer on `req.rawBody` (via body-parser's
      // verify hook) so the Stripe webhook can verify signatures. JSON parsing
      // still runs for every other route's @Body() DTOs.
      bodyParser: { rawBody: true },
    }),
  ],
  controllers: [AppController, SetPasswordController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
