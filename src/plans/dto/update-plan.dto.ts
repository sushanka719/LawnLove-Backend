import { PartialType } from '@nestjs/swagger';
import { CreatePlanDto } from './create-plan.dto';

// All fields optional; omitted fields are left untouched (see PlansService.update).
// Area surcharge tiers are now global — managed via /admin/pricing-settings, not here.
export class UpdatePlanDto extends PartialType(CreatePlanDto) {}
