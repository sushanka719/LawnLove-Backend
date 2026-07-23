import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/config.service';
import type { UpdateSettingsDto } from './dto/update-settings.dto';

// Global platform settings, a singleton row (mirrors PricingConfig). The
// platform-fee percentage lives here once configured and overrides the
// PLATFORM_FEE_PCT env default; on first creation it is seeded from that env so
// existing behavior is preserved until an admin edits it.
const SINGLETON_ID = 'singleton';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async getSettings() {
    const s = await this.ensureSettings();
    return this.serialize(s);
  }

  async update(dto: UpdateSettingsDto) {
    await this.ensureSettings();
    const s = await this.prisma.appSettings.update({
      where: { id: SINGLETON_ID },
      data: {
        ...(dto.platformName !== undefined && { platformName: dto.platformName }),
        ...(dto.supportEmail !== undefined && { supportEmail: dto.supportEmail }),
        ...(dto.platformFeePct !== undefined && {
          platformFeePct: dto.platformFeePct,
        }),
        ...(dto.payoutsEnabled !== undefined && {
          payoutsEnabled: dto.payoutsEnabled,
        }),
        ...(dto.payoutSchedule !== undefined && {
          payoutSchedule: dto.payoutSchedule,
        }),
      },
    });
    return this.serialize(s);
  }

  // The effective commission fraction other services should charge — the
  // admin-editable value, falling back to the env default if unset.
  async getEffectiveFeePct(): Promise<number> {
    const s = await this.ensureSettings();
    return s.platformFeePct;
  }

  private async ensureSettings() {
    const existing = await this.prisma.appSettings.findUnique({
      where: { id: SINGLETON_ID },
    });
    if (existing) return existing;
    return this.prisma.appSettings.create({
      data: { id: SINGLETON_ID, platformFeePct: this.config.platformFeePct },
    });
  }

  private serialize(s: {
    platformName: string;
    supportEmail: string | null;
    platformFeePct: number;
    payoutsEnabled: boolean;
    payoutSchedule: string;
    updatedAt: Date;
  }) {
    return {
      platformName: s.platformName,
      supportEmail: s.supportEmail,
      platformFeePct: s.platformFeePct,
      payoutsEnabled: s.payoutsEnabled,
      payoutSchedule: s.payoutSchedule,
      updatedAt: s.updatedAt,
    };
  }
}
