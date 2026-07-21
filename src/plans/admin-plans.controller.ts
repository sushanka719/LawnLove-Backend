import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Roles } from '@thallesp/nestjs-better-auth';
import { PlansService } from './plans.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

// Admin plan management. The whole controller is @Roles(['admin']); the global
// AuthGuard 401s the unauthenticated and this 403s non-admins (mirrors
// AdminController). Lists include inactive plans.
@Roles(['admin'])
@Controller('admin/plans')
export class AdminPlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  list() {
    return this.plans.listAll();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.plans.getById(id);
  }

  @Post()
  create(@Body() dto: CreatePlanDto) {
    return this.plans.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.plans.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.plans.remove(id);
  }
}
