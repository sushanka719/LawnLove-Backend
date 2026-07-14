import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { ESTIMATED_AREA_FACTOR, computeQuote, type Frequency } from './pricing';
import { polygonAreaSqFt } from './geo';

type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
};

@Injectable()
export class BookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  async createSetupIntent(user: SessionUser) {
    const customerId = await this.stripe.getOrCreateCustomer(user);
    return this.stripe.createSetupIntent(customerId);
  }

  async createBooking(user: SessionUser, dto: CreateBookingDto) {
    const customerId = await this.stripe.getOrCreateCustomer(user);

    const owned = await this.stripe.assertPaymentMethodOwnedByCustomer(
      dto.paymentMethodId,
      customerId,
    );
    if (!owned) {
      throw new BadRequestException(
        'This payment method is not associated with your account.',
      );
    }

    // Recompute area + all totals server-side; never trust client-sent prices.
    const areaSqFt = Math.round(polygonAreaSqFt(dto.boundary));
    const estimatedAreaSqFt = Math.round(areaSqFt * ESTIMATED_AREA_FACTOR);
    const { subtotal, discountPct, totalPerVisit } = computeQuote(
      estimatedAreaSqFt,
      dto.frequency as Frequency,
    );

    const scheduleDate = new Date(`${dto.date}T00:00:00.000Z`);
    if (Number.isNaN(scheduleDate.getTime())) {
      throw new BadRequestException('Invalid schedule date.');
    }

    const booking = await this.prisma.booking.create({
      data: {
        userId: user.id,
        phone: dto.phone,
        address: dto.address,
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
        boundary: dto.boundary.map((point) => ({
          lat: point.lat,
          lng: point.lng,
        })),
        areaSqFt,
        estimatedAreaSqFt,
        frequency: dto.frequency,
        subtotal,
        discountPct,
        totalPerVisit,
        scheduleDate,
        timeSlot: dto.timeSlot,
        stripeCustomerId: customerId,
        stripePaymentMethodId: dto.paymentMethodId,
      },
      select: {
        id: true,
        estimatedAreaSqFt: true,
        subtotal: true,
        discountPct: true,
        totalPerVisit: true,
        frequency: true,
        scheduleDate: true,
        timeSlot: true,
      },
    });

    return booking;
  }
}
