import { PartialType } from '@nestjs/swagger';
import { CreatePlanDto } from './create-plan.dto';

// All fields optional. When `areaTiers` is provided it fully REPLACES the plan's
// existing tiers; omit it to leave them untouched (see PlansService.update).
export class UpdatePlanDto extends PartialType(CreatePlanDto) {}
