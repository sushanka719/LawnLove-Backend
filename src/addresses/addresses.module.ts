import { Module } from '@nestjs/common';
import { AddressesController } from './addresses.controller';
import { AddressesService } from './addresses.service';

// PrismaModule is @Global(), so PrismaService is injectable without importing
// anything here.
@Module({
  controllers: [AddressesController],
  providers: [AddressesService],
})
export class AddressesModule {}
