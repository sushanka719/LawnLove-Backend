import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AreaTierDto } from './dto/area-tier.dto';
import type { UpdatePricingSettingsDto } from './dto/update-pricing-settings.dto';

// The pricing config is a singleton — one shared row for the whole business.
const SINGLETON_ID = 'singleton';

type TierRow = { minSqFt: number; maxSqFt: number | null; surcharge: number };

@Injectable()
export class PricingSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Reads ---------------------------------------------------------------

  // The global config (max area + tier ladder). Created on first read if the
  // singleton row is somehow missing, so callers never have to handle null.
  async getConfig() {
    const config = await this.ensureConfig();
    return this.serialize(config);
  }

  // Shape the booking flow needs to compute a quote: the shared tier ladder and
  // the maximum serviceable area. Kept separate from getConfig() so the pricing
  // logic depends only on the fields it uses.
  async getConfigForQuote(): Promise<{
    maxAreaSqFt: number | null;
    areaTiers: TierRow[];
  }> {
    const config = await this.ensureConfig();
    return {
      maxAreaSqFt: config.maxAreaSqFt,
      areaTiers: this.sortTiers(config.areaTiers),
    };
  }

  // ---- Writes --------------------------------------------------------------

  // Replace the whole config: max area + the entire tier ladder (PUT semantics).
  async update(dto: UpdatePricingSettingsDto) {
    const tiers = dto.areaTiers ?? [];
    this.assertValidTiers(tiers);

    const maxAreaSqFt = dto.maxAreaSqFt ?? null;
    this.assertMaxAreaCoversTiers(maxAreaSqFt, tiers);

    const config = await this.prisma.$transaction(async (tx) => {
      // Upsert keeps the singleton present even on a pristine database.
      await tx.pricingConfig.upsert({
        where: { id: SINGLETON_ID },
        create: { id: SINGLETON_ID, maxAreaSqFt },
        update: { maxAreaSqFt },
      });
      await tx.areaTier.deleteMany({ where: { configId: SINGLETON_ID } });
      if (tiers.length > 0) {
        await tx.areaTier.createMany({
          data: tiers.map((t) => ({
            configId: SINGLETON_ID,
            minSqFt: t.minSqFt,
            maxSqFt: t.maxSqFt ?? null,
            surcharge: t.surcharge,
          })),
        });
      }
      return tx.pricingConfig.findUniqueOrThrow({
        where: { id: SINGLETON_ID },
        include: { areaTiers: true },
      });
    });

    return this.serialize(config);
  }

  // ---- Helpers -------------------------------------------------------------

  private async ensureConfig() {
    const existing = await this.prisma.pricingConfig.findUnique({
      where: { id: SINGLETON_ID },
      include: { areaTiers: true },
    });
    if (existing) return existing;
    return this.prisma.pricingConfig.create({
      data: { id: SINGLETON_ID },
      include: { areaTiers: true },
    });
  }

  private sortTiers(tiers: TierRow[]): TierRow[] {
    return [...tiers]
      .sort((a, b) => a.minSqFt - b.minSqFt)
      .map((t) => ({
        minSqFt: t.minSqFt,
        maxSqFt: t.maxSqFt,
        surcharge: t.surcharge,
      }));
  }

  // Tiers must be non-overlapping ascending brackets; only the top bracket may
  // omit maxSqFt (the open-ended upper tier). Mirrors the frontend's guidance.
  private assertValidTiers(tiers: AreaTierDto[]) {
    if (tiers.length === 0) return;

    const sorted = [...tiers].sort((a, b) => a.minSqFt - b.minSqFt);

    for (let i = 0; i < sorted.length; i++) {
      const tier = sorted[i];
      const isLast = i === sorted.length - 1;

      if (tier.maxSqFt != null && tier.maxSqFt <= tier.minSqFt) {
        throw new BadRequestException(
          `Area tier maxSqFt (${tier.maxSqFt}) must be greater than minSqFt (${tier.minSqFt}).`,
        );
      }
      if (tier.maxSqFt == null && !isLast) {
        throw new BadRequestException(
          'Only the top area tier may omit maxSqFt.',
        );
      }
      if (!isLast) {
        const next = sorted[i + 1];
        // Previous bracket must close before the next opens (no overlap).
        if (tier.maxSqFt == null || next.minSqFt < tier.maxSqFt) {
          throw new BadRequestException(
            'Area tiers must not overlap and must be listed in ascending order.',
          );
        }
      }
    }
  }

  // A maximum below the tier ladder would silently reject lawns the tiers were
  // built to price. Require it to sit at or above the highest bracket boundary.
  private assertMaxAreaCoversTiers(
    maxAreaSqFt: number | null,
    tiers: AreaTierDto[],
  ) {
    if (maxAreaSqFt == null || tiers.length === 0) return;
    const highestBoundary = Math.max(
      ...tiers.map((t) => t.maxSqFt ?? t.minSqFt),
    );
    if (maxAreaSqFt < highestBoundary) {
      throw new BadRequestException(
        `Maximum serviceable area (${maxAreaSqFt}) must be at least the top tier boundary (${highestBoundary}).`,
      );
    }
  }

  private serialize(config: {
    id: string;
    maxAreaSqFt: number | null;
    updatedAt: Date;
    areaTiers: {
      id: string;
      minSqFt: number;
      maxSqFt: number | null;
      surcharge: number;
    }[];
  }) {
    return {
      maxAreaSqFt: config.maxAreaSqFt,
      updatedAt: config.updatedAt,
      areaTiers: [...config.areaTiers]
        .sort((a, b) => a.minSqFt - b.minSqFt)
        .map((t) => ({
          id: t.id,
          minSqFt: t.minSqFt,
          maxSqFt: t.maxSqFt,
          surcharge: t.surcharge,
        })),
    };
  }
}
