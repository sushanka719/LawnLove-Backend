import { Controller, Get } from '@nestjs/common';
import { Public } from '@thallesp/nestjs-better-auth';
import { PlansService } from './plans.service';

// Public catalogue consumed by the booking flow (/booking/schedule). Only active
// plans, ordered by sortOrder. Admin CRUD lives in AdminPlansController.
@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Public()
  @Get()
  listActive() {
    return this.plans.listActive();
  }
}
