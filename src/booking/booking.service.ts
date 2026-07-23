import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { StripeService } from '../stripe/stripe.service';
import { bookingReference, bookingServiceLabel } from './booking-format';
import { CreateBookingDto } from './dto/create-booking.dto';
import { ListBookingsDto } from './dto/list-bookings.dto';
import { ESTIMATED_AREA_FACTOR, computeQuote, isOverMaxArea } from './pricing';
import { polygonAreaSqFt } from './geo';
import { PricingSettingsService } from '../pricing-settings/pricing-settings.service';
import { PromoService } from '../promo/promo.service';

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
    private readonly storage: StorageService,
    private readonly pricingSettings: PricingSettingsService,
    private readonly promo: PromoService,
  ) {}

  // Create a booking for the chosen plan and start its payment. Returns the
  // Stripe client secret the embedded Payment Element confirms against — the
  // customer is charged now (prepaid). The webhook flips the booking to active.
  async createBooking(user: SessionUser, dto: CreateBookingDto) {
    // Load the chosen plan. Reject unknown/inactive plans. The area surcharge
    // ladder + the maximum serviceable area are global now (PricingSettings).
    const plan = await this.prisma.plan.findUnique({
      where: { id: dto.planId },
    });
    if (!plan || !plan.active) {
      throw new BadRequestException('The selected plan is unavailable.');
    }
    if (plan.billingType === 'recurring' && !plan.interval) {
      throw new BadRequestException('The selected plan is misconfigured.');
    }

    // Recompute area + amount server-side; never trust client-sent prices. All
    // amounts are in CENTS. Block lawns beyond the global maximum serviceable
    // area before touching Stripe, so we never create a dangling customer.
    const areaSqFt = Math.round(polygonAreaSqFt(dto.boundary));
    const estimatedAreaSqFt = Math.round(areaSqFt * ESTIMATED_AREA_FACTOR);

    const pricing = await this.pricingSettings.getConfigForQuote();
    if (isOverMaxArea(pricing.maxAreaSqFt, estimatedAreaSqFt)) {
      throw new BadRequestException(
        'This lawn is larger than the area we currently service. Please contact us for a custom quote.',
      );
    }
    const { basePrice, areaSurcharge, totalPerVisit } = computeQuote(
      plan.basePrice,
      pricing.areaTiers,
      estimatedAreaSqFt,
    );

    // Apply a promo code if provided — recomputed server-side from the code and
    // the per-visit subtotal (never trust a client-sent discount). The final
    // amount charged to Stripe is the discounted per-visit total.
    let promoCodeId: string | null = null;
    let discountAmount = 0;
    if (dto.promoCode?.trim()) {
      const resolved = await this.promo.resolveForBooking(
        dto.promoCode,
        totalPerVisit,
      );
      promoCodeId = resolved.promoCodeId;
      discountAmount = resolved.discountAmount;
    }
    const chargeAmount = Math.max(0, totalPerVisit - discountAmount);

    const customerId = await this.stripe.getOrCreateCustomer(user);

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
          // Legacy display column (whole dollars) reflects the DISCOUNTED charge.
          totalPerVisit: Math.round(chargeAmount / 100),
          promoCodeId,
          discountAmount,
          scheduleDate,
          timeSlot: dto.timeSlot,
          stripeCustomerId: customerId,
          status: 'pendingPayment',
        },
        select: { id: true },
      });

      // Visit #1 — dated from the customer's chosen date. An employee is picked
      // by the scheduler once payment lands (see the Stripe webhook); recurring
      // bookings get visits #2+ from the daily rolling-window cron.
      await tx.job.create({
        data: {
          bookingId: created.id,
          visitNumber: 1,
          scheduledDate: scheduleDate,
          status: 'assigned',
        },
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
          unitAmount: chargeAmount,
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
          amount: chargeAmount,
          metadata,
        });
        clientSecret = pi.clientSecret;
        await this.prisma.booking.update({
          where: { id: booking.id },
          data: { stripePaymentIntentId: pi.paymentIntentId },
        });
      }
      // Count the redemption once the charge is set up (best-effort).
      if (promoCodeId) {
        await this.promo.incrementRedemption(promoCodeId);
      }
      return { bookingId: booking.id, clientSecret, amount: chargeAmount };
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
          orderBy: { visitNumber: 'asc' },
          select: {
            id: true,
            status: true,
            visitNumber: true,
            scheduledDate: true,
            completedAt: true,
            amount: true,
            review: { select: { rating: true } },
            // "Completed by": the field-worker who did the visit, falling back
            // to the agent (business owner) when no employee was assigned.
            agent: { select: { name: true } },
            employee: { select: { name: true } },
            // Before/after proof photos — private-bucket keys, presigned below.
            photos: {
              select: { id: true, type: true, takenAt: true, storageKey: true },
            },
          },
        },
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found.');
    }

    // Presign each visit's photos and flatten the "completed by" name so the
    // customer's Booking Details page can render the results inline in a single
    // request (mirrors BookingJobsService.getJob's per-job presigning).
    const jobs = await Promise.all(
      booking.jobs.map(async (job) => {
        const photos = await Promise.all(
          [...job.photos]
            .sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime())
            .map(async (photo) => ({
              id: photo.id,
              type: photo.type,
              takenAt: photo.takenAt,
              url: await this.storage.presignDownload(photo.storageKey),
            })),
        );
        return {
          id: job.id,
          status: job.status,
          visitNumber: job.visitNumber,
          scheduledDate: job.scheduledDate,
          completedAt: job.completedAt,
          amount: job.amount,
          review: job.review,
          completedBy: job.employee?.name ?? job.agent?.name ?? null,
          photos: {
            before: photos.filter((p) => p.type === 'before'),
            after: photos.filter((p) => p.type === 'after'),
          },
        };
      }),
    );

    return {
      ...booking,
      jobs,
      reference: bookingReference(booking.id),
      title: bookingServiceLabel(booking.frequency),
    };
  }

  // Paginated list of the customer's invoices. Prepaid model: a booking is
  // charged up front (and re-charged each recurring visit via Stripe), so a
  // billed invoice = a booking with `amountCharged` set by the webhook. MVP:
  // one invoice row per charged booking, newest first.
  async listInvoices(userId: string, { page, pageSize }: ListBookingsDto) {
    const skip = (page - 1) * pageSize;
    const where = { userId, amountCharged: { not: null } } as const;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          status: true,
          frequency: true,
          address: true,
          scheduleDate: true,
          amountCharged: true,
          createdAt: true,
        },
      }),
      this.prisma.booking.count({ where }),
    ]);

    const items = rows.map((b) => ({
      id: b.id,
      invoiceNumber: `INV-${b.id.slice(-6).toUpperCase()}`,
      serviceLabel: bookingServiceLabel(b.frequency),
      address: b.address,
      servicedOn: b.scheduleDate ?? b.createdAt,
      amount: b.amountCharged ?? 0,
      status: b.status,
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
