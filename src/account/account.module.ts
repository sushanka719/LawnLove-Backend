import { Module } from '@nestjs/common';
import { StripeModule } from '../stripe/stripe.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';

// Account settings for the signed-in customer: notification preferences and
// account deletion (soft delete + daily purge cron). PrismaModule is global;
// StripeModule is imported so the purge can cancel subscriptions before a
// permanent delete.
@Module({
  imports: [StripeModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
