import { Module } from '@nestjs/common';
import { StripeModule } from '../stripe/stripe.module';
import { StorageModule } from '../storage/storage.module';
import { PayoutModule } from '../payout/payout.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { SettingsModule } from '../settings/settings.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    StripeModule,
    StorageModule,
    PayoutModule,
    SchedulerModule,
    SettingsModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
