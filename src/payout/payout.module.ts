import { Module } from '@nestjs/common';
import { StripeModule } from '../stripe/stripe.module';
import { PayoutService } from './payout.service';

// Exports PayoutService so the customer "approve" endpoint (legacy escrow
// bookings) and the admin per-visit "mark paid" action share the same service.
// The escrow auto-release cron was removed with the prepaid migration — prepaid
// bookings never enter `in_review`, so there is nothing for it to sweep.
@Module({
  imports: [StripeModule],
  providers: [PayoutService],
  exports: [PayoutService],
})
export class PayoutModule {}
