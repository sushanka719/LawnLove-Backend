import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreatePlanDto } from './dto/create-plan.dto';
import type { UpdatePlanDto } from './dto/update-plan.dto';

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Reads ---------------------------------------------------------------

  // Public: active plans for the booking flow, ordered for display. The area
  // surcharge ladder is global now (see PricingSettingsService), not per-plan.
  async listActive() {
    const plans = await this.prisma.plan.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return plans.map((p) => this.serialize(p));
  }

  // Admin: every plan (active + inactive), same ordering.
  async listAll() {
    const plans = await this.prisma.plan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return plans.map((p) => this.serialize(p));
  }

  async getById(id: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) {
      throw new NotFoundException('Plan not found.');
    }
    return this.serialize(plan);
  }

  // ---- Writes --------------------------------------------------------------

  async create(dto: CreatePlanDto) {
    const interval = this.normalizeInterval(dto.billingType, dto.interval);
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
      },
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

    const slug =
      dto.slug !== undefined
        ? await this.resolveSlug(dto.slug, dto.name ?? existing.name, id)
        : undefined;

    const plan = await this.prisma.plan.update({
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

    return this.serialize(plan);
  }

  // Hard-delete. Once bookings reference plans (added in the payment-rewrite
  // phase), this will soft-delete via `active=false` when the plan has bookings;
  // until then there are no dependents to protect.
  async remove(id: string) {
    const existing = await this.prisma.plan.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Plan not found.');
    }
    await this.prisma.plan.delete({ where: { id } });
    return { id, deleted: true };
  }

  // ---- Helpers -------------------------------------------------------------

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

  // Use the provided slug or derive one from the name; ensure uniqueness. When
  // updating, `excludeId` lets a plan keep its own slug.
  private async resolveSlug(
    slug: string | undefined,
    name: string,
    excludeId?: string,
  ) {
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
    };
  }
}
