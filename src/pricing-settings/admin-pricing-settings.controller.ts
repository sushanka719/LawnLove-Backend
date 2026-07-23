import { Body, Controller, Get, Put } from '@nestjs/common';
import { Roles } from '@thallesp/nestjs-better-auth';
import { PricingSettingsService } from './pricing-settings.service';
import { UpdatePricingSettingsDto } from './dto/update-pricing-settings.dto';

// Admin editor for the single global pricing config (area surcharge ladder +
// maximum serviceable area). The whole controller is @Roles(['admin']); the
// global AuthGuard 401s the unauthenticated and this 403s non-admins.
@Roles(['admin'])
@Controller('admin/pricing-settings')
export class AdminPricingSettingsController {
  constructor(private readonly settings: PricingSettingsService) {}

  @Get()
  get() {
    return this.settings.getConfig();
  }

  // Full replace of the config (max area + entire tier ladder).
  @Put()
  update(@Body() dto: UpdatePricingSettingsDto) {
    return this.settings.update(dto);
  }
}
