import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PromoType } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePromoDto } from './dto/create-promo.dto';
import { UpdatePromoDto } from './dto/update-promo.dto';

export type PromoEvaluation = {
  valid: boolean;
  code: string;
  message: string;
  discountCents: number;
  type?: PromoType;
  value?: number;
  promoCodeId?: string;
};

@Injectable()
export class PromoService {
  constructor(private readonly prisma: PrismaService) {}

  private normalize(code: string): string {
    return code.trim().toUpperCase();
  }

  // Discount is capped at the subtotal so a promo can never make a charge < 0.
  private computeDiscount(
    type: PromoType,
    value: number,
    subtotalCents: number,
  ): number {
    const raw =
      type === 'percent'
        ? Math.round((subtotalCents * value) / 100)
        : value;
    return Math.max(0, Math.min(raw, subtotalCents));
  }

  // Non-throwing evaluation, used by the public preview and the booking recompute.
  async evaluate(
    codeInput: string,
    subtotalCents: number,
  ): Promise<PromoEvaluation> {
    const code = this.normalize(codeInput);
    const invalid = (message: string): PromoEvaluation => ({
      valid: false,
      code,
      message,
      discountCents: 0,
    });

    if (!code) return invalid('Enter a promo code.');

    const promo = await this.prisma.promoCode.findUnique({ where: { code } });
    if (!promo || !promo.active) return invalid('This promo code is not valid.');
    if (promo.expiresAt && promo.expiresAt.getTime() <= Date.now()) {
      return invalid('This promo code has expired.');
    }
    if (
      promo.maxRedemptions != null &&
      promo.redemptions >= promo.maxRedemptions
    ) {
      return invalid('This promo code has reached its redemption limit.');
    }
    if (promo.minSubtotal != null && subtotalCents < promo.minSubtotal) {
      return invalid(
        `This code requires an order of at least $${(promo.minSubtotal / 100).toFixed(2)}.`,
      );
    }

    const discountCents = this.computeDiscount(
      promo.type,
      promo.value,
      subtotalCents,
    );
    if (discountCents <= 0) {
      return invalid('This promo code does not apply to this order.');
    }

    return {
      valid: true,
      code,
      message: 'Promo code applied.',
      discountCents,
      type: promo.type,
      value: promo.value,
      promoCodeId: promo.id,
    };
  }

  // Throwing variant for POST /bookings. The client previews first, so failure
  // here means the code went stale between preview and submit.
  async resolveForBooking(
    codeInput: string,
    subtotalCents: number,
  ): Promise<{ promoCodeId: string; discountAmount: number }> {
    const result = await this.evaluate(codeInput, subtotalCents);
    if (!result.valid || !result.promoCodeId) {
      throw new BadRequestException(result.message);
    }
    return {
      promoCodeId: result.promoCodeId,
      discountAmount: result.discountCents,
    };
  }

  // Best-effort — a redemption-count miss must never fail a paid booking.
  async incrementRedemption(promoCodeId: string): Promise<void> {
    await this.prisma.promoCode
      .update({
        where: { id: promoCodeId },
        data: { redemptions: { increment: 1 } },
      })
      .catch(() => undefined);
  }

  // ---- Admin CRUD ----------------------------------------------------------

  listAll() {
    return this.prisma.promoCode.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async create(dto: CreatePromoDto) {
    this.assertValue(dto.type, dto.value);
    const code = this.normalize(dto.code);
    const existing = await this.prisma.promoCode.findUnique({ where: { code } });
    if (existing) {
      throw new BadRequestException('A promo code with that code already exists.');
    }
    return this.prisma.promoCode.create({
      data: {
        code,
        description: dto.description ?? null,
        type: dto.type,
        value: dto.value,
        active: dto.active ?? undefined,
        maxRedemptions: dto.maxRedemptions ?? null,
        minSubtotal: dto.minSubtotal ?? null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });
  }

  async update(id: string, dto: UpdatePromoDto) {
    const existing = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Promo code not found.');

    const type = dto.type ?? existing.type;
    const value = dto.value ?? existing.value;
    if (dto.type !== undefined || dto.value !== undefined) {
      this.assertValue(type, value);
    }

    const data: Prisma.PromoCodeUpdateInput = {};
    if (dto.code !== undefined) {
      const code = this.normalize(dto.code);
      const clash = await this.prisma.promoCode.findFirst({
        where: { code, id: { not: id } },
        select: { id: true },
      });
      if (clash) {
        throw new BadRequestException(
          'A promo code with that code already exists.',
        );
      }
      data.code = code;
    }
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.value !== undefined) data.value = dto.value;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.maxRedemptions !== undefined) data.maxRedemptions = dto.maxRedemptions;
    if (dto.minSubtotal !== undefined) data.minSubtotal = dto.minSubtotal;
    if (dto.expiresAt !== undefined) {
      data.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    }

    return this.prisma.promoCode.update({ where: { id }, data });
  }

  // Deactivate (not delete) if any booking used the code, so historical bookings
  // keep their FK; otherwise hard-delete an unused code.
  async remove(id: string) {
    const existing = await this.prisma.promoCode.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Promo code not found.');

    const used = await this.prisma.booking.count({
      where: { promoCodeId: id },
    });
    if (used > 0) {
      await this.prisma.promoCode.update({
        where: { id },
        data: { active: false },
      });
      return { success: true, deactivated: true };
    }
    await this.prisma.promoCode.delete({ where: { id } });
    return { success: true, deactivated: false };
  }

  private assertValue(type: PromoType, value: number) {
    if (type === 'percent' && (value < 1 || value > 100)) {
      throw new BadRequestException(
        'Percentage discount must be between 1 and 100.',
      );
    }
    if (type === 'fixed' && value < 1) {
      throw new BadRequestException('Fixed discount must be at least 1 cent.');
    }
  }
}
