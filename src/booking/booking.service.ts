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

  // Create a booking for the chosen plan and start its payment. Returns the
  // Stripe client secret the embedded Payment Element confirms against — the
  // customer is charged now (prepaid). The webhook flips the booking to active.
  async createBooking(user: SessionUser, dto: CreateBookingDto) {
    // Load the chosen plan (+ its area tiers). Reject unknown/inactive plans.
    const plan = await this.prisma.plan.findUnique({
      where: { id: dto.planId },
      include: { areaTiers: true },
    });
    if (!plan || !plan.active) {
      throw new BadRequestException('The selected plan is unavailable.');
    }
    if (plan.billingType === 'recurring' && !plan.interval) {
      throw new BadRequestException('The selected plan is misconfigured.');
    }

    const customerId = await this.stripe.getOrCreateCustomer(user);

    // Recompute area + amount server-side; never trust client-sent prices. All
    // amounts are in CENTS.
    const areaSqFt = Math.round(polygonAreaSqFt(dto.boundary));
    const estimatedAreaSqFt = Math.round(areaSqFt * ESTIMATED_AREA_FACTOR);
    const { basePrice, areaSurcharge, totalPerVisit } = computeQuote(
      plan,
      estimatedAreaSqFt,
    );

    const scheduleDate = new Date(`${dto.date}T00:00:00.000Z`);
    if (Number.isNaN(scheduleDate.getTime())) {
      throw new BadRequestException('Invalid schedule date.');
    }

    // Legacy display columns (whole dollars), derived from the plan.
    // `plan.interval` is guaranteed non-null for recurring plans by the check
    // above, so the assertion is safe.
    const frequency =
      plan.billingType === 'oneTime' ? 'oneTime' : plan.interval!;

    // Create the booking (pendingPayment) and its first Job atomically — a
    // booking should never exist without a Job to service.
    const booking = await this.prisma.$transaction(async (tx) => {
      const created = await tx.booking.create({
        data: {
          userId: user.id,
          planId: plan.id,
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
          basePrice,
          areaSurcharge,
          frequency,
          subtotal: Math.round(basePrice / 100),
          discountPct: 0,
          totalPerVisit: Math.round(totalPerVisit / 100),
          scheduleDate,
          timeSlot: dto.timeSlot,
          stripeCustomerId: customerId,
          status: 'pendingPayment',
        },
        select: { id: true },
      });

      await tx.job.create({
        data: { bookingId: created.id, status: 'assigned' },
      });

      return created;
    });

    // Start the charge. Metadata lets the webhook match the event to this
    // booking. On failure, drop the dangling pendingPayment booking.
    const metadata = {
      bookingId: booking.id,
      planId: plan.id,
      userId: user.id,
    };
    try {
      let clientSecret: string;
      if (plan.billingType === 'recurring') {
        const productId = await this.stripe.upsertProduct(plan);
        const sub = await this.stripe.createSubscription({
          customerId,
          productId,
          unitAmount: totalPerVisit,
          interval: plan.interval as 'weekly' | 'biweekly' | 'monthly',
          metadata,
        });
        clientSecret = sub.clientSecret;
        await this.prisma.booking.update({
          where: { id: booking.id },
          data: { stripeSubscriptionId: sub.subscriptionId },
        });
      } else {
        const pi = await this.stripe.createPaymentIntent({
          customerId,
          amount: totalPerVisit,
          metadata,
        });
        clientSecret = pi.clientSecret;
        await this.prisma.booking.update({
          where: { id: booking.id },
          data: { stripePaymentIntentId: pi.paymentIntentId },
        });
      }
      return { bookingId: booking.id, clientSecret, amount: totalPerVisit };
    } catch (err) {
      await this.prisma.booking
        .delete({ where: { id: booking.id } })
        .catch(() => undefined);
      throw err;
    }
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

  // The customer's current recurring plans for the Settings "Plan" section —
  // active or past-due subscriptions (one-time bookings aren't ongoing plans).
  // Returned newest first, unpaginated but capped, so the caller can render an
  // empty state, a single plan, or several without extra round-trips.
  async listCurrentPlans(userId: string) {
    const rows = await this.prisma.booking.findMany({
      where: {
        userId,
        frequency: { not: 'oneTime' },
        status: { in: ['active', 'pastDue'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
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
    });

    return rows.map((b) => ({
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
