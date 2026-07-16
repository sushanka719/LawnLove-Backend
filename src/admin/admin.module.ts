import { Module } from '@nestjs/common';
import { StripeModule } from '../stripe/stripe.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [StripeModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
