import { Module } from '@nestjs/common';
import { AdminPromoController } from './admin-promo.controller';
import { PromoController } from './promo.controller';
import { PromoService } from './promo.service';

// Exports PromoService so BookingService can recompute the discount server-side
// on POST /bookings. PrismaModule is @Global().
@Module({
  controllers: [PromoController, AdminPromoController],
  providers: [PromoService],
  exports: [PromoService],
})
export class PromoModule {}
