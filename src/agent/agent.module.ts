import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { StripeModule } from '../stripe/stripe.module';
import { ConnectController } from './connect.controller';
import { ConnectService } from './connect.service';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

// Agent-facing module (role=agent): Stripe Connect onboarding + job workflow
// (start → photos → complete → escrow charge).
@Module({
  imports: [StripeModule, StorageModule],
  controllers: [ConnectController, JobsController],
  providers: [ConnectService, JobsService],
})
export class AgentModule {}
