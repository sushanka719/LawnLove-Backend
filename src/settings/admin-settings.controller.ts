import { Body, Controller, Get, Put } from '@nestjs/common';
import { Roles } from '@thallesp/nestjs-better-auth';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

// Admin platform settings (role=admin). Singleton — GET reads, PUT updates.
@Roles(['admin'])
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.getSettings();
  }

  @Put()
  update(@Body() dto: UpdateSettingsDto) {
    return this.settings.update(dto);
  }
}
