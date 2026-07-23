import { Module } from '@nestjs/common';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';

// PrismaModule is @Global(), so PrismaService is injectable without importing it.
@Module({
  controllers: [ServicesController],
  providers: [ServicesService],
})
export class ServicesModule {}
