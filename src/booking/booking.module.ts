import { Module } from '@nestjs/common';
import { PayoutModule } from '../payout/payout.module';
import { PricingSettingsModule } from '../pricing-settings/pricing-settings.module';
import { PromoModule } from '../promo/promo.module';
import { StorageModule } from '../storage/storage.module';
import { StripeModule } from '../stripe/stripe.module';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { BookingJobsController } from './booking-jobs.controller';
import { BookingJobsService } from './booking-jobs.service';

@Module({
  imports: [
    StripeModule,
    StorageModule,
    PayoutModule,
    PricingSettingsModule,
    PromoModule,
  ],
  // BookingJobsController MUST come first: its concrete `bookings/jobs` routes
  // have to be registered before BookingController's `bookings/:id`, or `:id`
  // would swallow `/bookings/jobs` (matching id="jobs").
  controllers: [BookingJobsController, BookingController],
  providers: [BookingService, BookingJobsService],
})
export class BookingModule {}
