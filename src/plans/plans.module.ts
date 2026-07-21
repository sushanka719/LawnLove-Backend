import { Module } from '@nestjs/common';
import { PlansController } from './plans.controller';
import { AdminPlansController } from './admin-plans.controller';
import { PlansService } from './plans.service';

@Module({
  controllers: [PlansController, AdminPlansController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
