import { Module } from '@nestjs/common';
import { StripeModule } from '../stripe/stripe.module';
import { PayoutCron } from './payout.cron';
import { PayoutService } from './payout.service';

// Exports PayoutService so the customer "approve" endpoint and the cron share
// the same release logic.
@Module({
  imports: [StripeModule],
  providers: [PayoutService, PayoutCron],
  exports: [PayoutService],
})
export class PayoutModule {}
