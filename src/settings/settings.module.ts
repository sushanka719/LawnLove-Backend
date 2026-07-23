import { Module } from '@nestjs/common';
import { AdminSettingsController } from './admin-settings.controller';
import { SettingsService } from './settings.service';

// Exports SettingsService so other modules (e.g. admin stats) can read the
// effective platform-fee percentage. PrismaModule + AppConfigModule are global.
@Module({
  controllers: [AdminSettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
