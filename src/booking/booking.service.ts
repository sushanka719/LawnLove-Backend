import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { bookingReference, bookingServiceLabel } from './booking-format';
import { CreateBookingDto } from './dto/create-booking.dto';
import { ListBookingsDto } from './dto/list-bookings.dto';
import { ESTIMATED_AREA_FACTOR, computeQuote } from './pricing';
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
      dto.frequency,
    );

    const scheduleDate = new Date(`${dto.date}T00:00:00.000Z`);
    if (Number.isNaN(scheduleDate.getTime())) {
      throw new BadRequestException('Invalid schedule date.');
    }

    // Create the booking and its first Job (the visit to be dispatched)
    // atomically — a booking should never exist without a Job to service.
    const booking = await this.prisma.$transaction(async (tx) => {
      const created = await tx.booking.create({
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

      await tx.job.create({
        data: { bookingId: created.id, status: 'assigned' },
      });

      return created;
    });

    return booking;
  }

  // Paginated list of the signed-in customer's bookings, newest first, for the
  // dashboard "Bookings" screen. Returns display-ready `reference`/`title` plus
  // a `visitsCount` (number of Jobs/visits under each booking).
  async listBookings(userId: string, { page, pageSize }: ListBookingsDto) {
    const skip = (page - 1) * pageSize;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          address: true,
          frequency: true,
          scheduleDate: true,
          timeSlot: true,
          totalPerVisit: true,
          status: true,
          createdAt: true,
          _count: { select: { jobs: true } },
        },
      }),
      this.prisma.booking.count({ where: { userId } }),
    ]);

    const items = rows.map((b) => ({
      id: b.id,
      reference: bookingReference(b.id),
      title: bookingServiceLabel(b.frequency),
      address: b.address,
      frequency: b.frequency,
      scheduleDate: b.scheduleDate,
      timeSlot: b.timeSlot,
      totalPerVisit: b.totalPerVisit,
      status: b.status,
      createdAt: b.createdAt,
      visitsCount: b._count.jobs,
    }));

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  // Full detail for one booking the customer owns, including its visits (Jobs).
  // Scoping the query by `userId` means a missing OR unowned booking both 404 —
  // we never reveal another user's data.
  async getBooking(id: string, userId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id, userId },
      select: {
        id: true,
        address: true,
        phone: true,
        frequency: true,
        areaSqFt: true,
        estimatedAreaSqFt: true,
        subtotal: true,
        discountPct: true,
        totalPerVisit: true,
        scheduleDate: true,
        timeSlot: true,
        status: true,
        createdAt: true,
        jobs: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            completedAt: true,
            amount: true,
            review: { select: { rating: true } },
          },
        },
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found.');
    }

    return {
      ...booking,
      reference: bookingReference(booking.id),
      title: bookingServiceLabel(booking.frequency),
    };
  }

  // Paginated list of the customer's invoices — one per charged visit (a Job is
  // charged at completion, so `chargedAt != null` marks a real, billed invoice).
  // Newest charge first.
  async listInvoices(userId: string, { page, pageSize }: ListBookingsDto) {
    const skip = (page - 1) * pageSize;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.job.findMany({
        where: { booking: { userId }, chargedAt: { not: null } },
        orderBy: { chargedAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          status: true,
          amount: true,
          completedAt: true,
          chargedAt: true,
          booking: { select: { address: true, frequency: true } },
        },
      }),
      this.prisma.job.count({
        where: { booking: { userId }, chargedAt: { not: null } },
      }),
    ]);

    const items = rows.map((j) => ({
      jobId: j.id,
      invoiceNumber: `INV-${j.id.slice(-6).toUpperCase()}`,
      serviceLabel: bookingServiceLabel(j.booking.frequency),
      address: j.booking.address,
      servicedOn: j.completedAt ?? j.chargedAt,
      amount: j.amount ?? 0,
      refunded: j.status === 'refunded',
    }));

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }
}
