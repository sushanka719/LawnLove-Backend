import { Module } from '@nestjs/common';
import { PricingSettingsController } from './pricing-settings.controller';
import { AdminPricingSettingsController } from './admin-pricing-settings.controller';
import { PricingSettingsService } from './pricing-settings.service';

@Module({
  controllers: [PricingSettingsController, AdminPricingSettingsController],
  providers: [PricingSettingsService],
  exports: [PricingSettingsService],
})
export class PricingSettingsModule {}
