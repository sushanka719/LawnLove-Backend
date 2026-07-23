import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { SchedulerCron } from './scheduler.cron';

// Exports SchedulerService so the Stripe webhook (StripeModule) can trigger
// event-driven first-visit assignment. PrismaModule is @Global(), so
// PrismaService needs no explicit import here.
@Module({
  providers: [SchedulerService, SchedulerCron],
  exports: [SchedulerService],
})
export class SchedulerModule {}
