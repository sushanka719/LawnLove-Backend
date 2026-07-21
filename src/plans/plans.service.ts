import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreatePlanDto } from './dto/create-plan.dto';
import type { UpdatePlanDto } from './dto/update-plan.dto';
import type { AreaTierDto } from './dto/area-tier.dto';

// Loaded plan shape (plan + its area tiers). Prisma's generated types are used
// via the runtime client; this is the serialized shape returned to callers.
type TierInput = AreaTierDto;

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Reads ---------------------------------------------------------------

  // Public: active plans for the booking flow, ordered for display.
  async listActive() {
    const plans = await this.prisma.plan.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { areaTiers: true },
    });
    return plans.map((p) => this.serialize(p));
  }

  // Admin: every plan (active + inactive), same ordering.
  async listAll() {
    const plans = await this.prisma.plan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { areaTiers: true },
    });
    return plans.map((p) => this.serialize(p));
  }

  async getById(id: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: { areaTiers: true },
    });
    if (!plan) {
      throw new NotFoundException('Plan not found.');
    }
    return this.serialize(plan);
  }

  // ---- Writes --------------------------------------------------------------

  async create(dto: CreatePlanDto) {
    const interval = this.normalizeInterval(dto.billingType, dto.interval);
    const tiers = dto.areaTiers ?? [];
    this.assertValidTiers(tiers);

    const slug = await this.resolveSlug(dto.slug, dto.name);

    const plan = await this.prisma.plan.create({
      data: {
        name: dto.name,
        slug,
        description: dto.description ?? null,
        billingType: dto.billingType,
        interval,
        basePrice: dto.basePrice,
        features: dto.features ?? [],
        active: dto.active ?? true,
        sortOrder: dto.sortOrder ?? 0,
        areaTiers: { create: tiers.map((t) => this.tierData(t)) },
      },
      include: { areaTiers: true },
    });
    return this.serialize(plan);
  }

  async update(id: string, dto: UpdatePlanDto) {
    const existing = await this.prisma.plan.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Plan not found.');
    }

    // Resolve the effective billingType/interval for cross-field validation:
    // fall back to the stored values for whatever the DTO doesn't change.
    const billingType = dto.billingType ?? existing.billingType;
    const interval =
      dto.billingType !== undefined || dto.interval !== undefined
        ? this.normalizeInterval(billingType, dto.interval ?? null)
        : existing.interval;

    if (dto.areaTiers !== undefined) {
      this.assertValidTiers(dto.areaTiers);
    }

    const slug =
      dto.slug !== undefined
        ? await this.resolveSlug(dto.slug, dto.name ?? existing.name, id)
        : undefined;

    const plan = await this.prisma.$transaction(async (tx) => {
      await tx.plan.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(slug !== undefined ? { slug } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description ?? null }
            : {}),
          ...(dto.billingType !== undefined ? { billingType } : {}),
          ...(dto.billingType !== undefined || dto.interval !== undefined
            ? { interval }
            : {}),
          ...(dto.basePrice !== undefined ? { basePrice: dto.basePrice } : {}),
          ...(dto.features !== undefined ? { features: dto.features } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        },
      });

      // Providing areaTiers fully replaces the set; omitting it leaves it alone.
      if (dto.areaTiers !== undefined) {
        await tx.planAreaTier.deleteMany({ where: { planId: id } });
        if (dto.areaTiers.length > 0) {
          await tx.planAreaTier.createMany({
            data: dto.areaTiers.map((t) => ({ planId: id, ...this.tierData(t) })),
          });
        }
      }

      return tx.plan.findUniqueOrThrow({
        where: { id },
        include: { areaTiers: true },
      });
    });

    return this.serialize(plan);
  }

  // Hard-delete (cascade removes tiers). Once bookings reference plans (added in
  // the payment-rewrite phase), this will soft-delete via `active=false` when the
  // plan has bookings; until then there are no dependents to protect.
  async remove(id: string) {
    const existing = await this.prisma.plan.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Plan not found.');
    }
    await this.prisma.plan.delete({ where: { id } });
    return { id, deleted: true };
  }

  // ---- Helpers -------------------------------------------------------------

  private tierData(t: TierInput) {
    return {
      minSqFt: t.minSqFt,
      maxSqFt: t.maxSqFt ?? null,
      surcharge: t.surcharge,
    };
  }

  // recurring ⇒ interval required; oneTime ⇒ interval must be absent.
  private normalizeInterval(
    billingType: CreatePlanDto['billingType'],
    interval: CreatePlanDto['interval'],
  ) {
    if (billingType === 'recurring') {
      if (!interval) {
        throw new BadRequestException(
          'Recurring plans require an interval (weekly, biweekly, or monthly).',
        );
      }
      return interval;
    }
    // oneTime
    if (interval) {
      throw new BadRequestException(
        'One-time plans must not declare an interval.',
      );
    }
    return null;
  }

  // Tiers must be non-overlapping ascending brackets; only the top bracket may
  // omit maxSqFt (the open-ended upper tier).
  private assertValidTiers(tiers: TierInput[]) {
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

  // Use the provided slug or derive one from the name; ensure uniqueness. When
  // updating, `excludeId` lets a plan keep its own slug.
  private async resolveSlug(slug: string | undefined, name: string, excludeId?: string) {
    const candidate = (slug ?? this.slugify(name)).trim();
    if (!candidate) {
      throw new BadRequestException('Unable to derive a slug from the name.');
    }
    const clash = await this.prisma.plan.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (clash && clash.id !== excludeId) {
      throw new BadRequestException(
        `A plan with the slug "${candidate}" already exists.`,
      );
    }
    return candidate;
  }

  private slugify(name: string) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private serialize(plan: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    billingType: string;
    interval: string | null;
    basePrice: number;
    features: string[];
    active: boolean;
    sortOrder: number;
    stripeProductId: string | null;
    createdAt: Date;
    updatedAt: Date;
    areaTiers: {
      id: string;
      minSqFt: number;
      maxSqFt: number | null;
      surcharge: number;
    }[];
  }) {
    return {
      id: plan.id,
      name: plan.name,
      slug: plan.slug,
      description: plan.description,
      billingType: plan.billingType,
      interval: plan.interval,
      basePrice: plan.basePrice,
      features: plan.features,
      active: plan.active,
      sortOrder: plan.sortOrder,
      stripeProductId: plan.stripeProductId,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      areaTiers: [...plan.areaTiers]
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
