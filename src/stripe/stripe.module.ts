import { Module } from '@nestjs/common';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { StripeService } from './stripe.service';
import { StripeWebhookController } from './webhook.controller';

// Imports SchedulerModule so the webhook can trigger first-visit assignment the
// moment a booking is paid (event-driven — no waiting on the cron).
@Module({
  imports: [SchedulerModule],
  controllers: [StripeWebhookController],
  providers: [StripeService],
  exports: [StripeService],
})
export class StripeModule {}
