import { Module } from '@nestjs/common';
import { AddressesController } from './addresses.controller';
import { AddressesService } from './addresses.service';

// PrismaModule is @Global(), so PrismaService is injectable without importing
// anything here.
@Module({
  controllers: [AddressesController],
  providers: [AddressesService],
  // Exported so the Stripe webhook can save a booking's address into the
  // customer's address book once payment succeeds.
  exports: [AddressesService],
})
export class AddressesModule {}
