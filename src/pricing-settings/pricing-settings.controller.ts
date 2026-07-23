import { Controller, Get } from '@nestjs/common';
import { Public } from '@thallesp/nestjs-better-auth';
import { PricingSettingsService } from './pricing-settings.service';

// Public pricing config consumed by the booking flow to show the area surcharge
// and the maximum serviceable area. Admin edits live in the admin controller.
@Controller('pricing-settings')
export class PricingSettingsController {
  constructor(private readonly settings: PricingSettingsService) {}

  @Public()
  @Get()
  get() {
    return this.settings.getConfig();
  }
}
