import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { StripeModule } from '../stripe/stripe.module';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { ConnectController } from './connect.controller';
import { ConnectService } from './connect.service';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

// Agent-facing module (role=agent): Stripe Connect onboarding + job workflow
// (start → photos → complete) + dashboard read endpoints (schedule/stats/
// bookings/earnings).
@Module({
  imports: [StripeModule, StorageModule],
  controllers: [ConnectController, JobsController, AgentController],
  providers: [ConnectService, JobsService, AgentService],
})
export class AgentModule {}
