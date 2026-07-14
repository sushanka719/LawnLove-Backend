import { Module } from '@nestjs/common';
import { StripeModule } from '../stripe/stripe.module';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';

@Module({
  imports: [StripeModule],
  controllers: [BookingController],
  providers: [BookingService],
})
export class BookingModule {}
